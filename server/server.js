'use strict';
/**
 * About Pritam – web server.
 *  - Serves the static site from /public
 *  - GET /api/live  → live status for YouTube, Twitch and Kick (cached, secrets stay here)
 *  - GET /api/health
 *
 * Zero runtime dependencies: Node 18+ only.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./env');
const P = require('./platforms');

loadEnv(path.join(__dirname, '..', '.env'));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MANUAL_FILE = path.join(PUBLIC_DIR, 'data', 'manual-streams.json');

const config = {
  port: Number(process.env.PORT) || 3000,
  ttl: Math.max(15, Number(process.env.CACHE_TTL_SECONDS) || 45) * 1000,
  youtubeKey: process.env.YOUTUBE_API_KEY || '',
  youtubeHandles: (process.env.YOUTUBE_CHANNELS || '@pritamisliveff,@proton_live')
    .split(',').map((s) => s.trim()).filter(Boolean),
  twitchId: process.env.TWITCH_CLIENT_ID || '',
  twitchSecret: process.env.TWITCH_CLIENT_SECRET || '',
  twitchLogin: process.env.TWITCH_LOGIN || 'pritamislive07',
  kickId: process.env.KICK_CLIENT_ID || '',
  kickSecret: process.env.KICK_CLIENT_SECRET || '',
  kickSlug: process.env.KICK_SLUG || 'pritamislive07',
};

function readManual() {
  try {
    return JSON.parse(fs.readFileSync(MANUAL_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------ live status */

const MAX_STALE_MS = 3 * 60 * 1000;
const cache = { at: 0, payload: null, inflight: null };

async function collect() {
  const manual = readManual();
  const jobs = [];

  if (config.youtubeKey) {
    for (const h of config.youtubeHandles) jobs.push(P.checkYouTube(h, config.youtubeKey));
  } else {
    config.youtubeHandles.forEach((h, i) => {
      const name = h.replace(/^@/, '');
      // The manual file has one "youtube" entry (applied to the first channel) and may
      // have "youtube2" for the second one.
      const m = manual[i === 0 ? 'youtube' : `youtube${i + 1}`];
      jobs.push(Promise.resolve(P.fromManual('youtube', `youtube:${name}`, name, `https://www.youtube.com/@${name}`, m)));
    });
  }

  jobs.push(
    config.twitchId && config.twitchSecret
      ? P.checkTwitch(config.twitchLogin, config.twitchId, config.twitchSecret)
      : Promise.resolve(P.fromManual('twitch', `twitch:${config.twitchLogin}`, config.twitchLogin, `https://www.twitch.tv/${config.twitchLogin}`, manual.twitch))
  );
  jobs.push(
    config.kickId && config.kickSecret
      ? P.checkKick(config.kickSlug, config.kickId, config.kickSecret)
      : Promise.resolve(P.fromManual('kick', `kick:${config.kickSlug}`, config.kickSlug, `https://kick.com/${config.kickSlug}`, manual.kick))
  );

  const streams = await Promise.all(jobs);
  return { updatedAt: new Date().toISOString(), ttl: Math.round(config.ttl / 1000), streams };
}

async function getLive() {
  const now = Date.now();
  if (cache.payload && now - cache.at < config.ttl) return cache.payload;
  if (!cache.inflight) {
    cache.inflight = collect()
      .then((fresh) => {
        // If a platform errored but we had a recent good answer, reuse it (flagged stale).
        if (cache.payload && now - cache.at < MAX_STALE_MS) {
          fresh.streams = fresh.streams.map((s) => {
            if (!s.error) return s;
            const prev = cache.payload.streams.find((p) => p.channelKey === s.channelKey && !p.error);
            return prev ? { ...prev, stale: true } : s;
          });
        }
        cache.payload = fresh;
        cache.at = Date.now();
        return fresh;
      })
      .finally(() => { cache.inflight = null; });
  }
  return cache.inflight;
}

/* ----------------------------------------------------------------- static */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.twitch.tv https://player.kick.com',
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
};

function sendJson(res, code, body, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY, ...extra });
  res.end(data);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    const immutable = /\/assets\//.test(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' || file.includes(`${path.sep}data${path.sep}`) ? 'no-cache' : immutable ? 'public, max-age=2592000' : 'public, max-age=3600',
      ...SECURITY,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  if (pathname === '/api/live') {
    try {
      const payload = await getLive();
      return sendJson(res, 200, payload, { 'Cache-Control': `public, max-age=${Math.floor(config.ttl / 2000)}` });
    } catch (e) {
      console.error('live check failed:', e);
      return sendJson(res, 502, { error: 'Live status is temporarily unavailable.' });
    }
  }
  if (pathname === '/api/health') return sendJson(res, 200, { ok: true });
  try {
    serveStatic(req, res, pathname);
  } catch {
    res.writeHead(400); res.end('Bad request');
  }
});

if (require.main === module) {
  server.listen(config.port, () => {
    const on = (v) => (v ? 'API' : 'manual file');
    console.log(`About Pritam running on http://localhost:${config.port}`);
    console.log(`  YouTube: ${on(config.youtubeKey)} | Twitch: ${on(config.twitchId && config.twitchSecret)} | Kick: ${on(config.kickId && config.kickSecret)}`);
  });
}

module.exports = { server, getLive, config };
