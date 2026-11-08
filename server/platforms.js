'use strict';
/**
 * Live-status adapters for YouTube, Twitch and Kick.
 *
 * Every adapter returns an array of "stream" objects with the same shape:
 *   {
 *     platform:   'youtube' | 'twitch' | 'kick',
 *     channelKey: string,          // stable id used by the frontend
 *     channelName:string,
 *     channelUrl: string,
 *     configured: boolean,         // false = no credentials / no manual data
 *     live:       boolean,
 *     title:      string | null,   // only ever the real title from the API (or manual file)
 *     thumbnail:  string | null,
 *     streamUrl:  string | null,   // where "Watch Live" should open
 *     embed:      { type, id } | null,
 *     viewers:    number | null,
 *     startedAt:  string | null,
 *     latest:     { title, thumbnail, url } | null,   // shown while offline
 *     source:     'api' | 'manual',
 *     error:      string | null
 *   }
 *
 * Nothing here invents data: if a value is not returned by the platform it is null.
 * Secrets are read from process.env only and never leave the server.
 */

const TIMEOUT_MS = 8000;

async function getJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    err.status = res.status;
    err.body = body.slice(0, 300);
    throw err;
  }
  return res.json();
}

function base(platform, channelKey, channelName, channelUrl) {
  return {
    platform,
    channelKey,
    channelName,
    channelUrl,
    configured: true,
    live: false,
    title: null,
    thumbnail: null,
    streamUrl: null,
    embed: null,
    viewers: null,
    startedAt: null,
    latest: null,
    source: 'api',
    error: null,
  };
}

/* ------------------------------------------------------------------ YouTube */

const ytChannelCache = new Map(); // handle -> { id, uploads, title }

async function resolveYouTubeChannel(handle, key) {
  if (ytChannelCache.has(handle)) return ytChannelCache.get(handle);
  const h = handle.startsWith('@') ? handle : `@${handle}`;
  const url =
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails' +
    `&forHandle=${encodeURIComponent(h)}&key=${encodeURIComponent(key)}`;
  const data = await getJson(url);
  const item = data.items && data.items[0];
  if (!item) throw new Error(`YouTube channel ${h} not found`);
  const info = {
    id: item.id,
    uploads: item.contentDetails.relatedPlaylists.uploads,
    title: item.snippet.title,
  };
  ytChannelCache.set(handle, info);
  return info;
}

/**
 * Uses ~3 quota units per check (channels is cached after first call), instead of the
 * 100 units search.list would cost. The uploads playlist lists live broadcasts as soon
 * as they are public, so we inspect the newest few items for liveBroadcastContent=live.
 */
async function checkYouTube(handle, key) {
  const clean = handle.replace(/^@/, '');
  const out = base('youtube', `youtube:${clean}`, clean, `https://www.youtube.com/@${clean}`);
  try {
    const ch = await resolveYouTubeChannel(handle, key);
    out.channelName = ch.title;
    const list = await getJson(
      'https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=6' +
        `&playlistId=${ch.uploads}&key=${encodeURIComponent(key)}`
    );
    const ids = (list.items || []).map((i) => i.contentDetails.videoId);
    if (!ids.length) return out;
    const vids = await getJson(
      'https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails' +
        `&id=${ids.join(',')}&key=${encodeURIComponent(key)}`
    );
    const items = vids.items || [];
    const thumb = (s) =>
      (s.thumbnails.maxres || s.thumbnails.standard || s.thumbnails.high || s.thumbnails.medium || {}).url || null;

    const live = items.find((v) => v.snippet.liveBroadcastContent === 'live');
    if (live) {
      out.live = true;
      out.title = live.snippet.title;
      out.thumbnail = thumb(live.snippet);
      out.streamUrl = `https://www.youtube.com/watch?v=${live.id}`;
      out.embed = { type: 'youtube', id: live.id };
      out.startedAt = (live.liveStreamingDetails || {}).actualStartTime || null;
      const cv = (live.liveStreamingDetails || {}).concurrentViewers;
      out.viewers = cv ? Number(cv) : null;
    } else {
      const latest = items.find((v) => v.snippet.liveBroadcastContent === 'none');
      if (latest) {
        out.latest = {
          title: latest.snippet.title,
          thumbnail: thumb(latest.snippet),
          url: `https://www.youtube.com/watch?v=${latest.id}`,
        };
      }
    }
  } catch (e) {
    out.error = describeError(e);
  }
  return out;
}

/* ------------------------------------------------------------------- Twitch */

let twitchToken = { value: null, expires: 0 };

async function twitchAuth(id, secret) {
  if (twitchToken.value && Date.now() < twitchToken.expires - 60000) return twitchToken.value;
  const data = await getJson('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
  });
  twitchToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return twitchToken.value;
}

async function checkTwitch(login, id, secret) {
  const out = base('twitch', `twitch:${login}`, login, `https://www.twitch.tv/${login}`);
  try {
    const token = await twitchAuth(id, secret);
    const headers = { 'Client-Id': id, Authorization: `Bearer ${token}` };
    const sized = (u, w, h) => (u ? u.replace('{width}', w).replace('{height}', h) : null);

    const streams = await getJson(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`,
      { headers }
    );
    const s = streams.data && streams.data[0];
    if (s && s.type === 'live') {
      out.channelName = s.user_name;
      out.live = true;
      out.title = s.title;
      out.thumbnail = sized(s.thumbnail_url, 1280, 720) + `?t=${Math.floor(Date.now() / 60000)}`;
      out.streamUrl = `https://www.twitch.tv/${s.user_login}`;
      out.embed = { type: 'twitch', id: s.user_login };
      out.viewers = s.viewer_count;
      out.startedAt = s.started_at;
    } else {
      const users = await getJson(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
        { headers }
      );
      const u = users.data && users.data[0];
      if (u) {
        out.channelName = u.display_name;
        const vids = await getJson(
          `https://api.twitch.tv/helix/videos?user_id=${u.id}&first=1&type=archive`,
          { headers }
        );
        const v = vids.data && vids.data[0];
        if (v) {
          out.latest = { title: v.title, thumbnail: sized(v.thumbnail_url, 640, 360), url: v.url };
        }
      }
    }
  } catch (e) {
    out.error = describeError(e);
  }
  return out;
}

/* --------------------------------------------------------------------- Kick */
// Official Kick public API: https://docs.kick.com  (OAuth 2.1 client-credentials app token)

let kickToken = { value: null, expires: 0 };

async function kickAuth(id, secret) {
  if (kickToken.value && Date.now() < kickToken.expires - 60000) return kickToken.value;
  const data = await getJson('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
  });
  kickToken = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return kickToken.value;
}

async function checkKick(slug, id, secret) {
  const out = base('kick', `kick:${slug}`, slug, `https://kick.com/${slug}`);
  try {
    const token = await kickAuth(id, secret);
    const data = await getJson(
      `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    const ch = data.data && data.data[0];
    if (!ch) throw new Error(`Kick channel ${slug} not found`);
    out.channelName = ch.slug || slug;
    const st = ch.stream || {};
    if (st.is_live) {
      out.live = true;
      out.title = ch.stream_title || null;
      out.thumbnail = st.thumbnail || null;
      out.streamUrl = `https://kick.com/${slug}`;
      out.embed = { type: 'kick', id: slug };
      out.viewers = typeof st.viewer_count === 'number' ? st.viewer_count : null;
      out.startedAt = st.start_time || null;
    }
  } catch (e) {
    out.error = describeError(e);
  }
  return out;
}

/* ------------------------------------------------------------------- Manual */

/**
 * Manual fallback (public/data/manual-streams.json). Used only for a platform whose API
 * credentials are missing. Whatever is written there is shown as-is and labelled
 * source:"manual" in the API response.
 */
function fromManual(platform, channelKey, channelName, channelUrl, manual) {
  const out = base(platform, channelKey, channelName, channelUrl);
  out.source = 'manual';
  if (!manual) {
    out.configured = false;
    return out;
  }
  out.live = manual.live === true;
  if (out.live) {
    out.title = manual.title || null;
    out.thumbnail = manual.thumbnail || null;
    out.streamUrl = manual.url || channelUrl;
    out.embed = manual.embedId ? { type: platform, id: manual.embedId } : null;
  } else if (manual.latest && manual.latest.url) {
    out.latest = {
      title: manual.latest.title || null,
      thumbnail: manual.latest.thumbnail || null,
      url: manual.latest.url,
    };
  }
  return out;
}

function describeError(e) {
  if (e.name === 'TimeoutError') return 'The platform API took too long to respond.';
  if (e.status === 401 || e.status === 403) return 'The platform rejected the API credentials.';
  if (e.status === 429) return 'The platform API rate limit was reached.';
  return 'Could not reach the platform API.';
}

module.exports = { checkYouTube, checkTwitch, checkKick, fromManual, base };
