import { aggregate, config, dateParts, ignoredRequest, LIVE, liveBucket, liveCounts, liveReport, MAX_BODY_BYTES, persist, report, RETENTION_DAYS, validateBatch } from './metrics.mjs';

// Per-isolate memo so polling homepages do not query D1 on every request.
const LIVE_CACHE_MS = 30000;
const liveCache = new WeakMap();

const security = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...security, ...headers } });
}
function json(body, status = 200, headers = {}) {
  return response(JSON.stringify(body), status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}
function permittedOrigin(origin, env) {
  if (origin === config.siteOrigin) return true;
  return env.ALLOW_LOCALHOST === 'true' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
}
async function authorized(request, env) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) return false;
  const token = request.headers.get('Authorization') || '';
  if (!token.startsWith('Bearer ') || token.length > 512) return false;
  const hash = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([hash(token.slice(7)), hash(env.ADMIN_TOKEN)]);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new Error('Body too large');
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('Body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function cleanup(env, now = new Date()) {
  const retention = Math.min(RETENTION_DAYS, Math.max(1, Number(env.RETENTION_DAYS) || RETENTION_DAYS));
  const cutoff = dateParts(new Date(now.getTime() - (retention - 1) * 86400000)).day;
  await env.DB.prepare('DELETE FROM daily_metrics WHERE day < ?').bind(cutoff).run();
  // Live buckets only mark recent visits, so they are kept for at most two days.
  await env.DB.prepare('DELETE FROM live_country WHERE bucket < ?').bind(liveBucket(new Date(now.getTime() - 86400000))).run();
}
async function liveMap(env, now = new Date()) {
  const cached = liveCache.get(env.DB);
  if (cached && now.getTime() - cached.at < LIVE_CACHE_MS) return cached.body;
  const since = liveBucket(new Date(now.getTime() - LIVE.listHours * 3600000));
  const [views, recent] = await Promise.all([
    env.DB.prepare('SELECT country, views FROM country_totals WHERE views > 0').all(),
    env.DB.prepare('SELECT bucket, country, views FROM live_country WHERE bucket >= ? AND views > 0 ORDER BY bucket DESC, country LIMIT 50').bind(since).all()
  ]);
  const body = JSON.stringify(liveReport(views.results || [], recent.results || [], now));
  liveCache.set(env.DB, { at: now.getTime(), body });
  return body;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/collect') {
      const origin = request.headers.get('origin');
      if (!permittedOrigin(origin, env)) return response(null, 403);
      const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
      if (request.method === 'OPTIONS') return response(null, 204, { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '3600' });
      if (request.method !== 'POST') return response(null, 405, cors);
      if (ignoredRequest(request)) return response(null, 204, cors);
      if (env.INGEST_LIMIT && !(await env.INGEST_LIMIT.limit({ key: 'aggregate-ingest' })).success) return response(null, 429, cors);
      let events;
      try { events = validateBatch(await readBody(request)); }
      catch { return json({ error: 'Invalid aggregate event' }, 400, cors); }
      try {
        const now = new Date();
        await persist(env.DB, aggregate(events, request, now), liveCounts(events, request, now));
        liveCache.delete(env.DB);
        return response(null, 204, cors);
      } catch {
        // Do not log request headers, bodies, tokens, IPs or database values.
        return json({ error: 'Collection unavailable' }, 503, cors);
      }
    }
    if (url.pathname === '/api/live') {
      // Public, country-level only: the homepage map polls this without credentials.
      const origin = request.headers.get('origin');
      const cors = permittedOrigin(origin, env) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : { 'Vary': 'Origin' };
      if (request.method !== 'GET') return response(null, 405, cors);
      try { return response(await liveMap(env), 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30', ...cors }); }
      catch { return json({ error: 'Live map unavailable' }, 503, cors); }
    }
    if (url.pathname === '/api/stats') {
      if (request.method !== 'GET') return response(null, 405);
      if (!(await authorized(request, env))) {
        if (env.AUTH_LIMIT && !(await env.AUTH_LIMIT.limit({ key: 'admin-failures' })).success) return response(null, 429);
        return json({ error: 'Authentication required' }, 401);
      }
      const days = Number(url.searchParams.get('days') || 7);
      if (!Number.isInteger(days) || days < 1 || days > RETENTION_DAYS) return json({ error: 'Invalid range' }, 400);
      const now = new Date();
      const from = dateParts(new Date(now.getTime() - (days - 1) * 86400000)).day;
      const to = dateParts(now).day;
      try {
        const data = await env.DB.prepare('SELECT day,dimension,label,metric,value FROM daily_metrics WHERE day >= ? AND day <= ? ORDER BY day').bind(from, to).all();
        return json(report(data.results || [], days, now));
      } catch { return json({ error: 'Statistics unavailable' }, 503); }
    }
    if (url.pathname === '/health') return json({ ok: true, mode: 'aggregate-only' });
    if (url.pathname.startsWith('/api/')) return response(null, 404);
    if (!['GET', 'HEAD'].includes(request.method)) return response(null, 405);
    const asset = await env.ASSETS.fetch(request);
    const secured = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(security)) secured.headers.set(key, value);
    return secured;
  },
  async scheduled(controller, env) { await cleanup(env); }
};
