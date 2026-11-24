import { proposeSetupFromBrief } from './fallbackEngine';
import {
  CADENCE_LABELS,
  estimatedWordsPerPage,
  isWeatherStale,
  type AiAvailabilityState,
  type DeskContextSnapshot,
  type FocusTimerState,
  type JournalEntry,
  type JournalProject,
  type PromptHistoryItem,
  type WeatherSnapshot,
} from './models';
import { countWords, daysBetween, formatMonthDay, formatTime, localDateIso, parseLocalDate, parseLocalDateTime, cToDisplay } from './time';
import { TASK_LABELS, type TaskKind } from './taskContext';

/**
 * Proactive insight engine. Everything here is computed locally from data the app already
 * stores; nothing is sent anywhere. The desk agent turns the result into A2UI messages.
 */

export type InsightKind =
  | 'rhythm'
  | 'window'
  | 'weather'
  | 'daylight'
  | 'theme'
  | 'progress'
  | 'focus'
  | 'milestone'
  | 'care'
  | 'continuity'
  | 'pattern'
  | 'status'
  | 'setup'
  | 'nudge'
  | 'project';

export type InsightTone = 'neutral' | 'positive' | 'attention';

export interface InsightAction {
  label: string;
  name: DeskActionName;
}

export type DeskActionName =
  | 'use_starter'
  | 'next_angle'
  | 'start_focus'
  | 'start_break'
  | 'refresh_surface'
  | 'dismiss_surface'
  | 'refresh_weather'
  | 'mark_done'
  | 'tighten_draft'
  | 'open_history'
  | 'open_settings'
  | 'open_today'
  | 'export_backup'
  | 'snooze_insight';

export interface Insight {
  id: string;
  kind: InsightKind;
  /** Lower = more important. Task relevance is applied on top of this. */
  priority: number;
  tone: InsightTone;
  title: string;
  body: string;
  action?: InsightAction;
}

export interface Metric {
  id: string;
  label: string;
  value: string;
  hint?: string;
}

export interface InsightContext {
  task: TaskKind;
  now: Date;
  project: JournalProject | null;
  projects: JournalProject[];
  todayEntry: JournalEntry | null;
  /** Entries of the active project, any order. */
  entries: JournalEntry[];
  history: PromptHistoryItem[];
  snapshot: DeskContextSnapshot | null;
  weather: WeatherSnapshot | null;
  useCelsius: boolean;
  timer: FocusTimerState;
  focusBlocksToday: number;
  draftWords: number;
  discreet: boolean;
  lastBackupAt: number | null;
  storagePersisted: boolean | null;
  ai: AiAvailabilityState;
  aiConnected: boolean;
  installed: boolean;
  /** Brief being typed in the project editor, for the live setup preview. */
  editorBrief: string;
  /** Last-activity date per project id (for the Projects screen). */
  projectActivity: Record<number, { lastDateIso: string | null; completed: number; total: number }>;
}

export interface TaskComposition {
  task: TaskKind;
  taskLabel: string;
  headline: string;
  detail: string;
  metrics: Metric[];
  insights: Insight[];
}

/** Which insight kinds matter for each task, most relevant first. Kinds not listed are hidden. */
const TASK_RELEVANCE: Record<TaskKind, InsightKind[]> = {
  arriving: ['rhythm', 'window', 'continuity', 'theme', 'weather', 'daylight', 'milestone', 'care', 'nudge'],
  thinking: ['nudge', 'theme', 'continuity', 'window', 'daylight', 'weather', 'rhythm'],
  writing: ['progress', 'focus', 'nudge'],
  break: ['focus', 'daylight', 'weather', 'progress', 'rhythm'],
  wrapping_up: ['progress', 'nudge', 'focus', 'rhythm'],
  done: ['milestone', 'rhythm', 'window', 'care', 'weather', 'pattern', 'theme'],
  setting_up: ['setup', 'status'],
  organizing: ['project', 'care', 'rhythm'],
  reviewing: ['pattern', 'theme', 'milestone', 'care'],
  configuring: ['status', 'care', 'weather'],
  ambient: ['rhythm', 'window', 'daylight', 'weather', 'milestone'],
};

const LIMITS = {
  RICH: { insights: 8, metrics: 4, writingInsights: 3 },
  CALM: { insights: 2, metrics: 3, writingInsights: 1 },
} as const;

export function composeForTask(ctx: InsightContext, density: 'RICH' | 'CALM', snoozed: string[] = []): TaskComposition {
  const relevance = TASK_RELEVANCE[ctx.task];
  const all = buildInsights(ctx).filter((i) => !snoozed.includes(i.id));
  const limit = ctx.task === 'writing' ? LIMITS[density].writingInsights : LIMITS[density].insights;
  const insights = all
    .filter((i) => relevance.includes(i.kind))
    .sort((a, b) => relevance.indexOf(a.kind) * 10 + a.priority - (relevance.indexOf(b.kind) * 10 + b.priority))
    .slice(0, limit);
  const { headline, detail } = headlineFor(ctx);
  return { task: ctx.task, taskLabel: TASK_LABELS[ctx.task], headline, detail, metrics: buildMetrics(ctx).slice(0, LIMITS[density].metrics), insights };
}

/* ----------------------------------- helpers ----------------------------------- */

function completedEntries(entries: JournalEntry[]) {
  return entries.filter((e) => e.isCompleted);
}

/** Consecutive completed days ending today (or yesterday, if today isn't done yet). */
export function currentStreak(entries: JournalEntry[], now: Date): number {
  const done = new Set(completedEntries(entries).map((e) => e.dateIso));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!done.has(localDateIso(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (done.has(localDateIso(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function longestStreak(entries: JournalEntry[]): number {
  const days = Array.from(new Set(completedEntries(entries).map((e) => e.dateIso))).sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const iso of days) {
    const d = parseLocalDate(iso);
    if (!d) continue;
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Typical finishing time (median hour + minute of completion), once there are 3+ completions. */
export function usualWindow(entries: JournalEntry[]): { hour: number; minute: number } | null {
  const mins = completedEntries(entries)
    .map((e) => e.completedAtEpochMs)
    .filter((t): t is number => t != null)
    .map((t) => {
      const d = new Date(t);
      return d.getHours() * 60 + d.getMinutes();
    })
    .sort((a, b) => a - b);
  if (mins.length < 3) return null;
  const m = mins[Math.floor(mins.length / 2)];
  return { hour: Math.floor(m / 60), minute: Math.round((m % 60) / 15) * 15 % 60 };
}

function lastCompletedDate(entries: JournalEntry[]): Date | null {
  const latest = completedEntries(entries).reduce<string | null>((best, e) => (!best || e.dateIso > best ? e.dateIso : best), null);
  return latest ? parseLocalDate(latest) : null;
}

function fmtDuration(mins: number): string {
  const m = Math.max(1, Math.round(mins));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function clock(secs: number) {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function sessionsSinceTheme(theme: string, history: PromptHistoryItem[]): number | null {
  const tokens = theme.toLowerCase().split(/[\s&,/]+/).filter((t) => t.length >= 4).map((t) => t.slice(0, 5));
  if (!tokens.length) return null;
  const sorted = [...history].sort((a, b) => b.createdAtEpochMs - a.createdAtEpochMs);
  const idx = sorted.findIndex((h) => {
    const text = `${h.topicTag} ${h.promptText}`.toLowerCase();
    return tokens.some((t) => text.includes(t));
  });
  return idx === -1 ? sorted.length : idx;
}

function minutesToSunset(weather: WeatherSnapshot | null, now: Date): number | null {
  if (!weather?.sunsetIso) return null;
  const ss = parseLocalDateTime(weather.sunsetIso);
  if (!ss) return null;
  const sunset = new Date(now.getFullYear(), now.getMonth(), now.getDate(), ss.getHours(), ss.getMinutes());
  const mins = (sunset.getTime() - now.getTime()) / 60_000;
  return mins > 0 ? mins : null;
}

/* ---------------------------------- generators ---------------------------------- */

export function buildInsights(ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  const { now, project, entries, todayEntry, discreet } = ctx;
  const est = project ? estimatedWordsPerPage(project) : null;
  const todayDone = todayEntry?.isCompleted === true;
  const completed = completedEntries(entries);

  if (project) {
    // Rhythm & streaks
    const streak = currentStreak(entries, now);
    const cadence = project.cadence;
    const last = lastCompletedDate(entries);
    const sinceLast = last ? daysBetween(last, now) : null;
    if (streak >= 2) {
      out.push({
        id: 'streak',
        kind: 'rhythm',
        priority: 0,
        tone: 'positive',
        title: `${streak}-day streak`,
        body: todayDone ? 'Today extended it. See you tomorrow.' : 'One page today keeps it going.',
      });
    }
    if (cadence === 'WEEKLY' && !todayDone && sinceLast != null && sinceLast >= 6) {
      out.push({ id: 'weekly-due', kind: 'rhythm', priority: 1, tone: 'attention', title: 'Weekly page due', body: `Last page ${sinceLast} days ago — today keeps your weekly rhythm.` });
    } else if (cadence === 'DAILY' && !todayDone && sinceLast != null && sinceLast >= 2) {
      out.push({ id: 'daily-gap', kind: 'rhythm', priority: 2, tone: 'neutral', title: 'Picking back up', body: `Last page ${sinceLast} days ago. A few lines today is plenty.` });
    } else if (cadence === 'WHENEVER' && sinceLast != null && sinceLast >= 7 && !todayDone) {
      out.push({ id: 'whenever-gap', kind: 'rhythm', priority: 2, tone: 'neutral', title: `${sinceLast} days since your last page`, body: 'No pressure — the notebook is ready whenever you are.' });
    }
    if (ctx.task === 'done') {
      const next = cadence === 'WEEKLY' ? (() => {
        const d = new Date(now);
        d.setDate(d.getDate() + 7);
        return formatMonthDay(d);
      })() : cadence === 'DAILY' ? 'tomorrow' : null;
      out.push({
        id: 'next-session',
        kind: 'rhythm',
        priority: 3,
        tone: 'neutral',
        title: next ? `Next page: ${next}` : 'Page saved',
        body: cadence ? `${CADENCE_LABELS[cadence]} rhythm · a new question will be waiting.` : 'A new question will be waiting next time you open it.',
      });
    }

    // Yesterday left open
    const yIso = localDateIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const yesterday = entries.find((e) => e.dateIso === yIso);
    if (yesterday && !yesterday.isCompleted) {
      out.push({
        id: 'yesterday-open',
        kind: 'continuity',
        priority: 1,
        tone: 'neutral',
        title: "Yesterday's page was left open",
        body: discreet ? 'Revisit it in History, or let it go.' : `“${yesterday.promptText.slice(0, 90)}${yesterday.promptText.length > 90 ? '…' : ''}” — revisit or let it go.`,
        action: { label: 'Open History', name: 'open_history' },
      });
    }
    // Last note excerpt (same rule as the companion card)
    const snap = ctx.snapshot;
    if (snap?.recentNoteExcerpt && snap.includePastAnswersInPrompts && !discreet) {
      out.push({ id: 'last-note', kind: 'continuity', priority: 2, tone: 'neutral', title: `Your note from ${snap.recentNoteDayLabel ?? 'last time'}`, body: `“${snap.recentNoteExcerpt}”` });
    }

    // Usual writing window
    const win = usualWindow(entries);
    if (win && !todayDone) {
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), win.hour, win.minute);
      const diff = (target.getTime() - now.getTime()) / 60_000;
      const at = formatTime(target);
      out.push(
        diff > 0
          ? { id: 'window', kind: 'window', priority: diff <= 360 ? 0 : 3, tone: 'neutral', title: `You usually finish around ${at}`, body: diff <= 360 ? `That's in ${fmtDuration(diff)}.` : 'No rush — that’s hours away.' }
          : { id: 'window', kind: 'window', priority: 1, tone: 'neutral', title: `Past your usual ${at} window`, body: 'A short page still counts.' },
      );
    } else if (win && ctx.task === 'done') {
      out.push({ id: 'window', kind: 'window', priority: 2, tone: 'neutral', title: `Your usual window: ${formatTime(new Date(2000, 0, 1, win.hour, win.minute))}`, body: 'Based on when you mark pages done.' });
    }

    // Themes
    if (ctx.history.length >= 2) {
      const ranked = project.themes
        .map((t) => ({ t, since: sessionsSinceTheme(t, ctx.history) }))
        .filter((x): x is { t: string; since: number } => x.since != null && x.since >= 2)
        .sort((a, b) => b.since - a.since);
      if (ranked[0]) {
        out.push({
          id: `theme-${ranked[0].t}`,
          kind: 'theme',
          priority: 0,
          tone: 'neutral',
          title: `“${ranked[0].t}” is waiting`,
          body: ranked[0].since >= ctx.history.length ? 'It hasn’t come up yet in this notebook.' : `It hasn’t come up in ${ranked[0].since} sessions.`,
          action: ctx.task === 'thinking' || ctx.task === 'arriving' ? { label: 'Next angle', name: 'next_angle' } : undefined,
        });
      }
    }

    // Draft progress
    if (ctx.draftWords > 0 || ctx.task === 'writing' || ctx.task === 'wrapping_up') {
      if (est) {
        const remaining = Math.max(0, est - ctx.draftWords);
        out.push({
          id: 'progress',
          kind: 'progress',
          priority: 0,
          tone: remaining === 0 ? 'positive' : 'neutral',
          title: `${ctx.draftWords} of ~${est} words`,
          body: remaining === 0 ? 'That fills your page estimate.' : `About ${fmtDuration(remaining / 25)} of pen left.`,
        });
      } else if (ctx.draftWords > 0) {
        out.push({ id: 'progress', kind: 'progress', priority: 0, tone: 'neutral', title: `${ctx.draftWords} words noted`, body: 'Your note is saved on this device as you type.' });
      }
    }

    // Wrap-up & thinking nudges
    if (ctx.task === 'wrapping_up') {
      out.push({ id: 'mark-done', kind: 'nudge', priority: 0, tone: 'positive', title: 'Ready to call it a page?', body: 'Mark today done — the page itself can stay on paper.', action: { label: 'Mark done', name: 'mark_done' } });
      if (ctx.draftWords >= 15) out.push({ id: 'tighten', kind: 'nudge', priority: 1, tone: 'neutral', title: 'Want a tighter version?', body: 'Get an editable, lightly tightened draft. Yours only changes if you accept.', action: { label: 'Tighten', name: 'tighten_draft' } });
    }
    if (ctx.task === 'thinking') {
      if (!ctx.timer.isRunning) out.push({ id: 'focus-10', kind: 'nudge', priority: 0, tone: 'neutral', title: 'Try a 10-minute sprint', body: 'A timer often makes the first line easier.', action: { label: 'Start 10m', name: 'start_focus' } });
      out.push({ id: 'starter', kind: 'nudge', priority: 1, tone: 'neutral', title: 'Borrow the starter', body: 'Drop the sentence starter into your note and keep going on paper.', action: { label: 'Use starter', name: 'use_starter' } });
    }
    if (ctx.task === 'writing' && !ctx.timer.isRunning && ctx.draftWords === 0) {
      out.push({ id: 'starter-w', kind: 'nudge', priority: 2, tone: 'neutral', title: 'Stuck on line one?', body: 'Use the starter, then switch to paper.', action: { label: 'Use starter', name: 'use_starter' } });
    }

    // Milestones
    const n = completed.length;
    if ([1, 5, 10, 25, 50, 100, 200, 365].includes(n) && (ctx.task === 'done' || completed.some((e) => e.dateIso === localDateIso(now)))) {
      out.push({ id: `milestone-${n}`, kind: 'milestone', priority: 0, tone: 'positive', title: n === 1 ? 'First page done' : `${n} pages done`, body: n === 1 ? 'The hardest one is behind you.' : 'Every one of them on paper.' });
    }
    const ageDays = daysBetween(new Date(project.createdAtEpochMs), now);
    if (ageDays >= 30 && n >= 4) {
      out.push({ id: 'age', kind: 'milestone', priority: 3, tone: 'positive', title: `${Math.floor(ageDays / 30) >= 2 ? `${Math.floor(ageDays / 30)} months` : 'A month'} with this notebook`, body: `${n} pages since ${formatMonthDay(new Date(project.createdAtEpochMs))}.` });
    }
  }

  // Focus timer
  if (ctx.timer.isRunning) {
    out.push({
      id: 'timer',
      kind: 'focus',
      priority: 0,
      tone: 'neutral',
      title: ctx.timer.phase === 'FOCUS' ? `Sprint · ${clock(ctx.timer.remainingSeconds)} left` : `Break · ${clock(ctx.timer.remainingSeconds)} left`,
      body: ctx.timer.phase === 'FOCUS' ? 'Stay with the page; everything else can wait.' : 'Stretch, look away from screens, breathe.',
    });
  } else if (ctx.timer.justFinishedPhase === 'FOCUS') {
    out.push({ id: 'timer-done', kind: 'focus', priority: 0, tone: 'positive', title: 'Sprint complete', body: 'Take five, or mark the page done.', action: { label: '5m break', name: 'start_break' } });
  }
  if (ctx.focusBlocksToday > 0) {
    out.push({ id: 'blocks', kind: 'focus', priority: 2, tone: 'positive', title: `${ctx.focusBlocksToday} focus block${ctx.focusBlocksToday === 1 ? '' : 's'} today`, body: 'Counted on this device; your writing is never timed or read.' });
  }

  // Weather & daylight
  const w = ctx.weather;
  if (w) {
    if (isWeatherStale(w, now.getTime())) {
      out.push({ id: 'weather-stale', kind: 'weather', priority: 1, tone: 'attention', title: 'Weather is out of date', body: `Last updated ${formatMonthDay(new Date(w.fetchedAtEpochMs))}, ${formatTime(new Date(w.fetchedAtEpochMs))}.`, action: { label: 'Refresh', name: 'refresh_weather' } });
    } else {
      const u = ctx.useCelsius ? '°C' : '°F';
      if (w.precipitationChancePercent != null && w.precipitationChancePercent >= 50) {
        out.push({ id: 'rain', kind: 'weather', priority: 0, tone: 'neutral', title: `${w.precipitationChancePercent}% chance of rain ${w.precipitationPeriodLabel ?? 'today'}`, body: 'A good stretch to stay in with the notebook.' });
      } else {
        out.push({ id: 'weather-now', kind: 'weather', priority: 2, tone: 'neutral', title: `${w.conditionLabel}, ${cToDisplay(w.temperatureCelsius, ctx.useCelsius)}${u}`, body: `${w.cityLabel} · H ${cToDisplay(w.highCelsius, ctx.useCelsius)}° / L ${cToDisplay(w.lowCelsius, ctx.useCelsius)}°` });
      }
    }
    const toSunset = minutesToSunset(w, now);
    if (toSunset != null && toSunset <= 120) {
      out.push({
        id: 'sunset',
        kind: 'daylight',
        priority: 0,
        tone: 'neutral',
        title: `${fmtDuration(toSunset)} of daylight left`,
        body: ctx.task === 'break' ? 'Step outside for a minute of sun before you continue.' : 'Window light is softest now — nice for writing by hand.',
      });
    }
  } else if (project?.showWeatherCard && (ctx.task === 'arriving' || ctx.task === 'configuring')) {
    out.push({ id: 'weather-missing', kind: 'weather', priority: 4, tone: 'neutral', title: 'Add your city', body: 'Unlocks weather, rain and daylight cues on the desk.', action: { label: 'Settings', name: 'open_settings' } });
  }

  // Care: backups, storage, AI
  const lastBackupDays = ctx.lastBackupAt ? daysBetween(new Date(ctx.lastBackupAt), now) : null;
  const totalEntries = Object.values(ctx.projectActivity).reduce((s, p) => s + p.total, 0) || entries.length;
  if (totalEntries >= 5 && (lastBackupDays == null || lastBackupDays >= 30)) {
    out.push({
      id: 'backup',
      kind: 'care',
      priority: 1,
      tone: 'attention',
      title: lastBackupDays == null ? 'No backup yet' : `Last backup ${lastBackupDays} days ago`,
      body: 'Your journal lives only in this browser. Export a copy to keep it safe.',
      action: { label: 'Export', name: 'export_backup' },
    });
  }
  if (ctx.task === 'configuring' || ctx.task === 'organizing') {
    if (ctx.storagePersisted === false) {
      out.push({ id: 'storage', kind: 'status', priority: 0, tone: 'attention', title: 'Storage can be cleared by the browser', body: ctx.installed ? 'Export backups regularly.' : 'Install the app so the browser keeps your journal storage persistent.' });
    }
    out.push(
      ctx.aiConnected
        ? ctx.ai.kind === 'available'
          ? { id: 'ai', kind: 'status', priority: 2, tone: 'positive', title: 'AI is on (OpenRouter)', body: 'Prompts, hints and draft help use your chosen model.' }
          : { id: 'ai', kind: 'status', priority: 1, tone: 'attention', title: 'AI needs attention', body: ctx.ai.kind === 'error' ? ctx.ai.message : ctx.ai.kind === 'unavailable' ? ctx.ai.reason : 'Checking…' }
        : { id: 'ai', kind: 'status', priority: 3, tone: 'neutral', title: 'Using built-in prompts', body: 'Connect OpenRouter below for AI-written prompts and draft help.' },
    );
  }

  // History patterns
  if (ctx.task === 'reviewing' || ctx.task === 'done') {
    if (entries.length >= 2) {
      const rate = Math.round((completed.length / entries.length) * 100);
      out.push({ id: 'rate', kind: 'pattern', priority: 1, tone: 'neutral', title: `${rate}% of opened pages finished`, body: `${completed.length} of ${entries.length} sessions marked done.` });
      const best = longestStreak(entries);
      if (best >= 2) out.push({ id: 'longest', kind: 'pattern', priority: 2, tone: 'positive', title: `Longest streak: ${best} days`, body: 'Consecutive days with a finished page.' });
      const byDay = new Array(7).fill(0);
      completed.forEach((e) => {
        const d = parseLocalDate(e.dateIso);
        if (d) byDay[d.getDay()]++;
      });
      const top = byDay.indexOf(Math.max(...byDay));
      if (completed.length >= 4) {
        const dayName = new Date(2024, 0, 7 + top).toLocaleDateString(undefined, { weekday: 'long' });
        out.push({ id: 'best-day', kind: 'pattern', priority: 3, tone: 'neutral', title: `${dayName}s are your strongest day`, body: `${byDay[top]} finished pages on ${dayName}s.` });
      }
      const words = entries.reduce((s, e) => s + countWords(e.draftText), 0);
      if (words > 0 && !discreet) out.push({ id: 'words', kind: 'pattern', priority: 4, tone: 'neutral', title: `${words.toLocaleString()} words in digital notes`, body: 'Paper pages aren’t counted — they’re yours alone.' });
    }
    if (project && ctx.snapshot && ctx.snapshot.coveredThemes.length) {
      out.push({ id: 'covered', kind: 'theme', priority: 3, tone: 'neutral', title: 'Themes explored so far', body: ctx.snapshot.coveredThemes.join(' · ') });
    }
  }

  // Projects overview
  if (ctx.task === 'organizing') {
    ctx.projects.forEach((p, i) => {
      const a = ctx.projectActivity[p.id];
      if (!a) return;
      const lastD = a.lastDateIso ? parseLocalDate(a.lastDateIso) : null;
      const ago = lastD ? daysBetween(lastD, now) : null;
      out.push({
        id: `project-${p.id}`,
        kind: 'project',
        priority: i,
        tone: ago != null && ago > 7 ? 'attention' : 'neutral',
        title: p.title,
        body: `${a.completed} of ${a.total} pages done · ${ago == null ? 'not started' : ago === 0 ? 'active today' : ago === 1 ? 'last opened yesterday' : `last opened ${ago} days ago`}`,
      });
    });
  }

  // Live setup preview while typing a brief
  if (ctx.task === 'setting_up') {
    const brief = ctx.editorBrief.trim();
    if (brief.length >= 12) {
      const preview = proposeSetupFromBrief(brief);
      const found = [
        preview.cadence ? `Cadence: ${CADENCE_LABELS[preview.cadence]}` : null,
        preview.pageSizeLabel ? `Page: ${preview.pageSizeLabel}` : null,
        preview.audience ? `For: ${preview.audience}` : null,
      ].filter(Boolean);
      out.push({ id: 'setup-detected', kind: 'setup', priority: 0, tone: 'neutral', title: found.length ? 'Detected so far' : 'Keep describing it', body: found.length ? found.join(' · ') : 'Mention size, how often, who it’s for, and the tone you want.' });
      out.push({ id: 'setup-themes', kind: 'setup', priority: 1, tone: 'neutral', title: 'Likely themes', body: preview.themes.join(' · ') });
      if (preview.pageSizeLabel) {
        out.push({ id: 'setup-grid', kind: 'setup', priority: 2, tone: 'neutral', title: `About ${preview.linesPerPage * preview.wordsPerLine} words per page`, body: `${preview.linesPerPage} lines × ${preview.wordsPerLine} words — adjustable, never a limit.` });
      }
      out.push({ id: 'setup-sample', kind: 'setup', priority: 3, tone: 'neutral', title: 'A first question might be', body: preview.firstPrompt });
    } else {
      out.push({ id: 'setup-start', kind: 'setup', priority: 0, tone: 'neutral', title: 'Describe your notebook', body: 'Size, how often you write, who it’s for, tone, and anything to avoid.' });
    }
    out.push({
      id: 'setup-privacy',
      kind: 'setup',
      priority: 4,
      tone: 'neutral',
      title: 'Where your brief goes',
      body: ctx.aiConnected ? 'Saved on this device. Sent to OpenRouter only when you tap Propose with AI.' : 'Saved on this device and analyzed locally.',
    });
  }

  return out;
}

/* ------------------------------------ metrics ------------------------------------ */

export function buildMetrics(ctx: InsightContext): Metric[] {
  const { entries, project, now } = ctx;
  const completed = completedEntries(entries).length;
  const est = project ? estimatedWordsPerPage(project) : null;
  const streak = currentStreak(entries, now);
  switch (ctx.task) {
    case 'writing':
    case 'wrapping_up':
      return [
        { id: 'words', label: 'Words', value: est ? `${ctx.draftWords}/${est}` : String(ctx.draftWords) },
        ...(ctx.timer.isRunning ? [{ id: 'timer', label: ctx.timer.phase === 'FOCUS' ? 'Sprint' : 'Break', value: clock(ctx.timer.remainingSeconds) }] : []),
        { id: 'blocks', label: 'Sprints', value: String(ctx.focusBlocksToday) },
        { id: 'streak', label: 'Streak', value: `${streak}d` },
      ];
    case 'break':
      return [
        { id: 'timer', label: 'Break', value: clock(ctx.timer.remainingSeconds) },
        { id: 'blocks', label: 'Sprints', value: String(ctx.focusBlocksToday) },
        ...(est ? [{ id: 'words', label: 'Words', value: `${ctx.draftWords}/${est}` }] : []),
      ];
    case 'reviewing':
      return [
        { id: 'pages', label: 'Pages', value: String(completed) },
        { id: 'rate', label: 'Finished', value: entries.length ? `${Math.round((completed / entries.length) * 100)}%` : '—' },
        { id: 'longest', label: 'Best streak', value: `${longestStreak(entries)}d` },
        { id: 'streak', label: 'Current', value: `${streak}d` },
      ];
    case 'configuring': {
      const backup = ctx.lastBackupAt ? `${daysBetween(new Date(ctx.lastBackupAt), now)}d ago` : 'Never';
      const weatherAge = ctx.weather ? (isWeatherStale(ctx.weather, now.getTime()) ? 'Stale' : 'Fresh') : 'None';
      return [
        { id: 'ai', label: 'AI', value: ctx.aiConnected ? (ctx.ai.kind === 'available' ? 'On' : 'Check') : 'Templates' },
        { id: 'backup', label: 'Backup', value: backup },
        { id: 'storage', label: 'Storage', value: ctx.storagePersisted ? 'Persistent' : ctx.storagePersisted === false ? 'Best-effort' : '—' },
        { id: 'weather', label: 'Weather', value: weatherAge },
      ];
    }
    case 'organizing':
      return [
        { id: 'projects', label: 'Projects', value: String(ctx.projects.length) },
        { id: 'pages', label: 'Pages', value: String(Object.values(ctx.projectActivity).reduce((s, p) => s + p.completed, 0)) },
      ];
    case 'setting_up':
      return [];
    default:
      return [
        { id: 'streak', label: 'Streak', value: `${streak}d` },
        { id: 'pages', label: 'Pages', value: String(completed) },
        { id: 'blocks', label: 'Sprints today', value: String(ctx.focusBlocksToday) },
        ...(ctx.snapshot?.untappedThemes.length ? [{ id: 'themes', label: 'Themes left', value: String(ctx.snapshot.untappedThemes.length) }] : []),
      ];
  }
}

/* ----------------------------------- headline ----------------------------------- */

function greeting(now: Date) {
  const h = now.getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function headlineFor(ctx: InsightContext): { headline: string; detail: string } {
  const est = ctx.project ? estimatedWordsPerPage(ctx.project) : null;
  switch (ctx.task) {
    case 'arriving':
      return { headline: `${greeting(ctx.now)} — today's page is open`, detail: ctx.snapshot?.writingWindowCue ?? '' };
    case 'thinking':
      return { headline: 'Taking a moment?', detail: 'A few ways in, if the first line is slow to come.' };
    case 'writing':
      return { headline: 'Writing', detail: est ? `${ctx.draftWords} of ~${est} words` : ctx.timer.isRunning ? `Sprint · ${clock(ctx.timer.remainingSeconds)} left` : 'Everything else can wait.' };
    case 'break':
      return { headline: `Break · ${clock(ctx.timer.remainingSeconds)} left`, detail: `${ctx.focusBlocksToday} sprint${ctx.focusBlocksToday === 1 ? '' : 's'} done today` };
    case 'wrapping_up':
      return { headline: 'Nearly there', detail: 'Finish the thought, then mark the page done.' };
    case 'done':
      return { headline: "Today's page is done", detail: `${currentStreak(ctx.entries, ctx.now)}-day streak` };
    case 'setting_up':
      return { headline: 'Setting up your notebook', detail: 'Live preview of what the app picks up from your brief.' };
    case 'organizing':
      return { headline: 'Your notebooks', detail: `${ctx.projects.length} project${ctx.projects.length === 1 ? '' : 's'} on this device` };
    case 'reviewing':
      return { headline: 'Your notebook so far', detail: ctx.project?.title ?? '' };
    case 'configuring':
      return { headline: 'Status at a glance', detail: 'Storage, backups, AI and weather.' };
    case 'ambient':
      return { headline: ctx.todayEntry?.isCompleted ? "Today's page is done" : "Today's question is waiting", detail: '' };
  }
}
