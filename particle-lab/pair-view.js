/* Compact, independently controlled particle pairs for the portfolio homepage. */
(() => {
  'use strict';
  const CAMERA = 4.8;
  const TRANSITION_SPEED = 1.5;
  const ROTATION_SPEED = .336;
  const POINT_SIZE = 1.25;
  const BLUE_ACCENT = [57 / 255, 125 / 255, 224 / 255];
  const rotationBounds = new WeakMap();

  class RotationGroups {
    constructor() {this.angles = {effector: 0, system: 0};}
    angle(inSystem) {return this.angles[inSystem ? 'system' : 'effector'];}
    advance(dt, views) {
      const moving = new Set();
      for (const view of views) if (view.visible && view.spinEnabled && !view.lost && !view.disposed) {
        moving.add(view.current === view.system ? 'system' : 'effector');
      }
      for (const group of moving) this.angles[group] += dt * ROTATION_SPEED;
    }
  }

  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function fitZoom(model, requested, viewport) {
    let bounds = rotationBounds.get(model);
    if (!bounds) {
      bounds = [0, 0, 0, 0];
      // Cache a padded rotation envelope once, so fitting never makes idle rotation pulse.
      // 2,000 distributed surface samples and 72 angles keep initial loading lightweight.
      for (let step = 0; step < 72; step++) {
        const m = window.RobotPoseMath.viewRotation(step * Math.PI / 36), points = model.posed;
        for (let i = 0; i < points.length; i += 48) {
          const x = points[i], y = points[i + 1], z = points[i + 2];
          const perspective = CAMERA / (CAMERA - (m[6] * x + m[7] * y + m[8] * z));
          const px = (m[0] * x + m[1] * y + m[2] * z) * perspective;
          const py = (m[3] * x + m[4] * y + m[5] * z) * perspective;
          bounds[0] = Math.max(bounds[0], -px); bounds[1] = Math.max(bounds[1], px);
          bounds[2] = Math.max(bounds[2], py); bounds[3] = Math.max(bounds[3], -py);
        }
      }
      bounds = bounds.map((value) => value * 1.025);
      rotationBounds.set(model, bounds);
    }
    const {width, height, cx, cy, baseScale} = viewport;
    const room = [cx - 6, width - cx - 6, cy - 6, height - cy - 6];
    return Math.max(.01, Math.min(requested, ...bounds.map((value, i) => room[i] / (value * baseScale))));
  }

  function decodeModels(records, count = 16000) {
    return records.map((record) => {
      const binary = atob(record.data), bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (bytes.length !== record.count * 12) throw new Error('Invalid point cloud');
      const data = new DataView(bytes.buffer), points = new Float32Array(count * 6);
      let radius = 0;
      for (let i = 0; i < count; i++) {
        const offset = Math.floor(i * record.count / count) * 12;
        for (let j = 0; j < 6; j++) points[i * 6 + j] = data.getInt16(offset + j * 2, true) / 32767;
        radius = Math.max(radius, Math.hypot(points[i * 6], points[i * 6 + 1], points[i * 6 + 2]));
      }
      let attachment = null;
      if (record.attachment) {
        const encoded = atob(record.attachment.anchors), mask = new Uint8Array(count);
        if (encoded.length !== record.count) throw new Error('Invalid attachment mask');
        for (let i = 0; i < count; i++) mask[i] = encoded.charCodeAt(Math.floor(i * record.count / count));
        attachment = {...record.attachment, mask};
        delete attachment.anchors;
        if (attachment.mirror) {
          const encodedSources = atob(attachment.mirror.sourceIndices), sourceIndices = new Uint16Array(count);
          if (encodedSources.length !== record.count * 2) throw new Error('Invalid mirrored hand map');
          for (let i = 0; i < count; i++) {
            const offset = Math.floor(i * record.count / count) * 2;
            const source = encodedSources.charCodeAt(offset) | encodedSources.charCodeAt(offset + 1) << 8;
            const local = source * count / record.count;
            if (mask[i] === 2 && !Number.isInteger(local)) throw new Error('Incompatible particle subset');
            sourceIndices[i] = Math.floor(local);
          }
          attachment.mirror = {...attachment.mirror, sourceIndices};
        }
      }
      // Use the approved poses. Playground edits in localStorage do not alter the homepage.
      const pose = {...record.defaultPose}, posed = new Float32Array(points.length);
      const matrix = window.RobotPoseMath.toScene(pose);
      for (let i = 0; i < points.length; i += 3) {
        const x = points[i], y = points[i + 1], z = points[i + 2];
        posed[i] = matrix[0] * x + matrix[1] * y + matrix[2] * z;
        posed[i + 1] = matrix[3] * x + matrix[4] * y + matrix[5] * z;
        posed[i + 2] = matrix[6] * x + matrix[7] * y + matrix[8] * z;
      }
      return {number: record.number, source: record.source, parent: record.parent,
        points, posed, pose, radius, attachment};
    });
  }

  function makeRenderer(canvas, buffer, color, partColor) {
    const gl = canvas.getContext('webgl', {alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power'});
    if (!gl) {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No canvas renderer');
      const palette = Array.from({length: 33}, (_, step) =>
        `rgb(${color.map((value, channel) => Math.round((value + (partColor[channel] - value) * step / 32) * 255)).join(',')})`);
      return {draw(viewport) {
        const {width, height, dpr, scale, cx, cy} = viewport;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        for (let i = 0; i < buffer.length; i += 16) {
          context.fillStyle = palette[Math.round(buffer[i + 7] * 32)];
          const perspective = CAMERA / (CAMERA - buffer[i + 2]);
          context.globalAlpha = (.25 + buffer[i + 3] * .55) * buffer[i + 6];
          const size = 1.1 * POINT_SIZE * perspective * (1 + buffer[i + 4] * .35);
          context.fillRect(cx + buffer[i] * scale * perspective, cy - buffer[i + 1] * scale * perspective, size, size);
        }
        context.globalAlpha = 1;
      }, dispose() {}};
    }
    function shader(type, source) {
      const handle = gl.createShader(type);
      gl.shaderSource(handle, source); gl.compileShader(handle);
      if (!gl.getShaderParameter(handle, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(handle));
      return handle;
    }
    const vertex = shader(gl.VERTEX_SHADER, `
      precision highp float;
      attribute vec3 a_position;
      attribute float a_shade, a_glow, a_seed, a_opacity, a_part;
      uniform vec2 u_resolution, u_center;
      uniform float u_scale, u_dpr;
      varying float v_shade, v_glow, v_opacity, v_part;
      void main(){
        float perspective = 4.8 / (4.8 - a_position.z);
        vec2 p = u_center + vec2(a_position.x, -a_position.y) * u_scale * perspective;
        vec2 clip = p / u_resolution * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        gl_PointSize = u_dpr * ${POINT_SIZE.toFixed(2)} * (0.9 + a_seed * 0.4) * perspective * (1.0 + a_glow * 0.35);
        v_shade = a_shade; v_glow = a_glow; v_opacity = a_opacity; v_part = a_part;
      }
    `);
    const fragment = shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec3 u_color, u_partColor;
      varying float v_shade, v_glow, v_opacity, v_part;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if(d > 1.0) discard;
        float alpha = (1.0 - smoothstep(0.35, 1.0, d)) * (0.25 + v_shade * 0.7) * v_opacity;
        vec3 base = mix(u_color, u_partColor, v_part);
        vec3 color = mix(base * (0.6 + v_shade * 0.4), vec3(0.09, 0.45, 0.82), v_glow * 0.7 * (1.0 - v_part * 0.8));
        gl_FragColor = vec4(color, alpha);
      }
    `);
    const program = gl.createProgram();
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const data = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, data);
    gl.bufferData(gl.ARRAY_BUFFER, buffer.byteLength, gl.DYNAMIC_DRAW);
    for (const [name, size, offset] of [['position', 3, 0], ['shade', 1, 12], ['glow', 1, 16], ['seed', 1, 20], ['opacity', 1, 24], ['part', 1, 28]]) {
      const location = gl.getAttribLocation(program, `a_${name}`);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
    }
    const uniforms = Object.fromEntries(['resolution', 'center', 'scale', 'dpr', 'color', 'partColor'].map((name) => [name, gl.getUniformLocation(program, `u_${name}`)]));
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0, 0, 0, 0);
    return {draw(viewport) {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uniforms.resolution, viewport.width, viewport.height);
      gl.uniform2f(uniforms.center, viewport.cx, viewport.cy);
      gl.uniform1f(uniforms.scale, viewport.scale); gl.uniform1f(uniforms.dpr, viewport.dpr);
      gl.uniform3fv(uniforms.color, color); gl.uniform3fv(uniforms.partColor, partColor);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buffer);
      gl.drawArrays(gl.POINTS, 0, buffer.length / 8);
    }, dispose() {gl.deleteBuffer(data); gl.deleteProgram(program);}};
  }

  class PairView {
    constructor(canvas, child, system, options = {}) {
      this.canvas = canvas; this.child = child; this.system = system; this.current = child; this.options = options;
      this.rotationGroups = options.rotationGroups || null;
      this.count = child.points.length / 6; this.spin = this.rotationGroups?.angle(false) || 0; this.spinEnabled = options.spinning !== false;
      this.join = null; this.alignmentStrength = 0;
      this.requestedChildScale = options.childScale || 1; this.requestedSystemScale = options.systemScale || 1;
      this.childScale = this.requestedChildScale; this.systemScale = this.requestedSystemScale;
      this.zoom = this.childScale; this.zoomFrom = this.zoom; this.zoomTo = this.zoom;
      this.progress = 1; this.transition = null; this.settling = 0; this.dirty = true; this.lost = false;
      this.visible = true; this.disposed = false; this.pointer = {active: false, x: 0, y: 0};
      this.shape = new Float32Array(child.posed); this.source = new Float32Array(this.shape.length);
      this.opacity = new Float32Array(this.count).fill(1); this.sourceOpacity = new Float32Array(this.count).fill(1);
      this.positions = new Float32Array(this.count * 3); this.velocities = new Float32Array(this.count * 3);
      this.lastTargets = new Float32Array(this.count * 3);
      this.alignmentNoise = new Float32Array(this.count * 3);
      for (let i = 0; i < this.alignmentNoise.length; i++) {
        let hash = Math.imul(i + 1, 0x45d9f3b);
        hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
        this.alignmentNoise[i] = ((hash ^ (hash >>> 16)) >>> 0) / 4294967295 * 2 - 1;
      }
      this.glow = new Float32Array(this.count); this.display = new Float32Array(this.count * 8);
      this.color = (options.color || '#34596e').match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16) / 255);
      this.partColor = BLUE_ACCENT;
      this.renderer = makeRenderer(canvas, this.display, this.color, this.partColor);
      this.listeners = [];
      const on = (event, handler) => {canvas.addEventListener(event, handler); this.listeners.push([event, handler]);};
      const leave = () => {this.pointer.active = false; this.settling = 3; this.wake();};
      const move = (event) => {
        if (event.pointerType === 'touch' && event.type === 'pointermove' && !event.buttons) return;
        const rect = canvas.getBoundingClientRect();
        this.pointer = {active: true, x: event.clientX - rect.left, y: event.clientY - rect.top};
        this.wake();
      };
      on('pointermove', move); on('pointerdown', move); on('pointerleave', leave); on('pointercancel', leave);
      on('pointerup', (event) => {if (event.pointerType !== 'mouse') leave();});
      on('webglcontextlost', (event) => {event.preventDefault(); this.lost = true; options.onAvailability?.(false);});
      on('webglcontextrestored', () => {
        try {this.renderer = makeRenderer(canvas, this.display, this.color, this.partColor); this.lost = false; this.resize(); options.onAvailability?.(true); this.wake();}
        catch (error) {options.onAvailability?.(false);}
      });
      this.resize(); this.update(0, true); this.render();
      this.resizeObserver = new ResizeObserver(() => {this.resize(); this.wake();});
      this.resizeObserver.observe(canvas);
    }
    wake() {this.dirty = true; this.options.onWake?.();}
    setSpinning(enabled) {this.spinEnabled = enabled; this.wake();}
    get needsFrame() {return !this.lost && !this.disposed && (this.spinEnabled || this.transition || this.pointer.active || this.settling > 0 || this.dirty);}
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width), height = Math.max(1, rect.height), dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
      const radius = Math.max(this.child.radius, this.system.radius, 1.35);
      const projected = radius * CAMERA / Math.sqrt(CAMERA * CAMERA - radius * radius);
      const baseScale = Math.min(width * .45, height * .43) / projected;
      this.viewport = {width, height, dpr, cx: width / 2, cy: height * .47, baseScale, scale: baseScale * this.zoom};
      this.childScale = fitZoom(this.child, this.requestedChildScale, this.viewport);
      this.systemScale = fitZoom(this.system, this.requestedSystemScale, this.viewport);
      this.zoomTo = this.current === this.child ? this.childScale : this.systemScale;
      this.zoomFrom = this.transition ? (this.current === this.child ? this.systemScale : this.childScale) : this.zoomTo;
      const eased = this.progress * this.progress * (3 - 2 * this.progress);
      this.zoom = this.transition ? this.zoomFrom + (this.zoomTo - this.zoomFrom) * eased : this.zoomTo;
      this.viewport.scale = baseScale * this.zoom;
      this.pointer.active = false; this.dirty = true;
    }
    toggle() {
      if (this.transition || this.lost || this.disposed) return false;
      const target = this.current === this.child ? this.system : this.child;
      if (this.rotationGroups) {
        const phase = this.rotationGroups.angle(target === this.system);
        this.join = {from: this.spin, phase, delta: Math.atan2(Math.sin(phase - this.spin), Math.cos(phase - this.spin))};
      }
      this.zoomFrom = this.zoom; this.zoomTo = target === this.child ? this.childScale : this.systemScale;
      this.source.set(this.shape); this.sourceOpacity.set(this.opacity);
      this.transition = window.RobotTransitions.create(this.current, target, this.source, this.sourceOpacity, true, window.RobotPoseMath.viewRotation(this.spin));
      this.current = target; this.progress = 0; this.pointer.active = false;
      this.options.onState?.(target === this.system, true); this.wake();
      return true;
    }
    update(dt, initialize = false) {
      if (this.lost || this.disposed) return;
      const transitioning = !!this.transition;
      this.alignmentStrength = 0;
      if (!transitioning) {
        if (this.rotationGroups) this.spin = this.rotationGroups.angle(this.current === this.system);
        else if (this.spinEnabled) this.spin += dt * ROTATION_SPEED;
      }
      if (transitioning) {
        this.progress = Math.min(1, this.progress + dt * TRANSITION_SPEED / this.transition.duration);
        this.transition.sample(this.progress, this.shape, this.opacity);
        const eased = this.progress * this.progress * (3 - 2 * this.progress);
        this.zoom = this.zoomFrom + (this.zoomTo - this.zoomFrom) * eased;
        if (this.rotationGroups && this.join) {
          const phase = this.rotationGroups.angle(this.current === this.system);
          const destination = this.join.from + this.join.delta + phase - this.join.phase;
          const blend = smooth(.48, .92, this.progress);
          this.spin = blend === 1 ? phase : this.join.from + (destination - this.join.from) * blend;
          if (blend > 0 && blend < 1) this.alignmentStrength = Math.sin(Math.PI * blend) ** 2 * Math.min(1, Math.abs(destination - this.join.from) / .45);
        }
      } else {this.shape.set(this.current.posed); this.opacity.fill(1);}
      this.viewport.scale = this.viewport.baseScale * this.zoom;
      const view = window.RobotPoseMath.viewRotation(this.spin);
      const stiffness = 38 * (transitioning ? TRANSITION_SPEED ** 2 : 1);
      const damping = Math.exp(-7.5 * (transitioning ? TRANSITION_SPEED : 1) * dt);
      const {cx, cy, scale, width} = this.viewport;
      const radius = Math.max(40, Math.min(60, width * .22)), radius2 = radius * radius;
      const guide = this.transition && this.transition.anchorMask;
      const membership = this.system.attachment?.mask;
      const fade = this.progress * this.progress * (3 - 2 * this.progress);
      const partBlend = transitioning ? (this.current === this.system ? fade : 1 - fade) : (this.current === this.system ? 1 : 0);
      const scatter = this.alignmentStrength * .16;
      const gather = transitioning && this.rotationGroups ? smooth(.86, 1, this.progress) : 0;
      for (let i = 0; i < this.count; i++) {
        const b = i * 6, p = i * 3, d = i * 8;
        const sx = this.shape[b], sy = this.shape[b + 1], sz = this.shape[b + 2];
        const x = view[0] * sx + view[1] * sy + view[2] * sz + this.alignmentNoise[p] * scatter;
        const y = view[3] * sx + view[4] * sy + view[5] * sz + this.alignmentNoise[p + 1] * scatter;
        const z = view[6] * sx + view[7] * sy + view[8] * sz + this.alignmentNoise[p + 2] * scatter * .6;
        if (initialize || (transitioning && this.opacity[i] < .001)) {
          this.positions[p] = x; this.positions[p + 1] = y; this.positions[p + 2] = z;
          this.velocities[p] = this.velocities[p + 1] = this.velocities[p + 2] = 0;
        } else if (!transitioning && this.rotationGroups) {
          // Carry rotation exactly; springs act on hover displacement rather than delaying the group's angle.
          this.positions[p] += x - this.lastTargets[p]; this.positions[p + 1] += y - this.lastTargets[p + 1]; this.positions[p + 2] += z - this.lastTargets[p + 2];
        }
        this.lastTargets[p] = x; this.lastTargets[p + 1] = y; this.lastTargets[p + 2] = z;
        let ax = (x - this.positions[p]) * stiffness, ay = (y - this.positions[p + 1]) * stiffness, az = (z - this.positions[p + 2]) * stiffness, energy = 0;
        if (this.pointer.active && !transitioning) {
          const perspective = CAMERA / (CAMERA - this.positions[p + 2]);
          const dx = cx + this.positions[p] * scale * perspective - this.pointer.x;
          const dy = cy - this.positions[p + 1] * scale * perspective - this.pointer.y;
          const distance2 = dx * dx + dy * dy;
          if (distance2 < radius2) {
            const distance = Math.sqrt(distance2), falloff = 1 - distance / radius, force = falloff * falloff * 26;
            ax += (distance > .01 ? dx / distance : Math.cos(i)) * force;
            ay += (distance > .01 ? -dy / distance : Math.sin(i)) * force;
            az += ((i * .61803398875) % 1 - .3) * force * .65;
            energy = falloff;
          }
        }
        this.velocities[p] = (this.velocities[p] + ax * dt) * damping;
        this.velocities[p + 1] = (this.velocities[p + 1] + ay * dt) * damping;
        this.velocities[p + 2] = (this.velocities[p + 2] + az * dt) * damping;
        this.positions[p] += this.velocities[p] * dt; this.positions[p + 1] += this.velocities[p + 1] * dt;
        this.positions[p + 2] = Math.max(-2.5, Math.min(2.5, this.positions[p + 2] + this.velocities[p + 2] * dt));
        if (gather > 0) {
          this.positions[p] += (x - this.positions[p]) * gather; this.positions[p + 1] += (y - this.positions[p + 1]) * gather; this.positions[p + 2] += (z - this.positions[p + 2]) * gather;
          this.velocities[p] *= 1 - gather; this.velocities[p + 1] *= 1 - gather; this.velocities[p + 2] *= 1 - gather;
        }
        this.glow[i] += (energy - this.glow[i]) * Math.min(1, dt * (energy > this.glow[i] ? 14 : 3));
        const nx = this.shape[b + 3], ny = this.shape[b + 4], nz = this.shape[b + 5];
        const shade = Math.max(.08, Math.min(1, .42 - .2 * (view[0] * nx + view[1] * ny + view[2] * nz) + .25 * (view[3] * nx + view[4] * ny + view[5] * nz) + .33 * (view[6] * nx + view[7] * ny + view[8] * nz) + z * .12));
        this.display[d] = this.positions[p]; this.display[d + 1] = this.positions[p + 1]; this.display[d + 2] = this.positions[p + 2];
        this.display[d + 3] = shade; this.display[d + 4] = Math.min(1, this.glow[i] + this.alignmentStrength * .25 + (guide && guide[i] ? Math.sin(Math.PI * this.progress) * .35 : 0));
        this.display[d + 5] = (i * .61803398875) % 1; this.display[d + 6] = this.opacity[i];
        this.display[d + 7] = membership && membership[i] ? partBlend : 0;
      }
      this.settling = Math.max(0, this.settling - dt);
      if (transitioning && this.progress === 1) {
        this.transition = null; this.join = null; this.settling = 1; this.options.onState?.(this.current === this.system, false);
      }
    }
    render() {if (!this.lost && !this.disposed) {this.renderer.draw(this.viewport); this.dirty = false;}}
    dispose() {
      this.disposed = true; this.resizeObserver.disconnect(); this.renderer.dispose();
      this.listeners.forEach(([event, handler]) => this.canvas.removeEventListener(event, handler));
    }
  }
  window.RobotParticlePairs = Object.freeze({decodeModels, PairView, RotationGroups, transitionSpeed: TRANSITION_SPEED});
})();
