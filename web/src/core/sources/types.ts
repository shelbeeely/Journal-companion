/**
 * Connected-source model. Every piece of outside context the companion knows about becomes a
 * `ContextItem` with provenance (which source, fetched when), so suggestions can always explain
 * themselves and distinguish real data from AI interpretation.
 */

export type SourceCategory = 'calendar' | 'tasks' | 'media' | 'listening' | 'reading' | 'memories' | 'files' | 'habits' | 'weather' | 'places' | 'local' | 'device';

export type ContextKind =
  | 'event'
  | 'task'
  | 'project'
  | 'holiday'
  | 'forecast'
  | 'air'
  | 'movie'
  | 'show'
  | 'episode'
  | 'video'
  | 'track'
  | 'podcast_episode'
  | 'book'
  | 'highlight'
  | 'link'
  | 'article'
  | 'note'
  | 'memory'
  | 'file'
  | 'habit'
  | 'place'
  | 'route'
  | 'departure'
  | 'observation'
  | 'alert'
  | 'recipe'
  | 'onthisday'
  | 'photo'
  | 'thought';

export interface ContextItem {
  /** Stable, source-scoped id: `${sourceId}:${externalId}`. */
  id: string;
  sourceId: string;
  kind: ContextKind;
  title: string;
  subtitle?: string;
  /** ISO timestamps (with offset or Z), or YYYY-MM-DD for all-day items. */
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  location?: string;
  url?: string;
  imageUrl?: string;
  /** Completed / watched / read state where meaningful. */
  done?: boolean;
  /** Connector-specific structured fields (kept small and serializable). */
  data?: Record<string, unknown>;
  fetchedAt: number;
}

export type SourceStatus = 'disconnected' | 'connected' | 'syncing' | 'stale' | 'error' | 'needs_reauth' | 'unsupported';

export interface SourceState {
  enabled: boolean;
  status: SourceStatus;
  lastSyncAt: number | null;
  lastAttemptAt: number | null;
  error: string | null;
  itemCount: number;
  /** Include this source when composing suggestions. */
  useForSuggestions: boolean;
  /** Allow the AI layer to read items from this source (off by default). */
  shareWithAi: boolean;
  /** Consecutive failures, for backoff. */
  failures: number;
}

export const DEFAULT_SOURCE_STATE: SourceState = {
  enabled: false,
  status: 'disconnected',
  lastSyncAt: null,
  lastAttemptAt: null,
  error: null,
  itemCount: 0,
  useForSuggestions: true,
  shareWithAi: false,
  failures: 0,
};

export type AuthProvider = 'google' | 'microsoft' | 'spotify' | 'dropbox';

export interface CredentialField {
  key: string;
  label: string;
  type: 'secret' | 'text' | 'url' | 'number';
  placeholder?: string;
  help?: string;
  optional?: boolean;
  /** Build-time env var that can pre-fill this field (e.g. VITE_GOOGLE_CLIENT_ID). */
  envVar?: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface ConnectorContext {
  fetch: typeof fetch;
  now: Date;
  /** User-entered fields for this connector (tokens, usernames, URLs). */
  credentials: Record<string, string>;
  /** Connector-owned config persisted between syncs (watchlists, followed shows, imported files…). */
  config: Record<string, unknown>;
  /** User location, already rounded to 2 decimals, or null. */
  location: GeoPoint | null;
  locale: { country: string; language: string; timeZone: string };
  /** Items currently known from *other* sources (for dependent connectors like geocoding). */
  peers: ContextItem[];
  /** OAuth access token for `auth` connectors (refreshed by the caller), or null. */
  accessToken: string | null;
}

export interface SourceConnector {
  id: string;
  label: string;
  category: SourceCategory;
  description: string;
  /** network = remote API; device = on-device data; builtin = always-on journal data. */
  kind: 'network' | 'device' | 'builtin';
  credentialFields: CredentialField[];
  auth?: AuthProvider;
  scopes?: string[];
  /** How long synced items stay fresh. */
  ttlMs: number;
  /** Plain-language note about exactly what leaves the device. */
  privacyNote: string;
  limitations?: string;
  /** Where to get credentials. */
  helpUrl?: string;
  /** Sources whose items this connector reads via `ctx.peers` (synced after them). */
  dependsOn?: string[];
  /** Ready to sync with what the user has provided. */
  isConfigured(ctx: Pick<ConnectorContext, 'credentials' | 'config' | 'location' | 'accessToken'>): boolean;
  sync(ctx: ConnectorContext): Promise<ContextItem[]>;
}

/** A source that can't run in a static web app, listed so users know why. */
export interface UnsupportedSource {
  id: string;
  label: string;
  category: SourceCategory;
  reason: string;
}

export type SourceErrorKind = 'auth' | 'rate' | 'network' | 'config' | 'cors' | 'http' | 'parse';

export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
