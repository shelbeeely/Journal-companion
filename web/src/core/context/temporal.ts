import { usualWindow } from '../insights';
import type { DeskUiPreferences, JournalEntry } from '../models';
import type { ContextItem } from '../sources/types';
import { formatTime, localDateIso, parseLocalDate, parseLocalDateTime } from '../time';

/**
 * Time of day and date as first-class context. Pure and deterministic for a given `now`, so every
 * moment gate can be unit-tested with a fixed clock.
 */

export type DayPart = 'early_morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'late_evening' | 'night';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface TimeReason {
  id: string;
  text: string;
}

export interface TemporalContext {
  now: Date;
  dateIso: string;
  dayName: string;
  part: DayPart;
  partLabel: string;
  /** Between wake and sleep hours. */
  awake: boolean;
  minutesSinceWake: number;
  /** Minutes until the user's bedtime (0 if past it). */
  minutesToSleep: number;
  /** The user's bedtime today as a Date. */
  bedtime: Date;
  isWorkday: boolean;
  isWeekend: boolean;
  holiday: string | null;
  holidayEve: string | null;
  /** Today's all-day calendar items (birthdays, trips, …). */
  allDay: string[];
  position: { startOfWeek: boolean; endOfWeek: boolean; startOfMonth: boolean; endOfMonth: boolean; endOfQuarter: boolean; endOfYear: boolean; newYear: boolean; daysLeftInMonth: number };
  season: Season;
  hemisphere: 'north' | 'south';
  moon: { phase: string; label: string; illumination: number; emoji: string };
  daylight: { sunrise: Date | null; sunset: Date | null; goldenHour: boolean; isDaylight: boolean | null; minutesToSunset: number | null };
  dst: { inDays: number; direction: 'forward' | 'back' } | null;
  travel: { traveling: boolean; homeZone: string | null; currentZone: string };
  anniversaries: string[];
  rhythm: { usualFinish: string | null; strongDays: string[] };
  /** Human-readable temporal facts, used as "From your clock & calendar" evidence. */
  reasons: TimeReason[];
}

const PART_LABEL: Record<DayPart, string> = {
  early_morning: 'Early morning',
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
  late_evening: 'Late evening',
  night: 'Night',
};

export function dayPart(now: Date, wakeHour: number, sleepHour: number): DayPart {
  const h = now.getHours() + now.getMinutes() / 60;
  const sinceWake = (h - wakeHour + 24) % 24;
  const awakeSpan = (sleepHour - wakeHour + 24) % 24 || 16;
  const toSleep = awakeSpan - sinceWake;
  if (sinceWake >= awakeSpan) return 'night';
  if (sinceWake < 1.5) return 'early_morning';
  // Checked before clock-based parts so a bedtime after midnight (e.g. 1 AM) still reads as late evening.
  if (toSleep <= 2) return 'late_evening';
  if (h < 12 && h >= wakeHour) return 'morning';
  if (h < 14 && h >= 12) return 'midday';
  if (h < 17 && h >= 14) return 'afternoon';
  return 'evening';
}

/** Moon phase via mean synodic month from a known new moon (good to ~a day). */
export function moonPhase(now: Date): TemporalContext['moon'] {
  const synodic = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14);
  const age = ((((now.getTime() - knownNew) / 86_400_000) % synodic) + synodic) % synodic;
  const illumination = Math.round(((1 - Math.cos((2 * Math.PI * age) / synodic)) / 2) * 100) / 100;
  const phases: [number, string, string, string][] = [
    [1.84566, 'new', 'New moon', '🌑'],
    [5.53699, 'waxing_crescent', 'Waxing crescent', '🌒'],
    [9.22831, 'first_quarter', 'First quarter', '🌓'],
    [12.91963, 'waxing_gibbous', 'Waxing gibbous', '🌔'],
    [16.61096, 'full', 'Full moon', '🌕'],
    [20.30228, 'waning_gibbous', 'Waning gibbous', '🌖'],
    [23.99361, 'last_quarter', 'Last quarter', '🌗'],
    [27.68493, 'waning_crescent', 'Waning crescent', '🌘'],
    [synodic + 1, 'new', 'New moon', '🌑'],
  ];
  const [, phase, label, emoji] = phases.find(([limit]) => age < limit)!;
  return { phase, label, illumination, emoji };
}

export function seasonFor(now: Date, hemisphere: 'north' | 'south'): Season {
  const m = now.getMonth(); // meteorological seasons
  const north: Season = m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
  if (hemisphere === 'north') return north;
  return ({ winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' } as const)[north];
}

/** Days until the next DST change within 3 days (offset comparison at local noon). */
export function upcomingDst(now: Date): TemporalContext['dst'] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTimezoneOffset();
  for (let i = 1; i <= 3; i++) {
    const off = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12).getTimezoneOffset();
    if (off !== base) return { inDays: i, direction: off < base ? 'forward' : 'back' };
  }
  return null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface TemporalInputs {
  now: Date;
  prefs: Pick<DeskUiPreferences, 'wakeHour' | 'sleepHour' | 'workdays' | 'weekStartsOn' | 'hemisphereOverride' | 'detectTravel' | 'homeTimeZone'>;
  items: ContextItem[];
  entries: JournalEntry[];
  latitude: number | null;
  timeZone?: string;
}

export function buildTemporalContext({ now, prefs, items, entries, latitude, timeZone }: TemporalInputs): TemporalContext {
  const dateIso = localDateIso(now);
  const dow = now.getDay();
  const part = dayPart(now, prefs.wakeHour, prefs.sleepHour);
  const wake = new Date(now.getFullYear(), now.getMonth(), now.getDate(), prefs.wakeHour);
  let bedtime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), prefs.sleepHour);
  if (prefs.sleepHour <= prefs.wakeHour) bedtime = new Date(bedtime.getTime() + 86_400_000); // bedtime after midnight
  const awake = part !== 'night';
  const minutesToSleep = Math.max(0, Math.round((bedtime.getTime() - now.getTime()) / 60_000));
  const minutesSinceWake = Math.max(0, Math.round((now.getTime() - wake.getTime()) / 60_000));
  const isWorkday = prefs.workdays.includes(dow);

  const tomorrowIso = localDateIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const holiday = items.find((i) => i.kind === 'holiday' && i.startsAt === dateIso)?.title ?? null;
  const holidayEve = items.find((i) => i.kind === 'holiday' && i.startsAt === tomorrowIso)?.title ?? null;
  const allDay = items
    .filter((i) => i.kind === 'event' && i.allDay && i.startsAt && i.startsAt <= dateIso && (i.endsAt ?? i.startsAt) > dateIso)
    .map((i) => i.title)
    .slice(0, 3);

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeftInMonth = daysInMonth - now.getDate();
  const weekEnd = (prefs.weekStartsOn + 6) % 7;
  const position = {
    startOfWeek: dow === prefs.weekStartsOn,
    endOfWeek: dow === weekEnd,
    startOfMonth: now.getDate() === 1,
    endOfMonth: daysLeftInMonth === 0,
    endOfQuarter: daysLeftInMonth === 0 && [2, 5, 8, 11].includes(now.getMonth()),
    endOfYear: now.getMonth() === 11 && now.getDate() >= 29,
    newYear: now.getMonth() === 0 && now.getDate() <= 2,
    daysLeftInMonth,
  };

  const hemisphere = prefs.hemisphereOverride ?? (latitude != null && latitude < 0 ? 'south' : 'north');
  const season = seasonFor(now, hemisphere);
  const moon = moonPhase(now);

  const today = items.find((i) => i.id === `weather:day:${dateIso}`);
  const sunrise = typeof today?.data?.sunrise === 'string' ? parseLocalDateTime(today.data.sunrise) : null;
  const sunset = typeof today?.data?.sunset === 'string' ? parseLocalDateTime(today.data.sunset) : null;
  const minutesToSunset = sunset && sunset > now ? Math.round((sunset.getTime() - now.getTime()) / 60_000) : null;
  const daylight = {
    sunrise,
    sunset,
    goldenHour: minutesToSunset != null && minutesToSunset <= 60,
    isDaylight: sunrise && sunset ? now >= sunrise && now < sunset : null,
    minutesToSunset,
  };

  const currentZone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const travel = { traveling: !!(prefs.detectTravel && prefs.homeTimeZone && prefs.homeTimeZone !== currentZone), homeZone: prefs.homeTimeZone, currentZone };
  const dst = upcomingDst(now);

  const anniversaries = items
    .filter((i) => (i.kind === 'memory' || i.kind === 'photo') && (i.data?.anniversary || i.subtitle?.includes('ago')))
    .map((i) => String(i.data?.anniversary && typeof i.data.anniversary === 'string' ? i.data.anniversary : i.subtitle ?? ''))
    .filter(Boolean)
    .slice(0, 3);

  const win = usualWindow(entries);
  const byDay = new Array(7).fill(0);
  entries.filter((e) => e.isCompleted).forEach((e) => {
    const d = parseLocalDate(e.dateIso);
    if (d) byDay[d.getDay()]++;
  });
  const strongDays = byDay
    .map((n, i) => [n, i] as const)
    .filter(([n]) => n >= 2)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 2)
    .map(([, i]) => DAY_NAMES[i]);
  const rhythm = { usualFinish: win ? formatTime(new Date(2000, 0, 1, win.hour, win.minute)) : null, strongDays };

  const reasons: TimeReason[] = [];
  reasons.push({ id: 'time:part', text: `${DAY_NAMES[dow]} ${PART_LABEL[part].toLowerCase()}${awake ? ` · ${minutesToSleep >= 60 ? `${Math.floor(minutesToSleep / 60)}h ${minutesToSleep % 60}m` : `${minutesToSleep}m`} until your ${formatTime(bedtime)} bedtime` : ''}` });
  reasons.push({ id: 'time:daytype', text: holiday ? `Public holiday: ${holiday}` : isWorkday ? 'Workday' : 'Day off' });
  if (holidayEve) reasons.push({ id: 'time:holiday-eve', text: `Tomorrow is ${holidayEve}` });
  if (position.endOfMonth) reasons.push({ id: 'time:eom', text: 'Last day of the month' });
  else if (position.startOfMonth) reasons.push({ id: 'time:som', text: 'First day of the month' });
  if (position.endOfYear) reasons.push({ id: 'time:eoy', text: 'The year is wrapping up' });
  if (position.endOfWeek) reasons.push({ id: 'time:eow', text: 'End of the week' });
  if (daylight.goldenHour) reasons.push({ id: 'time:golden', text: `Golden hour — sunset at ${formatTime(sunset!)}` });
  else if (minutesToSunset != null && minutesToSunset <= 180) reasons.push({ id: 'time:sunset', text: `Sunset at ${formatTime(sunset!)}` });
  if (dst) reasons.push({ id: 'time:dst', text: `Clocks go ${dst.direction} in ${dst.inDays} day${dst.inDays === 1 ? '' : 's'}` });
  if (travel.traveling) reasons.push({ id: 'time:travel', text: `Traveling — local time (${currentZone.split('/').pop()?.replace(/_/g, ' ')})` });
  if (moon.phase === 'full' || moon.phase === 'new') reasons.push({ id: 'time:moon', text: `${moon.emoji} ${moon.label}` });
  allDay.forEach((t, i) => reasons.push({ id: `time:allday:${i}`, text: `Today: ${t}` }));

  return {
    now,
    dateIso,
    dayName: DAY_NAMES[dow],
    part,
    partLabel: PART_LABEL[part],
    awake,
    minutesSinceWake,
    minutesToSleep,
    bedtime,
    isWorkday: isWorkday && !holiday,
    isWeekend: !isWorkday,
    holiday,
    holidayEve,
    allDay,
    position,
    season,
    hemisphere,
    moon,
    daylight,
    dst,
    travel,
    anniversaries,
    rhythm,
    reasons,
  };
}

/** Resolves friendly snooze choices against the user's day. */
export function snoozeUntil(choice: 'hour' | 'tonight' | 'tomorrow' | 'weekend', t: TemporalContext, prefs: { wakeHour: number; workdays: number[] }): number {
  const now = t.now;
  switch (choice) {
    case 'hour':
      return now.getTime() + 3_600_000;
    case 'tonight': {
      const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19);
      return evening > now ? evening.getTime() : now.getTime() + 3 * 3_600_000;
    }
    case 'tomorrow':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, prefs.wakeHour, 30).getTime();
    case 'weekend': {
      for (let i = 1; i <= 7; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, prefs.wakeHour + 2);
        if (!prefs.workdays.includes(d.getDay())) return d.getTime();
      }
      return now.getTime() + 2 * 86_400_000;
    }
  }
}
