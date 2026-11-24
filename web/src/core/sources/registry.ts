import { appleCalendar, googleCalendar, holidays, icsCalendar, microsoftCalendar } from './connectors/calendars';
import { dayOne, devicePhotos, fileOpen, journal, notesFolder, shareTarget } from './connectors/local';
import { googleBooks, hackerNews, itunesPodcasts, lastfm, onThisDay, openLibrary, raindrop, readwise, spotify, tmdb, tvmaze, youtube } from './connectors/media';
import { geocode, inaturalist, mealdb, osrm, transitland, usgs, weatherForecast } from './connectors/places';
import { dropbox, github, googleDrive, googleTasks, habitica, microsoftTodo, oneDrive, todoist, trello } from './connectors/work';
import type { SourceCategory, SourceConnector, UnsupportedSource } from './types';

export const CONNECTORS: SourceConnector[] = [
  // calendars
  googleCalendar,
  microsoftCalendar,
  appleCalendar,
  icsCalendar,
  holidays,
  // tasks & projects
  googleTasks,
  microsoftTodo,
  todoist,
  trello,
  github,
  // files
  googleDrive,
  oneDrive,
  dropbox,
  // habits
  habitica,
  // media & listening
  tmdb,
  tvmaze,
  youtube,
  spotify,
  lastfm,
  itunesPodcasts,
  // reading
  openLibrary,
  googleBooks,
  raindrop,
  hackerNews,
  // memories
  journal,
  notesFolder,
  dayOne,
  readwise,
  onThisDay,
  // weather, places, local
  weatherForecast,
  geocode,
  osrm,
  transitland,
  inaturalist,
  usgs,
  mealdb,
  // device
  shareTarget,
  devicePhotos,
  fileOpen,
];

export const CONNECTOR_BY_ID = new Map(CONNECTORS.map((c) => [c.id, c]));

export { DEFAULT_ENABLED } from './meta';

export const CATEGORY_LABELS: Record<SourceCategory, string> = {
  calendar: 'Calendars',
  tasks: 'Tasks & projects',
  files: 'Files & recent work',
  habits: 'Habits & routines',
  media: 'Movies, TV & video',
  listening: 'Music & podcasts',
  reading: 'Books & reading',
  memories: 'Memories & notes',
  weather: 'Weather & air',
  places: 'Places & travel',
  local: 'Outdoors, food & local',
  device: 'On this device',
};

/** Sources people ask for that a server-less web app can't reach — shown with the reason. */
export const UNSUPPORTED: UnsupportedSource[] = [
  { id: 'apple_private', label: 'Private iCloud calendars & Apple Reminders', category: 'calendar', reason: 'Apple offers no web API for these. Share a calendar publicly or export an .ics file.' },
  { id: 'apple_health', label: 'Apple Health', category: 'habits', reason: 'Health data is only available to native iOS apps.' },
  { id: 'google_photos', label: 'Google Photos library', category: 'memories', reason: 'Google removed library read access for third-party apps in 2025. Pick photos from your device instead.' },
  { id: 'strava', label: 'Strava', category: 'habits', reason: 'Strava’s sign-in requires a client secret, which a web app can’t keep safe. It needs a small server (“relay”).' },
  { id: 'oura', label: 'Oura', category: 'habits', reason: 'Oura’s API doesn’t accept requests from web apps (no CORS).' },
  { id: 'fitbit', label: 'Fitbit', category: 'habits', reason: 'The Fitbit Web API doesn’t accept requests from web apps (no CORS).' },
  { id: 'toggl', label: 'Toggl Track', category: 'tasks', reason: 'Toggl’s API doesn’t accept requests from web apps (no CORS).' },
  { id: 'wakatime', label: 'WakaTime', category: 'tasks', reason: 'WakaTime’s API doesn’t accept requests from web apps (no CORS).' },
  { id: 'notion', label: 'Notion', category: 'memories', reason: 'Notion’s API doesn’t accept requests from web apps (no CORS). Export to Markdown and use the notes folder.' },
  { id: 'gmail', label: 'Gmail', category: 'tasks', reason: 'Gmail’s read scopes require a security assessment that isn’t practical for a self-hosted app.' },
  { id: 'trakt', label: 'Trakt', category: 'media', reason: 'Trakt’s sign-in requires a client secret. Use TMDB and TVMaze instead.' },
  { id: 'goodreads', label: 'Goodreads', category: 'reading', reason: 'Goodreads closed its public API. Use Open Library.' },
  { id: 'pocketcasts', label: 'Pocket Casts', category: 'listening', reason: 'No public API that web apps can call. Follow shows via the Apple Podcasts directory.' },
  { id: 'ticketmaster', label: 'Ticketmaster', category: 'local', reason: 'The Discovery API doesn’t accept requests from web apps (no CORS).' },
  { id: 'ebird', label: 'eBird', category: 'local', reason: 'eBird requires a key header that browsers can’t send cross-origin. iNaturalist covers nearby wildlife.' },
];

/** Topologically orders connectors so dependents run after their sources. */
export function syncOrder(ids: string[]): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (out.includes(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const dep of CONNECTOR_BY_ID.get(id)?.dependsOn ?? []) if (set.has(dep)) visit(dep);
    visiting.delete(id);
    out.push(id);
  };
  ids.forEach(visit);
  return out;
}
