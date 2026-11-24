import { getAccessToken } from './auth';
import type { ContextStore } from './contextStore';
import { CONNECTOR_BY_ID, syncOrder } from './registry';
import { isEnabled } from './meta';
import { DEFAULT_SOURCE_STATE, SourceError, type ConnectorContext, type ContextItem, type GeoPoint, type SourceState } from './types';

export interface SyncEnvironment {
  fetch: typeof fetch;
  now: () => Date;
  location: () => GeoPoint | null;
  locale: () => ConnectorContext['locale'];
  /** Extra config merged in at sync time (e.g. the journal snapshot for the built-in source). */
  runtimeConfig?: (sourceId: string) => Record<string, unknown> | undefined;
}

const BACKOFF_MAX_MS = 6 * 3_600_000;

export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, 60_000 * 2 ** Math.max(0, failures - 1));
}

export { isEnabled };

/**
 * Keeps connected sources fresh without blocking the UI:
 * - syncs each enabled source when its TTL expires (or on demand), dependents after their inputs;
 * - on failure keeps the last items and marks the source stale / needs_reauth / error, with backoff;
 * - one run at a time.
 */
export class SourceSync {
  private running: Promise<void> | null = null;

  constructor(
    private readonly store: ContextStore,
    private readonly env: SyncEnvironment,
  ) {}

  /** Syncs everything that's due. `force` lists sources to refresh regardless of TTL. */
  run(force: string[] = []): Promise<void> {
    if (this.running) return this.running.then(() => (force.length ? this.run(force) : undefined));
    this.running = this.doRun(new Set(force)).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRun(force: Set<string>) {
    const states = await this.store.getStates();
    const now = this.env.now();
    const enabled = [...CONNECTOR_BY_ID.keys()].filter((id) => isEnabled(id, states));
    for (const id of syncOrder(enabled)) {
      const st = { ...DEFAULT_SOURCE_STATE, ...(states[id] ?? {}), enabled: true };
      const c = CONNECTOR_BY_ID.get(id)!;
      const due = force.has(id) || !st.lastSyncAt || now.getTime() - st.lastSyncAt > c.ttlMs || st.status === 'disconnected';
      const backingOff = !force.has(id) && st.failures > 0 && st.lastAttemptAt != null && now.getTime() - st.lastAttemptAt < backoffMs(st.failures);
      if (!due || backingOff) continue;
      await this.syncOne(id, st);
    }
  }

  async syncOne(id: string, prev?: SourceState): Promise<void> {
    const c = CONNECTOR_BY_ID.get(id);
    if (!c) return;
    const st = prev ?? (await this.store.getState(id));
    const now = this.env.now();
    const [credentials, storedConfig, all] = await Promise.all([this.store.getCredentials(id), this.store.getConfig(id), this.store.allItems()]);
    const config: Record<string, unknown> = { ...storedConfig, ...(this.env.runtimeConfig?.(id) ?? {}) };
    const accessToken = c.auth ? await getAccessToken(this.store, c.auth, this.env.fetch) : null;
    const ctx: ConnectorContext = {
      fetch: this.env.fetch,
      now,
      credentials,
      config,
      location: this.env.location(),
      locale: this.env.locale(),
      peers: all.filter((i) => i.sourceId !== id),
      accessToken,
    };
    if (!c.isConfigured(ctx)) {
      await this.store.patchState(id, {
        enabled: true,
        status: c.auth && (await this.store.getAuth(c.auth)) ? 'needs_reauth' : 'disconnected',
        error: c.auth && (await this.store.getAuth(c.auth)) ? 'Sign-in expired. Tap Reconnect.' : null,
        lastAttemptAt: now.getTime(),
      });
      return;
    }
    await this.store.patchState(id, { enabled: true, status: 'syncing', lastAttemptAt: now.getTime() });
    try {
      const items: ContextItem[] = await c.sync(ctx);
      await this.store.replaceItems(id, items);
      // Connectors may update their own config (e.g. geocode cache); never persist runtime-injected keys.
      const runtimeKeys = Object.keys(this.env.runtimeConfig?.(id) ?? {});
      const nextConfig = Object.fromEntries(Object.entries(config).filter(([k]) => !runtimeKeys.includes(k)));
      if (JSON.stringify(nextConfig) !== JSON.stringify(storedConfig)) await this.store.setConfig(id, nextConfig);
      await this.store.patchState(id, { status: 'connected', lastSyncAt: now.getTime(), error: null, itemCount: items.length, failures: 0 });
    } catch (e) {
      const err = e instanceof SourceError ? e : new SourceError('http', (e as Error)?.message ?? 'Sync failed.');
      const hasData = (await this.store.itemsFor(id)).length > 0;
      await this.store.patchState(id, {
        status: err.kind === 'auth' ? 'needs_reauth' : err.kind === 'config' ? 'error' : hasData ? 'stale' : 'error',
        error: err.message,
        failures: (st.failures ?? 0) + 1,
      });
    }
  }
}
