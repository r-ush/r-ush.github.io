import { demoReport } from './demo.js';

const $ = id => document.getElementById(id);
const format = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
const countries = new Intl.DisplayNames(['ko'], { type: 'region' });
let token = '', demo = false, data = null, requestId = 0;
const labels = { 'Direct / unknown': '직접 방문 / 알 수 없음', Internal: '사이트 내부', 'Other external': '기타 외부 사이트', 'Other internal': '기타 내부 링크', Unknown: '알 수 없음', 'Other / low volume': '기타 / 소수 집계', 'Desktop / other': 'PC / 기타', Mobile: '모바일', Tablet: '태블릿', research: 'Research', award: 'Awards', personal: 'Projects', 'visitor-map': '방문 지도', other: '기타', '/': 'Homepage' };
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
// ISO 3166-2:KR codes as sent by Cloudflare (42/45 are the pre-2023/2024 codes).
const koreanRegions = { 11: '서울특별시', 26: '부산광역시', 27: '대구광역시', 28: '인천광역시', 29: '광주광역시', 30: '대전광역시', 31: '울산광역시', 50: '세종특별자치시', 41: '경기도', 42: '강원특별자치도', 51: '강원특별자치도', 43: '충청북도', 44: '충청남도', 45: '전북특별자치도', 52: '전북특별자치도', 46: '전라남도', 47: '경상북도', 48: '경상남도', 49: '제주특별자치도' };
function countryName(code) { try { return countries.of(code); } catch (_) { return code; } }
// 'KR-41' → '대한민국 경기도', 'US-CA' → '미국 CA', 'KR' → '대한민국'
function place(code) {
  const [country, region] = code.split('-');
  return countryName(country) + (region ? ' ' + (country === 'KR' && koreanRegions[region] || region) : '');
}
function name(label, dimension) {
  if (dimension === 'country' && /^[A-Z]{2}$/.test(label)) return countryName(label);
  if (dimension === 'region' && /^[A-Z]{2}-[A-Z0-9]+$/.test(label)) return place(label);
  if (dimension === 'city' && /^[A-Z]{2}(-[A-Z0-9]+)?\//.test(label)) { const slash = label.indexOf('/'); return place(label.slice(0, slash)) + ' · ' + label.slice(slash + 1); }
  const page = data?.pages.find(p => p.path === label);
  return page?.name || labels[label] || label;
}
function numeric(value) { return format.format(value || 0); }
function duration(seconds) { if (!Number.isFinite(seconds)) return '—'; return seconds >= 60 ? Math.floor(seconds / 60) + '분 ' + Math.round(seconds % 60) + '초' : Math.round(seconds) + '초'; }
function percent(numerator, denominator) { return denominator ? Math.min(100, Math.round((numerator || 0) / denominator * 100)) + '%' : '—'; }
function metricCard(label, value, note) {
  const card = el('div', undefined, 'kpi');
  card.append(el('span', label, 'kpi-label'), el('strong', value, 'kpi-value'), el('span', note, 'kpi-note'));
  return card;
}
function rankList(id, rows, dimension, denominator) {
  const parent = $(id); parent.replaceChildren();
  if (!rows?.length) { parent.append(el('p', '아직 집계된 데이터가 없습니다.', 'empty')); return; }
  const total = denominator || rows.reduce((sum, item) => sum + item.value, 0) || 1;
  rows.forEach(row => {
    const item = el('div', undefined, 'rank');
    const caption = el('div', undefined, 'rank-caption');
    caption.append(el('span', name(row.label, dimension), 'rank-name'), el('span', numeric(row.value) + ' · ' + percent(row.value, total), 'rank-value'));
    const bar = el('progress'); bar.max = total; bar.value = row.value; bar.setAttribute('aria-label', name(row.label, dimension));
    item.append(caption, bar); parent.append(item);
  });
}
function bars(id, rows) {
  const parent = $(id); parent.replaceChildren();
  const max = Math.max(1, ...rows.map(row => row.value));
  rows.forEach(row => {
    const bar = el('div', undefined, 'bar');
    const label = row.label + ': ' + numeric(row.value) + '회';
    bar.title = label; bar.setAttribute('aria-label', label); bar.setAttribute('role', 'img');
    const fill = el('div', undefined, 'bar-fill'); fill.style.height = Math.max(1, row.value / max * 100) + '%';
    bar.append(fill); parent.append(bar);
  });
}
function details(id, entries) {
  $(id).replaceChildren(...entries.map(([label, value]) => { const node = el('div'); node.append(el('span', label), el('strong', value)); return node; }));
}
function render() {
  $('login').hidden = true; $('report').hidden = false; $('demo-notice').hidden = !demo;
  $('range').textContent = data.from + ' — ' + data.to + ' · KST';
  const t = data.totals, views = t.views || 0;
  $('kpis').replaceChildren(
    metricCard('페이지 조회수', numeric(views), '고유 방문자 수가 아닙니다'),
    metricCard('평균 활동 시간', views ? duration((t.active_seconds || 0) / views) : '—', '활동 시간 합계 ÷ 조회수'),
    metricCard('링크 클릭', numeric(t.clicks), '내부·외부·다운로드·이메일'),
    metricCard('10초 이상 활동', percent(t.engaged_views, views), '조회 중 활동 10초에 도달한 비율')
  );
  bars('daily-chart', data.series.map(d => ({ label: d.day, value: d.views })));
  $('chart-start').textContent = data.from; $('chart-end').textContent = data.to;
  bars('hour-chart', Array.from({ length: 24 }, (_, hour) => ({ label: hour + '시', value: data.breakdowns.hour?.find(h => Number(h.label) === hour)?.value || 0 })));
  $('pages').replaceChildren();
  if (!data.pages.length) { const row = el('tr'); const cell = el('td', '이 기간에는 집계된 페이지 조회가 없습니다.', 'empty'); cell.colSpan = 5; row.append(cell); $('pages').append(row); }
  data.pages.forEach(page => {
    const row = el('tr'), title = el('td'), link = el('a', page.name);
    link.href = 'https://r-ush.github.io' + page.path; link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link);
    row.append(title, el('td', numeric(page.views)), el('td', page.views ? duration((page.active_seconds || 0) / page.views) : '—'), el('td', percent(page.scroll_50, page.views)), el('td', numeric(page.clicks))); $('pages').append(row);
  });
  ['source', 'country', 'region', 'city', 'device', 'browser', 'os', 'link', 'section'].forEach(dimension => rankList(dimension, data.breakdowns[dimension], dimension));
  rankList('scroll', [25, 50, 75, 100].map(depth => ({ label: depth + '% 지점', value: t['scroll_' + depth] || 0 })), 'scroll', views || 1);
  details('content-metrics', [['다운로드 클릭', numeric(t.downloads)], ['영상 재생', numeric(t.video_plays)], ['영상 끝까지', numeric(t.video_completions)]]);
  const samples = t.performance_samples || 0;
  details('performance-metrics', [['평균 로드', samples ? numeric(t.load_ms / samples / 1000) + '초' : '—'], ['첫 응답 (TTFB)', samples ? numeric(t.ttfb_ms / samples) + 'ms' : '—'], ['측정 표본', numeric(samples)]]);
}
async function refresh() {
  const current = ++requestId;
  const days = Number($('period').value);
  $('status').textContent = ''; $('refresh').disabled = true;
  try {
    let result;
    if (demo) result = demoReport(days);
    else {
      const response = await fetch('/api/stats?days=' + days, { credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) throw new Error(response.status === 401 ? '관리자 키를 확인해 주세요.' : response.status === 429 ? '잠시 후 다시 시도해 주세요.' : '통계 서버에 연결할 수 없습니다.');
      result = await response.json();
    }
    if (current !== requestId) return;
    data = result; render();
  } catch (error) {
    if (current !== requestId) return;
    $('status').textContent = error.message + (data ? ' 이전 조회 결과를 표시합니다.' : '');
    if (data) $('period').value = String(data.days);
    if (!data) token = '';
  } finally { if (current === requestId) $('refresh').disabled = false; }
}
$('login-form').addEventListener('submit', event => { event.preventDefault(); token = $('token').value.trim(); $('token').value = ''; demo = false; refresh(); });
$('demo-button').addEventListener('click', () => { token = ''; demo = true; refresh(); });
$('logout').addEventListener('click', () => { token = ''; data = null; location.reload(); });
$('period').addEventListener('change', refresh); $('refresh').addEventListener('click', refresh);
function download(content, type, extension) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = el('a'); anchor.href = url; anchor.download = (demo ? 'SAMPLE-' : '') + 'analytics-' + data.from + '-' + data.to + '.' + extension; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('json').addEventListener('click', () => { if (data) download(JSON.stringify(data, null, 2), 'application/json', 'json'); });
$('csv').addEventListener('click', () => {
  if (!data) return;
  const rows = [['mode', 'from', 'to', 'dimension', 'label', 'metric', 'value']];
  const add = (dimension, label, metric, value) => rows.push([demo ? 'SAMPLE' : 'aggregate', data.from, data.to, dimension, label, metric, value]);
  Object.entries(data.totals).forEach(([metric, value]) => add('total', 'all', metric, value));
  data.series.forEach(row => add('day', row.day, 'views', row.views));
  data.pages.forEach(page => Object.entries(page).filter(([key]) => !['path', 'name'].includes(key)).forEach(([metric, value]) => add('page', page.path, metric, value)));
  Object.entries(data.breakdowns).forEach(([dimension, items]) => items.forEach(item => add(dimension, item.label, ['link', 'section'].includes(dimension) ? 'interactions' : 'views', item.value)));
  const cell = value => { let text = String(value); if (/^[=+@\-]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  download('\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8', 'csv');
});
