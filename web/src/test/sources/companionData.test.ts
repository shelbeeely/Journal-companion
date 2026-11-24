import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import type { AiClient, AiGenerationResult } from '../../core/ai/aiClient';
import { interpretSuggestion, JournalAiOrchestrator } from '../../core/ai/orchestrator';
import { openJournalDb } from '../../core/db';
import type { Suggestion } from '../../core/context/moments';
import { readExif } from '../../core/sources/exif';
import { JournalRepository } from '../../core/repository';
import { ContextStore } from '../../core/sources/contextStore';
import { backoffMs, SourceSync } from '../../core/sources/sync';
import { syncOrder } from '../../core/sources/registry';

let n = 0;
const fresh = async () => openJournalDb(`companion-test-${++n}-${Math.random()}`);

class ScriptedAi implements AiClient {
  prompts: string[] = [];
  constructor(private reply: string) {}
  async checkAvailability() {
    return { kind: 'available' } as never;
  }
  async generate(_s: string, prompt: string): Promise<AiGenerationResult> {
    this.prompts.push(prompt);
    return { kind: 'success', text: this.reply } as AiGenerationResult;
  }
}

const suggestion: Suggestion = {
  key: 'outing:e1', moment: 'outing', title: 'Coffee with Sam', summary: '', priority: 80, window: null, reasons: [], missing: [], actions: [],
  sections: { hourly: { label: 'Rain', points: [{ time: '3 PM', temp: 9, pop: 70, condition: 'Rain' }] }, checklist: { title: 'Bring', items: [{ text: 'Book', source: 'Todoist', done: false }] } },
  evidence: [
    { id: 'cal:e1', sourceId: 'calendar_google', sourceLabel: 'Google Calendar', text: 'Coffee with Sam at 3:30 PM', origin: 'data' },
    { id: 'weather:hourly', sourceId: 'weather', sourceLabel: 'Open-Meteo', text: '70% rain 3–5 PM', origin: 'data' },
    { id: 'time:part', sourceId: 'clock', sourceLabel: 'Clock', text: 'Tuesday afternoon', origin: 'time' },
  ],
};

describe('AI interpretation: privacy and grounding', () => {
  it('only sends evidence from sources the user allowed', async () => {
    const ai = new ScriptedAi('{"note":"Bring an umbrella.","layout":["hourly"],"usedEvidence":["weather:hourly"]}');
    const out = await interpretSuggestion(ai, suggestion, new Set(['weather']));
    expect(out).toEqual({ note: 'Bring an umbrella.', layout: ['hourly'] });
    expect(ai.prompts[0]).toContain('70% rain');
    expect(ai.prompts[0]).not.toContain('Sam');
  });

  it('never calls the model when no data source is shared', async () => {
    const ai = new ScriptedAi('{}');
    expect(await interpretSuggestion(ai, suggestion, new Set())).toBeNull();
    expect(ai.prompts).toHaveLength(0);
  });

  it('rejects invented evidence ids, uncited notes and unknown layout sections', async () => {
    const invented = new ScriptedAi('{"note":"Sam is late.","usedEvidence":["cal:e1","made:up"]}');
    expect(await interpretSuggestion(invented, suggestion, new Set(['calendar_google', 'weather']))).toBeNull();
    const hidden = new ScriptedAi('{"note":"x","usedEvidence":["cal:e1"]}'); // not shared → not a valid id
    expect(await interpretSuggestion(hidden, suggestion, new Set(['weather']))).toBeNull();
    const uncited = new ScriptedAi('{"note":"Nice day.","usedEvidence":[]}');
    expect(await interpretSuggestion(uncited, suggestion, new Set(['weather']))).toBeNull();
    const badLayout = new ScriptedAi('{"note":"Rain later.","layout":["Script","hourly","media"],"usedEvidence":["weather:hourly"]}');
    expect(await interpretSuggestion(badLayout, suggestion, new Set(['weather']))).toEqual({ note: 'Rain later.', layout: null }); // any unknown entry → deterministic layout
  });
});

describe('sync manager', () => {
  it('backoff grows and caps', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(50)).toBe(6 * 3_600_000);
  });

  it('dependents sync after their inputs', () => {
    const order = syncOrder(['books_google', 'travel_osrm', 'books_openlibrary', 'places_geocode']);
    expect(order.indexOf('books_openlibrary')).toBeLessThan(order.indexOf('books_google'));
    expect(order.indexOf('places_geocode')).toBeLessThan(order.indexOf('travel_osrm'));
  });

  it('success → connected; failure keeps items as stale; 401 → needs_reauth; runtime config never persisted', async () => {
    const store = new ContextStore(await fresh());
    let mode: 'ok' | 'down' | 'auth' = 'ok';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (mode === 'down') throw new TypeError('Failed to fetch');
      if (mode === 'auth') return new Response('{}', { status: 401 });
      const url = String(input);
      const body = url.includes('/projects') ? { results: [{ id: 'p', name: 'Home' }] } : url.includes('/completed') ? { items: [] } : { results: [{ id: '1', content: 'Water plants', project_id: 'p' }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    let clock = new Date('2026-11-24T18:00:00Z');
    const sync = new SourceSync(store, { fetch: fetchImpl, now: () => clock, location: () => null, locale: () => ({ country: 'US', language: 'en', timeZone: 'UTC' }), runtimeConfig: (id) => (id === 'tasks_todoist' ? { secretSnapshot: 'do-not-store' } : undefined) });
    await store.setCredentials('tasks_todoist', { token: 't' });
    await store.patchState('tasks_todoist', { enabled: true });

    await sync.syncOne('tasks_todoist');
    const s0 = await store.getState('tasks_todoist');
    expect(s0, s0.error ?? '').toMatchObject({ status: 'connected', failures: 0 });
    expect((await store.itemsFor('tasks_todoist')).some((i) => i.title === 'Water plants')).toBe(true);
    expect(await store.getConfig('tasks_todoist')).not.toHaveProperty('secretSnapshot');

    mode = 'down';
    clock = new Date(clock.getTime() + 3_600_000);
    await sync.syncOne('tasks_todoist');
    expect(await store.getState('tasks_todoist')).toMatchObject({ status: 'stale', failures: 1 });
    expect((await store.itemsFor('tasks_todoist')).length).toBeGreaterThan(0);

    mode = 'auth';
    await sync.syncOne('tasks_todoist');
    expect((await store.getState('tasks_todoist')).status).toBe('needs_reauth');

    // Unconfigured credential source → disconnected, no network call.
    await store.patchState('reading_raindrop', { enabled: true });
    await sync.syncOne('reading_raindrop');
    expect((await store.getState('reading_raindrop')).status).toBe('disconnected');
  });
});

describe('storage', () => {
  it('v1 → v2 migration keeps entries and projects', async () => {
    const name = `migrate-${Math.random()}`;
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        const e = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        e.createIndex('byProject', 'projectId');
        e.createIndex('byProjectDate', ['projectId', 'dateIso'], { unique: true });
        db.createObjectStore('history', { keyPath: 'id', autoIncrement: true }).createIndex('byProject', 'projectId');
        db.createObjectStore('kv');
      },
    });
    await v1.put('projects', { id: 1, title: 'Evening Pages' });
    await v1.put('entries', { id: 7, projectId: 1, dateIso: '2026-11-01', draftText: 'kept' });
    await v1.put('kv', { theme: 'DARK' }, 'preferences');
    v1.close();
    const db = await openJournalDb(name);
    expect(await db.get('projects', 1)).toMatchObject({ title: 'Evening Pages' });
    expect(await db.get('entries', 7)).toMatchObject({ draftText: 'kept' });
    expect(await db.get('kv', 'preferences')).toMatchObject({ theme: 'DARK' });
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining(['context', 'savedViews', 'feedback']));
  });

  it('exports never contain credentials, tokens or connected-source data', async () => {
    const db = await fresh();
    const store = new ContextStore(db);
    const repo = new JournalRepository(db, new JournalAiOrchestrator(new ScriptedAi('{}')));
    await store.setCredentials('tasks_todoist', { token: 'SECRET-TODOIST' });
    await store.setAuth('google', { accessToken: 'SECRET-GOOGLE', expiresAt: Date.now() + 1000 });
    await store.replaceItems('weather', [{ id: 'w', sourceId: 'weather', kind: 'forecast', title: 'PRIVATE-ITEM', fetchedAt: 1 }]);
    const json = JSON.stringify(await repo.exportAll());
    expect(json).not.toMatch(/SECRET|PRIVATE-ITEM/);
  });

  it('saved views round-trip newest first and delete', async () => {
    const store = new ContextStore(await fresh());
    const view = (id: string, savedAt: number) => ({ id, title: id, moment: 'watch', savedAt, messages: [{ version: 'v0.9', createSurface: { surfaceId: id } }], evidence: [{ id: 'tmdb:1', sourceId: 'media_tmdb', title: 'Film', fetchedAt: 1 }] });
    await store.saveView(view('a', 1));
    await store.saveView(view('b', 2));
    expect((await store.savedViews()).map((v) => v.id)).toEqual(['b', 'a']);
    expect((await store.savedViews())[1]).toEqual(view('a', 1));
    await store.deleteView('b');
    expect((await store.savedViews()).map((v) => v.id)).toEqual(['a']);
  });
});

describe('EXIF', () => {
  it('reads DateTimeOriginal and GPS from a minimal JPEG', () => {
    // Build a tiny big-endian TIFF inside an APP1 segment.
    const b: number[] = [];
    const u16 = (v: number) => b.push((v >> 8) & 255, v & 255);
    const u32 = (v: number) => b.push((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
    const date = '2025:11:24 12:30:00\0';
    // TIFF header @0
    b.push(0x4d, 0x4d); u16(42); u32(8);
    // IFD0 @8: 2 entries (ExifIFD pointer, GPS pointer)
    const ifd0 = 8, exifIfd = ifd0 + 2 + 2 * 12 + 4, gpsIfd = exifIfd + 2 + 12 + 4, dateOff = gpsIfd + 2 + 4 * 12 + 4, latOff = dateOff + 20, lonOff = latOff + 24;
    u16(2);
    u16(0x8769); u16(4); u32(1); u32(exifIfd);
    u16(0x8825); u16(4); u32(1); u32(gpsIfd);
    u32(0);
    u16(1); u16(0x9003); u16(2); u32(20); u32(dateOff); u32(0);
    u16(4);
    u16(1); u16(2); u32(2); b.push(0x4e, 0, 0, 0); // N
    u16(2); u16(5); u32(3); u32(latOff);
    u16(3); u16(2); u32(2); b.push(0x57, 0, 0, 0); // W
    u16(4); u16(5); u32(3); u32(lonOff);
    u32(0);
    for (const c of date) b.push(c.charCodeAt(0));
    for (const [num, den] of [[47, 1], [36, 1], [0, 1]]) { u32(num); u32(den); }
    for (const [num, den] of [[122, 1], [19, 1], [48, 1]]) { u32(num); u32(den); }
    const tiff = b;
    const app1 = [...'Exif'].map((c) => c.charCodeAt(0)).concat([0, 0], tiff);
    const len = app1.length + 2;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 255, len & 255, ...app1, 0xff, 0xd9]);
    const out = readExif(jpeg.buffer);
    expect(out.takenAt).toMatch(/^2025-11-24T12:30/);
    expect(out.lat).toBeCloseTo(47.6, 2);
    expect(out.lon).toBeCloseTo(-122.33, 2);
  });
});
