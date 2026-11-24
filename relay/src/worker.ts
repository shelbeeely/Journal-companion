/**
 * Journal Companion token relay (Cloudflare Worker, standard Fetch API only).
 *
 * Google only issues refresh tokens through the authorization-code flow, and exchanging a code
 * for a Web-application client needs the client secret, which a static PWA can't keep. This
 * relay holds the secret and does exactly three things for allowed origins:
 *   POST /google/token   {code}           → {access_token, refresh_token, expires_in, scope}
 *   POST /google/refresh {refresh_token}  → {access_token, expires_in, scope}
 *   POST /google/revoke  {token}          → 204
 * It stores nothing and logs nothing. Tokens stay in the user's browser.
 */

export interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Comma-separated exact origins, e.g. "https://you.github.io,http://localhost:5173". */
  ALLOWED_ORIGINS: string;
}

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const RESPONSE_FIELDS = ['access_token', 'refresh_token', 'expires_in', 'scope', 'token_type'] as const;

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(origin ? cors(origin) : {}) } });
}

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const origin = req.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return json({ error: 'origin_not_allowed' }, 403, null);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: 'relay_not_configured' }, 500, origin);

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  let input: Record<string, unknown>;
  try {
    input = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }
  const str = (k: string) => (typeof input[k] === 'string' && (input[k] as string).length > 0 && (input[k] as string).length < 4096 ? (input[k] as string) : null);

  let upstream: URL;
  const body = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET });
  if (path === '/google/token') {
    const code = str('code');
    if (!code) return json({ error: 'missing_code' }, 400, origin);
    upstream = new URL(GOOGLE_TOKEN);
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', 'postmessage'); // GIS popup code flow
  } else if (path === '/google/refresh') {
    const rt = str('refresh_token');
    if (!rt) return json({ error: 'missing_refresh_token' }, 400, origin);
    upstream = new URL(GOOGLE_TOKEN);
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', rt);
  } else if (path === '/google/revoke') {
    const token = str('token');
    if (!token) return json({ error: 'missing_token' }, 400, origin);
    const res = await fetcher(GOOGLE_REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => null);
    return res && (res.ok || res.status === 400) ? new Response(null, { status: 204, headers: cors(origin) }) : json({ error: 'revoke_failed' }, 502, origin);
  } else {
    return json({ error: 'not_found' }, 404, origin);
  }

  let res: Response;
  try {
    res = await fetcher(upstream.toString(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  } catch {
    return json({ error: 'upstream_unreachable' }, 502, origin);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Pass through Google's error code only (e.g. invalid_grant), never the request.
    return json({ error: typeof data.error === 'string' ? data.error : 'upstream_error' }, res.status === 400 || res.status === 401 ? 401 : 502, origin);
  }
  const out: Record<string, unknown> = {};
  for (const k of RESPONSE_FIELDS) if (data[k] !== undefined) out[k] = data[k];
  return json(out, 200, origin);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
};
