export type JournalCadence = 'DAILY' | 'WEEKLY' | 'WHENEVER';

export const CADENCE_LABELS: Record<JournalCadence, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  WHENEVER: 'Whenever I open it',
};

export interface JournalProject {
  id: number;
  title: string;
  writingGoal: string;
  originalBrief: string;
  audience: string | null;
  cadence: JournalCadence | null;
  pageSizeLabel: string | null;
  entryLengthLabel: string | null;
  linesPerPage: number;
  wordsPerLine: number;
  themes: string[];
  tonePreferences: string | null;
  boundaries: string | null;
  includePastAnswersInPrompts: boolean;
  showDateTimeCard: boolean;
  showWeatherCard: boolean;
  showSparksCard: boolean;
  showRhythmCard: boolean;
  showTimerCard: boolean;
  includeDateTimeInPrompt: boolean;
  includeWeatherInPrompt: boolean;
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
}

export function estimatedWordsPerPage(p: Pick<JournalProject, 'pageSizeLabel' | 'linesPerPage' | 'wordsPerLine'>): number | null {
  if (!p.pageSizeLabel || !p.pageSizeLabel.trim()) return null;
  return Math.max(10, p.linesPerPage * p.wordsPerLine);
}

export function showCompanionCard(p: JournalProject): boolean {
  return p.showSparksCard || p.showRhythmCard;
}

export interface ProposedProjectSetup {
  title: string;
  writingGoal: string;
  audience: string | null;
  cadence: JournalCadence | null;
  pageSizeLabel: string | null;
  entryLengthLabel: string | null;
  linesPerPage: number;
  wordsPerLine: number;
  themes: string[];
  tonePreferences: string | null;
  boundaries: string | null;
  firstPrompt: string;
  firstHints: string[];
  usedAi: boolean;
  statusNote: string | null;
}

export function emptySetup(): ProposedProjectSetup {
  return {
    title: '',
    writingGoal: '',
    audience: null,
    cadence: null,
    pageSizeLabel: null,
    entryLengthLabel: null,
    linesPerPage: 14,
    wordsPerLine: 6,
    themes: [],
    tonePreferences: null,
    boundaries: null,
    firstPrompt: '',
    firstHints: [],
    usedAi: false,
    statusNote: null,
  };
}

export interface WizardSeedInputs {
  cadence?: JournalCadence | null;
  audience?: string | null;
  pageSizeLabel?: string | null;
  linesPerPage?: number | null;
  wordsPerLine?: number | null;
  tonePreferences?: string | null;
  boundaries?: string | null;
}

export interface JournalEntry {
  id: number;
  projectId: number;
  dateIso: string;
  promptText: string;
  promptTopicTag: string;
  hints: string[];
  draftText: string;
  isCompleted: boolean;
  completedAtEpochMs: number | null;
  updatedAtEpochMs: number;
}

export interface PromptHistoryItem {
  id: number;
  projectId: number;
  dateIso: string;
  promptText: string;
  topicTag: string;
  createdAtEpochMs: number;
}

export type SuggestionKind = 'HELP_START' | 'TIGHTEN_DRAFT';

export interface DraftSuggestion {
  kind: SuggestionKind;
  suggestedText: string;
  usedAi: boolean;
  note?: string | null;
}

export interface WeatherSnapshot {
  cityLabel: string;
  latitudeRounded: number;
  longitudeRounded: number;
  conditionLabel: string;
  wmoCode: number;
  temperatureCelsius: number;
  highCelsius: number;
  lowCelsius: number;
  precipitationChancePercent: number | null;
  precipitationPeriodLabel: string | null;
  fetchedAtEpochMs: number;
  feelsLikeCelsius?: number | null;
  windSpeedKmh?: number | null;
  sunriseIso?: string | null;
  sunsetIso?: string | null;
  uvIndexMax?: number | null;
  isDaytime?: boolean | null;
}

export const WEATHER_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export function isWeatherStale(w: WeatherSnapshot, nowMs = Date.now(), thresholdMs = WEATHER_STALE_THRESHOLD_MS): boolean {
  return nowMs - w.fetchedAtEpochMs > thresholdMs;
}

export interface PromptContextPayload {
  dateTimeText: string | null;
  weatherSummary: string | null;
  weatherFetchedTimestamp: string | null;
}

export type FocusPhase = 'FOCUS' | 'BREAK';

export interface FocusTimerState {
  phase: FocusPhase;
  presetMinutes: number;
  remainingSeconds: number;
  totalSeconds: number;
  isRunning: boolean;
  /** Wall-clock end time while running, so the timer survives tab throttling and sleep. */
  endsAtEpochMs: number | null;
  justFinishedPhase: FocusPhase | null;
}

export type AppThemeMode = 'SYSTEM' | 'LIGHT' | 'DARK';
export const THEME_LABELS: Record<AppThemeMode, string> = {
  SYSTEM: 'System',
  LIGHT: 'Warm Light',
  DARK: 'Soft Dark',
};

export type ScreenSaverMode = 'FULL_COMPANION' | 'CLOCK_AND_WEATHER_ONLY';
export const SCREEN_SAVER_LABELS: Record<ScreenSaverMode, string> = {
  FULL_COMPANION: 'Full Desk Companion',
  CLOCK_AND_WEATHER_ONLY: 'Clock & Weather Only',
};

export interface DeskUiPreferences {
  lastActiveProjectId: number | null;
  keepScreenAwakeInDeskMode: boolean;
  themeMode: AppThemeMode;
  dimDeskModeEnabled: boolean;
  /** Web analogue of Android's Recents protection: veil the app whenever it loses focus or is hidden. */
  privacyVeilEnabled: boolean;
  useCelsius: boolean;
  manualCityQuery: string | null;
  discreetDeskModeEnabled: boolean;
  screenSaverMode: ScreenSaverMode;
  screenSaverDimBrightness: boolean;
  /** Minutes of inactivity on Today before the ambient screen saver appears; 0 = never. */
  screenSaverIdleMinutes: number;
  /** How much the proactive desk surfaces unprompted. */
  proactiveDensity: 'RICH' | 'CALM';
  /* Day & rhythm (temporal context) */
  wakeHour: number;
  sleepHour: number;
  /** 0 = Sunday … 6 = Saturday. */
  workdays: number[];
  weekStartsOn: 0 | 1;
  hemisphereOverride: 'north' | 'south' | null;
  detectTravel: boolean;
  /** Learned on first run; differing from the current zone means "traveling". */
  homeTimeZone: string | null;
  /* Suggestions */
  disabledMoments: string[];
  /** Max moment cards shown per day (in-app only). */
  momentDailyLimit: number;
  /** Simplified (compact) layout per moment type. */
  simplifiedMoments: string[];
}

export const DEFAULT_PREFERENCES: DeskUiPreferences = {
  lastActiveProjectId: null,
  keepScreenAwakeInDeskMode: true,
  themeMode: 'SYSTEM',
  dimDeskModeEnabled: false,
  privacyVeilEnabled: false,
  useCelsius: false,
  manualCityQuery: null,
  discreetDeskModeEnabled: false,
  screenSaverMode: 'FULL_COMPANION',
  screenSaverDimBrightness: true,
  screenSaverIdleMinutes: 0,
  proactiveDensity: 'RICH',
  wakeHour: 7,
  sleepHour: 23,
  workdays: [1, 2, 3, 4, 5],
  weekStartsOn: 1,
  hemisphereOverride: null,
  detectTravel: true,
  homeTimeZone: null,
  disabledMoments: [],
  momentDailyLimit: 12,
  simplifiedMoments: [],
};

export type AiAvailabilityState =
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'error'; message: string };

export interface DeskContextSnapshot {
  projectId: number;
  projectTitle: string;
  writingGoal: string;
  originalBrief: string;
  audience: string | null;
  cadenceLabel: string | null;
  tonePreferences: string | null;
  boundaries: string | null;
  promptText: string;
  promptTopicLabel: string;
  activeStarter: string | null;
  recallQuestion: string | null;
  coveredThemes: string[];
  untappedThemes: string[];
  sessionNumber: number;
  completedPagesCount: number;
  todayCompleted: boolean;
  pageSizeLabel: string | null;
  estimatedWordsPerPage: number | null;
  linesPerPage: number;
  wordsPerLine: number;
  draftWordCount: number;
  recentNoteExcerpt: string | null;
  recentNoteDayLabel: string | null;
  includePastAnswersInPrompts: boolean;
  dayPartLabel: string;
  writingWindowCue: string;
  calendarRhythmLabel: string;
  formattedDate: string;
  formattedTime: string;
  daylightSummary: string | null;
  weatherSummary: string | null;
  isWeatherStale: boolean;
  discreetMode: boolean;
}
