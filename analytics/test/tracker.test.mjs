import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

const source = readFileSync(new URL('../../assets/js/visitor-map.js', import.meta.url), 'utf8');
const baseConfig = JSON.parse(readFileSync(new URL('../../assets/data/analytics-config.json', import.meta.url), 'utf8'));
async function browser(options = {}) {
  let time = 0;
  const requests = [], pixels = [], timers = [], winEvents = {}, docEvents = {}, storage = new Map();
  if (options.optout) storage.set('rush-analytics-disabled', '1');
  const on = map => (name, fn) => { (map[name] ||= []).push(fn); };
  const doc = {
    currentScript: { src: 'https://r-ush.github.io/assets/js/visitor-map.js', hasAttribute: () => false },
    querySelector: () => ({}), body: { scrollHeight: 4000, appendChild: el => pixels.push(el) }, documentElement: { scrollHeight: 4000 },
    createElement: () => ({ style: {}, setAttribute() {} }),
    visibilityState: options.hidden ? 'hidden' : 'visible', readyState: 'complete', hasFocus: () => true,
    referrer: 'https://www.google.com/search?q=private+search', addEventListener: on(docEvents)
  };
  const context = {
    URL, WeakSet, console, document: doc, navigator: { userAgent: 'Mozilla Chrome/130.0', doNotTrack: options.dnt ? '1' : '0', globalPrivacyControl: options.gpc || false, webdriver: false },
    location: { hostname: options.hostname || 'r-ush.github.io', origin: 'https://r-ush.github.io', pathname: options.path || '/', href: 'https://r-ush.github.io/?email=private#secret' },
    localStorage: { getItem: k => storage.get(k) || null },
    performance: { now: () => time, getEntriesByType: () => [{ loadEventEnd: 800, responseStart: 120 }] },
    innerHeight: 1000, scrollY: 0, addEventListener: on(winEvents),
    setTimeout: fn => { Promise.resolve().then(fn); return 1; },
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval() {}, requestAnimationFrame: fn => fn(),
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (options.configFailure && !init?.method) throw new Error('Config unavailable');
      return { ok: true, json: async () => ({ ...baseConfig, endpoint: options.unconfigured ? '' : 'https://metrics.example/collect' }) };
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  await setImmediate();
  return { context, doc, requests, pixels, storage, tick(seconds = 5) { time += seconds * 1000; timers.forEach(fn => fn()); }, fire(name, event = {}, target = 'window') { (target === 'window' ? winEvents : docEvents)[name]?.forEach(fn => fn(event)); }, events() { return requests.filter(r => r.init?.method === 'POST').flatMap(r => JSON.parse(r.init.body).events); } };
}

test('public counter and private collector both run once on homepage and project pages', async () => {
  for (const path of ['/', '/scooping_robotic_hand/']) {
    const b = await browser({ path });
    b.fire('visibilitychange', {}, 'document'); b.fire('pageshow');
    vm.runInNewContext(source, b.context);
    assert.equal(b.pixels.length, 1);
    assert.equal(new URL(b.pixels[0].src).searchParams.get('d'), 'fGQkHeJjD2q20QiECdFcDFPfH3JNP_cewlyjRrwjAf4');
    assert.equal(b.pixels[0].referrerPolicy, 'no-referrer');
    assert.equal(b.events().filter(e => e.type === 'view').length, 1);
  }
});

test('public counter survives private configuration failure but respects privacy and visibility', async () => {
  for (const options of [{ unconfigured: true }, { configFailure: true }]) {
    const b = await browser(options);
    assert.equal(b.pixels.length, 1); assert.equal(b.events().length, 0);
  }
  for (const options of [{ optout: true }, { dnt: true }, { gpc: true }, { hostname: 'localhost' }]) {
    const b = await browser(options); assert.equal(b.pixels.length, 0);
  }
  const b = await browser({ hidden: true });
  assert.equal(b.pixels.length, 0);
  b.doc.visibilityState = 'visible'; b.fire('visibilitychange', {}, 'document');
  assert.equal(b.pixels.length, 1);
});

test('client sends no identifiers, queries, raw referrers or cookies and counts one initial view', async () => {
  const b = await browser(); b.tick(); b.fire('pageshow'); b.tick();
  const views = b.events().filter(e => e.type === 'view');
  assert.equal(views.length, 1); assert.equal(views[0].source, 'Google');
  for (const req of b.requests.filter(r => r.init?.method === 'POST')) {
    assert.equal(req.init.credentials, 'omit'); assert.equal(req.init.referrerPolicy, 'no-referrer');
    for (const forbidden of ['private', 'visitor_id', 'session_id', 'userAgent']) assert.equal(req.init.body.includes(forbidden), false);
  }
  assert.equal(b.storage.size, 0);
});

test('privacy choices, unconfigured endpoints, local previews and unknown pages fail closed', async () => {
  for (const options of [{ optout: true }, { dnt: true }, { gpc: true }, { hostname: 'localhost' }, { unconfigured: true }, { path: '/secret-path/' }]) {
    const b = await browser(options); b.tick(); assert.equal(b.events().length, 0);
  }
});

test('hidden tabs wait for visibility and stop counting active time when hidden or idle', async () => {
  const b = await browser({ hidden: true });
  b.tick(); assert.equal(b.events().length, 0);
  b.doc.visibilityState = 'visible'; b.fire('visibilitychange', {}, 'document');
  for (let i = 0; i < 24; i++) b.tick();
  b.doc.visibilityState = 'hidden'; b.fire('visibilitychange', {}, 'document');
  const seconds = b.events().filter(e => e.type === 'engagement').reduce((sum, e) => sum + e.seconds, 0);
  assert.equal(seconds, 60);
  const before = b.events().length; for (let i = 0; i < 12; i++) b.tick();
  assert.equal(b.events().length, before);
  assert.equal(b.events().filter(e => e.type === 'engagement' && e.engaged).length, 1);
});

test('opt-out in another tab drops pending events immediately', async () => {
  const b = await browser(); const before = b.events().length;
  b.storage.set('rush-analytics-disabled', '1'); b.fire('storage', { key: 'rush-analytics-disabled', newValue: '1' });
  b.tick(); b.fire('pagehide'); assert.equal(b.events().length, before);
});

test('scroll milestones are once per page and clicks contain semantic categories only', async () => {
  const b = await browser();
  b.context.scrollY = 3000; b.fire('scroll'); b.fire('scroll'); b.tick();
  assert.deepEqual(b.events().filter(e => e.type === 'scroll').map(e => e.depth).sort((a, c) => a - c), [25, 50, 75, 100]);
  const anchor = { getAttribute: () => 'mailto:private@example.com?subject=secret', hasAttribute: () => false };
  b.fire('click', { target: { closest: selector => selector === 'a[href]' ? anchor : null } }, 'document');
  assert.deepEqual(b.events().find(e => e.type === 'click'), { type: 'click', page: '/', target: 'Email', kind: 'email' });
});
