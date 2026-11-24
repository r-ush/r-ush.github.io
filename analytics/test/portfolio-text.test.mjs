import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';

const source = readFileSync(new URL('../../portfolio/text-layer.js', import.meta.url), 'utf8');
function harness() {
  const { document, window } = parseHTML('<html><body><section id="page"></section><p id="outside">outside</p></body></html>');
  let selection = null;
  window.getSelection = () => selection;
  vm.runInNewContext(source, { document, window });
  const runs = [
    { line: 0, text: '엄승환', x: [10, 22, 34], y: 20, size: 12, bold: true, link: null },
    { line: 1, text: 'Robotics portfolio', x: Array.from({ length: 18 }, (_, i) => 10 + i * 5), y: 40, size: 10, bold: false, link: 0 }
  ];
  const links = [];
  const layer = window.PortfolioText.create({ text_runs: runs }, 100, 60, (element, link) => links.push(link));
  document.getElementById('page').append(layer);
  const nodes = Array.from(layer.querySelectorAll('text'), element => element.firstChild);
  const clipboard = {};
  function copy() {
    const event = new window.Event('copy', { bubbles: true, cancelable: true });
    event.clipboardData = { setData: (type, text) => { clipboard[type] = text; } };
    document.dispatchEvent(event); return event;
  }
  return { window, document, layer, nodes, clipboard, copy, links, setSelection(value) { selection = value; } };
}
test('text layer uses native selectable characters at PDF positions and preserves partial multiline copies', () => {
  const h = harness(), [first, second] = h.nodes;
  assert.equal(h.layer.getAttribute('viewBox'), '0 0 100 60');
  assert.equal(first.parentElement.getAttribute('x'), '10 22 34');
  assert.deepEqual(h.links, [0]);
  const range = { startContainer: first, startOffset: 1, endContainer: second, endOffset: 8, intersectsNode: node => h.nodes.includes(node) };
  h.setSelection({ anchorNode: first, focusNode: second, rangeCount: 1, isCollapsed: false, getRangeAt: () => range });
  assert.equal(h.copy().defaultPrevented, true);
  assert.equal(h.clipboard['text/plain'], '승환\nRobotics');
  h.setSelection({ anchorNode: second, focusNode: first, rangeCount: 1, isCollapsed: false, getRangeAt: () => range });
  h.copy(); assert.equal(h.clipboard['text/plain'], '승환\nRobotics', 'backwards drags preserve reading order');
});
test('selection guards avoid accidental navigation, release correctly, and leave other copy actions untouched', () => {
  const h = harness();
  h.layer.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true }));
  assert.equal(h.window.PortfolioText.isSelecting(), true);
  h.document.dispatchEvent(new h.window.Event('pointerup')); assert.equal(h.window.PortfolioText.isSelecting(), false);
  const outside = h.document.getElementById('outside').firstChild;
  h.setSelection({ anchorNode: outside, focusNode: outside, rangeCount: 1, isCollapsed: false });
  assert.equal(h.copy().defaultPrevented, false);
  let cleared = false;
  h.setSelection({ anchorNode: h.nodes[0], focusNode: h.nodes[0], rangeCount: 1, isCollapsed: false, removeAllRanges() { cleared = true; } });
  h.window.PortfolioText.clear(); assert.equal(cleared, true);
});
test('both reading orders and languages expose every original PDF line with valid character positions', () => {
  for (const variant of ['', 'hardware-first/']) for (const name of ['deck.json', 'deck-en.json']) {
    const deck = JSON.parse(readFileSync(new URL('../../portfolio/' + variant + name, import.meta.url), 'utf8'));
    for (const page of deck.pages) {
      const lines = new Map();
      for (const run of page.text_runs) {
        lines.set(run.line, (lines.get(run.line) || '') + run.text);
        assert.equal(Array.from(run.text).length, run.x.length);
        assert.ok(run.x.every(x => x >= 0 && x <= deck.width));
        assert.ok(run.y >= 0 && run.y <= deck.height);
        assert.ok(run.size > 0);
        if (run.link !== null) assert.ok(page.links[run.link]);
      }
      assert.equal([...lines.values()].join('\n') + '\n', page.text, variant + name + ' page ' + page.number);
    }
  }
});
