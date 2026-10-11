import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { cleanup } from '../src/worker.mjs';
import { aggregate, dateParts, normalizePage, persist, report, validateBatch } from '../src/metrics.mjs';
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
