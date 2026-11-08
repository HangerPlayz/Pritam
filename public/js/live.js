/* About Pritam – live stream dashboard.
 *
 * Data comes from /api/live (server/server.js, which talks to the official YouTube, Twitch and
 * Kick APIs). If that endpoint is unreachable (for example the site is hosted as plain static
 * files) it falls back to /data/manual-streams.json. Nothing is ever made up: if a value is not
 * provided by the platform, it is not shown.
 */
(function () {
  'use strict';
  var doc = document;

  var PLATFORMS = [
    { id: 'youtube', name: 'YouTube', icon: 'assets/icons/youtube.png' },
    { id: 'twitch', name: 'Twitch', icon: 'assets/icons/twitch.png' },
    { id: 'kick', name: 'Kick', icon: 'assets/icons/kick.png' },
  ];
  var STATIC_CHANNELS = [ // used only by the static manual fallback
    { platform: 'youtube', key: 'youtube:pritamisliveff', name: 'Pritam Is Live FF', url: 'https://m.youtube.com/@pritamisliveff', manual: 'youtube' },
    { platform: 'youtube', key: 'youtube:proton_live', name: 'Proton Live', url: 'https://youtube.com/@proton_live?si=hixsd2od62dlGP96', manual: 'youtube2' },
    { platform: 'twitch', key: 'twitch:pritamislive07', name: 'Pritam Is Live', url: 'https://m.twitch.tv/pritamislive07/home', manual: 'twitch' },
    { platform: 'kick', key: 'kick:pritamislive07', name: 'Pritam Is Live', url: 'https://kick.com/pritamislive07', manual: 'kick' },
  ];

  var grid = doc.getElementById('streamGrid');
  var meta = doc.getElementById('streamMeta');
  var announce = doc.getElementById('streamAnnounce');
  var heroPill = doc.getElementById('heroStatus');
  var heroText = doc.getElementById('heroStatusText');
  var heroWatch = doc.getElementById('heroWatch');
  if (!grid) return;

  var rendered = {};       // card key -> { el, sig }
  var lastLiveSig = null;
  var timer = null;
  var pollMs = 60000;

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function safeUrl(u) {
    try { var x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; }
  }
  function platformOf(id) { return PLATFORMS.filter(function (p) { return p.id === id; })[0]; }
  function hostOf(u) { try { return new URL(u).host + new URL(u).pathname.replace(/\/$/, ''); } catch (e) { return u; } }
  function embedSrc(e) {
    if (!e || !e.id) return null;
    var id = encodeURIComponent(e.id);
    if (e.type === 'youtube') return 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&mute=1&rel=0';
    if (e.type === 'twitch') return 'https://player.twitch.tv/?channel=' + id + '&parent=' + encodeURIComponent(location.hostname) + '&muted=true&autoplay=true';
    if (e.type === 'kick') return 'https://player.kick.com/' + id + '?autoplay=true&muted=true';
    return null;
  }
  function externalLink(cls, label, href, srLabel) {
    var a = el('a', cls, label);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    if (srLabel) a.appendChild(el('span', 'visually-hidden', ' ' + srLabel + ' (opens in a new tab)'));
    return a;
  }

  /* ---------- data ---------- */
  function fetchJson(url) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 10000);
    return fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(function () { clearTimeout(t); });
  }

  function fromStaticManual(m) {
    return {
      updatedAt: null, ttl: 120,
      streams: STATIC_CHANNELS.map(function (c) {
        var e = m[c.manual];
        var s = { platform: c.platform, channelKey: c.key, channelName: c.name, channelUrl: c.url, configured: !!e, live: false,
          title: null, thumbnail: null, streamUrl: null, embed: null, viewers: null, latest: null, source: 'manual', error: null };
        if (e && e.live === true) {
          s.live = true; s.title = e.title || null; s.thumbnail = e.thumbnail || null; s.streamUrl = e.url || c.url;
          if (e.embedId) s.embed = { type: c.platform, id: e.embedId };
        } else if (e && e.latest && e.latest.url) { s.latest = e.latest; }
        return s;
      }),
    };
  }

  function load() {
    return fetchJson('/api/live').catch(function () {
      return fetchJson('data/manual-streams.json').then(fromStaticManual);
    });
  }

  /* ---------- card building ---------- */
  function cardHead(p, chanName, badge) {
    var top = el('div', 'scard__top');
    var img = el('img'); img.src = p.icon; img.width = 40; img.height = 40; img.alt = ''; img.loading = 'lazy';
    var t = el('div');
    t.appendChild(el('div', 'scard__plat', p.name));
    if (chanName) t.appendChild(el('div', 'scard__chan', chanName));
    top.appendChild(img); top.appendChild(t); top.appendChild(badge);
    return top;
  }
  function badge(kind, text) {
    var b = el('span', 'badge' + (kind === 'live' ? ' badge--live' : kind === 'warn' ? ' badge--warn' : ''));
    if (kind === 'live') b.appendChild(el('span', 'dot'));
    b.appendChild(doc.createTextNode(text));
    return b;
  }
  function thumb(src, alt, onError) {
    var safe = src && safeUrl(src);
    if (!safe) return null;
    var i = el('img'); i.src = safe; i.alt = alt || ''; i.loading = 'lazy'; i.decoding = 'async';
    i.referrerPolicy = 'no-referrer';
    i.addEventListener('error', function () { onError(i); });
    return i;
  }
  function emptyMedia(p, title, small) {
    var e = el('div', 'scard__empty');
    var i = el('img'); i.src = p.icon; i.alt = ''; i.width = 64; i.height = 64;
    e.appendChild(i); e.appendChild(el('p', null, title));
    if (small) e.appendChild(el('small', null, small));
    return e;
  }

  function liveCard(p, s) {
    var card = el('article', 'scard is-live');
    card.appendChild(cardHead(p, s.channelName, badge('live', 'LIVE')));

    var media = el('div', 'scard__media');
    var th = thumb(s.thumbnail, 'Current stream thumbnail: ' + (s.title || p.name), function (i) {
      i.replaceWith(emptyMedia(p, 'LIVE NOW', 'Thumbnail unavailable. Watch the stream below.'));
    });
    media.appendChild(th || emptyMedia(p, 'LIVE NOW'));
    if (typeof s.viewers === 'number') media.appendChild(el('span', 'scard__viewers', s.viewers.toLocaleString() + ' watching'));
    var src = embedSrc(s.embed);
    if (src) {
      var play = el('button', 'scard__play');
      play.type = 'button';
      play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.500v15l13-7.500z"/></svg>';
      play.appendChild(doc.createTextNode('Play preview'));
      play.addEventListener('click', function () {
        var f = el('iframe');
        f.src = src; f.title = p.name + ' live stream preview'; f.loading = 'lazy';
        f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        f.allowFullscreen = true;
        media.textContent = '';
        media.appendChild(f);
      });
      media.appendChild(play);
    }
    card.appendChild(media);

    var body = el('div', 'scard__body');
    body.appendChild(el('h3', 'scard__title', s.title || 'Live now on ' + p.name));
    var url = safeUrl(s.streamUrl) || safeUrl(s.channelUrl);
    if (url) {
      var u = el('div', 'scard__url');
      var li = el('img'); li.src = 'assets/icons/link.png'; li.width = 18; li.height = 18; li.alt = ''; li.loading = 'lazy';
      u.appendChild(li); u.appendChild(el('span', null, hostOf(url)));
      body.appendChild(u);
      var act = el('div', 'scard__actions');
      act.appendChild(externalLink('btn btn--primary', 'Watch Live', url, 'on ' + p.name));
      body.appendChild(act);
    }
    card.appendChild(body);
    return card;
  }

  function offlineCard(p, items) {
    var configured = items.filter(function (s) { return s.configured; });
    var errored = configured.length && configured.every(function (s) { return s.error; });
    var primary = items[0];
    var latest = null;
    items.forEach(function (s) { if (!latest && s.latest) latest = s.latest; });

    var kind, text;
    if (!configured.length) { kind = 'warn'; text = 'STATUS UNAVAILABLE'; }
    else if (errored) { kind = 'warn'; text = 'CHECK FAILED'; }
    else { kind = 'off'; text = 'OFFLINE'; }

    var card = el('article', 'scard' + (errored ? ' scard--error' : ''));
    card.appendChild(cardHead(p, items.length === 1 ? primary.channelName : null, badge(kind, text)));

    var media = el('div', 'scard__media is-offline');
    var latestUrl = latest && safeUrl(latest.url);
    var th = latest && thumb(latest.thumbnail, 'Latest video: ' + (latest.title || ''), function (i) {
      i.replaceWith(emptyMedia(p, 'Stream is offline'));
    });
    if (th) {
      media.appendChild(th);
    } else if (errored) {
      media.appendChild(emptyMedia(p, 'Live check failed', 'The stream status could not be loaded. Try again in a moment.'));
    } else if (!configured.length) {
      media.appendChild(emptyMedia(p, 'Status not connected', 'Open the channel to see if Pritam is live.'));
    } else {
      media.appendChild(emptyMedia(p, 'Pritam is offline', 'No live stream right now. Follow the channel to catch the next one.'));
    }
    card.appendChild(media);

    var body = el('div', 'scard__body');
    if (latest && latest.title && latestUrl) {
      body.appendChild(el('p', 'scard__note', 'Latest from the channel'));
      body.appendChild(el('h3', 'scard__title', latest.title));
    } else if (errored) {
      body.appendChild(el('h3', 'scard__title', 'Could not check ' + p.name));
    } else if (!configured.length) {
      body.appendChild(el('h3', 'scard__title', 'Open ' + p.name + ' to check'));
    } else {
      body.appendChild(el('h3', 'scard__title', 'Offline right now'));
      body.appendChild(el('p', 'scard__note', 'This card switches to LIVE on its own as soon as a stream starts.'));
    }

    var act = el('div', 'scard__actions');
    if (latestUrl) act.appendChild(externalLink('btn btn--ghost', 'Watch Latest', latestUrl, 'video on ' + p.name));
    var chUrl = safeUrl(primary.channelUrl);
    if (chUrl) act.appendChild(externalLink('btn btn--primary', 'Visit Channel', chUrl, primary.channelName + ' on ' + p.name));
    body.appendChild(act);
    if (items.length > 1) {
      var more = el('p', 'scard__more');
      more.appendChild(doc.createTextNode('Also: '));
      items.slice(1).forEach(function (s, i) {
        var u2 = safeUrl(s.channelUrl);
        if (!u2) return;
        if (i) more.appendChild(doc.createTextNode(', '));
        var a = externalLink(null, s.channelName, u2, 'on ' + p.name);
        a.style.textDecoration = 'underline';
        more.appendChild(a);
      });
      body.appendChild(more);
    }
    card.appendChild(body);
    return card;
  }

  /* ---------- render ---------- */
  function build(data) {
    var cards = []; // { key, sig, make }
    PLATFORMS.forEach(function (p) {
      var items = data.streams.filter(function (s) { return s.platform === p.id; });
      if (!items.length) return;
      var live = items.filter(function (s) { return s.live; });
      if (live.length) {
        live.forEach(function (s) {
          cards.push({ key: 'live:' + s.channelKey, sig: JSON.stringify([s.title, s.thumbnail, s.streamUrl, s.embed, s.viewers]), make: function () { return liveCard(p, s); } });
        });
      } else {
        cards.push({ key: 'off:' + p.id, sig: JSON.stringify(items.map(function (s) { return [s.channelKey, s.configured, s.error, s.latest]; })), make: function () { return offlineCard(p, items); } });
      }
    });
    return cards;
  }

  function render(data) {
    var cards = build(data);
    var keep = {};
    cards.forEach(function (c) { keep[c.key] = true; });
    Object.keys(rendered).forEach(function (k) { if (!keep[k]) { rendered[k].el.remove(); delete rendered[k]; } });
    grid.querySelectorAll('.scard--skeleton').forEach(function (n) { n.remove(); });

    var prev = null;
    cards.forEach(function (c) {
      var cur = rendered[c.key];
      if (!cur || cur.sig !== c.sig) { // only rebuild what changed, so an open preview isn't reset
        var node = c.make();
        node.setAttribute('data-key', c.key);
        if (cur) cur.el.replaceWith(node); else grid.appendChild(node);
        rendered[c.key] = { el: node, sig: c.sig };
      }
      var n = rendered[c.key].el;
      if (prev ? prev.nextElementSibling !== n : grid.firstElementChild !== n) grid.insertBefore(n, prev ? prev.nextElementSibling : grid.firstElementChild);
      prev = n;
    });
    grid.setAttribute('aria-busy', 'false');
    updateHero(data);
    updateMeta(data);
  }

  function updateHero(data) {
    var live = data.streams.filter(function (s) { return s.live; });
    var sig = live.map(function (s) { return s.channelKey; }).join(',');
    if (live.length) {
      var names = live.map(function (s) { return platformOf(s.platform).name; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
      heroText.textContent = 'Live now on ' + names.join(' & ');
      heroPill.classList.add('is-live');
      heroPill.firstElementChild.className = 'dot dot--live';
      var u = safeUrl(live[0].streamUrl);
      if (u && heroWatch) { heroWatch.href = u; heroWatch.target = '_blank'; heroWatch.rel = 'noopener noreferrer'; }
    } else {
      var known = data.streams.some(function (s) { return s.configured && !s.error; });
      heroText.textContent = known ? 'Offline right now. See the streams below' : 'Check the streams below';
      heroPill.classList.remove('is-live');
      heroPill.firstElementChild.className = 'dot dot--idle';
      if (heroWatch) { heroWatch.href = '#streams'; heroWatch.removeAttribute('target'); heroWatch.removeAttribute('rel'); }
    }
    if (lastLiveSig !== null && lastLiveSig !== sig) {
      announce.textContent = live.length ? heroText.textContent : 'Pritam is no longer live.';
    }
    lastLiveSig = sig;
  }

  function updateMeta(data) {
    var manual = data.streams.some(function (s) { return s.source === 'manual' && s.configured; });
    var parts = [];
    if (data.updatedAt) parts.push('Last checked ' + new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    if (manual) parts.push('Some status is updated manually');
    meta.textContent = parts.join(' · ');
  }

  function renderFailure() {
    if (Object.keys(rendered).length) { meta.textContent = 'Could not refresh stream status. Showing the last known state.'; return; }
    grid.textContent = '';
    grid.setAttribute('aria-busy', 'false');
    var card = el('article', 'scard scard--error');
    var body = el('div', 'scard__body');
    body.appendChild(el('h3', 'scard__title', 'Stream status could not be loaded'));
    body.appendChild(el('p', 'scard__note', 'Check your connection and try again, or open a channel directly to see if Pritam is live.'));
    var act = el('div', 'scard__actions');
    var retry = el('button', 'btn btn--primary', 'Try again'); retry.type = 'button';
    retry.addEventListener('click', function () { grid.setAttribute('aria-busy', 'true'); tick(); });
    act.appendChild(retry);
    act.appendChild(el('a', 'btn btn--ghost', 'Go to channels')).href = '#channels';
    body.appendChild(act); card.appendChild(body); grid.appendChild(card);
    heroText.textContent = 'Check the streams below';
  }

  function tick() {
    clearTimeout(timer);
    load().then(function (data) {
      pollMs = Math.max(30, Math.min(data.ttl || 60, 300)) * 1000;
      render(data);
    }).catch(renderFailure).finally(schedule);
  }
  function schedule() {
    clearTimeout(timer);
    if (doc.hidden) return;
    timer = setTimeout(tick, pollMs);
  }
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden) tick(); else clearTimeout(timer); });

  tick();
})();
