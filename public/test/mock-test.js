'use strict';
/**
 * Offline tests for the live-status adapters. The global fetch is replaced by a stub that
 * mimics the documented YouTube / Twitch / Kick responses, so no credentials are needed.
 * Run:  npm test
 */
const assert = require('assert');

process.env.YOUTUBE_API_KEY = 'test-yt';
process.env.YOUTUBE_CHANNELS = '@pritamisliveff,@proton_live';
process.env.TWITCH_CLIENT_ID = 'tid';
process.env.TWITCH_CLIENT_SECRET = 'tsecret';
process.env.KICK_CLIENT_ID = 'kid';
process.env.KICK_CLIENT_SECRET = 'ksecret';
process.env.CACHE_TTL_SECONDS = '15';

const state = { ytLive: true, twitchLive: true, kickLive: true, ytFail: false };
const calls = [];

const json = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  calls.push(u.host + u.pathname);
  if (u.host === 'www.googleapis.com') {
    if (state.ytFail) return json({ error: 'quota' }, 403);
    if (u.pathname.endsWith('/channels')) {
      const h = u.searchParams.get('forHandle');
      return json({ items: [{ id: 'UC' + h, snippet: { title: h === '@proton_live' ? 'Proton Live' : 'Pritam Is Live FF' }, contentDetails: { relatedPlaylists: { uploads: 'UU' + h } } }] });
    }
    if (u.pathname.endsWith('/playlistItems')) {
      const h = u.searchParams.get('playlistId');
      return json({ items: [{ contentDetails: { videoId: h.includes('proton') ? 'vidP' : 'vidA' } }, { contentDetails: { videoId: 'old1' } }] });
    }
    if (u.pathname.endsWith('/videos')) {
      const ids = u.searchParams.get('id').split(',');
      const mk = (id, live) => ({ id, snippet: { title: live ? 'Real live title ' + id : 'Old upload', liveBroadcastContent: live ? 'live' : 'none', thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hq.jpg` } } }, liveStreamingDetails: live ? { actualStartTime: '2026-11-08T10:00:00Z', concurrentViewers: '42' } : undefined });
      return json({ items: ids.map((id) => mk(id, state.ytLive && id === 'vidA')) });
    }
  }
  if (u.host === 'id.twitch.tv') return json({ access_token: 'tok', expires_in: 3600 });
  if (u.host === 'api.twitch.tv') {
    assert.strictEqual(opts.headers['Client-Id'], 'tid');
    if (u.pathname.endsWith('/streams')) {
      return json({ data: state.twitchLive ? [{ type: 'live', user_login: 'pritamislive07', user_name: 'PritamIsLive07', title: 'Twitch real title', thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_x-{width}x{height}.jpg', viewer_count: 7, started_at: '2026-11-08T09:00:00Z' }] : [] });
    }
    if (u.pathname.endsWith('/users')) return json({ data: [{ id: '99', display_name: 'PritamIsLive07' }] });
    if (u.pathname.endsWith('/videos')) return json({ data: [{ title: 'Last VOD', url: 'https://twitch.tv/videos/1', thumbnail_url: 'https://x/{width}x{height}.jpg' }] });
  }
  if (u.host === 'id.kick.com') return json({ access_token: 'ktok', expires_in: 3600 });
  if (u.host === 'api.kick.com') {
    assert.strictEqual(opts.headers.Authorization, 'Bearer ktok');
    return json({ data: [{ slug: 'pritamislive07', stream_title: 'Kick real title', stream: { is_live: state.kickLive, thumbnail: 'https://images.kick.com/t.jpg', viewer_count: 3, start_time: '2026-11-08T08:00:00Z' } }] });
  }
  throw new Error('Unexpected fetch ' + url);
};

const P = require('../server/platforms');

(async () => {
  // 1. everything live
  let yt1 = await P.checkYouTube('@pritamisliveff', 'k');
  let yt2 = await P.checkYouTube('@proton_live', 'k');
  let tw = await P.checkTwitch('pritamislive07', 'tid', 'tsecret');
  let ki = await P.checkKick('pritamislive07', 'kid', 'ksecret');
  assert.ok(yt1.live && yt1.title === 'Real live title vidA' && yt1.streamUrl.endsWith('vidA') && yt1.thumbnail.includes('vidA'));
  assert.ok(!yt2.live && yt2.latest && yt2.latest.title === 'Old upload' || yt2.live === false);
  assert.ok(tw.live && tw.title === 'Twitch real title' && tw.thumbnail.includes('1280x720') && tw.embed.type === 'twitch');
  assert.ok(ki.live && ki.title === 'Kick real title' && ki.thumbnail === 'https://images.kick.com/t.jpg');

  // 2. offline
  state.ytLive = state.twitchLive = state.kickLive = false;
  yt1 = await P.checkYouTube('@pritamisliveff', 'k');
  tw = await P.checkTwitch('pritamislive07', 'tid', 'tsecret');
  ki = await P.checkKick('pritamislive07', 'kid', 'ksecret');
  assert.ok(!yt1.live && yt1.title === null && yt1.thumbnail === null);
  assert.ok(!tw.live && tw.latest.title === 'Last VOD');
  assert.ok(!ki.live && ki.title === null);

  // 3. API failure is reported, never faked as live
  state.ytFail = true;
  const bad = await P.checkYouTube('@x_fail', 'k');
  assert.ok(!bad.live && bad.error);

  // 4. manual fallback
  const m = P.fromManual('kick', 'kick:x', 'x', 'https://kick.com/x', { live: true, title: 'Manual title', url: 'https://kick.com/x', thumbnail: '', embedId: 'x' });
  assert.ok(m.live && m.source === 'manual' && m.embed.id === 'x');
  const none = P.fromManual('kick', 'kick:x', 'x', 'https://kick.com/x', undefined);
  assert.ok(!none.live && none.configured === false);

  // 5. aggregated endpoint + caching
  state.ytFail = false; state.ytLive = true; state.twitchLive = true; state.kickLive = true;
  const { getLive } = require('../server/server');
  const a = await getLive();
  const n = calls.length;
  const b = await getLive();
  assert.strictEqual(calls.length, n, 'second call must be served from cache');
  assert.strictEqual(a.streams.filter((s) => s.live).length, 3, 'multiple platforms live at once are all returned');
  assert.ok(!JSON.stringify(a).match(/tsecret|ksecret|test-yt/), 'secrets never appear in the payload');
  console.log('All live-detection tests passed (' + a.streams.length + ' sources, ' + a.streams.filter((s) => s.live).length + ' live).');
})().catch((e) => { console.error(e); process.exit(1); });
