import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioCSV } from '../public/portfolio-export.mjs';

const data = { labels: { slides: { cover: '표지, "소개"\n다음 줄' }, downloads: { 'cv-ko': '국문 CV' } }, visits: [{ visit: 'test', first_seen: '2026-11-24T16:00:00Z', last_seen: '2026-11-24T16:01:00Z', path: '/portfolio/', ip: '198.51.100.10', country: 'KR', region: 'KR-11', city: '=HYPERLINK("test")', device: 'Desktop', browser: 'Chrome', os: 'Windows', activity: [{ kind: 'view', target: 'cover', count: 1, seconds: 0 }, { kind: 'read', target: 'cover', count: 0, seconds: 42 }, { kind: 'download', target: 'cv-ko', count: 1, seconds: 0 }] }] };
test('CSV preserves Korean, quotes and newlines, uses KST and neutralizes formulas', () => {
  const text = portfolioCSV(data);
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.ok(text.includes('"2026-11-25 01:00:00"'));
  assert.ok(text.includes('표지, ""소개""\n다음 줄'));
  assert.ok(text.includes('"\'=HYPERLINK(""test"")"'));
  assert.ok(text.includes('"42"')); assert.ok(text.includes('국문 CV'));
  assert.ok(text.endsWith('\r\n'));
});
test('detailed CSV preserves every activity and an empty export still has headers', () => {
  const csv = portfolioCSV(data, 'activity');
  assert.ok(csv.includes('"활동 시간","cover"'));
  assert.ok(csv.includes('"다운로드 클릭","cv-ko","국문 CV","1","0"'));
  const empty = portfolioCSV({ ...data, visits: [] });
  assert.equal(empty.split('\r\n').length, 2);
  assert.throws(() => portfolioCSV(data, 'invalid'));
});
