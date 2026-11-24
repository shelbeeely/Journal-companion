/**
 * Lightweight source metadata for the main bundle (labels, freshness, defaults).
 * The full connectors load lazily with the sync manager; a unit test keeps this in step with them.
 */

export const SOURCE_META: Record<string, { label: string; ttlMs: number }> = {
  calendar_google: { label: 'Google Calendar', ttlMs: 20 * 60_000 },
  calendar_microsoft: { label: 'Outlook Calendar', ttlMs: 20 * 60_000 },
  calendar_apple: { label: 'Apple iCloud Calendar', ttlMs: 30 * 60_000 },
  calendar_ics: { label: 'Calendar file or link (.ics)', ttlMs: 30 * 60_000 },
  holidays: { label: 'Public holidays', ttlMs: 7 * 86_400_000 },
  tasks_google: { label: 'Google Tasks', ttlMs: 20 * 60_000 },
  tasks_microsoft: { label: 'Microsoft To Do', ttlMs: 20 * 60_000 },
  tasks_todoist: { label: 'Todoist', ttlMs: 15 * 60_000 },
  tasks_trello: { label: 'Trello', ttlMs: 20 * 60_000 },
  projects_github: { label: 'GitHub', ttlMs: 30 * 60_000 },
  files_gdrive: { label: 'Google Drive', ttlMs: 60 * 60_000 },
  files_onedrive: { label: 'OneDrive', ttlMs: 60 * 60_000 },
  files_dropbox: { label: 'Dropbox', ttlMs: 60 * 60_000 },
  habits_habitica: { label: 'Habitica', ttlMs: 20 * 60_000 },
  media_tmdb: { label: 'TMDB (movies & TV)', ttlMs: 6 * 3_600_000 },
  media_tvmaze: { label: 'TVMaze (shows you follow)', ttlMs: 3 * 3_600_000 },
  video_youtube: { label: 'YouTube', ttlMs: 3 * 3_600_000 },
  music_spotify: { label: 'Spotify', ttlMs: 30 * 60_000 },
  music_lastfm: { label: 'Last.fm', ttlMs: 30 * 60_000 },
  podcasts_itunes: { label: 'Podcasts (Apple directory)', ttlMs: 6 * 3_600_000 },
  books_openlibrary: { label: 'Open Library', ttlMs: 12 * 3_600_000 },
  books_google: { label: 'Google Books', ttlMs: 7 * 86_400_000 },
  reading_raindrop: { label: 'Raindrop.io', ttlMs: 2 * 3_600_000 },
  news_hn: { label: 'Hacker News', ttlMs: 3 * 3_600_000 },
  journal: { label: 'Your journal', ttlMs: 5 * 60_000 },
  notes_folder: { label: 'Notes folder (Markdown / Obsidian)', ttlMs: 15 * 60_000 },
  memories_dayone: { label: 'Day One (import)', ttlMs: 6 * 3_600_000 },
  highlights_readwise: { label: 'Readwise', ttlMs: 6 * 3_600_000 },
  context_onthisday: { label: 'Wikipedia: On this day', ttlMs: 12 * 3_600_000 },
  weather: { label: 'Weather & air (Open-Meteo)', ttlMs: 60 * 60_000 },
  places_geocode: { label: 'Places (OpenStreetMap)', ttlMs: 60 * 60_000 },
  travel_osrm: { label: 'Travel time (OSRM)', ttlMs: 30 * 60_000 },
  transit_transitland: { label: 'Public transit (Transitland)', ttlMs: 10 * 60_000 },
  nature_inaturalist: { label: 'Nature nearby (iNaturalist)', ttlMs: 12 * 3_600_000 },
  alerts_usgs: { label: 'Earthquakes nearby (USGS)', ttlMs: 60 * 60_000 },
  food_mealdb: { label: 'Recipe ideas (TheMealDB)', ttlMs: 20 * 3_600_000 },
  share_target: { label: 'Shared to Journal Companion', ttlMs: 60_000 },
  photos_device: { label: 'Photos (from this device)', ttlMs: 60 * 60_000 },
  files_open: { label: 'Open files with the app', ttlMs: 24 * 3_600_000 },
};

/** Sources enabled out of the box (no credentials, low-sensitivity, useful immediately). */
/** Sources that use Google sign-in (kept here so renewal doesn't load the connector registry). */
export const GOOGLE_SOURCES = ['calendar_google', 'tasks_google', 'files_gdrive', 'video_youtube'];

export const DEFAULT_ENABLED = new Set(['journal', 'weather', 'holidays', 'share_target', 'files_open', 'places_geocode']);

export function sourceLabel(id: string): string {
  return (SOURCE_META[id]?.label ?? id).replace(/ \(.*\)$/, '');
}

/** Effective enabled state, including defaults for sources the user hasn't touched. */
export function isEnabled(id: string, states: Record<string, { enabled?: boolean } | undefined>): boolean {
  return states[id]?.enabled ?? DEFAULT_ENABLED.has(id);
}
