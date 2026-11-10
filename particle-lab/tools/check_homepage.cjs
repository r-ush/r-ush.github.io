const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {pathToFileURL, fileURLToPath} = require('node:url');
const root = path.resolve(__dirname, '../..');

async function fixture({reduced = false, fail = false, isolated = false} = {}) {
  const views = [], observers = [], frames = new Map(), errors = [], requests = [];
  let nextFrame = 0;
  function element() {
    const classes = new Set();
    return {attributes: {}, handlers: {}, disabled: true, hidden: true, textContent: '', innerHTML: '',
      classList: {add(k) {classes.add(k);}, remove(k) {classes.delete(k);}, contains(k) {return classes.has(k);},
        toggle(k, enabled) {if (enabled) classes.add(k); else classes.delete(k);}},
      setAttribute(k, v) {this.attributes[k] = v;},
      getAttribute(k) {return this.attributes[k];},
      addEventListener(k, f) {this.handlers[k] = f;}, removeEventListener(k) {delete this.handlers[k];},
      getBoundingClientRect() {return {width: 340, height: 310, left: 0, top: 0};},
      getContext(type) {
        if (type === 'webgl') return null;
        return this.context2d ||= {colors: new Set(), setTransform() {}, clearRect() {this.colors.clear();},
          fillRect(x, y, w, h) {assert.ok(Number.isFinite(x + y + w + h)); this.colors.add(this.fillStyle);}};
      }
    };
  }
  const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const start = homepage.indexOf('<section id="graspical-abstract"');
  const sectionMarkup = homepage.slice(start, homepage.indexOf('</section>', start) + 10);
  const figures = [...sectionMarkup.matchAll(/<figure[^>]*data-child="(\d+)" data-system="(\d+)" data-color="([^"]+)"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((match) => {
    const figure = element();
    figure.dataset = {child: match[1], system: match[2], color: match[3]};
    figure.dataset.childScale = match[0].match(/data-child-scale="([^"]+)"/)[1];
    figure.dataset.systemScale = match[0].match(/data-system-scale="([^"]+)"/)[1];
    const nodes = Object.fromEntries(['.ga-switch', 'canvas', '.ga-poster', 'h3'].map((s) => [s, element()]));
    nodes.h3.textContent = match[4].replace(/<[^>]+>/g, '');
    figure.querySelector = (s) => nodes[s];
    return figure;
  });
  assert.equal(figures.length, 3);
  const section = element(), motion = element(), fallback = element(), heading = element();
  const links = [...sectionMarkup.matchAll(/<a class="ga-model-link" href="([^"]+)"/g)].map((match) => {
    const link = element(); link.attributes.href = match[1];
    assert.ok(homepage.includes(`id="${match[1].slice(1)}"`), 'link destination exists in the homepage');
    return link;
  });
  heading.dataset = {expanded: 'true'};
  section.querySelectorAll = (s) => s === '.ga-model-link' ? links : figures;
  section.querySelector = (s) => s === '.ga-motion' ? motion : s === '#graspical-title' ? heading : fallback;
  const document = {...element(), hidden: false, currentScript: {src: pathToFileURL(path.join(root, 'assets/js/graspical-abstract.js')).href},
    getElementById: () => section, createElement: element};
  const window = {...element(), devicePixelRatio: 2, matchMedia: () => ({matches: reduced}),
    location: {href: pathToFileURL(path.join(root, 'particle-lab/home-preview.html')).href}};
  const context = vm.createContext({window, document, URL, console: {error(...args) {errors.push(args);}},
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    ResizeObserver: class {observe() {} disconnect() {}},
    IntersectionObserver: class {
      constructor(callback, options) {this.callback = callback; this.options = options; this.nodes = []; observers.push(this);}
      observe(node) {this.nodes.push(node);} disconnect() {this.disconnected = true;}
    },
    requestAnimationFrame(callback) {frames.set(++nextFrame, callback); return nextFrame;},
    cancelAnimationFrame(id) {frames.delete(id);}
  });
  document.head = {append(script) {
    requests.push(script.src);
    queueMicrotask(() => {
      if (fail) {script.onerror(); return;}
      vm.runInContext(fs.readFileSync(fileURLToPath(script.src), 'utf8'), context, {filename: script.src});
      if (new URL(script.src).pathname.endsWith('/pair-view.js')) {
        const api = window.RobotParticlePairs;
        window.RobotParticlePairs = {...api, PairView: class extends api.PairView {
          constructor(canvas, child, system, options) {
            super(canvas, child, system, isolated ? {...options, rotationGroups: null} : options);
            views.push(this);
          }
        }};
      }
      script.onload();
    });
  }};
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/graspical-abstract.js'), 'utf8'), context);
  assert.equal(requests.length, 0, 'asset download must wait until near viewport');
  observers.find((o) => o.options).callback([{target: section, isIntersecting: true}]);
  for (let i = 0; i < 10; i++) await new Promise(setImmediate);
  function frame(time) {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn(time));
  }
  return {window, document, section, heading, figures, links, motion, fallback, observers, views, frames, errors, requests, frame, sectionMarkup};
}

function finish(view, seconds) {
  const spin = view.spin;
  const partOffset = view.system.attachment.mask.findIndex((group) => group > 0) * 8 + 7;
  let lastPart = view.display[partOffset];
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames - 1; i++) {
    const beforeZoom = view.zoom;
    view.update(1 / 60);
    const part = view.display[partOffset];
    assert.ok(part >= 0 && part <= 1 && Math.abs(part - lastPart) < .03, 'component color must fade smoothly');
    assert.ok(view.current === view.system ? part >= lastPart : part <= lastPart, 'color follows docking/extraction direction');
    lastPart = part;
    assert.ok(Math.abs(view.zoom - beforeZoom) < .01, 'zoom must change smoothly while docking');
    assert.ok(view.zoom >= Math.min(view.childScale, view.systemScale) - 1e-12 && view.zoom <= Math.max(view.childScale, view.systemScale) + 1e-12);
  }
  assert.ok(view.transition, 'must not finish early');
  view.update(1 / 60 + 1e-10);
  assert.equal(view.transition, null, 'must finish at requested duration');
  assert.equal(view.spin, spin, 'hold viewing angle while docking');
  assert.ok(Math.abs(view.zoom - (view.current === view.child ? view.childScale : view.systemScale)) < 1e-12);
  assert.ok(Math.abs(view.viewport.scale / view.viewport.baseScale - view.zoom) < 1e-12);
  assert.ok(view.display.every(Number.isFinite));
  assert.ok(view.opacity.every((alpha) => alpha === 1));
  let error = 0;
  for (let i = 0; i < view.shape.length; i++) error = Math.max(error, Math.abs(view.shape[i] - view.current.posed[i]));
  assert.ok(error < .00006, `endpoint error ${error}`);
  view.render();
  checkPartColors(view, view.current === view.system);
  return error;
}

function checkPartColors(view, inSystem) {
  assert.equal(view.display.length, view.count * 8);
  for (let i = 0; i < view.count; i++) {
    const expected = inSystem && view.system.attachment.mask[i] > 0 ? 1 : 0;
    assert.equal(view.display[i * 8 + 7], expected, 'only registered components receive the accent, including both hands');
  }
  assert.equal(view.canvas.context2d.colors.size, inSystem ? 2 : 1, 'Canvas fallback uses the component colors');
  if (inSystem) assert.ok(view.canvas.context2d.colors.has(`rgb(${view.partColor.map((value) => Math.round(value * 255)).join(',')})`));
}

async function run() {
  // Exercise each pair's physics/timing in isolation, then the real shared-clock controller below.
  const h = await fixture({isolated: true});
  assert.deepEqual(h.errors, []);
  assert.equal(h.requests.length, 4);
  assert.ok(h.requests.every((url) => url.startsWith('file:')));
  assert.equal(h.window.ROBOT_PARTICLE_MODELS, undefined, 'release base64 payload after decoding');
  assert.deepEqual(h.views.map((view) => view.current.number), ['01', '03', '05']);
  assert.ok(h.views.every((view) => view.count === 16000 && view.spinEnabled));
  assert.ok(!/ga-swatch|ga-palette/.test(h.sectionMarkup));
  assert.ok(h.views.every((view) => view.partColor.map((value) => Math.round(value * 255)).join(',') === '57,125,224'));
  h.views.forEach((view) => checkPartColors(view, false));
  assert.equal(h.views[2].child.pose.roll, 86.98);
  assert.equal(h.views[1].system.pose.roll, 91.97);
  assert.ok(h.figures.every((figure) => figure.classList.contains('ga-ready')));
  assert.deepEqual(h.figures.map((figure) => figure.querySelector('h3').textContent), ['ReC-Gripper', 'PALM-Gripper', 'Robotic hand']);
  assert.equal([...h.sectionMarkup.matchAll(/role="switch" aria-checked="false"/g)].length, 3);
  assert.ok(!h.sectionMarkup.includes('Show system'));
  assert.ok(!/end effector|Hover to scatter|ga-view-label/i.test(h.sectionMarkup));
  assert.deepEqual(h.links.map((link) => new URL(link.href).hash), ['#rec-gripper', '#palm-gripper', '#scooping-robotic-hand']);
  assert.ok(h.links.every((link) => link.href.split('#')[0] === h.window.location.href), 'preview links stay in the current page despite its base URL');
  assert.deepEqual(h.views.map((view) => view.requestedChildScale), [1.5114, 1.5956, 1]);
  assert.deepEqual(h.views.map((view) => view.requestedSystemScale), [1.2269, 1.5834, 1.3]);
  for (const view of h.views) {
    assert.ok(view.childScale >= view.requestedChildScale * .95 && view.childScale <= view.requestedChildScale);
    assert.ok(view.systemScale >= view.requestedSystemScale * .95 && view.systemScale <= view.requestedSystemScale);
    const desktop = [view.childScale, view.systemScale], getRect = view.canvas.getBoundingClientRect;
    view.canvas.getBoundingClientRect = () => ({width: 196, height: 310, left: 0, top: 0});
    view.resize();
    assert.ok(view.childScale <= desktop[0] && view.systemScale <= desktop[1], 'narrow views fit the larger geometry');
    assert.equal(view.zoom, view.childScale);
    const fittedScale = view.viewport.scale;
    view.update(1 / 60);
    assert.equal(view.viewport.scale, fittedScale, 'idle rotation does not change the fitted scale');
    view.canvas.getBoundingClientRect = getRect; view.resize();
    assert.deepEqual([view.childScale, view.systemScale], desktop, 'widening restores the larger requested size');
  }
  const errors = [];
  for (let i = 0; i < 3; i++) {
    const view = h.views[i], figure = h.figures[i], button = figure.querySelector('.ga-switch');
    const before = h.views.map((v) => v.current.number);
    button.handlers.click();
    assert.equal(view.current.number, figure.dataset.system);
    h.views.forEach((v, j) => {if (i !== j) assert.equal(v.current.number, before[j], 'buttons must remain independent');});
    assert.equal(button.attributes['aria-disabled'], 'true');
    assert.equal(button.attributes['aria-checked'], 'true');
    assert.equal(button.innerHTML, '', 'switch remains text-free during transitions');
    assert.equal(view.toggle(), false, 'ignore repeated clicks while docking');
    errors.push(finish(view, i === 2 ? 3.2 : 2.4));
    assert.equal(button.attributes['aria-disabled'], 'false');
    const spin = view.spin; view.update(1 / 60); assert.ok(Math.abs(view.spin - spin - .336 / 60) < 1e-12, 'rotation speed is doubled');
    button.handlers.click(); errors.push(finish(view, i === 2 ? 3.2 : 2.4));
    assert.equal(button.attributes['aria-checked'], 'false');
  }
  // Mirror point identities and reflection must survive the shared 16k decode.
  const hand = h.views[2], transition = h.window.RobotTransitions.create(hand.child, hand.system, hand.child.posed, hand.opacity);
  const points = new Float32Array(hand.shape.length), opacity = new Float32Array(hand.count);
  transition.sample(.4, points, opacity);
  const view = h.window.RobotPoseMath.viewRotation(), attachment = hand.system.attachment;
  let mirrors = 0, mirrorError = 0;
  for (let i = 0; i < hand.count; i++) if (attachment.mask[i] === 2) {
    const j = attachment.mirror.sourceIndices[i];
    assert.equal(attachment.mask[j], 1);
    const camera = (index, axis) => view[axis * 3] * points[index * 6] + view[axis * 3 + 1] * points[index * 6 + 1] + view[axis * 3 + 2] * points[index * 6 + 2];
    mirrorError = Math.max(mirrorError, Math.abs(camera(i, 0) + camera(j, 0)), Math.abs(camera(i, 1) - camera(j, 1)), Math.abs(camera(i, 2) - camera(j, 2)));
    mirrors++;
  }
  assert.ok(mirrors > 4000, 'retain a dense mirrored hand in the 16k subset'); assert.ok(mirrorError < 2e-6);
  h.motion.handlers.click();
  assert.ok(h.views.every((v) => !v.spinEnabled));
  assert.equal(h.motion.textContent, 'Play rotation');
  hand.toggle(); errors.push(finish(hand, 3.2));
  hand.pointer = {active: true, x: hand.viewport.cx, y: hand.viewport.cy};
  for (let i = 0; i < 60; i++) hand.update(1 / 60);
  assert.ok(hand.glow.some((value) => value > 0), 'hover must scatter nearby particles');
  assert.ok(hand.display.every(Number.isFinite));
  hand.render(); checkPartColors(hand, true);
  hand.canvas.handlers.pointerleave();
  for (let i = 0; i < 181; i++) hand.update(1 / 60);
  hand.render(); assert.equal(!!hand.needsFrame, false, 'paused view should sleep after settling');
  h.motion.handlers.click();
  const visibility = h.observers.find((o) => !o.options);
  visibility.callback(h.figures.map((target) => ({target, isIntersecting: false})));
  const spins = h.views.map((v) => v.spin);
  h.frame(1000); assert.equal(h.frames.size, 0);
  assert.deepEqual(h.views.map((v) => v.spin), spins);
  visibility.callback([{target: h.figures[0], isIntersecting: true}]);
  h.frame(1100); assert.ok(h.views[0].spin > spins[0]); assert.equal(h.views[1].spin, spins[1]);
  h.document.hidden = true; h.document.handlers.visibilitychange(); assert.equal(h.frames.size, 0);
  h.document.hidden = false; h.document.handlers.visibilitychange(); assert.ok(h.frames.size > 0);
  // The shared portfolio accordion emits this for both heading clicks and Collapse all.
  h.heading.handlers.sectiontoggle({detail: {open: false}});
  assert.equal(h.frames.size, 0); assert.equal(h.motion.hidden, true);
  const collapsedSpin = h.views[0].spin;
  h.frame(1200); assert.equal(h.views[0].spin, collapsedSpin);
  h.heading.handlers.sectiontoggle({detail: {open: true}});
  assert.equal(h.motion.hidden, false); assert.ok(h.frames.size > 0);
  h.frame(1300); assert.ok(h.views[0].spin > collapsedSpin);
  let prevented = false;
  hand.canvas.handlers.webglcontextlost({preventDefault() {prevented = true;}});
  assert.ok(prevented); assert.equal(!!hand.needsFrame, false); assert.equal(hand.toggle(), false);
  assert.ok(h.figures[2].classList.contains('ga-unavailable'));
  hand.canvas.handlers.webglcontextrestored(); assert.equal(hand.lost, false);
  h.window.handlers.pagehide({persisted: false}); assert.ok(h.views.every((v) => v.disposed)); assert.equal(h.frames.size, 0);

  const reduced = await fixture({reduced: true, isolated: true});
  assert.deepEqual(reduced.errors, []);
  assert.ok(reduced.views.every((v) => !v.spinEnabled));
  assert.equal(reduced.motion.attributes['aria-pressed'], 'true');
  reduced.figures[0].querySelector('.ga-switch').handlers.click();
  errors.push(finish(reduced.views[0], 2.4));
  const failed = await fixture({fail: true});
  assert.equal(failed.fallback.hidden, false); assert.equal(failed.views.length, 0);
  assert.ok(failed.figures.every((f) => !f.classList.contains('ga-ready') && f.querySelector('.ga-switch').disabled));
  const preview = fs.readFileSync(path.join(root, 'particle-lab/home-preview.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(preview.includes(h.sectionMarkup), 'local preview must use the exact homepage component');
  assert.ok(preview.includes('data-local-preview') && preview.includes('Seunghwan Um') && preview.includes('Expand all') && preview.includes('id="awards"'), 'preview includes the full portfolio');
  for (const match of h.sectionMarkup.matchAll(/src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, match[1])));
  const synchronizedRotation = await checkSynchronization();
  return {pairs: '01↔02, 03↔04, 05↔06', durations: [2.4, 2.4, 3.2], maxEndpointError: Math.max(...errors), mirrorError,
    independentSwitches: 'OK', localScriptLoading: 'OK', modelLinks: 'OK', modelScalesAndSmoothZoom: 'OK', componentColorsAndBothHands: 'OK', fixedBlueAccent: 'OK', synchronizedRotation, colorFadeAndHover: 'OK', doubledRotation: 'OK', hover: 'OK', pauseAndVisibility: 'OK', sectionCollapseAndResume: 'OK', fullPortfolioPreview: 'OK', reducedMotion: 'OK', fallbackAndContextRecovery: 'OK'};
}

async function checkSynchronization() {
  const h = await fixture();
  assert.deepEqual(h.errors, []);
  const [rec, palm, hand] = h.views, clock = rec.rotationGroups;
  assert.ok(clock && h.views.every((view) => view.rotationGroups === clock));
  h.frame(1000); h.frame(1040);
  assert.ok(h.views.every((view) => view.spin === rec.spin));
  assert.ok(Math.abs(rec.spin - .336 * (1 / 60 + .04)) < 1e-12, 'clock advances once per frame, not once per model');
  const sample = (view, progress) => {view.progress = progress; view.update(0); view.render();};
  const tick = (dt) => {clock.advance(dt, h.views); h.views.forEach((view) => view.update(0));};
  const finishJoin = (view) => {
    sample(view, 1);
    assert.equal(view.transition, null);
    assert.equal(view.spin, clock.angle(view.current === view.system));
    assert.equal(view.alignmentStrength, 0);
    checkPartColors(view, view.current === view.system);
    const m = h.window.RobotPoseMath.viewRotation(view.spin);
    let error = 0;
    for (let i = 0; i < view.count; i++) for (let axis = 0; axis < 3; axis++) {
      const b = i * 6, r = axis * 3;
      const target = m[r] * view.current.posed[b] + m[r + 1] * view.current.posed[b + 1] + m[r + 2] * view.current.posed[b + 2];
      error = Math.max(error, Math.abs(view.display[i * 8 + axis] - target));
    }
    assert.ok(error < .00006, 'visible geometry reaches the shared viewing angle without spring lag');
  };
  rec.toggle(); assert.equal(rec.toggle(), false);
  h.frame(1080);
  assert.equal(palm.spin, hand.spin);
  tick(1); sample(rec, .70);
  assert.ok(rec.alignmentStrength > 0 && rec.display.every(Number.isFinite), 'splat while aligning to the target group');
  finishJoin(rec);
  palm.toggle(); tick(.6); sample(palm, .7); finishJoin(palm);
  rec.update(0); assert.equal(rec.spin, palm.spin, 'staggered system switches end at the same angle');
  hand.toggle(); const splitSpin = hand.spin; sample(hand, .4);
  assert.equal(hand.spin, splitSpin); assert.equal(hand.alignmentStrength, 0, 'hold the view during mirrored-hand duplication');
  const m = h.window.RobotPoseMath.viewRotation(hand.spin), link = hand.system.attachment;
  let mirrorError = 0;
  const camera = (index, axis) => m[axis * 3] * hand.shape[index * 6] + m[axis * 3 + 1] * hand.shape[index * 6 + 1] + m[axis * 3 + 2] * hand.shape[index * 6 + 2];
  for (let i = 0; i < hand.count; i++) if (link.mask[i] === 2) {
    const source = link.mirror.sourceIndices[i];
    mirrorError = Math.max(mirrorError, Math.abs(camera(i, 0) + camera(source, 0)), Math.abs(camera(i, 1) - camera(source, 1)), Math.abs(camera(i, 2) - camera(source, 2)));
  }
  assert.ok(mirrorError < 2e-6);
  tick(.9); sample(hand, .7); assert.ok(hand.alignmentStrength > 0); finishJoin(hand);
  h.views.forEach((view) => view.update(0));
  assert.ok(h.views.every((view) => view.spin === rec.spin));
  const stoppedAngles = {...clock.angles}; h.motion.handlers.click(); h.frame(5000);
  assert.equal(clock.angle(false), stoppedAngles.effector); assert.equal(clock.angle(true), stoppedAngles.system);
  rec.toggle(); sample(rec, .7); finishJoin(rec);
  palm.toggle(); finishJoin(palm);
  assert.equal(rec.spin, palm.spin, 'extracted end effectors rejoin their own clock');
  assert.notEqual(rec.spin, hand.spin, 'system and effector clocks remain separate');
  h.motion.handlers.click();
  const observer = h.observers.find((item) => !item.options);
  observer.callback([{target: h.figures[0], isIntersecting: false}]);
  const hiddenSpin = rec.spin; h.frame(5040); h.frame(5080);
  assert.equal(rec.spin, hiddenSpin); assert.ok(palm.spin > hiddenSpin);
  observer.callback([{target: h.figures[0], isIntersecting: true}]); h.frame(5120);
  assert.equal(rec.spin, palm.spin, 'offscreen views rejoin the group on return');
  h.heading.handlers.sectiontoggle({detail: {open: false}});
  const closedAngles = {...clock.angles}; h.frame(5160);
  assert.equal(clock.angle(false), closedAngles.effector); assert.equal(clock.angle(true), closedAngles.system);
  h.heading.handlers.sectiontoggle({detail: {open: true}}); h.frame(5200);
  assert.equal(rec.spin, palm.spin);
  tick(30); palm.toggle(); tick(.7); sample(palm, .7); finishJoin(palm); hand.update(0);
  assert.equal(palm.spin, hand.spin, 'alignment survives multiple full rotations');
  h.window.handlers.pagehide({persisted: false});
  return {effectorAndSystemGroups: 'OK', staggeredSwitches: 'OK', splatAndGather: 'OK', mirroredHands: 'OK', pauseAndOffscreenReturn: 'OK', mirrorError};
}
module.exports = {run, fixture, checkSynchronization};
if (require.main === module) run().then(console.log).catch((error) => {console.error(error); process.exitCode = 1;});
