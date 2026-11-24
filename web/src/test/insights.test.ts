import { describe, expect, it } from 'vitest';
import { buildInsights, composeForTask, currentStreak, longestStreak, usualWindow, type InsightContext } from '../core/insights';
import { detectTask, type TaskSignals } from '../core/taskContext';
import type { FocusTimerState, JournalEntry, JournalProject, PromptHistoryItem } from '../core/models';

const NOW = new Date(2026, 10, 24, 18, 0); // Nov 24, 6 PM
const iso = (daysAgo: number) => {
  const d = new Date(2026, 10, 24 - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let id = 0;
const entry = (daysAgo: number, done: boolean, hour = 21, draft = ''): JournalEntry => ({
  id: ++id, projectId: 1, dateIso: iso(daysAgo), promptText: `Prompt ${daysAgo}`, promptTopicTag: 'x', hints: [], draftText: draft, isCompleted: done,
  completedAtEpochMs: done ? new Date(2026, 10, 24 - daysAgo, hour, 0).getTime() : null, updatedAtEpochMs: 0,
});
const project: JournalProject = {
  id: 1, title: 'Pages', writingGoal: 'g', originalBrief: 'brief about my friend', audience: 'Friend', cadence: 'DAILY', pageSizeLabel: 'A6', entryLengthLabel: null,
  linesPerPage: 16, wordsPerLine: 7, themes: ['appreciation', 'shared routines'], tonePreferences: null, boundaries: null, includePastAnswersInPrompts: false,
  showDateTimeCard: true, showWeatherCard: true, showSparksCard: true, showRhythmCard: true, showTimerCard: true, includeDateTimeInPrompt: false,
  includeWeatherInPrompt: false, createdAtEpochMs: new Date(2026, 9, 1).getTime(), updatedAtEpochMs: 0,
};
const timer: FocusTimerState = { phase: 'FOCUS', presetMinutes: 15, remainingSeconds: 900, totalSeconds: 900, isRunning: false, endsAtEpochMs: null, justFinishedPhase: null };
const hist = (n: number, text: string): PromptHistoryItem => ({ id: n, projectId: 1, dateIso: iso(n), promptText: text, topicTag: 'x', createdAtEpochMs: 1000 - n });

function ctx(over: Partial<InsightContext> = {}): InsightContext {
  const entries = [entry(0, false), entry(1, true), entry(2, true), entry(3, true, 20)];
  return {
    task: 'arriving', now: NOW, project, projects: [project], todayEntry: entries[0], entries,
    history: [hist(0, 'appreciation of a habit'), hist(1, 'appreciation again'), hist(2, 'appreciate x'), hist(3, 'thanks')],
    snapshot: null, weather: null, useCelsius: false, timer, focusBlocksToday: 0, draftWords: 0, discreet: false, lastBackupAt: null,
    storagePersisted: true, ai: { kind: 'unavailable', reason: 'none' }, aiConnected: false, installed: false, editorBrief: '',
    projectActivity: { 1: { lastDateIso: iso(0), completed: 3, total: 4 } }, ...over,
  };
}

describe('streaks & windows', () => {
  it('counts the current streak through yesterday when today is open', () => {
    expect(currentStreak(ctx().entries, NOW)).toBe(3);
    expect(longestStreak([entry(0, true), entry(1, true), entry(5, true)])).toBe(2);
  });
  it('finds the usual finishing time', () => {
    expect(usualWindow(ctx().entries)).toEqual({ hour: 21, minute: 0 });
    expect(usualWindow([entry(1, true)])).toBeNull();
  });
  it('only counts down to the usual window when it is within six hours', () => {
    const soon = buildInsights(ctx()).find((i) => i.id === 'window')!;
    expect(soon.body).toBe("That's in 3h 0m.");
    const early = buildInsights(ctx({ now: new Date(2026, 10, 24, 3, 30) })).find((i) => i.id === 'window')!;
    expect(early.body).not.toMatch(/That's in/);
  });
});

describe('insights', () => {
  it('surfaces streak, window and neglected theme on arrival', () => {
    const ids = composeForTask(ctx(), 'RICH').insights.map((i) => i.id);
    expect(ids).toContain('streak');
    expect(ids).toContain('window');
    expect(ids).toContain('theme-shared routines');
    expect(ids).not.toContain('theme-appreciation');
  });

  it('flags an overdue weekly page and a page left open yesterday', () => {
    const entries = [entry(0, false), entry(1, false), entry(8, true)];
    const ins = buildInsights(ctx({ project: { ...project, cadence: 'WEEKLY' }, entries, todayEntry: entries[0] }));
    expect(ins.find((i) => i.id === 'weekly-due')?.body).toContain('8 days');
    expect(ins.find((i) => i.id === 'yesterday-open')?.action?.name).toBe('open_history');
  });

  it('reminds about backups once there is something to lose', () => {
    const many = { 1: { lastDateIso: iso(0), completed: 5, total: 6 } };
    expect(buildInsights(ctx({ projectActivity: many })).some((i) => i.id === 'backup')).toBe(true);
    expect(buildInsights(ctx({ projectActivity: many, lastBackupAt: NOW.getTime() - 86_400_000 })).some((i) => i.id === 'backup')).toBe(false);
  });

  it('keeps writing calm and shows progress', () => {
    const c = composeForTask(ctx({ task: 'writing', draftWords: 40 }), 'RICH');
    expect(c.insights.length).toBeLessThanOrEqual(3);
    expect(c.insights[0].id).toBe('progress');
    expect(c.insights[0].title).toBe('40 of ~112 words');
    expect(c.metrics[0]).toMatchObject({ label: 'Words', value: '40/112' });
  });

  it('suggests a sprint and the starter when thinking', () => {
    const ids = composeForTask(ctx({ task: 'thinking' }), 'RICH').insights.map((i) => i.id);
    expect(ids.slice(0, 2)).toEqual(['focus-10', 'starter']);
  });

  it('nudges to mark done when wrapping up', () => {
    const c = composeForTask(ctx({ task: 'wrapping_up', draftWords: 100 }), 'RICH');
    expect(c.insights.map((i) => i.action?.name)).toContain('mark_done');
  });

  it('suggests sun on a break near sunset', () => {
    const weather = {
      cityLabel: 'Seattle', latitudeRounded: 0, longitudeRounded: 0, conditionLabel: 'Clear sky', wmoCode: 0, temperatureCelsius: 10, highCelsius: 12, lowCelsius: 5,
      precipitationChancePercent: 10, precipitationPeriodLabel: null, fetchedAtEpochMs: NOW.getTime() - 60_000, sunsetIso: '2026-11-24T18:25',
    };
    const t = { ...timer, isRunning: true, phase: 'BREAK' as const, remainingSeconds: 200 };
    const c = composeForTask(ctx({ task: 'break', weather, timer: t }), 'RICH');
    const sun = c.insights.find((i) => i.id === 'sunset')!;
    expect(sun.title).toBe('25m of daylight left');
    expect(sun.body).toMatch(/Step outside/);
    expect(c.headline).toBe('Break · 3:20 left');
  });

  it('previews brief parsing while setting up', () => {
    const c = composeForTask(ctx({ task: 'setting_up', editorBrief: 'A5 notebook for a daily evening reflection for myself' }), 'RICH');
    expect(c.insights.find((i) => i.id === 'setup-detected')?.body).toContain('Cadence: Daily');
    expect(c.insights.find((i) => i.id === 'setup-detected')?.body).toContain('Page: A5');
    expect(c.insights.some((i) => i.id === 'setup-sample')).toBe(true);
  });

  it('shows patterns when reviewing and status when configuring', () => {
    const r = composeForTask(ctx({ task: 'reviewing' }), 'RICH');
    expect(r.insights.some((i) => i.id === 'rate')).toBe(true);
    expect(r.metrics.map((m) => m.label)).toEqual(['Pages', 'Finished', 'Best streak', 'Current']);
    const s = composeForTask(ctx({ task: 'configuring', storagePersisted: false }), 'RICH');
    expect(s.insights.map((i) => i.id)).toEqual(expect.arrayContaining(['storage', 'ai']));
  });

  it('respects Calm density and snoozes', () => {
    expect(composeForTask(ctx(), 'CALM').insights.length).toBeLessThanOrEqual(2);
    expect(composeForTask(ctx(), 'RICH', ['streak']).insights.some((i) => i.id === 'streak')).toBe(false);
  });

  it('never reveals prompts or notes in discreet mode', () => {
    const entries = [entry(0, false), entry(1, false, 21, 'private words')];
    const ins = buildInsights(ctx({ discreet: true, entries, todayEntry: entries[0], task: 'reviewing' }));
    const text = JSON.stringify(ins);
    expect(text).not.toContain('Prompt 1');
    expect(text).not.toContain('private words');
    expect(ins.some((i) => i.id === 'words')).toBe(false);
  });
});

describe('task detection', () => {
  const base: TaskSignals = {
    route: 'today', screenSaver: false, hasProject: true, todayCompleted: false, draftFocused: false, lastTypedAtMs: null, timerRunning: false,
    timerPhase: 'FOCUS', timerJustFinished: null, draftWords: 0, estimatedWords: 100, enteredTodayAtMs: 0, nowMs: 10_000,
  };
  it.each([
    [{}, 'arriving'],
    [{ nowMs: 60_000 }, 'thinking'],
    [{ draftFocused: true }, 'writing'],
    [{ timerRunning: true }, 'writing'],
    [{ lastTypedAtMs: 5_000, nowMs: 30_000 }, 'writing'],
    [{ timerRunning: true, timerPhase: 'BREAK' }, 'break'],
    [{ draftWords: 85, draftFocused: true }, 'wrapping_up'],
    [{ timerJustFinished: 'FOCUS' }, 'wrapping_up'],
    [{ todayCompleted: true, draftFocused: true }, 'done'],
    [{ route: 'history' }, 'reviewing'],
    [{ route: 'settings' }, 'configuring'],
    [{ route: 'newProject' }, 'setting_up'],
    [{ route: 'projects' }, 'organizing'],
    [{ hasProject: false }, 'setting_up'],
    [{ screenSaver: true, route: 'today' }, 'ambient'],
  ] as const)('%o → %s', (over, task) => {
    expect(detectTask({ ...base, ...(over as Partial<TaskSignals>) })).toBe(task);
  });

  it('gives every task a non-empty composition', () => {
    for (const task of ['arriving', 'thinking', 'writing', 'break', 'wrapping_up', 'done', 'setting_up', 'organizing', 'reviewing', 'configuring', 'ambient'] as const) {
      const c = composeForTask(ctx({ task, timer: task === 'break' ? { ...timer, isRunning: true, phase: 'BREAK' } : timer }), 'RICH');
      expect(c.headline.length, task).toBeGreaterThan(3);
      expect(c.insights.length + c.metrics.length, task).toBeGreaterThan(0);
    }
  });
});
