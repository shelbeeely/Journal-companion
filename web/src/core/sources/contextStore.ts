import type { FeedbackEvent, JournalDatabase, SavedView } from '../db';
import { DEFAULT_SOURCE_STATE, type AuthProvider, type ContextItem, type SourceState } from './types';

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  scope?: string;
}

/**
 * Persistence for connected sources. Credentials and tokens live in `kv` under keys that
 * `JournalRepository.exportAll` never reads, so backups never contain them.
 */
export class ContextStore {
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('journal-companion-context') : null;

  constructor(private readonly db: JournalDatabase) {
    if (this.channel) this.channel.onmessage = () => this.listeners.forEach((l) => l());
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    this.listeners.forEach((l) => l());
    this.channel?.postMessage('changed');
  }

  /* --------------------------------- items --------------------------------- */

  async allItems(): Promise<ContextItem[]> {
    return this.db.getAll('context');
  }

  async itemsFor(sourceId: string): Promise<ContextItem[]> {
    return this.db.getAllFromIndex('context', 'bySource', sourceId);
  }

  /** Replaces every item of a source atomically (sync results are authoritative). */
  async replaceItems(sourceId: string, items: ContextItem[]) {
    const tx = this.db.transaction('context', 'readwrite');
    let cursor = await tx.store.index('bySource').openCursor(sourceId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    for (const it of items) await tx.store.put(it);
    await tx.done;
    this.changed();
  }

  async clearItems(sourceId?: string) {
    if (!sourceId) await this.db.clear('context');
    else await this.replaceItems(sourceId, []);
    this.changed();
  }

  /* --------------------------------- state --------------------------------- */

  async getStates(): Promise<Record<string, SourceState>> {
    return ((await this.db.get('kv', 'sourceStates')) as Record<string, SourceState> | undefined) ?? {};
  }

  async getState(id: string): Promise<SourceState> {
    return { ...DEFAULT_SOURCE_STATE, ...((await this.getStates())[id] ?? {}) };
  }

  async patchState(id: string, patch: Partial<SourceState>) {
    const all = await this.getStates();
    all[id] = { ...DEFAULT_SOURCE_STATE, ...(all[id] ?? {}), ...patch };
    await this.db.put('kv', all, 'sourceStates');
    this.changed();
  }

  /* ---------------------- credentials & connector config ---------------------- */

  async getCredentials(id: string): Promise<Record<string, string>> {
    const all = ((await this.db.get('kv', 'sourceCredentials')) as Record<string, Record<string, string>> | undefined) ?? {};
    return all[id] ?? {};
  }

  async setCredentials(id: string, creds: Record<string, string> | null) {
    const all = ((await this.db.get('kv', 'sourceCredentials')) as Record<string, Record<string, string>> | undefined) ?? {};
    if (creds) all[id] = creds;
    else delete all[id];
    await this.db.put('kv', all, 'sourceCredentials');
    this.changed();
  }

  async getConfig(id: string): Promise<Record<string, unknown>> {
    const all = ((await this.db.get('kv', 'sourceConfig')) as Record<string, Record<string, unknown>> | undefined) ?? {};
    return all[id] ?? {};
  }

  async setConfig(id: string, config: Record<string, unknown>) {
    const all = ((await this.db.get('kv', 'sourceConfig')) as Record<string, Record<string, unknown>> | undefined) ?? {};
    all[id] = config;
    await this.db.put('kv', all, 'sourceConfig');
    this.changed();
  }

  async getAuth(provider: AuthProvider): Promise<AuthTokens | null> {
    return ((await this.db.get('kv', `auth:${provider}`)) as AuthTokens | undefined) ?? null;
  }

  async setAuth(provider: AuthProvider, tokens: AuthTokens | null) {
    if (tokens) await this.db.put('kv', tokens, `auth:${provider}`);
    else await this.db.delete('kv', `auth:${provider}`);
    this.changed();
  }

  /* ------------------------------ saved views ------------------------------ */

  async savedViews(): Promise<SavedView[]> {
    return (await this.db.getAll('savedViews')).sort((a, b) => b.savedAt - a.savedAt);
  }

  async saveView(view: SavedView) {
    await this.db.put('savedViews', view);
    this.changed();
  }

  async deleteView(id: string) {
    await this.db.delete('savedViews', id);
    this.changed();
  }

  /* -------------------------------- feedback -------------------------------- */

  async recordFeedback(ev: Omit<FeedbackEvent, 'id'>) {
    await this.db.add('feedback', ev as FeedbackEvent);
    this.changed();
  }

  /** Recent feedback (last 30 days), newest first. */
  async recentFeedback(now = Date.now()): Promise<FeedbackEvent[]> {
    const all = await this.db.getAll('feedback');
    const cutoff = now - 30 * 86_400_000;
    // Opportunistic cleanup keeps the store small.
    const old = all.filter((f) => f.at < cutoff && (f.until ?? 0) < now);
    if (old.length) {
      const tx = this.db.transaction('feedback', 'readwrite');
      for (const f of old) if (f.id != null) await tx.store.delete(f.id);
      await tx.done;
    }
    return all.filter((f) => f.at >= cutoff || (f.until ?? 0) >= now).sort((a, b) => b.at - a.at);
  }

  /** Counts per source, for "What the companion knows". */
  async knowledgeSummary(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const it of await this.allItems()) out[it.sourceId] = (out[it.sourceId] ?? 0) + 1;
    return out;
  }
}
