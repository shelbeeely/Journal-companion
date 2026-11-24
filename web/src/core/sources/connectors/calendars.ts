import { normalizeCalendarUrl, parseIcs } from '../ics';
import { addDays, bearer, fetchJson, fetchText, isoDate, item, startOfDay } from '../kit';
import { SourceError, type ContextItem, type ConnectorContext, type SourceConnector } from '../types';

const WINDOW_BACK_DAYS = 1;
const WINDOW_AHEAD_DAYS = 14;

function windowFor(now: Date) {
  return { from: addDays(startOfDay(now), -WINDOW_BACK_DAYS), to: addDays(startOfDay(now), WINDOW_AHEAD_DAYS + 1) };
}

const GOOGLE_CLIENT_FIELD = {
  key: 'clientId',
  label: 'Google OAuth client ID',
  type: 'text' as const,
  placeholder: '1234-abc.apps.googleusercontent.com',
  envVar: 'VITE_GOOGLE_CLIENT_ID',
  help: 'Create a Web OAuth client in Google Cloud and add this site as an authorized JavaScript origin.',
};

export const MS_CLIENT_FIELD = {
  key: 'clientId',
  label: 'Microsoft app (client) ID',
  type: 'text' as const,
  placeholder: '00000000-0000-0000-0000-000000000000',
  envVar: 'VITE_MS_CLIENT_ID',
  help: 'Register a single-page app in Microsoft Entra with this site as a redirect URI.',
};

export { GOOGLE_CLIENT_FIELD };

/* ------------------------------ Google Calendar ------------------------------ */

interface GCalList {
  items?: { id: string; summary?: string; selected?: boolean; primary?: boolean; hidden?: boolean }[];
}
interface GEvents {
  items?: {
    id: string;
    status?: string;
    summary?: string;
    location?: string;
    description?: string;
    htmlLink?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }[];
}

export const googleCalendar: SourceConnector = {
  id: 'calendar_google',
  label: 'Google Calendar',
  category: 'calendar',
  description: 'Upcoming events from the calendars you show in Google Calendar.',
  kind: 'network',
  auth: 'google',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  credentialFields: [GOOGLE_CLIENT_FIELD],
  ttlMs: 20 * 60_000,
  privacyNote: 'Read-only. Events from yesterday to two weeks ahead are fetched straight from Google to this device.',
  limitations: 'Without a server, Google sign-in lasts about an hour; after that, tap Reconnect.',
  helpUrl: 'https://console.cloud.google.com/apis/credentials',
  isConfigured: (c) => !!c.accessToken,
  async sync(ctx) {
    const token = ctx.accessToken!;
    const { from, to } = windowFor(ctx.now);
    const list = await fetchJson<GCalList>(ctx.fetch, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader', { headers: bearer(token), label: 'Google Calendar' });
    const cals = (list.items ?? []).filter((c) => c.selected !== false && !c.hidden).slice(0, 10);
    const out: ContextItem[] = [];
    for (const cal of cals) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=150&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}`;
      const ev = await fetchJson<GEvents>(ctx.fetch, url, { headers: bearer(token), label: 'Google Calendar' });
      for (const e of ev.items ?? []) {
        if (e.status === 'cancelled' || !e.start) continue;
        const allDay = !e.start.dateTime;
        out.push(
          item('calendar_google', `${cal.id}:${e.id}`, 'event', e.summary ?? '(No title)', ctx.now.getTime(), {
            startsAt: e.start.dateTime ?? e.start.date,
            endsAt: e.end?.dateTime ?? e.end?.date,
            allDay,
            location: e.location,
            url: e.htmlLink,
            subtitle: cal.primary ? undefined : cal.summary,
            data: { calendar: cal.summary, description: e.description?.slice(0, 300) },
          }),
        );
      }
    }
    return out;
  },
};

/* ------------------------------ Microsoft Outlook ------------------------------ */

interface MsEvents {
  value?: {
    id: string;
    subject?: string;
    isAllDay?: boolean;
    isCancelled?: boolean;
    webLink?: string;
    start?: { dateTime: string };
    end?: { dateTime: string };
    location?: { displayName?: string };
    bodyPreview?: string;
  }[];
}

const msUtc = (s?: string) => (s ? (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(/\.\d+$/, '')}Z`) : undefined);

export const microsoftCalendar: SourceConnector = {
  id: 'calendar_microsoft',
  label: 'Outlook Calendar',
  category: 'calendar',
  description: 'Events from Outlook.com, Microsoft 365 or Exchange Online.',
  kind: 'network',
  auth: 'microsoft',
  scopes: ['Calendars.Read'],
  credentialFields: [MS_CLIENT_FIELD],
  ttlMs: 20 * 60_000,
  privacyNote: 'Read-only. Events from yesterday to two weeks ahead are fetched from Microsoft Graph to this device.',
  helpUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  isConfigured: (c) => !!c.accessToken,
  async sync(ctx) {
    const { from, to } = windowFor(ctx.now);
    const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$top=200&$orderby=start/dateTime&$select=id,subject,isAllDay,isCancelled,webLink,start,end,location,bodyPreview`;
    const res = await fetchJson<MsEvents>(ctx.fetch, url, { headers: { ...bearer(ctx.accessToken!), Prefer: 'outlook.timezone="UTC"' }, label: 'Outlook' });
    return (res.value ?? [])
      .filter((e) => !e.isCancelled && e.start)
      .map((e) =>
        item('calendar_microsoft', e.id, 'event', e.subject ?? '(No title)', ctx.now.getTime(), {
          startsAt: e.isAllDay ? e.start!.dateTime.slice(0, 10) : msUtc(e.start!.dateTime),
          endsAt: e.isAllDay ? e.end?.dateTime.slice(0, 10) : msUtc(e.end?.dateTime),
          allDay: !!e.isAllDay,
          location: e.location?.displayName || undefined,
          url: e.webLink,
          data: { description: e.bodyPreview?.slice(0, 300) },
        }),
      );
  },
};

/* ------------------------------- iCalendar feeds ------------------------------- */

function icsToItems(sourceId: string, text: string, ctx: ConnectorContext, label?: string): ContextItem[] {
  const { from, to } = windowFor(ctx.now);
  return parseIcs(text, from, to).map((e) =>
    item(sourceId, `${e.uid}:${e.start}`, 'event', e.summary, ctx.now.getTime(), {
      startsAt: e.start,
      endsAt: e.end,
      allDay: e.allDay,
      location: e.location,
      url: e.url,
      subtitle: label,
      data: { description: e.description, recurring: e.recurring },
    }),
  );
}

async function fetchIcs(ctx: ConnectorContext, url: string, label: string): Promise<string> {
  try {
    const text = await fetchText(ctx.fetch, normalizeCalendarUrl(url), { label });
    if (!text.includes('BEGIN:VCALENDAR')) throw new SourceError('parse', `${label} didn't return a calendar file. Check the link.`);
    return text;
  } catch (e) {
    if (e instanceof SourceError && e.kind === 'cors') {
      throw new SourceError('cors', `${label} doesn't allow web apps to read this link directly. Download the .ics file and import it instead.`);
    }
    throw e;
  }
}

export const appleCalendar: SourceConnector = {
  id: 'calendar_apple',
  label: 'Apple iCloud Calendar',
  category: 'calendar',
  description: 'A public iCloud calendar link (Calendar → share calendar → Public Calendar).',
  kind: 'network',
  credentialFields: [{ key: 'url', label: 'Public calendar link', type: 'url', placeholder: 'webcal://p01-caldav.icloud.com/published/2/…' }],
  ttlMs: 30 * 60_000,
  privacyNote: 'The app fetches the public link you paste. Anyone with that link can see the calendar, so only share calendars you are comfortable making public.',
  limitations: 'Private iCloud calendars and Reminders have no web API. Use a public link, or export from Calendar (File → Export) and import the .ics file.',
  isConfigured: (c) => !!c.credentials.url?.trim(),
  async sync(ctx) {
    const url = ctx.credentials.url.trim();
    if (!/icloud\.com/i.test(url)) throw new SourceError('config', 'That doesn’t look like an iCloud link. Use “Calendar file or link” for other calendars.');
    return icsToItems('calendar_apple', await fetchIcs(ctx, url, 'iCloud'), ctx, 'iCloud');
  },
};

export const icsCalendar: SourceConnector = {
  id: 'calendar_ics',
  label: 'Calendar file or link (.ics)',
  category: 'calendar',
  description: 'Import an .ics file from any calendar app, or subscribe to an https/webcal link.',
  kind: 'network',
  credentialFields: [{ key: 'url', label: 'Calendar link (optional if you import a file)', type: 'url', optional: true, placeholder: 'https://… .ics or webcal://…' }],
  ttlMs: 30 * 60_000,
  privacyNote: 'Imported files stay on this device. A link is fetched directly from its host.',
  limitations: 'Some hosts block web apps from reading their links; importing the downloaded file always works.',
  isConfigured: (c) => !!c.credentials.url?.trim() || typeof c.config.fileText === 'string',
  async sync(ctx) {
    const items: ContextItem[] = [];
    if (typeof ctx.config.fileText === 'string') items.push(...icsToItems('calendar_ics', ctx.config.fileText, ctx, (ctx.config.fileName as string) || 'Imported calendar'));
    if (ctx.credentials.url?.trim()) items.push(...icsToItems('calendar_ics', await fetchIcs(ctx, ctx.credentials.url, 'Calendar link'), ctx));
    return items;
  },
};

/* ------------------------------- Public holidays ------------------------------- */

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  global: boolean;
  types?: string[];
}

export const holidays: SourceConnector = {
  id: 'holidays',
  label: 'Public holidays',
  category: 'calendar',
  description: 'Public holidays for your country, from Nager.Date.',
  kind: 'network',
  credentialFields: [{ key: 'country', label: 'Country code (blank = from your device)', type: 'text', optional: true, placeholder: 'US' }],
  ttlMs: 7 * 86_400_000,
  privacyNote: 'Only your two-letter country code is sent.',
  isConfigured: () => true,
  async sync(ctx) {
    const country = (ctx.credentials.country?.trim() || ctx.locale.country || 'US').toUpperCase();
    const year = ctx.now.getFullYear();
    const years = ctx.now.getMonth() === 11 ? [year, year + 1] : [year];
    const out: ContextItem[] = [];
    for (const y of years) {
      const list = await fetchJson<NagerHoliday[]>(ctx.fetch, `https://date.nager.at/api/v3/PublicHolidays/${y}/${country}`, { label: 'Nager.Date' });
      const from = isoDate(addDays(ctx.now, -2));
      const to = isoDate(addDays(ctx.now, 45));
      for (const h of list) {
        if (h.date < from || h.date > to || !h.global) continue;
        out.push(item('holidays', `${country}:${h.date}`, 'holiday', h.localName || h.name, ctx.now.getTime(), { startsAt: h.date, allDay: true, subtitle: h.name !== h.localName ? h.name : undefined }));
      }
    }
    return out;
  },
};
