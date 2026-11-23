# Journal Companion — Cross-Platform PWA

The web edition of Journal Companion: the same calm, local-first desk companion as the Android app, installable on **iOS, iPadOS, Android, Windows, macOS, Linux and ChromeOS** from one codebase.

## What carries over from the Android app

| Android | PWA |
| --- | --- |
| Room + DataStore | IndexedDB (`journal_companion_local`), synced live across open windows |
| ML Kit GenAI / AICore (Gemini Nano) | Browser built-in Prompt API (on-device) where offered; otherwise the same built-in template engine (`FallbackPromptEngine` ported 1:1) |
| Structured output validation | `src/core/validator.ts` (same rules, discreet-title redaction, duplicate rejection) |
| Open-Meteo weather + coarse location | Same API, same 2-decimal rounding, same 2-hour stale labelling, on-demand Geolocation |
| Keep screen awake | Screen Wake Lock API (re-acquired when you return to the tab) |
| A2UI Desk Companion card | Desk Companion card built from the same snapshot logic, optionally enriched by on-device AI cues |
| Dream service (screen saver) | Ambient screen saver: drifting clock, weather and today's question, fullscreen + wake lock, optional idle auto-start |
| Recents preview protection | Privacy veil that blanks the UI when the app is hidden or loses focus |
| Excluded from cloud backup | Data never leaves the browser; manual JSON **Export / Import** for backup and device transfer |

Nothing about your journal is sent anywhere. The only network calls are Open-Meteo (city name or rounded coordinates, when you ask for weather).

## Develop

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # core acceptance tests (Vitest + fake IndexedDB)
npm run build      # production build + service worker in dist/
npm run preview    # serve dist/ to test install & offline
```

`npm run icons` regenerates the PWA icons from the Android launcher artwork (needs ImageMagick).

## Deploy

The build is fully static and uses a relative base and hash routing, so `dist/` works on any HTTPS host or sub-path (GitHub Pages, Netlify, Cloudflare Pages, S3…).

`.github/workflows/deploy-pwa.yml` tests, builds and publishes to **GitHub Pages** on every push to `main` that touches `web/`. Enable it once under *Settings → Pages → Build and deployment → Source: GitHub Actions*.

## Install

- **Android / ChromeOS / Windows / macOS / Linux (Chrome, Edge):** the *Install app* button in Settings, or the install icon in the address bar.
- **iPhone / iPad:** Safari → Share → *Add to Home Screen*.
- **Mac Safari:** File → *Add to Dock*.

## On-device AI

Where the browser exposes the built-in Prompt API (currently Chrome / Edge on capable desktops), Settings → *On-Device AI* shows its status and can trigger the one-time model download. Everywhere else the built-in prompt engine runs automatically and fully offline, with no loss of core features.
