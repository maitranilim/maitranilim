import { dist, mulberry32 } from '../core/math.js';
import { HIDEOUTS } from './deck.js';

const POINT_SPACING = 0.15;
const LINE_LIFE = 40;
const MAX_POINTS = 600;
const MAT_RANGE = 1.6;
const MAT_SECONDS = 45;
const MAX_WIRES = 6;
const WIRE_LENGTH = 1.2;
const RIPPLE_LIFE = 1.2;
const BUILDING = new Set(['wander', 'idle', 'groom']);

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Six fixed ray angles per hideout, fanned out from the entrance away from the footprint.
function rayAngles(h, seed) {
  const rng = mulberry32(hashId(h.id) ^ seed);
  const outward = Math.atan2(h.entrance.z - h.z, h.entrance.x - h.x);
  const out = [];
  for (let i = 0; i < MAX_WIRES; i++) {
    out.push(outward + (i / (MAX_WIRES - 1) - 0.5) * 2.4 + (rng() - 0.5) * 0.2);
  }
  return out;
}

function wiresFor(h, angles, progress) {
  const n = Math.min(MAX_WIRES, Math.floor(progress * MAX_WIRES + 1e-9));
  const segs = [];
  for (let i = 0; i < n; i++) {
    segs.push({
      a: { x: h.entrance.x, z: h.entrance.z },
      b: { x: h.entrance.x + Math.cos(angles[i]) * WIRE_LENGTH, z: h.entrance.z + Math.sin(angles[i]) * WIRE_LENGTH },
    });
  }
  return segs;
}

export function createSilk(mats = {}, { seed = 0 } = {}) {
  const silk = { draglines: [], mats: {}, tripwires: {}, ripples: [], last: null, angles: {}, seed };
  for (const h of HIDEOUTS) {
    const v = mats[h.id];
    silk.mats[h.id] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    silk.angles[h.id] = rayAngles(h, seed);
    silk.tripwires[h.id] = wiresFor(h, silk.angles[h.id], silk.mats[h.id]);
  }
  return silk;
}

// A hideout was moved: its old mat stays behind (gone), and the web starts over at the new entrance.
export function resetHideoutSilk(silk, id) {
  const h = HIDEOUTS.find((q) => q.id === id);
  if (!h) return;
  silk.mats[id] = 0;
  silk.angles[id] = rayAngles(h, silk.seed ?? 0);
  silk.tripwires[id] = wiresFor(h, silk.angles[id], 0);
}

export function stepSilk(silk, body, brainState, dt) {
  for (const pt of silk.draglines) pt.age += dt;
  silk.draglines = silk.draglines.filter((pt) => pt.age <= LINE_LIFE);
  for (const r of silk.ripples) r.age += dt;
  silk.ripples = silk.ripples.filter((r) => r.age < RIPPLE_LIFE);

  if (!silk.last || dist(silk.last, body) >= POINT_SPACING) {
    silk.draglines.push({ x: body.x, z: body.z, age: 0 });
    if (silk.draglines.length > MAX_POINTS) silk.draglines.splice(0, silk.draglines.length - MAX_POINTS);
    silk.last = { x: body.x, z: body.z };
  }

  if (!BUILDING.has(brainState)) return;
  for (const h of HIDEOUTS) {
    if (dist(body, h.entrance) > MAT_RANGE || silk.mats[h.id] >= 1) continue;
    silk.mats[h.id] = Math.min(1, silk.mats[h.id] + dt / MAT_SECONDS);
    silk.tripwires[h.id] = wiresFor(h, silk.angles[h.id], silk.mats[h.id]);
  }
}

function closestOnSegment(a, b, p) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-12 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return { x: a.x + dx * t, z: a.z + dz * t };
}

// Closest point on the nearest dragline or tripwire segment within `radius`, else null.
export function threadHit(silk, p, radius = 0.25) {
  let best = null;
  let bestD = radius;
  const test = (a, b) => {
    const c = closestOnSegment(a, b, p);
    const d = dist(c, p);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  };
  const pts = silk.draglines;
  for (let i = 1; i < pts.length; i++) test(pts[i - 1], pts[i]);
  for (const id of Object.keys(silk.tripwires)) for (const s of silk.tripwires[id]) test(s.a, s.b);
  return best;
}

export function ripple(silk, p) {
  silk.ripples.push({ x: p.x, z: p.z, age: 0 });
}

export function matsSnapshot(silk) {
  return { ...silk.mats };
}
