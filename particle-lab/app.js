/* Surface particles with damped springs. No CDN, framework, or runtime STL loader. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('particles');
  const scene = $('scene');
  const loader = $('loader');
  const buttons = [...document.querySelectorAll('[data-model]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  const count = narrow ? 16000 : 32000;
  const CAMERA = 4.8;
  const CYCLE_SECONDS = 16;
  const MORPH_SECONDS = 2.4;
  const PoseMath = window.RobotPoseMath;
  const POSE_STORAGE = 'rush.robot-particles.poses.v1';
  const axes = ['roll', 'pitch', 'yaw'];
  let renderer;
  let models;
  let selected = 0;
  let previousTime = 0;
  let paused = reducedMotion;
  let cycle = !reducedMotion;
  let light = false;
  let speed = 0.7;
  let force = 1;
  let rotation = 0;
  let editing = false;
  let drag = null;
  let morph = 1;
  let transition = null;
  let cycleTime = 0;
  let frameRequest = 0;
  let lostContext = false;
  let destroyed = false;
  let cssWidth = 1;
  let cssHeight = 1;
  let centerX = 0;
  let centerY = 0;
  let scale = 1;
  let pixelRatio = 1;
  let currentColor = [0.663, 0.867, 0.839];
  const pointer = {x: -10000, y: -10000, active: false};
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const source = new Float32Array(count * 6);
  const shape = new Float32Array(count * 6);
  const display = new Float32Array(count * 7);
  const pointOpacity = new Float32Array(count).fill(1);
  const sourceOpacity = new Float32Array(count).fill(1);
  const glow = new Float32Array(count);

  function decode(model) {
    const binary = atob(model.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    if (bytes.length !== model.count * 12) throw new Error('Invalid point cloud size');
    const points = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const offset = Math.floor(i * model.count / count) * 12;
      for (let j = 0; j < 6; j++) points[i * 6 + j] = view.getInt16(offset + j * 2, true) / 32767;
    }
    let radius = 0;
    for (let i = 0; i < points.length; i += 6) radius = Math.max(radius, Math.hypot(points[i], points[i + 1], points[i + 2]));
    let attachment = null;
    if (model.attachment) {
      const maskBytes = atob(model.attachment.anchors);
      if (maskBytes.length !== model.count) throw new Error('Invalid attachment mask');
      const mask = new Uint8Array(count);
      for (let i = 0; i < count; i++) mask[i] = maskBytes.charCodeAt(Math.floor(i * model.count / count));
      attachment = {...model.attachment, mask};
      delete attachment.anchors;
      if (attachment.mirror) {
        const encoded = atob(attachment.mirror.sourceIndices);
        if (encoded.length !== model.count * 2) throw new Error('Invalid mirrored hand mapping');
        const sourceIndices = new Uint16Array(count);
        for (let i = 0; i < count; i++) {
          const original = Math.floor(i * model.count / count);
          const sourceIndex = encoded.charCodeAt(original * 2) | (encoded.charCodeAt(original * 2 + 1) << 8);
          const local = sourceIndex * count / model.count;
          if (mask[i] === 2 && !Number.isInteger(local)) throw new Error('Mirrored subset lost particle correspondence');
          sourceIndices[i] = Math.floor(local);
        }
        attachment.mirror = {...attachment.mirror, sourceIndices};
      }
    }
    delete model.data;
    return {...model, points, radius, attachment, posed: new Float32Array(points.length), pose: {...(model.defaultPose || {roll: 0, pitch: 0, yaw: 0})},
      rgb: model.color.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16) / 255)};
  }

  function rebuildPose(model) {
    const matrix = PoseMath.toScene(model.pose);
    for (let i = 0; i < model.points.length; i += 3) {
      const x = model.points[i], y = model.points[i + 1], z = model.points[i + 2];
      model.posed[i] = matrix[0] * x + matrix[1] * y + matrix[2] * z;
      model.posed[i + 1] = matrix[3] * x + matrix[4] * y + matrix[5] * z;
      model.posed[i + 2] = matrix[6] * x + matrix[7] * y + matrix[8] * z;
    }
  }

  function restorePoses() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(POSE_STORAGE) || '{}');
      for (const model of models) {
        const pose = saved[model.source];
        if (pose && axes.every((axis) => Number.isFinite(pose[axis]) && Math.abs(pose[axis]) <= 180)) {
          model.pose = {...pose};
        }
      }
    } catch (_) { /* Storage can be unavailable on file://. Editing still works. */ }
    models.forEach(rebuildPose);
  }

  function savePoses() {
    try {
      window.localStorage.setItem(POSE_STORAGE, JSON.stringify(Object.fromEntries(models.map((model) => [model.source, model.pose]))));
      $('pose-save-status').textContent = '이 브라우저에 저장됨';
    } catch (_) { $('pose-save-status').textContent = '현재 탭에 보관 중 · 복사해서 보관하세요'; }
  }

  function exportPoses(all = false) {
    return JSON.stringify({
      units: 'deg',
      axes: 'original STL axes',
      rotation_order: 'Rz(yaw) * Ry(pitch) * Rx(roll)',
      models: (all ? models : [models[selected]]).map((model) => ({
        file: model.source,
        ...Object.fromEntries(axes.map((axis) => [axis, Number(model.pose[axis].toFixed(2))]))
      }))
    }, null, 2);
  }

  function syncPoseEditor(skipInput = '') {
    const model = models[selected];
    $('pose-source').textContent = model.source;
    for (const axis of axes) {
      const value = model.pose[axis].toFixed(2);
      if (skipInput !== `pose-${axis}`) $(`pose-${axis}`).value = value;
      if (skipInput !== `pose-${axis}-range`) $(`pose-${axis}-range`).value = value;
    }
    $('pose-output').value = exportPoses();
    $('copy-status').textContent = '버튼으로 복사하거나 텍스트를 직접 선택하세요.';
  }

  function setPose(pose, skipInput = '') {
    models[selected].pose = pose;
    rebuildPose(models[selected]);
    morph = 1;
    transition = null;
    pointOpacity.fill(1);
    velocities.fill(0);
    glow.fill(0);
    syncPoseEditor(skipInput);
  }

  async function copyPose(all) {
    const output = $('pose-output');
    const text = exportPoses(all);
    output.value = text;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (_) { /* Fall through to selection-based copying for local HTML. */ }
    if (!copied) {
      output.closest('details').open = true;
      output.focus();
      output.select();
      output.setSelectionRange(0, text.length);
      try { copied = document.execCommand('copy'); } catch (_) { /* Manual selection remains. */ }
    }
    const message = copied ? `${all ? `${models.length}개 모델의` : '현재 모델의'} 자세를 복사했습니다.` : '값을 선택했습니다. Ctrl+C (Mac: ⌘C)로 복사해 주세요.';
    $('copy-status').textContent = message;
    $('announcement').textContent = message;
    if (copied) $('pose-save-status').textContent = message;
  }

  function setEditing(value) {
    finishDrag();
    editing = value;
    pointerLeave();
    rotation = 0;
    morph = 1;
    transition = null;
    pointOpacity.fill(1);
    cycleTime = 0;
    velocities.fill(0);
    glow.fill(0);
    document.body.classList.toggle('pose-mode', editing);
    $('edit-mode').setAttribute('aria-pressed', String(editing));
    $('animate-mode').setAttribute('aria-pressed', String(!editing));
    canvas.setAttribute('aria-label', editing
      ? '로봇 자세 편집. 드래그로 회전, Shift 드래그로 기울이기. 방향키로 회전, Shift 방향키로 기울이기.'
      : '회전하는 로봇 입자 모델. 마우스 또는 터치로 입자를 흩뜨릴 수 있습니다.');
    syncPoseEditor();
    updateControls();
    resize();
    step(0, true);
  }

  function beginDrag(event) {
    if (!editing) { pointerMove(event); return; }
    if (event.button !== 0) return;
    event.preventDefault();
    pointerLeave();
    canvas.focus({preventScroll: true});
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY};
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
  }

  function finishDrag(event) {
    if (!drag || (event && event.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    savePoses();
  }

  function compile(gl, type, text) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(error);
    }
    return shader;
  }

  function webglRenderer(gl) {
    const vert = compile(gl, gl.VERTEX_SHADER, `
      precision highp float;
      attribute vec3 a_position;
      attribute float a_shade;
      attribute float a_glow;
      attribute float a_seed;
      attribute float a_opacity;
      uniform vec2 u_resolution;
      uniform vec2 u_center;
      uniform float u_scale;
      uniform float u_dpr;
      varying float v_shade;
      varying float v_glow;
      varying float v_opacity;
      void main() {
        float perspective = 4.8 / (4.8 - a_position.z);
        vec2 p = u_center + vec2(a_position.x, -a_position.y) * u_scale * perspective;
        vec2 clip = p / u_resolution * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        gl_PointSize = u_dpr * (1.1 + a_seed * 0.55) * perspective * (1.0 + a_glow * 0.3);
        v_shade = a_shade;
        v_glow = a_glow;
        v_opacity = a_opacity;
      }
    `);
    const frag = compile(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec3 u_color;
      uniform float u_light;
      varying float v_shade;
      varying float v_glow;
      varying float v_opacity;
      void main() {
        float distance = length(gl_PointCoord - 0.5) * 2.0;
        if (distance > 1.0) discard;
        float alpha = (1.0 - smoothstep(0.35, 1.0, distance)) * (0.34 + v_shade * 0.6);
        vec3 darkColor = mix(u_color * (0.45 + v_shade * 0.65), vec3(0.95, 1.0, 0.92), v_glow * 0.6);
        vec3 lightColor = mix(u_color * vec3(0.18, 0.35, 0.3), vec3(0.2, 0.45, 0.36), v_glow);
        gl_FragColor = vec4(mix(darkColor, lightColor, u_light), alpha * v_opacity);
      }
    `);
    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, display.byteLength, gl.DYNAMIC_DRAW);
    for (const [name, size, offset] of [['a_position', 3, 0], ['a_shade', 1, 12], ['a_glow', 1, 16], ['a_seed', 1, 20], ['a_opacity', 1, 24]]) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 28, offset);
    }
    const uniforms = Object.fromEntries(['resolution', 'center', 'scale', 'dpr', 'color', 'light'].map((name) => [name, gl.getUniformLocation(program, `u_${name}`)]));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return {
      draw() {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uniforms.resolution, cssWidth, cssHeight);
        gl.uniform2f(uniforms.center, centerX, centerY);
        gl.uniform1f(uniforms.scale, scale);
        gl.uniform1f(uniforms.dpr, pixelRatio);
        gl.uniform3fv(uniforms.color, currentColor);
        gl.uniform1f(uniforms.light, light ? 1 : 0);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, display);
        gl.drawArrays(gl.POINTS, 0, count);
      },
      dispose() { gl.deleteBuffer(buffer); gl.deleteProgram(program); }
    };
  }

  function canvasRenderer(context) {
    // Reduced-density fallback for devices with WebGL disabled.
    return {
      draw() {
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, cssWidth, cssHeight);
        const rgb = currentColor.map((v) => Math.round(v * (light ? 75 : 255)));
        context.fillStyle = `rgb(${rgb.join(',')})`;
        for (let i = 0; i < count; i += 3) {
          const k = i * 7;
          const projection = CAMERA / (CAMERA - display[k + 2]);
          const x = centerX + display[k] * scale * projection;
          const y = centerY - display[k + 1] * scale * projection;
          const radius = projection * (1 + display[k + 4] * 0.4);
          context.globalAlpha = (0.3 + display[k + 3] * 0.6) * display[k + 6];
          context.fillRect(x, y, radius, radius);
        }
        context.globalAlpha = 1;
      },
      dispose() {}
    };
  }

  function makeRenderer() {
    const gl = canvas.getContext('webgl', {alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power'});
    if (gl) return webglRenderer(gl);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    return canvasRenderer(context);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);
    const mobile = window.innerWidth <= 760;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * pixelRatio);
    canvas.height = Math.round(cssHeight * pixelRatio);
    centerX = cssWidth * (mobile ? 0.52 : editing ? 0.70 : 0.65);
    centerY = cssHeight * (mobile ? editing ? 0.47 : 0.70 : 0.49);
    scale = mobile ? Math.min(cssWidth * 0.37, cssHeight * (editing ? 0.38 : 0.28))
      : Math.min(cssWidth * (editing ? 0.22 : 0.25), cssHeight * 0.395);
    if (editing && models) {
      // Fit the entire bounding sphere, so arbitrary user rotations cannot crop the model.
      const radius = models[selected].radius;
      const projectedRadius = radius * CAMERA / Math.sqrt(CAMERA * CAMERA - radius * radius);
      const plotLeft = mobile ? 0 : (window.innerWidth <= 1100 ? 285 : 325) + 40;
      const plotWidth = Math.max(100, cssWidth - plotLeft);
      centerX = plotLeft + plotWidth / 2;
      scale = Math.min(plotWidth * 0.44, cssHeight * 0.4) / projectedRadius;
    }
    pointer.active = false;
    $('cursor-ring').style.display = 'none';
  }

  function updateControls() {
    $('pause').setAttribute('aria-pressed', String(paused));
    $('pause-text').textContent = paused ? '회전 재생' : '회전 멈춤';
    $('pause-symbol').textContent = paused ? '▷' : 'Ⅱ';
    $('cycle').setAttribute('aria-pressed', String(cycle));
    for (const id of ['pause', 'cycle', 'speed', 'force']) $(id).disabled = editing;
  }

  function choose(index) {
    if (index === selected || !models[index]) return;
    finishDrag();
    const previous = models[selected];
    const stable = morph === 1;
    source.set(shape);
    sourceOpacity.set(pointOpacity);
    selected = index;
    morph = editing ? 1 : 0;
    transition = editing ? null : window.RobotTransitions.create(previous, models[index], source, sourceOpacity, stable, PoseMath.viewRotation(rotation));
    if (editing) pointOpacity.fill(1);
    cycleTime = 0;
    buttons.forEach((button, i) => {
      button.classList.toggle('active', i === index);
      button.setAttribute('aria-pressed', String(i === index));
      button.lastElementChild.style.transform = 'scaleX(0)';
    });
    const model = models[index];
    document.documentElement.style.setProperty('--accent', model.color);
    $('scene-number').textContent = `${model.number} / ${String(models.length).padStart(2, '0')}`;
    $('scene-caption').textContent = `${model.name} · ${model.detail}`.toUpperCase();
    $('announcement').textContent = `${model.name}, ${model.detail}`;
    syncPoseEditor();
    updatePairButton();
    if (editing) { velocities.fill(0); glow.fill(0); resize(); step(0, true); }
  }

  function relatedIndex() {
    const model = models[selected];
    const number = model.parent || (model.attachment && model.attachment.child);
    return models.findIndex((candidate) => candidate.number === number);
  }

  function updatePairButton() {
    const index = relatedIndex();
    $('pair-switch').hidden = index < 0;
    if (index < 0) return;
    const model = models[selected], related = models[index];
    const forward = !!model.parent;
    const assembly = forward ? related : model;
    const mirrored = !!(assembly.attachment && assembly.attachment.mirror);
    const action = mirrored ? (forward ? '두 손으로 펼치기' : '한 손으로 모으기') : (forward ? '조립체로 연결' : '그리퍼 꺼내기');
    $('pair-switch').textContent = `${action} · ${related.number} ${forward ? '↗' : '↙'}`;
    $('pair-note').textContent = `${forward ? model.number : related.number} ↔ ${forward ? related.number : model.number} · ${mirrored ? '한 손에서 좌우 대칭 양손으로' : '그리퍼와 전체 로봇'}`;
  }

  function pointerMove(event) {
    if (editing) {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.x = event.clientX; drag.y = event.clientY;
      setPose(PoseMath.drag(models[selected].pose, dx, dy, event.shiftKey));
      return;
    }
    if (event.pointerType === 'touch' && event.type === 'pointermove' && !event.buttons) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.active = true;
    const ring = $('cursor-ring');
    ring.style.display = 'block';
    ring.style.left = `${pointer.x}px`;
    ring.style.top = `${pointer.y}px`;
  }

  function pointerLeave() {
    pointer.active = false;
    $('cursor-ring').style.display = 'none';
  }

  function step(dt, initialize = false) {
    const splittingHands = transition && (transition.type === 'duplicate' || transition.type === 'merge');
    if (!paused && !editing && !splittingHands) rotation += dt * 0.24 * speed;
    if (morph < 1) morph = Math.min(1, morph + dt / (transition ? transition.duration : MORPH_SECONDS));
    const target = models[selected].posed;
    if (transition && morph < 1) {
      transition.sample(morph, shape, pointOpacity);
    } else {
      shape.set(target);
      pointOpacity.fill(1);
      transition = null;
    }
    const colorLerp = 1 - Math.exp(-dt * 3);
    for (let c = 0; c < 3; c++) currentColor[c] += (models[selected].rgb[c] - currentColor[c]) * colorLerp;
    const cos = Math.cos(rotation - 0.5), sin = Math.sin(rotation - 0.5);
    const pitch = 0.18, cp = Math.cos(pitch), sp = Math.sin(pitch);
    const damping = Math.exp(-7.5 * dt);
    const radius = Math.min(160, Math.max(85, cssWidth * 0.12)) * (0.85 + force * 0.15);
    const radiusSq = radius * radius;
    const guideMask = transition && transition.anchorMask;
    const guideGlow = guideMask ? Math.sin(Math.PI * morph) * .35 : 0;
    let affected = 0;
    for (let i = 0; i < count; i++) {
      const p = i * 3, b = i * 6;
      const x = shape[b] * cos + shape[b + 2] * sin;
      const z = -shape[b] * sin + shape[b + 2] * cos;
      const y = shape[b + 1] * cp - z * sp;
      const depth = shape[b + 1] * sp + z * cp;
      const invisible = transition && pointOpacity[i] < .001;
      if (initialize || editing || invisible) {
        positions[p] = x; positions[p + 1] = y; positions[p + 2] = depth;
        if (invisible) { velocities[p] = 0; velocities[p + 1] = 0; velocities[p + 2] = 0; }
      }
      let ax = (x - positions[p]) * 38;
      let ay = (y - positions[p + 1]) * 38;
      let az = (depth - positions[p + 2]) * 38;
      let energy = 0;
      if (pointer.active && !editing && morph === 1) {
        const projection = CAMERA / (CAMERA - positions[p + 2]);
        const dx = centerX + positions[p] * scale * projection - pointer.x;
        const dy = centerY - positions[p + 1] * scale * projection - pointer.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < radiusSq) {
          const distance = Math.sqrt(distanceSq);
          const falloff = 1 - distance / radius;
          const magnitude = falloff * falloff * 34 * force;
          const jitter = (i * 0.61803398875) % 1;
          const directionX = distance > 0.01 ? dx / distance : Math.cos(i);
          const directionY = distance > 0.01 ? -dy / distance : Math.sin(i);
          ax += directionX * magnitude;
          ay += directionY * magnitude;
          az += (jitter - 0.3) * magnitude * 0.65;
          energy = falloff;
          affected++;
        }
      }
      velocities[p] = (velocities[p] + ax * dt) * damping;
      velocities[p + 1] = (velocities[p + 1] + ay * dt) * damping;
      velocities[p + 2] = (velocities[p + 2] + az * dt) * damping;
      positions[p] += velocities[p] * dt;
      positions[p + 1] += velocities[p + 1] * dt;
      positions[p + 2] = Math.max(-2.5, Math.min(2.5, positions[p + 2] + velocities[p + 2] * dt));
      glow[i] += (energy - glow[i]) * Math.min(1, dt * (energy > glow[i] ? 14 : 3));
      const nx = shape[b + 3] * cos + shape[b + 5] * sin;
      const nz = -shape[b + 3] * sin + shape[b + 5] * cos;
      const ny = shape[b + 4] * cp - nz * sp;
      const normalZ = shape[b + 4] * sp + nz * cp;
      const shade = Math.max(0.08, Math.min(1, 0.42 + nx * -0.2 + ny * 0.25 + normalZ * 0.33 + depth * 0.12));
      const d = i * 7;
      display[d] = positions[p];
      display[d + 1] = positions[p + 1];
      display[d + 2] = positions[p + 2];
      display[d + 3] = shade;
      display[d + 4] = Math.min(1, glow[i] + (guideMask && guideMask[i] ? guideGlow : 0));
      display[d + 5] = (i * 0.61803398875) % 1;
      display[d + 6] = pointOpacity[i];
    }
    const transitionLabel = transition ? {assemble: 'ASSEMBLING', extract: 'EXTRACTING', duplicate: 'SPLITTING', merge: 'MERGING', scatter: 'RESHAPING'}[transition.type] : '';
    const state = editing ? 'POSE EDITOR' : affected > 10 ? 'SCATTERING' : morph < 1 ? transitionLabel : paused ? 'STILL' : 'ROTATING';
    if ($('motion-state').textContent !== state) $('motion-state').textContent = state;
    if (cycle && !paused && !editing && !pointer.active && morph === 1) {
      cycleTime += dt;
      if (cycleTime >= CYCLE_SECONDS) choose((selected + 1) % models.length);
    }
    buttons[selected].lastElementChild.style.transform = `scaleX(${cycle && !editing ? cycleTime / CYCLE_SECONDS : 1})`;
  }

  function frame(time) {
    frameRequest = 0;
    if (document.hidden || lostContext || destroyed) return;
    const elapsed = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 1 / 60;
    previousTime = time;
    // Substeps retain spring stability after slow frames or background throttling.
    const steps = Math.max(1, Math.ceil(elapsed / (1 / 60)));
    for (let i = 0; i < steps; i++) step(elapsed / steps);
    renderer.draw();
    frameRequest = requestAnimationFrame(frame);
  }

  function resume() {
    previousTime = 0;
    if (!frameRequest && !document.hidden && !lostContext && !destroyed) frameRequest = requestAnimationFrame(frame);
  }

  function fail(error) {
    console.error('Robot particles:', error);
    loader.hidden = false;
    loader.textContent = '모델을 표시하지 못했습니다. models.js, pose-math.js, transitions.js, app.js가 같은 폴더에 있는지 확인하고, 최신 브라우저에서 다시 열어 주세요.';
  }

  try {
    if (!window.ROBOT_PARTICLE_MODELS || window.ROBOT_PARTICLE_MODELS.length !== buttons.length) throw new Error('Missing model assets');
    if (!window.RobotTransitions) throw new Error('Missing transition module');
    models = window.ROBOT_PARTICLE_MODELS.map(decode);
    delete window.ROBOT_PARTICLE_MODELS;
    restorePoses();
    renderer = makeRenderer();
    source.set(models[0].posed);
    shape.set(source);
    resize();
    step(0, true);
    renderer.draw();
    loader.hidden = true;
    $('point-count').textContent = count.toLocaleString('en-US');
    $('copy-all').textContent = `${models.length}개 전체 복사`;
    $('scene-number').textContent = `${models[0].number} / ${String(models.length).padStart(2, '0')}`;
    updateControls();
    syncPoseEditor();
    updatePairButton();

    $('edit-mode').addEventListener('click', () => setEditing(true));
    $('animate-mode').addEventListener('click', () => setEditing(false));
    $('copy-pose').addEventListener('click', () => copyPose(false));
    $('copy-all').addEventListener('click', () => copyPose(true));
    $('pair-switch').addEventListener('click', () => { const index = relatedIndex(); if (index >= 0) choose(index); });
    $('zero-pose').addEventListener('click', () => { setPose({roll: 0, pitch: 0, yaw: 0}); savePoses(); });
    for (const axis of axes) {
      for (const suffix of ['', '-range']) {
        const input = $(`pose-${axis}${suffix}`);
        input.addEventListener('input', () => {
          if (input.value.trim() === '') return;
          const value = Number(input.value);
          if (!Number.isFinite(value)) return;
          setPose({...models[selected].pose, [axis]: Math.max(-180, Math.min(180, value))}, input.id);
          savePoses();
        });
        input.addEventListener('change', () => syncPoseEditor());
        input.addEventListener('blur', () => syncPoseEditor());
      }
    }

    buttons.forEach((button) => button.addEventListener('click', () => choose(Number(button.dataset.model))));
    $('pause').addEventListener('click', () => { paused = !paused; updateControls(); });
    $('cycle').addEventListener('click', () => { cycle = !cycle; cycleTime = 0; updateControls(); });
    $('speed').addEventListener('input', (event) => { speed = Number(event.target.value); $('speed-value').value = `${speed.toFixed(1)}×`; });
    $('force').addEventListener('input', (event) => { force = Number(event.target.value); $('force-value').value = `${force.toFixed(1)}×`; });
    $('theme').addEventListener('click', () => {
      light = !light;
      document.body.classList.toggle('light', light);
      $('theme').innerHTML = `${light ? 'Dark' : 'Light'} mode <span aria-hidden="true">↗</span>`;
      $('theme').setAttribute('aria-label', `${light ? '어두운' : '밝은'} 배경으로 변경`);
    });
    $('reset').addEventListener('click', () => {
      pointerLeave();
      rotation = 0;
      velocities.fill(0);
      glow.fill(0);
      morph = 1;
      transition = null;
      pointOpacity.fill(1);
      cycleTime = 0;
      speed = 0.7; force = 1;
      $('speed').value = '0.7'; $('force').value = '1';
      $('speed-value').value = '0.7×'; $('force-value').value = '1.0×';
      paused = reducedMotion; cycle = !reducedMotion;
      updateControls();
      step(0, true);
    });
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerdown', beginDrag);
    canvas.addEventListener('pointerleave', pointerLeave);
    canvas.addEventListener('pointercancel', (event) => { finishDrag(event); pointerLeave(); });
    canvas.addEventListener('pointerup', (event) => { finishDrag(event); if (event.pointerType !== 'mouse') pointerLeave(); });
    canvas.addEventListener('lostpointercapture', finishDrag);
    canvas.addEventListener('blur', () => { finishDrag(); pointerLeave(); });
    canvas.addEventListener('keydown', (event) => {
      if (editing && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const dx = event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0;
        const dy = event.key === 'ArrowDown' ? 5 : event.key === 'ArrowUp' ? -5 : 0;
        setPose(PoseMath.drag(models[selected].pose, event.shiftKey ? dx || dy : dx, dy, event.shiftKey));
        savePoses();
      } else if (!editing && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        event.preventDefault();
        choose((selected + (event.key === 'ArrowRight' ? 1 : models.length - 1)) % models.length);
      } else if (!editing && event.code === 'Space') {
        event.preventDefault(); paused = !paused; updateControls();
      } else if (event.key === 'Escape') { finishDrag(); pointerLeave(); }
    });
    const observer = new ResizeObserver(resize);
    observer.observe(scene);
    document.addEventListener('visibilitychange', () => {
      finishDrag();
      pointerLeave();
      if (document.hidden) { cancelAnimationFrame(frameRequest); frameRequest = 0; }
      else resume();
    });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault(); lostContext = true;
      cancelAnimationFrame(frameRequest); frameRequest = 0;
      loader.textContent = '그래픽 연결을 복원하는 중…'; loader.hidden = false;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      try { renderer = makeRenderer(); lostContext = false; loader.hidden = true; resume(); }
      catch (error) { fail(error); }
    });
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return;
      destroyed = true; cancelAnimationFrame(frameRequest); observer.disconnect(); renderer.dispose();
    });
    window.addEventListener('pageshow', resume);
    resume();
  } catch (error) { fail(error); }
})();
