/* Lazy-load one shared model payload; animate the three independent homepage views. */
(() => {
  'use strict';
  const section = document.getElementById('graspical-abstract');
  if (!section) return;
  const root = new URL('../../', document.currentScript.src);
  const figures = [...section.querySelectorAll('.ga-pair')];
  const motion = section.querySelector('.ga-motion');
  const heading = section.querySelector('#graspical-title');
  const fallback = section.querySelector('.ga-fallback');
  let paused = false, loading = false, loaded = false, destroyed = false;
  let sectionOpen = heading.dataset.expanded !== 'false';
  let frameId = 0, lastTime = 0;
  let rotationGroups;
  const views = [], byFigure = new Map();
  // Keep fragment links on the current document, including the preview's <base> URL.
  for (const link of section.querySelectorAll('.ga-model-link')) {
    link.href = new URL(link.getAttribute('href'), window.location.href).href;
  }

  function loadScript(relative) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(relative, root).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${relative}`));
      document.head.append(script);
    });
  }
  function schedule() {
    if (!frameId && sectionOpen && !destroyed && !document.hidden && views.some((view) => view.visible && view.needsFrame)) frameId = requestAnimationFrame(frame);
  }
  function frame(time) {
    frameId = 0;
    if (destroyed || document.hidden || !sectionOpen) {lastTime = 0; return;}
    const active = views.filter((view) => view.visible && view.needsFrame);
    if (!active.length) {lastTime = 0; return;}
    // Three views share a 30 fps budget instead of three independent frame loops.
    if (lastTime && time - lastTime < 1000 / 30 - 1) {schedule(); return;}
    const dt = lastTime ? Math.min(.05, (time - lastTime) / 1000) : 1 / 60;
    lastTime = time;
    const steps = Math.max(1, Math.ceil(dt * 60));
    for (let i = 0; i < steps; i++) {
      rotationGroups.advance(dt / steps, active);
      for (const view of active) view.update(dt / steps);
    }
    active.forEach((view) => view.render());
    schedule();
  }
  function updateMotionButton() {
    motion.textContent = paused ? 'Play rotation' : 'Pause rotation';
    motion.setAttribute('aria-pressed', String(paused));
  }
  const visibility = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const view = byFigure.get(entry.target);
      if (!view) continue;
      view.visible = entry.isIntersecting;
      if (!view.visible) {view.pointer.active = false; view.settling = 3;}
      else view.dirty = true;
    }
    lastTime = 0; schedule();
  });

  async function initialize() {
    if (loading || loaded || destroyed || !sectionOpen) return;
    loading = true;
    try {
      await Promise.all([loadScript('particle-lab/models.js'), loadScript('particle-lab/pose-math.js')]);
      await loadScript('particle-lab/transitions.js');
      await loadScript('particle-lab/pair-view.js?v=4');
      if (destroyed) return;
      const models = window.RobotParticlePairs.decodeModels(window.ROBOT_PARTICLE_MODELS);
      rotationGroups = new window.RobotParticlePairs.RotationGroups();
      delete window.ROBOT_PARTICLE_MODELS;
      for (const figure of figures) {
        const child = models.find((model) => model.number === figure.dataset.child);
        const system = models.find((model) => model.number === figure.dataset.system);
        const button = figure.querySelector('.ga-switch');
        const canvas = figure.querySelector('canvas'), poster = figure.querySelector('.ga-poster');
        const title = figure.querySelector('h3').textContent.trim();
        const systemName = {'02': 'RGMC system', '04': 'test-bed system', '06': 'dual-arm system'}[system.number];
        const state = (inSystem, changing) => {
          button.setAttribute('aria-checked', String(inSystem));
          button.setAttribute('aria-disabled', String(changing));
          figure.setAttribute('aria-busy', String(changing));
          canvas.setAttribute('aria-label', inSystem ? `${title} in the ${systemName}` : `Interactive ${title}`);
        };
        const view = new window.RobotParticlePairs.PairView(canvas, child, system, {
          spinning: !paused, color: figure.dataset.color, rotationGroups, onWake: schedule, onState: state,
          childScale: Number(figure.dataset.childScale), systemScale: Number(figure.dataset.systemScale),
          onAvailability(available) {
            figure.classList.toggle('ga-unavailable', !available); button.disabled = !available;
            poster.setAttribute('aria-hidden', String(available));
            if (available) schedule();
          }
        });
        views.push(view); byFigure.set(figure, view);
        button.disabled = false;
        button.addEventListener('click', () => {view.toggle(); schedule();});
        figure.classList.add('ga-ready'); poster.setAttribute('aria-hidden', 'true');
        visibility?.observe(figure);
      }
      loaded = true; motion.disabled = false; updateMotionButton(); schedule();
    } catch (error) {
      console.error('Graspical Abstract:', error);
      fallback.hidden = false;
      for (const view of views) view.dispose();
      figures.forEach((figure) => {figure.classList.remove('ga-ready'); figure.querySelector('.ga-switch').disabled = true; figure.querySelector('.ga-poster').setAttribute('aria-hidden', 'false');});
    } finally {loading = false;}
  }
  motion.addEventListener('click', () => {
    paused = !paused; updateMotionButton(); views.forEach((view) => view.setSpinning(!paused)); schedule();
  });
  heading.addEventListener('sectiontoggle', (event) => {
    sectionOpen = event.detail.open; motion.hidden = !sectionOpen;
    cancelAnimationFrame(frameId); frameId = 0; lastTime = 0;
    views.forEach((view) => {view.pointer.active = false; view.settling = 3;});
    if (sectionOpen) {initialize(); schedule();}
  });
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frameId); frameId = 0; lastTime = 0;
    views.forEach((view) => {view.pointer.active = false; view.settling = 3;});
    if (!document.hidden) schedule();
  });
  window.addEventListener('pagehide', (event) => {
    cancelAnimationFrame(frameId); frameId = 0;
    if (event.persisted) return;
    destroyed = true; visibility?.disconnect(); warmup?.disconnect(); views.forEach((view) => view.dispose());
  });
  window.addEventListener('pageshow', () => {lastTime = 0; schedule();});
  const warmup = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {warmup.disconnect(); initialize();}
  }, {rootMargin: '300px 0px'});
  if (warmup) warmup.observe(section);
  else initialize();
})();
