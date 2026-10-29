import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { cleanup } from '../src/worker.mjs';
import { aggregate, dateParts, liveBucket, normalizePage, persist, report, validateBatch } from '../src/metrics.mjs';
import { createDatabase } from './database.mjs';

const token = 'test-only-admin-key-never-use-in-production-123456';
function env() { return { DB: createDatabase(), ADMIN_TOKEN: token, ASSETS: { fetch: async () => new Response('dashboard') } }; }
function request(events, overrides = {}) {
  const req = new Request('https://metrics.example/collect', { method: 'POST', headers: { Origin: 'https://r-ush.github.io', 'User-Agent': 'Mozilla/5.0 Windows Chrome/130.0', ...overrides.headers }, body: JSON.stringify({ v: 1, events }), ...overrides });
  Object.defineProperty(req, 'cf', { value: { country: 'KR', regionCode: '11', city: 'Never stored', latitude: '37.5' } });
  return req;
}
const view = { type: 'view', page: '/', source: 'Google' };

test('requests immediately become independent aggregates, never raw event rows', async () => {
  const e = env();
  for (let i = 0; i < 3; i++) assert.equal((await worker.fetch(request([view]), e)).status, 204);
  const rows = e.DB.sqlite.prepare('SELECT * FROM daily_metrics').all();
  assert.equal(rows.find(r => r.dimension === 'total').value, 3);
  assert.equal(rows.find(r => r.dimension === 'country').label, 'KR');
  assert.equal(rows.find(r => r.dimension === 'region').label, 'KR-11');
  assert.deepEqual(Object.keys(rows[0]), ['day', 'dimension', 'label', 'metric', 'value']);
  const text = JSON.stringify(rows);
  for (const forbidden of ['Mozilla', 'Chrome/130', 'Never stored', '37.5', 'visitor_id', 'session_id']) assert.equal(text.includes(forbidden), false);
  assert.equal(rows.length, 9);
});

test('unknown identifying fields, arbitrary URLs and malformed measurements are rejected', async () => {
  const e = env();
  for (const event of [{ ...view, visitor_id: 'secret' }, { ...view, page: '/?email=secret' }, { ...view, source: 'https://private.example/search?q=secret' }, { type: 'engagement', page: '/', seconds: -1, engaged: false }, { type: 'engagement', page: '/', seconds: 61, engaged: true }, { type: 'click', page: '/', kind: 'email', target: 'person@example.com' }, { type: 'scroll', page: '/', depth: 101 }]) assert.equal((await worker.fetch(request([event]), e)).status, 400);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_metrics').get().n, 0);
  assert.equal(normalizePage('/scooping_robotic_hand/rl/index.html'), '/scooping_robotic_hand/rl/');
  assert.equal(normalizePage('/scooping_robotic_hand/rl/rollouts/ep123/'), null);
  assert.throws(() => validateBatch({ v: 1, events: [view], session: 'x' }));
});

test('CORS, bots, privacy signals, oversized bodies and rate limiting are enforced', async () => {
  const e = env();
  for (const headers of [{ Origin: 'https://evil.example' }, {}]) assert.equal((await worker.fetch(request([view], { headers }), e)).status, 403);
  for (const headers of [{ Origin: 'https://r-ush.github.io', DNT: '1' }, { Origin: 'https://r-ush.github.io', 'Sec-GPC': '1' }, { Origin: 'https://r-ush.github.io', 'User-Agent': 'Googlebot' }]) assert.equal((await worker.fetch(request([view], { headers }), e)).status, 204);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_metrics').get().n, 0);
  const large = new Request('https://metrics.example/collect', { method: 'POST', headers: { Origin: 'https://r-ush.github.io' }, body: 'x'.repeat(9000) });
  assert.equal((await worker.fetch(large, e)).status, 400);
  e.INGEST_LIMIT = { limit: async ({ key }) => { assert.equal(key, 'aggregate-ingest'); return { success: false }; } };
  assert.equal((await worker.fetch(request([view]), e)).status, 429);
});

test('stats and all export data require an admin secret, with no browser credential storage', async () => {
  const e = env();
  for (const key of ['', 'incorrect', 'test-only']) assert.equal((await worker.fetch(new Request('https://metrics.example/api/stats', { headers: { Authorization: 'Bearer ' + key } }), e)).status, 401);
  const response = await worker.fetch(new Request('https://metrics.example/api/stats?days=7', { headers: { Authorization: 'Bearer ' + token } }), e);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await response.json()).series.length, 7);
  assert.equal((await worker.fetch(new Request('https://metrics.example/api/stats?days=999', { headers: { Authorization: 'Bearer ' + token } }), e)).status, 400);
  assert.equal((await worker.fetch(new Request('https://metrics.example/api/stats', { headers: { Authorization: 'Bearer ' + token } }), { ...e, ADMIN_TOKEN: '' })).status, 401);
});

test('engagement, scroll, clicks, video and performance sum correctly', async () => {
  const e = env();
  const events = validateBatch({ v: 1, events: [view, { type: 'engagement', page: '/', seconds: 20, engaged: true }, { type: 'engagement', page: '/', seconds: 15, engaged: false }, { type: 'scroll', page: '/', depth: 50 }, { type: 'click', page: '/', target: 'CV', kind: 'download' }, { type: 'video', page: '/', action: 'play' }, { type: 'video', page: '/', action: 'complete' }, { type: 'section', page: '/', section: 'research' }, { type: 'performance', page: '/', load: 800, ttfb: 150 }] });
  const now = new Date('2026-10-12T16:00:00Z');
  await persist(e.DB, aggregate(events, request([view]), now));
  const output = report(e.DB.sqlite.prepare('SELECT * FROM daily_metrics').all(), 7, now);
  assert.equal(output.to, '2026-10-13');
  assert.equal(output.totals.views, 1);
  assert.equal(output.totals.active_seconds, 35);
  assert.equal(output.totals.engaged_views, 1);
  assert.equal(output.totals.downloads, 1);
  assert.equal(output.totals.scroll_50, 1);
  assert.equal(output.totals.video_completions, 1);
  assert.equal(output.totals.load_ms, 800);
  assert.equal(output.totals.performance_samples, 1);
  assert.equal(output.breakdowns.country[0].label, 'Other / low volume');
  assert.equal(output.pages[0].views, 1);
});

test('KST boundaries, empty dates and automatic retention cleanup', async () => {
  assert.equal(dateParts(new Date('2026-10-12T14:59:59Z')).day, '2026-10-12');
  assert.equal(dateParts(new Date('2026-10-12T15:00:00Z')).day, '2026-10-13');
  const e = env();
  await persist(e.DB, [{ day: '2020-01-01', dimension: 'total', label: 'all', metric: 'views', value: 10 }, { day: '2026-10-12', dimension: 'total', label: 'all', metric: 'views', value: 5 }]);
  await cleanup(e, new Date('2026-10-12T00:00:00Z'));
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_metrics').get().n, 1);
  assert.deepEqual(report([], 7).series.map(r => r.views), [0, 0, 0, 0, 0, 0, 0]);
});

test('static dashboard gets security headers and collection errors disclose no internals', async () => {
  const e = env();
  const page = await worker.fetch(new Request('https://metrics.example/'), e);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  const bad = await worker.fetch(request([view]), { ...e, DB: { prepare() { throw new Error('private credentials'); } } });
  assert.equal(bad.status, 503);
  assert.equal((await bad.text()).includes('private credentials'), false);
});

function visit(country, events = [view], headers = {}) {
  const req = new Request('https://metrics.example/collect', { method: 'POST', headers: { Origin: 'https://r-ush.github.io', 'User-Agent': 'Mozilla/5.0 Windows Chrome/130.0', ...headers }, body: JSON.stringify({ v: 1, events }) });
  Object.defineProperty(req, 'cf', { value: { country, regionCode: 'BY', city: 'Never stored', latitude: '48.1', longitude: '11.6', postalCode: '80331' } });
  return req;
}
const live = (e, headers = {}) => worker.fetch(new Request('https://metrics.example/api/live', { headers }), e);

test('views add country-only live buckets; other events, unknown countries and bots do not', async () => {
  const e = env();
  assert.equal((await worker.fetch(visit('DE', [view, view]), e)).status, 204);
  for (const req of [visit('DE', [{ type: 'scroll', page: '/', depth: 50 }]), visit('XX'), visit('T1'), visit('', [view]), visit('US', [view], { 'User-Agent': 'Googlebot' }), visit('US', [view], { DNT: '1' })]) assert.equal((await worker.fetch(req, e)).status, 204);
  const rows = e.DB.sqlite.prepare('SELECT * FROM live_country').all();
  assert.deepEqual(rows.map(r => [r.country, r.views]), [['DE', 2]]);
  assert.deepEqual(e.DB.sqlite.prepare('SELECT * FROM country_totals').all().map(r => [r.country, r.views]), [['DE', 2]]);
  assert.deepEqual(Object.keys(rows[0]), ['bucket', 'country', 'views']);
  assert.equal(rows[0].bucket % 600, 0);
  const text = JSON.stringify(rows);
  for (const forbidden of ['BY', 'Never stored', '48.1', '11.6', '80331', 'Mozilla']) assert.equal(text.includes(forbidden), false);
});

test('public live map lists all-time country totals, including single views, and the last day of visits', async () => {
  const e = env();
  const now = Math.floor(Date.now() / 600000) * 600;
  e.DB.sqlite.exec("INSERT INTO country_totals VALUES ('KR', 40), ('FI', 1), ('XZ', 0)");
  await persist(e.DB, [], [{ bucket: now, country: 'KR', views: 2 }, { bucket: now - 7200, country: 'SG', views: 1 }, { bucket: now - 25 * 3600, country: 'DE', views: 1 }]);
  const response = await live(e, { Origin: 'https://r-ush.github.io' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://r-ush.github.io');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=30');
  assert.equal(response.headers.get('set-cookie'), null);
  const body = await response.json();
  // No small-count merging; the list holds only the last 24 hours, newest first.
  assert.deepEqual(body.countries, [{ code: 'KR', views: 42 }, { code: 'DE', views: 1 }, { code: 'FI', views: 1 }, { code: 'SG', views: 1 }]);
  assert.deepEqual(body.recent, [{ code: 'KR', time: new Date(now * 1000).toISOString(), views: 2 }, { code: 'SG', time: new Date((now - 7200) * 1000).toISOString(), views: 1 }]);
  assert.equal(body.bucketMinutes, 10);
  assert.equal((await live(e, { Origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
  assert.equal((await worker.fetch(new Request('https://metrics.example/api/live', { method: 'POST', body: '{}' }), e)).status, 405);
  // A new view invalidates this isolate's short cache.
  await worker.fetch(visit('SG'), e);
  const updated = await (await live(e)).json();
  assert.equal(updated.countries.find(c => c.code === 'SG').views, 2);
  assert.equal(updated.recent.filter(r => r.code === 'SG').reduce((n, r) => n + r.views, 0), 2);
  assert.equal((await live({ ...e, DB: { prepare() { throw new Error('private credentials'); } } })).status, 503);
});

test('cleanup deletes day-old recent buckets but keeps all-time country totals', async () => {
  const e = env();
  const now = new Date('2026-10-29T12:00:00Z');
  await persist(e.DB, [{ day: '2020-01-01', dimension: 'country', label: 'FR', metric: 'views', value: 1 }], [{ bucket: liveBucket(new Date('2026-10-28T11:00:00Z')), country: 'FR', views: 1 }, { bucket: liveBucket(new Date('2026-10-28T13:00:00Z')), country: 'DE', views: 1 }]);
  await cleanup(e, now);
  assert.deepEqual(e.DB.sqlite.prepare('SELECT country FROM live_country').all().map(r => r.country), ['DE']);
  assert.equal(e.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM daily_metrics WHERE label = 'FR'").get().n, 0);
  assert.deepEqual(e.DB.sqlite.prepare('SELECT * FROM country_totals ORDER BY country').all().map(r => [r.country, r.views]), [['DE', 1], ['FR', 1]]);
});

test('views add site-wide day totals that outlive retention, including unknown countries', async () => {
  const e = env();
  await worker.fetch(visit('DE', [view, view, { type: 'scroll', page: '/', depth: 50 }]), e);
  await worker.fetch(visit('', [view]), e);
  await worker.fetch(visit('US', [view], { 'User-Agent': 'Googlebot' }), e);
  const today = dateParts().day;
  assert.deepEqual(e.DB.sqlite.prepare('SELECT * FROM daily_totals').all().map(r => [r.day, r.views]), [[today, 3]]);
  e.DB.sqlite.exec("INSERT INTO daily_totals VALUES ('2020-01-01', 5), ('2020-01-02', 0)");
  await cleanup(e);
  const body = await (await live(e)).json();
  assert.deepEqual(body.daily, [{ day: '2020-01-01', views: 5 }, { day: today, views: 3 }]);
});

test('the day-total migration seeds every collected day from daily totals only', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_aggregate_metrics.sql', import.meta.url), 'utf8'));
  const insert = db.prepare('INSERT INTO daily_metrics VALUES (?,?,?,?,?)');
  for (const [day, dimension, label, metric, value] of [['2026-10-12', 'total', 'all', 'views', 10], ['2026-10-13', 'total', 'all', 'views', 4], ['2026-10-13', 'total', 'all', 'clicks', 9], ['2026-10-13', 'page', '/', 'views', 4]]) insert.run(day, dimension, label, metric, value);
  db.exec(readFileSync(new URL('../migrations/0003_daily_totals.sql', import.meta.url), 'utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM daily_totals ORDER BY day').all().map(r => [r.day, r.views]), [['2026-10-12', 10], ['2026-10-13', 4]]);
});

test('the public map migration seeds all-time totals from every collected daily country total', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_aggregate_metrics.sql', import.meta.url), 'utf8'));
  const insert = db.prepare('INSERT INTO daily_metrics VALUES (?,?,?,?,?)');
  for (const [day, dimension, label, value] of [['2026-10-12', 'country', 'DE', 6], ['2026-10-29', 'country', 'DE', 2], ['2026-10-29', 'country', 'KR', 1], ['2026-10-29', 'country', 'Unknown', 3], ['2026-10-29', 'region', 'DE-BY', 8]]) insert.run(day, dimension, label, 'views', value);
  db.exec(readFileSync(new URL('../migrations/0002_public_map.sql', import.meta.url), 'utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM country_totals ORDER BY country').all().map(r => [r.country, r.views]), [['DE', 8], ['KR', 1]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM live_country').get().n, 0);
});
