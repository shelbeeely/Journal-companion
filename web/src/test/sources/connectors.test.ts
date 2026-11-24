import { describe, expect, it } from 'vitest';
import { appleCalendar, googleCalendar, holidays, icsCalendar, microsoftCalendar } from '../../core/sources/connectors/calendars';
import { dayOne, devicePhotos, journal, notesToItems, parseDayOne, shareTarget, unfinishedReasons } from '../../core/sources/connectors/local';
import { isoDurationMinutes, lastfm, raindrop, readwise, spotify, youtube } from '../../core/sources/connectors/media';
import { transitland } from '../../core/sources/connectors/places';
import { dropbox, github, googleDrive, googleTasks, habitica, microsoftTodo, oneDrive, todoist, trello } from '../../core/sources/connectors/work';
import { CONNECTORS } from '../../core/sources/registry';
import { SOURCE_META } from '../../core/sources/meta';
import { SourceError, type ConnectorContext, type SourceConnector } from '../../core/sources/types';

const NOW = new Date('2026-11-24T22:00:00Z'); // 2 PM in Seattle

type Route = [RegExp, unknown | ((url: string, init?: RequestInit) => unknown), number?];
function fakeFetch(routes: Route[], calls: { url: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes.find(([re]) => re.test(url));
    if (!r) return new Response('not found', { status: 404 });
    const body = typeof r[1] === 'function' ? (r[1] as (u: string, i?: RequestInit) => unknown)(url, init) : r[1];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: r[2] ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}
function ctx(routes: Route[], over: Partial<ConnectorContext> = {}, calls?: { url: string; init?: RequestInit }[]): ConnectorContext {
  return { fetch: fakeFetch(routes, calls), now: NOW, credentials: {}, config: {}, location: { lat: 47.61, lon: -122.33 }, locale: { country: 'US', language: 'en', timeZone: 'America/Los_Angeles' }, peers: [], accessToken: 'tok', ...over };
}
async function expectAuthError(c: SourceConnector, over: Partial<ConnectorContext>) {
  await expect(c.sync(ctx([[/.*/, { error: 'unauthorized' }, 401]], over))).rejects.toMatchObject({ kind: 'auth' });
}

describe('registry', () => {
  it('has unique ids, metadata parity, and honest privacy notes', () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(SOURCE_META).sort()).toEqual([...ids].sort());
    for (const c of CONNECTORS) {
      expect(SOURCE_META[c.id]).toEqual({ label: c.label, ttlMs: c.ttlMs });
      expect(c.privacyNote.length, c.id).toBeGreaterThan(10);
      if (c.auth) expect(c.scopes?.length, c.id).toBeGreaterThan(0);
    }
    expect(CONNECTORS.length).toBeGreaterThanOrEqual(38);
  });
});

describe('calendar connectors', () => {
  it('Google Calendar: selected calendars, timed + all-day, skips cancelled', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const items = await googleCalendar.sync(
      ctx(
        [
          [/calendarList/, { items: [{ id: 'primary@x', summary: 'Me', primary: true }, { id: 'hidden', selected: false }] }],
          [/calendars\/primary%40x\/events/, { items: [{ id: 'e1', summary: 'Coffee', location: 'Cafe', start: { dateTime: '2026-11-24T15:30:00-08:00' }, end: { dateTime: '2026-11-24T16:30:00-08:00' }, htmlLink: 'https://g/e1' }, { id: 'e2', status: 'cancelled', start: { dateTime: 'x' } }, { id: 'e3', summary: 'Trip', start: { date: '2026-11-27' }, end: { date: '2026-11-29' } }] }],
        ],
        {},
        calls,
      ),
    );
    expect(items.map((i) => [i.title, i.allDay])).toEqual([['Coffee', false], ['Trip', true]]);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(calls).toHaveLength(2); // hidden calendar not fetched
    await expectAuthError(googleCalendar, {});
  });

  it('Outlook: UTC normalisation and all-day', async () => {
    const items = await microsoftCalendar.sync(ctx([[/calendarView/, { value: [{ id: 'm1', subject: 'Standup', start: { dateTime: '2026-11-25T17:30:00.0000000' }, end: { dateTime: '2026-11-25T17:45:00.0000000' } }, { id: 'm2', subject: 'Holiday', isAllDay: true, start: { dateTime: '2026-11-26T00:00:00.0000000' }, end: { dateTime: '2026-11-27T00:00:00.0000000' } }, { id: 'm3', isCancelled: true, start: { dateTime: 'x' } }] }]]));
    expect(items[0].startsAt).toBe('2026-11-25T17:30:00Z');
    expect(items[1]).toMatchObject({ allDay: true, startsAt: '2026-11-26' });
    expect(items).toHaveLength(2);
  });

  it('Apple iCloud link and .ics file/URL go through the ICS engine; CORS gets a helpful message', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261124T233000Z\r\nDTEND:20261125T003000Z\r\nSUMMARY:Coffee\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const apple = await appleCalendar.sync(ctx([[/icloud\.com/, ics]], { credentials: { url: 'webcal://p01-caldav.icloud.com/published/2/x' } }));
    expect(apple[0]).toMatchObject({ title: 'Coffee', subtitle: 'iCloud' });
    await expect(appleCalendar.sync(ctx([], { credentials: { url: 'https://example.com/cal.ics' } }))).rejects.toMatchObject({ kind: 'config' });
    const file = await icsCalendar.sync(ctx([], { config: { fileText: ics, fileName: 'work.ics' } }));
    expect(file[0].subtitle).toBe('work.ics');
    const corsFetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(icsCalendar.sync({ ...ctx([]), fetch: corsFetch, credentials: { url: 'https://cal.example/x.ics' } })).rejects.toThrow(/import it instead/);
  });

  it('holidays: country from locale, window + global only', async () => {
    const calls: { url: string }[] = [];
    const items = await holidays.sync(ctx([[/PublicHolidays\/2026\/US/, [{ date: '2026-11-26', localName: 'Thanksgiving Day', name: 'Thanksgiving Day', global: true }, { date: '2026-11-27', localName: 'Regional', name: 'Regional', global: false }, { date: '2026-01-01', localName: 'New Year', name: 'x', global: true }]]], {}, calls));
    expect(items.map((i) => i.title)).toEqual(['Thanksgiving Day']);
  });
});

describe('task & project connectors', () => {
  it('Google Tasks: open + completed today only', async () => {
    const items = await googleTasks.sync(ctx([[/users\/@me\/lists/, { items: [{ id: 'L', title: 'Personal' }] }], [/lists\/L\/tasks/, { items: [{ id: 't1', title: 'Buy flowers', status: 'needsAction', due: '2026-11-24T00:00:00.000Z' }, { id: 't2', title: 'Old', status: 'completed', completed: '2026-11-20T10:00:00Z' }, { id: 't3', title: 'Invoice', status: 'completed', completed: '2026-11-24T19:00:00Z' }] }]]));
    expect(items.map((i) => [i.title, i.done])).toEqual([['Buy flowers', false], ['Invoice', true]]);
    expect(items[0].startsAt).toBe('2026-11-24');
  });

  it('Microsoft To Do', async () => {
    const items = await microsoftTodo.sync(ctx([[/todo\/lists$/, { value: [{ id: 'L1', displayName: 'Tasks' }] }], [/todo\/lists\/L1\/tasks/, { value: [{ id: 'x', title: 'Call bank', status: 'notStarted', importance: 'high', dueDateTime: { dateTime: '2026-11-24T00:00:00.0000000' } }] }]]));
    expect(items[0]).toMatchObject({ title: 'Call bank', startsAt: '2026-11-24', data: { important: true } });
  });

  it('Todoist v1: tasks, projects, completed today; token only goes to Todoist', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const items = await todoist.sync(
      ctx(
        [
          [/\/api\/v1\/tasks\/completed/, { items: [{ id: '9', content: 'Send invoice', completed_at: '2026-11-24T19:00:00Z' }] }],
          [/\/api\/v1\/tasks\?/, { results: [{ id: '1', content: 'Bring Sam the book', project_id: 'p', due: { date: '2026-11-24' } }] }],
          [/\/api\/v1\/projects/, { results: [{ id: 'p', name: 'Personal' }] }],
        ],
        { credentials: { token: 'secret' }, accessToken: null },
        calls,
      ),
    );
    expect(items.find((i) => i.title === 'Bring Sam the book')?.subtitle).toBe('Personal');
    expect(items.find((i) => i.title === 'Send invoice')?.done).toBe(true);
    expect(items.find((i) => i.kind === 'project')?.data?.openTasks).toBe(1);
    expect(calls.every((c) => c.url.startsWith('https://api.todoist.com/'))).toBe(true);
    await expect(todoist.sync(ctx([], { credentials: {} }))).rejects.toMatchObject({ kind: 'config' });
    await expectAuthError(todoist, { credentials: { token: 'bad' } });
  });

  it('Trello: assigned cards + recently active boards', async () => {
    const items = await trello.sync(ctx([[/members\/me\/cards/, [{ id: 'c', name: 'Draft talk', idBoard: 'b', due: '2026-11-25T17:00:00Z', dueComplete: false }]], [/members\/me\/boards/, [{ id: 'b', name: 'Conference', dateLastActivity: '2026-11-20T10:00:00Z' }, { id: 'old', name: 'Old', dateLastActivity: '2025-01-01T00:00:00Z' }]]], { credentials: { key: 'k', token: 't' } }));
    expect(items.map((i) => `${i.kind}:${i.title}`)).toEqual(['task:Draft talk', 'project:Conference']);
  });

  it('GitHub: assigned issues + recently pushed repos', async () => {
    const items = await github.sync(ctx([[/\/issues\?/, [{ id: 1, number: 7, title: 'Fix login', html_url: 'h', updated_at: '2026-11-23T00:00:00Z', repository: { full_name: 'me/app' } }]], [/\/user\/repos/, [{ id: 2, name: 'novel-tools', full_name: 'me/novel-tools', html_url: 'r', pushed_at: '2026-11-10T00:00:00Z' }]]], { credentials: { token: 'ghp' } }));
    expect(items.map((i) => i.title)).toEqual(['Fix login', 'novel-tools']);
    expect(items[0].subtitle).toBe('me/app #7');
  });

  it('Habitica: dailies/habits with the required x-client header', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const items = await habitica.sync(ctx([[/habitica/, { data: [{ id: 'd', type: 'daily', text: 'Stretch', completed: false, isDue: true, streak: 4 }, { id: 'r', type: 'reward', text: 'Cake' }] }]], { credentials: { userId: 'u1', apiToken: 'k' } }, calls));
    expect(items).toHaveLength(1);
    expect((calls[0].init?.headers as Record<string, string>)['x-client']).toBe('u1-JournalCompanion');
  });
});

describe('files, media & reading connectors', () => {
  it('Drive / OneDrive / Dropbox metadata only', async () => {
    const drive = await googleDrive.sync(ctx([[/drive\/v3\/files/, { files: [{ id: 'f', name: 'Novel outline', modifiedTime: '2026-11-22T00:00:00Z' }] }]]));
    expect(drive[0]).toMatchObject({ kind: 'file', title: 'Novel outline' });
    const od = await oneDrive.sync(ctx([[/drive\/recent/, { value: [{ id: 'o', name: 'Budget.xlsx', lastModifiedDateTime: '2026-11-23T00:00:00Z' }] }]]));
    expect(od[0].title).toBe('Budget.xlsx');
    const db = await dropbox.sync(ctx([[/list_folder/, { entries: [{ '.tag': 'file', id: 'id:1', name: 'chapter3.md', server_modified: '2026-11-21T00:00:00Z' }, { '.tag': 'folder', id: 'id:2', name: 'x' }, { '.tag': 'file', id: 'id:3', name: 'old.md', server_modified: '2025-01-01T00:00:00Z' }] }]]));
    expect(db.map((i) => i.title)).toEqual(['chapter3.md']);
  });

  it('YouTube: subscriptions → uploads with durations', async () => {
    expect(isoDurationMinutes('PT1H2M30S')).toBe(63);
    const items = await youtube.sync(
      ctx([
        [/subscriptions/, { items: [{ snippet: { resourceId: { channelId: 'C1' }, title: 'Chan' } }] }],
        [/channels/, { items: [{ id: 'C1', contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }],
        [/playlistItems/, { items: [{ snippet: { title: 'Short film', channelTitle: 'Chan', publishedAt: '2026-11-23T00:00:00Z' }, contentDetails: { videoId: 'v1' } }] }],
        [/videos\?/, { items: [{ id: 'v1', contentDetails: { duration: 'PT12M' } }] }],
      ]),
    );
    expect(items[0]).toMatchObject({ kind: 'video', title: 'Short film', data: { runtime: 12 } });
  });

  it('Spotify (incl. 204 no-content) and Last.fm', async () => {
    const sp = await spotify.sync(ctx([[/recently-played/, { items: [{ played_at: '2026-11-24T18:00:00Z', track: { id: 't', name: 'Motion Sickness', duration_ms: 230000, artists: [{ name: 'Phoebe Bridgers' }] } }] }], [/currently-playing/, '', 204]]));
    expect(sp[0]).toMatchObject({ title: 'Motion Sickness', data: { artist: 'Phoebe Bridgers' } });
    const lf = await lastfm.sync(ctx([[/getrecenttracks/, { recenttracks: { track: [{ name: 'Song', artist: { '#text': 'Band' }, '@attr': { nowplaying: 'true' } }, { name: 'Older', artist: { '#text': 'Band' }, date: { uts: '1764000000' } }] } }]], { credentials: { username: 'me', apiKey: 'k' } }));
    expect(lf[0].data?.nowPlaying).toBe(true);
  });

  it('Raindrop, Readwise and Transitland', async () => {
    const rd = await raindrop.sync(ctx([[/raindrops/, { items: [{ _id: 1, title: 'On slow mornings', link: 'https://x', created: '2026-11-10T00:00:00Z' }] }]], { credentials: { token: 't' } }));
    expect(rd[0].kind).toBe('link');
    const calls: { url: string; init?: RequestInit }[] = [];
    const rw = await readwise.sync(ctx([[/readwise/, { highlights: [{ id: 1, text: 'Short assignments.', title: 'Bird by Bird', author: 'Anne Lamott' }] }]], { credentials: { token: 'r' } }, calls));
    expect(rw[0].data?.text).toBe('Short assignments.');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Token r');
    const tl = await transitland.sync(ctx([[/rest\/stops\?/, { stops: [{ onestop_id: 's-1', stop_name: '3rd & Pike' }] }], [/departures/, { stops: [{ departures: [{ departure: { scheduled: '14:12:00' }, trip: { trip_headsign: 'Ballard', route: { route_short_name: 'D' } } }] }] }]], { credentials: { apiKey: 'k' } }));
    expect(tl[0]).toMatchObject({ title: 'D → Ballard', subtitle: '3rd & Pike' });
  });
});

describe('on-device connectors', () => {
  it('journal: unfinished drafts, anniversaries and project activity', async () => {
    const project = { id: 1, title: 'Evening Pages', writingGoal: 'g', cadence: 'DAILY' } as never;
    const e = (id: number, dateIso: string, draftText: string, isCompleted = true) => ({ id, projectId: 1, dateIso, promptText: 'p', promptTopicTag: 't', hints: [], draftText, isCompleted, completedAtEpochMs: null, updatedAtEpochMs: 0 });
    const items = await journal.sync(ctx([], { config: { snapshot: { projects: [project], entries: [e(1, '2026-11-22', 'I keep thinking about the move and'), e(2, '2025-11-24', 'First snow.'), e(3, '2026-11-24', 'today')] } } }));
    expect(items.find((i) => i.kind === 'thought')?.data?.reasons).toEqual(['trails off without an ending']);
    expect(items.find((i) => i.kind === 'memory')?.subtitle).toContain('One year ago');
    expect(items.find((i) => i.kind === 'project')?.data?.lastActivity).toBe('2026-11-24');
  });

  it('unfinished-thought heuristics and notes', () => {
    expect(unfinishedReasons('Where was I going with…')).toEqual(['ends mid-thought']);
    expect(unfinishedReasons('- [ ] call mom\nDone.')).toEqual(['has open checkboxes']);
    expect(unfinishedReasons('A complete sentence.')).toEqual([]);
    const notes = notesToItems([{ name: 'Ideas', path: 'notes/Ideas.md', text: '---\ntags: x\n---\n# Ideas\n- [ ] outline\nthe lighthouse keeper and', lastModified: NOW.getTime() }], NOW);
    expect(notes[0]).toMatchObject({ subtitle: 'notes', data: { openTasks: 1 } });
    expect((notes[0].data!.reasons as string[]).length).toBeGreaterThan(0);
  });

  it('Day One import, share target and device photos', async () => {
    expect(() => parseDayOne({ nope: true })).toThrow(SourceError);
    const entries = parseDayOne({ entries: [{ uuid: 'u', creationDate: '2024-11-24T09:00:00Z', text: 'Snow day ![](dayone-moment://x)', location: { placeName: 'Home' } }] });
    const mem = await dayOne.sync(ctx([], { config: { entries } }));
    expect(mem[0].subtitle).toBe('2 years ago · Home');
    const shared = await shareTarget.sync(ctx([], { config: { thoughts: [{ id: 's', at: NOW.getTime() - 3600_000, title: 'Essay', url: 'https://x' }, { id: 'old', at: NOW.getTime() - 40 * 86_400_000 }] } }));
    expect(shared.map((i) => i.title)).toEqual(['Essay']);
    const photos = await devicePhotos.sync(ctx([], { config: { photos: [{ id: 'p', name: 'Beach', takenAt: '2025-11-24T20:00:00Z', addedAt: 0, thumb: 'data:' }] } }));
    expect(photos[0].subtitle).toBe('One year ago today');
  });
});
