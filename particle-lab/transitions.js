/* Semantic assembly transitions and free particle scattering. No runtime mesh registration. */
(() => {
  'use strict';
  const M = window.RobotPoseMath;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ease = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

  function quaternion(m) {
    let q;
    const trace = m[0] + m[4] + m[8];
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4];
    } else if (m[0] > m[4] && m[0] > m[8]) {
      const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
      q = [s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s];
    } else if (m[4] > m[8]) {
      const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
      q = [(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s];
    } else {
      const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
      q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s];
    }
    const norm = Math.hypot(...q);
    return q.map((v) => v / norm);
  }

  function rotationBetween(a, b, t) {
    let dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const sign = dot < 0 ? -1 : 1;
    dot = Math.min(1, Math.abs(dot));
    const angle = Math.acos(dot), sine = Math.sin(angle);
    const wa = sine < 1e-5 ? 1 - t : Math.sin((1 - t) * angle) / sine;
    const wb = sine < 1e-5 ? t : Math.sin(t * angle) / sine;
    const q = a.map((v, i) => v * wa + b[i] * wb * sign);
    const norm = Math.hypot(...q);
    const [x, y, z, w] = q.map((v) => v / norm);
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  }

  function mirroredPair(child, parent, forward, view) {
    const link = parent.attachment, mirror = link.mirror;
    const count = child.points.length / 6;
    const childRotation = M.toScene(child.pose), parentRotation = M.toScene(parent.pose);
    const screenReflection = M.multiply(M.multiply(M.transpose(view), [-1, 0, 0, 0, 1, 0, 0, 0, 1]), view);
    // A reflection is not a rotation: reflect the copy's points/normals first,
    // then interpolate only proper rotations. Never flatten the hand through a
    // determinant-zero matrix while changing its handedness.
    const reflectedPoints = new Float32Array(child.points.length);
    for (let i = 0; i < child.points.length; i += 3) {
      const reflected = apply(mirror.reflection, child.points.subarray(i, i + 3));
      reflectedPoints.set(reflected, i);
    }
    const starts = [childRotation, M.multiply(M.multiply(screenReflection, childRotation), M.transpose(mirror.reflection))].map(quaternion);
    const ends = [M.multiply(parentRotation, link.rotation), M.multiply(parentRotation, mirror.rotation)].map(quaternion);
    const mounts = [apply(parentRotation, link.translation), apply(parentRotation, mirror.translation)];
    const side = apply(view, mounts[0])[0] <= apply(view, mounts[1])[0] ? -1 : 1;
    const mids = [apply(M.transpose(view), [side * .55, .04, 0]), apply(M.transpose(view), [-side * .55, .04, 0])];
    return {
      type: forward ? 'duplicate' : 'merge', duration: 4.8, anchorMask: link.mask,
      sample(progress, out, alpha) {
        // The same path in reverse brings the two hands back into one.
        const p = forward ? progress : 1 - progress;
        const split = ease(.02, .40, p), mount = ease(.45, .96, p);
        const s = mix(mix(1, .68, split), link.scale, mount);
        const rotations = [rotationBetween(starts[0], ends[0], mount), rotationBetween(starts[1], ends[1], mount)];
        const centers = mids.map((mid, group) => mid.map((v, axis) => mix(v * split, mounts[group][axis], mount)));
        const bodyOut = 1 - ease(0, .22, p), bodyIn = ease(.58, 1, p);
        const copyOut = 1 - ease(0, .10, p), copyIn = ease(.14, .35, p);
        for (let i = 0; i < count; i++) {
          const b = i * 6, group = link.mask[i];
          if (group === 0 && p >= .27) {
            for (let j = 0; j < 6; j++) out[b + j] = parent.posed[b + j];
            alpha[i] = bodyIn;
            continue;
          }
          const isCopy = group === 2 && p >= .12;
          const points = isCopy ? reflectedPoints : child.points;
          const source = (isCopy ? mirror.sourceIndices[i] : i) * 6;
          const r = rotations[isCopy ? 1 : 0], center = centers[isCopy ? 1 : 0];
          const x = points[source], y = points[source + 1], z = points[source + 2];
          out[b] = (r[0] * x + r[1] * y + r[2] * z) * s + center[0];
          out[b + 1] = (r[3] * x + r[4] * y + r[5] * z) * s + center[1];
          out[b + 2] = (r[6] * x + r[7] * y + r[8] * z) * s + center[2];
          const nx = points[source + 3], ny = points[source + 4], nz = points[source + 5];
          out[b + 3] = r[0] * nx + r[1] * ny + r[2] * nz;
          out[b + 4] = r[3] * nx + r[4] * ny + r[5] * nz;
          out[b + 5] = r[6] * nx + r[7] * ny + r[8] * nz;
          alpha[i] = group === 1 ? 1 : group === 2 ? (isCopy ? copyIn : copyOut) : bodyOut;
        }
      }
    };
  }

  function create(from, to, source, sourceOpacity, allowAttachment = true, view = M.viewRotation()) {
    const count = source.length / 6;
    const target = to.posed;
    const forward = to.attachment && to.attachment.child === from.number;
    const backward = from.attachment && from.attachment.child === to.number;
    if (allowAttachment && (forward || backward)) {
      const parent = forward ? to : from, child = forward ? from : to;
      const link = parent.attachment;
      if (link.mirror) return mirroredPair(child, parent, forward, view);
      const childRotation = M.toScene(child.pose), parentRotation = M.toScene(parent.pose);
      const mountedRotation = M.multiply(parentRotation, link.rotation);
      const mountedPosition = apply(parentRotation, link.translation);
      const qa = quaternion(forward ? childRotation : mountedRotation);
      const qb = quaternion(forward ? mountedRotation : childRotation);
      const zero = [0, 0, 0];
      const startPosition = forward ? zero : mountedPosition;
      const endPosition = forward ? mountedPosition : zero;
      const startScale = forward ? 1 : link.scale, endScale = forward ? link.scale : 1;
      return {
        type: forward ? 'assemble' : 'extract', duration: 3.6, anchorMask: link.mask,
        sample(progress, out, alpha) {
          const t = ease(forward ? 0 : .08, forward ? .82 : .95, progress);
          const r = rotationBetween(qa, qb, t);
          const s = mix(startScale, endScale, t);
          const tx = mix(startPosition[0], endPosition[0], t), ty = mix(startPosition[1], endPosition[1], t), tz = mix(startPosition[2], endPosition[2], t);
          const outgoing = 1 - ease(0, forward ? .26 : .40, progress);
          const incoming = ease(forward ? .35 : .48, 1, progress);
          for (let i = 0; i < count; i++) {
            const b = i * 6;
            const anchor = link.mask[i];
            const movingChild = anchor || (forward ? progress < .29 : progress >= .44);
            if (movingChild) {
              const p = child.points;
              out[b] = (r[0] * p[b] + r[1] * p[b + 1] + r[2] * p[b + 2]) * s + tx;
              out[b + 1] = (r[3] * p[b] + r[4] * p[b + 1] + r[5] * p[b + 2]) * s + ty;
              out[b + 2] = (r[6] * p[b] + r[7] * p[b + 1] + r[8] * p[b + 2]) * s + tz;
              out[b + 3] = r[0] * p[b + 3] + r[1] * p[b + 4] + r[2] * p[b + 5];
              out[b + 4] = r[3] * p[b + 3] + r[4] * p[b + 4] + r[5] * p[b + 5];
              out[b + 5] = r[6] * p[b + 3] + r[7] * p[b + 4] + r[8] * p[b + 5];
            } else {
              const p = parent.posed;
              for (let j = 0; j < 6; j++) out[b + j] = p[b + j];
            }
            alpha[i] = anchor ? 1 : movingChild ? (forward ? outgoing : incoming) : (forward ? incoming : outgoing);
          }
        }
      };
    }
    const burst = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const hash = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const z = (hash - Math.floor(hash)) * 2 - 1;
      const azimuth = i * 2.3999632297;
      const radius = 1.1 + ((i * .754877666) % 1) * .6;
      const ring = Math.sqrt(1 - z * z) * radius;
      const k = i * 3, b = i * 6;
      burst[k] = .15 * (source[b] + target[b]) + Math.cos(azimuth) * ring;
      burst[k + 1] = .15 * (source[b + 1] + target[b + 1]) + Math.sin(azimuth) * ring;
      burst[k + 2] = .15 * (source[b + 2] + target[b + 2]) + z * radius * .65;
    }
    return {
      type: 'scatter', duration: 2.8, anchorMask: null,
      sample(progress, out, alpha) {
        const expand = ease(0, .44, progress), reform = ease(.48, 1, progress);
        const envelope = 1 - Math.sin(Math.PI * progress) * .3;
        for (let i = 0; i < count; i++) {
          const b = i * 6, k = i * 3;
          for (let j = 0; j < 3; j++) {
            out[b + j] = mix(mix(source[b + j], burst[k + j], expand), target[b + j], reform);
            out[b + j + 3] = mix(source[b + j + 3], target[b + j + 3], progress);
          }
          alpha[i] = mix(sourceOpacity[i], 1, expand) * envelope;
        }
      }
    };
  }
  window.RobotTransitions = Object.freeze({create});
})();
