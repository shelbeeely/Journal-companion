import { describe, expect, it, vi } from 'vitest';
import { JournalAiOrchestrator } from '../core/ai/orchestrator';
import { OpenRouterClient, codeChallengeFor, createCodeVerifier, DEFAULT_AI_SETTINGS, stripInlineThinking, THINKING_BUDGET, type AiSettings } from '../core/ai/openRouterClient';
import type { JournalProject } from '../core/models';

const connected: AiSettings = { ...DEFAULT_AI_SETTINGS, apiKey: 'sk-or-test-123456', consentedAt: 1 };

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function client(settings: AiSettings, impl: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) : null });
    return impl(String(url), init!);
  }) as unknown as typeof fetch;
  return { c: new OpenRouterClient({ getAiSettings: async () => settings }, fetcher, 'https://app.example'), calls };
}

const project: JournalProject = {
  id: 1, title: 'Pocket Pages', writingGoal: 'Write warmly.', originalBrief: 'secret brief about Spencer', audience: 'Close friend', cadence: 'DAILY',
  pageSizeLabel: null, entryLengthLabel: null, linesPerPage: 14, wordsPerLine: 6, themes: ['appreciation'], tonePreferences: 'Warm', boundaries: 'No pressure',
  includePastAnswersInPrompts: true, showDateTimeCard: true, showWeatherCard: true, showSparksCard: true, showRhythmCard: true, showTimerCard: true,
  includeDateTimeInPrompt: false, includeWeatherInPrompt: false, createdAtEpochMs: 0, updatedAtEpochMs: 0,
};
const ctx = { dateTimeText: null, weatherSummary: null, weatherFetchedTimestamp: null };

describe('OpenRouterClient', () => {
  it('stays off without a key or consent and never calls the network', async () => {
    const { c, calls } = client(DEFAULT_AI_SETTINGS, () => reply(200, {}));
    expect((await c.checkAvailability()).kind).toBe('unavailable');
    expect((await c.generate('s', 'p')).kind).toBe('unavailable');
    const { c: c2, calls: calls2 } = client({ ...connected, consentedAt: null }, () => reply(200, {}));
    expect((await c2.generate('s', 'p')).kind).toBe('unavailable');
    expect(calls.length + calls2.length).toBe(0);
  });

  it('sends a privacy-scoped chat completion with structured output', async () => {
    const { c, calls } = client(connected, () => reply(200, { choices: [{ message: { content: '{"hint":"Start here."}' } }] }));
    const res = await c.generate('sys', 'user prompt', { temperature: 0.3, maxTokens: 50, schema: { name: 'hint', schema: { type: 'object' } } });
    expect(res).toEqual({ kind: 'success', text: '{"hint":"Start here."}' });
    const { url, init, body } = calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer sk-or-test-123456');
    expect(h['X-Title']).toBe('Journal Companion');
    expect(h['HTTP-Referer']).toBe('https://app.example');
    expect(body.model).toBe('thinkingmachines/inkling-2-mini');
    expect(body.provider).toEqual({ data_collection: 'deny' });
    expect(body.response_format.json_schema.name).toBe('hint');
    // Thinking on, hidden: OpenRouter drops the reasoning; budget = answer (50) + thinking room.
    expect(body.reasoning).toEqual({ effort: 'low', exclude: true });
    expect(body.max_tokens).toBe(50 + THINKING_BUDGET.low);
    expect(body.user).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  it('maps HTTP errors to fallback-friendly results', async () => {
    for (const [status, kind] of [[401, 'unavailable'], [402, 'unavailable'], [429, 'busy'], [500, 'failure']] as const) {
      const { c } = client(connected, () => reply(status, { error: { message: 'x' } }));
      expect((await c.generate('s', 'p')).kind).toBe(kind);
    }
  });

  it('on 400 retries without the reasoning parameter, then without the schema', async () => {
    let n = 0;
    const { c, calls } = client(connected, () => (n++ < 2 ? reply(400, {}) : reply(200, { choices: [{ message: { content: 'ok text' } }] })));
    expect((await c.generate('s', 'p', { schema: { name: 'x', schema: {} } })).kind).toBe('success');
    expect(calls[1].body.reasoning).toBeUndefined();
    expect(calls[1].body.response_format).toBeDefined();
    expect(calls[2].body.response_format).toBeUndefined();
    expect(calls).toHaveLength(3);
  });

  it('retries once with double the thinking room when the model runs out before answering', async () => {
    const empty = { choices: [{ finish_reason: 'length', message: { content: null } }] };
    let n = 0;
    const { c, calls } = client(connected, () => (n++ === 0 ? reply(200, empty) : reply(200, { choices: [{ finish_reason: 'stop', message: { content: '{"hint":"x"}' } }] })));
    expect(await c.generate('s', 'p', { maxTokens: 60, thinking: 'medium' })).toEqual({ kind: 'success', text: '{"hint":"x"}' });
    expect(calls[0].body.max_tokens).toBe(60 + THINKING_BUDGET.medium);
    expect(calls[1].body.max_tokens).toBe(60 + THINKING_BUDGET.medium * 2);
    // Never loops: a second empty reply is a failure → templates take over.
    const { c: c2, calls: calls2 } = client(connected, () => reply(200, empty));
    expect((await c2.generate('s', 'p')).kind).toBe('failure');
    expect(calls2).toHaveLength(2);
  });

  it('uses only the final answer: reasoning fields are ignored and inline thinking is stripped', async () => {
    const { c } = client(connected, () =>
      reply(200, { choices: [{ finish_reason: 'stop', message: { content: '<think>the user seems sad, maybe mention…</think>\n{"hint":"Start with the light."}', reasoning: 'SECRET THOUGHTS', reasoning_details: [{ text: 'SECRET' }] } }] }),
    );
    const r = await c.generate('s', 'p');
    expect(r).toEqual({ kind: 'success', text: '{"hint":"Start with the light."}' });
    expect(stripInlineThinking('<thinking>a</thinking>ok')).toBe('ok');
    expect(stripInlineThinking('half a thought</think>{"a":1}')).toBe('{"a":1}');
    expect(stripInlineThinking('{"a":"no tags"}')).toBe('{"a":"no tags"}');
  });

  it('per-task depth, raised one level with Deeper thinking', async () => {
    const ok = () => reply(200, { choices: [{ message: { content: 'x' } }] });
    const { c, calls } = client(connected, ok);
    await c.generate('s', 'p', { thinking: 'medium' });
    await c.generate('s', 'p');
    expect(calls.map((x) => x.body.reasoning.effort)).toEqual(['medium', 'low']);
    const { c: deep, calls: dc } = client({ ...connected, thinking: 'deep' }, ok);
    for (const t of ['low', 'medium', 'high'] as const) await deep.generate('s', 'p', { thinking: t, maxTokens: 10 });
    expect(dc.map((x) => x.body.reasoning.effort)).toEqual(['medium', 'high', 'high']);
    expect(dc[0].body.max_tokens).toBe(10 + THINKING_BUDGET.medium);
  });

  it('each journaling task asks for its thinking depth', async () => {
    const { c, calls } = client(connected, () => reply(200, { choices: [{ message: { content: '{}' } }] }));
    const orch = new JournalAiOrchestrator(c);
    await orch.generateNextPrompt(project, [], [], ctx);
    await orch.generateHint(project, 'What steadied you?', []);
    await orch.testConnection();
    expect(calls.map((x) => x.body.reasoning.effort)).toEqual(['medium', 'low', 'low']);
  });

  it('treats network failure as unavailable so templates take over', async () => {
    const { c } = client(connected, () => {
      throw new TypeError('Failed to fetch');
    });
    const orch = new JournalAiOrchestrator(c);
    const r = await orch.generateNextPrompt(project, [], [], ctx);
    expect(r.usedAi).toBe(false);
    expect(r.promptText.length).toBeGreaterThan(10);
  });

  it('caches availability via the /key endpoint', async () => {
    const { c, calls } = client(connected, () => reply(200, { data: {} }));
    expect((await c.checkAvailability()).kind).toBe('available');
    await c.checkAvailability();
    expect(calls.filter((x) => x.url.endsWith('/key'))).toHaveLength(1);
  });
});

describe('discreet scoping', () => {
  it('omits audience and past notes from prompts while discreet', async () => {
    const { c, calls } = client(connected, () => reply(200, { choices: [{ message: { content: '{"prompt":"What steadied you today, in one scene?","topicTag":"steady","hints":[]}' } }] }));
    let discreet = false;
    const orch = new JournalAiOrchestrator(c, () => discreet);
    await orch.generateNextPrompt(project, [], ['Saw your mug on the shelf'], ctx);
    const open = calls[0].body.messages[1].content as string;
    expect(open).toContain('Audience: Close friend');
    expect(open).toContain('mug');
    discreet = true;
    const r = await orch.generateNextPrompt(project, [], ['Saw your mug on the shelf'], ctx);
    const hidden = calls[1].body.messages[1].content as string;
    expect(hidden).not.toContain('Close friend');
    expect(hidden).not.toContain('mug');
    expect(hidden).not.toContain('Spencer');
    expect(r.usedAi).toBe(true);
  });
});

describe('PKCE', () => {
  it('creates an RFC 7636 S256 challenge', async () => {
    // RFC 7636 appendix B test vector
    expect(await codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const v = createCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
