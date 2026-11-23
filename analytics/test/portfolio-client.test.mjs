import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';

const source = readFileSync(new URL('../../portfolio/analytics.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../portfolio/index.html', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../../portfolio/analytics-config.json', import.meta.url), 'utf8'));
async function browser(options = {}) {
  const { document, window } = parseHTML(html);
  let now = 0; const requests = [], timers = [], events = {}, storage = new Map();
  document.visibilityState = options.hidden ? 'hidden' : 'visible'; document.hasFocus = () => true;
  document.currentScript = { src: 'https://r-ush.github.io/portfolio/analytics.js' };
  if (options.optout) storage.set('rush-analytics-disabled', '1');
  const context = { document, Event: window.Event, MutationObserver: window.MutationObserver, URL, crypto, console,
    navigator: { userAgent: 'Mozilla/5.0 Chrome', globalPrivacyControl: !!options.gpc, doNotTrack: options.dnt ? '1' : '0' },
    location: { hostname: 'r-ush.github.io', pathname: '/portfolio/', href: 'https://r-ush.github.io/portfolio/?private=query' },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    performance: { now: () => now }, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval: fn => { timers.push(fn); },
    addEventListener: (name, fn) => { (events[name] ||= []).push(fn); }, dispatchEvent: event => { events[event.type]?.forEach(fn => fn(event)); },
    fetch: async (url, init) => { requests.push({ url: String(url), init }); return { ok: true, json: async () => config }; }
  };
  context.window = context; context.top = options.embedded ? {} : context; context.self = context;
  vm.runInNewContext(source, context); await setImmediate();
  const fire = (name, detail = {}) => events[name]?.forEach(fn => fn(detail));
  return { document, window, requests, storage, context, fire,
    tick(seconds = 1) { now += seconds * 1000; for (const fn of [...timers]) fn(); },
    batches() { return requests.filter(r => r.init?.method === 'POST').map(r => JSON.parse(r.init.body)); },
    events() { return this.batches().flatMap(b => b.events); }
  };
}
test('portfolio measurement sends only known content, no cookies, queries or persistent tracking ID', async () => {
  const b = await browser(); for (let i = 0; i < 4; i++) b.tick();
  assert.equal(b.events().filter(e => e.type === 'view').length, 1);
  assert.equal(b.events().find(e => e.type === 'view').target, 'cover');
  assert.equal(b.storage.size, 0);
  for (const request of b.requests.filter(r => r.init?.method === 'POST')) {
    assert.equal(request.init.credentials, 'omit'); assert.equal(request.init.referrerPolicy, 'no-referrer');
    assert.equal(request.init.body.includes('private=query'), false);
    assert.match(JSON.parse(request.init.body).visit, /^[a-f0-9]{32}$/);
  }
  assert.equal(b.requests.some(r => /mapmyvisitors/.test(r.url)), false);
  const next = await browser(); assert.notEqual(b.batches()[0].visit, next.batches()[0].visit);
});
test('privacy signals, exclusion and embedded loads do not transmit tracking requests', async () => {
  for (const options of [{ gpc: true }, { dnt: true }, { optout: true }, { embedded: true }]) {
    const b = await browser(options); b.tick(); assert.equal(b.requests.length, 0);
  }
  const b = await browser(); b.document.querySelector('.portfolio-privacy button').click();
  const count = b.batches().length; b.tick(5); assert.equal(b.batches().length, count);
  assert.equal(b.storage.get('rush-analytics-disabled'), '1');
});
test('hidden pages wait, downloads are identified, and idle time does not keep accumulating', async () => {
  const b = await browser({ hidden: true }); b.tick(); assert.equal(b.events().length, 0);
  b.document.visibilityState = 'visible'; b.document.dispatchEvent(new b.window.Event('visibilitychange')); await setImmediate();
  assert.equal(b.events().filter(e => e.type === 'view').length, 1);
  b.document.getElementById('cv-download-ko').click(); b.tick();
  assert.equal(b.events().some(e => e.type === 'download' && e.target === 'cv-ko'), true);
  for (let i = 0; i < 65; i++) b.tick();
  const before = b.events().filter(e => e.type === 'read').reduce((n, e) => n + e.seconds, 0);
  b.tick(30); const after = b.events().filter(e => e.type === 'read').reduce((n, e) => n + e.seconds, 0);
  assert.equal(before, after); assert.ok(after <= 60);
});
test('portfolio dashboard authenticates in memory, labels examples, and renders empty records', async () => {
  const { document, window } = parseHTML(readFileSync(new URL('../public/portfolio.html', import.meta.url), 'utf8'));
  const requests = [], context = { document, Intl, Date, Blob, URL, setTimeout, fetch: async (...args) => { requests.push(args); return { ok: false, status: 401 }; } };
  Object.defineProperty(context, 'localStorage', { get() { throw Error('No persistent credentials'); } });
  vm.runInNewContext(readFileSync(new URL('../public/portfolio.js', import.meta.url), 'utf8'), context);
  document.getElementById('token').value = 'test-key'; document.getElementById('login-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await setImmediate();
  assert.equal(document.getElementById('report').hidden, true);
  assert.equal(document.getElementById('token').value, '');
  assert.equal(requests[0][1].headers.Authorization, 'Bearer test-key');
  document.getElementById('demo').click(); await setImmediate();
  assert.equal(document.getElementById('demo-notice').hidden, false);
  assert.equal(document.querySelectorAll('.visit').length, 1);
  assert.match(document.getElementById('visits').textContent, /192\.0\.2\.10 \(예시\)/);
  document.getElementById('logout').click(); assert.equal(document.getElementById('report').hidden, true);
});
test('research changes, source previews and deliberate video controls record specific content', async () => {
  const b = await browser();
  b.document.getElementById('page-count').textContent = '06 / 11';
  b.document.getElementById('page-title').textContent = 'PALM-Gripper';
  await setImmediate(); b.tick();
  assert.equal(b.events().some(e => e.type === 'view' && e.target === 'palm-gripper'), true);
  const wrapper = b.document.createElement('div'); wrapper.className = 'research-player';
  const video = b.document.createElement('video'); video.dataset.src = Object.values(config.videos)[0].replace(/^\//, ''); video.paused = false; video.currentTime = 0; video.duration = 10;
  const button = b.document.createElement('button'); button.className = 'media-toggle';
  const seek = b.document.createElement('input'); seek.className = 'media-seek';
  wrapper.append(video, button, seek); b.document.getElementById('page-frame').append(wrapper); await setImmediate();
  video.dispatchEvent(new b.window.Event('play')); b.tick();
  assert.equal(b.events().some(e => e.type === 'video-play'), false, 'autoplay is not a deliberate start');
  video.paused = true; button.click(); b.tick();
  assert.equal(b.events().some(e => e.type === 'video-play' && e.target === Object.keys(config.videos)[0]), true);
  seek.dispatchEvent(new b.window.Event('change', { bubbles: true })); b.tick();
  assert.equal(b.events().some(e => e.type === 'video-seek'), true);
  const bundle = JSON.parse(b.document.getElementById('deck-data').textContent);
  const proof = bundle.pages[5].evidence[0];
  const title = b.document.createElement('h2'); title.id = 'evidence-title'; title.textContent = proof.title;
  b.document.getElementById('evidence-panel').hidden = false; b.document.getElementById('evidence-body').append(title);
  await setImmediate(); b.tick(2); b.tick();
  assert.equal(b.events().some(e => e.type === 'source' && e.target === proof.id), true);
  b.context.PortfolioLanguage = 'en'; b.document.getElementById('page-title').textContent = 'English PALM'; await setImmediate(); b.tick();
  assert.equal(b.events().some(e => e.type === 'language' && e.target === 'en'), true);
});
