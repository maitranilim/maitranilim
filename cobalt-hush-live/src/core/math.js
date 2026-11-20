export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export function wrapAngle(a) {
  const TAU = Math.PI * 2;
  let r = a - TAU * Math.floor((a + Math.PI) / TAU); // [-PI, PI)
  if (r === -Math.PI) r = Math.PI;
  return r;
}
export const v2 = (x = 0, z = 0) => ({ x, z });
export const add = (a, b) => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (v, s) => ({ x: v.x * s, z: v.z * s });
export const len = (v) => Math.hypot(v.x, v.z);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function norm(v) {
  const l = len(v);
  return l > 1e-9 ? { x: v.x / l, z: v.z / l } : { x: 0, z: 0 };
}
// Seeded PRNG: returns () => float in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
