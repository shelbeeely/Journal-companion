# Journal Companion: Cross-Platform PWA

The web edition of Journal Companion: the same calm desk companion for writing in a physical notebook as the Android app, installable on **iOS, iPadOS, Android, Windows, macOS, Linux and ChromeOS** from one codebase. It is built mobile-first and works fully offline.

## What powers it

| Layer | Technology |
| --- | --- |
| UI | React 18 + TypeScript, built with Vite. Plain CSS tokens ported from the Android palette (Warm Light, Soft Dark, Dim). Hash routing, so it runs on any static host. |
| Proactive desk | [A2UI](https://a2ui.org) v0.9 surfaces rendered by Google's `@a2ui/react` / `@a2ui/web_core`, fed by a local desk agent (see below) |
| Data | IndexedDB via `idb`, in place of Room and DataStore. Open windows stay in sync via BroadcastChannel. No server, no account. |
| AI | **OpenRouter** (optional, opt-in, your own account). Without it, the built-in prompt engine (a 1:1 port of the Kotlin `FallbackPromptEngine`) runs offline. |
| Weather | Open-Meteo. Only a city name or 2-decimal-rounded coordinates are sent. |
| Connected sources | 39 connectors (calendars, tasks, files, media, reading, memories, places, device) called directly from the browser. OAuth uses PKCE or Google Identity Services, with no backend. See *Context-aware companion*. |
| Offline & install | Workbox service worker + web manifest via `vite-plugin-pwa`. Updates apply only when you choose. |
| Device APIs | Screen Wake Lock, Geolocation (on demand), Vibration, Web Audio (timer chime), Fullscreen |

## Proactive desk (A2UI)

The app works out **what you're doing right now** and surfaces what's relevant without being asked. A local *desk agent* (`src/core/a2ui/deskAgent.ts`) turns that into A2UI messages (`createSurface` / `updateComponents` / `updateDataModel`). The messages use the same catalog id, component names and `/desk/...` data paths as the Android `DeskA2uiAgentEngine`, so a payload from either platform renders on both.

| Task | Detected from | Surfaces automatically |
| --- | --- | --- |
| Arriving | Today open, page not started | Streak and cadence, your usual writing window, starter and recall cue, neglected theme, weather/rain/daylight, a page left open yesterday |
| Thinking | No typing for 45 s | A 10-minute sprint, the starter, a fresh angle, an untouched theme |
| Writing | Typing in the note, or a focus sprint running | Live words vs. page estimate, minutes of pen left, sprint time left (kept deliberately calm) |
| Break | Break timer running | Time left, sun left before sunset, sprints done today |
| Wrapping up | ≥80% of the page estimate, or a sprint just ended | Mark done, tighten-draft offer, progress |
| Done | Today marked complete | Streak, milestones, next session, backup reminder, patterns |
| Setting up | Project wizard/editor | A live preview of what the brief implies (cadence, page size, themes, word estimate, a sample first question) and where the brief goes |
| Reviewing | History | Completion rate, longest streak, strongest weekday, themes explored |
| Organizing | Projects | Per-notebook progress and last activity |
| Configuring | Settings | AI, backup, storage persistence and weather freshness at a glance |
| Ambient | Screen saver | Today's question, starter, daylight and weather, in a non-interactive surface |

- **Where it appears:** inside Today (a "Desk" tab plus a glance strip on phones, the side column on wider screens) and at the top of Projects, History, the editor and Settings.
- **Rich / Calm:** set in *Settings → Desk Mode & Privacy*. Any nudge can be hidden for the day.
- **Discreet mode:** hides the brief, the audience, prompts and notes from every surface.
- **Where the logic lives:** task detection (`src/core/taskContext.ts`) and insights (`src/core/insights.ts`) run on the device. AI, when on, only rewrites the wording of the desk cues.
- **Loading:** the A2UI renderer loads as a separate chunk, so first paint on phones doesn't wait for it.

## Context-aware companion

The **Right now** row on Today shows up to three cards built for the moment you're in. Each card joins your connected sources, the time and date, and your journal. Navigation is unchanged (Today / Projects / History / Settings), and drafts are never touched: "Reflect on this" appends to your draft, and you can undo it.

| Moment | When it appears | What it combines |
| --- | --- | --- |
| Plan your day | the first hours after your wake time | events, due tasks, the forecast, holidays, Habitica dailies |
| Heading out | an event with a place in the next 3 h, or you tap *Heading out* | the event, a "leave by" time (Nominatim + OSRM), hourly weather and air quality at the start time, transit departures, related tasks, a past page that mentions the same person or place, a podcast that fits the trip, nearby wildlife sightings |
| What to watch | an evening free window before your bedtime, or you ask | your watchlist first, then trending titles that fit the window, where to stream them (TMDB), YouTube picks, podcasts |
| Episode tonight | a show you follow airs today (TVMaze) | air time, the free window, where to watch |
| Resume a project | a journal project idle for 3+ days with a draft, a GitHub repo or Trello board you've been active in, recently edited Drive / OneDrive / Dropbox files | the last excerpt, the next task, matching files |
| Resume reading | a book you're currently reading (Open Library) | the book, Google Books details, a Readwise highlight |
| Reflect on the day | after your last event, or in the late evening | a timeline of events, completed tasks, weather, music, photos and links you shared, with a writing prompt grounded in that day |
| Unfinished thought | a draft that trails off, an open note in your notes folder, a saved link | the excerpt, where it came from, how old it is |
| On this day | morning or reflection time | your own pages, Day One, photos, Readwise, Wikipedia |

**Time and date are context too:**
- Day parts follow *your* wake time and bedtime.
- Weekdays and weekends follow your workdays.
- Also considered: holidays and their eves, the start and end of the week, month and year, the season (by hemisphere), moon phase, clock changes, travel (when your time zone differs from home), and anniversaries.

You set these under *Settings → Day & rhythm*.

**Control:**
- Every card can be **simplified**, **snoozed** (for an hour, until tonight, tomorrow morning or the weekend), **dismissed** or **saved**. Saved cards appear read-only under *History → Saved*.
- Dismissing a card down-weights that kind of card for 7 days.
- Under *Settings → Suggestions* you can switch off whole moment types and set a daily limit.
- While you type, the row freezes: nothing appears, disappears or moves. An explicit ask always gets through.
- Notifications are in-app only. Nothing is pushed to the system.

**Explainable and honest:**
- Every card has *Why am I seeing this?*. It lists each fact with its source and how fresh it is, marked either "from your data" or "from your clock & calendar".
- Optional AI text is a separate block labelled **AI interpretation**.
- If a source is disconnected, out of date or signed out, the card stays and says what's missing, with a *Connect* button. Cards never just vanish.

**Privacy:**
- Everything is stored in this browser.
- Each source has *Use for suggestions*, and *Allow AI to read*, which is **off by default**. The AI only sees evidence from sources you allowed, and never sees card titles. Its reply must cite that evidence, or it is thrown away.
- Backups exclude credentials, tokens and cached source data.
- *Settings → Connections → What the companion knows* shows item counts per source and can clear them.

### Connections

*Settings → Connections* lists 39 connectors by category. Each card shows a status (connected / syncing / out of date / needs sign-in / error), its last sync, a privacy note and its limitations.

Sources sync when they're due (per-source TTL), when you come back to the app, and when you go online. Failures back off exponentially and keep the last data.

| Category | Connector | Credential |
| --- | --- | --- |
| Calendars | Google Calendar | Google sign-in |
| | Outlook / Microsoft 365 | Microsoft sign-in |
| | Apple iCloud (public link) | none |
| | Any `.ics` file or URL | none |
| | Public holidays (Nager.Date) | none |
| Tasks & projects | Google Tasks | Google sign-in |
| | Microsoft To Do | Microsoft sign-in |
| | Todoist (API v1) | personal API token |
| | Trello | API key + token |
| | GitHub (assigned issues, recent repos) | fine-grained token |
| Files | Google Drive (metadata only) | Google sign-in |
| | OneDrive | Microsoft sign-in |
| | Dropbox | Dropbox sign-in |
| Habits | Habitica | user ID + API token |
| Movies, TV & video | TMDB | read access token |
| | TVMaze | none |
| | YouTube subscriptions | Google sign-in |
| Music & podcasts | Spotify recently played | Spotify sign-in |
| | Last.fm | API key + username |
| | Apple Podcasts directory | none |
| Reading | Open Library | public username |
| | Google Books | none |
| | Raindrop.io | test token |
| | Hacker News | none |
| Memories & notes | Journal (built in) | none |
| | Markdown / Obsidian notes folder | local permission |
| | Day One JSON import | file |
| | Readwise daily review | access token |
| | Wikipedia On this day | none |
| Weather & places | Open-Meteo forecast + air quality | none |
| | Nominatim geocoding | none |
| | OSRM travel time | none |
| | Transitland departures | API key |
| | iNaturalist sightings | none |
| | USGS earthquakes | none |
| | TheMealDB | none |
| On this device | Share target (share links, text and photos into the app) | none |
| | Device photos (EXIF date and place) | none |
| | Open `.ics` / `.md` / `.json` files with the app | none |

### Credentials

API keys and tokens are pasted into the connector's card and stored only in this browser. OAuth client IDs are public identifiers: there is no client secret, because the flows use PKCE or Google's token model. Put them in `web/.env.local` (see `web/.env.example`) or in the Actions variables used by the deploy workflow, or paste them in the app.

For every OAuth provider, register the deployed URL **exactly as served, including the path and trailing slash** (for example `https://you.github.io/journal-companion/`), plus `http://localhost:5173/` for development. Sign-in only completes on a registered origin.

| Provider | Setup |
| --- | --- |
| **Google** | In Google Cloud: create a project. Enable the Calendar, Tasks, Drive and YouTube Data APIs (only the ones you'll use). Configure the OAuth consent screen and add yourself as a test user. Create an OAuth client of type *Web application* and add your URLs under *Authorized JavaScript origins*. Set `VITE_GOOGLE_CLIENT_ID`. Optionally deploy the [token relay](../relay/README.md) and set `VITE_GOOGLE_RELAY_URL` (or paste it in the card) for long-lived sign-in. Scopes are read-only (`calendar.readonly`, `tasks.readonly`, `drive.metadata.readonly`, `youtube.readonly`) and requested only for connectors you turn on. |
| **Microsoft** | In Microsoft Entra ID: *App registrations → New*, supporting personal and work accounts. Add a platform of type **Single-page application** with your URLs as redirect URIs. Add delegated `Calendars.Read`, `Tasks.Read`, `Files.Read` and `offline_access`. Set `VITE_MS_CLIENT_ID`. |
| **Spotify** | Create an app in the Spotify Developer Dashboard (Web API) with your URLs as redirect URIs. Set `VITE_SPOTIFY_CLIENT_ID`. Apps in development mode only work for users you add to the app. |
| **Dropbox** | In the App Console: create an app with *Scoped access*. Enable `files.metadata.read` and add your URLs as redirect URIs. Set `VITE_DROPBOX_APP_KEY`. |
| **TMDB** | Free account → *Settings → API* → **API Read Access Token**. |
| **Todoist** | *Settings → Integrations → Developer* → API token. |
| **Trello** | Create a Power-Up at `trello.com/power-ups/admin` to get an API key, then generate a token with the link on that page. |
| **GitHub** | Fine-grained personal access token: read-only *Issues*, *Pull requests* and *Metadata*, for the repositories you want. |
| **Last.fm** | API key from `last.fm/api/account/create`, plus your username. |
| **Readwise** | Token from `readwise.io/access_token`. |
| **Raindrop.io** | *Settings → Integrations → Create new app* → test token. |
| **Habitica** | *Settings → Site Data*: user ID and API token. |
| **Transitland** | Free API key from the Interline / Transitland portal. |
| **Apple Calendar** | In Calendar, open a calendar's sharing options, turn on *Public Calendar*, and copy the `webcal://` link. |
| **Open Library** | Make your reading log public, then enter your username. |

### Limitations

- **Google sign-in is OAuth, but browser-only apps get 1-hour tokens.** Google issues refresh tokens only through the authorization-code flow, and exchanging the code for a *Web application* client requires the client secret, which a static app can't keep. (Microsoft, Spotify and Dropbox allow PKCE refresh tokens in the browser, so they renew silently.)
  - *Without a relay:* the app renews the token quietly (no account chooser or consent screen) the next time you tap *Sync now*, a quick ask, or a card's *Connect* row. Background syncs never open popups, so after an hour away Google data waits for your next tap. On phones, renewal briefly opens and closes a tab.
  - *With the optional relay* (`relay/`, a ~100-line Cloudflare Worker that holds the secret and stores nothing): sign-in renews in the background (refresh tokens last 7 days while your Google OAuth app is in *Testing* status; publish it for long-lived sign-in). See [`relay/README.md`](../relay/README.md).
- **Apple:** private iCloud calendars and Apple Reminders have no web API. Use a public calendar link or import an `.ics` export.
- **Some `.ics` URLs** block browser requests (CORS). The app says so and offers file import instead.
- **Public services:** Nominatim and OSRM are rate-limited public services. The app caches lookups, throttles to 1 request per second, and only sends the event's location text and rounded coordinates. Heavy use should point to self-hosted instances. OSRM travel times are for driving; walking time is estimated from distance.
- **Share target:** works on Android and desktop Chromium. iOS doesn't support web share targets. The notes-folder picker needs Chromium; other browsers import files instead.
- **Not supported, with the reason shown in Connections:** Apple Health, the Google Photos library, Strava, Oura, Fitbit, Toggl, WakaTime, Notion, Gmail, Trakt, Goodreads, Pocket Casts, Ticketmaster and eBird. In each case the API doesn't accept browser requests, requires a client secret, or has no public web API.
- **Suggestions only update while the app is open.** There are no system notifications, by design.

### Architecture

```
connectors (src/core/sources/connectors/*) ─ SourceSync (TTL, backoff, dependency order) ─► IndexedDB `context`
                                                                                              │
journal snapshot ── temporal context (src/core/context/temporal.ts) ──┐                       │
                                                                       ▼                       ▼
                         detectMoments (moments.ts: joins sources → Suggestion with evidence + missing sources)
                                       │                     │ optional: interpretSuggestion (OpenRouter, allowed sources only)
                                       ▼                     ▼
                       rankSuggestions (timeliness × priority × feedback, quiet while writing)
                                       │
                                       ▼
            MomentAgent → A2UI v0.9 messages → controlled catalog (src/a2ui/momentComponents.tsx)
```

- Connectors are plain objects (`id`, category, credential fields, privacy note, `isConfigured`, `sync(ctx)`). The Connections UI is generated from them.
- The A2UI catalog is closed. Generated layouts can only order the known sections, and anything else falls back to the deterministic layout.
- IndexedDB moved to v2, which adds `context`, `savedViews` and `feedback`. v1 data is untouched.

## AI with OpenRouter (optional)

AI-written prompts, hints, draft help and desk cues come from a model you choose on [OpenRouter](https://openrouter.ai), billed to your own OpenRouter account. AI is **off until you turn it on**.

1. Go to *Settings → AI (OpenRouter)* and choose **Connect OpenRouter** (OAuth with PKCE), or paste your own key.
2. Review the **What gets sent** sheet and choose **Turn on AI**.
3. Optionally pick a model; the default is `anthropic/claude-haiku-5.5`. Use **Test** to check it works.

**What leaves the device when AI is on**, and only when the app asks the model for something:
- today's question and recent prompts (so new ones don't repeat);
- the project's goal, themes, tone and boundaries;
- your brief, only when you tap *Propose* in the wizard;
- your digital note, only when you tap *Help me start* or *Tighten*;
- audience and past notes, only if enabled for the project and never in Discreet mode;
- time and weather, only if you turned them on for prompts.

**Protections:**
- Requests ask OpenRouter to route only to providers that don't store or train on data (`provider.data_collection: "deny"`).
- No name, email or device identifier is sent.
- The key is stored only in this browser and is **never included in backups**.
- If you're offline, out of credits, or the model returns something invalid, the built-in engine takes over silently. Every model reply is schema-validated first.

## Mobile

- **Today:** a glance strip under the title; a sticky Hint / Another / Done bar above the bottom nav; desk cards as tabs instead of one long scroll; extra options in a "More" bottom sheet.
- **Touch and keyboard:** touch targets are at least 44 px; inputs are 16 px so iOS doesn't zoom in; the bottom bars step aside when the on-screen keyboard opens.
- **Dialogs** are bottom sheets.
- **Landscape phone on a desk:** two columns with a slim side rail.
- **Loading:** screens other than Today load on demand (and are still precached for offline). Fonts are Latin-subset WOFF2, 32 KB in total.

## Develop

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: core, insights, task detection, A2UI agents + renderer, OpenRouter client,
                   #         connectors (API-shaped fixtures), ICS, sync, moments, time context, AI grounding
npm run test:live  # optional: real APIs (Open-Meteo, TVMaze, Nominatim/OSRM, …); TMDB needs TMDB_TOKEN
npm run build      # production build + service worker in dist/
npm run preview    # serve dist/ to test install & offline
```

- `npm run icons` regenerates the PWA icons from the Android launcher artwork (needs ImageMagick).
- `scripts/make-fonts.sh` rebuilds the WOFF2 fonts (needs `pip install fonttools brotli`).

## Deploy

The build is fully static, so `dist/` works on any HTTPS host or sub-path.

- `.github/workflows/deploy-pwa.yml` tests, builds and publishes to **GitHub Pages** on every push to `main` that touches `web/`. Enable it once under *Settings → Pages → Source: GitHub Actions*.
- *Connect OpenRouter* redirects back to the URL the app is served from, so it works on the deployed origin (and on `localhost`).

## Install

- **Android / ChromeOS / Windows / macOS / Linux (Chrome, Edge):** the *Install app* card in Settings, or the install icon in the address bar.
- **iPhone / iPad:** Safari → Share → *Add to Home Screen*.
- **Mac Safari:** File → *Add to Dock*.

## Backup

Your journal lives in this browser's storage. Use *Settings → Backup* to export a JSON file and import it on another device. The desk reminds you if you have 5+ pages and no backup in 30 days.
