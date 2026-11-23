import type { WeatherSnapshot } from './models';
import { parseLocalDateTime } from './time';

/**
 * Open-Meteo client (https://open-meteo.com/, CC BY 4.0).
 * Privacy: only a city query or 2-decimal-rounded coordinates are sent. Never journal content.
 */
type Fetcher = (url: string) => Promise<Response>;

const defaultFetch: Fetcher = (url) => fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit' });

async function getJson<T>(url: string, fetcher: Fetcher): Promise<T> {
  let res: Response;
  try {
    res = await withTimeout(fetcher(url), 10_000);
  } catch {
    throw new Error('Offline or unable to reach Open-Meteo.');
  }
  if (!res.ok) throw new Error(`Weather service returned HTTP ${res.status}.`);
  return (await res.json()) as T;
}

interface GeoResponse {
  results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[];
}

interface ForecastResponse {
  current?: { temperature_2m: number; apparent_temperature?: number; weather_code: number; wind_speed_10m?: number; is_day?: number };
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; sunrise?: string[]; sunset?: string[]; uv_index_max?: (number | null)[] };
  hourly?: { time?: string[]; precipitation_probability?: (number | null)[] };
}

export async function fetchWeatherByCity(cityQuery: string, fetcher: Fetcher = defaultFetch, nowMs = Date.now()): Promise<WeatherSnapshot> {
  const trimmed = cityQuery.trim();
  if (!trimmed) throw new Error('Enter a city name first.');
  const geo = await getJson<GeoResponse>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`,
    fetcher,
  );
  const match = geo.results?.[0];
  if (!match) throw new Error(`No city found matching "${trimmed}".`);
  const label = [match.name, match.admin1 && match.admin1 !== match.name ? match.admin1 : null].filter(Boolean).join(', ');
  return fetchForecast(match.latitude, match.longitude, label, fetcher, nowMs);
}

export async function fetchWeatherByCoordinates(
  lat: number,
  lon: number,
  cityLabel: string,
  fetcher: Fetcher = defaultFetch,
  nowMs = Date.now(),
): Promise<WeatherSnapshot> {
  return fetchForecast(lat, lon, cityLabel, fetcher, nowMs);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function fetchForecast(lat: number, lon: number, cityLabel: string, fetcher: Fetcher, nowMs: number): Promise<WeatherSnapshot> {
  const latR = round2(lat);
  const lonR = round2(lon);
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${latR}&longitude=${lonR}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max' +
    '&hourly=precipitation_probability' +
    '&forecast_days=1&timezone=auto';
  const parsed = await getJson<ForecastResponse>(url, fetcher);
  const current = parsed.current;
  if (!current) throw new Error('Weather response missing current conditions.');
  const [chance, period] = summarizePrecipitationWindow(
    parsed.hourly?.time ?? [],
    parsed.hourly?.precipitation_probability ?? [],
    new Date(nowMs).getHours(),
  );
  return {
    cityLabel: cityLabel.trim() || 'Local area',
    latitudeRounded: latR,
    longitudeRounded: lonR,
    conditionLabel: mapWmoCodeToCondition(current.weather_code),
    wmoCode: current.weather_code,
    temperatureCelsius: current.temperature_2m,
    highCelsius: parsed.daily?.temperature_2m_max?.[0] ?? current.temperature_2m,
    lowCelsius: parsed.daily?.temperature_2m_min?.[0] ?? current.temperature_2m,
    precipitationChancePercent: chance,
    precipitationPeriodLabel: period,
    fetchedAtEpochMs: nowMs,
    feelsLikeCelsius: current.apparent_temperature ?? null,
    windSpeedKmh: current.wind_speed_10m ?? null,
    sunriseIso: parsed.daily?.sunrise?.[0] ?? null,
    sunsetIso: parsed.daily?.sunset?.[0] ?? null,
    uvIndexMax: parsed.daily?.uv_index_max?.[0] ?? null,
    isDaytime: current.is_day == null ? null : current.is_day === 1,
  };
}

export function summarizePrecipitationWindow(times: string[], probabilities: (number | null)[], currentHour: number): [number | null, string | null] {
  if (!times.length || !probabilities.length) return [null, null];
  const points: [number, number][] = [];
  times.forEach((t, i) => {
    const d = parseLocalDateTime(t);
    const p = probabilities[i];
    if (d && p != null) points.push([d.getHours(), p]);
  });
  if (!points.length) return [null, null];
  const upcoming = points.filter(([h]) => h >= currentHour);
  const pool = upcoming.length ? upcoming : points;
  const peak = pool.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  const h = peak[0];
  const label =
    h <= 5
      ? 'overnight (12–6 AM)'
      : h <= 11
        ? 'this morning (6 AM–12 PM)'
        : h <= 16
          ? 'this afternoon (12–5 PM)'
          : h <= 20
            ? 'this evening (5–9 PM)'
            : 'tonight (9 PM–12 AM)';
  return [peak[1], label];
}

export function mapWmoCodeToCondition(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Foggy';
  if ([51, 53, 55].includes(code)) return 'Drizzle';
  if ([56, 57].includes(code)) return 'Freezing drizzle';
  if ([61, 63, 65].includes(code)) return 'Rain';
  if ([66, 67].includes(code)) return 'Freezing rain';
  if ([71, 73, 75, 77].includes(code)) return 'Snow';
  if ([80, 81, 82].includes(code)) return 'Rain showers';
  if ([85, 86].includes(code)) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm with hail';
  return 'Mixed conditions';
}

export function weatherGlyph(code: number, isDay: boolean | null | undefined): string {
  if (code === 0 || code === 1) return isDay === false ? '☾' : '☀';
  if (code === 2) return '⛅';
  if (code === 3) return '☁';
  if (code === 45 || code === 48) return '🌫';
  if (code >= 71 && code <= 86 && ![80, 81, 82].includes(code)) return '❄';
  if (code >= 95) return '⛈';
  if (code >= 51) return '☂';
  return '☁';
}

/** Coarse, on-demand browser geolocation. Coordinates are rounded before any network call. */
export function getApproximateLocation(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not available in this browser. Enter a city instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: round2(pos.coords.latitude), longitude: round2(pos.coords.longitude) }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission declined. You can always enter a city manually.'
              : 'Approximate location unavailable right now.',
          ),
        ),
      { enableHighAccuracy: false, maximumAge: 30 * 60 * 1000, timeout: 15_000 },
    );
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
