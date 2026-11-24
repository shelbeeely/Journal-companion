import { mapWmoCodeToCondition } from '../../weather';
import { addDays, distanceKm, fetchJson, item, locatedEvents, requireField, round2, throttle } from '../kit';
import { SourceError, type ContextItem, type GeoPoint, type SourceConnector } from '../types';

const needLocation = (loc: GeoPoint | null): GeoPoint => {
  if (!loc) throw new SourceError('config', 'Set a weather city or allow approximate location so nearby context can be found.');
  return loc;
};

/* ---------------------------------- Weather (hourly) ---------------------------------- */

export interface HourPoint {
  t: string; // local ISO without offset, as Open-Meteo returns with timezone=auto
  temp: number;
  pop: number | null;
  code: number;
  wind: number | null;
  uv: number | null;
  isDay: boolean;
}

interface OmForecast {
  timezone?: string;
  utc_offset_seconds?: number;
  hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability?: (number | null)[]; weather_code: number[]; wind_speed_10m?: number[]; uv_index?: (number | null)[]; is_day?: number[] };
  daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[]; precipitation_probability_max?: (number | null)[]; sunrise?: string[]; sunset?: string[] };
}
interface OmAir {
  current?: { us_aqi?: number; european_aqi?: number; pm2_5?: number; birch_pollen?: number | null; grass_pollen?: number | null; ragweed_pollen?: number | null };
}

export const weatherForecast: SourceConnector = {
  id: 'weather',
  label: 'Weather & air (Open-Meteo)',
  category: 'weather',
  description: 'Hourly forecast for the next 3 days, sunrise/sunset, air quality and (in Europe) pollen.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 60 * 60_000,
  privacyNote: 'Only rounded coordinates (about 1 km) are sent to Open-Meteo.',
  limitations: 'Pollen data is only available for Europe.',
  isConfigured: (c) => !!c.location,
  async sync(ctx) {
    const loc = needLocation(ctx.location);
    const q = `latitude=${round2(loc.lat)}&longitude=${round2(loc.lon)}`;
    const f = await fetchJson<OmForecast>(
      ctx.fetch,
      `https://api.open-meteo.com/v1/forecast?${q}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,uv_index,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset&forecast_days=3&timezone=auto`,
      { label: 'Open-Meteo' },
    );
    const air = await fetchJson<OmAir>(ctx.fetch, `https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi,european_aqi,pm2_5,birch_pollen,grass_pollen,ragweed_pollen`, { label: 'Open-Meteo air quality' }).catch(() => ({}) as OmAir);
    const out: ContextItem[] = [];
    const h = f.hourly;
    if (h) {
      const hours: HourPoint[] = h.time.map((t, i) => ({ t, temp: h.temperature_2m[i], pop: h.precipitation_probability?.[i] ?? null, code: h.weather_code[i], wind: h.wind_speed_10m?.[i] ?? null, uv: h.uv_index?.[i] ?? null, isDay: h.is_day?.[i] === 1 }));
      out.push(item('weather', 'hourly', 'forecast', 'Hourly forecast', ctx.now.getTime(), { data: { hours, timezone: f.timezone, utcOffsetSeconds: f.utc_offset_seconds } }));
    }
    const d = f.daily;
    d?.time.forEach((date, i) => {
      out.push(
        item('weather', `day:${date}`, 'forecast', `${mapWmoCodeToCondition(d.weather_code[i])}, ${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°C`, ctx.now.getTime(), {
          startsAt: date,
          allDay: true,
          data: { code: d.weather_code[i], max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], pop: d.precipitation_probability_max?.[i] ?? null, sunrise: d.sunrise?.[i], sunset: d.sunset?.[i] },
        }),
      );
    });
    const c = air.current;
    if (c && (c.us_aqi != null || c.european_aqi != null)) {
      const pollen = Math.max(c.birch_pollen ?? 0, c.grass_pollen ?? 0, c.ragweed_pollen ?? 0);
      out.push(item('weather', 'air', 'air', `Air quality ${c.us_aqi ?? c.european_aqi}`, ctx.now.getTime(), { data: { usAqi: c.us_aqi ?? null, euAqi: c.european_aqi ?? null, pm25: c.pm2_5 ?? null, pollen: pollen || null } }));
    }
    return out;
  },
};

/* ------------------------------ Geocoding (Nominatim) ------------------------------ */

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: Record<string, string>;
}

function placeLabel(h: NominatimHit, query: string): string {
  const a = h.address ?? {};
  const name = h.name || a.amenity || a.tourism || a.leisure || a.shop || a.building || query.split(',')[0];
  const locality = a.city || a.town || a.village || a.suburb || a.county;
  return [name, locality && locality !== name ? locality : null].filter(Boolean).join(', ');
}
type GeoCache = Record<string, { lat: number; lon: number; label: string } | null>;

export const geocode: SourceConnector = {
  id: 'places_geocode',
  label: 'Places (OpenStreetMap)',
  category: 'places',
  description: 'Finds where your events are, so weather, travel time and nearby context can be matched.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 60 * 60_000,
  privacyNote: 'Only event location text (e.g. “Victrola Coffee, Seattle”) is sent to OpenStreetMap’s Nominatim; results are cached on this device.',
  limitations: 'Public service limited to one lookup per second; heavy use should self-host.',
  dependsOn: ['calendar_google', 'calendar_microsoft', 'calendar_apple', 'calendar_ics'],
  isConfigured: () => true,
  async sync(ctx) {
    const cache: GeoCache = { ...((ctx.config.cache as GeoCache | undefined) ?? {}) };
    const soon = addDays(ctx.now, 3).getTime();
    const events = locatedEvents(ctx.peers).filter((e) => e.startsAt && new Date(e.startsAt).getTime() <= soon && new Date(e.endsAt ?? e.startsAt).getTime() >= ctx.now.getTime() - 3_600_000);
    let lookups = 0;
    const byPlace = new Map<string, string[]>();
    for (const e of events) {
      const key = e.location!.trim().toLowerCase();
      byPlace.set(key, [...(byPlace.get(key) ?? []), e.id]);
      if (key in cache || lookups >= 5) continue;
      await throttle('nominatim', 1100);
      lookups++;
      const res = await fetchJson<NominatimHit[]>(ctx.fetch, `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(e.location!.trim())}`, { label: 'OpenStreetMap' });
      cache[key] = res[0] ? { lat: round2(+res[0].lat), lon: round2(+res[0].lon), label: placeLabel(res[0], e.location!.trim()) } : null;
    }
    ctx.config.cache = cache; // persisted by the sync manager
    const out: ContextItem[] = [];
    for (const [key, eventIds] of byPlace) {
      const hit = cache[key];
      if (!hit) continue;
      out.push(item('places_geocode', key.slice(0, 80), 'place', hit.label, ctx.now.getTime(), { data: { lat: hit.lat, lon: hit.lon, query: key, eventIds } }));
    }
    return out;
  },
};

/* --------------------------------- Travel time (OSRM) --------------------------------- */

interface OsrmRoute {
  routes?: { duration: number; distance: number }[];
}

export const osrm: SourceConnector = {
  id: 'travel_osrm',
  label: 'Travel time (OSRM)',
  category: 'places',
  description: 'Estimated driving and walking time to upcoming events, for “leave by” reminders.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 30 * 60_000,
  privacyNote: 'Sends your rounded location and the event’s map point to the public OSRM router.',
  limitations: 'Public demo server: driving only, best-effort, rate-limited. Walking time is estimated from distance.',
  dependsOn: ['places_geocode'],
  isConfigured: (c) => !!c.location,
  async sync(ctx) {
    const from = needLocation(ctx.location);
    const places = ctx.peers.filter((p) => p.kind === 'place' && p.sourceId === 'places_geocode').slice(0, 5);
    const out: ContextItem[] = [];
    for (const p of places) {
      const to = { lat: p.data!.lat as number, lon: p.data!.lon as number };
      const straight = distanceKm(from, to);
      if (straight > 300) continue; // not a same-day trip
      await throttle('osrm', 1100);
      const r = await fetchJson<OsrmRoute>(ctx.fetch, `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`, { label: 'OSRM' });
      const route = r.routes?.[0];
      if (!route) continue;
      const km = route.distance / 1000;
      out.push(
        item('travel_osrm', p.id, 'route', `${Math.round(route.duration / 60)} min drive to ${p.title}`, ctx.now.getTime(), {
          data: { placeId: p.id, eventIds: p.data!.eventIds, driveMin: Math.max(1, Math.round(route.duration / 60)), km: Math.round(km * 10) / 10, walkMin: km <= 6 ? Math.round((km / 4.8) * 60) : null },
        }),
      );
    }
    return out;
  },
};

/* ------------------------------------ Transitland ------------------------------------ */

interface TlStops {
  stops?: { onestop_id: string; stop_name: string; geometry?: { coordinates: [number, number] } }[];
}
interface TlDepartures {
  stops?: { departures?: { departure_time?: string; departure?: { estimated?: string | null; scheduled?: string }; trip?: { trip_headsign?: string; route?: { route_short_name?: string; route_long_name?: string } } }[] }[];
}

export const transitland: SourceConnector = {
  id: 'transit_transitland',
  label: 'Public transit (Transitland)',
  category: 'places',
  description: 'Next departures from the stop nearest you, for outings.',
  kind: 'network',
  credentialFields: [{ key: 'apiKey', label: 'Transitland API key', type: 'secret', help: 'Free key from the Transitland portal.' }],
  ttlMs: 10 * 60_000,
  privacyNote: 'Sends your rounded location to Transitland to find nearby stops.',
  helpUrl: 'https://www.transit.land/documentation#signing-up-for-an-api-key',
  isConfigured: (c) => !!c.credentials.apiKey?.trim() && !!c.location,
  async sync(ctx) {
    const key = encodeURIComponent(requireField(ctx.credentials, 'apiKey', 'Transitland API key'));
    const loc = needLocation(ctx.location);
    const stops = await fetchJson<TlStops>(ctx.fetch, `https://transit.land/api/v2/rest/stops?lat=${loc.lat}&lon=${loc.lon}&radius=600&limit=3&apikey=${key}`, { label: 'Transitland' });
    const stop = stops.stops?.[0];
    if (!stop) return [];
    const dep = await fetchJson<TlDepartures>(ctx.fetch, `https://transit.land/api/v2/rest/stops/${encodeURIComponent(stop.onestop_id)}/departures?next=5400&limit=6&apikey=${key}`, { label: 'Transitland' });
    const day = ctx.now.toISOString().slice(0, 10);
    return (dep.stops?.[0]?.departures ?? []).map((d, i) => {
      const time = d.departure?.estimated ?? d.departure?.scheduled ?? d.departure_time ?? '';
      const startsAt = /^\d\d:\d\d/.test(time) ? new Date(`${day}T${time}`).toISOString() : time;
      const route = d.trip?.route?.route_short_name || d.trip?.route?.route_long_name || 'Route';
      return item('transit_transitland', `${stop.onestop_id}:${i}`, 'departure', `${route} → ${d.trip?.trip_headsign ?? ''}`.trim(), ctx.now.getTime(), { startsAt, subtitle: stop.stop_name, data: { stop: stop.stop_name, route, realtime: !!d.departure?.estimated } });
    });
  },
};

/* ------------------------------------ iNaturalist ------------------------------------ */

interface InatCounts {
  results?: { count: number; taxon: { id: number; name: string; preferred_common_name?: string; default_photo?: { square_url?: string } } }[];
}

export const inaturalist: SourceConnector = {
  id: 'nature_inaturalist',
  label: 'Nature nearby (iNaturalist)',
  category: 'local',
  description: 'Plants and animals spotted near you or your outing this week.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 12 * 3_600_000,
  privacyNote: 'Sends rounded coordinates (yours, or an upcoming event’s place) to iNaturalist.',
  dependsOn: ['places_geocode'],
  isConfigured: (c) => !!c.location,
  async sync(ctx) {
    const place = ctx.peers.find((p) => p.kind === 'place');
    const at = place ? { lat: place.data!.lat as number, lon: place.data!.lon as number } : needLocation(ctx.location);
    const d1 = addDays(ctx.now, -7).toISOString().slice(0, 10);
    const res = await fetchJson<InatCounts>(ctx.fetch, `https://api.inaturalist.org/v1/observations/species_counts?lat=${round2(at.lat)}&lng=${round2(at.lon)}&radius=5&d1=${d1}&quality_grade=research&per_page=6`, { label: 'iNaturalist' });
    return (res.results ?? []).map((r) =>
      item('nature_inaturalist', r.taxon.id, 'observation', r.taxon.preferred_common_name ?? r.taxon.name, ctx.now.getTime(), {
        subtitle: r.taxon.preferred_common_name ? r.taxon.name : undefined,
        imageUrl: r.taxon.default_photo?.square_url,
        url: `https://www.inaturalist.org/taxa/${r.taxon.id}`,
        data: { count: r.count, nearPlace: place?.title ?? null },
      }),
    );
  },
};

/* --------------------------------------- USGS --------------------------------------- */

interface UsgsFeed {
  features?: { id: string; properties: { mag: number; place: string; time: number; url: string; tsunami?: number } }[];
}

export const usgs: SourceConnector = {
  id: 'alerts_usgs',
  label: 'Earthquakes nearby (USGS)',
  category: 'local',
  description: 'Notable earthquakes within 300 km in the past day. Shown only when relevant.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 60 * 60_000,
  privacyNote: 'Sends rounded coordinates to the USGS earthquake service.',
  isConfigured: (c) => !!c.location,
  async sync(ctx) {
    const loc = needLocation(ctx.location);
    const start = addDays(ctx.now, -1).toISOString();
    const res = await fetchJson<UsgsFeed>(ctx.fetch, `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&latitude=${loc.lat}&longitude=${loc.lon}&maxradiuskm=300&minmagnitude=3.5&orderby=magnitude&limit=5`, { label: 'USGS' });
    return (res.features ?? []).map((f) =>
      item('alerts_usgs', f.id, 'alert', `M${f.properties.mag.toFixed(1)} earthquake · ${f.properties.place}`, ctx.now.getTime(), { startsAt: new Date(f.properties.time).toISOString(), url: f.properties.url, data: { mag: f.properties.mag, tsunami: !!f.properties.tsunami } }),
    );
  },
};

/* -------------------------------------- TheMealDB -------------------------------------- */

interface MealRes {
  meals?: { idMeal: string; strMeal: string; strCategory?: string; strArea?: string; strMealThumb?: string; strSource?: string; strYoutube?: string }[] | null;
}

export const mealdb: SourceConnector = {
  id: 'food_mealdb',
  label: 'Recipe ideas (TheMealDB)',
  category: 'local',
  description: 'A few dinner ideas for free evenings.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 20 * 3_600_000,
  privacyNote: 'Public data; nothing about you is sent.',
  isConfigured: () => true,
  async sync(ctx) {
    const out: ContextItem[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const res = await fetchJson<MealRes>(ctx.fetch, 'https://www.themealdb.com/api/json/v1/1/random.php', { label: 'TheMealDB' });
      const m = res.meals?.[0];
      if (!m || seen.has(m.idMeal)) continue;
      seen.add(m.idMeal);
      out.push(item('food_mealdb', m.idMeal, 'recipe', m.strMeal, ctx.now.getTime(), { subtitle: [m.strArea, m.strCategory].filter(Boolean).join(' · '), imageUrl: m.strMealThumb ? `${m.strMealThumb}/preview` : undefined, url: m.strSource || m.strYoutube || `https://www.themealdb.com/meal/${m.idMeal}`, data: {} }));
    }
    return out;
  },
};
