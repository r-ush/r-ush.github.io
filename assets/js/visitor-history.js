/* Homepage visitor map: one dot per country, sized by Google search clicks plus
 * collected page views, pulsing when a view arrived within the last hour.
 * Loads only when the footer map is opened, then polls the public live totals. */
(function () {
  'use strict';

  var section = document.getElementById('visitor-map');
  if (!section) return;

  var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  var previewHistory = isLocal && new URLSearchParams(window.location.search).get('visitors') === 'history';
  if (previewHistory) {
    // Jump to the footer in the local preview without opening the default-closed map.
    var popup = document.getElementById('cv-popup-overlay');
    if (popup) popup.classList.add('cv-popup-hidden');
    section.scrollIntoView({ block: 'start' });
  }

  var SVG = 'http://www.w3.org/2000/svg';
  var POLL_MS = 60000;
  var script = document.currentScript;
  var root = new URL('../../', script ? script.src : window.location.href);
  var content = section.querySelector('.visitor-map-content');
  var settings = { recentMinutes: 60, homeCountry: 'KR', homeWeight: 0.3 };
  var points = {}, clicks = {}, map = null, layer = null, liveUrl = null, ready = null;
  var timer = 0, polling = false, seen = null;
  var names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) {}

  function el(name, attrs) {
    var node = document.createElementNS(SVG, name);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }
  function countryName(code) {
    try { return (names && names.of(code)) || code; } catch (_) { return code; }
  }
  // Display weight only; tooltips always show the real numbers.
  function weight(code) { return code === settings.homeCountry ? settings.homeWeight : 1; }
  function plural(n, word) { return n + ' ' + (n === 1 ? word : word.replace(/y$/, 'ie') + 's'); }
  function get(path, type) {
    return fetch(new URL(path, root).href, { credentials: 'omit' }).then(function (response) {
      if (!response.ok) throw new Error('Unavailable: ' + path);
      return type === 'text' ? response.text() : response.json();
    });
  }

  function build(data) {
    var history = data[1], config = data[3];
    points = data[2].points || {};
    history.countries.forEach(function (c) { clicks[c.code] = c.clicks; });
    if (config.liveMap) for (var key in settings) if (key in config.liveMap) settings[key] = config.liveMap[key];
    try {
      var collector = new URL(config.endpoint);
      if (collector.pathname === '/collect') liveUrl = new URL('/api/live', collector).href;
    } catch (_) {}
    var holder = document.createElement('div');
    holder.innerHTML = data[0];
    var svg = holder.querySelector('svg');
    if (!svg) throw new Error('Map unavailable');
    svg.removeAttribute('aria-labelledby');
    ['title', 'desc'].forEach(function (name) { var node = svg.querySelector(name); if (node) node.remove(); });
    svg.setAttribute('class', 'visitor-world-map');
    layer = el('g', { class: 'live-layer' });
    svg.appendChild(layer);
    var figure = document.createElement('div');
    figure.className = 'visitor-world';
    figure.appendChild(svg);
    content.replaceChildren(figure);
    map = svg;
    // Search history is drawn at once; live views are added when they arrive.
    render({ countries: [] });
  }

  function render(live) {
    var now = Date.now(), recent = settings.recentMinutes * 60000;
    var totals = {}, lasts = {};
    for (var code in clicks) totals[code] = clicks[code];
    (live.countries || []).forEach(function (c) {
      if (!(c.views > 0)) return;
      totals[c.code] = (totals[c.code] || 0) + c.views;
      if (c.last) lasts[c.code] = Date.parse(c.last);
    });
    var items = Object.keys(totals).filter(function (c) { return points[c]; }).map(function (c) {
      return { code: c, visits: totals[c], last: lasts[c], scaled: totals[c] * weight(c) };
    });
    var largest = 0;
    items.forEach(function (item) { largest = Math.max(largest, item.scaled); });
    // Marker area follows weighted visits; the smallest dot stays visible at phone width.
    items.forEach(function (item) { item.r = 4.5 + 6.5 * Math.sqrt(item.scaled / largest); });
    items.sort(function (a, b) { return b.r - a.r; });
    var previous = seen;
    seen = {};
    layer.replaceChildren();
    items.forEach(function (item) {
      var isRecent = item.last !== undefined && now - item.last < recent;
      // Pulse only when a country's latest interval is new since the previous poll.
      var isFresh = isRecent && (!previous || previous[item.code] !== item.last);
      if (item.last !== undefined) seen[item.code] = item.last;
      var dot = el('g', { class: 'live-dot' + (isRecent ? ' is-recent' : '') + (isFresh ? ' is-fresh' : ''), transform: 'translate(' + points[item.code][0] + ' ' + points[item.code][1] + ')', 'data-country': item.code });
      if (isRecent) {
        dot.appendChild(el('circle', { class: 'live-dot-pulse', r: item.r }));
        dot.appendChild(el('circle', { class: 'live-dot-ring', r: item.r + 2.4 }));
      }
      dot.appendChild(el('circle', { class: 'live-dot-core', r: item.r }));
      dot.appendChild(el('circle', { class: 'live-dot-hit', r: Math.max(item.r, 10) }));
      dot.appendChild(el('title', {})).textContent = countryName(item.code) + ': ' + plural(item.visits, 'visit');
      layer.appendChild(dot);
    });
    var visits = 0;
    items.forEach(function (item) { visits += item.visits; });
    map.setAttribute('aria-label', 'World map of ' + plural(visits, 'visit') + ' from ' + plural(items.length, 'country') + '.');
  }

  function isOpen() { return section.hasAttribute('open'); }
  function poll() {
    clearTimeout(timer);
    if (!liveUrl || polling || !isOpen() || document.visibilityState !== 'visible') return;
    polling = true;
    fetch(liveUrl, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (response) { if (!response.ok) throw new Error('Live map unavailable'); return response.json(); })
      // On failure the search-history dots stay as they are.
      .then(render, function () {})
      .then(function () {
        polling = false;
        if (isOpen() && document.visibilityState === 'visible') timer = setTimeout(poll, POLL_MS);
      });
  }
  function load() {
    if (!ready) ready = Promise.all([get('assets/images/world-map.svg', 'text'), get('assets/data/search-history.json'), get('assets/data/country-points.json'), get('assets/data/analytics-config.json')])
      .then(build)
      // Keep the static history image and retry on the next open.
      .catch(function () { ready = null; throw new Error('Map unavailable'); });
    return ready;
  }
  function start() { load().then(poll, function () {}); }

  section.addEventListener('toggle', function () { if (isOpen()) start(); else clearTimeout(timer); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (map) poll(); } else clearTimeout(timer);
  });
  if (isOpen()) start();
}());
