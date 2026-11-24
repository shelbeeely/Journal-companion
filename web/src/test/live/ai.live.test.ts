/**
 * Live OpenRouter checks (run with `npm run test:live`). The key is never in code: in the cloud
 * sandbox the network proxy injects it; locally set OPENROUTER_API_KEY.
 */
import { describe, expect, it } from 'vitest';
import { interpretSuggestion, JournalAiOrchestrator } from '../../core/ai/orchestrator';
import { DEFAULT_AI_SETTINGS, OpenRouterClient } from '../../core/ai/openRouterClient';
import type { Suggestion } from '../../core/context/moments';
import type { DeskContextSnapshot, JournalProject } from '../../core/models';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const apiKey = env.OPENROUTER_API_KEY ?? 'proxy-injected';
const sent: string[] = [];
const fetcher: typeof fetch = (input, init) => {
  if (typeof init?.body === 'string') sent.push(init.body);
  return fetch(input, init);
};
const client = new OpenRouterClient({ getAiSettings: async () => ({ ...DEFAULT_AI_SETTINGS, apiKey, consentedAt: Date.now(), connectedVia: 'key' as never }) }, fetcher, 'https://journal-companion.app');
const ai = new JournalAiOrchestrator(client);

const project = {
  id: 1, title: 'Evening Pages', writingGoal: 'Notice small good things at the end of the day', originalBrief: '', audience: null, cadence: 'DAILY', pageSizeLabel: null, entryLengthLabel: null, linesPerPage: 14, wordsPerLine: 6,
  themes: ['gratitude', 'people'], tonePreferences: 'gentle, concrete', boundaries: 'no work stress', includePastAnswersInPrompts: false, showDateTimeCard: true, showWeatherCard: true, showSparksCard: true, showRhythmCard: true,
  showTimerCard: true, includeDateTimeInPrompt: true, includeWeatherInPrompt: true, createdAtEpochMs: 0, updatedAtEpochMs: 0,
} as JournalProject;

const outing: Suggestion = {
  key: 'outing:e1', moment: 'outing', title: 'Leave by 3:17 PM for Coffee with Rosalind', summary: '', priority: 80, window: null, reasons: [], missing: [], actions: [],
  sections: {
    event: { title: 'Coffee with Rosalind', time: '3:30 PM', place: 'Pike Place Market' },
    hourly: { label: 'During your plans', points: [{ time: '3 PM', temp: 9, pop: 70, condition: 'Rain' }, { time: '4 PM', temp: 8, pop: 80, condition: 'Rain' }, { time: '5 PM', temp: 8, pop: 30, condition: 'Cloudy' }] },
    checklist: { title: 'Bring', items: [{ text: 'Return the book', source: 'Todoist', done: false }] },
  },
  evidence: [
    { id: 'cal:e1', sourceId: 'calendar_google', sourceLabel: 'Google Calendar', text: 'Coffee with Rosalind · 3:30 PM · Pike Place Market', origin: 'data' },
    { id: 'weather:hourly', sourceId: 'weather', sourceLabel: 'Open-Meteo', text: '70–80% rain 3–5 PM, 8–9°C, clearing to 30% by 5 PM', origin: 'data' },
    { id: 'aq:today', sourceId: 'weather', sourceLabel: 'Open-Meteo', text: 'Air quality good (US AQI 22)', origin: 'data' },
    { id: 'time:sunset', sourceId: 'clock', sourceLabel: 'Clock & calendar', text: 'Sunset at 4:24 PM', origin: 'time' },
  ],
};

describe('OpenRouter live', () => {
  it('key and default model work', async () => {
    expect(await client.checkAvailability()).toEqual({ kind: 'available' });
    const t = await ai.testConnection();
    expect(t.ok, t.message).toBe(true);
  }, 30_000);

  it('interpretation is grounded, private and valid (3 runs)', async () => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      sent.length = 0;
      const started = Date.now();
      const r = await interpretSuggestion(client, outing, new Set(['weather']));
      const prompt = sent.join('\n');
      expect(prompt).toContain('70–80% rain');
      expect(prompt).not.toMatch(/Rosalind|Pike Place|Coffee/); // calendar not shared, title never sent
      results.push({ ok: !!r, ms: Date.now() - started, note: r?.note, layout: r?.layout });
      if (r) {
        expect(r.note.length).toBeLessThanOrEqual(160);
        if (r.layout) expect(r.layout.every((k) => ['event', 'hourly', 'checklist'].includes(k))).toBe(true);
      }
    }
    console.log('interpretations', JSON.stringify(results, null, 1));
    expect(results.filter((r) => r.ok).length).toBe(3);
  }, 90_000);

  it('prompt, hint and desk cues come from the model', async () => {
    const p = await ai.generateNextPrompt(project, [], [], { dateTimeText: 'Tuesday evening, November 24', weatherSummary: 'Light rain, 8°C', weatherFetchedTimestamp: null });
    expect(p.usedAi, p.statusNote ?? '').toBe(true);
    expect(p.promptText.length).toBeGreaterThan(10);
    const h = await ai.generateHint(project, p.promptText, p.hints);
    expect(h.usedAi).toBe(true);
    const cues = await ai.synthesizeDeskCues({
      projectId: 1, projectTitle: project.title, writingGoal: project.writingGoal, originalBrief: '', audience: null, cadenceLabel: 'Daily', tonePreferences: project.tonePreferences, boundaries: project.boundaries,
      promptText: p.promptText, promptTopicLabel: p.topicTag, activeStarter: null, recallQuestion: null, coveredThemes: [], untappedThemes: ['people'], sessionNumber: 3, completedPagesCount: 2,
      writingWindowCue: 'Evening', formattedTime: '8:10 PM', weatherSummary: 'Light rain, 8°C', daylightSummary: 'Sunset was at 4:24 PM', discreetMode: false, recentNoteExcerpt: null,
    } as unknown as DeskContextSnapshot);
    expect(cues && Object.values(cues).some((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    console.log('generated', JSON.stringify({ prompt: p.promptText, hints: p.hints, hint: h.hintText, cues }, null, 1));
  }, 90_000);
});
