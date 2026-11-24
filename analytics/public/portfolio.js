import { portfolioCSV } from './portfolio-export.mjs';
const $ = id => document.getElementById(id);
const dt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const country = new Intl.DisplayNames(['ko'], { type: 'region' });
let token = '', data = null, sample = false, generation = 0, exporting = false;
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const duration = seconds => Math.floor(seconds / 60) + '분 ' + seconds % 60 + '초';
const kinds = { view: '열람', read: '활동 시간', source: '자료 미리보기', download: '다운로드 클릭', language: '화면 언어', 'video-play': '직접 재생/확대', 'video-seek': '영상 구간 탐색', 'video-complete': '직접 재생 후 90% 시청', outbound: '외부 링크' };
function target(item) { return data.labels.slides[item.target] || data.labels.sources[item.target] || data.labels.downloads[item.target] || data.labels.videos?.[item.target] || item.target; }
function value(item) { return item.kind === 'read' ? duration(item.seconds) : item.count + '회'; }
function demo() {
  const activity = [{ kind: 'view', target: 'palm-gripper', count: 1, seconds: 0 }, { kind: 'read', target: 'palm-gripper', count: 0, seconds: 48 }, { kind: 'download', target: 'cv-ko', count: 1, seconds: 0 }];
  return { days: 30, total: 1, limit: 500, from: new Date(Date.now() - 30 * 86400000).toISOString(), to: new Date().toISOString(), labels: { slides: { 'palm-gripper': 'PALM-Gripper' }, sources: {}, downloads: { 'cv-ko': '국문 CV' }, videos: {} }, summary: activity, visits: [{ visit: 'sample', first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), path: '/portfolio/hardware-first/', ip: '192.0.2.10 (예시)', country: 'KR', region: 'KR-11', city: 'KR-11/Seoul (예시)', device: 'Desktop / other', browser: 'Chrome', os: 'Windows', activity }] };
}
function card(title, value, note) { const node = el('div', undefined, 'kpi'); node.append(el('span', title, 'kpi-label'), el('strong', value, 'kpi-value'), el('span', note, 'kpi-note')); return node; }
function renderRows(id, rows) {
  const parent = $(id); parent.replaceChildren();
  if (!rows.length) { parent.append(el('p', '아직 기록이 없습니다.', 'empty')); return; }
  for (const row of rows) { const node = el('div', undefined, 'metric-row'); node.append(el('span', target(row)), el('span', value(row))); parent.append(node); }
}
function render() {
  $('login').hidden = true; $('report').hidden = false; $('demo-notice').hidden = !sample;
  $('range').textContent = dt.format(new Date(data.from)) + ' — ' + dt.format(new Date(data.to)) + ' · KST';
  const count = kind => data.summary.filter(a => a.kind === kind).reduce((sum, a) => sum + a.count, 0);
  const seconds = data.summary.reduce((sum, a) => sum + a.seconds, 0);
  $('kpis').replaceChildren(card('접속 기록', data.total, '새로고침 포함 · 사람 수 아님'), card('활동 시간 합계', duration(seconds), '화면·포커스·활동 조건 충족'), card('자료 미리보기', count('source'), '2초 이상 열린 자료'), card('다운로드 클릭', count('download'), 'CV와 포트폴리오 PDF'));
  renderRows('reading', data.summary.filter(a => a.kind === 'read').sort((a, b) => b.seconds - a.seconds));
  renderRows('materials', data.summary.filter(a => ['source', 'download'].includes(a.kind)).sort((a, b) => b.count - a.count));
  $('visits').replaceChildren();
  if (!data.visits.length) $('visits').append(el('p', '아직 접속 기록이 없습니다. 공개 후 새로 발생한 방문부터 표시됩니다.', 'empty'));
  for (const visit of data.visits) {
    const details = el('details', undefined, 'visit'), summary = el('summary');
    const time = el('span', dt.format(new Date(visit.first_seen))); time.append(el('small', visit.path.includes('hardware-first') ? '하드웨어부터' : 'RL·IL부터'));
    const address = el('span', visit.ip, 'ip'); address.append(el('small', [visit.device, visit.browser].join(' · ')));
    let place = visit.country;
    try { if (/^[A-Z]{2}$/.test(place)) place = country.of(place); } catch {}
    const city = visit.city === 'Unknown' ? '' : visit.city.split('/').slice(1).join('/');
    const region = el('span', place + (city ? ' · ' + city : '')); region.append(el('small', 'IP 기반 추정 · 마지막 활동 ' + dt.format(new Date(visit.last_seen))));
    summary.append(time, address, region); details.append(summary);
    const body = el('div', undefined, 'visit-body'), list = el('ul');
    for (const item of visit.activity) list.append(el('li', (kinds[item.kind] || item.kind) + ' · ' + target(item) + ' · ' + value(item)));
    body.append(list); details.append(body); $('visits').append(details);
  }
}
async function refresh() {
  const current = ++generation; $('refresh').disabled = true; $('status').textContent = '';
  try {
    let result;
    if (sample) result = demo();
    else {
      const response = await fetch('/api/portfolio', { credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) throw Error(response.status === 401 ? '관리자 키를 확인해 주세요.' : '기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      result = await response.json();
    }
    if (current !== generation) return;
    data = result; render();
  } catch (error) { if (current === generation) $('status').textContent = error.message; }
  finally { if (current === generation) $('refresh').disabled = false; }
}
$('login-form').addEventListener('submit', event => { event.preventDefault(); token = $('token').value.trim(); $('token').value = ''; sample = false; refresh(); });
$('demo').addEventListener('click', () => { token = ''; sample = true; refresh(); });
$('refresh').addEventListener('click', refresh);
$('logout').addEventListener('click', () => { generation++; token = ''; data = null; sample = false; $('report').hidden = true; $('login').hidden = false; $('visits').replaceChildren(); $('status').textContent = ''; });
async function download(type) {
  if (!data || exporting) return;
  exporting = true;
  const current = generation, demoExport = sample;
  const buttons = ['csv-visits', 'csv-activity', 'export'].map($);
  buttons.forEach(button => { button.disabled = true; });
  $('status').textContent = '최근 30일 전체 기록을 준비하는 중입니다.';
  try {
    let full = data;
    if (!demoExport) {
      const response = await fetch('/api/portfolio?export=all', { credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) throw Error(response.status === 401 ? '관리자 키를 확인해 주세요.' : '기록을 저장하지 못했습니다. 다시 시도해 주세요.');
      full = await response.json();
    }
    if (current !== generation) return;
    const json = type === 'json', text = json ? JSON.stringify(full, null, 2) : portfolioCSV(full, type);
    const url = URL.createObjectURL(new Blob([text], { type: json ? 'application/json' : 'text/csv;charset=utf-8' }));
    const stamp = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const link = el('a'); link.href = url; link.download = (demoExport ? 'sample-' : '') + 'portfolio-' + (json ? 'records' : type) + '-' + stamp + (json ? '.json' : '.csv');
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('status').textContent = (demoExport ? '예시 ' : '') + '접속 ' + full.total + '건의 파일 다운로드를 시작했습니다.';
  } catch (error) { if (current === generation) $('status').textContent = error.message; }
  finally { exporting = false; buttons.forEach(button => { button.disabled = false; }); }
}
$('csv-visits').addEventListener('click', () => download('visits'));
$('csv-activity').addEventListener('click', () => download('activity'));
$('export').addEventListener('click', () => download('json'));
