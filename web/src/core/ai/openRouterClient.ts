import type { AiAvailabilityState } from '../models';
import type { AiClient, AiGenerationResult, GenerateOptions } from './aiClient';

/**
 * OpenRouter (https://openrouter.ai) chat-completions client.
 *
 * The PWA is static, so it never ships a key: the user connects their own OpenRouter account
 * (OAuth PKCE) or pastes a key, which is stored only in this browser's IndexedDB.
 * Requests ask providers not to retain or train on data, and carry no user identifiers.
 */

export const OPENROUTER_API = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';

export interface AiSettings {
  apiKey: string | null;
  model: string;
  /** Set once the user accepts the "what gets sent" consent sheet. AI stays off without it. */
  consentedAt: number | null;
  connectedVia: 'oauth' | 'manual' | null;
}

export const DEFAULT_AI_SETTINGS: AiSettings = { apiKey: null, model: DEFAULT_MODEL, consentedAt: null, connectedVia: null };

export interface AiSettingsSource {
  getAiSettings(): Promise<AiSettings>;
}

type Fetcher = typeof fetch;

const AVAILABILITY_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

export class OpenRouterClient implements AiClient {
  private cached: { key: string; at: number; state: AiAvailabilityState } | null = null;

  constructor(
    private readonly settings: AiSettingsSource,
    private readonly fetcher: Fetcher = (...args) => fetch(...args),
    private readonly appOrigin: string = typeof location !== 'undefined' ? location.origin : 'https://journal-companion.app',
  ) {}

  /** Forget the cached availability (call after connecting, disconnecting or changing model). */
  invalidate() {
    this.cached = null;
  }

  async checkAvailability(): Promise<AiAvailabilityState> {
    const s = await this.settings.getAiSettings();
    if (!s.apiKey) return { kind: 'unavailable', reason: 'Connect OpenRouter in Settings to turn on AI. Built-in templates are active.' };
    if (!s.consentedAt) return { kind: 'unavailable', reason: 'Review what gets sent and turn AI on in Settings. Built-in templates are active.' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'unavailable', reason: 'Offline — built-in templates are active.' };
    const cacheKey = `${s.apiKey.slice(-6)}:${s.model}`;
    if (this.cached && this.cached.key === cacheKey && Date.now() - this.cached.at < AVAILABILITY_TTL_MS) return this.cached.state;

    let state: AiAvailabilityState;
    try {
      const res = await this.request('/key', { method: 'GET', headers: this.headers(s.apiKey) }, 8000);
      state =
        res.ok
          ? { kind: 'available' }
          : res.status === 401
            ? { kind: 'error', message: 'OpenRouter rejected the key. Reconnect in Settings.' }
            : res.status === 402
              ? { kind: 'error', message: 'Your OpenRouter account is out of credits.' }
              : { kind: 'unavailable', reason: `OpenRouter is unavailable right now (HTTP ${res.status}). Built-in templates are active.` };
    } catch {
      state = { kind: 'unavailable', reason: 'Could not reach OpenRouter. Built-in templates are active.' };
    }
    this.cached = { key: cacheKey, at: Date.now(), state };
    return state;
  }

  async generate(systemInstruction: string, prompt: string, options: GenerateOptions = {}): Promise<AiGenerationResult> {
    const s = await this.settings.getAiSettings();
    if (!s.apiKey || !s.consentedAt) return { kind: 'unavailable', reason: 'AI is not connected. Using built-in templates.' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'unavailable', reason: 'Offline — using built-in templates.' };

    const body: Record<string, unknown> = {
      model: s.model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 512,
      // Ask OpenRouter to route only to providers that don't retain or train on prompts.
      provider: { data_collection: 'deny' },
    };
    if (options.schema) {
      body.response_format = { type: 'json_schema', json_schema: { name: options.schema.name, strict: true, schema: options.schema.schema } };
    }

    let res: Response;
    try {
      res = await this.request('/chat/completions', { method: 'POST', headers: this.headers(s.apiKey), body: JSON.stringify(body) }, REQUEST_TIMEOUT_MS);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return { kind: 'cancelled' };
      return { kind: 'unavailable', reason: 'Could not reach OpenRouter. Using built-in guidance.' };
    }

    if (!res.ok) {
      // Some models reject structured outputs; retry once without the schema.
      if (res.status === 400 && options.schema) return this.generate(systemInstruction, prompt, { ...options, schema: undefined });
      this.invalidate();
      if (res.status === 401) return { kind: 'unavailable', reason: 'OpenRouter rejected the key. Reconnect in Settings.' };
      if (res.status === 402) return { kind: 'unavailable', reason: 'Your OpenRouter account is out of credits. Using built-in guidance.' };
      if (res.status === 429) return { kind: 'busy', message: 'OpenRouter is rate-limiting requests. Try again in a moment.' };
      return { kind: 'failure', message: `OpenRouter returned HTTP ${res.status}.` };
    }

    try {
      const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[]; error?: { message?: string } };
      if (data.error) return { kind: 'failure', message: data.error.message ?? 'OpenRouter error.' };
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      return text ? { kind: 'success', text } : { kind: 'failure', message: 'The model returned an empty response.' };
    } catch {
      return { kind: 'failure', message: 'Could not read the OpenRouter response.' };
    }
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': this.appOrigin,
      'X-Title': 'Journal Companion',
    };
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetcher(`${OPENROUTER_API}${path}`, { ...init, signal: controller.signal, credentials: 'omit', referrerPolicy: 'strict-origin' });
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ------------------------------- Model list ------------------------------- */

export interface ModelOption {
  id: string;
  name: string;
  promptPricePerM: number | null;
  completionPricePerM: number | null;
  structured: boolean;
}

export async function listModels(fetcher: Fetcher = (...a) => fetch(...a)): Promise<ModelOption[]> {
  const res = await fetcher(`${OPENROUTER_API}/models`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Could not load models (HTTP ${res.status}).`);
  const json = (await res.json()) as {
    data: { id: string; name?: string; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[]; architecture?: { output_modalities?: string[] } }[];
  };
  const perM = (p?: string) => (p == null || Number.isNaN(Number(p)) ? null : Number(p) * 1_000_000);
  return json.data
    .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
    .filter((m) => !m.id.endsWith(':batch'))
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      promptPricePerM: perM(m.pricing?.prompt),
      completionPricePerM: perM(m.pricing?.completion),
      structured: !!m.supported_parameters?.some((p) => p === 'structured_outputs' || p === 'response_format'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------ OAuth (PKCE) ------------------------------ */

const VERIFIER_KEY = 'jc-openrouter-pkce-verifier';

function base64Url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createCodeVerifier(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return base64Url(random(32));
}

export async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** The URL OpenRouter redirects back to: this app, without hash or query. */
export function oauthCallbackUrl(): string {
  return `${location.origin}${location.pathname}`;
}

/** Starts "Connect OpenRouter": stores the verifier for this tab and navigates to OpenRouter. */
export async function beginOpenRouterOAuth() {
  const verifier = createCodeVerifier();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = await codeChallengeFor(verifier);
  const url = new URL('https://openrouter.ai/auth');
  url.searchParams.set('callback_url', oauthCallbackUrl());
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  location.assign(url.toString());
}

/**
 * Completes the OAuth flow if this page load is OpenRouter's redirect (?code=…).
 * Returns the new key, or null if this isn't a callback. Always strips the code from the URL.
 */
export async function completeOpenRouterOAuth(fetcher: Fetcher = (...a) => fetch(...a)): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return null;
  let verifier: string | null = null;
  try {
    verifier = sessionStorage.getItem(VERIFIER_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
  } catch {
    /* storage blocked */
  }
  history.replaceState(null, '', `${location.pathname}#/settings`);
  if (!verifier) throw new Error('OpenRouter sign-in expired. Please try connecting again.');
  const res = await fetcher(`${OPENROUTER_API}/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`OpenRouter sign-in failed (HTTP ${res.status}).`);
  const json = (await res.json()) as { key?: string };
  if (!json.key) throw new Error('OpenRouter did not return a key.');
  return json.key;
}
