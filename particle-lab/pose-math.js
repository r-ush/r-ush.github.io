/* Right-handed, row-major rotations. RPY is in degrees on the original STL axes. */
(() => {
  'use strict';
  const rad = Math.PI / 180;
  const cadToScene = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  function multiply(a, b) {
    const out = new Array(9).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
    }
    return out;
  }
  function transpose(m) { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }
  function fromEuler({roll, pitch, yaw}) {
    const cr = Math.cos(roll * rad), sr = Math.sin(roll * rad);
    const cp = Math.cos(pitch * rad), sp = Math.sin(pitch * rad);
    const cy = Math.cos(yaw * rad), sy = Math.sin(yaw * rad);
    // Fixed-axis X, then Y, then Z: Rz(yaw) Ry(pitch) Rx(roll).
    return [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
      sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
      -sp, cp * sr, cp * cr];
  }
  function toEuler(m) {
    const pitch = Math.asin(Math.max(-1, Math.min(1, -m[6])));
    const singular = Math.abs(Math.cos(pitch)) < 1e-7;
    return {
      roll: (singular ? 0 : Math.atan2(m[7], m[8])) / rad,
      pitch: pitch / rad,
      yaw: (singular ? Math.atan2(-m[1], m[4]) : Math.atan2(m[3], m[0])) / rad
    };
  }
  function toScene(pose) {
    return multiply(multiply(cadToScene, fromEuler(pose)), transpose(cadToScene));
  }
  function viewRotation(spin = 0) {
    return multiply(fromEuler({roll: 0.18 / rad, pitch: 0, yaw: 0}), fromEuler({roll: 0, pitch: (spin - 0.5) / rad, yaw: 0}));
  }
  const view = viewRotation();
  const basis = multiply(view, cadToScene);
  function drag(pose, dx, dy, twist) {
    const delta = twist
      ? fromEuler({roll: 0, pitch: 0, yaw: -dx * 0.4})
      : fromEuler({roll: dy * 0.35, pitch: dx * 0.35, yaw: 0});
    // Screen-space drag, converted back into the original STL coordinate frame.
    return toEuler(multiply(multiply(multiply(transpose(basis), delta), basis), fromEuler(pose)));
  }
  window.RobotPoseMath = Object.freeze({multiply, transpose, fromEuler, toEuler, toScene, drag, viewRotation});
})();
