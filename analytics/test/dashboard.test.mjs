import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { demoReport } from '../public/demo.js';

function dashboard(fetcher = async () => ({ ok: false, status: 401 })) {
  const { document, window } = parseHTML(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'));
  let period = '7';
  Object.defineProperty(document.getElementById('period'), 'value', { get: () => period, set: value => { period = value; } });
  const downloads = [], requests = [];
  const context = { document, Intl, Blob, demoReport, setTimeout: fn => fn(), location: { reload() {} },
    URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:local-test'; }, revokeObjectURL() {} },
    fetch: async (...args) => { requests.push(args); return fetcher(...args); }
  };
  Object.defineProperty(context, 'localStorage', { get() { throw new Error('Dashboard must never persist credentials'); } });
  vm.runInNewContext(readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/, ''), context);
  return { document, downloads, requests, fire(id, event = 'click') { document.getElementById(id).dispatchEvent(new window.Event(event, { bubbles: true, cancelable: true })); } };
}

test('dashboard demo, range selection and exports are functional and visibly labelled', async () => {
  const app = dashboard(); app.fire('demo-button'); await setImmediate();
  assert.equal(app.document.getElementById('report').hidden, false);
  assert.equal(app.document.getElementById('demo-notice').hidden, false);
  assert.match(app.document.getElementById('demo-notice').textContent, /실제 방문 통계가 아닙니다/);
  assert.equal(app.document.querySelectorAll('.kpi').length, 4);
  assert.equal(app.document.querySelectorAll('#daily-chart .bar').length, 7);
  assert.equal(app.document.querySelectorAll('#pages tr').length, 4);
  app.document.getElementById('period').value = '30'; app.fire('period', 'change'); await setImmediate();
  assert.equal(app.document.querySelectorAll('#daily-chart .bar').length, 30);
  app.fire('json'); app.fire('csv');
  assert.equal(JSON.parse(await app.downloads[0].text()).demo, true);
  assert.match(await app.downloads[1].text(), /SAMPLE/);
  assert.equal(app.requests.length, 0);
});

test('invalid admin key reveals no data; successful login uses only an authorization header', async () => {
  const denied = dashboard(); denied.document.getElementById('token').value = 'wrong-test-key'; denied.fire('login-form', 'submit'); await setImmediate();
  assert.equal(denied.document.getElementById('report').hidden, true);
  assert.match(denied.document.getElementById('status').textContent, /관리자 키/);
  const empty = { ...demoReport(7), totals: {}, series: demoReport(7).series.map(x => ({ ...x, views: 0 })), pages: [], breakdowns: {} };
  delete empty.demo;
  const app = dashboard(async () => ({ ok: true, json: async () => empty }));
  app.document.getElementById('token').value = 'test-admin-value'; app.fire('login-form', 'submit'); await setImmediate();
  assert.equal(app.document.getElementById('token').value, '');
  assert.equal(app.document.getElementById('demo-notice').hidden, true);
  assert.match(app.document.getElementById('pages').textContent, /집계된 페이지 조회가 없습니다/);
  assert.equal(app.requests[0][0], '/api/stats?days=7');
  assert.equal(app.requests[0][1].headers.Authorization, 'Bearer test-admin-value');
  assert.equal(app.requests[0][1].credentials, 'omit');
});

test('privacy setting stores only the explicit opt-out preference and respects GPC', () => {
  for (const signal of [false, true]) {
    const { document, window } = parseHTML(readFileSync(new URL('../../privacy.html', import.meta.url), 'utf8'));
    const storage = new Map();
    const context = { document, window, Event: window.Event, navigator: { globalPrivacyControl: signal }, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
    vm.runInNewContext(readFileSync(new URL('../../assets/js/analytics-preferences.js', import.meta.url), 'utf8'), context);
    assert.equal(storage.size, 0);
    const toggle = document.getElementById('analytics-preference-toggle');
    assert.equal(toggle.disabled, signal);
    if (!signal) {
      toggle.click(); assert.deepEqual(Array.from(storage), [['rush-analytics-disabled', '1']]);
      assert.match(document.getElementById('analytics-preference-status').textContent, /제외됩니다/);
      toggle.click(); assert.equal(storage.size, 0);
    }
  }
});
