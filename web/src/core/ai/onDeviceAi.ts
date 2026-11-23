import type { AiAvailabilityState } from '../models';

export type AiGenerationResult =
  | { kind: 'success'; text: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'needsDownload'; message: string }
  | { kind: 'busy'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'failure'; message: string };

export interface OnDeviceAiClient {
  checkAvailability(): Promise<AiAvailabilityState>;
  /** Starts (or resumes) the on-device model download, reporting progress. */
  downloadModel(onState: (s: AiAvailabilityState) => void): Promise<void>;
  generate(systemInstruction: string, prompt: string, temperature?: number): Promise<AiGenerationResult>;
}

/* ------------------------------------------------------------------------------------------
 * Chrome / Edge built-in Prompt API (Gemini Nano / Phi on-device). Runs entirely on the
 * user's device: no network calls, no journal text leaves the browser. Every other browser
 * (Safari, Firefox, mobile) transparently uses the built-in template engine instead.
 * ---------------------------------------------------------------------------------------- */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LMSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface LMCreateOptions {
  initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  topK?: number;
  expectedInputs?: { type: 'text'; languages: string[] }[];
  expectedOutputs?: { type: 'text'; languages: string[] }[];
  monitor?: (m: EventTarget) => void;
  signal?: AbortSignal;
}

interface LanguageModelStatic {
  availability(options?: Partial<LMCreateOptions>): Promise<Availability>;
  create(options?: LMCreateOptions): Promise<LMSession>;
  params?(): Promise<{ defaultTopK: number; maxTopK: number; defaultTemperature: number; maxTemperature: number } | null>;
}

const LANG_OPTS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

function getLanguageModel(): LanguageModelStatic | null {
  const g = globalThis as unknown as { LanguageModel?: LanguageModelStatic };
  return g.LanguageModel && typeof g.LanguageModel.create === 'function' ? g.LanguageModel : null;
}

const UNSUPPORTED =
  "This browser doesn't offer an on-device language model. Built-in templates are active (and work fully offline).";

export class BrowserPromptAiClient implements OnDeviceAiClient {
  private topKDefault: number | null = null;

  async checkAvailability(): Promise<AiAvailabilityState> {
    const lm = getLanguageModel();
    if (!lm) return { kind: 'unavailable', reason: UNSUPPORTED };
    try {
      const status = await withTimeout(lm.availability(LANG_OPTS), 3000);
      if (status == null) return { kind: 'unavailable', reason: 'On-device AI check timed out. Built-in templates are active.' };
      switch (status) {
        case 'available':
          return { kind: 'available' };
        case 'downloadable':
          return { kind: 'downloadable', isDownloading: false };
        case 'downloading':
          return { kind: 'downloadable', isDownloading: true };
        default:
          return {
            kind: 'unavailable',
            reason: 'The on-device model is unavailable on this device (hardware, storage, or browser flags). Built-in templates are active.',
          };
      }
    } catch (e) {
      return { kind: 'unavailable', reason: describe(e) };
    }
  }

  async downloadModel(onState: (s: AiAvailabilityState) => void): Promise<void> {
    const lm = getLanguageModel();
    if (!lm) {
      onState({ kind: 'unavailable', reason: UNSUPPORTED });
      return;
    }
    onState({ kind: 'downloadable', isDownloading: true, progress: 0 });
    try {
      // Creating a session (inside a user gesture) is what triggers the browser's model download.
      const session = await lm.create({
        ...LANG_OPTS,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            const loaded = (e as unknown as { loaded?: number }).loaded ?? 0;
            onState({ kind: 'downloadable', isDownloading: true, progress: loaded });
          });
        },
      });
      session.destroy();
      onState({ kind: 'available' });
    } catch (e) {
      onState({ kind: 'error', message: describe(e) });
    }
  }

  async generate(systemInstruction: string, prompt: string, temperature = 0.4): Promise<AiGenerationResult> {
    const lm = getLanguageModel();
    if (!lm) return { kind: 'unavailable', reason: UNSUPPORTED };
    let session: LMSession | null = null;
    try {
      const status = await lm.availability(LANG_OPTS);
      if (status === 'downloadable') return { kind: 'needsDownload', message: 'The on-device model needs to download first. Using built-in guidance.' };
      if (status === 'downloading') return { kind: 'needsDownload', message: 'The on-device model is still downloading. Using built-in guidance for now.' };
      if (status !== 'available') return { kind: 'unavailable', reason: 'On-device AI is not available here. Using built-in templates.' };

      const base: LMCreateOptions = { ...LANG_OPTS, initialPrompts: [{ role: 'system', content: systemInstruction }] };
      session = await this.createWithSampling(lm, base, temperature);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        const text = (await session.prompt(prompt, { signal: controller.signal })).trim();
        return text ? { kind: 'success', text } : { kind: 'failure', message: 'On-device model returned an empty response.' };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === 'AbortError') return { kind: 'cancelled' };
      if (name === 'QuotaExceededError' || name === 'NotAllowedError') return { kind: 'busy', message: describe(e) };
      if (name === 'NotSupportedError') return { kind: 'unavailable', reason: describe(e) };
      return { kind: 'failure', message: describe(e) };
    } finally {
      session?.destroy();
    }
  }

  /** Sampling params are only honoured in some contexts; fall back to defaults if rejected. */
  private async createWithSampling(lm: LanguageModelStatic, base: LMCreateOptions, temperature: number): Promise<LMSession> {
    try {
      if (this.topKDefault == null && lm.params) {
        const p = await lm.params().catch(() => null);
        this.topKDefault = p?.defaultTopK ?? 3;
      }
      return await lm.create({ ...base, temperature, topK: this.topKDefault ?? 3 });
    } catch {
      return lm.create(base);
    }
  }
}

function describe(e: unknown): string {
  const msg = (e as { message?: string })?.message;
  return (msg && msg.slice(0, 160)) || 'On-device AI error. Using built-in templates.';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Client that never has AI — used in tests and as a hard "templates only" mode. */
export class NoAiClient implements OnDeviceAiClient {
  async checkAvailability(): Promise<AiAvailabilityState> {
    return { kind: 'unavailable', reason: 'Templates only.' };
  }
  async downloadModel(onState: (s: AiAvailabilityState) => void): Promise<void> {
    onState({ kind: 'unavailable', reason: 'Templates only.' });
  }
  async generate(): Promise<AiGenerationResult> {
    return { kind: 'unavailable', reason: 'Templates only.' };
  }
}
