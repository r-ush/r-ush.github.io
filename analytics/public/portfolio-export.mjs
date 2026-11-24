const kinds = { view: '열람', read: '활동 시간', source: '자료 미리보기', download: '다운로드 클릭', language: '화면 언어', 'video-play': '직접 재생/확대', 'video-seek': '영상 구간 탐색', 'video-complete': '직접 재생 후 90% 시청', outbound: '외부 링크' };
const baseHeaders = ['접속 ID', '최초 접속 (KST)', '마지막 활동 (KST)', '포트폴리오 경로', 'IP', '국가', '지역', '도시', '기기', '브라우저', '운영체제'];
function kst(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : '';
}
function baseRow(visit) { return [visit.visit, kst(visit.first_seen), kst(visit.last_seen), visit.path, visit.ip, visit.country, visit.region, visit.city, visit.device, visit.browser, visit.os]; }
function label(data, item) { return ['slides', 'sources', 'downloads', 'videos'].map(group => data.labels?.[group]?.[item.target]).find(Boolean) || item.target; }
function cell(value) {
  let text = String(value ?? '');
  // Preserve CSV structure and prevent spreadsheet applications from evaluating text.
  if (typeof value !== 'number' && /^\s*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function csv(rows) { return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'; }
export function portfolioCSV(data, type = 'visits') {
  if (!['visits', 'activity'].includes(type)) throw Error('Unknown CSV type');
  const rows = [type === 'visits'
    ? [...baseHeaders, '열람한 연구', '활동 시간 합계 (초)', '미리 본 자료', '영상 직접 조작', '다운로드 클릭', '화면 언어', '외부 링크 클릭']
    : [...baseHeaders, '활동 종류', '대상 ID', '대상 이름', '횟수', '활동 시간 (초)']];
  for (const visit of data.visits) {
    const activity = visit.activity || [];
    if (type === 'activity') {
      for (const item of activity) rows.push([...baseRow(visit), kinds[item.kind] || item.kind, item.target, label(data, item), item.count, item.seconds]);
    } else {
      const summary = filter => activity.filter(filter).map(item => label(data, item) + ' (' + (kinds[item.kind] || item.kind) + ' ' + item.count + '회)').join(' | ');
      rows.push([...baseRow(visit), summary(item => item.kind === 'view'),
        activity.reduce((sum, item) => sum + (item.seconds || 0), 0), summary(item => item.kind === 'source'),
        summary(item => item.kind.startsWith('video-')), summary(item => item.kind === 'download'),
        summary(item => item.kind === 'language'), summary(item => item.kind === 'outbound')]);
    }
  }
  return csv(rows);
}
