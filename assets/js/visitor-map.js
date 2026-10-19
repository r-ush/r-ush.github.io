/* Shared by the homepage and project repositories. Two independent counters. */
(function () {
  'use strict';
  if (window.rushAnalyticsLoaded) return;
  window.rushAnalyticsLoaded = true;
  var script = document.currentScript;
  var root = new URL('../../', script ? script.src : location.href);
  var preferenceKey = 'rush-analytics-disabled';
  var stopped = false;
  var queue = [];
  var endpoint = '';
  function optedOut() {
    if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return true;
    try { return localStorage.getItem(preferenceKey) === '1'; } catch (_) { return false; }
  }
  function excluded() { return stopped || optedOut(); }
  function stop() { stopped = true; queue.length = 0; }
  window.addEventListener('rush-analytics-preference', function () { if (optedOut()) stop(); });
  window.addEventListener('storage', function (event) { if (event.key === preferenceKey && event.newValue === '1') stop(); });
  function addNotice() {
    if (document.querySelector('[data-analytics-notice]')) return;
    var footer = document.createElement('p');
    footer.setAttribute('data-analytics-notice', '');
    footer.style.cssText = 'text-align:center;font:12px/1.6 sans-serif;color:#777;margin:24px 12px;';
    var link = document.createElement('a');
    link.href = new URL('privacy.html', root).href;
    link.textContent = 'Privacy & analytics preferences';
    footer.appendChild(link);
    document.body.appendChild(footer);
  }
  if (document.body) addNotice();
  else document.addEventListener('DOMContentLoaded', addNotice, { once: true });
  if (excluded() || navigator.webdriver || /bot|crawler|spider|headless|lighthouse|preview/i.test(navigator.userAgent)) return;
  var localPreview = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && script && script.hasAttribute('data-analytics-preview');
  if (location.hostname !== 'r-ush.github.io' && !localPreview) return;
  // Keep the existing public counter independent of our collector/configuration.
  // A single eager image records the visit even when the footer map is collapsed.
  var publicCounted = false;
  function countPublicVisit() {
    if (publicCounted || excluded() || location.hostname !== 'r-ush.github.io' ||
        document.visibilityState !== 'visible' || document.prerendering || !document.body) return;
    publicCounted = true;
    var pixel = document.createElement('img');
    pixel.width = 1;
    pixel.height = 1;
    pixel.alt = '';
    pixel.setAttribute('aria-hidden', 'true');
    pixel.referrerPolicy = 'no-referrer';
    pixel.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    pixel.src = 'https://mapmyvisitors.com/map.png?d=fGQkHeJjD2q20QiECdFcDFPfH3JNP_cewlyjRrwjAf4&cl=ffffff';
    document.body.appendChild(pixel);
  }
  document.addEventListener('DOMContentLoaded', countPublicVisit, { once: true });
  document.addEventListener('visibilitychange', countPublicVisit);
  document.addEventListener('prerenderingchange', countPublicVisit);
  countPublicVisit();
  function flush() {
    if (excluded() || !endpoint || !queue.length) { if (excluded()) queue.length = 0; return; }
    var batch = queue.splice(0, 20);
    // No credentials/Referer, no retries that could duplicate delivered events.
    try {
      fetch(endpoint, {
        method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true,
        referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ v: 1, events: batch })
      }).catch(function () {});
    } catch (_) {}
  }
  function emit(event, immediate) {
    if (excluded()) return;
    if (queue.length < 20) queue.push(event);
    if (immediate || queue.length >= 20) flush();
  }
  function pagePath(path, config) {
    path = path.replace(/index\.html$/, '');
    if (!path.endsWith('/')) path += '/';
    return Object.prototype.hasOwnProperty.call(config.pages, path) ? path : null;
  }
  function sourceGroup(referrer, origin) {
    if (!referrer) return 'Direct / unknown';
    var url;
    try { url = new URL(referrer); } catch (_) { return 'Direct / unknown'; }
    if (url.origin === origin || url.origin === location.origin) return 'Internal';
    var host = url.hostname.toLowerCase();
    if (/(^|\.)google\.[a-z.]+$/.test(host)) return 'Google';
    var groups = { 'bing.com': 'Bing', 'naver.com': 'Naver', 'duckduckgo.com': 'DuckDuckGo', 'yahoo.com': 'Yahoo', 'baidu.com': 'Baidu', 'github.com': 'GitHub', 'linkedin.com': 'LinkedIn', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 't.co': 'X', 'twitter.com': 'X', 'x.com': 'X', 'facebook.com': 'Facebook', 'reddit.com': 'Reddit' };
    for (var domain in groups) if (host === domain || host.endsWith('.' + domain)) return groups[domain];
    return 'Other external';
  }
  function clickTarget(anchor, config) {
    var raw = anchor.getAttribute('href');
    if (!raw || raw.charAt(0) === '#') return null;
    var url;
    try { url = new URL(raw, location.href); } catch (_) { return null; }
    if (url.protocol === 'mailto:') return { target: 'Email', kind: 'email' };
    if (!/^https?:$/.test(url.protocol) || url.pathname === '/privacy.html') return null;
    if (url.origin === config.siteOrigin || url.origin === location.origin) {
      if (url.pathname === '/data/cv_seunghwan.pdf') return { target: 'CV', kind: 'download' };
      if (anchor.hasAttribute('download') || /\.(pdf|zip|stl|obj|glb|csv)$/i.test(url.pathname)) return { target: 'PDF / download', kind: 'download' };
      return { target: pagePath(url.pathname, config) || 'Other internal', kind: 'internal' };
    }
    var known = { 'scholar.google.com': 'Google Scholar', 'github.com': 'GitHub', 'ieeexplore.ieee.org': 'IEEE', 'arxiv.org': 'arXiv', 'doi.org': 'DOI', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'linkedin.com': 'LinkedIn' };
    var target = 'Other external';
    for (var domain in known) if (url.hostname === domain || url.hostname.endsWith('.' + domain)) target = known[domain];
    return { target: target, kind: 'outbound' };
  }
  function start(config) {
    if (excluded() || !config.endpoint) return;
    var page = pagePath(location.pathname, config);
    if (!page) return;
    var collector;
    try { collector = new URL(config.endpoint); } catch (_) { return; }
    if (collector.protocol !== 'https:' && !(localPreview && collector.origin === location.origin)) return;
    if (collector.pathname !== '/collect' || collector.search || collector.hash || collector.username || collector.password) return;
    endpoint = collector.href;
    var viewed = false, milestones = {}, totalActive = 0, pendingActive = 0, engaged = false;
    var lastTick = performance.now(), lastActivity = lastTick;
    var active = document.visibilityState === 'visible' && document.hasFocus();
    var performanceSent = false;
    function view() {
      if (viewed || document.visibilityState !== 'visible' || document.prerendering) return;
      viewed = true;
      emit({ type: 'view', page: page, source: sourceGroup(document.referrer, config.siteOrigin) }, true);
      scroll(); measurePerformance();
    }
    function tick() {
      var now = performance.now();
      if (active && viewed) {
        var until = Math.min(now, lastActivity + 60000);
        var delta = Math.max(0, Math.min(5000, until - lastTick)) / 1000;
        totalActive += delta; pendingActive += delta;
      }
      lastTick = now;
    }
    function engagement() {
      tick();
      var seconds = Math.min(60, Math.floor(pendingActive));
      var firstEngaged = !engaged && totalActive >= 10;
      if (!seconds && !firstEngaged) return;
      pendingActive -= seconds;
      if (firstEngaged) engaged = true;
      emit({ type: 'engagement', page: page, seconds: seconds, engaged: firstEngaged });
    }
    function activity() { tick(); lastActivity = performance.now(); }
    function scroll() {
      if (!viewed || document.visibilityState !== 'visible' || excluded()) return;
      var height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, innerHeight);
      var depth = Math.min(100, Math.round((scrollY + innerHeight) / height * 100));
      [25, 50, 75, 100].forEach(function (mark) {
        if (depth >= mark && !milestones[mark]) { milestones[mark] = true; emit({ type: 'scroll', page: page, depth: mark }); }
      });
    }
    function measurePerformance() {
      if (!viewed || performanceSent || document.readyState !== 'complete') return;
      setTimeout(function () {
        if (performanceSent || excluded()) return;
        var entry = performance.getEntriesByType('navigation')[0];
        if (!entry || !entry.loadEventEnd) return;
        performanceSent = true;
        emit({ type: 'performance', page: page, load: Math.min(60000, Math.max(0, Math.round(entry.loadEventEnd))), ttfb: Math.min(30000, Math.max(0, Math.round(entry.responseStart))) });
      }, 0);
    }
    ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(function (name) { window.addEventListener(name, activity, { passive: true }); });
    var scrollScheduled = false;
    window.addEventListener('scroll', function () {
      if (scrollScheduled) return;
      scrollScheduled = true;
      requestAnimationFrame(function () { scrollScheduled = false; scroll(); });
    }, { passive: true });
    document.addEventListener('click', function (event) {
      if (!viewed || excluded()) return;
      var anchor = event.target.closest && event.target.closest('a[href]');
      if (anchor) {
        var target = clickTarget(anchor, config);
        if (target) emit({ type: 'click', page: page, target: target.target, kind: target.kind }, true);
      }
      var section = event.target.closest && event.target.closest('[data-section]');
      if (section) setTimeout(function () {
        if (section.getAttribute('data-expanded') === 'true') emit({ type: 'section', page: page, section: config.sections.includes(section.dataset.section) ? section.dataset.section : 'other' });
      }, 0);
    });
    document.addEventListener('toggle', function (event) {
      if (viewed && event.target.tagName === 'DETAILS' && event.target.open) emit({ type: 'section', page: page, section: event.target.id === 'visitor-map' ? 'visitor-map' : 'other' });
    }, true);
    var played = new WeakSet(), completed = new WeakSet();
    document.addEventListener('play', function (event) {
      var video = event.target;
      if (!viewed || video.tagName !== 'VIDEO' || video.loop || video.autoplay || played.has(video)) return;
      played.add(video); emit({ type: 'video', page: page, action: 'play' });
    }, true);
    document.addEventListener('ended', function (event) {
      var video = event.target;
      if (!played.has(video) || completed.has(video)) return;
      completed.add(video); emit({ type: 'video', page: page, action: 'complete' });
    }, true);
    document.addEventListener('visibilitychange', function () {
      tick(); active = document.visibilityState === 'visible' && document.hasFocus();
      if (document.visibilityState === 'hidden') { engagement(); flush(); }
      else { lastActivity = performance.now(); view(); }
    });
    window.addEventListener('blur', function () { tick(); active = false; engagement(); flush(); });
    window.addEventListener('focus', function () { tick(); active = document.visibilityState === 'visible'; lastActivity = performance.now(); });
    window.addEventListener('pagehide', function () { engagement(); flush(); active = false; });
    window.addEventListener('pageshow', function () { lastTick = performance.now(); lastActivity = lastTick; active = document.visibilityState === 'visible' && document.hasFocus(); view(); });
    window.addEventListener('load', measurePerformance, { once: true });
    document.addEventListener('prerenderingchange', view, { once: true });
    var timer = setInterval(function () {
      if (excluded()) { clearInterval(timer); queue.length = 0; return; }
      tick();
      if (pendingActive >= 25 || queue.length) { engagement(); flush(); }
    }, 5000);
    view();
  }
  fetch(new URL('assets/data/analytics-config.json', root).href, { credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (config) { if (config) start(config); })
    .catch(function () {});
}());
