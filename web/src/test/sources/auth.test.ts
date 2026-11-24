import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openJournalDb } from '../../core/db';
import { connectGoogle, disconnectProvider, getAccessToken, googleNeedsRenewal, normalizeRelayUrl, renewGoogle, resetGoogleRenewThrottle } from '../../core/sources/auth';
import { ContextStore } from '../../core/sources/contextStore';
import { GOOGLE_SOURCES } from '../../core/sources/meta';
import { CONNECTORS } from '../../core/sources/registry';
import { handle, type Env } from '../../../../relay/src/worker';

const RELAY = 'https://relay.example.workers.dev';
type Call = { url: string; init?: RequestInit };

/** Fake Google Identity Services: records requests and answers with the scripted response. */
function installGis(opts: { token?: Record<string, unknown>; code?: Record<string, unknown> }) {
  const log: { kind: 'token' | 'code'; prompt?: string; scope: string }[] = [];
  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg: { scope: string; callback: (r: unknown) => void }) => ({
          requestAccessToken: (o?: { prompt?: string }) => {
            log.push({ kind: 'token', prompt: o?.prompt, scope: cfg.scope });
            cfg.callback(opts.token ?? { error: 'interaction_required' });
          },
        }),
        initCodeClient: (cfg: { scope: string; callback: (r: unknown) => void }) => ({
          requestCode: () => {
            log.push({ kind: 'code', scope: cfg.scope });
            cfg.callback(opts.code ?? { error: 'popup_closed' });
          },
        }),
      },
    },
  };
  return log;
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
}

let store: ContextStore;
beforeEach(async () => {
  store = new ContextStore(await openJournalDb(`auth-${Math.random()}`));
  resetGoogleRenewThrottle();
});
afterEach(() => {
  delete (window as unknown as { google?: unknown }).google;
});

describe('Google without a relay (token model)', () => {
  it('signs in, and getAccessToken never tries to refresh after expiry', async () => {
    installGis({ token: { access_token: 'g1', expires_in: 3600, scope: 's' } });
    await connectGoogle(store, 'cid', ['s']);
    expect(await getAccessToken(store, 'google')).toBe('g1');
    await store.setAuth('google', { ...(await store.getAuth('google'))!, expiresAt: Date.now() - 1 });
    const calls: Call[] = [];
    expect(await getAccessToken(store, 'google', fakeFetch(() => new Response('{}'), calls))).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await googleNeedsRenewal(store)).toBe(true);
  });

  it('renews silently with prompt "none", once per 10 minutes', async () => {
    installGis({ token: { access_token: 'g1', expires_in: 3600 } });
    await connectGoogle(store, 'cid', ['cal']);
    await store.setAuth('google', { accessToken: 'old', expiresAt: Date.now() - 1 });
    const log = installGis({ token: { access_token: 'g2', expires_in: 3600 } });
    let t = 1_000_000;
    expect(await renewGoogle(store, () => t)).toBe(true);
    expect(log).toEqual([{ kind: 'token', prompt: 'none', scope: 'cal' }]);
    expect(await getAccessToken(store, 'google')).toBe('g2');
    // Not expired → nothing to do.
    expect(await renewGoogle(store, () => t)).toBe(false);
    // Expired again within 10 minutes → throttled; after → tries again.
    await store.setAuth('google', { accessToken: 'old', expiresAt: Date.now() - 1 });
    t += 60_000;
    expect(await renewGoogle(store, () => t)).toBe(false);
    t += 10 * 60_000;
    expect(await renewGoogle(store, () => t)).toBe(true);
  });

  it('interaction_required leaves the source for Reconnect', async () => {
    installGis({ token: { access_token: 'g1', expires_in: 3600 } });
    await connectGoogle(store, 'cid', ['cal']);
    await store.setAuth('google', { accessToken: 'old', expiresAt: Date.now() - 1 });
    installGis({}); // → interaction_required
    expect(await renewGoogle(store)).toBe(false);
    expect(await getAccessToken(store, 'google')).toBeNull();
  });
});

describe('Google with the token relay (code model)', () => {
  it('rejects a non-https relay URL', async () => {
    expect(normalizeRelayUrl('http://evil.example')).toBeNull();
    expect(normalizeRelayUrl('http://localhost:8787/')).toBe('http://localhost:8787');
    expect(normalizeRelayUrl(`${RELAY}/`)).toBe(RELAY);
    installGis({ code: { code: 'c' } });
    await expect(connectGoogle(store, 'cid', ['cal'], 'http://evil.example')).rejects.toMatchObject({ kind: 'config' });
  });

  it('exchanges the code via the relay, refreshes in the background, revokes on sign-out', async () => {
    const log = installGis({ code: { code: 'auth-code' } });
    const calls: Call[] = [];
    let refreshOk = true;
    const relayFetch = fakeFetch((url) => {
      if (url === `${RELAY}/google/token`) return Response.json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 });
      if (url === `${RELAY}/google/refresh`) return refreshOk ? Response.json({ access_token: 'a2', expires_in: 3600 }) : Response.json({ error: 'invalid_grant' }, { status: 401 });
      if (url === `${RELAY}/google/revoke`) return new Response(null, { status: 204 });
      return new Response('unexpected', { status: 500 });
    }, calls);
    await connectGoogle(store, 'cid', ['cal'], `${RELAY}/`, relayFetch);
    expect(log[0].kind).toBe('code');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ code: 'auth-code' });
    expect(await store.getAuth('google')).toMatchObject({ accessToken: 'a1', refreshToken: 'r1' });
    expect((await store.getCredentials('auth:google')).relayUrl).toBe(RELAY);
    expect(await googleNeedsRenewal(store)).toBe(false); // the relay handles it

    await store.setAuth('google', { ...(await store.getAuth('google'))!, expiresAt: Date.now() - 1 });
    expect(await getAccessToken(store, 'google', relayFetch)).toBe('a2');
    expect(await store.getAuth('google')).toMatchObject({ accessToken: 'a2', refreshToken: 'r1' }); // refresh token kept

    refreshOk = false;
    await store.setAuth('google', { ...(await store.getAuth('google'))!, expiresAt: Date.now() - 1 });
    expect(await getAccessToken(store, 'google', relayFetch)).toBeNull(); // → needs_reauth

    await disconnectProvider(store, 'google', relayFetch);
    expect(JSON.parse(String(calls.at(-1)!.init?.body))).toEqual({ token: 'r1' });
    expect(calls.at(-1)!.url).toBe(`${RELAY}/google/revoke`);
    expect(await store.getAuth('google')).toBeNull();
    // Only the relay was ever contacted from these flows.
    expect(calls.every((c) => c.url.startsWith(RELAY))).toBe(true);
  });

  it('keeps an existing refresh token when Google returns none on re-consent', async () => {
    await store.setAuth('google', { accessToken: 'x', refreshToken: 'r-old', expiresAt: 0 });
    installGis({ code: { code: 'c2' } });
    await connectGoogle(store, 'cid', ['cal'], RELAY, fakeFetch(() => Response.json({ access_token: 'a3', expires_in: 3600 })));
    expect(await store.getAuth('google')).toMatchObject({ accessToken: 'a3', refreshToken: 'r-old' });
  });

  it('GOOGLE_SOURCES matches the connectors that use Google sign-in', () => {
    expect([...GOOGLE_SOURCES].sort()).toEqual(CONNECTORS.filter((c) => c.auth === 'google').map((c) => c.id).sort());
  });
});

describe('relay worker', () => {
  const env: Env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'TOP-SECRET', ALLOWED_ORIGINS: 'https://app.example, http://localhost:5173' };
  const req = (path: string, body: unknown, origin = 'https://app.example', method = 'POST') =>
    new Request(`${RELAY}${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });

  it('refuses other origins, methods and paths', async () => {
    const upstream: Call[] = [];
    const f = fakeFetch(() => Response.json({}), upstream);
    expect((await handle(req('/google/token', { code: 'c' }, 'https://evil.example'), env, f)).status).toBe(403);
    expect((await handle(new Request(`${RELAY}/google/token`, { method: 'POST', body: '{}' }), env, f)).status).toBe(403); // no Origin
    expect((await handle(req('/google/token', null, 'https://app.example', 'GET'), env, f)).status).toBe(405);
    expect((await handle(req('/other', { code: 'c' }), env, f)).status).toBe(404);
    expect((await handle(req('/google/token', {}), env, f)).status).toBe(400);
    expect(upstream).toHaveLength(0);
    const pre = await handle(new Request(`${RELAY}/google/token`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }), env, f);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('adds the secret upstream only and never returns it', async () => {
    const upstream: Call[] = [];
    const f = fakeFetch(() => Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3599, scope: 's', id_token: 'drop-me', client_secret: 'TOP-SECRET' }), upstream);
    const res = await handle(req('/google/token', { code: 'the-code' }), env, f);
    expect(upstream[0].url).toBe('https://oauth2.googleapis.com/token');
    const sent = new URLSearchParams(String(upstream[0].init?.body));
    expect(Object.fromEntries(sent)).toEqual({ client_id: 'cid', client_secret: 'TOP-SECRET', grant_type: 'authorization_code', code: 'the-code', redirect_uri: 'postmessage' });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ access_token: 'a', refresh_token: 'r', expires_in: 3599, scope: 's' });
    expect(text).not.toContain('TOP-SECRET');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const refresh = await handle(req('/google/refresh', { refresh_token: 'r' }), env, f);
    expect(refresh.status).toBe(200);
    expect(Object.fromEntries(new URLSearchParams(String(upstream[1].init?.body)))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r' });
  });

  it('maps Google errors without echoing the request, and revokes', async () => {
    const bad = await handle(req('/google/refresh', { refresh_token: 'r' }), env, fakeFetch(() => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 })));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'invalid_grant' });
    const upstream: Call[] = [];
    const rv = await handle(req('/google/revoke', { token: 'r' }), env, fakeFetch(() => new Response(null, { status: 200 }), upstream));
    expect(rv.status).toBe(204);
    expect(upstream[0].url).toBe('https://oauth2.googleapis.com/revoke');
    expect(String(upstream[0].init?.body)).not.toContain('TOP-SECRET');
    const unconfigured = await handle(req('/google/token', { code: 'c' }), { ...env, GOOGLE_CLIENT_SECRET: '' });
    expect(unconfigured.status).toBe(500);
  });
});
