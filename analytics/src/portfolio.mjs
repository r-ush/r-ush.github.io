import config from '../../portfolio/analytics-config.json' with { type: 'json' };
import { environment, geography, validAddress } from './metrics.mjs';

export const PORTFOLIO_DAYS = 30;
const targets = {
  view: Object.keys(config.slides), read: Object.keys(config.slides),
  source: Object.keys(config.sources), 'video-play': Object.keys(config.videos),
  'video-seek': Object.keys(config.videos), 'video-complete': Object.keys(config.videos),
  download: Object.keys(config.downloads), language: ['ko', 'en'],
  outbound: ['paper', 'research-homepage', 'email', 'external']
};
export function validatePortfolio(body) {
  if (!body || Object.keys(body).some(k => !['v', 'visit', 'path', 'events'].includes(k)) || body.v !== 1 ||
      !/^[a-f0-9]{32}$/.test(body.visit || '') || !config.paths.includes(body.path) ||
      !Array.isArray(body.events) || !body.events.length || body.events.length > 20) throw Error('Invalid portfolio batch');
  const events = body.events.map(event => {
    if (!event || Object.keys(event).some(k => !['type', 'target', 'seconds'].includes(k)) ||
        !targets[event.type]?.includes(event.target)) throw Error('Invalid portfolio event');
    if (event.type === 'read') {
      if (!Number.isInteger(event.seconds) || event.seconds < 1 || event.seconds > 60) throw Error('Invalid duration');
    } else if (event.seconds !== undefined) throw Error('Unexpected duration');
    return { type: event.type, target: event.target, seconds: event.seconds || 0 };
  });
  return { visit: body.visit, path: body.path, events };
}
export async function persistPortfolio(db, batch, request, now = new Date()) {
  // Only the edge-supplied connecting address; never a client body or X-Forwarded-For.
  const supplied = request.headers.get('cf-connecting-ip') || '';
  const ip = validAddress(supplied) ? supplied.toLowerCase() : 'Unknown';
  const geo = geography(request), agent = environment(request.headers.get('user-agent') || '');
  const stamp = now.toISOString();
  const statements = [db.prepare(`INSERT INTO portfolio_visits
    (visit,first_seen,last_seen,path,ip,country,region,city,browser,device,os)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(visit) DO UPDATE SET last_seen=excluded.last_seen
    WHERE portfolio_visits.path=excluded.path AND portfolio_visits.ip=excluded.ip`).bind(
      batch.visit, stamp, stamp, batch.path, ip, geo.country, geo.region, geo.city, agent.browser, agent.device, agent.os)];
  for (const e of batch.events) statements.push(db.prepare(`INSERT INTO portfolio_activity (visit,kind,target,count,seconds)
    SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM portfolio_visits WHERE visit=? AND path=? AND ip=?)
    ON CONFLICT(visit,kind,target) DO UPDATE SET count=count+excluded.count,seconds=seconds+excluded.seconds`).bind(
      batch.visit, e.type, e.target, e.type === 'read' ? 0 : 1, e.seconds, batch.visit, batch.path, ip));
  await db.batch(statements);
}
export async function cleanupPortfolio(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - PORTFOLIO_DAYS * 86400000).toISOString();
  // Explicit child cleanup also works in local SQLite harnesses without FK enforcement.
  await db.batch([
    db.prepare('DELETE FROM portfolio_activity WHERE visit IN (SELECT visit FROM portfolio_visits WHERE first_seen < ?)').bind(cutoff),
    db.prepare('DELETE FROM portfolio_visits WHERE first_seen < ?').bind(cutoff)
  ]);
}
export async function portfolioReport(db, now = new Date(), { allVisits = false } = {}) {
  const from = new Date(now.getTime() - PORTFOLIO_DAYS * 86400000).toISOString();
  const [visits, activity, totals] = await Promise.all([
    db.prepare('SELECT * FROM portfolio_visits WHERE first_seen >= ? ORDER BY last_seen DESC' + (allVisits ? '' : ' LIMIT 500')).bind(from).all(),
    db.prepare(`SELECT a.* FROM portfolio_activity a JOIN portfolio_visits v ON v.visit=a.visit
      WHERE v.first_seen >= ? ORDER BY v.last_seen DESC`).bind(from).all(),
    db.prepare('SELECT COUNT(*) AS visits FROM portfolio_visits WHERE first_seen >= ?').bind(from).all()
  ]);
  const byVisit = new Map(), summary = new Map();
  for (const item of activity.results || []) {
    if (!byVisit.has(item.visit)) byVisit.set(item.visit, []);
    byVisit.get(item.visit).push({ kind: item.kind, target: item.target, count: item.count, seconds: item.seconds });
    const key = item.kind + ':' + item.target;
    const row = summary.get(key) || { kind: item.kind, target: item.target, count: 0, seconds: 0 };
    row.count += item.count; row.seconds += item.seconds; summary.set(key, row);
  }
  return { days: PORTFOLIO_DAYS, from, to: now.toISOString(), total: totals.results?.[0]?.visits || 0,
    limit: allVisits ? null : 500, labels: { slides: config.slides, sources: config.sources, downloads: config.downloads, videos: config.videoLabels },
    summary: [...summary.values()], visits: (visits.results || []).map(v => ({ ...v, activity: byVisit.get(v.visit) || [] })) };
}
