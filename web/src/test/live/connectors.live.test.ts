// Live checks against real APIs (network required). Run with:  npm run test:live
import { describe, expect, it } from 'vitest';
import { holidays } from '../../core/sources/connectors/calendars';
import { googleBooks, hackerNews, itunesPodcasts, itunesSearchPodcasts, onThisDay, openLibrary, tmdb, tmdbSearch, tvmaze, tvmazeSearch } from '../../core/sources/connectors/media';
import { geocode, inaturalist, mealdb, osrm, usgs, weatherForecast } from '../../core/sources/connectors/places';
import type { ConnectorContext, ContextItem, SourceConnector } from '../../core/sources/types';

const now = new Date();
const seattle = { lat: 47.61, lon: -122.33 };
// Node's default user agent is blocked by OpenStreetMap's usage policy; browsers send their own.
const politeFetch: typeof fetch = (input, init) => fetch(input, { ...init, headers: { 'User-Agent': 'JournalCompanion-livecheck/1.0', ...(init?.headers as Record<string, string>) } });
function ctx(over: Partial<ConnectorContext> = {}): ConnectorContext {
  return { fetch: politeFetch, now, credentials: {}, config: {}, location: seattle, locale: { country: 'US', language: 'en', timeZone: 'America/Los_Angeles' }, peers: [], accessToken: null, ...over };
}
async function run(c: SourceConnector, over: Partial<ConnectorContext> = {}): Promise<ContextItem[]> {
  const items = await c.sync(ctx(over));
  console.log(`  ${c.id}: ${items.length} items${items[0] ? ` — e.g. “${items[0].title}”${items[0].subtitle ? ` (${items[0].subtitle})` : ''}` : ''}`);
  return items;
}

describe('live connectors', { timeout: 60_000 }, () => {
  it('weather: hourly forecast + air quality', async () => {
    const items = await run(weatherForecast);
    const hourly = items.find((i) => i.id === 'weather:hourly')!;
    expect((hourly.data!.hours as unknown[]).length).toBeGreaterThan(48);
    expect(items.some((i) => i.kind === 'forecast' && i.allDay)).toBe(true);
  });
  it('holidays (Nager.Date)', async () => {
    const items = await run(holidays);
    expect(Array.isArray(items)).toBe(true);
  });
  it('TMDB: search, trending details + providers', async () => {
    const token = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TMDB_TOKEN ?? 'proxy-injected';
    const found = await tmdbSearch((...a) => fetch(...a), token, 'Arrival');
    expect(found.length).toBeGreaterThan(0);
    const items = await run(tmdb, { credentials: { token }, config: { watchlist: [found[0]] } });
    expect(items[0].data!.onWatchlist).toBe(true);
    expect(items.some((i) => typeof i.data!.runtime === 'number')).toBe(true);
  });
  it('TVMaze: follow + upcoming episodes', async () => {
    const shows = await tvmazeSearch((...a) => fetch(...a), 'The Daily Show');
    expect(shows.length).toBeGreaterThan(0);
    await run(tvmaze, { config: { followed: shows.slice(0, 2) } });
  });
  it('Apple Podcasts directory: follow + episodes with durations', async () => {
    const pods = await itunesSearchPodcasts((...a) => fetch(...a), 'The Daily');
    expect(pods.length).toBeGreaterThan(0);
    const items = await run(itunesPodcasts, { config: { followed: pods.slice(0, 1) } });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].data!.runtime).toBeGreaterThan(0);
  });
  it('Open Library reading log + Google Books enrichment', async () => {
    const items = await run(openLibrary, { credentials: { username: 'mekBot' } }).catch(async (e) => {
      console.log('  open library (user may be private):', (e as Error).message);
      return [] as ContextItem[];
    });
    const peers: ContextItem[] = items.length ? items : [{ id: 'books_openlibrary:/works/OL45804W', sourceId: 'books_openlibrary', kind: 'book', title: 'Fantastic Mr Fox', fetchedAt: 0, data: { author: 'Roald Dahl' } }];
    const enriched = await run(googleBooks, { peers }).catch((e) => {
      console.log('  google books (quota):', (e as Error).message);
      return [];
    });
    expect(Array.isArray(enriched)).toBe(true);
  });
  it('Nominatim geocoding → OSRM travel time', async () => {
    const event: ContextItem = { id: 'calendar_ics:e1', sourceId: 'calendar_ics', kind: 'event', title: 'Coffee', location: 'Pike Place Market, Seattle', startsAt: new Date(now.getTime() + 2 * 3600_000).toISOString(), fetchedAt: 0 };
    const places = await run(geocode, { peers: [event], config: {} });
    expect(places).toHaveLength(1);
    const routes = await run(osrm, { peers: places, location: { lat: 47.66, lon: -122.31 } });
    expect(routes[0].data!.driveMin).toBeGreaterThan(0);
  });
  it('iNaturalist, USGS, TheMealDB, Hacker News, Wikipedia', async () => {
    expect((await run(inaturalist)).length).toBeGreaterThan(0);
    await run(usgs);
    expect((await run(mealdb)).length).toBeGreaterThan(0);
    expect((await run(hackerNews)).length).toBeGreaterThan(0);
    await run(onThisDay).catch((e) => console.log('  wikipedia (rate-limited):', (e as Error).message));
  });
});
