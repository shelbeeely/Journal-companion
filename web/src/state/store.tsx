import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DeskCues } from '../core/ai/orchestrator';
import { buildCompanionSurface, buildDeskSnapshot, type CompanionSurface } from '../core/deskContext';
import {
  DEFAULT_PREFERENCES,
  isWeatherStale,
  type AiAvailabilityState,
  type DeskContextSnapshot,
  type DeskUiPreferences,
  type DraftSuggestion,
  type FocusTimerState,
  type JournalEntry,
  type JournalProject,
  type PromptHistoryItem,
  type WeatherSnapshot,
} from '../core/models';
import type { JournalRepository } from '../core/repository';
import { countWords, localDateIso } from '../core/time';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../core/ai/openRouterClient';
import { composeForTask, type TaskComposition } from '../core/insights';
import { detectTask, type RouteName, type TaskKind } from '../core/taskContext';
import { isStandalone } from './install';
import { downloadBackup } from './backup';
import { navigate, useRoute } from './router';
import { getApproximateLocation } from '../core/weather';
import { chime, haptic } from './feedback';

const initialTimer: FocusTimerState = {
  phase: 'FOCUS',
  presetMinutes: 15,
  remainingSeconds: 15 * 60,
  totalSeconds: 15 * 60,
  isRunning: false,
  endsAtEpochMs: null,
  justFinishedPhase: null,
};

export interface AppState {
  isLoading: boolean;
  projects: JournalProject[];
  activeProject: JournalProject | null;
  todayEntry: JournalEntry | null;
  entries: JournalEntry[];
  history: PromptHistoryItem[];
  preferences: DeskUiPreferences;
  weather: WeatherSnapshot | null;
  weatherLoading: boolean;
  weatherError: string | null;
  draftText: string;
  canUndo: boolean;
  pendingSuggestion: DraftSuggestion | null;
  editableSuggestion: string;
  isGeneratingPrompt: boolean;
  isGeneratingHint: boolean;
  isGeneratingAssist: boolean;
  banner: string | null;
  ai: AiAvailabilityState;
  timer: FocusTimerState;
  focusBlocksToday: number;
  now: Date;
  snapshot: DeskContextSnapshot | null;
  companion: CompanionSurface | null;
  companionDismissed: boolean;
  draftOpenNonce: number;
  task: TaskKind;
  composition: TaskComposition;
  engineBadge: string;
  aiSettings: AiSettings;
  route: RouteName;
}

function useActions(repo: JournalRepository, initialBanner: string | null = null) {
  const [isLoading, setLoading] = useState(true);
  const [projects, setProjects] = useState<JournalProject[]>([]);
  const [preferences, setPreferences] = useState<DeskUiPreferences>(DEFAULT_PREFERENCES);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [todayEntry, setTodayEntry] = useState<JournalEntry | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [history, setHistory] = useState<PromptHistoryItem[]>([]);
  const [focusBlocksToday, setFocusBlocks] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftText, setDraftText] = useState('');
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [pendingSuggestion, setPending] = useState<DraftSuggestion | null>(null);
  const [editableSuggestion, setEditableSuggestion] = useState('');
  const [isGeneratingPrompt, setGenPrompt] = useState(false);
  const [isGeneratingHint, setGenHint] = useState(false);
  const [isGeneratingAssist, setGenAssist] = useState(false);
  const [banner, setBanner] = useState<string | null>(initialBanner);
  const [ai, setAi] = useState<AiAvailabilityState>({ kind: 'checking' });
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [timer, setTimer] = useState<FocusTimerState>(initialTimer);
  const [now, setNow] = useState(() => new Date());
  const [cues, setCues] = useState<DeskCues | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [companionNonce, setCompanionNonce] = useState(0);
  const [draftOpenNonce, setDraftOpenNonce] = useState(0);
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [snoozed, setSnoozed] = useState<string[]>([]);
  const [activity, setActivity] = useState<Record<number, { lastDateIso: string | null; completed: number; total: number }>>({});
  const [storagePersisted, setStoragePersisted] = useState<boolean | null>(null);
  // Task signals
  // Read the route here (not via an effect from App) so task detection updates in the same render.
  const route: RouteName = useRoute().name;
  const [screenSaver, setScreenSaver] = useState(false);
  const [draftFocused, setDraftFocused] = useState(false);
  const [lastTypedAt, setLastTypedAt] = useState<number | null>(null);
  const [enteredTodayAt, setEnteredTodayAt] = useState(() => Date.now());
  const [editorBrief, setEditorBrief] = useState('');

  const todayIso = localDateIso(now);
  const activeProject = useMemo(() => {
    const target = selectedId ?? preferences.lastActiveProjectId;
    return projects.find((p) => p.id === target) ?? projects[0] ?? null;
  }, [projects, selectedId, preferences.lastActiveProjectId]);

  // Refs give async callbacks the latest values without re-subscribing.
  const live = useRef({ activeProject, todayEntry, draftText, weather, preferences, timer });
  live.current = { activeProject, todayEntry, draftText, weather, preferences, timer };

  /* ------------------------------- data loading ------------------------------- */

  const reloadGlobal = useCallback(async () => {
    const [p, prefs, w, blocks, aiS, backupAt, snooze, act] = await Promise.all([
      repo.getProjects(),
      repo.getPreferences(),
      repo.getCachedWeather(),
      repo.getFocusBlocksToday(),
      repo.getAiSettings(),
      repo.getLastBackupAt(),
      repo.getSnoozedInsights(),
      repo.getActivitySummary(),
    ]);
    setProjects(p);
    setPreferences(prefs);
    setWeather(w);
    setFocusBlocks(blocks);
    setAiSettings((prev) => (prev.apiKey === aiS.apiKey && prev.model === aiS.model && prev.consentedAt === aiS.consentedAt ? prev : aiS));
    setLastBackupAt(backupAt);
    setSnoozed(snooze);
    setActivity(act);
  }, [repo]);

  const reloadProjectData = useCallback(async () => {
    const project = live.current.activeProject;
    if (!project) {
      setTodayEntry(null);
      setEntries([]);
      setHistory([]);
      return;
    }
    const [e, all, h] = await Promise.all([repo.getEntryForDate(project.id), repo.getEntriesForProject(project.id), repo.getPromptHistory(project.id)]);
    setTodayEntry(e);
    setEntries(all);
    setHistory(h);
  }, [repo]);

  useEffect(() => {
    reloadGlobal().finally(() => setLoading(false));
    return repo.subscribe(() => {
      reloadGlobal();
      reloadProjectData();
    });
  }, [repo, reloadGlobal, reloadProjectData]);

  // Re-check AI whenever the connection, consent or model changes.
  useEffect(() => {
    repo.ai.resetAvailability();
    setAi({ kind: 'checking' });
    repo.ai.checkAvailability().then(setAi);
  }, [repo, aiSettings.apiKey, aiSettings.model, aiSettings.consentedAt]);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setStoragePersisted).catch(() => setStoragePersisted(null));
  }, []);

  // Clock tick (30s) drives time cards, day-part changes and midnight rollover.
  useEffect(() => {
    // 15s while visible (task detection needs it), paused while hidden to save battery.
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id == null && document.visibilityState === 'visible') id = setInterval(() => setNow(new Date()), 15_000);
    };
    const stop = () => {
      if (id != null) clearInterval(id);
      id = null;
    };
    start();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setNow(new Date());
        setEnteredTodayAt(Date.now());
        start();
      } else stop();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    repo.getFocusBlocksToday(todayIso).then(setFocusBlocks);
  }, [repo, todayIso]);

  /* ---------------------- ensure today's prompt + load draft ---------------------- */

  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const project = activeProject;
    if (!project) {
      loadedKey.current = null;
      setDraftText('');
      setUndoStack([]);
      reloadProjectData();
      return;
    }
    (async () => {
      const ensured = await repo.ensureTodayEntry(project, live.current.weather, live.current.preferences.useCelsius, todayIso);
      if (cancelled) return;
      const key = `${project.id}:${ensured.dateIso}:${ensured.id}`;
      if (loadedKey.current !== key) {
        loadedKey.current = key;
        setDraftText(ensured.draftText);
        setUndoStack([]);
        setPending(null);
        setEditableSuggestion('');
      }
      await reloadProjectData();
    })();
    return () => {
      cancelled = true;
    };
    // Re-run only when the project identity or calendar day changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, activeProject?.id, todayIso]);

  // Quietly refresh a saved city when weather is missing or stale.
  const autoRefreshed = useRef<string | null>(null);
  useEffect(() => {
    const city = preferences.manualCityQuery?.trim();
    if (!city || autoRefreshed.current === city) return;
    if (weather && !isWeatherStale(weather, now.getTime())) return;
    autoRefreshed.current = city;
    refreshWeatherByCity(city);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.manualCityQuery, weather, now]);

  /* ---------------------------------- drafts ---------------------------------- */

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDraftNow = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const { todayEntry: entry, draftText: text } = live.current;
    if (entry && entry.draftText !== text) await repo.saveDraftText(entry, text);
  }, [repo]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') flushDraftNow();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flushDraftNow);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flushDraftNow);
    };
  }, [flushDraftNow]);

  const pushUndo = (text: string) => setUndoStack((s) => [...s, text].slice(-20));

  const onDraftChanged = useCallback(
    (next: string) => {
      const current = live.current.draftText;
      if (next === current) return;
      setUndoStack((s) => (s.length === 0 || Math.abs(next.length - current.length) > 12 ? [...s, current].slice(-20) : s));
      setDraftText(next);
      live.current.draftText = next;
      setLastTypedAt(Date.now());
      const entry = live.current.todayEntry;
      if (!entry) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => repo.saveDraftText(entry, next), 450);
    },
    [repo],
  );

  const setDraftAndSave = (text: string) => {
    setDraftText(text);
    live.current.draftText = text;
    const entry = live.current.todayEntry;
    if (entry) repo.saveDraftText(entry, text);
  };

  const undoDraft = () => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setDraftAndSave(previous);
  };

  /* -------------------------------- today actions -------------------------------- */

  const requestHint = async () => {
    const { activeProject: p, todayEntry: e } = live.current;
    if (!p || !e || isGeneratingHint) return;
    setGenHint(true);
    try {
      const res = await repo.requestHint(p, e);
      if (res.statusNote) setBanner(res.statusNote);
    } finally {
      setGenHint(false);
    }
  };

  const tryAnotherPrompt = async () => {
    const { activeProject: p, todayEntry: e, weather: w, preferences: prefs } = live.current;
    if (!p || isGeneratingPrompt) return;
    await flushDraftNow();
    setGenPrompt(true);
    try {
      const fresh = e ? await repo.getEntryForDate(p.id, e.dateIso) : null;
      const { note } = await repo.tryAnotherPrompt(p, fresh ?? e, w, prefs.useCelsius);
      if (note) setBanner(note);
    } finally {
      setGenPrompt(false);
    }
  };

  const markDone = async (completed = true) => {
    const { todayEntry: e, draftText: text } = live.current;
    if (!e) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await repo.setEntryCompleted(e, completed, text);
    if (completed) {
      haptic([12, 40, 12]);
      setBanner("Saved today's page status.");
    }
  };

  const runAssist = async (kind: 'start' | 'tighten') => {
    const { activeProject: p, todayEntry: e, draftText: text } = live.current;
    if (!p || !e || isGeneratingAssist) return;
    if (kind === 'tighten' && !text.trim()) {
      setBanner('Write a few words in your draft first, then tap Tighten my draft.');
      return;
    }
    setGenAssist(true);
    try {
      const s = kind === 'start' ? await repo.requestHelpStart(p, e) : await repo.requestTightenDraft(p, e, text.trim());
      setPending(s);
      setEditableSuggestion(s.suggestedText);
      if (s.note) setBanner(s.note);
    } finally {
      setGenAssist(false);
    }
  };

  const acceptSuggestion = (append: boolean) => {
    const suggestion = editableSuggestion.trim();
    setPending(null);
    setEditableSuggestion('');
    if (!suggestion) return;
    const current = live.current.draftText;
    pushUndo(current);
    setDraftAndSave(append && current.trim() ? `${current}\n\n${suggestion}` : suggestion);
  };

  const dismissSuggestion = () => {
    setPending(null);
    setEditableSuggestion('');
  };

  const selectProject = async (id: number) => {
    await flushDraftNow();
    setSelectedId(id);
    await repo.updatePreferences({ lastActiveProjectId: id });
  };

  const deleteProject = async (id: number) => {
    await repo.deleteProject(id);
    if (selectedId === id) setSelectedId(null);
    const remaining = projects.find((p) => p.id !== id);
    await repo.updatePreferences({ lastActiveProjectId: remaining?.id ?? null });
  };

  const updateActiveProject = async (transform: (p: JournalProject) => JournalProject) => {
    const p = live.current.activeProject;
    if (p) await repo.updateProjectPreservingHistory(transform(p));
  };

  /* --------------------------------- weather --------------------------------- */

  async function refreshWeatherByCity(city: string) {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      await repo.refreshWeatherByCity(city);
    } catch (e) {
      setWeatherError((e as Error).message || 'Offline or unable to reach Open-Meteo.');
    } finally {
      setWeatherLoading(false);
    }
  }

  const refreshWeatherByLocation = async () => {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const loc = await getApproximateLocation();
      await repo.refreshWeatherByCoordinates(loc.latitude, loc.longitude, 'Approximate location');
    } catch (e) {
      setWeatherError((e as Error).message || 'Could not fetch weather right now.');
    } finally {
      setWeatherLoading(false);
    }
  };

  /* ------------------------------- focus timer ------------------------------- */

  useEffect(() => {
    if (!timer.isRunning || timer.endsAtEpochMs == null) return;
    const tick = () => {
      const t = live.current.timer;
      if (!t.isRunning || t.endsAtEpochMs == null) return;
      const remaining = Math.max(0, Math.ceil((t.endsAtEpochMs - Date.now()) / 1000));
      if (remaining > 0) {
        if (remaining !== t.remainingSeconds) setTimer({ ...t, remainingSeconds: remaining });
        return;
      }
      const finished = t.phase;
      if (finished === 'FOCUS') repo.incrementFocusBlocksToday();
      const nextPhase = finished === 'FOCUS' ? 'BREAK' : 'FOCUS';
      const total = nextPhase === 'BREAK' ? 5 * 60 : t.presetMinutes * 60;
      haptic([30, 80, 30]);
      chime();
      setTimer({ ...t, phase: nextPhase, remainingSeconds: total, totalSeconds: total, isRunning: false, endsAtEpochMs: null, justFinishedPhase: finished });
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [repo, timer.isRunning, timer.endsAtEpochMs]);

  const startTimer = () =>
    setTimer((t) => {
      const remaining = t.remainingSeconds <= 0 ? t.totalSeconds : t.remainingSeconds;
      return { ...t, remainingSeconds: remaining, isRunning: true, endsAtEpochMs: Date.now() + remaining * 1000, justFinishedPhase: null };
    });
  const pauseTimer = () => setTimer((t) => ({ ...t, isRunning: false, endsAtEpochMs: null }));
  const toggleTimer = () => (live.current.timer.isRunning ? pauseTimer() : startTimer());
  const selectPreset = (minutes: number) => {
    const secs = Math.min(90, Math.max(1, minutes)) * 60;
    setTimer((t) => ({ ...t, phase: 'FOCUS', presetMinutes: minutes, remainingSeconds: secs, totalSeconds: secs, isRunning: false, endsAtEpochMs: null, justFinishedPhase: null }));
  };
  const startBreak = (minutes = 5) => {
    const secs = minutes * 60;
    setTimer((t) => ({ ...t, phase: 'BREAK', remainingSeconds: secs, totalSeconds: secs, isRunning: true, endsAtEpochMs: Date.now() + secs * 1000, justFinishedPhase: null }));
  };
  const resetTimer = () =>
    setTimer((t) => {
      const secs = t.phase === 'BREAK' ? 5 * 60 : t.presetMinutes * 60;
      return { ...t, remainingSeconds: secs, totalSeconds: secs, isRunning: false, endsAtEpochMs: null, justFinishedPhase: null };
    });
  const dismissTimerCompletion = () => setTimer((t) => ({ ...t, justFinishedPhase: null }));

  /* ---------------------------- desk snapshot & companion ---------------------------- */

  const snapshot = useMemo(
    () =>
      activeProject
        ? buildDeskSnapshot({
            project: activeProject,
            todayEntry,
            entries,
            history,
            draftWordCount: countWords(draftText),
            weather,
            useCelsius: preferences.useCelsius,
            now,
            discreetMode: preferences.discreetDeskModeEnabled,
          })
        : null,
    [activeProject, todayEntry, entries, history, draftText, weather, preferences.useCelsius, preferences.discreetDeskModeEnabled, now],
  );

  // Ask the on-device model for fresh cues only when something meaningful changes.
  const cueSignature = snapshot
    ? [snapshot.projectId, snapshot.promptText, snapshot.activeStarter, snapshot.dayPartLabel, snapshot.todayCompleted, snapshot.sessionNumber, snapshot.discreetMode, companionNonce].join('|')
    : null;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  // Cost guard: cues are regenerated on a new prompt/project/refresh, otherwise at most every 10 minutes.
  const lastCues = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    const s = snapshotRef.current;
    if (!s || ai.kind !== 'available' || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData) {
      setCues(null);
      return;
    }
    const hardKey = `${s.projectId}|${s.promptText}|${s.discreetMode}|${companionNonce}`;
    const prev = lastCues.current;
    if (prev && prev.key === hardKey && Date.now() - prev.at < 10 * 60 * 1000) return;
    lastCues.current = { key: hardKey, at: Date.now() };
    setCues(null);
    let cancelled = false;
    repo.ai.synthesizeDeskCues(s).then((c) => !cancelled && setCues(c));
    return () => {
      cancelled = true;
    };
  }, [repo, cueSignature, ai.kind]);

  const companion = useMemo(() => (snapshot ? buildCompanionSurface(snapshot, cues) : null), [snapshot, cues]);
  const windowKey = snapshot ? `${snapshot.projectId}:${snapshot.dayPartLabel}` : null;

  const companionUseStarter = () => {
    const starter = companion?.starter.starterText;
    if (!starter) return;
    const current = live.current.draftText;
    pushUndo(current);
    setDraftAndSave(current.trim() ? `${current}\n\n${starter}` : starter);
    setDraftOpenNonce((n) => n + 1);
  };

  /* ------------------------------ task-aware composition ------------------------------ */

  const draftWords = countWords(draftText);
  const prevRoute = useRef(route);
  useEffect(() => {
    if (route === 'today' && prevRoute.current !== 'today') setEnteredTodayAt(Date.now());
    prevRoute.current = route;
  }, [route]);
  const task = detectTask({
    route,
    screenSaver,
    hasProject: !!activeProject,
    todayCompleted: todayEntry?.isCompleted === true,
    draftFocused,
    lastTypedAtMs: lastTypedAt,
    timerRunning: timer.isRunning,
    timerPhase: timer.phase,
    timerJustFinished: timer.justFinishedPhase,
    draftWords,
    estimatedWords: snapshot?.estimatedWordsPerPage ?? null,
    enteredTodayAtMs: enteredTodayAt,
    nowMs: Math.max(now.getTime(), lastTypedAt ?? 0),
  });
  const composition = useMemo(
    () =>
      composeForTask(
        {
          task,
          now,
          project: activeProject,
          projects,
          todayEntry,
          entries,
          history,
          snapshot,
          weather,
          useCelsius: preferences.useCelsius,
          timer,
          focusBlocksToday,
          draftWords,
          discreet: preferences.discreetDeskModeEnabled,
          lastBackupAt,
          storagePersisted,
          ai,
          aiConnected: !!aiSettings.apiKey && !!aiSettings.consentedAt,
          installed: isStandalone(),
          editorBrief,
          projectActivity: activity,
        },
        preferences.proactiveDensity,
        snoozed,
      ),
    [task, now, activeProject, projects, todayEntry, entries, history, snapshot, weather, preferences, timer, focusBlocksToday, draftWords, lastBackupAt, storagePersisted, ai, aiSettings, editorBrief, activity, snoozed],
  );
  const engineBadge = cues ? `AI · ${aiSettings.model.split('/').pop()}` : 'Desk agent · local';

  const exportBackup = async () => {
    await downloadBackup(repo);
    setBanner('Backup downloaded.');
  };

  /** Handles actions dispatched from A2UI surfaces. */
  const handleDeskAction = (name: string, context: Record<string, unknown>) => {
    const run = (n: string) => {
      switch (n) {
        case 'use_starter':
          return companionUseStarter();
        case 'next_angle':
          return requestHint();
        case 'start_focus':
          return actions.startQuickFocus();
        case 'start_break':
          return startBreak(5);
        case 'refresh_surface':
          return actions.refreshCompanion();
        case 'dismiss_surface':
          return actions.dismissCompanion();
        case 'refresh_weather':
          return preferences.manualCityQuery ? refreshWeatherByCity(preferences.manualCityQuery) : refreshWeatherByLocation();
        case 'mark_done':
          return markDone(true);
        case 'tighten_draft':
          setDraftOpenNonce((x) => x + 1);
          return runAssist('tighten');
        case 'open_history':
          return navigate({ name: 'history' });
        case 'open_settings':
          return navigate({ name: 'settings' });
        case 'open_today':
          return navigate({ name: 'today' });
        case 'export_backup':
          return exportBackup();
      }
    };
    if (name === 'snooze_insight' && typeof context.id === 'string') {
      setSnoozed((s) => [...s, context.id as string]);
      repo.snoozeInsight(context.id);
      return;
    }
    if (name === 'insight_action') {
      if (typeof context.name === 'string' && context.name) run(context.name);
      return;
    }
    run(name);
  };

  const state: AppState = {
    isLoading,
    projects,
    activeProject,
    todayEntry,
    entries,
    history,
    preferences,
    weather,
    weatherLoading,
    weatherError,
    draftText,
    canUndo: undoStack.length > 0,
    pendingSuggestion,
    editableSuggestion,
    isGeneratingPrompt,
    isGeneratingHint,
    isGeneratingAssist,
    banner,
    ai,
    timer,
    focusBlocksToday,
    now,
    snapshot,
    companion,
    companionDismissed: !!windowKey && dismissedKey === windowKey,
    draftOpenNonce,
    task,
    composition,
    engineBadge,
    aiSettings,
    route,
  };

  const actions = {
    repo,
    selectProject,
    deleteProject,
    updateActiveProject,
    updatePreferences: (patch: Partial<DeskUiPreferences>) => repo.updatePreferences(patch),
    dismissBanner: () => setBanner(null),
    showBanner: setBanner,
    checkAi: async () => {
      setAi({ kind: 'checking' });
      setAi(await repo.ai.checkAvailability());
    },
    updateAiSettings: (patch: Partial<AiSettings>) => repo.updateAiSettings(patch),
    handleDeskAction,
    exportBackup,
    setScreenSaver,
    setDraftFocused,
    setEditorBrief,
    onDraftChanged,
    undoDraft,
    requestHint,
    tryAnotherPrompt,
    markDone,
    helpMeStart: () => runAssist('start'),
    tightenDraft: () => runAssist('tighten'),
    setEditableSuggestion,
    acceptSuggestion,
    dismissSuggestion,
    refreshWeatherByCity,
    refreshWeatherByLocation,
    toggleTimer,
    selectPreset,
    startBreak,
    resetTimer,
    dismissTimerCompletion,
    startQuickFocus: () => {
      if (!live.current.timer.isRunning) {
        const secs = 10 * 60;
        setTimer((t) => ({ ...t, phase: 'FOCUS', presetMinutes: 10, remainingSeconds: secs, totalSeconds: secs, isRunning: true, endsAtEpochMs: Date.now() + secs * 1000, justFinishedPhase: null }));
      }
    },
    companionUseStarter,
    refreshCompanion: () => {
      setDismissedKey(null);
      setCompanionNonce((n) => n + 1);
    },
    dismissCompanion: () => setDismissedKey(windowKey),
    restoreCompanion: () => setDismissedKey(null),
    flushDraftNow,
    focusProjectAfterCreate: (id: number) => setSelectedId(id),
  };

  return { state, actions };
}

type Store = ReturnType<typeof useActions>;
const StoreContext = createContext<Store | null>(null);

export function AppStoreProvider({ repo, initialBanner = null, children }: { repo: JournalRepository; initialBanner?: string | null; children: ReactNode }) {
  const store = useActions(repo, initialBanner);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore outside provider');
  return s;
}
