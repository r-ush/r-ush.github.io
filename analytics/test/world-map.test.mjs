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
  'assets/data/analytics-config.json': readFileSync(new URL('assets/data/analytics-config.json', site), 'utf8')
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
    radius(code) { return Number(this.dot(code).querySelector('.live-dot-core').getAttribute('r')); }
  };
}
const sample = () => ({ recentMinutes: 60, countries: [
  { code: 'KR', views: 69, last: minutes(5) }, { code: 'DE', views: 8 }, { code: 'US', views: 7 },
  { code: 'SG', views: 3, last: minutes(30) }, { code: 'ZZ', views: 4, last: minutes(1) }
] });
const history = JSON.parse(files['assets/data/search-history.json']).countries;

test('the closed footer map loads nothing until it is opened', async () => {
  const page = homepage([sample()]);
  await settle();
  assert.equal(page.requests.length, 0);
  assert.ok(page.document.querySelector('.search-history-map'));
});

test('opening shows only the map: one dot per country for search clicks plus page views', async () => {
  const page = homepage([sample()]);
  await page.open();
  const content = page.section.querySelector('.visitor-map-content');
  // Only the map: no legend, status or note paragraphs.
  assert.deepEqual([...content.children].map(n => n.className), ['visitor-world']);
  assert.deepEqual([...content.children[0].children].map(n => n.tagName.toLowerCase()), ['svg']);
  const svg = content.querySelector('.visitor-world svg');
  assert.ok(svg);
  assert.equal(page.requests.find(r => r.url.endsWith('/api/live')).url, 'https://rush-analytics.r-ush.workers.dev/api/live');
  assert.equal(page.requests.every(r => r.init.credentials === 'omit'), true);
  // No separate choropleth layer: countries keep the base map colour.
  assert.equal(svg.querySelector('path[data-country="KR"]').getAttribute('fill'), '#dce4eb');

  const codes = [...page.document.querySelectorAll('.live-dot')].map(d => d.getAttribute('data-country')).sort();
  assert.deepEqual(codes, [...new Set([...history.map(c => c.code), 'DE'])].sort());
  const title = code => page.dot(code).querySelector('title').textContent;
  assert.equal(title('KR'), 'South Korea: 171 visits');
  assert.equal(title('US'), 'United States: 13 visits');
  assert.equal(title('DE'), 'Germany: 8 visits');
  assert.equal(title('AT'), 'Austria: 1 visit');

  // Korea is scaled down for display only, so other countries get larger dots.
  assert.equal(page.radius('KR'), 11);
  assert.ok(Math.abs(page.radius('DE') - (4.5 + 6.5 * Math.sqrt(8 / (171 * 0.3)))) < 1e-9);
  assert.ok(page.radius('DE') > 4.5 + 6.5 * Math.sqrt(8 / 171));
  assert.match(page.dot('KR').getAttribute('class'), /is-recent is-fresh/);
  assert.match(page.dot('SG').getAttribute('class'), /is-recent is-fresh/);
  assert.equal(page.dot('US').getAttribute('class'), 'live-dot');
  assert.equal(svg.getAttribute('aria-label'), 'World map of 221 visits from 16 countries.');
  assert.deepEqual(page.timers.map(t => t.ms), [60000]);
});

test('polling pulses only countries with a new latest interval', async () => {
  const first = sample(), second = structuredClone(first), third = structuredClone(first);
  third.countries[0].last = minutes(0);
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

test('a live outage still shows search-history dots and keeps polling', async () => {
  const page = homepage([]);
  await page.open();
  assert.equal(page.document.querySelectorAll('.live-dot').length, history.length);
  assert.equal(page.document.querySelector('.live-dot.is-recent'), null);
  assert.equal(page.dot('KR').querySelector('title').textContent, 'South Korea: 102 visits');
  assert.equal(page.section.querySelectorAll('.visitor-map-content p').length, 0);
  assert.equal(page.timers.length, 1);
});
