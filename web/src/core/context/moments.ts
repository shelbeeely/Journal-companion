import type { JournalEntry, JournalProject } from '../models';
import { SOURCE_META, sourceLabel } from '../sources/meta';
import type { ContextItem, SourceState } from '../sources/types';
import type { TaskKind } from '../taskContext';
import { daysBetween, formatTime, localDateIso, parseLocalDate, parseLocalDateTime } from '../time';
import { mapWmoCodeToCondition } from '../weather';
import type { TemporalContext } from './temporal';

/**
 * Detects life moments and composes cross-source suggestions. Pure: given the same inputs it
 * returns the same suggestions, and every reason it gives points at a real piece of evidence.
 */

export type MomentKind = 'plan_day' | 'outing' | 'watch' | 'episode_tonight' | 'resume' | 'resume_reading' | 'reflect' | 'unfinished' | 'resurface';

export const MOMENT_LABELS: Record<MomentKind, string> = {
  plan_day: 'Plan the day',
  outing: 'Heading out',
  watch: 'Something to watch',
  episode_tonight: 'New episode',
  resume: 'Pick a project back up',
  resume_reading: 'Back to your book',
  reflect: 'Reflect on today',
  unfinished: 'Unfinished thought',
  resurface: 'On this day',
};

export interface Evidence {
  /** Item id, or a temporal reason id (`time:*`). */
  id: string;
  sourceId: string;
  /** Source name shown on the badge. */
  sourceLabel: string;
  text: string;
  fetchedAt?: number;
  /** data = from a connected source; time = from the clock & calendar. AI text is never evidence. */
  origin: 'data' | 'time';
  stale?: boolean;
}

export interface MissingSource {
  sourceId: string;
  text: string;
}

export interface SuggestionAction {
  label: string;
  name: 'reflect' | 'open_project' | 'open_url' | 'start_focus' | 'mark_done' | 'add_note' | 'connect_source' | 'refresh_source' | 'dismiss' | 'open_today';
  value?: string;
}

/** Structured content the A2UI moment agent turns into components. Every field is optional. */
export interface SuggestionSections {
  event?: { title: string; time: string; place?: string; leaveBy?: string; travel?: string; url?: string };
  hourly?: { label: string; points: { time: string; temp: number; pop: number | null; condition: string }[]; note?: string };
  checklist?: { title: string; items: { text: string; source: string; done: boolean }[] };
  media?: { title: string; picks: { title: string; meta: string; fits: string; providers: string; url?: string; image?: string; source: string }[] };
  memory?: { quote: string; attribution: string };
  project?: { title: string; lastActivity: string; excerpt?: string; nextStep?: string; files?: string[] };
  timeline?: { title: string; rows: { time: string; text: string; source: string; kind: string }[] };
  extras?: { title: string; lines: { text: string; source: string }[] };
  prompt?: string;
}

export interface Suggestion {
  key: string;
  moment: MomentKind;
  title: string;
  summary: string;
  /** 0–100 before ranking. */
  priority: number;
  window: { from: number; to: number } | null;
  evidence: Evidence[];
  reasons: string[];
  missing: MissingSource[];
  sections: SuggestionSections;
  actions: SuggestionAction[];
  aiNote?: string;
}

export interface MomentInputs {
  temporal: TemporalContext;
  /** Items from sources enabled for suggestions. */
  items: ContextItem[];
  states: Record<string, SourceState>;
  enabled: Set<string>;
  journal: { projects: JournalProject[]; entries: JournalEntry[]; todayEntry: JournalEntry | null; activeProjectId: number | null };
  task: TaskKind;
  /** A quick ask from the user ("Heading out", "What to watch", "Plan my day"). */
  requested?: MomentKind | null;
  disabled?: string[];
  hasLocation: boolean;
}

/* ----------------------------------- helpers ----------------------------------- */

const label = sourceLabel;
const t = (iso?: string) => (iso ? (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? parseLocalDate(iso) : new Date(iso)) : null);
const timeOf = (iso?: string) => {
  const d = t(iso);
  return d && iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatTime(d) : 'All day';
};
const STOP = new Set(['with', 'from', 'that', 'this', 'about', 'into', 'your', 'their', 'have', 'will', 'meeting', 'call', 'event', 'session', 'notes', 'draft', 'todo']);
/** Meaningful terms: words of 4+ letters (minus filler) plus capitalized names of 3+ letters (e.g. “Sam”). */
const words = (s: string) => {
  const out = new Set<string>();
  for (const raw of s.split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.toLowerCase();
    if ((w.length >= 4 && !STOP.has(w)) || (raw.length >= 3 && /^\p{Lu}/u.test(raw) && !STOP.has(w))) out.add(w);
  }
  return out;
};
const overlaps = (a: string, b: string) => {
  const wa = words(a);
  for (const w of words(b)) if (wa.has(w)) return true;
  return false;
};

function isStale(inp: MomentInputs, sourceId: string): boolean {
  const st = inp.states[sourceId];
  if (!st) return false;
  if (st.status === 'stale' || st.status === 'needs_reauth') return true;
  const ttl = SOURCE_META[sourceId]?.ttlMs ?? 3_600_000;
  return !!st.lastSyncAt && inp.temporal.now.getTime() - st.lastSyncAt > ttl * 3;
}

function ev(inp: MomentInputs, it: ContextItem, text?: string): Evidence {
  return { id: it.id, sourceId: it.sourceId, sourceLabel: label(it.sourceId), text: text ?? it.title, fetchedAt: it.fetchedAt, origin: 'data', stale: isStale(inp, it.sourceId) };
}

function timeEv(inp: MomentInputs, id: string): Evidence | null {
  const r = inp.temporal.reasons.find((x) => x.id === id || x.id.startsWith(id));
  return r ? { id: r.id, sourceId: 'clock', sourceLabel: 'Clock & calendar', text: r.text, origin: 'time' } : null;
}

function missing(inp: MomentInputs, sourceIds: string[], text: string): MissingSource[] {
  return sourceIds.some((id) => inp.enabled.has(id) && inp.states[id]?.status !== 'disconnected' && inp.states[id]?.status !== 'error') ? [] : [{ sourceId: sourceIds[0], text }];
}

const CAL = ['calendar_google', 'calendar_microsoft', 'calendar_apple', 'calendar_ics'];
const TASKS = ['tasks_google', 'tasks_microsoft', 'tasks_todoist', 'tasks_trello', 'projects_github', 'habits_habitica'];

function events(inp: MomentInputs) {
  return inp.items.filter((i) => i.kind === 'event' && i.startsAt);
}
function timedToday(inp: MomentInputs) {
  const day = inp.temporal.dateIso;
  return events(inp)
    .filter((e) => !e.allDay && localDateIso(new Date(e.startsAt!)) === day)
    .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
}

interface HourPoint {
  t: string;
  temp: number;
  pop: number | null;
  code: number;
}
function hourly(inp: MomentInputs): { item: ContextItem; hours: HourPoint[] } | null {
  const it = inp.items.find((i) => i.id === 'weather:hourly');
  const hours = it?.data?.hours as HourPoint[] | undefined;
  return it && hours?.length ? { item: it, hours } : null;
}
function hoursBetween(h: HourPoint[], from: Date, to: Date): HourPoint[] {
  return h.filter((p) => {
    const d = parseLocalDateTime(p.t);
    return d && d.getTime() >= from.getTime() - 3_600_000 && d.getTime() <= to.getTime();
  });
}
const hourPoint = (p: HourPoint) => ({ time: formatTime(parseLocalDateTime(p.t)!), temp: Math.round(p.temp), pop: p.pop, condition: mapWmoCodeToCondition(p.code) });

function rainNote(points: HourPoint[]): string | null {
  const wet = points.filter((p) => (p.pop ?? 0) >= 50);
  if (!wet.length) return null;
  const first = parseLocalDateTime(wet[0].t)!;
  return `${Math.max(...wet.map((p) => p.pop ?? 0))}% chance of rain from ${formatTime(first)}`;
}

function memoryMentioning(inp: MomentInputs, needles: string[]): JournalEntry | null {
  const terms = needles.flatMap((n) => [...words(n)]);
  if (!terms.length) return null;
  return (
    [...inp.journal.entries]
      .filter((e) => e.dateIso !== inp.temporal.dateIso && e.draftText.trim())
      .sort((a, b) => b.dateIso.localeCompare(a.dateIso))
      .find((e) => {
        const ew = words(e.draftText);
        return terms.some((t) => ew.has(t));
      }) ?? null
  );
}

function namesIn(title: string): string[] {
  const m = /\bwith ([A-Z][\p{L}'-]+(?: [A-Z][\p{L}'-]+)?)/u.exec(title);
  return m ? [m[1]] : [];
}

const OUTDOOR = /park|trail|hike|beach|garden|walk|lake|zoo|picnic|market|run\b|bike|forest|mountain|river/i;

/* ------------------------------------ moments ------------------------------------ */

function outing(inp: MomentInputs): Suggestion | null {
  const now = inp.temporal.now;
  const nowMs = now.getTime();
  const located = events(inp).filter((e) => !e.allDay && e.location && !/^https?:/i.test(e.location) && !/zoom|meet\.google|teams/i.test(e.location));
  const evening = inp.temporal.part === 'evening' || inp.temporal.part === 'late_evening';
  let target = located.find((e) => {
    const s = new Date(e.startsAt!).getTime();
    return s > nowMs - 10 * 60_000 && s - nowMs <= 3 * 3_600_000;
  });
  let tomorrow = false;
  if (!target && evening) {
    target = located.find((e) => {
      const s = new Date(e.startsAt!);
      return localDateIso(s) === localDateIso(new Date(nowMs + 86_400_000)) && s.getHours() < 11;
    });
    tomorrow = !!target;
  }
  if (!target && inp.requested === 'outing') target = located.find((e) => new Date(e.startsAt!).getTime() > nowMs && localDateIso(new Date(e.startsAt!)) === inp.temporal.dateIso);
  if (!target && inp.requested !== 'outing') return null;

  const evidence: Evidence[] = [];
  const sections: SuggestionSections = {};
  const reasons: string[] = [];
  const start = target ? new Date(target.startsAt!) : new Date(nowMs + 60 * 60_000);
  let weatherAtStart: string | null = null;
  const end = target?.endsAt ? new Date(target.endsAt) : new Date(start.getTime() + 2 * 3_600_000);
  if (target) {
    evidence.push(ev(inp, target, `${target.title} · ${tomorrow ? 'tomorrow ' : ''}${formatTime(start)}${target.location ? ` · ${target.location}` : ''}`));
    reasons.push(`${target.title} at ${formatTime(start)}${tomorrow ? ' tomorrow' : ''} · ${label(target.sourceId)}`);
  }
  // Travel time → leave by
  const route = target ? inp.items.find((i) => i.kind === 'route' && (i.data?.eventIds as string[] | undefined)?.includes(target.id)) : undefined;
  let leaveBy: string | undefined;
  let travel: string | undefined;
  if (route) {
    const drive = route.data!.driveMin as number;
    const walk = route.data!.walkMin as number | null;
    const leave = new Date(start.getTime() - (drive + 10) * 60_000);
    leaveBy = formatTime(leave);
    travel = `${drive} min drive${walk ? ` · ${walk} min walk` : ''} · ${route.data!.km} km`;
    evidence.push(ev(inp, route, `${drive} min drive (${route.data!.km} km)`));
    reasons.push(`${drive} min away by car · ${label(route.sourceId)}`);
  }
  sections.event = target
    ? { title: target.title, time: `${tomorrow ? 'Tomorrow, ' : ''}${formatTime(start)}–${formatTime(end)}`, place: target.location, leaveBy, travel, url: target.url }
    : { title: 'Heading out now', time: `${formatTime(now)} onward` };
  // Weather across the outing
  const h = hourly(inp);
  if (h) {
    const pts = hoursBetween(h.hours, tomorrow ? start : new Date(Math.min(nowMs, start.getTime())), end).slice(0, 6);
    if (pts.length) {
      const note = rainNote(pts);
      sections.hourly = { label: target ? `Weather during ${target.title}` : 'Next few hours', points: pts.map(hourPoint), note: note ?? undefined };
      // The hour that contains the start time (not just the first hour shown).
      const atStart = [...pts].reverse().find((p) => parseLocalDateTime(p.t)!.getTime() <= start.getTime()) ?? pts[0];
      weatherAtStart = `${mapWmoCodeToCondition(atStart.code)}, ${Math.round(atStart.temp)}°C`;
      evidence.push(ev(inp, h.item, `${mapWmoCodeToCondition(atStart.code)}, ${Math.round(atStart.temp)}°C${atStart.pop != null ? `, ${atStart.pop}% rain` : ''} at ${formatTime(parseLocalDateTime(atStart.t)!)}`));
      reasons.push(note ? `${note} · Open-Meteo` : `${mapWmoCodeToCondition(atStart.code)} around ${formatTime(start)} · Open-Meteo`);
    }
  }
  const air = inp.items.find((i) => i.kind === 'air');
  const extras: { text: string; source: string }[] = [];
  if (air && ((air.data?.usAqi as number) ?? 0) > 100) {
    extras.push({ text: `Air quality is unhealthy for sensitive groups (AQI ${air.data!.usAqi})`, source: label(air.sourceId) });
    evidence.push(ev(inp, air, `US AQI ${air.data!.usAqi}`));
  }
  if (air && ((air.data?.pollen as number) ?? 0) > 50) extras.push({ text: 'Pollen is high today', source: label(air.sourceId) });
  // Outdoor extras: golden hour, nature nearby
  const outdoor = target ? OUTDOOR.test(`${target.title} ${target.location ?? ''}`) : true;
  if (outdoor) {
    const golden = timeEv(inp, 'time:golden') ?? timeEv(inp, 'time:sunset');
    if (golden) {
      evidence.push(golden);
      extras.push({ text: golden.text, source: 'Clock & calendar' });
    }
    for (const o of inp.items.filter((i) => i.kind === 'observation').slice(0, 2)) {
      extras.push({ text: `${o.title} spotted nearby this week`, source: label(o.sourceId) });
      evidence.push(ev(inp, o, `${o.title} (${o.data?.count ?? 1} sightings)`));
    }
  }
  for (const a of inp.items.filter((i) => i.kind === 'alert').slice(0, 1)) {
    extras.push({ text: a.title, source: label(a.sourceId) });
    evidence.push(ev(inp, a));
  }
  // Transit + a podcast that fits the trip
  const deps = inp.items.filter((i) => i.kind === 'departure' && i.startsAt && new Date(i.startsAt).getTime() > nowMs).slice(0, 3);
  for (const d of deps) {
    extras.push({ text: `${d.title} at ${timeOf(d.startsAt)} from ${d.data?.stop}`, source: label(d.sourceId) });
    evidence.push(ev(inp, d));
  }
  const tripMin = (route?.data?.driveMin as number | undefined) ?? 25;
  const pod = inp.items.find((i) => i.kind === 'podcast_episode' && typeof i.data?.runtime === 'number' && (i.data.runtime as number) <= Math.max(tripMin * 2, 30));
  if (pod) {
    extras.push({ text: `Listen on the way: ${pod.subtitle} — “${pod.title}” (${pod.data!.runtime} min)`, source: label(pod.sourceId) });
    evidence.push(ev(inp, pod));
  }
  if (extras.length) sections.extras = { title: 'Good to know', lines: extras };
  // Prep tasks related to the outing
  if (target) {
    const prep = inp.items.filter((i) => i.kind === 'task' && !i.done && (overlaps(i.title, target.title) || (target.location && overlaps(i.title, target.location))));
    if (prep.length) {
      sections.checklist = { title: 'Before you go', items: prep.slice(0, 4).map((p) => ({ text: p.title, source: label(p.sourceId), done: false })) };
      prep.slice(0, 4).forEach((p) => evidence.push(ev(inp, p)));
    }
    const mem = memoryMentioning(inp, [target.location?.split(',')[0] ?? '', ...namesIn(target.title)]);
    if (mem) {
      sections.memory = { quote: mem.draftText.trim().slice(0, 160), attribution: `You wrote this on ${parseLocalDate(mem.dateIso)!.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` };
      evidence.push({ id: `journal:entry:${mem.id}`, sourceId: 'journal', sourceLabel: 'Your journal', text: 'An earlier page mentions this', origin: 'data' });
    }
  }
  const mins = (start.getTime() - nowMs) / 60_000;
  const priority = !target ? 95 : tomorrow ? 55 : mins <= 90 ? 92 : 75;
  return {
    key: `outing:${target?.id ?? 'now'}`,
    moment: 'outing',
    title: target ? (tomorrow ? `Tomorrow: ${target.title}` : leaveBy ? `Leave by ${leaveBy} for ${target.title}` : `${target.title} at ${formatTime(start)}`) : 'Heading out',
    summary: [sections.hourly?.note ?? weatherAtStart, travel].filter(Boolean).join(' · ') || 'Here’s what’s useful before you go.',
    priority,
    window: target ? { from: nowMs, to: start.getTime() } : null,
    evidence,
    reasons,
    missing: [
      ...(target ? [] : missing(inp, CAL, 'Connect a calendar to prepare for specific plans.')),
      ...(h ? [] : missing(inp, ['weather'], 'Add a weather city to see conditions during your plans.')),
      ...(target && !route && inp.hasLocation ? missing(inp, ['travel_osrm'], 'Turn on Travel time for “leave by” estimates.') : []),
    ],
    sections,
    actions: [
      ...(target?.url ? [{ label: 'Open event', name: 'open_url' as const, value: target.url }] : []),
      { label: 'Note something for later', name: 'reflect' as const, value: target ? `Before ${target.title}: ` : '' },
    ],
  };
}

function freeWindow(inp: MomentInputs): { minutes: number; until: Date; nextEvent: ContextItem | null } {
  const now = inp.temporal.now;
  const next = events(inp).find((e) => !e.allDay && new Date(e.startsAt!).getTime() > now.getTime()) ?? null;
  const bed = inp.temporal.bedtime;
  const until = next && new Date(next.startsAt!) < bed ? new Date(next.startsAt!) : bed;
  return { minutes: Math.max(0, Math.round((until.getTime() - now.getTime()) / 60_000)), until, nextEvent: next && new Date(next.startsAt!) < bed ? next : null };
}

function watch(inp: MomentInputs): Suggestion | null {
  const tc = inp.temporal;
  const leisure = tc.part === 'evening' || tc.part === 'late_evening' || (!tc.isWorkday && tc.part === 'afternoon');
  if ((!tc.awake || !leisure) && inp.requested !== 'watch') return null;
  const free = freeWindow(inp);
  if (free.minutes < 25 && inp.requested !== 'watch') return null;
  const media = inp.items.filter((i) => ['movie', 'show', 'video', 'episode', 'podcast_episode'].includes(i.kind));
  const nowMs = tc.now.getTime();
  const fits = (i: ContextItem) => {
    const r = i.data?.runtime as number | null | undefined;
    if (i.kind === 'episode') return !!i.startsAt && new Date(i.startsAt).getTime() <= nowMs && nowMs - new Date(i.startsAt).getTime() < 3 * 86_400_000 && (r ?? 30) <= free.minutes;
    return r != null && r > 0 && r <= free.minutes;
  };
  const score = (i: ContextItem) => (i.data?.onWatchlist ? 30 : 0) + (i.kind === 'episode' ? 25 : 0) + (i.kind === 'movie' || i.kind === 'show' ? 10 : 0) + ((i.data?.rating as number) ?? 0) + (i.kind === 'podcast_episode' ? -5 : 0);
  const picks = media.filter(fits).sort((a, b) => score(b) - score(a)).slice(0, 4);
  const evidence: Evidence[] = [];
  const reasons: string[] = [];
  const fr = timeEv(inp, 'time:part');
  if (fr) evidence.push(fr);
  reasons.push(free.nextEvent ? `Free until ${free.nextEvent.title} at ${formatTime(free.until)}` : `About ${Math.floor(free.minutes / 60)}h ${free.minutes % 60}m before your ${formatTime(tc.bedtime)} bedtime`);
  if (free.nextEvent) evidence.push(ev(inp, free.nextEvent, `Next: ${free.nextEvent.title} at ${formatTime(free.until)}`));
  const sections: SuggestionSections = {};
  if (picks.length) {
    sections.media = {
      title: `Fits in ${free.minutes >= 60 ? `${Math.floor(free.minutes / 60)}h ${free.minutes % 60}m` : `${free.minutes} min`}`,
      picks: picks.map((p) => {
        const runtime = (p.data?.runtime as number | null) ?? 30;
        const endsBy = new Date(nowMs + runtime * 60_000);
        const providers = ((p.data?.providers as string[] | undefined) ?? []).join(', ');
        evidence.push(ev(inp, p, `${p.title} · ${runtime} min${providers ? ` · ${providers}` : ''}`));
        return {
          title: p.kind === 'episode' ? p.title : p.title,
          meta: [p.kind === 'movie' ? 'Movie' : p.kind === 'show' ? 'Series' : p.kind === 'video' ? 'Video' : p.kind === 'episode' ? 'New episode' : 'Podcast', `${runtime} min`, p.data?.onWatchlist ? 'On your watchlist' : p.subtitle].filter(Boolean).join(' · '),
          fits: `Done by ${formatTime(endsBy)}`,
          providers: providers || (p.kind === 'video' ? 'YouTube' : p.kind === 'podcast_episode' ? 'Podcast app' : p.data?.network ? String(p.data.network) : ''),
          url: p.url,
          image: p.imageUrl,
          source: label(p.sourceId),
        };
      }),
    };
    reasons.push(`${picks.length} pick${picks.length === 1 ? '' : 's'} that fit · ${Array.from(new Set(picks.map((p) => label(p.sourceId)))).join(', ')}`);
  }
  // Tomorrow's first thing, so the evening has a natural stopping point.
  const tomorrowIso = localDateIso(new Date(nowMs + 86_400_000));
  const first = events(inp).find((e) => !e.allDay && localDateIso(new Date(e.startsAt!)) === tomorrowIso);
  const lines: { text: string; source: string }[] = [];
  if (first) {
    lines.push({ text: `First thing tomorrow: ${first.title} at ${formatTime(new Date(first.startsAt!))}`, source: label(first.sourceId) });
    evidence.push(ev(inp, first));
  }
  const recipe = tc.now.getHours() < 20 ? inp.items.find((i) => i.kind === 'recipe') : undefined;
  if (recipe) lines.push({ text: `Dinner idea: ${recipe.title}${recipe.subtitle ? ` (${recipe.subtitle})` : ''}`, source: label(recipe.sourceId) });
  if (lines.length) sections.extras = { title: 'Also', lines };
  if (!picks.length && inp.requested !== 'watch') return null;
  return {
    key: `watch:${tc.dateIso}`,
    moment: 'watch',
    title: picks.length ? (picks[0].data?.onWatchlist ? `Tonight: ${picks[0].title}?` : 'Something that fits tonight') : 'What to watch',
    summary: reasons[0],
    priority: inp.requested === 'watch' ? 96 : tc.part === 'late_evening' ? 55 : 68,
    window: { from: nowMs, to: free.until.getTime() },
    evidence,
    reasons,
    missing: missing(inp, ['media_tmdb', 'media_tvmaze', 'video_youtube', 'podcasts_itunes'], 'Connect TMDB, TVMaze, YouTube or podcasts for picks that fit your free time.'),
    sections,
    actions: [{ label: 'Write about what you watch', name: 'reflect', value: 'Tonight I watched ' }],
  };
}

function episodeTonight(inp: MomentInputs): Suggestion | null {
  const nowMs = inp.temporal.now.getTime();
  const ep = inp.items
    .filter((i) => i.kind === 'episode' && i.startsAt && localDateIso(new Date(i.startsAt)) === inp.temporal.dateIso)
    .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!))[0];
  if (!ep) return null;
  const at = new Date(ep.startsAt!);
  const show = String(ep.data?.show ?? ep.title);
  const tmdbMatch = inp.items.find((i) => i.kind === 'show' && i.title.toLowerCase() === show.toLowerCase());
  const providers = ((tmdbMatch?.data?.providers as string[] | undefined) ?? []).join(', ') || String(ep.data?.network ?? '');
  const evidence = [ev(inp, ep, `${ep.title} airs ${formatTime(at)}`), ...(tmdbMatch ? [ev(inp, tmdbMatch, `Streaming on ${providers}`)] : [])];
  return {
    key: `episode:${ep.id}`,
    moment: 'episode_tonight',
    title: at.getTime() > nowMs ? `${show} — new episode at ${formatTime(at)}` : `${show} — new episode is out`,
    summary: [ep.subtitle, providers].filter(Boolean).join(' · '),
    priority: at.getTime() > nowMs && at.getTime() - nowMs < 3 * 3_600_000 ? 60 : 45,
    window: { from: nowMs, to: at.getTime() + 6 * 3_600_000 },
    evidence,
    reasons: [`Airs ${formatTime(at)} today · TVMaze`, ...(providers ? [`Where to watch: ${providers}`] : [])],
    missing: [],
    sections: { media: { title: 'New today', picks: [{ title: ep.title, meta: [ep.subtitle, ep.data?.runtime ? `${ep.data.runtime} min` : null].filter(Boolean).join(' · '), fits: at.getTime() > nowMs ? `Airs ${formatTime(at)}` : 'Out now', providers, url: ep.url, image: ep.imageUrl, source: 'TVMaze' }] } },
    actions: [],
  };
}

function planDay(inp: MomentInputs): Suggestion | null {
  const tc = inp.temporal;
  const morning = tc.awake && tc.minutesSinceWake >= -60 && tc.minutesSinceWake <= 240;
  if (!morning && inp.requested !== 'plan_day') return null;
  const nowMs = tc.now.getTime();
  const evidence: Evidence[] = [];
  const reasons: string[] = [];
  const rows: { time: string; text: string; source: string; kind: string }[] = [];
  const today = timedToday(inp).filter((e) => new Date(e.endsAt ?? e.startsAt!).getTime() > nowMs);
  for (const e of today.slice(0, 6)) {
    rows.push({ time: timeOf(e.startsAt), text: `${e.title}${e.location ? ` · ${e.location}` : ''}`, source: label(e.sourceId), kind: 'event' });
    evidence.push(ev(inp, e, `${e.title} at ${timeOf(e.startsAt)}`));
  }
  tc.allDay.forEach((a) => rows.unshift({ time: 'All day', text: a, source: 'Calendar', kind: 'event' }));
  const dayOff = !tc.isWorkday || tc.travel.traveling;
  const workish = (i: ContextItem) => i.sourceId === 'projects_github' || /\b(work|office|team|client|sprint)\b/i.test(String(i.data?.project ?? i.subtitle ?? ''));
  const due = inp.items
    .filter((i) => i.kind === 'task' && !i.done && i.startsAt && i.startsAt.slice(0, 10) <= tc.dateIso)
    .filter((i) => !(dayOff && workish(i)))
    .slice(0, 6);
  const habits = inp.items.filter((i) => i.kind === 'habit' && i.data?.habitType === 'daily' && i.data?.isDue && !i.done).slice(0, 4);
  const sections: SuggestionSections = {};
  if (rows.length) sections.timeline = { title: 'Today', rows };
  if (due.length || habits.length) {
    sections.checklist = {
      title: dayOff ? 'Personal to-dos' : 'Due today',
      items: [...due.map((d) => ({ text: d.title, source: label(d.sourceId), done: false })), ...habits.map((hb) => ({ text: hb.title, source: label(hb.sourceId), done: false }))],
    };
    [...due, ...habits].forEach((x) => evidence.push(ev(inp, x)));
  }
  const h = hourly(inp);
  const dayItem = inp.items.find((i) => i.id === `weather:day:${tc.dateIso}`);
  if (dayItem) {
    evidence.push(ev(inp, dayItem));
    reasons.push(`${dayItem.title} · Open-Meteo`);
  }
  if (h) {
    const rest = hoursBetween(h.hours, tc.now, tc.bedtime);
    const note = rainNote(rest);
    if (rest.length) sections.hourly = { label: 'Today', points: rest.filter((_, i) => i % 3 === 0).slice(0, 6).map(hourPoint), note: note ?? undefined };
    if (note) reasons.push(`${note} · Open-Meteo`);
  }
  const dt = timeEv(inp, 'time:daytype');
  if (dt) evidence.push(dt);
  if (tc.holiday) reasons.push(`${tc.holiday} — a day off`);
  if (today.length) reasons.push(`${today.length} event${today.length === 1 ? '' : 's'} ahead · ${Array.from(new Set(today.map((e) => label(e.sourceId)))).join(', ')}`);
  if (due.length) reasons.push(`${due.length} task${due.length === 1 ? '' : 's'} due · ${Array.from(new Set(due.map((e) => label(e.sourceId)))).join(', ')}`);
  if (tc.travel.traveling) reasons.push('Traveling — work tasks are hidden');
  else if (dayOff && inp.items.some((i) => i.kind === 'task' && workish(i))) reasons.push('Day off — work tasks are hidden');
  if (!rows.length && !due.length && !habits.length && !dayItem && inp.requested !== 'plan_day') return null;
  return {
    key: `plan:${tc.dateIso}`,
    moment: 'plan_day',
    title: tc.holiday ? `${tc.holiday} — your day` : `${tc.dayName}: ${today.length ? `${today.length} thing${today.length === 1 ? '' : 's'} on the calendar` : 'an open day'}`,
    summary: reasons.slice(0, 2).join(' · ') || 'A quiet look at the day ahead.',
    priority: inp.requested === 'plan_day' ? 97 : tc.minutesSinceWake <= 150 ? 82 : 60,
    window: { from: nowMs, to: nowMs + 4 * 3_600_000 },
    evidence,
    reasons,
    missing: [...missing(inp, CAL, 'Connect a calendar to see your day here.'), ...missing(inp, TASKS, 'Connect a task app to see what’s due.')],
    sections: { ...sections, prompt: today.length ? `What would make ${today[0].title} go well today?` : 'What would make today feel well spent?' },
    actions: [{ label: 'Add an intention to my note', name: 'reflect', value: 'Today I want to ' }],
  };
}

function resume(inp: MomentInputs): Suggestion | null {
  const tc = inp.temporal;
  if (!tc.awake) return null;
  const nowMs = tc.now.getTime();
  const daysAgo = (iso?: unknown) => (typeof iso === 'string' ? Math.floor((nowMs - (t(iso)?.getTime() ?? nowMs)) / 86_400_000) : null);
  const projects = inp.items
    .filter((i) => i.kind === 'project')
    .map((p) => ({ p, idle: daysAgo(p.data?.lastActivity) }))
    .filter(({ p, idle }) => idle != null && idle >= 3 && idle <= 45 && !(p.sourceId === 'journal' && p.data?.projectId === inp.journal.activeProjectId))
    .sort((a, b) => (a.p.sourceId === 'journal' ? -1 : 0) - (b.p.sourceId === 'journal' ? -1 : 0) || a.idle! - b.idle!);
  const pick = projects[0];
  if (!pick) return null;
  const { p, idle } = pick;
  const evidence = [ev(inp, p, `${p.title} · last activity ${idle} days ago`)];
  const reasons = [`No activity on ${p.title} for ${idle} days · ${label(p.sourceId)}`];
  let excerpt: string | undefined;
  if (p.sourceId === 'journal') {
    const last = inp.journal.entries.filter((e) => e.projectId === p.data?.projectId && e.draftText.trim()).sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0];
    if (last) excerpt = last.draftText.trim().replace(/\s+/g, ' ').slice(-160);
  }
  const next = inp.items.find((i) => i.kind === 'task' && !i.done && (String(i.data?.project ?? '').toLowerCase() === p.title.toLowerCase() || overlaps(i.title, p.title)));
  if (next) {
    evidence.push(ev(inp, next, `Next: ${next.title}`));
    reasons.push(`Open task: ${next.title} · ${label(next.sourceId)}`);
  }
  const files = inp.items.filter((i) => i.kind === 'file' && overlaps(i.title, p.title)).slice(0, 3);
  files.forEach((f) => evidence.push(ev(inp, f, `${f.title} edited recently`)));
  const weekendBoost = !tc.isWorkday && (tc.part === 'morning' || tc.part === 'afternoon') ? 15 : 0;
  return {
    key: `resume:${p.id}`,
    moment: 'resume',
    title: `Pick ${p.title} back up?`,
    summary: excerpt ? `You left off: “…${excerpt.slice(-70)}”` : next ? `Next step: ${next.title}` : `It’s been ${idle} days.`,
    priority: 48 + weekendBoost + (inp.task === 'thinking' ? 10 : 0),
    window: null,
    evidence,
    reasons,
    missing: [],
    sections: {
      project: { title: p.title, lastActivity: `${idle} days ago`, excerpt, nextStep: next?.title, files: files.map((f) => f.title) },
      prompt: `What’s the smallest next step on ${p.title}?`,
    },
    actions: [
      p.sourceId === 'journal' ? { label: 'Open in Today', name: 'open_project', value: String(p.data?.projectId) } : p.url ? { label: `Open in ${label(p.sourceId)}`, name: 'open_url', value: p.url } : { label: 'Start a 10m sprint', name: 'start_focus' },
      { label: 'Start a 10m sprint', name: 'start_focus' },
    ].filter((a, i, arr) => arr.findIndex((b) => b.label === a.label) === i) as SuggestionAction[],
  };
}

function resumeReading(inp: MomentInputs): Suggestion | null {
  const tc = inp.temporal;
  const good = tc.part === 'evening' || tc.part === 'late_evening' || !tc.isWorkday;
  if (!tc.awake || !good) return null;
  const book = inp.items.find((i) => i.kind === 'book' && i.data?.shelf === 'currently-reading');
  if (!book) return null;
  const recent = inp.journal.entries.filter((e) => e.dateIso >= localDateIso(new Date(tc.now.getTime() - 7 * 86_400_000)));
  if (recent.some((e) => overlaps(e.draftText, book.title))) return null;
  const meta = inp.items.find((i) => i.sourceId === 'books_google' && i.data?.enriches === book.id);
  const hl = inp.items.find((i) => i.kind === 'highlight' && (overlaps(i.title, book.title) || (book.data?.author && String(i.data?.author ?? '').includes(String(book.data.author)))));
  const evidence = [ev(inp, book, `Currently reading: ${book.title}`), ...(meta ? [ev(inp, meta, `${meta.data?.pageCount ?? '?'} pages`)] : []), ...(hl ? [ev(inp, hl, 'A highlight you saved from it')] : [])];
  return {
    key: `reading:${book.id}`,
    moment: 'resume_reading',
    title: `Back to ${book.title}?`,
    summary: [book.subtitle, meta?.data?.pageCount ? `${meta.data.pageCount} pages` : null].filter(Boolean).join(' · '),
    priority: 38,
    window: null,
    evidence,
    reasons: [`On your “currently reading” shelf · Open Library`, 'Not mentioned in your journal this week'],
    missing: [],
    sections: {
      memory: hl ? { quote: String(hl.data?.text ?? ''), attribution: `${hl.title}${hl.data?.author ? ` — ${hl.data.author}` : ''} · Readwise` } : undefined,
      prompt: `What has stayed with you from ${book.title} so far?`,
    },
    actions: [{ label: 'Write about it', name: 'reflect', value: `Reading ${book.title}, ` }],
  };
}

function reflect(inp: MomentInputs): Suggestion | null {
  const tc = inp.temporal;
  const nowMs = tc.now.getTime();
  const today = timedToday(inp);
  const lastEnded = today.length ? new Date(today[today.length - 1].endsAt ?? today[today.length - 1].startsAt!).getTime() < nowMs : false;
  const time = tc.part === 'evening' || tc.part === 'late_evening' || (lastEnded && tc.now.getHours() >= 16);
  if ((!tc.awake || !time) && inp.requested !== 'reflect') return null;
  const done = inp.journal.todayEntry?.isCompleted === true;
  // `at` orders the day chronologically (undated completions last); it's dropped before rendering.
  const dated: { at: number; time: string; text: string; source: string; kind: string }[] = [];
  const msOf = (iso?: unknown) => (typeof iso === 'string' ? (t(iso)?.getTime() ?? Infinity) : Infinity);
  const evidence: Evidence[] = [];
  for (const e of today.filter((x) => new Date(x.startsAt!).getTime() < nowMs)) {
    dated.push({ at: msOf(e.startsAt), time: timeOf(e.startsAt), text: e.title, source: label(e.sourceId), kind: 'event' });
    evidence.push(ev(inp, e));
  }
  const completed = inp.items.filter((i) => (i.kind === 'task' || i.kind === 'habit') && i.done).slice(0, 6);
  for (const c of completed) {
    dated.push({ at: msOf(c.data?.completedAt), time: c.data?.completedAt ? timeOf(String(c.data.completedAt)) : '✓', text: `Done: ${c.title}`, source: label(c.sourceId), kind: 'task' });
    evidence.push(ev(inp, c));
  }
  for (const p of inp.items.filter((i) => i.kind === 'photo' && i.startsAt && localDateIso(new Date(i.startsAt)) === tc.dateIso).slice(0, 3)) {
    dated.push({ at: msOf(p.startsAt), time: timeOf(p.startsAt), text: `Photo: ${p.title}`, source: label(p.sourceId), kind: 'photo' });
    evidence.push(ev(inp, p));
  }
  for (const th of inp.items.filter((i) => i.sourceId === 'share_target' && i.startsAt && localDateIso(new Date(i.startsAt)) === tc.dateIso).slice(0, 2)) {
    dated.push({ at: msOf(th.startsAt), time: timeOf(th.startsAt), text: `Saved: ${th.title}`, source: label(th.sourceId), kind: 'thought' });
    evidence.push(ev(inp, th));
  }
  const rows = dated.sort((a, b) => a.at - b.at).map(({ at: _at, ...row }) => row);
  // The day's soundtrack
  const tracks = inp.items.filter((i) => i.kind === 'track' && i.startsAt && localDateIso(new Date(i.startsAt)) === tc.dateIso);
  const lines: { text: string; source: string }[] = [];
  if (tracks.length) {
    const counts = new Map<string, number>();
    tracks.forEach((tr) => counts.set(String(tr.data?.artist ?? tr.subtitle ?? ''), (counts.get(String(tr.data?.artist ?? tr.subtitle ?? '')) ?? 0) + 1));
    const top = [...counts.entries()].filter(([a]) => a).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a);
    lines.push({ text: `Soundtrack: ${tracks.length} tracks${top.length ? `, mostly ${top.join(' and ')}` : ''}`, source: label(tracks[0].sourceId) });
    evidence.push(ev(inp, tracks[0], `${tracks.length} tracks today`));
  }
  const dayItem = inp.items.find((i) => i.id === `weather:day:${tc.dateIso}`);
  if (dayItem) lines.push({ text: `Weather: ${dayItem.title}`, source: label(dayItem.sourceId) });
  const moon = timeEv(inp, 'time:moon');
  if (moon) {
    lines.push({ text: moon.text, source: 'Clock & calendar' });
    evidence.push(moon);
  }
  const part = timeEv(inp, 'time:part');
  if (part) evidence.push(part);
  const named = today.filter((e) => new Date(e.startsAt!).getTime() < nowMs).map((e) => e.title);
  const prompt = named.length >= 2 ? `You had ${named[0]} and ${named[1]} today — which moment do you want to keep?` : named.length === 1 ? `How did ${named[0]} actually go?` : completed.length ? `You finished “${completed[0].title}” — how did that feel?` : 'What’s one small thing from today worth writing down?';
  if (!rows.length && !lines.length && done && inp.requested !== 'reflect') return null;
  return {
    key: `reflect:${tc.dateIso}`,
    moment: 'reflect',
    title: done ? 'Your day, at a glance' : 'Before the day ends',
    summary: rows.length ? `${rows.length} thing${rows.length === 1 ? '' : 's'} from today, gathered from ${Array.from(new Set(rows.map((r) => r.source))).join(', ')}.` : 'A quiet moment to look back.',
    priority: done ? 45 : tc.part === 'late_evening' ? 88 : 72,
    window: { from: nowMs, to: tc.bedtime.getTime() },
    evidence,
    reasons: [`${tc.partLabel}${done ? ' · today’s page is done' : ' · today’s page is still open'}`, ...(rows.length ? [`${rows.length} moments from today · ${Array.from(new Set(rows.map((r) => r.source))).join(', ')}`] : [])],
    missing: rows.length ? [] : missing(inp, [...CAL, ...TASKS], 'Connect a calendar or task app to see your day gathered here.'),
    sections: { timeline: rows.length ? { title: 'Today', rows } : undefined, extras: lines.length ? { title: 'Also today', lines } : undefined, prompt },
    actions: [{ label: 'Use this as today’s angle', name: 'reflect', value: prompt }, ...(done ? [] : [{ label: 'Mark today done', name: 'mark_done' as const }])],
  };
}

function unfinished(inp: MomentInputs, skipProjectId?: unknown): Suggestion | null {
  if (!inp.temporal.awake) return null;
  const nowMs = inp.temporal.now.getTime();
  const thoughts = inp.items.filter((i) => !(skipProjectId != null && i.sourceId === 'journal' && i.data?.projectId === skipProjectId)).filter((i) => i.kind === 'thought' || (i.kind === 'note' && ((i.data?.reasons as string[] | undefined) ?? []).length) || (i.kind === 'link' && i.startsAt && nowMs - new Date(i.startsAt).getTime() > 4 * 86_400_000));
  const order = (i: ContextItem) => (i.sourceId === 'journal' ? 0 : i.sourceId === 'share_target' ? 1 : i.kind === 'note' ? 2 : 3);
  const pick = thoughts.sort((a, b) => order(a) - order(b) || (b.startsAt ?? '').localeCompare(a.startsAt ?? ''))[0];
  if (!pick) return null;
  const when = pick.startsAt ? t(pick.startsAt) : null;
  // Calendar days, so "2 days ago" means the date, not 48 elapsed hours.
  const ago = when ? Math.max(0, daysBetween(when, inp.temporal.now)) : null;
  const why = ((pick.data?.reasons as string[] | undefined) ?? [])[0] ?? (pick.kind === 'link' ? 'saved and not revisited' : 'left open');
  const text = pick.sourceId === 'journal' ? pick.title : String(pick.data?.excerpt ?? pick.data?.text ?? pick.title);
  return {
    key: `unfinished:${pick.id}`,
    moment: 'unfinished',
    title: pick.kind === 'link' ? `Still want to read “${pick.title}”?` : pick.kind === 'note' ? `Unfinished note: ${pick.title}` : 'A thought you left open',
    summary: `${ago == null ? '' : ago === 0 ? 'Today · ' : ago === 1 ? 'Yesterday · ' : `${ago} days ago · `}${why}`,
    priority: 42 + (inp.task === 'thinking' ? 15 : 0),
    window: null,
    evidence: [ev(inp, pick, `${pick.kind === 'link' ? 'Saved link' : pick.kind === 'note' ? 'Note' : 'Draft'}: ${why}`)],
    reasons: [`${why[0].toUpperCase()}${why.slice(1)} · ${label(pick.sourceId)}`],
    missing: [],
    sections: { memory: { quote: text.slice(0, 220), attribution: `${label(pick.sourceId)}${pick.subtitle ? ` · ${pick.subtitle}` : ''}` }, prompt: pick.kind === 'link' ? `What made you save “${pick.title}”?` : 'Where were you going with this?' },
    actions: [
      pick.sourceId === 'journal' && pick.data?.projectId != null ? { label: 'Continue in Today', name: 'open_project', value: String(pick.data.projectId) } : pick.url ? { label: 'Open', name: 'open_url', value: pick.url } : { label: 'Continue in my note', name: 'reflect', value: `${text.slice(0, 120)} ` },
      { label: 'Let it go', name: 'dismiss' },
    ],
  };
}

function resurface(inp: MomentInputs): Suggestion | null {
  const tc = inp.temporal;
  if (!tc.awake || !(tc.part === 'morning' || tc.part === 'early_morning' || tc.part === 'evening')) return null;
  const mem = inp.items.find((i) => i.kind === 'memory') ?? inp.items.find((i) => i.kind === 'photo' && i.data?.anniversary);
  const hl = inp.items.find((i) => i.kind === 'highlight');
  // Only today's events: a cached feed from yesterday (before the daily resync) must not pose as today.
  const otd = inp.items.find((i) => i.kind === 'onthisday' && i.startsAt === tc.dateIso);
  const main = mem ?? hl ?? otd;
  if (!main) return null;
  const evidence = [mem, hl, otd].filter(Boolean).map((i) => ev(inp, i!));
  const lines = [hl && main !== hl ? { text: `“${String(hl.data?.text ?? '').slice(0, 120)}” — ${hl.title}`, source: label(hl.sourceId) } : null, otd && main !== otd ? { text: otd.title, source: label(otd.sourceId) } : null].filter(Boolean) as { text: string; source: string }[];
  return {
    key: `resurface:${main.id}`,
    moment: 'resurface',
    title: mem ? `${String(mem.data?.anniversary ?? mem.subtitle ?? 'On this day')}` : hl ? 'A passage you saved' : 'On this day in history',
    summary: main.subtitle ?? '',
    priority: 28,
    window: null,
    evidence,
    reasons: evidence.map((e) => `${e.text.slice(0, 60)} · ${e.sourceLabel}`).slice(0, 2),
    missing: [],
    sections: {
      memory: { quote: main.kind === 'highlight' ? String(main.data?.text ?? '') : main.title, attribution: `${main.subtitle ?? ''} · ${label(main.sourceId)}`.replace(/^ · /, '') },
      extras: lines.length ? { title: 'Also', lines } : undefined,
      prompt: mem ? 'What’s changed since you wrote that?' : 'Does this connect to anything in your life right now?',
    },
    actions: [{ label: 'Reflect on this', name: 'reflect', value: 'Looking back, ' }],
  };
}

const COMPOSERS: Record<MomentKind, (inp: MomentInputs) => Suggestion | null> = {
  outing,
  plan_day: planDay,
  watch,
  episode_tonight: episodeTonight,
  reflect,
  resume,
  resume_reading: resumeReading,
  unfinished,
  resurface,
};

/** Every moment that applies right now (unranked). */
export function detectMoments(inp: MomentInputs): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [kind, compose] of Object.entries(COMPOSERS) as [MomentKind, (i: MomentInputs) => Suggestion | null][]) {
    if (inp.disabled?.includes(kind) && inp.requested !== kind) continue;
    try {
      const s = compose(inp);
      if (s) out.push(s);
    } catch (e) {
      // A bad item from one source must never take down the others.
      console.warn('[moments]', kind, e);
    }
  }
  return dedupe(inp, out);
}

/**
 * Cards combine sources so they shouldn't repeat each other: when "pick a project back up" already
 * quotes a journal project's draft, the unfinished-thought card looks for a different thought.
 */
function dedupe(inp: MomentInputs, out: Suggestion[]): Suggestion[] {
  const res = out.find((s) => s.moment === 'resume');
  const unf = out.find((s) => s.moment === 'unfinished');
  if (!res || !unf) return out;
  const projectOf = (s: Suggestion) => inp.items.find((i) => i.id === s.evidence[0]?.id && i.sourceId === 'journal')?.data?.projectId;
  const pid = projectOf(res);
  if (pid == null || projectOf(unf) !== pid) return out;
  let alt: Suggestion | null = null;
  try {
    alt = unfinished(inp, pid);
  } catch {
    alt = null;
  }
  return out.flatMap((s) => (s === unf ? (alt ? [alt] : []) : [s]));
}
