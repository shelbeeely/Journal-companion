import { describe, expect, it } from 'vitest';
import { detectMoments, type MomentInputs, type Suggestion } from '../core/context/moments';
import { rankSuggestions } from '../core/context/ranking';
import { buildTemporalContext } from '../core/context/temporal';
import { DEFAULT_PREFERENCES, type JournalEntry, type JournalProject } from '../core/models';
import type { ContextItem } from '../core/sources/types';

const prefs = { ...DEFAULT_PREFERENCES, homeTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
const at = (h: number, m = 0, day = 24) => new Date(2026, 10, day, h, m);
const iso = (d: Date) => d.toISOString();
const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;
const F = 1_000;
const it_ = (o: Partial<ContextItem> & Pick<ContextItem, 'id' | 'sourceId' | 'kind' | 'title'>): ContextItem => ({ fetchedAt: F, ...o });

function hourly(day = 24): ContextItem {
  const hours = Array.from({ length: 48 }, (_, i) => {
    const d = new Date(2026, 10, day, i);
    return { t: local(d), temp: 9, pop: d.getHours() >= 15 && d.getHours() <= 17 ? 70 : 10, code: d.getHours() >= 15 && d.getHours() <= 17 ? 61 : 2, wind: 10, uv: 1, isDay: d.getHours() > 7 && d.getHours() < 17 };
  });
  return it_({ id: 'weather:hourly', sourceId: 'weather', kind: 'forecast', title: 'Hourly forecast', data: { hours } });
}
const dayWeather = it_({ id: 'weather:day:2026-11-24', sourceId: 'weather', kind: 'forecast', title: 'Rain, 11° / 5°C', startsAt: '2026-11-24', allDay: true, data: { sunrise: '2026-11-24T07:30', sunset: '2026-11-24T16:25' } });

const project: JournalProject = {
  id: 1, title: 'Evening Pages', writingGoal: 'g', originalBrief: '', audience: null, cadence: 'DAILY', pageSizeLabel: null, entryLengthLabel: null, linesPerPage: 14, wordsPerLine: 6,
  themes: [], tonePreferences: null, boundaries: null, includePastAnswersInPrompts: false, showDateTimeCard: true, showWeatherCard: true, showSparksCard: true, showRhythmCard: true,
  showTimerCard: true, includeDateTimeInPrompt: false, includeWeatherInPrompt: false, createdAtEpochMs: 0, updatedAtEpochMs: 0,
};
const entry = (id: number, dateIso: string, draftText: string, isCompleted = true, projectId = 1): JournalEntry => ({ id, projectId, dateIso, promptText: 'p', promptTopicTag: 't', hints: [], draftText, isCompleted, completedAtEpochMs: null, updatedAtEpochMs: 0 });

function inputs(now: Date, items: ContextItem[], over: Partial<MomentInputs> = {}): MomentInputs {
  const enabled = new Set(['journal', 'weather', ...items.map((i) => i.sourceId)]);
  return {
    temporal: buildTemporalContext({ now, prefs, items, entries: over.journal?.entries ?? [], latitude: 47.6 }),
    items,
    states: Object.fromEntries([...enabled].map((id) => [id, { enabled: true, status: 'connected', lastSyncAt: now.getTime(), lastAttemptAt: now.getTime(), error: null, itemCount: 1, useForSuggestions: true, shareWithAi: false, failures: 0 }])),
    enabled,
    journal: { projects: [project], entries: [], todayEntry: null, activeProjectId: 1 },
    task: 'arriving',
    hasLocation: true,
    ...over,
  };
}
const find = (s: Suggestion[], m: string) => s.find((x) => x.moment === m);
function expectGrounded(s: Suggestion, items: ContextItem[]) {
  const ids = new Set(items.map((i) => i.id));
  for (const e of s.evidence) {
    if (e.origin === 'data' && !e.id.startsWith('journal:entry:')) expect(ids.has(e.id), `evidence ${e.id}`).toBe(true);
    if (e.origin === 'time') expect(e.id.startsWith('time:')).toBe(true);
  }
}

describe('outing', () => {
  const coffee = it_({ id: 'calendar_google:c1', sourceId: 'calendar_google', kind: 'event', title: 'Coffee with Sam', location: 'Victrola Coffee, Seattle', startsAt: iso(at(15, 30)), endsAt: iso(at(16, 30)), url: 'https://cal/1' });
  const route = it_({ id: 'travel_osrm:victrola', sourceId: 'travel_osrm', kind: 'route', title: '18 min drive', data: { eventIds: [coffee.id], driveMin: 18, km: 9.2, walkMin: null } });
  const prep = it_({ id: 'tasks_todoist:t1', sourceId: 'tasks_todoist', kind: 'task', title: 'Bring Sam the book', done: false });
  const unrelated = it_({ id: 'tasks_todoist:t2', sourceId: 'tasks_todoist', kind: 'task', title: 'File taxes', done: false });
  const pod = it_({ id: 'podcasts_itunes:p1', sourceId: 'podcasts_itunes', kind: 'podcast_episode', title: 'Ep 1', subtitle: 'The Daily', data: { runtime: 25 } });
  const items = [coffee, route, prep, unrelated, pod, hourly(), dayWeather];

  it('combines calendar + travel + weather + tasks + a memory + a podcast', () => {
    const inp = inputs(at(14, 30), items, { journal: { projects: [project], entries: [entry(9, '2026-11-02', 'Sam told me about Victrola last time.')], todayEntry: null, activeProjectId: 1 } });
    const s = find(detectMoments(inp), 'outing')!;
    expect(s.title).toMatch(/^Leave by .* for Coffee with Sam$/);
    expect(s.sections.event).toMatchObject({ place: 'Victrola Coffee, Seattle', travel: '18 min drive · 9.2 km' });
    expect(s.sections.hourly!.note).toMatch(/70% chance of rain from 3/);
    expect(s.sections.checklist!.items.map((x) => x.text)).toEqual(['Bring Sam the book']);
    expect(s.sections.memory!.quote).toContain('Victrola');
    expect(s.sections.extras!.lines.some((l) => l.text.includes('Listen on the way'))).toBe(true);
    expect(s.reasons.join(' ')).toContain('Google Calendar');
    expect(s.reasons.join(' ')).toContain('Open-Meteo');
    expect(s.priority).toBeGreaterThanOrEqual(90);
    expectGrounded(s, items);
  });

  it('degrades gracefully when weather and travel are missing', () => {
    const inp = inputs(at(14, 30), [coffee]);
    inp.enabled.add('places_geocode');
    const s = find(detectMoments(inp), 'outing')!;
    expect(s.sections.hourly).toBeUndefined();
    expect(s.missing.map((m) => m.sourceId)).toEqual(expect.arrayContaining(['travel_osrm']));
    expect(s.title).toBe(`Coffee with Sam at ${at(15, 30).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
  });

  it('is not shown for virtual meetings or far-away events, but appears on request', () => {
    const zoom = it_({ id: 'calendar_ics:z', sourceId: 'calendar_ics', kind: 'event', title: 'Sync', location: 'https://zoom.us/j/1', startsAt: iso(at(15)), endsAt: iso(at(16)) });
    expect(find(detectMoments(inputs(at(14, 30), [zoom])), 'outing')).toBeUndefined();
    expect(find(detectMoments(inputs(at(9), [coffee])), 'outing')).toBeUndefined();
    const asked = find(detectMoments(inputs(at(9), [coffee, hourly()], { requested: 'outing' })), 'outing')!;
    expect(asked.title).toContain('Coffee with Sam');
  });

  it('prepares the evening before for tomorrow-morning plans', () => {
    const hike = it_({ id: 'calendar_ics:h', sourceId: 'calendar_ics', kind: 'event', title: 'Hike Rattlesnake Ledge', location: 'Rattlesnake Ledge Trail', startsAt: iso(at(8, 0, 25)), endsAt: iso(at(11, 0, 25)) });
    const s = find(detectMoments(inputs(at(20), [hike, hourly(24)])), 'outing')!;
    expect(s.title).toBe('Tomorrow: Hike Rattlesnake Ledge');
    expect(s.priority).toBe(55);
  });
});

describe('watch', () => {
  const movie = it_({ id: 'media_tmdb:movie:1', sourceId: 'media_tmdb', kind: 'movie', title: 'Arrival', data: { runtime: 116, providers: ['Netflix'], onWatchlist: true, rating: 7.6 } });
  const longMovie = it_({ id: 'media_tmdb:movie:2', sourceId: 'media_tmdb', kind: 'movie', title: 'Oppenheimer', data: { runtime: 180, providers: ['Peacock'], rating: 8.1 } });
  const ep = it_({ id: 'media_tvmaze:9', sourceId: 'media_tvmaze', kind: 'episode', title: 'Severance · S3E2', startsAt: iso(at(18)), data: { runtime: 50, show: 'Severance' } });

  it('picks titles that fit before bedtime, watchlist first, with providers', () => {
    const s = find(detectMoments(inputs(at(20, 15), [movie, longMovie, ep])), 'watch')!;
    expect(s.sections.media!.picks.map((p) => p.title)).toEqual(['Arrival', 'Severance · S3E2']); // 180 min doesn't fit in the 165 min before 23:00
    expect(s.sections.media!.picks[0]).toMatchObject({ providers: 'Netflix', fits: expect.stringMatching(/^Done by /) });
    expect(s.reasons[0]).toMatch(/before your .* bedtime/);
    expect(s.title).toBe('Tonight: Arrival?');
  });

  it('respects the next event as the end of the free window', () => {
    const late = it_({ id: 'calendar_ics:l', sourceId: 'calendar_ics', kind: 'event', title: 'Call with mom', startsAt: iso(at(21, 15)), endsAt: iso(at(21, 45)) });
    const s = find(detectMoments(inputs(at(20), [movie, ep, late])), 'watch')!;
    expect(s.sections.media!.picks.map((p) => p.title)).toEqual(['Severance · S3E2']);
    expect(s.reasons[0]).toContain('Free until Call with mom');
  });

  it('stays out of workday mornings unless asked, and asks to connect media when empty', () => {
    expect(find(detectMoments(inputs(at(10), [movie])), 'watch')).toBeUndefined();
    const asked = find(detectMoments(inputs(at(10), [], { requested: 'watch' })), 'watch')!;
    expect(asked.missing[0].sourceId).toBe('media_tmdb');
  });
});

describe('plan_day, resume, reflect, unfinished, resurface', () => {
  const standup = it_({ id: 'calendar_microsoft:s', sourceId: 'calendar_microsoft', kind: 'event', title: 'Standup', startsAt: iso(at(9, 30)), endsAt: iso(at(9, 45)) });
  const issue = it_({ id: 'projects_github:issue:1', sourceId: 'projects_github', kind: 'task', title: 'Fix login bug', done: false, startsAt: '2026-11-24', data: { project: 'acme/app' } });
  const groceries = it_({ id: 'tasks_todoist:g', sourceId: 'tasks_todoist', kind: 'task', title: 'Groceries', done: false, startsAt: '2026-11-24' });

  it('plans a workday morning and hides work on a day off', () => {
    const s = find(detectMoments(inputs(at(7, 45), [standup, issue, groceries, hourly(), dayWeather])), 'plan_day')!;
    expect(s.sections.timeline!.rows[0].text).toBe('Standup');
    expect(s.sections.checklist!.items.map((i) => i.text)).toEqual(['Fix login bug', 'Groceries']);
    const sat = find(detectMoments(inputs(at(8, 0, 28), [{ ...issue, startsAt: '2026-11-28' }, { ...groceries, startsAt: '2026-11-28' }])), 'plan_day')!;
    expect(sat.sections.checklist!.items.map((i) => i.text)).toEqual(['Groceries']);
    expect(sat.reasons).toContain('Day off — work tasks are hidden');
  });

  it('suggests resuming an idle journal project with the last line and a next step', () => {
    const side: JournalProject = { ...project, id: 2, title: 'Novel notes' };
    const journalProject = it_({ id: 'journal:project:2', sourceId: 'journal', kind: 'project', title: 'Novel notes', data: { projectId: 2, lastActivity: '2026-11-18' } });
    const task = it_({ id: 'tasks_todoist:n', sourceId: 'tasks_todoist', kind: 'task', title: 'Outline chapter 3', done: false, data: { project: 'Novel notes' } });
    const inp = inputs(at(10, 0, 28), [journalProject, task], { journal: { projects: [project, side], entries: [entry(3, '2026-11-18', 'The lighthouse keeper finally opened the door and', false, 2)], todayEntry: null, activeProjectId: 1 } });
    const s = find(detectMoments(inp), 'resume')!;
    expect(s.title).toBe('Pick Novel notes back up?');
    expect(s.sections.project).toMatchObject({ lastActivity: '10 days ago', nextStep: 'Outline chapter 3' });
    expect(s.sections.project!.excerpt).toContain('lighthouse keeper');
    expect(s.actions[0]).toMatchObject({ name: 'open_project', value: '2' });
    expect(s.priority).toBeGreaterThan(55); // weekend boost
  });

  it('does not repeat the resumed project’s draft as an unfinished thought', () => {
    const side: JournalProject = { ...project, id: 2, title: 'Novel notes' };
    const journalProject = it_({ id: 'journal:project:2', sourceId: 'journal', kind: 'project', title: 'Novel notes', data: { projectId: 2, lastActivity: '2026-11-18' } });
    const sameDraft = it_({ id: 'journal:draft:3', sourceId: 'journal', kind: 'thought', title: 'The lighthouse keeper finally opened the door and', startsAt: '2026-11-18', data: { projectId: 2, reasons: ['trails off without an ending'] } });
    const link = it_({ id: 'share_target:s1', sourceId: 'share_target', kind: 'thought', title: 'The art of the unsent letter', startsAt: '2026-11-25', url: 'https://x' });
    const journal = { projects: [project, side], entries: [entry(3, '2026-11-18', 'The lighthouse keeper finally opened the door and', false, 2)], todayEntry: null, activeProjectId: 1 };
    const both = detectMoments(inputs(at(10, 0, 28), [journalProject, sameDraft, link], { journal }));
    expect(find(both, 'resume')).toBeDefined();
    expect(find(both, 'unfinished')!.evidence[0].id).toBe('share_target:s1'); // a different thought
    const onlySame = detectMoments(inputs(at(10, 0, 28), [journalProject, sameDraft], { journal }));
    expect(find(onlySame, 'unfinished')).toBeUndefined(); // nothing else open → no duplicate card
  });

  it('gathers the day for reflection across sources with a grounded prompt', () => {
    const lunch = it_({ id: 'calendar_google:l', sourceId: 'calendar_google', kind: 'event', title: 'Lunch with Ana', startsAt: iso(at(12)), endsAt: iso(at(13)) });
    const done = it_({ id: 'tasks_google:d', sourceId: 'tasks_google', kind: 'task', title: 'Send invoice', done: true, data: { completedAt: iso(at(11)) } });
    const track = it_({ id: 'music_spotify:t', sourceId: 'music_spotify', kind: 'track', title: 'Song', subtitle: 'Phoebe Bridgers', startsAt: iso(at(17)), data: { artist: 'Phoebe Bridgers' } });
    const undated = it_({ id: 'habits_habitica:h', sourceId: 'habits_habitica', kind: 'habit', title: 'Stretch', done: true });
    const items = [standup, lunch, done, undated, track, dayWeather];
    const s = find(detectMoments(inputs(at(21, 30), items)), 'reflect')!;
    // Chronological, undated completions last.
    expect(s.sections.timeline!.rows.map((r) => r.text)).toEqual(['Standup', 'Done: Send invoice', 'Lunch with Ana', 'Done: Stretch']);
    expect(s.sections.timeline!.rows.every((r) => !('at' in r))).toBe(true);
    expect(s.sections.extras!.lines[0].text).toContain('Phoebe Bridgers');
    expect(s.sections.prompt).toBe('You had Standup and Lunch with Ana today — which moment do you want to keep?');
    expect(s.priority).toBe(88);
    expectGrounded(s, items);
  });

  it('brings back an unfinished thought, preferring journal drafts', () => {
    const draft = it_({ id: 'journal:draft:5', sourceId: 'journal', kind: 'thought', title: 'I keep thinking about the move and', startsAt: '2026-11-22', data: { projectId: 1, reasons: ['trails off without an ending'] } });
    const link = it_({ id: 'reading_raindrop:1', sourceId: 'reading_raindrop', kind: 'link', title: 'On slow mornings', startsAt: iso(at(9, 0, 10)), url: 'https://x' });
    const s = find(detectMoments(inputs(at(15), [link, draft], { task: 'thinking' })), 'unfinished')!;
    expect(s.key).toBe('unfinished:journal:draft:5');
    expect(s.summary).toBe('2 days ago · trails off without an ending');
    expect(s.priority).toBe(57);
  });

  it('uses only today’s “on this day” events, never a cached feed from yesterday', () => {
    const old = it_({ id: 'context_onthisday:2026-11-23:0', sourceId: 'context_onthisday', kind: 'onthisday', title: '1963: yesterday’s event', startsAt: '2026-11-23', allDay: true });
    expect(find(detectMoments(inputs(at(8, 30), [old])), 'resurface')).toBeUndefined();
    const fresh = it_({ ...old, id: 'context_onthisday:2026-11-24:0', title: '1859: today’s event', startsAt: '2026-11-24' });
    expect(find(detectMoments(inputs(at(8, 30), [old, fresh])), 'resurface')!.title).toBe('On this day in history');
  });

  it('resurfaces a memory with a highlight', () => {
    const mem = it_({ id: 'journal:memory:1', sourceId: 'journal', kind: 'memory', title: 'First snow on the balcony', subtitle: 'One year ago · Evening Pages', data: { anniversary: 'One year ago' } });
    const hl = it_({ id: 'highlights_readwise:1', sourceId: 'highlights_readwise', kind: 'highlight', title: 'Bird by Bird', data: { text: 'Short assignments.' } });
    const s = find(detectMoments(inputs(at(8, 30), [mem, hl])), 'resurface')!;
    expect(s.title).toBe('One year ago');
    expect(s.sections.extras!.lines[0].text).toContain('Bird by Bird');
  });

  it('respects disabled moments and shows nothing at night unless asked', () => {
    expect(detectMoments(inputs(at(2), [standup, hourly()])).length).toBe(0);
    expect(find(detectMoments(inputs(at(2), [], { requested: 'reflect' })), 'reflect')).toBeDefined();
    expect(find(detectMoments(inputs(at(2), [], { requested: 'watch' })), 'watch')).toBeDefined();
    expect(find(detectMoments(inputs(at(7, 45), [standup], { disabled: ['plan_day'] })), 'plan_day')).toBeUndefined();
  });
});

describe('ranking', () => {
  const mk = (key: string, moment: Suggestion['moment'], priority: number, window: Suggestion['window'] = null): Suggestion => ({ key, moment, title: key, summary: '', priority, window, evidence: [], reasons: [], missing: [], sections: {}, actions: [] });
  const now = at(15).getTime();
  const base = { now, feedback: [], task: 'arriving' as const, density: 'RICH' as const, dailyLimit: 10, shownToday: new Set<string>() };

  it('orders by priority × timeliness and drops expired windows', () => {
    const r = rankSuggestions([mk('a', 'resume', 50), mk('b', 'outing', 75, { from: now, to: now + 20 * 60_000 }), mk('c', 'watch', 90, { from: now - 7200_000, to: now - 60_000 })], base);
    expect(r.visible.map((s) => s.key)).toEqual(['b', 'a']);
  });

  it('applies snoozes, dismissals and learned dismissals', () => {
    const fb = [
      { key: 'a', moment: 'resume', action: 'snoozed' as const, at: now - 1000, until: now + 3600_000 },
      { key: 'x', moment: 'watch', action: 'dismissed' as const, at: now - 86_400_000 },
      { key: 'x2', moment: 'watch', action: 'dismissed' as const, at: now - 86_400_000 },
    ];
    const r = rankSuggestions([mk('a', 'resume', 80), mk('w', 'watch', 70), mk('r', 'reflect', 40)], { ...base, feedback: fb });
    expect(r.hidden).toContainEqual({ key: 'a', reason: 'snoozed' });
    expect(r.visible.map((s) => s.key)).toEqual(['r', 'w']); // watch down-weighted to 70*0.36
  });

  it('caps new cards per day and stays quiet while writing', () => {
    const r = rankSuggestions([mk('a', 'resume', 80), mk('b', 'reflect', 70), mk('c', 'watch', 60)], { ...base, dailyLimit: 2, shownToday: new Set(['c']) });
    expect(r.visible.map((s) => s.key)).toEqual(['a', 'c']);
    expect(r.hidden).toContainEqual({ key: 'b', reason: 'cap' });
    const w = rankSuggestions([mk('a', 'resume', 80), mk('o', 'outing', 92, { from: now, to: now + 10 * 60_000 })], { ...base, task: 'writing' });
    expect(w.quiet).toBe(true);
    expect(w.visible.map((s) => s.key)).toEqual(['o']);
  });
});
