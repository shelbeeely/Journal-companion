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
npm test           # Vitest: core, insights, task detection, A2UI agent + renderer, OpenRouter client
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
