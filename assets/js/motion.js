/* Transitions.dev orchestration adapted for native details and existing controls.
 * CSS recipes: https://github.com/Jakubantalik/transitions.dev
 */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const duration = (element, name, fallback) => {
    if (reduced.matches) return 0;
    const value = getComputedStyle(element).getPropertyValue(name).trim();
    const number = parseFloat(value);
    return Number.isFinite(number) ? number * (value.endsWith('ms') ? 1 : 1000) : fallback;
  };

  function accordion(details, index) {
    const head = details.querySelector(':scope > summary');
    if (!head || details.classList.contains('t-acc')) return;
    const panel = document.createElement('div');
    const inner = document.createElement('div');
    panel.className = 't-acc-panel';
    inner.className = 't-acc-panel-inner';
    panel.id = `${details.id || `disclosure-${index}`}-panel`;
    while (head.nextSibling) inner.append(head.nextSibling);
    panel.append(inner);
    details.append(panel);
    details.classList.add('t-acc');
    head.setAttribute('aria-controls', panel.id);
    head.querySelector('.principle-icon, .setup-toggle-icon')?.classList.add('t-acc-chevron');
    let timer, closing = false;
    function state(open) {
      details.dataset.open = String(open);
      head.setAttribute('aria-expanded', String(open));
      panel.inert = !open;
    }
    state(details.open);
    function setOpen(open) {
      clearTimeout(timer);
      closing = !open;
      if (open) {
        details.open = true;
        void panel.offsetHeight;
        state(true);
      } else {
        if (panel.contains(document.activeElement)) head.focus({preventScroll: true});
        state(false);
        const finish = () => { details.open = false; closing = false; };
        const ms = duration(details, '--acc-collapse', 250);
        if (ms) timer = setTimeout(finish, ms);
        else finish();
      }
      // Existing media handlers also pause during the closing animation.
      details.dispatchEvent(new Event('toggle'));
    }
    head.addEventListener('click', event => {
      event.preventDefault();
      setOpen(details.dataset.open !== 'true');
    });
    details.addEventListener('toggle', () => {
      if (!closing && details.open !== (details.dataset.open === 'true')) setOpen(details.open);
    });
    reduced.addEventListener('change', () => {
      if (reduced.matches && closing) { clearTimeout(timer); details.open = false; closing = false; }
    });
  }

  function slidingTabs(bar) {
    if (bar.classList.contains('t-tabs')) return;
    const tabs = [...bar.querySelectorAll(':scope > button')];
    if (!tabs.length) return;
    bar.classList.add('t-tabs');
    tabs.forEach(tab => tab.classList.add('t-tab'));
    const pill = document.createElement('span');
    pill.className = 't-tabs-pill';
    pill.setAttribute('aria-hidden', 'true');
    bar.prepend(pill);
    const active = () => tabs.find(tab => tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('aria-pressed') === 'true') || tabs[0];
    function move(animate) {
      const tab = active();
      if (!tab.offsetWidth) return;
      if (!animate) pill.style.transition = 'none';
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
      pill.style.width = `${tab.offsetWidth}px`;
      pill.style.top = `${tab.offsetTop}px`;
      pill.style.height = `${tab.offsetHeight}px`;
      if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
    }
    const observer = new MutationObserver(() => move(true));
    tabs.forEach(tab => observer.observe(tab, {attributes: true, attributeFilter: ['aria-selected', 'aria-pressed']}));
    const resize = new ResizeObserver(() => move(false));
    resize.observe(bar);
    tabs.forEach(tab => resize.observe(tab));
    document.fonts?.ready.then(() => move(false));
    move(false);
  }

  const panelFrames = new WeakMap();
  function reveal(panel) {
    cancelAnimationFrame(panelFrames.get(panel));
    panel.classList.add('t-panel-slide');
    panel.dataset.open = 'false';
    panel.style.transition = 'none';
    void panel.offsetHeight;
    panel.style.transition = '';
    if (reduced.matches) panel.dataset.open = 'true';
    else panelFrames.set(panel, requestAnimationFrame(() => { panel.dataset.open = 'true'; }));
  }
  window.PageMotion = {duration, reduced, accordion, slidingTabs, reveal};
})();

/* Portfolio integration for the Transitions.dev accordion, modal and text swap. */
(() => {
  'use strict';
  const {duration, reduced} = window.PageMotion;
  const headings = [...document.querySelectorAll('h2[data-section]')];
  const sections = new Map();
  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    const items = [...document.querySelectorAll('.collapsible-item')].filter(item =>
      (heading.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (!next || (item.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING)));
    const containers = items.map((item, itemIndex) => {
      let container = item;
      if (item.tagName === 'TR') {
        [...item.cells].forEach(cell => {
          const content = document.createElement('div');
          content.className = 'motion-cell-content';
          content.style.padding = getComputedStyle(cell).padding;
          while (cell.firstChild) content.append(cell.firstChild);
          const inner = document.createElement('div');
          inner.className = 't-acc-panel-inner';
          inner.append(content);
          const panel = document.createElement('div');
          panel.className = 't-acc-panel';
          panel.append(inner);
          cell.style.padding = '0';
          cell.append(panel);
        });
      } else {
        container = document.createElement('div');
        const panel = document.createElement('div');
        const inner = document.createElement('div');
        panel.className = 't-acc-panel';
        inner.className = 't-acc-panel-inner';
        item.before(container);
        inner.append(item);
        panel.append(inner);
        container.append(panel);
      }
      container.classList.add('t-acc');
      container.dataset.open = 'false';
      container.id = `section-${heading.dataset.section}-${itemIndex}`;
      container.inert = true;
      container.setAttribute('aria-hidden', 'true');
      item.classList.add('motion-ready');
      return container;
    });
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'section-heading-button';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', containers.map(item => item.id).join(' '));
    while (heading.firstChild) trigger.append(heading.firstChild);
    heading.append(trigger);
    sections.set(heading.dataset.section, {heading, trigger, containers, open: false});
  });
  function setSection(name, open) {
    const section = sections.get(name);
    if (!section) return;
    section.open = open;
    section.heading.dataset.expanded = String(open);
    section.trigger.setAttribute('aria-expanded', String(open));
    section.containers.forEach(container => {
      if (!open && container.contains(document.activeElement)) section.trigger.focus({preventScroll: true});
      container.inert = !open;
      container.setAttribute('aria-hidden', String(!open));
      container.dataset.open = String(open);
      if (!open) container.querySelectorAll('video').forEach(video => video.pause());
    });
  }
  window.toggleSection = name => setSection(name, !sections.get(name).open);
  window.expandAllSections = () => sections.forEach((section, name) => setSection(name, true));
  window.collapseAllSections = () => sections.forEach((section, name) => setSection(name, false));

  const name = document.querySelector('.rush-name');
  const short = name.querySelector('.rush-short');
  const full = name.querySelector('.rush-full');
  const display = document.createElement('span');
  display.className = 'rush-display t-text-swap';
  display.setAttribute('aria-hidden', 'true');
  display.append(...[...short.childNodes].map(node => node.cloneNode(true)));
  name.append(display);
  let textTimer, shown = false;
  function expandName(expanded) {
    name.setAttribute('aria-expanded', String(expanded));
    clearTimeout(textTimer);
    if (shown === expanded) { display.classList.remove('is-exit', 'is-enter-start'); return; }
    function swap() {
      shown = expanded;
      display.replaceChildren(...[...(expanded ? full : short).childNodes].map(node => node.cloneNode(true)));
      display.classList.remove('is-exit');
      display.classList.add('is-enter-start');
      void display.offsetHeight;
      display.classList.remove('is-enter-start');
    }
    if (reduced.matches) swap();
    else { display.classList.add('is-exit'); textTimer = setTimeout(swap, duration(name, '--text-swap-dur', 150)); }
  }
  name.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') expandName(true); });
  name.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') expandName(false); });
  name.addEventListener('click', e => { if (e.pointerType !== 'mouse') expandName(name.getAttribute('aria-expanded') !== 'true'); });
  name.addEventListener('blur', () => expandName(false));
  name.addEventListener('keydown', e => { if (e.key === 'Escape') expandName(false); });

  const overlay = document.getElementById('cv-popup-overlay');
  const box = document.getElementById('cv-popup-box');
  const close = document.getElementById('cv-popup-close');
  const image = document.getElementById('cv-popup-open');
  let isOpen = false, modalTimer, previousFocus, previousOverflow;
  function openModal() {
    clearTimeout(modalTimer);
    previousFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;
    overlay.hidden = false;
    overlay.inert = false;
    overlay.setAttribute('aria-hidden', 'false');
    box.classList.remove('is-closing');
    void box.offsetWidth;
    box.classList.add('is-open');
    overlay.classList.remove('cv-popup-hidden');
    document.body.style.overflow = 'hidden';
    isOpen = true;
    close.focus({preventScroll: true});
  }
  function closeModal() {
    if (!isOpen) return;
    isOpen = false;
    // This dialog opens automatically, so there may be no trigger to return to.
    // Do not focus the unrelated name button and leave its focus ring visible.
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected &&
        previousFocus !== document.body && !overlay.contains(previousFocus)) {
      previousFocus.focus({preventScroll: true});
    } else if (overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    overlay.inert = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.add('cv-popup-hidden');
    box.classList.remove('is-open');
    box.classList.add('is-closing');
    document.body.style.overflow = previousOverflow;
    const finish = () => { overlay.hidden = true; box.classList.remove('is-closing'); };
    const ms = duration(box, '--modal-close-dur', 150);
    if (ms) modalTimer = setTimeout(finish, ms);
    else finish();
  }
  close.addEventListener('click', closeModal);
  image.addEventListener('click', () => { window.open('images/cv_abstract.png?v=aedac388', '_blank', 'noopener'); closeModal(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => {
    if (!isOpen) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Tab' && ((e.shiftKey && document.activeElement === image) || (!e.shiftKey && document.activeElement === close))) {
      e.preventDefault(); (e.shiftKey ? close : image).focus();
    }
  });
  requestAnimationFrame(() => requestAnimationFrame(openModal));
})();
