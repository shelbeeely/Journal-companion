/**
 * Small, dependency-free iCalendar (RFC 5545) reader for the calendar connectors.
 * Supports VEVENT with UTC / TZID / floating / all-day times, DURATION, RRULE
 * (DAILY, WEEKLY, MONTHLY, YEARLY with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY),
 * EXDATE, RECURRENCE-ID overrides and STATUS:CANCELLED.
 */

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  /** ISO instant for timed events; YYYY-MM-DD for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  recurring: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface WallTime {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}

interface DateValue {
  wall: WallTime;
  allDay: boolean;
  /** 'UTC', an IANA zone, or null for floating (device local). */
  zone: string | null;
}

// Common Windows zone names Outlook writes into TZID.
const WINDOWS_ZONES: Record<string, string> = {
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'E. Europe Standard Time': 'Europe/Bucharest',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'UTC',
};

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseProp(line: string): Prop | null {
  // Split at the first ':' that isn't inside a quoted parameter value.
  let inQuote = false;
  let idx = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [name, ...paramParts] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function normalizeZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const clean = tzid.replace(/^\/+/, '');
  const mapped = WINDOWS_ZONES[clean] ?? clean;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: mapped });
    return mapped;
  } catch {
    return null; // unknown zone → treat as floating local time
  }
}

function parseDateValue(p: Prop): DateValue | null {
  const v = p.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const allDay = p.params.VALUE === 'DATE' || m[4] == null;
  const wall: WallTime = { y: +m[1], m: +m[2], d: +m[3], h: allDay ? 0 : +m[4], mi: allDay ? 0 : +m[5], s: allDay ? 0 : +(m[6] ?? 0) };
  const zone = allDay ? null : m[7] ? 'UTC' : normalizeZone(p.params.TZID);
  return { wall, allDay, zone };
}

/** Offset (ms) of `zone` from UTC at the given instant. */
function zoneOffset(utcMs: number, zone: string): number {
  if (zone === 'UTC') return 0;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a wall-clock time in `zone` (or device local when null) to epoch ms. */
export function wallToEpoch(w: WallTime, zone: string | null): number {
  if (zone == null) return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime();
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  const first = guess - zoneOffset(guess, zone);
  // Re-check at the result so DST transitions resolve correctly.
  return guess - zoneOffset(first, zone);
}

function wallAddDays(w: WallTime, days: number): WallTime {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + days, w.h, w.mi, w.s));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: w.h, mi: w.mi, s: w.s };
}

function wallDow(w: WallTime): number {
  return new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseDurationMs(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const [w, d, h, mi, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => +(x ?? 0));
  return sign * ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

const DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: number;
  byDay?: { dow: number; nth?: number }[];
  byMonthDay?: number[];
}

function parseRRule(v: string, zone: string | null): RRule | null {
  const parts = Object.fromEntries(v.split(';').map((kv) => kv.split('=') as [string, string]));
  const freq = parts.FREQ as RRule['freq'];
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const rule: RRule = { freq, interval: Math.max(1, +(parts.INTERVAL ?? 1)) };
  if (parts.COUNT) rule.count = +parts.COUNT;
  if (parts.UNTIL) {
    const dv = parseDateValue({ name: 'UNTIL', params: {}, value: parts.UNTIL });
    if (dv) rule.until = dv.allDay ? wallToEpoch({ ...dv.wall, h: 23, mi: 59, s: 59 }, zone) : wallToEpoch(dv.wall, dv.zone ?? zone);
  }
  if (parts.BYDAY) {
    rule.byDay = parts.BYDAY.split(',')
      .map((t) => /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(t.trim()))
      .filter((x): x is RegExpExecArray => !!x)
      .map((x) => ({ dow: DOW[x[2]], nth: x[1] ? +x[1] : undefined }));
  }
  if (parts.BYMONTHDAY) rule.byMonthDay = parts.BYMONTHDAY.split(',').map(Number).filter((n) => !Number.isNaN(n));
  return rule;
}

/** Candidate wall-clock dates in one period of the rule (sorted). */
function periodDates(rule: RRule, anchor: WallTime, periodStart: WallTime): WallTime[] {
  const t = { h: anchor.h, mi: anchor.mi, s: anchor.s };
  if (rule.freq === 'DAILY') return [{ ...periodStart, ...t }];
  if (rule.freq === 'WEEKLY') {
    const days = rule.byDay?.map((b) => b.dow) ?? [wallDow(anchor)];
    // periodStart is the week's Monday-aligned start (we align to anchor's week start = Monday).
    return days
      .map((dow) => wallAddDays(periodStart, (dow + 6) % 7))
      .map((w) => ({ ...w, ...t }))
      .sort((a, b) => Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d));
  }
  const y = periodStart.y;
  const m = periodStart.m;
  const dim = daysInMonth(y, m);
  const out: WallTime[] = [];
  const push = (d: number) => {
    if (d >= 1 && d <= dim) out.push({ y, m, d, ...t });
  };
  if (rule.freq === 'MONTHLY' || (rule.freq === 'YEARLY' && m === anchor.m)) {
    if (rule.byMonthDay?.length) rule.byMonthDay.forEach((md) => push(md < 0 ? dim + md + 1 : md));
    else if (rule.byDay?.length) {
      for (const b of rule.byDay) {
        const matches: number[] = [];
        for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.dow) matches.push(d);
        if (b.nth == null) matches.forEach(push);
        else push(b.nth > 0 ? matches[b.nth - 1] : matches[matches.length + b.nth]);
      }
    } else push(anchor.d);
  }
  return out.sort((a, b) => a.d - b.d);
}

function nextPeriod(rule: RRule, p: WallTime): WallTime {
  switch (rule.freq) {
    case 'DAILY':
      return wallAddDays(p, rule.interval);
    case 'WEEKLY':
      return wallAddDays(p, 7 * rule.interval);
    case 'MONTHLY': {
      const t = new Date(Date.UTC(p.y, p.m - 1 + rule.interval, 1));
      return { ...p, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: 1 };
    }
    case 'YEARLY':
      return { ...p, y: p.y + rule.interval, d: 1 };
  }
}

function firstPeriod(rule: RRule, anchor: WallTime): WallTime {
  if (rule.freq === 'WEEKLY') return wallAddDays({ ...anchor }, -((wallDow(anchor) + 6) % 7));
  if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') return { ...anchor, d: 1 };
  return anchor;
}

interface RawEvent {
  props: Map<string, Prop[]>;
}

const get = (e: RawEvent, n: string) => e.props.get(n)?.[0];

function wallToOutput(w: WallTime, allDay: boolean, zone: string | null): string {
  if (allDay) return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
  return new Date(wallToEpoch(w, zone)).toISOString();
}

/** Parses an .ics document and returns occurrences overlapping [from, to]. */
export function parseIcs(text: string, from: Date, to: Date, maxOccurrencesPerEvent = 400): IcsEvent[] {
  const lines = unfold(text);
  const raw: RawEvent[] = [];
  let cur: RawEvent | null = null;
  let depth = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line === 'BEGIN:VEVENT') {
      cur = { props: new Map() };
      depth = 0;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur) raw.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    // Skip nested components like VALARM.
    if (line.startsWith('BEGIN:')) {
      depth++;
      continue;
    }
    if (line.startsWith('END:')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    const p = parseProp(line);
    if (!p) continue;
    const arr = cur.props.get(p.name) ?? [];
    arr.push(p);
    cur.props.set(p.name, arr);
  }

  const fromMs = from.getTime();
  const toMs = to.getTime();
  const overrides = new Map<string, Set<number>>();
  for (const e of raw) {
    const rid = get(e, 'RECURRENCE-ID');
    const uid = get(e, 'UID')?.value ?? '';
    if (rid) {
      const dv = parseDateValue(rid);
      if (dv) {
        const set = overrides.get(uid) ?? new Set();
        set.add(dv.allDay ? wallToEpoch(dv.wall, null) : wallToEpoch(dv.wall, dv.zone));
        overrides.set(uid, set);
      }
    }
  }

  const out: IcsEvent[] = [];
  for (const e of raw) {
    if (get(e, 'STATUS')?.value.toUpperCase() === 'CANCELLED') continue;
    const dtStartProp = get(e, 'DTSTART');
    if (!dtStartProp) continue;
    const start = parseDateValue(dtStartProp);
    if (!start) continue;
    const uid = get(e, 'UID')?.value ?? `${dtStartProp.value}-${get(e, 'SUMMARY')?.value ?? ''}`;
    const dtEnd = get(e, 'DTEND');
    const endDv = dtEnd ? parseDateValue(dtEnd) : null;
    const startMs = start.allDay ? wallToEpoch(start.wall, null) : wallToEpoch(start.wall, start.zone);
    let durationMs: number;
    if (endDv) durationMs = (endDv.allDay ? wallToEpoch(endDv.wall, null) : wallToEpoch(endDv.wall, endDv.zone)) - startMs;
    else {
      const dur = get(e, 'DURATION');
      durationMs = (dur && parseDurationMs(dur.value)) ?? (start.allDay ? 86_400_000 : 0);
    }
    const base = {
      uid,
      summary: unescapeText(get(e, 'SUMMARY')?.value ?? 'Untitled event'),
      description: get(e, 'DESCRIPTION') ? unescapeText(get(e, 'DESCRIPTION')!.value).slice(0, 500) : undefined,
      location: get(e, 'LOCATION') ? unescapeText(get(e, 'LOCATION')!.value) : undefined,
      url: get(e, 'URL')?.value,
      allDay: start.allDay,
    };

    const emit = (w: WallTime, recurring: boolean) => {
      const sMs = start.allDay ? wallToEpoch(w, null) : wallToEpoch(w, start.zone);
      const eMs = sMs + Math.max(0, durationMs);
      if (eMs < fromMs || sMs > toMs) return;
      const endWall = start.allDay ? wallAddDays(w, Math.max(1, Math.round(durationMs / 86_400_000))) : null;
      out.push({
        ...base,
        recurring,
        start: wallToOutput(w, start.allDay, start.zone),
        end: start.allDay ? wallToOutput(endWall!, true, null) : new Date(eMs).toISOString(),
      });
    };

    const rruleProp = get(e, 'RRULE');
    const isOverride = !!get(e, 'RECURRENCE-ID');
    if (!rruleProp || isOverride) {
      emit(start.wall, isOverride);
      continue;
    }
    const rule = parseRRule(rruleProp.value, start.zone);
    if (!rule) {
      emit(start.wall, false);
      continue;
    }
    const exdates = new Set<number>();
    for (const ex of e.props.get('EXDATE') ?? []) {
      for (const v of ex.value.split(',')) {
        const dv = parseDateValue({ ...ex, value: v });
        if (dv) exdates.add(dv.allDay ? wallToEpoch(dv.wall, null) : wallToEpoch(dv.wall, dv.zone ?? start.zone));
      }
    }
    const skip = overrides.get(uid) ?? new Set<number>();
    let period = firstPeriod(rule, start.wall);
    let produced = 0;
    let guard = 0;
    outer: while (guard++ < 5000) {
      for (const w of periodDates(rule, start.wall, period)) {
        const ms = start.allDay ? wallToEpoch(w, null) : wallToEpoch(w, start.zone);
        if (ms < startMs) continue;
        if (rule.until != null && ms > rule.until) break outer;
        if (rule.count != null && produced >= rule.count) break outer;
        produced++;
        if (ms > toMs) break outer;
        if (exdates.has(ms) || skip.has(ms)) continue;
        emit(w, true);
        if (out.length > maxOccurrencesPerEvent * raw.length) break outer;
      }
      period = nextPeriod(rule, period);
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** webcal:// → https:// (iCloud and many calendar apps publish webcal links). */
export function normalizeCalendarUrl(url: string): string {
  return url.trim().replace(/^webcals?:\/\//i, 'https://');
}
