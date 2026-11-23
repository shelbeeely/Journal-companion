import type { JournalAiOrchestrator } from './ai/orchestrator';
import { withoutId, type JournalDatabase } from './db';
import {
  DEFAULT_PREFERENCES,
  type DeskUiPreferences,
  type DraftSuggestion,
  type JournalEntry,
  type JournalProject,
  type PromptContextPayload,
  type PromptHistoryItem,
  type ProposedProjectSetup,
  type WeatherSnapshot,
  type WizardSeedInputs,
} from './models';
import { cToDisplay, formatDayLong, formatMonthDayTime, formatTime, localDateIso } from './time';
import * as Weather from './weather';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
const nonBlank = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};

export interface ExportBundle {
  format: 'journal-companion-export';
  version: 1;
  exportedAt: string;
  projects: JournalProject[];
  entries: JournalEntry[];
  history: PromptHistoryItem[];
  preferences: DeskUiPreferences;
}

type Listener = () => void;

export class JournalRepository {
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;

  constructor(
    private readonly db: JournalDatabase,
    readonly ai: JournalAiOrchestrator,
    private readonly todayIso: () => string = () => localDateIso(),
    private readonly now: () => number = () => Date.now(),
    private readonly fetchWeather = Weather,
  ) {
    // Keep multiple windows/tabs of the installed app in sync.
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('journal-companion-sync');
      this.channel.onmessage = () => this.listeners.forEach((l) => l());
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    this.listeners.forEach((l) => l());
    this.channel?.postMessage('changed');
  }

  currentDateIso() {
    return this.todayIso();
  }

  /* ---------------------------------- reads ---------------------------------- */

  async getProjects(): Promise<JournalProject[]> {
    const all = await this.db.getAll('projects');
    return all.sort((a, b) => b.updatedAtEpochMs - a.updatedAtEpochMs);
  }

  async getProject(id: number) {
    return (await this.db.get('projects', id)) ?? null;
  }

  async getEntryForDate(projectId: number, dateIso = this.todayIso()): Promise<JournalEntry | null> {
    return (await this.db.getFromIndex('entries', 'byProjectDate', [projectId, dateIso])) ?? null;
  }

  async getEntriesForProject(projectId: number): Promise<JournalEntry[]> {
    const all = await this.db.getAllFromIndex('entries', 'byProject', projectId);
    return all.sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));
  }

  async getPromptHistory(projectId: number): Promise<PromptHistoryItem[]> {
    const all = await this.db.getAllFromIndex('history', 'byProject', projectId);
    return all.sort((a, b) => b.createdAtEpochMs - a.createdAtEpochMs || b.id - a.id);
  }

  async getPreferences(): Promise<DeskUiPreferences> {
    const stored = (await this.db.get('kv', 'preferences')) as Partial<DeskUiPreferences> | undefined;
    return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
  }

  async getCachedWeather(): Promise<WeatherSnapshot | null> {
    return ((await this.db.get('kv', 'cachedWeather')) as WeatherSnapshot | undefined) ?? null;
  }

  async getFocusBlocksToday(dateIso = this.todayIso()): Promise<number> {
    const v = (await this.db.get('kv', 'focusBlocks')) as { date: string; count: number } | undefined;
    return v?.date === dateIso ? v.count : 0;
  }

  /* --------------------------------- prefs ---------------------------------- */

  async updatePreferences(patch: Partial<DeskUiPreferences>) {
    const current = await this.getPreferences();
    await this.db.put('kv', { ...current, ...patch }, 'preferences');
    this.changed();
  }

  async incrementFocusBlocksToday(dateIso = this.todayIso()) {
    const count = await this.getFocusBlocksToday(dateIso);
    await this.db.put('kv', { date: dateIso, count: count + 1 }, 'focusBlocks');
    this.changed();
  }

  /* -------------------------------- projects -------------------------------- */

  analyzeBrief(brief: string, wizardInputs?: WizardSeedInputs | null): Promise<ProposedProjectSetup> {
    return this.ai.proposeProjectSetup(brief, wizardInputs);
  }

  async createProjectFromSetup(
    originalBrief: string,
    setup: ProposedProjectSetup,
    flags: Partial<
      Pick<
        JournalProject,
        | 'includePastAnswersInPrompts'
        | 'showDateTimeCard'
        | 'showWeatherCard'
        | 'includeDateTimeInPrompt'
        | 'includeWeatherInPrompt'
        | 'showSparksCard'
        | 'showRhythmCard'
        | 'showTimerCard'
      >
    > = {},
  ): Promise<number> {
    const now = this.now();
    const project: JournalProject = {
      id: 0,
      title: setup.title.trim() || 'Journal Project',
      writingGoal: setup.writingGoal.trim() || 'Write one grounded reflection per session.',
      originalBrief: originalBrief.trim(),
      audience: nonBlank(setup.audience),
      cadence: setup.cadence,
      pageSizeLabel: nonBlank(setup.pageSizeLabel),
      entryLengthLabel: nonBlank(setup.entryLengthLabel),
      linesPerPage: clamp(setup.linesPerPage, 5, 60),
      wordsPerLine: clamp(setup.wordsPerLine, 3, 20),
      themes: setup.themes.map((t) => t.trim()).filter(Boolean),
      tonePreferences: nonBlank(setup.tonePreferences),
      boundaries: nonBlank(setup.boundaries),
      includePastAnswersInPrompts: flags.includePastAnswersInPrompts ?? false,
      showDateTimeCard: flags.showDateTimeCard ?? true,
      showWeatherCard: flags.showWeatherCard ?? true,
      showSparksCard: flags.showSparksCard ?? true,
      showRhythmCard: flags.showRhythmCard ?? true,
      showTimerCard: flags.showTimerCard ?? true,
      includeDateTimeInPrompt: flags.includeDateTimeInPrompt ?? false,
      includeWeatherInPrompt: flags.includeWeatherInPrompt ?? false,
      createdAtEpochMs: now,
      updatedAtEpochMs: now,
    };
    const newId = (await this.db.add('projects', withoutId(project) as JournalProject)) as number;
    const dateIso = this.todayIso();
    const firstPrompt = setup.firstPrompt.trim() || 'What is one concrete detail from today worth putting down on paper?';
    // Read before opening the transaction: awaiting other work mid-transaction lets IndexedDB auto-commit it.
    const prefs = { ...(await this.getPreferences()), lastActiveProjectId: newId };
    const tx = this.db.transaction(['entries', 'history', 'kv'], 'readwrite');
    await tx.objectStore('entries').add(
      withoutId<JournalEntry>({
        id: 0,
        projectId: newId,
        dateIso,
        promptText: firstPrompt,
        promptTopicTag: 'opening_prompt',
        hints: setup.firstHints,
        draftText: '',
        isCompleted: false,
        completedAtEpochMs: null,
        updatedAtEpochMs: now,
      }) as JournalEntry,
    );
    await tx.objectStore('history').add(
      withoutId<PromptHistoryItem>({ id: 0, projectId: newId, dateIso, promptText: firstPrompt, topicTag: 'opening_prompt', createdAtEpochMs: now }) as PromptHistoryItem,
    );
    await tx.objectStore('kv').put(prefs, 'preferences');
    await tx.done;
    this.changed();
    return newId;
  }

  /** Updates brief & guidance while strictly preserving all entries and prompt history. */
  async updateProjectPreservingHistory(updated: JournalProject) {
    await this.db.put('projects', { ...updated, updatedAtEpochMs: this.now() });
    this.changed();
  }

  async deleteProject(projectId: number) {
    const tx = this.db.transaction(['projects', 'entries', 'history'], 'readwrite');
    await tx.objectStore('projects').delete(projectId);
    for (const store of ['entries', 'history'] as const) {
      let cursor = await tx.objectStore(store).index('byProject').openCursor(projectId);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
    }
    await tx.done;
    this.changed();
  }

  /* --------------------------------- today ---------------------------------- */

  /** Same day → same question. A new prompt is only generated for a new day or "Try another". */
  async ensureTodayEntry(project: JournalProject, weather: WeatherSnapshot | null, useCelsius: boolean, dateIso = this.todayIso()): Promise<JournalEntry> {
    const existing = await this.getEntryForDate(project.id, dateIso);
    if (existing) return existing;
    return (await this.generateAndPersist(project, weather, useCelsius, dateIso, '', 0, null)).entry;
  }

  async tryAnotherPrompt(project: JournalProject, current: JournalEntry | null, weather: WeatherSnapshot | null, useCelsius: boolean, dateIso = this.todayIso()) {
    return this.generateAndPersist(project, weather, useCelsius, dateIso, current?.draftText ?? '', current?.id ?? 0, current?.promptTopicTag ?? null);
  }

  private async generateAndPersist(
    project: JournalProject,
    weather: WeatherSnapshot | null,
    useCelsius: boolean,
    dateIso: string,
    existingDraft: string,
    existingId: number,
    previousTopic: string | null,
  ): Promise<{ entry: JournalEntry; note: string | null }> {
    const history = (await this.getPromptHistory(project.id)).slice(0, 15);
    const optedIn = project.includePastAnswersInPrompts
      ? (await this.getEntriesForProject(project.id))
          .filter((e) => e.draftText.trim())
          .slice(0, 4)
          .map((e) => e.draftText.trim())
      : [];
    const ctx = this.buildPromptContextPayload(project, weather, useCelsius);
    const gen = await this.ai.generateNextPrompt(project, history, optedIn, ctx, previousTopic);
    const now = this.now();

    // Another window may have created today's entry while we were generating.
    const raced = existingId ? null : await this.getEntryForDate(project.id, dateIso);
    const id = existingId || raced?.id || 0;
    const entry: JournalEntry = {
      id,
      projectId: project.id,
      dateIso,
      promptText: gen.promptText,
      promptTopicTag: gen.topicTag,
      hints: gen.hints,
      draftText: existingDraft || raced?.draftText || '',
      isCompleted: false,
      completedAtEpochMs: null,
      updatedAtEpochMs: now,
    };
    const tx = this.db.transaction(['entries', 'history'], 'readwrite');
    const rowId = (await tx.objectStore('entries').put(withoutId(entry) as JournalEntry)) as number;
    await tx.objectStore('history').add(
      withoutId<PromptHistoryItem>({ id: 0, projectId: project.id, dateIso, promptText: gen.promptText, topicTag: gen.topicTag, createdAtEpochMs: now }) as PromptHistoryItem,
    );
    await tx.done;
    this.changed();
    return { entry: { ...entry, id: rowId }, note: gen.statusNote };
  }

  async requestHint(project: JournalProject, entry: JournalEntry) {
    const result = await this.ai.generateHint(project, entry.promptText, entry.hints);
    const fresh = (await this.db.get('entries', entry.id)) ?? entry;
    await this.db.put('entries', { ...fresh, hints: Array.from(new Set([...fresh.hints, result.hintText])), updatedAtEpochMs: this.now() });
    this.changed();
    return result;
  }

  async saveDraftText(entry: JournalEntry, draftText: string) {
    const fresh = (await this.db.get('entries', entry.id)) ?? entry;
    if (fresh.draftText === draftText) return;
    await this.db.put('entries', { ...fresh, draftText, updatedAtEpochMs: this.now() });
    this.changed();
  }

  async setEntryCompleted(entry: JournalEntry, completed: boolean, draftText?: string) {
    const now = this.now();
    const fresh = (await this.db.get('entries', entry.id)) ?? entry;
    await this.db.put('entries', {
      ...fresh,
      draftText: draftText ?? fresh.draftText,
      isCompleted: completed,
      completedAtEpochMs: completed ? now : null,
      updatedAtEpochMs: now,
    });
    this.changed();
  }

  requestHelpStart(project: JournalProject, entry: JournalEntry): Promise<DraftSuggestion> {
    return this.ai.helpStartDraft(project, entry.promptText);
  }

  requestTightenDraft(project: JournalProject, entry: JournalEntry, draft: string): Promise<DraftSuggestion> {
    return this.ai.tightenDraft(project, entry.promptText, draft);
  }

  /* -------------------------------- weather --------------------------------- */

  async refreshWeatherByCity(city: string): Promise<WeatherSnapshot> {
    const snap = await this.fetchWeather.fetchWeatherByCity(city, undefined, this.now());
    await this.db.put('kv', snap, 'cachedWeather');
    await this.updatePreferences({ manualCityQuery: city.trim() || null });
    return snap;
  }

  async refreshWeatherByCoordinates(lat: number, lon: number, label: string): Promise<WeatherSnapshot> {
    const snap = await this.fetchWeather.fetchWeatherByCoordinates(lat, lon, label, undefined, this.now());
    await this.db.put('kv', snap, 'cachedWeather');
    this.changed();
    return snap;
  }

  buildPromptContextPayload(project: JournalProject, weather: WeatherSnapshot | null, useCelsius: boolean): PromptContextPayload {
    const now = new Date(this.now());
    const dateTimeText = project.includeDateTimeInPrompt ? `${formatDayLong(now)} at ${formatTime(now)}` : null;
    let weatherSummary: string | null = null;
    let weatherFetchedTimestamp: string | null = null;
    if (project.includeWeatherInPrompt && weather) {
      const u = useCelsius ? '°C' : '°F';
      const f = (c: number) => cToDisplay(c, useCelsius);
      const precip =
        weather.precipitationChancePercent != null
          ? `, ${weather.precipitationChancePercent}% precip${weather.precipitationPeriodLabel ? ` ${weather.precipitationPeriodLabel}` : ''}`
          : '';
      weatherSummary = `${weather.conditionLabel}, ${f(weather.temperatureCelsius)}${u} (high ${f(weather.highCelsius)}${u} / low ${f(weather.lowCelsius)}${u}${precip})`;
      weatherFetchedTimestamp = formatMonthDayTime(new Date(weather.fetchedAtEpochMs));
    }
    return { dateTimeText, weatherSummary, weatherFetchedTimestamp };
  }

  /* ---------------------------- backup / restore ---------------------------- */

  async exportAll(): Promise<ExportBundle> {
    return {
      format: 'journal-companion-export',
      version: 1,
      exportedAt: new Date(this.now()).toISOString(),
      projects: await this.db.getAll('projects'),
      entries: await this.db.getAll('entries'),
      history: await this.db.getAll('history'),
      preferences: await this.getPreferences(),
    };
  }

  /** Replaces all local data with the bundle's contents. */
  async importAll(bundle: ExportBundle) {
    if (bundle?.format !== 'journal-companion-export' || !Array.isArray(bundle.projects)) {
      throw new Error("That file isn't a Journal Companion backup.");
    }
    const tx = this.db.transaction(['projects', 'entries', 'history', 'kv'], 'readwrite');
    await Promise.all([tx.objectStore('projects').clear(), tx.objectStore('entries').clear(), tx.objectStore('history').clear()]);
    for (const p of bundle.projects) await tx.objectStore('projects').put(p);
    for (const e of bundle.entries ?? []) await tx.objectStore('entries').put(e);
    for (const h of bundle.history ?? []) await tx.objectStore('history').put(h);
    await tx.objectStore('kv').put({ ...DEFAULT_PREFERENCES, ...(bundle.preferences ?? {}) }, 'preferences');
    await tx.done;
    this.changed();
  }
}
