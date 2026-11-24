/* HTML text with PDF hit boxes: a drag keeps its original anchor even in gaps. */
(() => {
  'use strict';
  const layers = new WeakMap();
  let active = null, pointerSelecting = false, painted = [];
  const selection = () => window.getSelection?.();
  const hasSelection = () => { const value = selection(); return !!value && !value.isCollapsed; };
  const layerFor = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.selectable-text');
  const compare = (a, b) => a.index - b.index || a.offset - b.offset;
  const clamp = (n, max) => Math.max(0, Math.min(n, max));

  function boundary(container, offset, nodes) {
    const index = nodes.findIndex(({ element }) => element === container || element.firstChild === container);
    if (index >= 0) {
      const { element, run } = nodes[index];
      return { index, offset: container === element ? (offset ? run.text.length : 0) : clamp(offset, run.text.length) };
    }
    // Element offsets count child nodes, not characters. Unknown boundaries
    // must not silently fall back to the beginning of the page.
    if (container === nodes[0]?.element.parentElement) {
      const child = container.childNodes[offset];
      if (!child) return { index: nodes.length - 1, offset: nodes.at(-1).run.text.length };
      const childIndex = nodes.findIndex(({ element }) => element === child);
      if (childIndex >= 0) return { index: childIndex, offset: 0 };
    }
    return null;
  }
  function bounds(range, nodes) {
    const start = boundary(range.startContainer, range.startOffset, nodes);
    const end = boundary(range.endContainer, range.endOffset, nodes);
    return start && end && compare(start, end) <= 0 ? { start, end } : null;
  }
  function selectedText(range, nodes) {
    const value = bounds(range, nodes);
    if (!value) return null;
    let output = '', previousLine = null;
    for (let i = value.start.index; i <= value.end.index; i++) {
      const run = nodes[i].run;
      const part = run.text.slice(i === value.start.index ? value.start.offset : 0, i === value.end.index ? value.end.offset : run.text.length);
      if (!part) continue;
      if (previousLine !== null && previousLine !== run.line) output += '\n';
      output += part; previousLine = run.line;
    }
    return output;
  }
  function paint() {
    for (const element of painted) element.style.backgroundImage = '';
    painted = [];
    const value = selection(), layer = layerFor(value?.anchorNode), data = layers.get(layer);
    if (!data || !value.rangeCount || value.isCollapsed || layerFor(value.focusNode) !== layer) return;
    const limits = bounds(value.getRangeAt(0), data.nodes);
    if (!limits) return;
    for (let i = limits.start.index; i <= limits.end.index; i++) {
      const { element, run, offsets } = data.nodes[i];
      const from = i === limits.start.index ? limits.start.offset : 0;
      const to = i === limits.end.index ? limits.end.offset : run.text.length;
      if (from === to) continue;
      const edge = offset => offset >= run.text.length ? run.end : run.x[Math.max(0, offsets.findIndex(n => n >= offset))];
      const left = Math.max(0, edge(from) - run.rect[0]), right = Math.min(run.rect[2], edge(to) - run.rect[0]);
      element.style.backgroundImage = `linear-gradient(to right, transparent ${left}px, #83bb9c80 ${left}px, #83bb9c80 ${right}px, transparent ${right}px)`;
      painted.push(element);
    }
  }
  function caretAt(data, clientX, clientY) {
    const box = data.layer.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const x = (clientX - box.left) * data.width / box.width;
    const y = (clientY - box.top) * data.height / box.height;
    let best = null, distance = Infinity;
    data.nodes.forEach(({ run, offsets }, index) => {
      const [left, top, width, height] = run.rect;
      const dx = Math.max(left - x, 0, x - left - width), dy = Math.max(top - y, 0, y - top - height);
      const score = dx * dx + 4 * dy * dy;
      if (score >= distance) return;
      distance = score;
      const edges = [...run.x, run.end];
      let nearest = 0;
      for (let j = 1; j < edges.length; j++) if (Math.abs(edges[j] - x) < Math.abs(edges[nearest] - x)) nearest = j;
      best = { index, offset: offsets[nearest] ?? run.text.length };
    });
    return best;
  }
  function setRange(data, anchor, focus) {
    const value = selection();
    if (!value?.setBaseAndExtent) return;
    value.setBaseAndExtent(data.nodes[anchor.index].element.firstChild, anchor.offset, data.nodes[focus.index].element.firstChild, focus.offset);
    paint();
  }
  function unit(data, point, mode) {
    const run = data.nodes[point.index].run;
    if (mode === 3) {
      const matching = data.nodes.map(({ run: item }, index) => item.line === run.line ? index : -1).filter(index => index >= 0);
      return { start: { index: matching[0], offset: 0 }, end: { index: matching.at(-1), offset: data.nodes[matching.at(-1)].run.text.length } };
    }
    const offset = Math.min(point.offset, run.text.length - 1);
    const word = [...run.text.matchAll(/[\p{L}\p{N}\p{M}_]+|[^\s]/gu)].find(match => match.index <= offset && offset < match.index + match[0].length);
    return word ? { start: { index: point.index, offset: word.index }, end: { index: point.index, offset: word.index + word[0].length } } : { start: point, end: point };
  }
  function create(page, width, height, wireLink) {
    const layer = document.createElement('div'); layer.className = 'selectable-text';
    layer.style.width = `${width}px`; layer.style.height = `${height}px`; layer.setAttribute('aria-hidden', 'true');
    const data = { layer, width, height, nodes: [] };
    for (const run of page.text_runs) {
      const element = document.createElement('span'); element.className = 'text-run'; element.textContent = run.text;
      const [x, y, w, h] = run.rect;
      element.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;font-size:${run.size}px;line-height:${h}px;font-weight:${run.bold ? 700 : 400}`;
      const offsets = [0]; for (const char of run.text) offsets.push(offsets.at(-1) + char.length);
      layer.append(element); data.nodes.push({ element, run, offsets });
      if (run.link !== null) wireLink(element, run.link);
    }
    layers.set(layer, data);
    layer.addEventListener('pointerdown', () => { pointerSelecting = true; });
    layer.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.sourceCapabilities?.firesTouchEvents || !selection()?.setBaseAndExtent) return;
      const point = caretAt(data, event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      const value = selection();
      const anchor = event.shiftKey && layerFor(value.anchorNode) === layer ? boundary(value.anchorNode, value.anchorOffset, data.nodes) || point : point;
      const mode = Math.min(event.detail || 1, 3), initial = mode > 1 ? unit(data, point, mode) : { start: anchor, end: point };
      active = { data, anchor, mode, initial, x: event.clientX, y: event.clientY, moved: false };
      setRange(data, initial.start, initial.end);
    });
    return layer;
  }
  document.addEventListener('mousemove', event => {
    if (!active) return;
    if (event.buttons === 0) { active = null; return; }
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 2) return;
    active.moved = true; event.preventDefault();
    const point = caretAt(active.data, event.clientX, event.clientY);
    if (!point) return;
    if (active.mode === 1) setRange(active.data, active.anchor, point);
    else {
      const focus = unit(active.data, point, active.mode), backwards = compare(point, active.initial.start) < 0;
      setRange(active.data, backwards ? active.initial.end : active.initial.start, backwards ? focus.start : focus.end);
    }
  });
  const release = () => { active = null; pointerSelecting = false; };
  document.addEventListener('mouseup', release);
  document.addEventListener('pointerup', () => { pointerSelecting = false; });
  document.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  document.addEventListener('selectionchange', paint);
  document.addEventListener('copy', event => {
    const value = selection();
    if (!value?.rangeCount || value.isCollapsed || !event.clipboardData) return;
    const layer = layerFor(value.anchorNode), data = layers.get(layer);
    if (!data || layerFor(value.focusNode) !== layer) return;
    const text = selectedText(value.getRangeAt(0), data.nodes);
    if (text) { event.clipboardData.setData('text/plain', text); event.preventDefault(); }
  });
  function clear() { if (layerFor(selection()?.anchorNode)) selection().removeAllRanges(); release(); paint(); }
  window.PortfolioText = { create, selectedText, hasSelection, isSelecting: () => !!active || pointerSelecting || hasSelection(), clear };
})();
