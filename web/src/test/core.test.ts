import { describe, expect, it } from 'vitest';
import { JournalAiOrchestrator } from '../core/ai/orchestrator';
import type { AiClient, AiGenerationResult } from '../core/ai/aiClient';
import { openJournalDb } from '../core/db';
import { buildCompanionSurface, buildDeskSnapshot } from '../core/deskContext';
import { generateFallbackTighten } from '../core/fallbackEngine';
import { isWeatherStale, type WeatherSnapshot } from '../core/models';
import { JournalRepository } from '../core/repository';
import { validateProjectProposal, validatePromptResponse } from '../core/validator';
import { summarizePrecipitationWindow } from '../core/weather';

const SPENCER_BRIEF =
  "3.25\" x 4.5\" Mini journal. How can I fill a page a day for my friend spencer while he's in the psych hospital. I want to tell him all tje thingi like about him, why i appreciate his friends, and that i care but i don'twant to seem like I'm being to much or clingy or anything like that. He's my roommate and we are close enough that we literally share a room and I've missed his presence this week";

class UnavailableFakeAi implements AiClient {
  captured: string[] = [];
  async checkAvailability() {
    return { kind: 'unavailable' as const, reason: 'Test device' };
  }
  async generate(_s: string, prompt: string): Promise<AiGenerationResult> {
    this.captured.push(prompt);
    return { kind: 'unavailable', reason: 'Test unavailable' };
  }
}

class ScriptedAi implements AiClient {
  constructor(private readonly reply: string) {}
  async checkAvailability() {
    return { kind: 'available' as const };
  }
  async generate(): Promise<AiGenerationResult> {
    return { kind: 'success', text: this.reply };
  }
}

let dbCounter = 0;
async function buildRepo(opts: { ai?: AiClient; dbName?: string; clock?: { date: string; ms: number } } = {}) {
  const clock = opts.clock ?? { date: '2026-11-15', ms: 1_763_234_836_000 };
  const name = opts.dbName ?? `test-${++dbCounter}-${Math.random()}`;
  const db = await openJournalDb(name);
  const repo = new JournalRepository(db, new JournalAiOrchestrator(opts.ai ?? new UnavailableFakeAi()), () => clock.date, () => clock.ms);
  return { db, repo, clock, name };
}

describe('Spencer acceptance case', () => {
  it('parses discreetly, keeps the same prompt per day, varies tomorrow, supports paper completion, and survives restart', async () => {
    const { db, repo, clock, name } = await buildRepo();
    const setup = await repo.analyzeBrief(SPENCER_BRIEF);

    expect(setup.title).not.toMatch(/spencer|psych|hospital/i);
    expect(setup.title).toBe('Mini Pocket Pages');
    expect(setup.cadence).toBe('DAILY');
    expect(setup.pageSizeLabel).toBe('3.25" × 4.5"');
    expect(setup.themes.some((t) => /appreciation/i.test(t))).toBe(true);
    expect(setup.themes.some((t) => /friends/i.test(t))).toBe(true);
    expect(setup.tonePreferences).toMatch(/low-pressure/i);

    const projectId = await repo.createProjectFromSetup(SPENCER_BRIEF, setup);
    const project = (await repo.getProject(projectId))!;

    const t1 = await repo.ensureTodayEntry(project, null, false, '2026-11-15');
    const t1Again = await repo.ensureTodayEntry(project, null, false, '2026-11-15');
    expect(t1Again.promptText).toBe(t1.promptText);

    await repo.setEntryCompleted(t1, true);
    const saved = (await repo.getEntryForDate(projectId, '2026-11-15'))!;
    expect(saved.isCompleted).toBe(true);
    expect(saved.draftText).toBe('');

    clock.date = '2026-11-16';
    clock.ms += 86_400_000;
    const tomorrow = await repo.ensureTodayEntry(project, null, false, '2026-11-16');
    expect(tomorrow.promptText).not.toBe(t1.promptText);
    expect(tomorrow.promptTopicTag).not.toBe(t1.promptTopicTag);

    await repo.updateProjectPreservingHistory({ ...project, tonePreferences: 'Calm, appreciative' });
    const entries = await repo.getEntriesForProject(projectId);
    expect(entries).toHaveLength(2);
    expect(entries.some((e) => e.dateIso === '2026-11-15' && e.isCompleted)).toBe(true);

    db.close();
    const { repo: repo2, db: db2 } = await buildRepo({ dbName: name, clock });
    expect((await repo2.getPreferences()).lastActiveProjectId).toBe(projectId);
    expect(await repo2.getProjects()).toHaveLength(1);
    expect(await repo2.getEntriesForProject(projectId)).toHaveLength(2);
    db2.close();
  });
});

describe('brief parsing', () => {
  it('leaves unknown fields unset for daily reflection and creative logs', async () => {
    const { repo } = await buildRepo();
    const daily = await repo.analyzeBrief('A daily reflection journal to unwind after work without productivity pressure.');
    expect(daily.cadence).toBe('DAILY');
    expect(daily.pageSizeLabel).toBeNull();

    const creative = await repo.analyzeBrief('Studio project log for my ceramics and glaze experiments whenever I work.');
    expect(creative.cadence).toBe('WHENEVER');
    expect(creative.pageSizeLabel).toBeNull();
    expect(creative.themes.some((t) => /craft|process/i.test(t))).toBe(true);
  });

  it('applies wizard inputs over the template proposal', async () => {
    const { repo } = await buildRepo();
    const s = await repo.analyzeBrief('Evening notes', { cadence: 'WEEKLY', pageSizeLabel: 'A6', audience: 'Myself' });
    expect(s.cadence).toBe('WEEKLY');
    expect(s.pageSizeLabel).toBe('A6');
    expect([s.linesPerPage, s.wordsPerLine]).toEqual([16, 7]);
    expect(s.audience).toBe('Myself');
  });

  it('uses validated on-device AI output and redacts sensitive titles', async () => {
    const reply = '```json\n{"title":"Hospital Letters","writingGoal":"Write kindly.","cadence":"daily","pageSizeLabel":"null","themes":["care","none"],"firstPrompt":"What made you smile today?","firstHints":["a","a","b"]}\n```';
    const { repo } = await buildRepo({ ai: new ScriptedAi(reply) });
    const s = await repo.analyzeBrief('anything');
    expect(s.usedAi).toBe(true);
    expect(s.title).toBe('Pocket Pages');
    expect(s.pageSizeLabel).toBeNull();
    expect(s.themes).toEqual(['care']);
    expect(s.firstHints).toEqual(['a', 'b']);
  });

  it('falls back to templates when AI returns invalid JSON', async () => {
    const { repo } = await buildRepo({ ai: new ScriptedAi('sure! here you go') });
    const s = await repo.analyzeBrief(SPENCER_BRIEF);
    expect(s.usedAi).toBe(false);
    expect(s.statusNote).toMatch(/failed validation/);
  });
});

describe('context privacy & weather', () => {
  const stale = (now: number): WeatherSnapshot => ({
    cityLabel: 'Seattle',
    latitudeRounded: 47.61,
    longitudeRounded: -122.33,
    conditionLabel: 'Light rain',
    wmoCode: 61,
    temperatureCelsius: 10,
    highCelsius: 12,
    lowCelsius: 7,
    precipitationChancePercent: 70,
    precipitationPeriodLabel: 'this evening (5–9 PM)',
    fetchedAtEpochMs: now - 3 * 60 * 60 * 1000,
  });

  it('omits weather unless opted in and flags stale weather', async () => {
    const ai = new UnavailableFakeAi();
    const { repo, clock } = await buildRepo({ ai });
    const setup = await repo.analyzeBrief('Daily reflection');
    const id = await repo.createProjectFromSetup('Daily reflection', setup, { includeWeatherInPrompt: false });
    const project = (await repo.getProject(id))!;
    const w = stale(clock.ms);
    expect(isWeatherStale(w, clock.ms)).toBe(true);

    const off = repo.buildPromptContextPayload(project, w, false);
    expect(off.weatherSummary).toBeNull();
    expect(off.weatherFetchedTimestamp).toBeNull();

    const on = repo.buildPromptContextPayload({ ...project, includeWeatherInPrompt: true }, w, false);
    expect(on.weatherSummary).toContain('Light rain');
    expect(on.weatherSummary).toContain('70% precip');
    expect(on.weatherFetchedTimestamp).not.toBeNull();

    // The AI payload for a new day must not mention weather when disabled.
    clock.date = '2026-11-16';
    await repo.ensureTodayEntry(project, w, false, '2026-11-16');
    expect(ai.captured.at(-1)).not.toMatch(/Weather|Seattle/);
  });

  it('summarizes the upcoming precipitation peak', () => {
    const times = ['2026-11-15T09:00', '2026-11-15T14:00', '2026-11-15T18:00'];
    expect(summarizePrecipitationWindow(times, [90, 20, 60], 12)).toEqual([60, 'this evening (5–9 PM)']);
    expect(summarizePrecipitationWindow([], [], 12)).toEqual([null, null]);
  });
});

describe('desk snapshot & companion', () => {
  it('hides brief, audience and excerpts in discreet mode', async () => {
    const { repo, clock } = await buildRepo();
    const setup = await repo.analyzeBrief(SPENCER_BRIEF);
    const id = await repo.createProjectFromSetup(SPENCER_BRIEF, setup, { includePastAnswersInPrompts: true });
    const project = (await repo.getProject(id))!;
    const e1 = (await repo.getEntryForDate(id))!;
    await repo.saveDraftText(e1, 'Saw your mug on the shelf today.');
    clock.date = '2026-11-16';
    const today = await repo.ensureTodayEntry(project, null, false, '2026-11-16');
    const entries = await repo.getEntriesForProject(id);
    const history = await repo.getPromptHistory(id);
    const args = { project, todayEntry: today, entries, history, draftWordCount: 0, weather: null, useCelsius: false, now: new Date(2026, 10, 16, 8, 0) };

    const open = buildCompanionSurface(buildDeskSnapshot({ ...args, discreetMode: false }), null);
    expect(open.intent.audience).toBe('Close friend & roommate');
    expect(open.starter.continuityBody).toContain('mug');
    expect(open.starter.continuityTitle).toBe('Thread from Yesterday');

    const discreet = buildCompanionSurface(buildDeskSnapshot({ ...args, discreetMode: true }), null);
    expect(discreet.intent.audience).toBe('');
    expect(discreet.intent.briefHighlights).toBe('');
    expect(discreet.starter.continuityBody).not.toContain('mug');
    expect(JSON.stringify(discreet)).not.toMatch(/spencer|psych|hospital/i);
  });
});

describe('validators & helpers', () => {
  it('rejects duplicate AI prompts', () => {
    const raw = '{"prompt":"What was one quiet moment today?","topicTag":"Quiet","hints":[]}';
    expect(validatePromptResponse(raw, ['What was one quiet moment today?'])).toBeNull();
    expect(validatePromptResponse(raw, [])?.topicTag).toBe('quiet');
  });

  it('rejects incomplete proposals', () => {
    expect(validateProjectProposal('{"title":"x"}')).toBeNull();
  });

  it('tightens drafts without inventing words', () => {
    expect(generateFallbackTighten('I  really just   liked it , very much .', null)).toBe('I liked it, much.');
  });

  it('round-trips export/import', async () => {
    const { repo } = await buildRepo();
    const s = await repo.analyzeBrief('Daily reflection');
    await repo.createProjectFromSetup('Daily reflection', s);
    const bundle = await repo.exportAll();
    const { repo: other } = await buildRepo();
    await other.importAll(JSON.parse(JSON.stringify(bundle)));
    expect(await other.getProjects()).toHaveLength(1);
    await expect(other.importAll({} as never)).rejects.toThrow(/backup/);
  });
});
