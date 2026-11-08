# About Pritam – official website

Static front-end (`public/`) plus a tiny zero-dependency Node server (`server/`) that checks
whether Pritam is live on YouTube, Twitch and Kick. Needs Node 18+ only (no `npm install`).

## Run
    cp .env.example .env     # add credentials (optional – see below)
    npm start                # http://localhost:3000
    npm test                 # offline tests of the live-detection code (mocked APIs)

## Live detection
`GET /api/live` is polled by the page every ~45 s (server cache; hidden tabs pause). Secrets live only in `.env`
(server side) and are never sent to the browser.

| Platform | API used | Credentials (.env) |
|---|---|---|
| YouTube | YouTube Data API v3 (channels, playlistItems, videos) – ~3 quota units per check | `YOUTUBE_API_KEY`, `YOUTUBE_CHANNELS` |
| Twitch  | Helix `streams`, `users`, `videos` (app access token) | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_LOGIN` |
| Kick    | Official Kick public API `channels?slug=` (app access token) | `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, `KICK_SLUG` |

When live, the card shows the real title, thumbnail, viewer count (if provided), a Watch Live button for the
active stream URL and a click-to-load embedded preview. Several platforms live at once are all shown.
When offline: OFFLINE badge, plus the latest video where the API provides one (YouTube, Twitch).
API errors show "CHECK FAILED" – never a guessed state.

### Manual fallback
For any platform **without** credentials the server (or, on static hosting, the browser) reads
`public/data/manual-streams.json`. Set `"live": true` plus the real title / thumbnail / URL while streaming,
and back to `false` afterwards. Remember: manual status only changes when you edit the file.
A platform with no manual entry shows "STATUS UNAVAILABLE".

## Deploy
Any Node host (Render, Railway, Fly, a VPS): set the env vars, run `npm start`.
For static-only hosting upload `public/` – the page then uses the manual file.
Before launch set absolute URLs for `og:image` / `url` in `public/index.html` if you want rich link previews.

## Notes
* Fonts load from Google Fonts (Big Shoulders Display, Hanken Grotesk) with system fallbacks.
* Images from Pins.zip were converted to WebP. The pack had no YouTube/Kick icon, so those two were drawn
  in the same pixel style (`public/assets/icons/`). The Black Clover reference image is not used.
* Footballer photos are those supplied; no names, stats or achievements were added.
