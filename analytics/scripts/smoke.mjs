// Exercises a local Wrangler runtime only; never seeds a live collector.
import assert from 'node:assert/strict';
const base = new URL(process.argv[2] || 'http://127.0.0.1:8788');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Smoke tests are local-only.');
const token = 'local-preview-only-not-a-production-secret-12345';
const headers = { Authorization: 'Bearer ' + token };
const stats = async () => { const r = await fetch(new URL('/api/stats?days=7', base), { headers }); assert.equal(r.status, 200); return r.json(); };
const before = await stats();
const input = { v: 1, events: [
  { type: 'view', page: '/', source: 'Google' },
  { type: 'engagement', page: '/', seconds: 12, engaged: true },
  { type: 'scroll', page: '/', depth: 50 },
  { type: 'click', page: '/', kind: 'download', target: 'CV' }
] };
const sent = await fetch(new URL('/collect', base), { method: 'POST', headers: { Origin: 'https://r-ush.github.io', 'Content-Type': 'text/plain', 'User-Agent': 'Mozilla/5.0 Chrome/130.0' }, body: JSON.stringify(input) });
assert.equal(sent.status, 204);
assert.equal(sent.headers.get('set-cookie'), null);
assert.equal(sent.headers.get('access-control-allow-origin'), 'https://r-ush.github.io');
const after = await stats();
for (const [metric, delta] of Object.entries({ views: 1, active_seconds: 12, engaged_views: 1, scroll_50: 1, downloads: 1 })) assert.equal(after.totals[metric], (before.totals[metric] || 0) + delta);
assert.equal((await fetch(new URL('/api/stats', base))).status, 401);
const live = await fetch(new URL('/api/live', base), { headers: { Origin: 'https://r-ush.github.io' } });
assert.equal(live.status, 200);
assert.equal(live.headers.get('access-control-allow-origin'), 'https://r-ush.github.io');
assert.ok(Array.isArray((await live.json()).countries));
for (const path of ['/', '/dashboard.js', '/dashboard.css', '/demo.js']) {
  const r = await fetch(new URL(path, base)); assert.equal(r.status, 200, path);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
}
assert.equal((await fetch(new URL('/collect', base), { method: 'POST', headers: { Origin: 'https://other.example' }, body: JSON.stringify(input) })).status, 403);
console.log('PASS: real local Worker + D1 ingestion, aggregation, authentication, live map, assets and CORS.');
