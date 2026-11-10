const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const scripts = ['models.js', 'pose-math.js', 'transitions.js', 'app.js'].map((name) => fs.readFileSync(path.join(root, name), 'utf8'));

function harness(mobile = false) {
  const nodes = new Map(), errors = [], stored = new Map();
  function el(id) {
    if (nodes.has(id)) return nodes.get(id);
    const node = {id, textContent: '', value: '0', style: {setProperty() {}},
      classList: {toggle() {}, add() {}, remove() {}}, dataset: {}, lastElementChild: {style: {}},
      attributes: {}, handlers: {}, setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(k, fn) { this.handlers[k] = fn; },
      getBoundingClientRect() { return {width: mobile ? 350 : 1300, height: mobile ? 630 : 650, left: 0, top: 0}; },
      getContext(type) { return type === 'webgl' ? null : {setTransform() {}, clearRect() {}, fillRect(x, y, w) { assert.ok(Number.isFinite(x + y + w)); }}; }};
    nodes.set(id, node);
    return node;
  }
  const buttons = Array.from({length: 6}, (_, i) => el('model' + i));
  const context = vm.createContext({
    window: {innerWidth: mobile ? 390 : 1396, matchMedia(q) { return {matches: q.includes('reduce') ? false : mobile}; },
      devicePixelRatio: 1, addEventListener() {}, localStorage: {getItem(k) { return stored.get(k) || null; }, setItem(k, v) { stored.set(k, v); }}},
    document: {getElementById: el, querySelectorAll() { return buttons; }, body: el('body'), documentElement: el('html'), addEventListener() {}},
    console: {error(...a) { errors.push(a); }}, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, ResizeObserver: class {observe() {}},
  });
  scripts.slice(0, 3).forEach((script) => vm.runInContext(script, context));
  const exposed = scripts[3].replace(/\}\)\(\);\s*$/, `
    globalThis.api = {models, choose, step, setEditing, setPose, positions, shape, pointOpacity, display,
      get transition(){return transition}, get morph(){return morph}, get selected(){return selected}, get rotation(){return rotation},
      stopSpin(){paused=true;cycle=false}, startSpin(){paused=false}, draw(){renderer.draw()}};
  })();`);
  vm.runInContext(exposed, context);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  context.api.stopSpin();
  return {api: context.api, transitions: context.window.RobotTransitions, poseMath: context.window.RobotPoseMath, nodes};
}

const distance = (points, i, j) => Math.hypot(...[0, 1, 2].map((c) => points[i * 6 + c] - points[j * 6 + c]));

function run() {
  let samples = 0, maxEndpointError = 0, maxRigidityError = 0, maxMirrorError = 0;
  for (const mobile of [false, true]) {
    const {api: a, transitions, poseMath, nodes} = harness(mobile);
    assert.equal(a.models.length, 6);
    assert.equal(a.models[3].pose.roll, 91.97);
    assert.equal(a.models[4].pose.roll, 86.98);
    for (const [fromIndex, toIndex] of [[0, 1], [1, 0], [2, 3], [3, 2], [4, 5], [5, 4]]) {
      const from = a.models[fromIndex], to = a.models[toIndex];
      const count = from.points.length / 6;
      const out = new Float32Array(count * 6), alpha = new Float32Array(count);
      const transition = transitions.create(from, to, from.posed, new Float32Array(count).fill(1));
      const pairedHands = Math.min(fromIndex, toIndex) === 4;
      assert.equal(transition.type, pairedHands ? (fromIndex === 4 ? 'duplicate' : 'merge') : (fromIndex % 2 === 0 ? 'assemble' : 'extract'));
      const child = fromIndex % 2 === 0 ? from : to;
      const anchors = Array.from(transition.anchorMask).flatMap((v, i) => v === 1 ? [i] : []);
      assert.ok(anchors.length > count * .25);
      for (const p of [0, .15, .28, .42, .65, .85, 1]) {
        transition.sample(p, out, alpha);
        assert.ok(out.every(Number.isFinite));
        assert.ok(alpha.every((x) => x >= 0 && x <= 1));
        assert.ok(anchors.every((i) => alpha[i] === 1));
        const ratios = [151, 901, 2501].map((j) => distance(out, anchors[0], anchors[j]) / distance(child.points, anchors[0], anchors[j]));
        maxRigidityError = Math.max(maxRigidityError, Math.max(...ratios) - Math.min(...ratios));
        if (p === 0 || p === 1) {
          const expected = p === 0 ? from.posed : to.posed;
          for (let k = 0; k < out.length; k++) maxEndpointError = Math.max(maxEndpointError, Math.abs(out[k] - expected[k]));
        }
        samples++;
      }
    }
    // At the split plateau, copy 2 must be an actual reflection of copy 1,
    // with the same point identities and outward normal directions.
    const hand = a.models[4], robot = a.models[5], count = a.pointOpacity.length;
    const twoHands = transitions.create(hand, robot, hand.posed, new Float32Array(count).fill(1));
    const mergeHands = transitions.create(robot, hand, robot.posed, new Float32Array(count).fill(1));
    const out = new Float32Array(count * 6), reverse = new Float32Array(count * 6);
    const alpha = new Float32Array(count), reverseAlpha = new Float32Array(count);
    twoHands.sample(.4, out, alpha);
    const link = robot.attachment;
    const view = poseMath.viewRotation();
    for (let i = 0; i < count; i++) {
      if (link.mask[i] !== 2) continue;
      const sourceIndex = link.mirror.sourceIndices[i];
      assert.equal(link.mask[sourceIndex], 1);
      assert.equal(alpha[i], 1);
      for (let offset = 0; offset < 6; offset += 3) {
        for (let axis = 0; axis < 3; axis++) {
          let copy = 0, original = 0;
          for (let k = 0; k < 3; k++) {
            copy += view[axis * 3 + k] * out[i * 6 + offset + k];
            original += view[axis * 3 + k] * out[sourceIndex * 6 + offset + k];
          }
          maxMirrorError = Math.max(maxMirrorError, Math.abs(copy - original * (axis === 0 ? -1 : 1)));
        }
      }
    }
    // The two visible hands remain rigid, and reverse motion retraces the split.
    const copies = Array.from(link.mask).flatMap((v, i) => v === 2 ? [i] : []);
    for (const p of [.2, .4, .7, .95]) {
      twoHands.sample(p, out, alpha);
      mergeHands.sample(1 - p, reverse, reverseAlpha);
      assert.ok(out.every((v, i) => Math.abs(v - reverse[i]) < 1e-6));
      assert.ok(alpha.every((v, i) => Math.abs(v - reverseAlpha[i]) < 1e-6));
      const ratios = [151, 901, 2501].map((j) => distance(out, copies[0], copies[j]) / distance(hand.points, link.mirror.sourceIndices[copies[0]], link.mirror.sourceIndices[copies[j]]));
      maxRigidityError = Math.max(maxRigidityError, Math.max(...ratios) - Math.min(...ratios));
    }
    for (const spin of [.93, -2.17]) {
      const camera = poseMath.viewRotation(spin);
      const rotatedSplit = transitions.create(hand, robot, hand.posed, new Float32Array(count).fill(1), true, camera);
      rotatedSplit.sample(.4, out, alpha);
      for (const i of copies) {
        const original = link.mirror.sourceIndices[i];
        for (let axis = 0; axis < 3; axis++) {
          let left = 0, right = 0;
          for (let k = 0; k < 3; k++) {
            left += camera[axis * 3 + k] * out[i * 6 + k];
            right += camera[axis * 3 + k] * out[original * 6 + k];
          }
          maxMirrorError = Math.max(maxMirrorError, Math.abs(left - right * (axis === 0 ? -1 : 1)));
        }
      }
    }
    for (const [from, to] of [[0, 2], [2, 4], [1, 3], [5, 0]]) {
      const first = a.models[from], last = a.models[to];
      const count = first.points.length / 6;
      const t = transitions.create(first, last, first.posed, new Float32Array(count).fill(1));
      assert.equal(t.type, 'scatter');
      const out = new Float32Array(count * 6), alpha = new Float32Array(count);
      t.sample(0, out, alpha);
      assert.ok(out.every((v, i) => v === first.posed[i]));
      t.sample(.5, out, alpha);
      assert.ok(distance(out, 0, count - 1) > .3);
      t.sample(1, out, alpha);
      assert.ok(out.every((v, i) => Math.abs(v - last.posed[i]) < 1e-6));
    }
    // Actual integration: finish an assembly transition, then interrupt extraction.
    a.choose(1);
    for (let frame = 0; frame < 112; frame++) a.step(1 / 30);
    assert.equal(a.morph, 1);
    assert.equal(a.transition, null);
    assert.ok(a.pointOpacity.every((x) => x === 1));
    assert.equal(a.display.length, a.pointOpacity.length * 7);
    a.draw();
    a.choose(4);
    a.setEditing(false);
    a.startSpin();
    assert.match(nodes.get('pair-switch').textContent, /두 손으로 펼치기/);
    a.choose(5);
    assert.equal(a.transition.type, 'duplicate');
    assert.match(nodes.get('pair-switch').textContent, /한 손으로 모으기/);
    for (let frame = 0; frame < 146; frame++) {
      const beforeRotation = a.rotation, beforeProgress = a.morph;
      a.step(1 / 30);
      if (beforeProgress < 1) assert.equal(a.rotation, beforeRotation);
    }
    assert.equal(a.morph, 1);
    assert.ok(a.pointOpacity.every((v) => v === 1));
    assert.ok(a.positions.every(Number.isFinite));
    a.choose(4);
    assert.equal(a.transition.type, 'merge');
    a.step(.02);
    const mergeRotation = a.rotation;
    a.step(.02);
    assert.equal(a.rotation, mergeRotation);
    a.choose(0);
    assert.equal(a.transition.type, 'scatter');
    a.setEditing(true);
    a.choose(1);
    a.setEditing(false);
    a.choose(0);
    a.step(.02);
    assert.equal(a.transition.type, 'extract');
    a.choose(2);
    assert.equal(a.transition.type, 'scatter');
    a.step(.02);
    assert.ok(a.positions.every(Number.isFinite));
    a.setEditing(true);
    assert.equal(a.transition, null);
    assert.ok(a.pointOpacity.every((x) => x === 1));
    a.draw();
  }
  assert.ok(maxEndpointError < .00006, `endpoint error ${maxEndpointError}`);
  assert.ok(maxRigidityError < .000002, `rigidity error ${maxRigidityError}`);
  assert.ok(maxMirrorError < .000002, `mirror symmetry error ${maxMirrorError}`);
  return {transitionSamples: samples, maxEndpointError, maxRigidityError, maxMirrorError,
    desktopAndMobile: 'OK', assemblyAndExtraction: 'OK', mirroredHands: 'OK', reverseMerge: 'OK', unrelatedScatter: 'OK', interruptedSwitch: 'OK'};
}

module.exports = {run, harness};
if (require.main === module) console.log(run());
