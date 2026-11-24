import { codeChallengeFor, createCodeVerifier } from '../ai/openRouterClient';
import type { AuthTokens, ContextStore } from './contextStore';
import { SourceError, type AuthProvider } from './types';

/**
 * Browser-only OAuth for connected sources (no backend, no client secrets).
 * - Microsoft, Spotify, Dropbox: Authorization Code + PKCE redirect, with refresh tokens.
 * - Google: Google Identity Services token client (popup). Tokens last ~1 hour; renewing needs a
 *   user gesture, so background syncs report `needs_reauth` instead of opening popups.
 */

interface PkceProvider {
  authorize: string;
  token: string;
  extraAuthParams?: Record<string, string>;
}

const PKCE: Record<Exclude<AuthProvider, 'google'>, PkceProvider> = {
  microsoft: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    extraAuthParams: { response_mode: 'query' },
  },
  spotify: { authorize: 'https://accounts.spotify.com/authorize', token: 'https://accounts.spotify.com/api/token' },
  dropbox: {
    authorize: 'https://www.dropbox.com/oauth2/authorize',
    token: 'https://api.dropboxapi.com/oauth2/token',
    extraAuthParams: { token_access_type: 'offline' },
  },
};

const PENDING_KEY = 'jc-source-oauth';

export function redirectUri(): string {
  return `${location.origin}${location.pathname}`;
}

interface Pending {
  provider: AuthProvider;
  state: string;
  verifier: string;
  clientId: string;
  scopes: string[];
  returnTo: string;
}

/** Starts a PKCE redirect for Microsoft, Spotify or Dropbox. */
export async function beginPkceAuth(provider: Exclude<AuthProvider, 'google'>, clientId: string, scopes: string[]) {
  if (!clientId) throw new SourceError('config', 'Add the app client ID first.');
  const verifier = createCodeVerifier();
  const state = `jc:${provider}:${createCodeVerifier().slice(0, 16)}`;
  const pending: Pending = { provider, state, verifier, clientId, scopes, returnTo: location.hash || '#/settings/connections' };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const p = PKCE[provider];
  const url = new URL(p.authorize);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', await codeChallengeFor(verifier));
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scopes.join(' '));
  for (const [k, v] of Object.entries(p.extraAuthParams ?? {})) url.searchParams.set(k, v);
  location.assign(url.toString());
}

/** True if the current URL is a redirect back from one of *our* source providers. */
export function isSourceOAuthCallback(search = location.search): boolean {
  return /(^|[?&])state=jc(%3A|:)/.test(search);
}

/**
 * Finishes a PKCE redirect: exchanges the code, stores tokens, cleans the URL.
 * Returns the provider that connected, or null if this load wasn't one of ours.
 */
export async function completePkceAuth(store: ContextStore, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<AuthProvider | null> {
  if (!isSourceOAuthCallback()) return null;
  const params = new URLSearchParams(location.search);
  let pending: Pending | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    pending = null;
  }
  history.replaceState(null, '', `${location.pathname}${pending?.returnTo ?? '#/settings/connections'}`);
  if (params.get('error')) throw new SourceError('auth', `Sign-in was cancelled (${params.get('error')}).`);
  const code = params.get('code');
  if (!pending || !code || params.get('state') !== pending.state || pending.provider === 'google') {
    throw new SourceError('auth', 'That sign-in expired. Please connect again.');
  }
  const p = PKCE[pending.provider];
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: pending.clientId,
    code_verifier: pending.verifier,
  });
  const tokens = await tokenRequest(fetcher, p.token, body, pending.provider);
  await store.setAuth(pending.provider, tokens);
  await store.setCredentials(`auth:${pending.provider}`, { clientId: pending.clientId, scopes: pending.scopes.join(' ') });
  return pending.provider;
}

async function tokenRequest(fetcher: typeof fetch, url: string, body: URLSearchParams, provider: string): Promise<AuthTokens> {
  let res: Response;
  try {
    res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, credentials: 'omit' });
  } catch {
    throw new SourceError('network', `Couldn't reach ${provider} to finish signing in.`);
  }
  if (!res.ok) throw new SourceError('auth', `${provider} sign-in failed (HTTP ${res.status}). Check the app's redirect URI.`, res.status);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000, scope: j.scope };
}

/** Returns a valid access token, refreshing PKCE tokens when needed. Never prompts. */
export async function getAccessToken(store: ContextStore, provider: AuthProvider, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<string | null> {
  const tokens = await store.getAuth(provider);
  if (!tokens) return null;
  if (tokens.expiresAt > Date.now()) return tokens.accessToken;
  if (provider === 'google' || !tokens.refreshToken) return null;
  const meta = await store.getCredentials(`auth:${provider}`);
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: meta.clientId ?? '' });
  if (provider === 'microsoft' && meta.scopes) body.set('scope', meta.scopes);
  try {
    const fresh = await tokenRequest(fetcher, PKCE[provider].token, body, provider);
    await store.setAuth(provider, { ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken });
    return fresh.accessToken;
  } catch {
    return null;
  }
}

/* --------------------------------- Google --------------------------------- */

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string; scope?: string }): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: { initTokenClient(cfg: { client_id: string; scope: string; callback: (r: GisTokenResponse) => void; error_callback?: (e: { type: string }) => void }): GisTokenClient } } };
  }
}

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new SourceError('network', "Couldn't load Google sign-in. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** Interactive Google sign-in (must be called from a user gesture). Requests the union of scopes. */
export async function connectGoogle(store: ContextStore, clientId: string, scopes: string[]): Promise<void> {
  if (!clientId) throw new SourceError('config', 'Add your Google OAuth client ID first (see the README).');
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new SourceError('network', 'Google sign-in is unavailable.');
  const existing = await store.getCredentials('auth:google');
  const allScopes = Array.from(new Set([...(existing.scopes?.split(' ').filter(Boolean) ?? []), ...scopes]));
  const resp = await new Promise<GisTokenResponse>((resolve) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: allScopes.join(' '),
      callback: resolve,
      error_callback: (e) => resolve({ error: e.type }),
    });
    client.requestAccessToken({ prompt: existing.scopes ? '' : 'consent' });
  });
  if (!resp.access_token) throw new SourceError('auth', resp.error === 'popup_closed' ? 'Google sign-in was closed.' : `Google sign-in failed (${resp.error ?? 'unknown'}).`);
  await store.setAuth('google', { accessToken: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 - 60_000, scope: resp.scope });
  await store.setCredentials('auth:google', { clientId, scopes: allScopes.join(' ') });
}

export async function disconnectProvider(store: ContextStore, provider: AuthProvider) {
  await store.setAuth(provider, null);
  await store.setCredentials(`auth:${provider}`, null);
}
