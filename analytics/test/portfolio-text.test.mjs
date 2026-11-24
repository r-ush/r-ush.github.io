import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';

const source = readFileSync(new URL('../../portfolio/text-layer.js', import.meta.url), 'utf8');
function harness(scale = 1) {
  const { document, window } = parseHTML('<html><body><section id="page"></section><p id="outside">outside</p></body></html>');
  let selection = null;
  window.getSelection = () => selection;
  vm.runInNewContext(source, { document, window });
  const runs = [
    { line: 0, text: '엄승환', x: [10, 22, 34], end: 46, rect: [10, 10, 36, 12], y: 20, size: 12, bold: true, link: null },
    { line: 1, text: 'Robotics portfolio', x: Array.from({ length: 18 }, (_, i) => 10 + i * 5), end: 100, rect: [10, 32, 90, 10], y: 40, size: 10, bold: false, link: 0 }
  ];
  const links = [];
  const layer = window.PortfolioText.create({ text_runs: runs }, 100, 60, (element, link) => links.push(link));
  document.getElementById('page').append(layer);
  layer.getBoundingClientRect = () => ({ left: 100, top: 200, width: 100 * scale, height: 60 * scale });
  const nodes = Array.from(layer.querySelectorAll('.text-run'), element => element.firstChild);
  selection = {
    anchorNode: null, focusNode: null, isCollapsed: true, rangeCount: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
      Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset, rangeCount: 1, isCollapsed: anchorNode === focusNode && anchorOffset === focusOffset });
    },
    getRangeAt() {
      const forward = nodes.indexOf(this.anchorNode) - nodes.indexOf(this.focusNode) || this.anchorOffset - this.focusOffset;
      return forward <= 0 ? { startContainer: this.anchorNode, startOffset: this.anchorOffset, endContainer: this.focusNode, endOffset: this.focusOffset }
        : { startContainer: this.focusNode, startOffset: this.focusOffset, endContainer: this.anchorNode, endOffset: this.anchorOffset };
    },
    removeAllRanges() { this.anchorNode = this.focusNode = null; this.isCollapsed = true; this.rangeCount = 0; }
  };
  function mouse(type, x, y, extra = {}, target = document) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: 100 + x * scale, clientY: 200 + y * scale, button: 0, buttons: 1, detail: 1, ...extra });
    target.dispatchEvent(event); return event;
  }
  const clipboard = {};
  function copy() {
    const event = new window.Event('copy', { bubbles: true, cancelable: true });
    event.clipboardData = { setData: (type, text) => { clipboard[type] = text; } };
    document.dispatchEvent(event); return event;
  }
  return { window, document, layer, nodes, clipboard, copy, links, mouse, getSelection: () => selection,
    down(index, x, y, extra) { return mouse('mousedown', x, y, extra, nodes[index].parentElement); },
    setSelection(value) { selection = value; } };
}
test('HTML text at PDF positions preserves partial multiline and backwards copies', () => {
  const h = harness(), [first, second] = h.nodes;
  assert.equal(h.layer.tagName, 'DIV');
  assert.equal(h.layer.style.width, '100px');
  assert.equal(first.parentElement.style.left, '10px');
  assert.deepEqual(h.links, [0]);
  const range = { startContainer: first, startOffset: 1, endContainer: second, endOffset: 8, intersectsNode: node => h.nodes.includes(node) };
  h.setSelection({ anchorNode: first, focusNode: second, rangeCount: 1, isCollapsed: false, getRangeAt: () => range });
  assert.equal(h.copy().defaultPrevented, true);
  assert.equal(h.clipboard['text/plain'], '승환\nRobotics');
  h.setSelection({ anchorNode: second, focusNode: first, rangeCount: 1, isCollapsed: false, getRangeAt: () => range });
  h.copy(); assert.equal(h.clipboard['text/plain'], '승환\nRobotics', 'backwards drags preserve reading order');
});
test('element boundary offsets select their actual children, never an unintended page prefix', () => {
  const h = harness();
  const range = { startContainer: h.layer, startOffset: 1, endContainer: h.layer, endOffset: 2 };
  h.setSelection({ anchorNode: h.layer, focusNode: h.layer, rangeCount: 1, isCollapsed: false, getRangeAt: () => range });
  h.copy(); assert.equal(h.clipboard['text/plain'], 'Robotics portfolio');
  range.startContainer = h.nodes[1].parentElement; range.startOffset = 0;
  range.endContainer = h.nodes[1]; range.endOffset = 8;
  h.copy(); assert.equal(h.clipboard['text/plain'], 'Robotics');
});
test('a mouse drag keeps its starting character when the pointer leaves glyphs, including at different zooms', () => {
  for (const scale of [0.5, 1, 1.5, 2]) for (const y of [29, 31, 36, 43, 45]) {
    const h = harness(scale);
    assert.equal(h.down(1, 35, 36).defaultPrevented, true);
    h.mouse('mousemove', 65, y);
    assert.equal(h.getSelection().anchorNode, h.nodes[1]);
    assert.equal(h.getSelection().anchorOffset, 5);
    h.copy(); assert.equal(h.clipboard['text/plain'], 'ics po', `scale ${scale}, y ${y}`);
    assert.equal(h.nodes[0].parentElement.style.backgroundImage || '', '', 'earlier line is not highlighted');
    assert.match(h.nodes[1].parentElement.style.backgroundImage, /25px.*55px/);
    h.mouse('mouseup', 65, y, { buttons: 0 });
    h.mouse('mousemove', 0, 0);
    h.copy(); assert.equal(h.clipboard['text/plain'], 'ics po', 'released mouse no longer changes selection');
  }
});
test('backwards and multiline drags, word/line selection and Shift extension keep reading order', () => {
  const h = harness();
  h.down(1, 65, 36); h.mouse('mousemove', 35, 29); h.copy();
  assert.equal(h.clipboard['text/plain'], 'ics po');
  h.mouse('mouseup', 35, 29);
  h.down(0, 22, 16); h.mouse('mousemove', 50, 44); h.copy();
  assert.equal(h.clipboard['text/plain'], '승환\nRobotics');
  h.mouse('mouseup', 50, 44);
  h.down(1, 35, 36, { detail: 2 }); h.copy();
  assert.equal(h.clipboard['text/plain'], 'Robotics');
  h.mouse('mouseup', 35, 36);
  h.down(1, 35, 36, { detail: 3 }); h.copy();
  assert.equal(h.clipboard['text/plain'], 'Robotics portfolio');
  h.mouse('mouseup', 35, 36);
  h.down(1, 35, 36); h.mouse('mouseup', 35, 36);
  h.down(1, 65, 36, { shiftKey: true }); h.copy();
  assert.equal(h.clipboard['text/plain'], 'ics po');
});
test('click jitter does not start a selection, and native touch selection is retained', () => {
  const h = harness();
  h.down(1, 35, 36); h.mouse('mousemove', 36, 36);
  assert.equal(h.getSelection().isCollapsed, true);
  h.mouse('mouseup', 36, 36);
  const event = h.down(1, 65, 36, { sourceCapabilities: { firesTouchEvents: true } });
  assert.equal(event.defaultPrevented, false);
  assert.equal(h.getSelection().anchorOffset, 5);
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
  h.setSelection({ anchorNode: h.nodes[0], focusNode: h.nodes[0], rangeCount: 1, isCollapsed: false, removeAllRanges() { cleared = true; this.rangeCount = 0; this.isCollapsed = true; } });
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
        assert.ok(run.rect.length === 4 && run.rect[2] > 0 && run.rect[3] > 0);
        assert.ok(Math.abs(run.rect[0] + run.rect[2] - run.end) < 0.001);
        if (run.link !== null) assert.ok(page.links[run.link]);
      }
      assert.equal([...lines.values()].join('\n') + '\n', page.text, variant + name + ' page ' + page.number);
    }
  }
});
