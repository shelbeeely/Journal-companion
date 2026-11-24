# Journal Companion token relay (optional)

Without a server, Google's browser sign-in issues **1-hour access tokens and no refresh token**. The app renews them quietly the next time you tap *Sync now*, a *Connect* button or a quick ask. If you want Google to stay connected for weeks, the way Microsoft, Spotify and Dropbox do, deploy this relay.

Exchanging Google's authorization code requires your OAuth client **secret**, and a static web app can't keep a secret. This Worker holds it and does exactly three things for your app's origins:

| Endpoint | Does |
| --- | --- |
| `POST /google/token {code}` | Exchanges a sign-in code for an access token and a refresh token |
| `POST /google/refresh {refresh_token}` | Gets a fresh access token |
| `POST /google/revoke {token}` | Revokes the sign-in when you disconnect |

It **stores nothing and logs nothing**. Tokens are returned to your browser and kept there. Requests from origins outside `ALLOWED_ORIGINS` are refused, and responses never contain the secret.

## Deploy (Cloudflare Workers, free tier)

1. In Google Cloud, open your existing **Web application** OAuth client (the same one the app uses).
   - Copy its **client secret**.
   - Make sure your PWA's URL is listed under *Authorized JavaScript origins*.
   - No redirect URI is needed, because the app uses Google's popup code flow (`postmessage`).
2. Edit `wrangler.toml`:
   - set `GOOGLE_CLIENT_ID`;
   - list your PWA origins in `ALLOWED_ORIGINS`, for example `https://you.github.io,http://localhost:5173`. Use the origin only, with no path.
3. Run:
   ```bash
   cd relay
   npx wrangler login
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler deploy
   ```
4. Give the app the Worker URL (for example `https://journal-companion-relay.you.workers.dev`), either:
   - in the app: *Settings → Connections → Google Calendar → Token relay URL*, or
   - at build time: `VITE_GOOGLE_RELAY_URL`, set as an Actions variable for the deploy workflow.
5. Press *Reconnect* on a Google source. Google asks for consent once, and after that sign-in renews in the background.

> **Testing vs. production:** while your Google OAuth consent screen is in *Testing* status, Google expires refresh tokens after **7 days**, so you'll reconnect weekly. Publish the app (*Google Auth Platform → Audience → Publish app*) for long-lived refresh tokens. Read-only Calendar, Tasks, Drive-metadata and YouTube scopes are "sensitive" scopes; for personal use you can stay unverified and accept the "unverified app" warning once.

The Worker only uses the standard Fetch API, so it also runs on Deno Deploy, Vercel Edge or Netlify Edge with a small entry-point change.
