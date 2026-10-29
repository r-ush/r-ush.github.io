import config from '../../assets/data/analytics-config.json' with { type: 'json' };

export { config };
export const MAX_BODY_BYTES = 8192;
export const RETENTION_DAYS = 180;
export const LIVE = config.liveMap;
const TYPES = {
  view: ['type', 'page', 'source'],
  engagement: ['type', 'page', 'seconds', 'engaged'],
  scroll: ['type', 'page', 'depth'],
  click: ['type', 'page', 'target', 'kind'],
  section: ['type', 'page', 'section'],
  video: ['type', 'page', 'action'],
  performance: ['type', 'page', 'load', 'ttfb']
};
const clickKinds = ['internal', 'outbound', 'download', 'email'];

export function dateParts(now = new Date()) {
  const korea = new Date(now.getTime() + 9 * 3600000).toISOString();
  return { day: korea.slice(0, 10), hour: korea.slice(11, 13) };
}

export function normalizePage(input) {
  if (typeof input !== 'string' || !input.startsWith('/') || /[?#%\\]/.test(input)) return null;
  let path = input.replace(/index\.html$/, '');
  if (!path.endsWith('/')) path += '/';
  return Object.hasOwn(config.pages, path) ? path : null;
}

export function environment(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /(?:Chrome|CriOS)\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const device = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? 'Tablet' : /Mobile|iPhone|iPod/i.test(ua) ? 'Mobile' : 'Desktop / other';
  return { browser, os, device };
}

export function ignoredRequest(request) {
  const ua = request.headers.get('user-agent') || '';
  return request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1' || /bot|crawler|spider|headless|lighthouse|facebookexternalhit|preview|curl|wget/i.test(ua);
}

function number(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function validateBatch(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['v', 'events'].includes(k)) || payload.v !== 1 || !Array.isArray(payload.events) || payload.events.length < 1 || payload.events.length > 20) throw new Error('Invalid batch');
  return payload.events.map(event => {
    if (!event || typeof event !== 'object' || Array.isArray(event) || !Object.hasOwn(TYPES, event.type) || Object.keys(event).some(k => !TYPES[event.type].includes(k))) throw new Error('Invalid event');
    const page = normalizePage(event.page);
    if (!page) throw new Error('Unknown page');
    switch (event.type) {
      case 'view':
        if (!config.sources.includes(event.source)) throw new Error('Invalid source');
        break;
      case 'engagement':
        if (!number(event.seconds, 0, 60) || !Number.isInteger(event.seconds) || typeof event.engaged !== 'boolean') throw new Error('Invalid engagement');
        break;
      case 'scroll':
        if (![25, 50, 75, 100].includes(event.depth)) throw new Error('Invalid depth');
        break;
      case 'click':
        if (!clickKinds.includes(event.kind) || !(config.targets.includes(event.target) || Object.hasOwn(config.pages, event.target))) throw new Error('Invalid target');
        break;
      case 'section':
        if (!config.sections.includes(event.section)) throw new Error('Invalid section');
        break;
      case 'video':
        if (!['play', 'complete'].includes(event.action)) throw new Error('Invalid video action');
        break;
      case 'performance':
        if (!number(event.load, 0, 60000) || !number(event.ttfb, 0, 30000)) throw new Error('Invalid performance');
        break;
    }
    return { ...event, page };
  });
}

function geography(request) {
  const rawCountry = request.cf?.country || '';
  const country = /^[A-Z]{2}$/.test(rawCountry) && rawCountry !== 'XX' ? rawCountry : 'Unknown';
  // Administrative region codes only; never store city, coordinates or postal code.
  const regionCode = request.cf?.regionCode || '';
  const region = country !== 'Unknown' && /^[A-Z0-9-]{1,6}$/i.test(regionCode) ? country + '-' + regionCode.toUpperCase() : 'Unknown';
  return { country, region };
}

export function liveBucket(now = new Date()) {
  const size = LIVE.bucketMinutes * 60;
  return Math.floor(now.getTime() / 1000 / size) * size;
}

// Country-only view counts for the public map; no region, page or environment.
export function liveCounts(events, request, now = new Date()) {
  const { country } = geography(request);
  const views = events.filter(event => event.type === 'view').length;
  return country === 'Unknown' || !views ? [] : [{ bucket: liveBucket(now), country, views }];
}

// Public map: all-time country views, the last day's country buckets for the
// recent-visitor list (country, bucket start and count only) and site-wide views per day.
export function liveReport(views, recent, now = new Date(), days = []) {
  const countries = views.map(row => ({ code: row.country, views: Number(row.views) }));
  countries.sort((a, b) => b.views - a.views || a.code.localeCompare(b.code));
  const visits = recent.map(row => ({ code: row.country, time: new Date(row.bucket * 1000).toISOString(), views: Number(row.views) }));
  const daily = days.map(row => ({ day: row.day, views: Number(row.views) }));
  return { bucketMinutes: LIVE.bucketMinutes, generatedAt: now.toISOString(), countries, recent: visits, daily };
}

export function aggregate(events, request, now = new Date()) {
  const { day, hour } = dateParts(now);
  const rows = new Map();
  const env = environment(request.headers.get('user-agent') || '');
  const { country, region } = geography(request);
  const add = (dimension, label, metric, value = 1) => {
    if (!value) return;
    const key = [dimension, label, metric].join('|');
    if (!rows.has(key)) rows.set(key, { day, dimension, label, metric, value: 0 });
    rows.get(key).value += value;
  };
  for (const event of events) {
    const metric = (name, value = 1) => {
      add('total', 'all', name, value);
      add('page', event.page, name, value);
    };
    switch (event.type) {
      case 'view':
        metric('views');
        add('hour', hour, 'views');
        for (const [dimension, label] of Object.entries({ country, region, source: event.source, ...env })) add(dimension, label, 'views');
        break;
      case 'engagement':
        metric('active_seconds', event.seconds);
        if (event.engaged) metric('engaged_views');
        break;
      case 'scroll': metric('scroll_' + event.depth); break;
      case 'click':
        metric('clicks');
        if (event.kind === 'download') metric('downloads');
        if (event.kind === 'outbound') metric('outbound_clicks');
        add('link', event.target, 'clicks');
        break;
      case 'section':
        metric('section_opens');
        add('section', event.section, 'opens');
        break;
      case 'video': metric(event.action === 'play' ? 'video_plays' : 'video_completions'); break;
      case 'performance':
        metric('load_ms', Math.round(event.load));
        metric('ttfb_ms', Math.round(event.ttfb));
        metric('performance_samples');
        break;
    }
  }
  return Array.from(rows.values());
}

export async function persist(db, rows, live = []) {
  const statements = [];
  // D1 limits bound parameters: 15 rows x 5 columns = 75 parameters per query.
  for (let i = 0; i < rows.length; i += 15) {
    const chunk = rows.slice(i, i + 15);
    const sql = 'INSERT INTO daily_metrics(day,dimension,label,metric,value) VALUES ' + chunk.map(() => '(?,?,?,?,?)').join(',') + ' ON CONFLICT(day,dimension,label,metric) DO UPDATE SET value = daily_metrics.value + excluded.value';
    statements.push(db.prepare(sql).bind(...chunk.flatMap(r => [r.day, r.dimension, r.label, r.metric, r.value])));
  }
  // Day totals outlive daily_metrics' retention; unknown-country views are included.
  for (const row of rows) {
    if (row.dimension === 'total' && row.metric === 'views') statements.push(db.prepare('INSERT INTO daily_totals(day,views) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET views = daily_totals.views + excluded.views').bind(row.day, row.value));
  }
  for (const row of live) {
    statements.push(db.prepare('INSERT INTO live_country(bucket,country,views) VALUES (?,?,?) ON CONFLICT(bucket,country) DO UPDATE SET views = live_country.views + excluded.views').bind(row.bucket, row.country, row.views));
    statements.push(db.prepare('INSERT INTO country_totals(country,views) VALUES (?,?) ON CONFLICT(country) DO UPDATE SET views = country_totals.views + excluded.views').bind(row.country, row.views));
  }
  if (statements.length) await db.batch(statements);
}

export function report(rows, days, now = new Date()) {
  const daysList = [];
  for (let i = days - 1; i >= 0; i--) daysList.push(dateParts(new Date(now.getTime() - i * 86400000)).day);
  const result = { timezone: 'Asia/Seoul', days, from: daysList[0], to: daysList.at(-1), totals: {}, series: daysList.map(day => ({ day, views: 0 })), pages: [], breakdowns: {}, privacy: { identifiers: false, rawEvents: false } };
  const pageMap = new Map();
  const groups = {};
  for (const row of rows) {
    if (row.dimension === 'total') {
      result.totals[row.metric] = (result.totals[row.metric] || 0) + row.value;
      if (row.metric === 'views') {
        const item = result.series.find(d => d.day === row.day);
        if (item) item.views += row.value;
      }
    } else if (row.dimension === 'page') {
      if (!pageMap.has(row.label)) pageMap.set(row.label, { path: row.label, name: config.pages[row.label] || row.label });
      const page = pageMap.get(row.label);
      page[row.metric] = (page[row.metric] || 0) + row.value;
    } else {
      groups[row.dimension] ||= new Map();
      groups[row.dimension].set(row.label, (groups[row.dimension].get(row.label) || 0) + row.value);
    }
  }
  result.pages = Array.from(pageMap.values()).sort((a, b) => (b.views || 0) - (a.views || 0));
  for (const [dimension, values] of Object.entries(groups)) {
    const items = Array.from(values, ([label, value]) => ({ label, value }));
    // Suppress very small region/country buckets in reports and exports.
    if (dimension === 'country' || dimension === 'region') {
      const small = items.filter(x => x.value < 3 && x.label !== 'Unknown').reduce((sum, x) => sum + x.value, 0);
      result.breakdowns[dimension] = items.filter(x => x.value >= 3 || x.label === 'Unknown');
      if (small) result.breakdowns[dimension].push({ label: 'Other / low volume', value: small });
    } else result.breakdowns[dimension] = items;
    result.breakdowns[dimension].sort((a, b) => b.value - a.value);
  }
  return result;
}
