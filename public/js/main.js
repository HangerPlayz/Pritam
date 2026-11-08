/* About Pritam – page behaviour (navigation, loader, reveals, copy email). No dependencies. */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.add('js');

  /* ---------- Loader ---------- */
  var loader = doc.getElementById('loader');
  var hidden = false;
  doc.body.classList.add('is-loading');
  function hideLoader() {
    if (hidden) return;
    hidden = true;
    loader.classList.add('is-done');
    doc.body.classList.remove('is-loading');
    setTimeout(function () { loader.remove(); }, 600);
  }
  var minShow = new Promise(function (r) { setTimeout(r, reduceMotion ? 0 : 900); });
  var loaded = new Promise(function (r) {
    if (doc.readyState === 'complete') r(); else window.addEventListener('load', r, { once: true });
  });
  Promise.all([minShow, loaded]).then(hideLoader);
  setTimeout(hideLoader, 3500); // never block the page on a slow asset

  /* ---------- Sticky nav + back-to-top ---------- */
  var nav = doc.getElementById('nav');
  var toTop = doc.getElementById('toTop');
  function onScroll() {
    var y = window.scrollY;
    nav.classList.toggle('is-stuck', y > 12);
    toTop.classList.toggle('is-shown', y > 700);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  toTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* ---------- Mobile menu ---------- */
  var burger = doc.getElementById('burger');
  var links = doc.getElementById('navLinks');
  function setMenu(open) {
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    links.classList.toggle('is-open', open);
    doc.body.style.overflow = open ? 'hidden' : '';
  }
  burger.addEventListener('click', function () { setMenu(burger.getAttribute('aria-expanded') !== 'true'); });
  links.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') { setMenu(false); burger.focus(); }
  });
  window.matchMedia('(min-width: 1081px)').addEventListener('change', function (m) { if (m.matches) setMenu(false); });

  /* ---------- Active link (scroll spy) ---------- */
  var navAnchors = [].slice.call(links.querySelectorAll('a[href^="#"]:not(.btn)'));
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      navAnchors.forEach(function (a) {
        var on = a.getAttribute('href') === '#' + en.target.id;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  navAnchors.forEach(function (a) {
    var s = doc.querySelector(a.getAttribute('href'));
    if (s) spy.observe(s);
  });

  /* ---------- Scroll reveal ---------- */
  var revealEls = [].slice.call(doc.querySelectorAll('[data-reveal]'));
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(function (el) {
      // stagger siblings inside the same grid
      var sibs = el.parentElement.querySelectorAll(':scope > [data-reveal]');
      el.style.setProperty('--d', Math.min([].indexOf.call(sibs, el), 5) * 70 + 'ms');
      io.observe(el);
    });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- Toast + copy email ---------- */
  var toast = doc.getElementById('toast');
  var toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('is-shown'); }, 2400);
  }
  window.showToast = showToast;

  function fallbackCopy(text) {
    var ta = doc.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0';
    doc.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  doc.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var text = btn.getAttribute('data-copy');
    var done = function (ok) {
      showToast(ok ? 'Email copied: ' + text : 'Could not copy. Select the address and copy it manually.');
      if (ok) {
        var old = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = old; }, 1600);
      }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    } else {
      done(fallbackCopy(text));
    }
  });
})();
