/* Homepage visitor map: one dot per country, sized by Google search clicks, the
 * MapMyVisitors views from before collection started and collected page views, with
 * a total, zoom, hover details and the last day's visits.
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
  var POLL_MS = 60000, WIDTH = 720, HEIGHT = 300, MAX_ZOOM = 8, LIST_SIZE = 8;
  var script = document.currentScript;
  var root = new URL('../../', script ? script.src : window.location.href);
  var content = section.querySelector('.visitor-map-content');
  var settings = { bucketMinutes: 10, recentMinutes: 60, homeCountry: 'KR', homeWeight: 0.3 };
  var points = {}, past = {}, pastUnknown = 0, liveUrl = null, ready = null;
  var map = null, layer = null, figure = null, total = null, tip = null, resetButton = null, recentBlock = null, recentList = null;
  var timer = 0, polling = false, seen = null;
  var view = { k: 1, x: 0, y: 0 }, pointers = {};
  var names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) {}

  function el(name, attrs) {
    var node = document.createElementNS(SVG, name);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }
  function html(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function countryName(code) {
    try { return (names && names.of(code)) || code; } catch (_) { return code; }
  }
  // Display weight only; the tooltip and total always show the real numbers.
  function weight(code) { return code === settings.homeCountry ? settings.homeWeight : 1; }
  function plural(n, word) { return n.toLocaleString('en') + ' ' + (n === 1 ? word : word.replace(/y$/, 'ie') + 's'); }
  function ago(ms) {
    var minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + ' min ago';
    return Math.floor(minutes / 60) + ' h ago';
  }
  function get(path, type) {
    return fetch(new URL(path, root).href, { credentials: 'omit' }).then(function (response) {
      if (!response.ok) throw new Error('Unavailable: ' + path);
      return type === 'text' ? response.text() : response.json();
    });
  }

  function build(data) {
    var history = data[1], config = data[3], mapmyvisitors = data[4];
    points = data[2].points || {};
    // Earlier periods that the collector did not see: search clicks up to its export
    // date, then MapMyVisitors views until collection started. Neither overlaps it.
    history.countries.forEach(function (c) { past[c.code] = (past[c.code] || 0) + c.clicks; });
    mapmyvisitors.countries.forEach(function (c) { past[c.code] = (past[c.code] || 0) + c.views; });
    pastUnknown = mapmyvisitors.unknown || 0;
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
    // Only the dots have details; country shapes carry no tooltips.
    var titles = svg.querySelectorAll('title, desc');
    for (var i = 0; i < titles.length; i++) titles[i].remove();
    svg.setAttribute('class', 'visitor-world-map');
    layer = el('g', { class: 'live-layer' });
    svg.appendChild(layer);
    map = svg;

    figure = html('div', 'visitor-world');
    total = html('div', 'visitor-map-total');
    tip = html('div', 'visitor-map-tip');
    tip.hidden = true;
    var controls = html('div', 'visitor-map-zoom');
    function control(label, name, action) {
      var button = html('button', '', label);
      button.type = 'button';
      button.setAttribute('aria-label', name);
      button.addEventListener('click', action);
      controls.appendChild(button);
      return button;
    }
    control('+', 'Zoom in', function () { zoomCenter(2); });
    control('−', 'Zoom out', function () { zoomCenter(0.5); });
    resetButton = control('↺', 'Reset map', function () { view = { k: 1, x: 0, y: 0 }; applyView(); });
    resetButton.hidden = true;
    figure.append(svg, total, controls, tip);
    recentBlock = html('div', 'visitor-map-recent');
    recentBlock.hidden = true;
    recentList = html('ol', 'visitor-map-recent-list');
    recentBlock.append(html('p', 'visitor-map-recent-title', 'Recent visitors'), recentList);
    content.replaceChildren(figure, recentBlock);
    bindPointer();
    // Search history is drawn at once; live views are added when they arrive.
    render({ countries: [], recent: [] });
  }

  function dotTransform(code) {
    // Dots keep their on-screen size while the map zooms.
    return 'translate(' + points[code][0] + ' ' + points[code][1] + ') scale(' + (1 / view.k) + ')';
  }
  function applyView() {
    var w = WIDTH / view.k, h = HEIGHT / view.k;
    view.x = Math.min(Math.max(view.x, 0), WIDTH - w);
    view.y = Math.min(Math.max(view.y, 0), HEIGHT - h);
    map.setAttribute('viewBox', [view.x, view.y, w, h].map(function (n) { return Math.round(n * 100) / 100; }).join(' '));
    for (var i = 0; i < layer.children.length; i++) layer.children[i].setAttribute('transform', dotTransform(layer.children[i].getAttribute('data-country')));
    map.classList.toggle('is-zoomed', view.k > 1);
    resetButton.hidden = view.k === 1;
    hideTip();
  }
  function zoomAt(factor, ux, uy) {
    var k = Math.min(Math.max(view.k * factor, 1), MAX_ZOOM), ratio = view.k / k;
    view.x = ux - (ux - view.x) * ratio;
    view.y = uy - (uy - view.y) * ratio;
    view.k = k;
    applyView();
  }
  function zoomCenter(factor) { zoomAt(factor, view.x + WIDTH / view.k / 2, view.y + HEIGHT / view.k / 2); }
  function toMap(clientX, clientY) {
    var r = map.getBoundingClientRect();
    return [view.x + (clientX - r.left) / r.width * WIDTH / view.k, view.y + (clientY - r.top) / r.height * HEIGHT / view.k];
  }

  function showTip(dot) {
    var box = figure.getBoundingClientRect(), mark = dot.querySelector('.live-dot-core').getBoundingClientRect();
    tip.replaceChildren(html('strong', '', dot.getAttribute('data-name')), html('span', '', dot.getAttribute('data-visits')));
    if (dot.getAttribute('data-latest')) tip.appendChild(html('span', '', dot.getAttribute('data-latest')));
    tip.hidden = false;
    // Centred above the dot, but kept inside the map so edge countries do not overflow.
    var half = tip.offsetWidth / 2, left = mark.left + mark.width / 2 - box.left;
    tip.style.left = Math.min(Math.max(left, half), Math.max(half, box.width - half)) + 'px';
    tip.style.top = (mark.top - box.top) + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }
  function bindPointer() {
    layer.addEventListener('pointerover', function (event) {
      var dot = event.target.closest('.live-dot');
      if (dot && !Object.keys(pointers).length) showTip(dot);
    });
    layer.addEventListener('pointerout', function (event) {
      var dot = event.target.closest('.live-dot');
      if (dot && !(event.relatedTarget && dot.contains(event.relatedTarget))) hideTip();
    });
    // Taps show the same details on touch screens; tapping elsewhere hides them.
    map.addEventListener('click', function (event) {
      var dot = event.target.closest('.live-dot');
      if (dot) showTip(dot); else hideTip();
    });
    map.addEventListener('dblclick', function (event) {
      var at = toMap(event.clientX, event.clientY);
      zoomAt(2, at[0], at[1]);
    });
    // Pinch gestures and Ctrl/⌘ + wheel zoom; plain wheel scrolling keeps scrolling the page.
    map.addEventListener('wheel', function (event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      var at = toMap(event.clientX, event.clientY);
      zoomAt(Math.exp(-event.deltaY * 0.01), at[0], at[1]);
    }, { passive: false });
    // Drag to pan and two-finger pinch once the map is zoomed in.
    map.addEventListener('pointerdown', function (event) {
      if (view.k === 1) return;
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
    });
    map.addEventListener('pointermove', function (event) {
      var p = pointers[event.pointerId];
      if (!p) return;
      // Capture only once it is a drag, so a plain tap still reaches the dot.
      if (!p.dragging) {
        if (Math.hypot(event.clientX - p.startX, event.clientY - p.startY) < 4) return;
        p.dragging = true;
        if (map.setPointerCapture) map.setPointerCapture(event.pointerId);
        map.classList.add('is-dragging');
        hideTip();
      }
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        var unit = WIDTH / view.k / map.getBoundingClientRect().width;
        view.x -= (event.clientX - p.x) * unit;
        view.y -= (event.clientY - p.y) * unit;
        p.x = event.clientX; p.y = event.clientY;
        applyView();
      } else if (ids.length === 2) {
        var other = pointers[ids[0] === String(event.pointerId) ? ids[1] : ids[0]];
        var before = Math.hypot(p.x - other.x, p.y - other.y);
        p.x = event.clientX; p.y = event.clientY;
        var after = Math.hypot(p.x - other.x, p.y - other.y);
        var mid = toMap((p.x + other.x) / 2, (p.y + other.y) / 2);
        if (before > 0) zoomAt(after / before, mid[0], mid[1]);
      }
    });
    ['pointerup', 'pointercancel'].forEach(function (name) {
      map.addEventListener(name, function (event) {
        delete pointers[event.pointerId];
        if (!Object.keys(pointers).length) map.classList.remove('is-dragging');
      });
    });
  }

  // Earlier counts and collected page views are summed into one count per country.
  function render(live) {
    var now = Date.now(), bucket = settings.bucketMinutes * 60000;
    var totals = {}, lasts = {};
    for (var code in past) totals[code] = past[code];
    (live.countries || []).forEach(function (c) { if (c.views > 0) totals[c.code] = (totals[c.code] || 0) + c.views; });
    var recent = (live.recent || []).filter(function (r) { return r.views > 0 && points[r.code]; }).map(function (r) {
      return { code: r.code, time: Date.parse(r.time), views: r.views };
    });
    recent.forEach(function (r) { lasts[r.code] = Math.max(lasts[r.code] || 0, r.time); });
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
    hideTip();
    layer.replaceChildren();
    items.forEach(function (item) {
      var isRecent = item.last !== undefined && now - item.last < settings.recentMinutes * 60000;
      // Pulse only when a country's latest interval is new since the previous poll.
      var isFresh = isRecent && (!previous || previous[item.code] !== item.last);
      if (item.last !== undefined) seen[item.code] = item.last;
      var dot = el('g', { class: 'live-dot' + (isRecent ? ' is-recent' : '') + (isFresh ? ' is-fresh' : ''), 'data-country': item.code, 'data-name': countryName(item.code), 'data-visits': plural(item.visits, 'visit') });
      dot.setAttribute('transform', dotTransform(item.code));
      if (item.last !== undefined) dot.setAttribute('data-latest', 'Latest ' + ago(Math.max(0, now - item.last - bucket)));
      if (isRecent) {
        dot.appendChild(el('circle', { class: 'live-dot-pulse', r: item.r }));
        dot.appendChild(el('circle', { class: 'live-dot-ring', r: item.r + 2.4 }));
      }
      dot.appendChild(el('circle', { class: 'live-dot-core', r: item.r }));
      dot.appendChild(el('circle', { class: 'live-dot-hit', r: Math.max(item.r, 10) }));
      layer.appendChild(dot);
    });
    // The total also includes earlier views whose country was unknown (no dot).
    var visits = pastUnknown;
    items.forEach(function (item) { visits += item.visits; });
    total.textContent = plural(visits, 'visit') + ' · ' + plural(items.length, 'country');
    map.setAttribute('aria-label', 'World map of ' + plural(visits, 'visit') + ' from ' + plural(items.length, 'country') + '.');

    // Country and 10-minute interval only; the interval's end is used as "ago".
    recentList.replaceChildren();
    recent.slice(0, LIST_SIZE).forEach(function (r) {
      var row = html('li');
      row.append(html('span', 'visitor-map-recent-country', countryName(r.code) + (r.views > 1 ? ' ×' + r.views : '')), html('span', 'visitor-map-recent-time', ago(Math.max(0, now - r.time - bucket))));
      recentList.appendChild(row);
    });
    recentBlock.hidden = !recent.length;
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
    if (!ready) ready = Promise.all([get('assets/images/world-map.svg', 'text'), get('assets/data/search-history.json'), get('assets/data/country-points.json'), get('assets/data/analytics-config.json'), get('assets/data/mapmyvisitors-history.json')])
      .then(build)
      // Keep the static history image and retry on the next open.
      .catch(function () { ready = null; throw new Error('Map unavailable'); });
    return ready;
  }
  function start() { load().then(poll, function () {}); }

  section.addEventListener('toggle', function () { if (isOpen()) start(); else { clearTimeout(timer); hideTip(); } });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (map) poll(); } else clearTimeout(timer);
  });
  if (isOpen()) start();
}());
