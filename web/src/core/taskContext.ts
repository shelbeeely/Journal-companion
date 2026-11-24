import type { FocusPhase } from './models';

/** What the user is doing right now; drives what the proactive desk surfaces unprompted. */
export type TaskKind =
  | 'arriving'
  | 'thinking'
  | 'writing'
  | 'break'
  | 'wrapping_up'
  | 'done'
  | 'setting_up'
  | 'organizing'
  | 'reviewing'
  | 'configuring'
  | 'ambient';

export type RouteName = 'today' | 'projects' | 'newProject' | 'editProject' | 'history' | 'settings';

export interface TaskSignals {
  route: RouteName;
  screenSaver: boolean;
  hasProject: boolean;
  todayCompleted: boolean;
  draftFocused: boolean;
  lastTypedAtMs: number | null;
  timerRunning: boolean;
  timerPhase: FocusPhase;
  timerJustFinished: FocusPhase | null;
  draftWords: number;
  estimatedWords: number | null;
  /** When the Today screen was last entered (or the page last became visible). */
  enteredTodayAtMs: number;
  nowMs: number;
}

export const THINKING_AFTER_MS = 45_000;
export const WRITING_GRACE_MS = 60_000;

export function detectTask(s: TaskSignals): TaskKind {
  if (s.screenSaver) return 'ambient';
  switch (s.route) {
    case 'settings':
      return 'configuring';
    case 'history':
      return 'reviewing';
    case 'newProject':
    case 'editProject':
      return 'setting_up';
    case 'projects':
      return 'organizing';
  }
  if (!s.hasProject) return 'setting_up';
  if (s.todayCompleted) return 'done';
  if (s.timerRunning && s.timerPhase === 'BREAK') return 'break';
  if (s.timerJustFinished === 'FOCUS') return 'wrapping_up';
  if (s.estimatedWords && s.draftWords >= Math.round(s.estimatedWords * 0.8)) return 'wrapping_up';
  const recentlyTyped = s.lastTypedAtMs != null && s.nowMs - s.lastTypedAtMs < WRITING_GRACE_MS;
  if (s.draftFocused || recentlyTyped || (s.timerRunning && s.timerPhase === 'FOCUS')) return 'writing';
  const lastActivity = Math.max(s.enteredTodayAtMs, s.lastTypedAtMs ?? 0);
  if (s.nowMs - lastActivity >= THINKING_AFTER_MS) return 'thinking';
  return 'arriving';
}

export const TASK_LABELS: Record<TaskKind, string> = {
  arriving: 'Ready',
  thinking: 'Thinking',
  writing: 'Writing',
  break: 'Break',
  wrapping_up: 'Wrapping up',
  done: 'Done',
  setting_up: 'Setting up',
  organizing: 'Projects',
  reviewing: 'Reviewing',
  configuring: 'Settings',
  ambient: 'Ambient',
};
