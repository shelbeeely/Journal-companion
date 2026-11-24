import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SavedView, FeedbackEvent } from '../core/db';
import { interpretSuggestion, type Interpretation } from '../core/ai/orchestrator';
import type { AiClient } from '../core/ai/aiClient';
import { detectMoments, type MomentKind, type Suggestion } from '../core/context/moments';
import { rankSuggestions, type Ranked } from '../core/context/ranking';
import { buildTemporalContext, snoozeUntil, type TemporalContext } from '../core/context/temporal';
import type { DeskUiPreferences, JournalEntry, JournalProject, WeatherSnapshot } from '../core/models';
import type { ContextStore } from '../core/sources/contextStore';
import { renewGoogle } from '../core/sources/auth';
import { GOOGLE_SOURCES, isEnabled, SOURCE_META } from '../core/sources/meta';
import type { SourceSync } from '../core/sources/sync';
import type { ContextItem, SourceState } from '../core/sources/types';
import type { TaskKind } from '../core/taskContext';
import { localDateIso } from '../core/time';
import { drainShareInbox, handleLaunchedFiles } from './inbox';

export interface CompanionDeps {
  contextStore: ContextStore;
  aiClient: AiClient;
  aiEnabled: boolean;
  prefs: DeskUiPreferences;
  updatePreferences: (patch: Partial<DeskUiPreferences>) => Promise<void> | void;
  projects: JournalProject[];
  todayEntry: JournalEntry | null;
  activeProjectId: number | null;
  task: TaskKind;
  now: Date;
  weather: WeatherSnapshot | null;
  /** Bumps whenever journal data changes. */
  journalVersion: number;
  notify: (message: string) => void;
  loadAllEntries: () => Promise<JournalEntry[]>;
}

function locale(): { country: string; language: string; timeZone: string } {
  const lang = (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US';
  let country = '';
  try {
    country = new Intl.Locale(lang).maximize().region ?? '';
  } catch {
    country = lang.split('-')[1] ?? '';
  }
  return { country: country.toUpperCase(), language: lang.split('-')[0].toLowerCase(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/**
 * The context-aware layer: keeps connected sources synced, builds temporal context, detects and
 * ranks moments, and records feedback (dismiss / snooze / save / simplify). In-app only.
 */
export function useCompanion(d: CompanionDeps) {
  const [items, setItems] = useState<ContextItem[]>([]);
  const [states, setStates] = useState<Record<string, SourceState>>({});
  const [feedback, setFeedback] = useState<FeedbackEvent[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [allEntries, setAllEntries] = useState<JournalEntry[]>([]);
  const [requested, setRequested] = useState<{ moment: MomentKind; until: number } | null>(null);
  const [interpretations, setInterpretations] = useState<Record<string, Interpretation | null>>({});
  const [syncing, setSyncing] = useState(false);

  const live = useRef(d);
  live.current = d;

  // Learn the home time zone on first run (travel detection compares against it).
  useEffect(() => {
    if (!d.prefs.homeTimeZone) d.updatePreferences({ homeTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  }, [d.prefs.homeTimeZone]); // eslint-disable-line react-hooks/exhaustive-deps

  const entriesRef = useRef<JournalEntry[]>([]);
  entriesRef.current = allEntries;

  // The sync manager pulls in all connectors, so it loads lazily (off the first-paint path).
  const syncRef = useRef<Promise<SourceSync> | null>(null);
  const getSync = useCallback(() => {
    syncRef.current ??= import('../core/sources/sync').then(
      ({ SourceSync }) =>
        new SourceSync(d.contextStore, {
          fetch: (...a) => fetch(...a),
          now: () => new Date(),
          location: () => (live.current.weather ? { lat: live.current.weather.latitudeRounded, lon: live.current.weather.longitudeRounded } : null),
          locale,
          runtimeConfig: (id) => (id === 'journal' ? { snapshot: { projects: live.current.projects, entries: entriesRef.current } } : undefined),
        }),
    );
    return syncRef.current;
  }, [d.contextStore]);

  const reload = useCallback(async () => {
    const [it, st, fb, sv] = await Promise.all([d.contextStore.allItems(), d.contextStore.getStates(), d.contextStore.recentFeedback(), d.contextStore.savedViews()]);
    setItems(it);
    setStates(st);
    setFeedback(fb);
    setSavedViews(sv);
  }, [d.contextStore]);

  useEffect(() => {
    reload();
    return d.contextStore.subscribe(reload);
  }, [d.contextStore, reload]);

  const runSync = useCallback(
    async (force: string[] = []) => {
      setSyncing(true);
      try {
        await (await getSync()).run(force);
      } finally {
        setSyncing(false);
      }
    },
    [getSync],
  );

  // Journal snapshot: refresh entries and the built-in source whenever the journal changes.
  useEffect(() => {
    let cancelled = false;
    d.loadAllEntries().then((e) => {
      if (cancelled) return;
      setAllEntries(e);
      entriesRef.current = e;
      runSync(['journal']);
    });
    return () => {
      cancelled = true;
    };
  }, [d.journalVersion, d.projects.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared items (Web Share Target) and files opened with the app.
  useEffect(() => {
    const drain = () =>
      drainShareInbox(d.contextStore).then((n) => {
        if (n) {
          live.current.notify(n === 1 ? 'Saved what you shared — it’s waiting under Unfinished thoughts.' : `Saved ${n} shared items.`);
          runSync(['share_target']);
        }
      });
    drain();
    const onVis = () => document.visibilityState === 'visible' && drain();
    document.addEventListener('visibilitychange', onVis);
    handleLaunchedFiles(d.contextStore, (msg, sourceId) => {
      live.current.notify(msg);
      if (sourceId) runSync([sourceId]);
    });
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [d.contextStore, runSync]);

  // Background freshness: every 5 minutes while visible, on return, and when back online.
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && runSync();
    const id = setInterval(tick, 5 * 60_000);
    const onVis = () => document.visibilityState === 'visible' && runSync();
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', onVis);
    const first = setTimeout(tick, 1500);
    return () => {
      clearInterval(id);
      clearTimeout(first);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [runSync]);

  // When the weather location changes, location-based sources should refresh.
  const locKey = d.weather ? `${d.weather.latitudeRounded},${d.weather.longitudeRounded}` : '';
  useEffect(() => {
    if (locKey) runSync(['weather', 'nature_inaturalist', 'alerts_usgs', 'transit_transitland', 'travel_osrm']);
  }, [locKey, runSync]);

  /* ------------------------------ composition ------------------------------ */

  const enabledIds = useMemo(() => new Set(Object.keys(SOURCE_META).filter((id) => isEnabled(id, states))), [states]);
  const suggestionItems = useMemo(() => items.filter((i) => enabledIds.has(i.sourceId) && (states[i.sourceId]?.useForSuggestions ?? true)), [items, enabledIds, states]);

  const minuteKey = Math.floor(d.now.getTime() / 60_000);
  const temporal: TemporalContext = useMemo(
    () => buildTemporalContext({ now: d.now, prefs: d.prefs, items: suggestionItems, entries: allEntries, latitude: d.weather?.latitudeRounded ?? null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minuteKey, d.prefs, suggestionItems, allEntries, d.weather?.latitudeRounded],
  );

  const activeRequest = requested && requested.until > d.now.getTime() ? requested.moment : null;

  const all: Suggestion[] = useMemo(
    () =>
      detectMoments({
        temporal,
        items: suggestionItems,
        states,
        enabled: enabledIds,
        journal: { projects: d.projects, entries: allEntries, todayEntry: d.todayEntry, activeProjectId: d.activeProjectId },
        task: d.task,
        requested: activeRequest,
        disabled: d.prefs.disabledMoments,
        hasLocation: !!d.weather,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [temporal, suggestionItems, states, enabledIds, d.projects, allEntries, d.todayEntry, d.activeProjectId, d.task, activeRequest, d.prefs.disabledMoments, !!d.weather],
  );

  const today = localDateIso(d.now);
  const shownToday = useMemo(() => new Set(feedback.filter((f) => f.action === 'shown' && localDateIso(new Date(f.at)) === today).map((f) => f.key)), [feedback, today]);

  const ranked: Ranked = useMemo(
    () =>
      rankSuggestions(all, {
        now: d.now.getTime(),
        feedback,
        task: d.task,
        density: d.prefs.proactiveDensity,
        dailyLimit: d.prefs.momentDailyLimit,
        shownToday,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, feedback, d.task, d.prefs.proactiveDensity, d.prefs.momentDailyLimit, shownToday, minuteKey],
  );

  // A requested moment always leads.
  const visible = useMemo(() => {
    if (!activeRequest) return ranked.visible;
    const req = all.find((s) => s.moment === activeRequest);
    return req ? [req, ...ranked.visible.filter((s) => s.key !== req.key)] : ranked.visible;
  }, [ranked.visible, all, activeRequest]);

  // Record "shown" once per key per day (for the daily cap).
  useEffect(() => {
    for (const s of visible) {
      if (!shownToday.has(s.key)) d.contextStore.recordFeedback({ key: s.key, moment: s.moment, action: 'shown', at: Date.now() });
    }
  }, [visible.map((s) => s.key).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Optional AI interpretation for the top card only, from sources the user allowed.
  const allowedForAi = useMemo(() => new Set(Object.entries(states).filter(([, s]) => s.shareWithAi).map(([id]) => id)), [states]);
  const top = visible[0];
  const interpKey = top ? `${top.key}|${top.evidence.map((e) => e.id).join(',')}` : '';
  useEffect(() => {
    if (!top || !d.aiEnabled || !allowedForAi.size || interpKey in interpretations) return;
    if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
    let cancelled = false;
    setInterpretations((m) => ({ ...m, [interpKey]: null })); // mark in-flight (and cache failures)
    interpretSuggestion(d.aiClient, top, allowedForAi).then((r) => {
      if (!cancelled) setInterpretations((m) => ({ ...m, [interpKey]: r }));
    });
    return () => {
      cancelled = true;
    };
  }, [interpKey, d.aiEnabled, allowedForAi]); // eslint-disable-line react-hooks/exhaustive-deps

  const interpretationFor = (s: Suggestion): Interpretation | null => interpretations[`${s.key}|${s.evidence.map((e) => e.id).join(',')}`] ?? null;

  /* -------------------------------- actions -------------------------------- */

  /** From a user gesture only: quietly renews an expired Google token, then refreshes Google sources. */
  const renewGoogleFromGesture = async (): Promise<boolean> => {
    const ids = GOOGLE_SOURCES.filter((id) => isEnabled(id, states));
    if (!ids.length || !(await renewGoogle(d.contextStore))) return false;
    await runSync(ids);
    return true;
  };

  const record = (s: { key: string; moment: string }, action: FeedbackEvent['action'], until?: number) => d.contextStore.recordFeedback({ key: s.key, moment: s.moment, action, at: Date.now(), until });

  return {
    items,
    states,
    savedViews,
    temporal,
    suggestions: visible,
    requested: activeRequest,
    hiddenCount: ranked.hidden.length,
    /** Keys the user explicitly snoozed or dismissed (these leave the screen even while writing). */
    userHidden: new Set(ranked.hidden.filter((h) => h.reason === 'snoozed' || h.reason === 'dismissed').map((h) => h.key)),
    quiet: ranked.quiet,
    syncing,
    allSuggestions: all,
    interpretationFor,
    contextStore: d.contextStore,
    syncNow: (ids?: string[]) => runSync(ids ?? [...enabledIds]),
    syncOne: (id: string) => runSync([id]),
    ask: (moment: MomentKind) => {
      setRequested({ moment, until: Date.now() + 30 * 60_000 });
      void renewGoogleFromGesture(); // the user wants fresh data; a tap is the only time GIS may renew
    },
    renewGoogleFromGesture,
    clearAsk: () => setRequested(null),
    dismiss: (s: { key: string; moment: string }) => record(s, 'dismissed'),
    snooze: (s: { key: string; moment: string }, choice: 'hour' | 'tonight' | 'tomorrow' | 'weekend') => record(s, 'snoozed', snoozeUntil(choice, temporal, d.prefs)),
    acted: (s: { key: string; moment: string }) => record(s, 'acted'),
    toggleSimplify: (moment: string) => {
      const set = new Set(d.prefs.simplifiedMoments);
      if (set.has(moment)) set.delete(moment);
      else set.add(moment);
      return d.updatePreferences({ simplifiedMoments: [...set] });
    },
    saveView: async (view: SavedView, s: { key: string; moment: string }) => {
      await d.contextStore.saveView(view);
      await record(s, 'saved');
    },
    deleteView: (id: string) => d.contextStore.deleteView(id),
    isSaved: (key: string) => savedViews.some((v) => v.id === key || v.id.startsWith(`${key}@`)),
  };
}

export type Companion = ReturnType<typeof useCompanion>;
