import { addDays, bearer, clip, fetchJson, fetchRaw, isoDate, item, requireField, stripHtml } from '../kit';
import { SourceError, type ContextItem, type SourceConnector } from '../types';
import { GOOGLE_CLIENT_FIELD, GOOGLE_RELAY_FIELD } from './calendars';

/* ------------------------------------- TMDB ------------------------------------- */

export interface WatchlistEntry {
  id: number;
  type: 'movie' | 'tv';
  title: string;
}

interface TmdbList {
  results?: { id: number; media_type?: string; title?: string; name?: string }[];
}
interface TmdbDetails {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  runtime?: number;
  episode_run_time?: number[];
  genres?: { name: string }[];
  vote_average?: number;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  'watch/providers'?: { results?: Record<string, { flatrate?: { provider_name: string }[]; free?: { provider_name: string }[]; ads?: { provider_name: string }[]; link?: string }> };
}

const TMDB = 'https://api.themoviedb.org/3';

export async function tmdbSearch(fetcher: typeof fetch, token: string, query: string): Promise<WatchlistEntry[]> {
  const res = await fetchJson<TmdbList>(fetcher, `${TMDB}/search/multi?query=${encodeURIComponent(query)}&include_adult=false`, { headers: bearer(token), label: 'TMDB' });
  return (res.results ?? [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 8)
    .map((r) => ({ id: r.id, type: r.media_type as 'movie' | 'tv', title: r.title ?? r.name ?? 'Untitled' }));
}

export const tmdb: SourceConnector = {
  id: 'media_tmdb',
  label: 'TMDB (movies & TV)',
  category: 'media',
  description: 'Your watchlist plus what’s trending, with runtimes and where to stream in your country.',
  kind: 'network',
  credentialFields: [{ key: 'token', label: 'API read access token', type: 'secret', help: 'themoviedb.org → Settings → API → “API Read Access Token”.' }],
  ttlMs: 6 * 3_600_000,
  privacyNote: 'Only titles you add to the watchlist and your country code are sent to TMDB. Your watchlist is stored on this device.',
  helpUrl: 'https://www.themoviedb.org/settings/api',
  isConfigured: (c) => !!c.credentials.token?.trim(),
  async sync(ctx) {
    const token = requireField(ctx.credentials, 'token', 'TMDB token');
    const h = { headers: bearer(token), label: 'TMDB' };
    const region = ctx.locale.country || 'US';
    const watchlist = (ctx.config.watchlist as WatchlistEntry[] | undefined) ?? [];
    const trending = await fetchJson<TmdbList>(ctx.fetch, `${TMDB}/trending/all/week`, h);
    const picks: (WatchlistEntry & { onWatchlist: boolean })[] = [
      ...watchlist.map((w) => ({ ...w, onWatchlist: true })),
      ...(trending.results ?? [])
        .filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && !watchlist.some((w) => w.id === r.id))
        .slice(0, 8)
        .map((r) => ({ id: r.id, type: r.media_type as 'movie' | 'tv', title: r.title ?? r.name ?? '', onWatchlist: false })),
    ];
    const out: ContextItem[] = [];
    for (const p of picks) {
      const d = await fetchJson<TmdbDetails>(ctx.fetch, `${TMDB}/${p.type}/${p.id}?append_to_response=watch/providers`, h);
      const prov = d['watch/providers']?.results?.[region];
      const providers = Array.from(new Set([...(prov?.flatrate ?? []), ...(prov?.free ?? []), ...(prov?.ads ?? [])].map((x) => x.provider_name))).slice(0, 4);
      const runtime = d.runtime ?? d.episode_run_time?.[0] ?? null;
      out.push(
        item('media_tmdb', `${p.type}:${p.id}`, p.type === 'movie' ? 'movie' : 'show', d.title ?? d.name ?? p.title, ctx.now.getTime(), {
          imageUrl: d.poster_path ? `https://image.tmdb.org/t/p/w185${d.poster_path}` : undefined,
          url: prov?.link ?? `https://www.themoviedb.org/${p.type}/${p.id}`,
          subtitle: [d.genres?.slice(0, 2).map((g) => g.name).join(', '), (d.release_date ?? d.first_air_date)?.slice(0, 4)].filter(Boolean).join(' · '),
          data: { runtime, providers, region, rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null, onWatchlist: p.onWatchlist, overview: clip(d.overview, 180), tmdbId: p.id, mediaType: p.type },
        }),
      );
    }
    return out;
  },
};

/* ------------------------------------ TVMaze ------------------------------------ */

export interface FollowedShow {
  id: number;
  name: string;
}

interface TvMazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number;
  airstamp?: string;
  runtime?: number;
}
interface TvMazeShow {
  id: number;
  name: string;
  url?: string;
  image?: { medium?: string } | null;
  network?: { name: string } | null;
  webChannel?: { name: string } | null;
  _embedded?: { nextepisode?: TvMazeEpisode; previousepisode?: TvMazeEpisode };
}

export async function tvmazeSearch(fetcher: typeof fetch, query: string): Promise<FollowedShow[]> {
  const res = await fetchJson<{ show: TvMazeShow }[]>(fetcher, `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, { label: 'TVMaze' });
  return res.slice(0, 8).map((r) => ({ id: r.show.id, name: r.show.name }));
}

export const tvmaze: SourceConnector = {
  id: 'media_tvmaze',
  label: 'TVMaze (shows you follow)',
  category: 'media',
  description: 'New episodes of the shows you follow, airing today and this week.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 3 * 3_600_000,
  privacyNote: 'Only the shows you follow are looked up. No account needed.',
  isConfigured: (c) => ((c.config.followed as FollowedShow[] | undefined) ?? []).length > 0,
  async sync(ctx) {
    const followed = (ctx.config.followed as FollowedShow[] | undefined) ?? [];
    const out: ContextItem[] = [];
    const horizon = addDays(ctx.now, 8).getTime();
    const since = addDays(ctx.now, -2).getTime();
    for (const f of followed.slice(0, 25)) {
      const s = await fetchJson<TvMazeShow>(ctx.fetch, `https://api.tvmaze.com/shows/${f.id}?embed[]=nextepisode&embed[]=previousepisode`, { label: 'TVMaze' });
      for (const ep of [s._embedded?.previousepisode, s._embedded?.nextepisode]) {
        if (!ep?.airstamp) continue;
        const t = new Date(ep.airstamp).getTime();
        if (t < since || t > horizon) continue;
        out.push(
          item('media_tvmaze', ep.id, 'episode', `${s.name} · S${ep.season}E${ep.number}`, ctx.now.getTime(), {
            startsAt: ep.airstamp,
            endsAt: ep.runtime ? new Date(t + ep.runtime * 60_000).toISOString() : undefined,
            subtitle: ep.name,
            imageUrl: s.image?.medium,
            url: s.url,
            data: { show: s.name, runtime: ep.runtime, network: s.network?.name ?? s.webChannel?.name },
          }),
        );
      }
    }
    return out;
  },
};

/* ------------------------------------ YouTube ------------------------------------ */

interface YtSubs {
  items?: { snippet: { resourceId: { channelId: string }; title: string } }[];
}
interface YtChannels {
  items?: { id: string; contentDetails: { relatedPlaylists: { uploads: string } } }[];
}
interface YtPlaylistItems {
  items?: { snippet: { title: string; channelTitle: string; publishedAt: string; thumbnails?: { medium?: { url: string } } }; contentDetails: { videoId: string } }[];
}
interface YtVideos {
  items?: { id: string; contentDetails: { duration: string } }[];
}

export function isoDurationMinutes(d: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d);
  if (!m) return 0;
  return +(m[1] ?? 0) * 60 + +(m[2] ?? 0) + Math.round(+(m[3] ?? 0) / 60);
}

export const youtube: SourceConnector = {
  id: 'video_youtube',
  label: 'YouTube',
  category: 'media',
  description: 'Latest uploads from your subscriptions, with lengths — good when you only have a short window.',
  kind: 'network',
  auth: 'google',
  scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
  credentialFields: [GOOGLE_CLIENT_FIELD, GOOGLE_RELAY_FIELD],
  ttlMs: 3 * 3_600_000,
  privacyNote: 'Read-only. Your subscriptions are fetched from Google to this device.',
  isConfigured: (c) => !!c.accessToken,
  async sync(ctx) {
    const h = { headers: bearer(ctx.accessToken!), label: 'YouTube' };
    const base = 'https://www.googleapis.com/youtube/v3';
    const subs = await fetchJson<YtSubs>(ctx.fetch, `${base}/subscriptions?mine=true&part=snippet&maxResults=12&order=relevance`, h);
    const ids = (subs.items ?? []).map((s) => s.snippet.resourceId.channelId);
    if (!ids.length) return [];
    const ch = await fetchJson<YtChannels>(ctx.fetch, `${base}/channels?part=contentDetails&id=${ids.join(',')}`, h);
    const vids: { id: string; title: string; channel: string; publishedAt: string; thumb?: string }[] = [];
    for (const c of (ch.items ?? []).slice(0, 10)) {
      const pl = await fetchJson<YtPlaylistItems>(ctx.fetch, `${base}/playlistItems?part=snippet,contentDetails&maxResults=2&playlistId=${c.contentDetails.relatedPlaylists.uploads}`, h);
      for (const p of pl.items ?? []) vids.push({ id: p.contentDetails.videoId, title: p.snippet.title, channel: p.snippet.channelTitle, publishedAt: p.snippet.publishedAt, thumb: p.snippet.thumbnails?.medium?.url });
    }
    const recent = vids.filter((v) => new Date(v.publishedAt).getTime() > addDays(ctx.now, -10).getTime());
    if (!recent.length) return [];
    const durs = await fetchJson<YtVideos>(ctx.fetch, `${base}/videos?part=contentDetails&id=${recent.map((v) => v.id).join(',')}`, h);
    const dur = new Map((durs.items ?? []).map((v) => [v.id, isoDurationMinutes(v.contentDetails.duration)]));
    return recent.map((v) =>
      item('video_youtube', v.id, 'video', v.title, ctx.now.getTime(), { subtitle: v.channel, imageUrl: v.thumb, url: `https://www.youtube.com/watch?v=${v.id}`, data: { runtime: dur.get(v.id) ?? null, publishedAt: v.publishedAt } }),
    );
  },
};

/* ------------------------------------ Spotify ------------------------------------ */

interface SpRecent {
  items?: { played_at: string; track: { id: string; name: string; duration_ms: number; artists: { name: string }[]; album?: { images?: { url: string }[] }; external_urls?: { spotify?: string } } }[];
}

export const spotify: SourceConnector = {
  id: 'music_spotify',
  label: 'Spotify',
  category: 'listening',
  description: 'What you’ve been listening to — the soundtrack of your day, for reflection.',
  kind: 'network',
  auth: 'spotify',
  scopes: ['user-read-recently-played', 'user-read-currently-playing'],
  credentialFields: [{ key: 'clientId', label: 'Spotify app client ID', type: 'text', envVar: 'VITE_SPOTIFY_CLIENT_ID', help: 'Create an app at developer.spotify.com with this site as a redirect URI.' }],
  ttlMs: 30 * 60_000,
  privacyNote: 'Read-only listening history, fetched from Spotify to this device.',
  helpUrl: 'https://developer.spotify.com/dashboard',
  isConfigured: (c) => !!c.accessToken,
  async sync(ctx) {
    const res = await fetchJson<SpRecent>(ctx.fetch, 'https://api.spotify.com/v1/me/player/recently-played?limit=50', { headers: bearer(ctx.accessToken!), label: 'Spotify' });
    const out = (res.items ?? []).map((p) =>
      item('music_spotify', `${p.track.id}:${p.played_at}`, 'track', p.track.name, ctx.now.getTime(), {
        subtitle: p.track.artists.map((a) => a.name).join(', '),
        startsAt: p.played_at,
        imageUrl: p.track.album?.images?.at(-1)?.url,
        url: p.track.external_urls?.spotify,
        data: { artist: p.track.artists[0]?.name, durationMin: Math.round(p.track.duration_ms / 60000) },
      }),
    );
    const now = await fetchRaw(ctx.fetch, 'https://api.spotify.com/v1/me/player/currently-playing', { headers: bearer(ctx.accessToken!), label: 'Spotify' }).catch(() => null);
    if (now && now.status === 200) {
      const j = (await now.json().catch(() => null)) as { is_playing?: boolean; item?: { id: string; name: string; artists: { name: string }[] } } | null;
      if (j?.is_playing && j.item) out.unshift(item('music_spotify', `now:${j.item.id}`, 'track', j.item.name, ctx.now.getTime(), { subtitle: j.item.artists.map((a) => a.name).join(', '), startsAt: ctx.now.toISOString(), data: { nowPlaying: true, artist: j.item.artists[0]?.name } }));
    }
    return out;
  },
};

/* ------------------------------------ Last.fm ------------------------------------ */

interface LastfmRecent {
  recenttracks?: { track?: { name: string; url?: string; artist: { '#text': string }; date?: { uts: string }; '@attr'?: { nowplaying?: string }; image?: { '#text': string; size: string }[] }[] };
}

export const lastfm: SourceConnector = {
  id: 'music_lastfm',
  label: 'Last.fm',
  category: 'listening',
  description: 'Recent scrobbles from any player that reports to Last.fm.',
  kind: 'network',
  credentialFields: [
    { key: 'username', label: 'Last.fm username', type: 'text' },
    { key: 'apiKey', label: 'API key', type: 'secret', help: 'last.fm/api/account/create' },
  ],
  ttlMs: 30 * 60_000,
  privacyNote: 'Reads your public scrobbles. Your API key and username are sent only to Last.fm.',
  helpUrl: 'https://www.last.fm/api/account/create',
  isConfigured: (c) => !!c.credentials.username?.trim() && !!c.credentials.apiKey?.trim(),
  async sync(ctx) {
    const user = encodeURIComponent(requireField(ctx.credentials, 'username', 'Last.fm username'));
    const key = encodeURIComponent(requireField(ctx.credentials, 'apiKey', 'Last.fm API key'));
    const res = await fetchJson<LastfmRecent>(ctx.fetch, `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${user}&api_key=${key}&format=json&limit=50`, { label: 'Last.fm' });
    return (res.recenttracks?.track ?? []).map((t, i) => {
      const nowPlaying = t['@attr']?.nowplaying === 'true';
      const at = nowPlaying ? ctx.now.toISOString() : t.date ? new Date(+t.date.uts * 1000).toISOString() : undefined;
      return item('music_lastfm', `${t.date?.uts ?? 'now'}:${i}`, 'track', t.name, ctx.now.getTime(), {
        subtitle: t.artist['#text'],
        startsAt: at,
        url: t.url,
        imageUrl: t.image?.find((x) => x.size === 'medium')?.['#text'] || undefined,
        data: { artist: t.artist['#text'], nowPlaying },
      });
    });
  },
};

/* ---------------------------------- Open Library ---------------------------------- */

interface OlLog {
  reading_log_entries?: { work: { title: string; key: string; author_names?: string[]; cover_id?: number | null }; logged_date?: string }[];
}

export const openLibrary: SourceConnector = {
  id: 'books_openlibrary',
  label: 'Open Library',
  category: 'reading',
  description: 'Books you’re currently reading and want to read (public reading log).',
  kind: 'network',
  credentialFields: [{ key: 'username', label: 'Open Library username', type: 'text', help: 'Your reading log must be public (Settings → Privacy).' }],
  ttlMs: 12 * 3_600_000,
  privacyNote: 'Reads your public reading log. Only your username is sent.',
  helpUrl: 'https://openlibrary.org/account/privacy',
  isConfigured: (c) => !!c.credentials.username?.trim(),
  async sync(ctx) {
    const user = encodeURIComponent(requireField(ctx.credentials, 'username', 'Open Library username'));
    const out: ContextItem[] = [];
    for (const shelf of ['currently-reading', 'want-to-read'] as const) {
      const res = await fetchJson<OlLog>(ctx.fetch, `https://openlibrary.org/people/${user}/books/${shelf}.json`, { label: 'Open Library' });
      for (const e of (res.reading_log_entries ?? []).slice(0, shelf === 'currently-reading' ? 10 : 5)) {
        out.push(
          item('books_openlibrary', e.work.key, 'book', e.work.title, ctx.now.getTime(), {
            subtitle: e.work.author_names?.slice(0, 2).join(', '),
            imageUrl: e.work.cover_id ? `https://covers.openlibrary.org/b/id/${e.work.cover_id}-M.jpg` : undefined,
            url: `https://openlibrary.org${e.work.key}`,
            data: { shelf, author: e.work.author_names?.[0], loggedAt: e.logged_date },
          }),
        );
      }
    }
    return out;
  },
};

/* ---------------------------------- Google Books ---------------------------------- */

interface GBooks {
  items?: { id: string; volumeInfo: { title: string; authors?: string[]; pageCount?: number; description?: string; imageLinks?: { thumbnail?: string }; infoLink?: string } }[];
}

export const googleBooks: SourceConnector = {
  id: 'books_google',
  label: 'Google Books',
  category: 'reading',
  description: 'Adds page counts, covers and descriptions to the books in your reading log.',
  kind: 'network',
  credentialFields: [{ key: 'apiKey', label: 'API key (optional, raises the quota)', type: 'secret', optional: true }],
  ttlMs: 7 * 86_400_000,
  privacyNote: 'Only book titles and authors from your reading log are searched.',
  dependsOn: ['books_openlibrary'],
  isConfigured: () => true,
  async sync(ctx) {
    const books = ctx.peers.filter((p) => p.kind === 'book' && p.sourceId === 'books_openlibrary').slice(0, 8);
    const key = ctx.credentials.apiKey?.trim() ? `&key=${encodeURIComponent(ctx.credentials.apiKey.trim())}` : '';
    const out: ContextItem[] = [];
    for (const b of books) {
      const q = encodeURIComponent(`intitle:${b.title}${b.data?.author ? ` inauthor:${b.data.author}` : ''}`);
      const res = await fetchJson<GBooks>(ctx.fetch, `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1&printType=books${key}`, { label: 'Google Books' });
      const v = res.items?.[0];
      if (!v) continue;
      out.push(
        item('books_google', v.id, 'book', v.volumeInfo.title, ctx.now.getTime(), {
          subtitle: v.volumeInfo.authors?.join(', '),
          imageUrl: v.volumeInfo.imageLinks?.thumbnail?.replace('http://', 'https://'),
          url: v.volumeInfo.infoLink,
          data: { enriches: b.id, pageCount: v.volumeInfo.pageCount, description: clip(stripHtml(v.volumeInfo.description), 200) },
        }),
      );
    }
    return out;
  },
};

/* ------------------------------- Apple Podcasts (iTunes) ------------------------------- */

export interface FollowedPodcast {
  collectionId: number;
  name: string;
}

interface ItunesResults {
  results?: { wrapperType?: string; kind?: string; collectionId?: number; collectionName?: string; trackId?: number; trackName?: string; releaseDate?: string; trackTimeMillis?: number; trackViewUrl?: string; artworkUrl160?: string; artworkUrl100?: string; description?: string }[];
}

export async function itunesSearchPodcasts(fetcher: typeof fetch, query: string): Promise<FollowedPodcast[]> {
  const res = await fetchJson<ItunesResults>(fetcher, `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=8&term=${encodeURIComponent(query)}`, { label: 'Apple Podcasts' });
  return (res.results ?? []).filter((r) => r.collectionId).map((r) => ({ collectionId: r.collectionId!, name: r.collectionName ?? 'Podcast' }));
}

export const itunesPodcasts: SourceConnector = {
  id: 'podcasts_itunes',
  label: 'Podcasts (Apple directory)',
  category: 'listening',
  description: 'New episodes of podcasts you follow, with lengths — matched to commutes and free time.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 6 * 3_600_000,
  privacyNote: 'Only the podcasts you follow are looked up in the public Apple Podcasts directory. No account needed.',
  isConfigured: (c) => ((c.config.followed as FollowedPodcast[] | undefined) ?? []).length > 0,
  async sync(ctx) {
    const followed = (ctx.config.followed as FollowedPodcast[] | undefined) ?? [];
    const out: ContextItem[] = [];
    for (const f of followed.slice(0, 15)) {
      const res = await fetchJson<ItunesResults>(ctx.fetch, `https://itunes.apple.com/lookup?id=${f.collectionId}&entity=podcastEpisode&limit=3`, { label: 'Apple Podcasts' });
      for (const ep of (res.results ?? []).filter((r) => r.wrapperType === 'podcastEpisode' || r.kind === 'podcast-episode')) {
        if (!ep.releaseDate || new Date(ep.releaseDate).getTime() < addDays(ctx.now, -14).getTime()) continue;
        out.push(
          item('podcasts_itunes', ep.trackId ?? `${f.collectionId}:${ep.releaseDate}`, 'podcast_episode', ep.trackName ?? 'Episode', ctx.now.getTime(), {
            subtitle: ep.collectionName ?? f.name,
            startsAt: ep.releaseDate,
            url: ep.trackViewUrl,
            imageUrl: ep.artworkUrl160 ?? ep.artworkUrl100,
            data: { show: ep.collectionName ?? f.name, runtime: ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 60000) : null, description: clip(stripHtml(ep.description), 160) },
          }),
        );
      }
    }
    return out;
  },
};

/* ------------------------------------ Raindrop ------------------------------------ */

interface RaindropRes {
  items?: { _id: number; title: string; link: string; created: string; excerpt?: string; tags?: string[]; domain?: string }[];
}

export const raindrop: SourceConnector = {
  id: 'reading_raindrop',
  label: 'Raindrop.io',
  category: 'reading',
  description: 'Links you saved to read later.',
  kind: 'network',
  credentialFields: [{ key: 'token', label: 'Test token', type: 'secret', help: 'Raindrop → Settings → Integrations → For developers → Create new app → Create test token.' }],
  ttlMs: 2 * 3_600_000,
  privacyNote: 'Read-only. Your token is sent only to Raindrop.io.',
  helpUrl: 'https://app.raindrop.io/settings/integrations',
  isConfigured: (c) => !!c.credentials.token?.trim(),
  async sync(ctx) {
    const res = await fetchJson<RaindropRes>(ctx.fetch, 'https://api.raindrop.io/rest/v1/raindrops/0?perpage=30&sort=-created', { headers: bearer(requireField(ctx.credentials, 'token', 'Raindrop token')), label: 'Raindrop.io' });
    return (res.items ?? []).map((r) => item('reading_raindrop', r._id, 'link', r.title, ctx.now.getTime(), { url: r.link, subtitle: r.domain, startsAt: r.created, data: { excerpt: clip(r.excerpt, 160), tags: r.tags?.slice(0, 4), savedAt: r.created } }));
  },
};

/* ---------------------------------- Hacker News ---------------------------------- */

export const hackerNews: SourceConnector = {
  id: 'news_hn',
  label: 'Hacker News',
  category: 'reading',
  description: 'A few top stories, for long free windows. Off unless you turn it on.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 3 * 3_600_000,
  privacyNote: 'Public data; nothing about you is sent.',
  isConfigured: () => true,
  async sync(ctx) {
    const ids = await fetchJson<number[]>(ctx.fetch, 'https://hacker-news.firebaseio.com/v0/topstories.json', { label: 'Hacker News' });
    const out: ContextItem[] = [];
    for (const id of ids.slice(0, 8)) {
      const s = await fetchJson<{ id: number; title: string; url?: string; score?: number; descendants?: number; time?: number } | null>(ctx.fetch, `https://hacker-news.firebaseio.com/v0/item/${id}.json`, { label: 'Hacker News' });
      if (!s?.title) continue;
      out.push(item('news_hn', s.id, 'article', s.title, ctx.now.getTime(), { url: s.url ?? `https://news.ycombinator.com/item?id=${s.id}`, subtitle: `${s.score ?? 0} points · ${s.descendants ?? 0} comments`, data: { domain: s.url ? new URL(s.url).hostname.replace(/^www\./, '') : 'news.ycombinator.com' } }));
    }
    return out;
  },
};

/* ------------------------------------ Readwise ------------------------------------ */

interface ReadwiseReview {
  highlights?: { id: number; text: string; title?: string; author?: string; source_url?: string; highlight_url?: string }[];
}

export const readwise: SourceConnector = {
  id: 'highlights_readwise',
  label: 'Readwise',
  category: 'memories',
  description: 'Today’s Readwise review: passages you saved, resurfaced at reflective moments.',
  kind: 'network',
  credentialFields: [{ key: 'token', label: 'Access token', type: 'secret', help: 'readwise.io/access_token' }],
  ttlMs: 6 * 3_600_000,
  privacyNote: 'Read-only. Your token is sent only to Readwise.',
  helpUrl: 'https://readwise.io/access_token',
  isConfigured: (c) => !!c.credentials.token?.trim(),
  async sync(ctx) {
    const res = await fetchJson<ReadwiseReview>(ctx.fetch, 'https://readwise.io/api/v2/review/', { headers: { Authorization: `Token ${requireField(ctx.credentials, 'token', 'Readwise token')}` }, label: 'Readwise' });
    return (res.highlights ?? []).slice(0, 8).map((h) => item('highlights_readwise', h.id, 'highlight', h.title ?? 'Highlight', ctx.now.getTime(), { subtitle: h.author, url: h.highlight_url ?? h.source_url, data: { text: clip(h.text, 280), author: h.author } }));
  },
};

/* --------------------------------- Wikipedia: on this day --------------------------------- */

interface OnThisDay {
  selected?: { text: string; year: number; pages?: { content_urls?: { desktop?: { page?: string } } }[] }[];
}

export const onThisDay: SourceConnector = {
  id: 'context_onthisday',
  label: 'Wikipedia: On this day',
  category: 'memories',
  description: 'A notable event from this date in history — an optional angle for reflection.',
  kind: 'network',
  credentialFields: [],
  ttlMs: 12 * 3_600_000,
  privacyNote: 'Only today’s date and your language are sent.',
  isConfigured: () => true,
  async sync(ctx) {
    const lang = ['en', 'de', 'fr', 'es', 'it', 'sv', 'pt', 'ru', 'ar', 'zh'].includes(ctx.locale.language) ? ctx.locale.language : 'en';
    const mm = String(ctx.now.getMonth() + 1).padStart(2, '0');
    const dd = String(ctx.now.getDate()).padStart(2, '0');
    const res = await fetchJson<OnThisDay>(ctx.fetch, `https://${lang}.wikipedia.org/api/rest_v1/feed/onthisday/selected/${mm}/${dd}`, { label: 'Wikipedia', headers: { 'Api-User-Agent': 'JournalCompanion/1.0 (PWA)' } });
    return (res.selected ?? []).slice(0, 3).map((e, i) =>
      item('context_onthisday', `${isoDate(ctx.now)}:${i}`, 'onthisday', `${e.year}: ${clip(e.text, 140)}`, ctx.now.getTime(), { startsAt: isoDate(ctx.now), allDay: true, url: e.pages?.[0]?.content_urls?.desktop?.page, data: { year: e.year, text: e.text } }),
    );
  },
};

export function assertNever(x: never): never {
  throw new SourceError('config', `Unexpected ${String(x)}`);
}
