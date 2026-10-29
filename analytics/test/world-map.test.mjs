import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const site = new URL('../../', import.meta.url);
const source = readFileSync(new URL('assets/js/visitor-history.js', site), 'utf8');
const files = {
  'assets/images/world-map.svg': readFileSync(new URL('assets/images/world-map.svg', site), 'utf8'),
  'assets/data/search-history.json': readFileSync(new URL('assets/data/search-history.json', site), 'utf8'),
  'assets/data/country-points.json': readFileSync(new URL('assets/data/country-points.json', site), 'utf8'),
  'assets/data/analytics-config.json': readFileSync(new URL('assets/data/analytics-config.json', site), 'utf8'),
  'assets/data/mapmyvisitors-history.json': readFileSync(new URL('assets/data/mapmyvisitors-history.json', site), 'utf8')
};
const minutes = n => new Date(Date.now() - n * 60000).toISOString();

async function settle() { for (let i = 0; i < 8; i++) await setImmediate(); }
function homepage(liveResponses = []) {
  const { document, window } = parseHTML(readFileSync(new URL('index.html', site), 'utf8'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  const requests = [], timers = [];
  const context = {
    document, URL, URLSearchParams, Intl, Date, Math, JSON, Promise, Error,
    location: { hostname: 'r-ush.github.io', href: 'https://r-ush.github.io/', search: '' },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    fetch: async (url, init) => {
      requests.push({ url, init });
      const path = new URL(url).pathname.slice(1);
      if (path === 'api/live') {
        const next = liveResponses.shift();
        if (!next) throw new Error('Network unavailable');
        return { ok: true, json: async () => next };
      }
      if (!(path in files)) return { ok: false, status: 404 };
      return { ok: true, text: async () => files[path], json: async () => JSON.parse(files[path]) };
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const section = document.getElementById('visitor-map');
  return {
    document, requests, timers, section,
    async open() { section.setAttribute('open', ''); section.dispatchEvent(new window.Event('toggle')); await settle(); },
    dot(code) { return document.querySelector('.live-dot[data-country="' + code + '"]'); },
    radius(code) { return Number(this.dot(code).querySelector('.live-dot-core').getAttribute('r')); },
    fire(target, type, init = {}) { target.dispatchEvent(Object.assign(new window.Event(type, { bubbles: true }), init)); },
    button(name) { return section.querySelector('.visitor-map-zoom button[aria-label="' + name + '"]'); }
  };
}
const sample = () => ({ bucketMinutes: 10, countries: [
  { code: 'KR', views: 69 }, { code: 'DE', views: 8 }, { code: 'US', views: 7 }, { code: 'SG', views: 3 }, { code: 'ZZ', views: 4 }
], recent: [
  { code: 'ZZ', time: minutes(1), views: 1 }, { code: 'KR', time: minutes(5), views: 2 },
  { code: 'SG', time: minutes(30), views: 1 }, { code: 'DE', time: minutes(180), views: 1 }
] });
const history = JSON.parse(files['assets/data/search-history.json']).countries;

test('the closed footer map loads nothing until it is opened', async () => {
  const page = homepage([sample()]);
  await settle();
  assert.equal(page.requests.length, 0);
  assert.ok(page.document.querySelector('.search-history-map'));
});

test('opening shows one dot per country for earlier counts plus page views, a total and recent visitors', async () => {
  const page = homepage([sample()]);
  await page.open();
  const content = page.section.querySelector('.visitor-map-content');
  assert.deepEqual([...content.children].map(n => n.className), ['visitor-world', 'visitor-map-recent']);
  assert.deepEqual([...content.children[0].children].map(n => n.getAttribute('class')), ['visitor-world-map', 'visitor-map-total', 'visitor-map-zoom', 'visitor-map-tip']);
  const svg = content.querySelector('.visitor-world svg');
  assert.equal(page.requests.find(r => r.url.endsWith('/api/live')).url, 'https://rush-analytics.r-ush.workers.dev/api/live');
  assert.equal(page.requests.every(r => r.init.credentials === 'omit'), true);
  // One visual form: countries keep the base colour and only dots carry details.
  assert.equal(svg.querySelector('path[data-country="KR"]').getAttribute('fill'), '#dce4eb');
  assert.equal(svg.querySelectorAll('title, desc').length, 0);

  const codes = [...page.document.querySelectorAll('.live-dot')].map(d => d.getAttribute('data-country')).sort();
  assert.deepEqual(codes, [...new Set([...history.map(c => c.code), 'DE'])].sort());
  const detail = code => [page.dot(code).getAttribute('data-name'), page.dot(code).getAttribute('data-visits'), page.dot(code).getAttribute('data-latest')];
  // Search clicks + MapMyVisitors before collection + collected views (KR 102 + 18 + 69).
  assert.deepEqual(detail('KR'), ['South Korea', '189 visits', 'Latest just now']);
  assert.deepEqual(detail('US'), ['United States', '43 visits', null]);
  assert.deepEqual(detail('DE'), ['Germany', '9 visits', 'Latest 2 h ago']);
  assert.deepEqual(detail('AT'), ['Austria', '1 visit', null]);
  // 134 clicks + 104 earlier views (55 without a country) + 87 drawable collected views.
  assert.equal(page.section.querySelector('.visitor-map-total').textContent, '325 visits · 16 countries');
  assert.equal(svg.getAttribute('aria-label'), 'World map of 325 visits from 16 countries.');

  // Korea is scaled down for display only, so other countries get larger dots.
  assert.equal(page.radius('KR'), 11);
  assert.ok(Math.abs(page.radius('DE') - (4.5 + 6.5 * Math.sqrt(9 / (189 * 0.3)))) < 1e-9);
  assert.ok(page.radius('DE') > 4.5 + 6.5 * Math.sqrt(9 / 189));
  assert.match(page.dot('KR').getAttribute('class'), /is-recent is-fresh/);
  assert.match(page.dot('SG').getAttribute('class'), /is-recent is-fresh/);
  assert.equal(page.dot('DE').getAttribute('class'), 'live-dot');

  // Recent visitors: country and interval only, newest first, unknown codes skipped.
  const rows = [...page.section.querySelectorAll('.visitor-map-recent-list li')].map(li => [...li.children].map(n => n.textContent));
  assert.deepEqual(rows, [['South Korea ×2', 'just now'], ['Singapore', '20 min ago'], ['Germany', '2 h ago']]);
  assert.equal(page.section.querySelector('.visitor-map-recent').hidden, false);
  assert.deepEqual(page.timers.map(t => t.ms), [60000]);
});

test('hovering or tapping a dot shows its country and visits', async () => {
  const page = homepage([sample()]);
  await page.open();
  const tip = page.section.querySelector('.visitor-map-tip');
  assert.equal(tip.hidden, true);
  page.fire(page.dot('KR').querySelector('.live-dot-core'), 'pointerover');
  assert.equal(tip.hidden, false);
  assert.deepEqual([...tip.children].map(n => n.textContent), ['South Korea', '189 visits', 'Latest just now']);
  page.fire(page.dot('KR').querySelector('.live-dot-core'), 'pointerout', { relatedTarget: null });
  assert.equal(tip.hidden, true);
  page.fire(page.dot('AT').querySelector('.live-dot-hit'), 'click');
  assert.deepEqual([...tip.children].map(n => n.textContent), ['Austria', '1 visit']);
  page.fire(page.section.querySelector('path[data-country="BR"]'), 'click');
  assert.equal(tip.hidden, true);
});

test('zoom buttons change the view while dots keep their screen size', async () => {
  const page = homepage([sample()]);
  await page.open();
  const svg = page.section.querySelector('.visitor-world svg');
  const reset = page.button('Reset map');
  assert.equal(reset.hidden, true);
  page.fire(page.button('Zoom out'), 'click');
  assert.equal(svg.getAttribute('viewBox'), '0 0 720 300');
  page.fire(page.button('Zoom in'), 'click');
  assert.equal(svg.getAttribute('viewBox'), '180 75 360 150');
  assert.match(page.dot('KR').getAttribute('transform'), /scale\(0\.5\)$/);
  assert.match(svg.getAttribute('class'), /is-zoomed/);
  assert.equal(reset.hidden, false);
  for (let i = 0; i < 4; i++) page.fire(page.button('Zoom in'), 'click');
  assert.equal(svg.getAttribute('viewBox').split(' ')[2], '90');
  page.fire(reset, 'click');
  assert.equal(svg.getAttribute('viewBox'), '0 0 720 300');
  assert.match(page.dot('KR').getAttribute('transform'), /scale\(1\)$/);
  assert.equal(reset.hidden, true);
});

test('polling pulses only countries with a new latest interval', async () => {
  const first = sample(), second = structuredClone(first), third = structuredClone(first);
  third.recent.unshift({ code: 'KR', time: minutes(0), views: 1 });
  const page = homepage([first, second, third]);
  await page.open();
  assert.match(page.dot('KR').getAttribute('class'), /is-fresh/);
  page.timers.shift().fn(); await settle();
  assert.equal(page.dot('KR').getAttribute('class'), 'live-dot is-recent');
  assert.equal(page.dot('SG').getAttribute('class'), 'live-dot is-recent');
  page.timers.shift().fn(); await settle();
  assert.match(page.dot('KR').getAttribute('class'), /is-fresh/);
  assert.equal(page.dot('SG').getAttribute('class'), 'live-dot is-recent');
});

test('a live outage still shows the earlier counts and keeps polling', async () => {
  const page = homepage([]);
  await page.open();
  assert.equal(page.document.querySelectorAll('.live-dot').length, history.length + 1);
  assert.equal(page.document.querySelector('.live-dot.is-recent'), null);
  assert.equal(page.dot('KR').getAttribute('data-visits'), '120 visits');
  assert.equal(page.dot('DE').getAttribute('data-visits'), '1 visit');
  assert.equal(page.section.querySelector('.visitor-map-total').textContent, '238 visits · 16 countries');
  assert.equal(page.section.querySelector('.visitor-map-recent').hidden, true);
  assert.equal(page.timers.length, 1);
});
