import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './database.mjs';
import worker from '../src/worker.mjs';
import { cleanupPortfolio, persistPortfolio, portfolioReport, validatePortfolio } from '../src/portfolio.mjs';

const key = 'test-only-portfolio-administrator-key-123456789';
const batch = { v: 1, visit: 'a'.repeat(32), path: '/portfolio/', events: [{ type: 'view', target: 'palm-gripper' }, { type: 'read', target: 'palm-gripper', seconds: 25 }, { type: 'download', target: 'cv-ko' }] };
const env = () => ({ DB: createDatabase(), ADMIN_TOKEN: key, ASSETS: { fetch: async () => new Response('public shell') } });
function request(body = batch, headers = {}) {
  const req = new Request('https://metrics.example/collect/portfolio', { method: 'POST', headers: { Origin: 'https://r-ush.github.io', 'User-Agent': 'Mozilla/5.0 Windows Chrome/130.0', 'CF-Connecting-IP': '198.51.100.10', ...headers }, body: JSON.stringify(body) });
  Object.defineProperty(req, 'cf', { value: { country: 'KR', regionCode: '41', city: 'Suwon', latitude: '37.2', longitude: '127.0', postalCode: '00000' } });
  return req;
}
test('portfolio data stays private and completely separate from public homepage metrics', async () => {
  const e = env();
  assert.equal((await worker.fetch(request(), e)).status, 204);
  for (const table of ['daily_metrics', 'country_totals', 'live_country', 'daily_totals']) assert.equal(e.DB.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  assert.equal((await worker.fetch(new Request('https://metrics.example/api/portfolio'), e)).status, 401);
  const response = await worker.fetch(new Request('https://metrics.example/api/portfolio', { headers: { Authorization: 'Bearer ' + key } }), e);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const report = await response.json();
  assert.equal(report.total, 1); assert.equal(report.visits[0].ip, '198.51.100.10');
  assert.equal(report.visits[0].city, 'KR-41/Suwon'); assert.equal(report.visits[0].activity.find(a => a.kind === 'read').seconds, 25);
  assert.equal(report.labels.downloads['cv-ko'], '국문 CV');
  for (const forbidden of ['37.2', '127.0', '00000', 'Mozilla', 'Chrome/130']) assert.equal(JSON.stringify(report).includes(forbidden), false);
  const live = await (await worker.fetch(new Request('https://metrics.example/api/live'), e)).json();
  assert.equal(live.countries.length, 0); assert.equal(live.daily.length, 0);
});
test('only portfolio routes and known content IDs are accepted; client cannot supply IP or geography', async () => {
  const e = env();
  for (const bad of [{ ...batch, path: '/' }, { ...batch, path: '/portfolio/?email=secret' }, { ...batch, ip: '1.2.3.4' }, { ...batch, visit: 'too-short' }, { ...batch, events: [{ type: 'view', target: 'secret@email.com' }] }, { ...batch, events: [{ type: 'read', target: 'cover', seconds: 61 }] }, { ...batch, events: [{ type: 'read', target: 'cover', seconds: 0 }] }]) {
    assert.equal((await worker.fetch(request(bad), e)).status, 400);
  }
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) n FROM portfolio_visits').get().n, 0);
  assert.equal((await worker.fetch(request(batch, { 'X-Forwarded-For': '203.0.113.1' }), e)).status, 204);
  assert.equal((await portfolioReport(e.DB)).visits[0].ip, '198.51.100.10');
});
test('GPC, DNT, owner exclusions, bots and wrong origins never create portfolio records', async () => {
  for (const headers of [{ 'Sec-GPC': '1' }, { DNT: '1' }, { 'User-Agent': 'Test crawler' }, { Origin: 'https://other.example' }, {}]) {
    const e = { ...env(), EXCLUDED_IPS: '198.51.100.10' };
    const res = await worker.fetch(request(batch, headers), e); assert.ok([204, 403].includes(res.status));
    assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) n FROM portfolio_visits').get().n, 0);
  }
});
test('existing visit IDs cannot be overwritten by another network or reading order', async () => {
  const e = env(); await worker.fetch(request(), e);
  await worker.fetch(request({ ...batch, events: [{ type: 'read', target: 'cover', seconds: 30 }] }, { 'CF-Connecting-IP': '198.51.100.11' }), e);
  await worker.fetch(request({ ...batch, path: '/portfolio/hardware-first/' }), e);
  const report = await portfolioReport(e.DB); assert.equal(report.total, 1);
  assert.equal(report.summary.find(x => x.kind === 'read').seconds, 25);
  assert.equal(report.summary.find(x => x.kind === 'download').count, 1);
});
test('seven-day query window and scheduled cleanup remove expired visits and activity', async () => {
  const e = env(), now = new Date('2026-11-24T12:00:00Z');
  await persistPortfolio(e.DB, validatePortfolio(batch), request(), new Date(now.getTime() - 8 * 86400000));
  const recent = { ...batch, visit: 'b'.repeat(32) };
  await persistPortfolio(e.DB, validatePortfolio(recent), request(recent), now);
  assert.equal((await portfolioReport(e.DB, now)).total, 1);
  await cleanupPortfolio(e.DB, now);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) n FROM portfolio_visits').get().n, 1);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) n FROM portfolio_activity WHERE visit=?').get(batch.visit).n, 0);
});
