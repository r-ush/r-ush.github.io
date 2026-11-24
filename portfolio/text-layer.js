/* Native selectable SVG text; the existing outlined page remains the visual source. */
(() => {
  'use strict';
  const namespace = 'http://www.w3.org/2000/svg', layers = new WeakMap();
  let pointerSelecting = false;
  const selection = () => window.getSelection?.();
  const hasSelection = () => { const value = selection(); return !!value && !value.isCollapsed; };
  const layerFor = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.selectable-text');
  function selectedText(range, nodes) {
    let output = '', previousLine = null;
    for (const { element, run } of nodes) {
      const node = element.firstChild;
      if (!node || !range.intersectsNode(node)) continue;
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : run.text.length;
      const part = run.text.slice(start, end);
      if (!part) continue;
      if (previousLine !== null && previousLine !== run.line) output += '\n';
      output += part; previousLine = run.line;
    }
    return output;
  }
  function create(page, width, height, wireLink) {
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('class', 'selectable-text'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    const nodes = [];
    for (const run of page.text_runs) {
      const element = document.createElementNS(namespace, 'text');
      element.setAttribute('x', run.x.join(' ')); element.setAttribute('y', String(run.y));
      element.setAttribute('font-size', String(run.size)); element.setAttribute('font-weight', run.bold ? '700' : '400');
      element.setAttribute('xml:space', 'preserve'); element.textContent = run.text;
      if (run.link !== null) wireLink(element, run.link);
      svg.append(element); nodes.push({ element, run });
    }
    layers.set(svg, nodes);
    svg.addEventListener('pointerdown', () => { pointerSelecting = true; });
    return svg;
  }
  document.addEventListener('pointerup', () => { pointerSelecting = false; });
  document.addEventListener('pointercancel', () => { pointerSelecting = false; });
  window.addEventListener('blur', () => { pointerSelecting = false; });
  document.addEventListener('copy', event => {
    const value = selection();
    if (!value?.rangeCount || value.isCollapsed || !event.clipboardData) return;
    const layer = layerFor(value.anchorNode);
    if (!layer || layerFor(value.focusNode) !== layer || !layers.has(layer)) return;
    const text = selectedText(value.getRangeAt(0), layers.get(layer));
    if (text) { event.clipboardData.setData('text/plain', text); event.preventDefault(); }
  });
  function clear() { if (layerFor(selection()?.anchorNode)) selection().removeAllRanges(); pointerSelecting = false; }
  window.PortfolioText = { create, selectedText, hasSelection, isSelecting: () => pointerSelecting || hasSelection(), clear };
})();
