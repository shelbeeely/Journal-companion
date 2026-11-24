import { SourceError, type ContextItem, type ContextKind, type GeoPoint } from './types';

/** Shared helpers for connectors: fetch with timeout + uniform error mapping, small utilities. */

export interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number;
  label?: string;
}

export async function fetchJson<T>(fetcher: typeof fetch, url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const res = await fetchRaw(fetcher, url, opts);
  try {
    return (await res.json()) as T;
  } catch {
    throw new SourceError('parse', `${opts.label ?? 'Source'} returned an unreadable response.`);
  }
}

export async function fetchText(fetcher: typeof fetch, url: string, opts: FetchJsonOptions = {}): Promise<string> {
  const res = await fetchRaw(fetcher, url, opts);
  return res.text();
}

export async function fetchRaw(fetcher: typeof fetch, url: string, opts: FetchJsonOptions = {}): Promise<Response> {
  const { timeoutMs = 15_000, label = 'Source', ...init } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetcher(url, { credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin', ...init, signal: controller.signal });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') throw new SourceError('network', `${label} took too long to respond.`);
    // Browsers report CORS refusals and offline as the same TypeError.
    throw new SourceError(
      typeof navigator !== 'undefined' && navigator.onLine === false ? 'network' : 'cors',
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? `Offline — showing the last ${label} data.`
        : `Couldn't reach ${label}. It may be offline or may not allow requests from web apps.`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) return res;
  if (res.status === 401 || res.status === 403) {
    // Only blame credentials when the request actually carried some.
    const headers = new Headers(init.headers);
    const sentCredentials = headers.has('Authorization') || [...headers.keys()].some((k) => /api-key|api-user|token/i.test(k)) || /[?&](key|token|api_key|apikey)=/i.test(url);
    if (sentCredentials) throw new SourceError('auth', `${label} rejected the credentials. Reconnect it in Connections.`, res.status);
    throw new SourceError('http', `${label} refused the request (HTTP ${res.status}). It may be limiting automated use; retrying later.`, res.status);
  }
  if (res.status === 429) throw new SourceError('rate', `${label} is rate-limiting requests; retrying later.`, 429);
  if (res.status === 404) throw new SourceError('config', `${label} couldn't find that (check the username or link).`, 404);
  throw new SourceError('http', `${label} returned HTTP ${res.status}.`, res.status);
}

export const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

export function item(sourceId: string, externalId: string | number, kind: ContextKind, title: string, fetchedAt: number, rest: Partial<ContextItem> = {}): ContextItem {
  return { id: `${sourceId}:${externalId}`, sourceId, kind, title: title.trim() || 'Untitled', fetchedAt, ...rest };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Great-circle distance in km. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Strip HTML tags from API descriptions (no DOM needed). */
export function stripHtml(s: string | null | undefined): string {
  return (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

export function clip(s: string | null | undefined, n = 160): string {
  const t = (s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Serializes calls per key with a minimum interval (polite use of public infrastructure). */
const lastCall = new Map<string, number>();
export async function throttle(key: string, minIntervalMs: number): Promise<void> {
  const last = lastCall.get(key) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  lastCall.set(key, Math.max(Date.now(), last + minIntervalMs));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export function requireField(creds: Record<string, string>, key: string, label: string): string {
  const v = creds[key]?.trim();
  if (!v) throw new SourceError('config', `Add your ${label} in Connections.`);
  return v;
}

/** Items that represent real-world places worth geocoding (events with a location). */
export function locatedEvents(items: ContextItem[]): ContextItem[] {
  return items.filter((i) => i.kind === 'event' && i.location && i.location.trim().length > 2 && !/^https?:\/\//i.test(i.location) && !/zoom|meet\.google|teams\.microsoft/i.test(i.location));
}
