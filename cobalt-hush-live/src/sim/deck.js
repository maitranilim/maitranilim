import { clamp, dist, norm, sub } from '../core/math.js';

export const BOUNDS = { minX: -7.4, maxX: 7.4, minZ: -4.4, maxZ: 4.4 };

const ENTRANCE_GAP = 0.2;
const CENTRE = { x: 0, z: 0 };

function makeHideout(id, kind, x, z, r) {
  return place({ id, kind, r, rot: 0, entrance: { x: 0, z: 0 } }, x, z);
}

// Puts a hideout at (x, z), its entrance just outside the edge on the side facing the deck centre
// (a piece dropped right at the centre keeps the way it faced).
function place(h, x, z) {
  h.x = x;
  h.z = z;
  const away = Math.hypot(CENTRE.x - x, CENTRE.z - z);
  if (away > 1e-6) h.rot = Math.atan2(CENTRE.z - z, CENTRE.x - x);
  const d = h.r + ENTRANCE_GAP;
  h.entrance = { x: x + Math.cos(h.rot) * d, z: z + Math.sin(h.rot) * d };
  return h;
}

export const HIDEOUTS = [
  makeHideout('bark', 'bark', -5.2, -2.6, 1.1),
  makeHideout('stone', 'stone', 4.6, -2.4, 1.0),
  makeHideout('litter', 'litter', -4.8, 2.6, 1.2),
  makeHideout('moss', 'moss', 1.2, 3.2, 0.8),
  makeHideout('twig', 'twig', 5.4, 2.4, 0.9),
];

// ---- rearranging (the player can drag hideouts to new places) ----
const HOME = new Map(HIDEOUTS.map((h) => [h.id, { x: h.x, z: h.z }]));
export const DECK_HALF = { x: 8, z: 5 };
const EDGE_GAP = 0.15; // a piece stays this far inside the slab's edge
export const LAYOUT_GAP = 0.9; // walking room kept between two pieces

// The nearest valid spot to `p` for hideout `id`: on the slab, clear of the other pieces by
// LAYOUT_GAP and of each `avoid` circle ({x, z, r}, e.g. the spider). Null if none is near.
export function fitHideout(id, p, avoid = []) {
  const h = HIDEOUTS.find((q) => q.id === id);
  if (!h || !Number.isFinite(p?.x) || !Number.isFinite(p?.z)) return null;
  const lim = { x: DECK_HALF.x - h.r - EDGE_GAP, z: DECK_HALF.z - h.r - EDGE_GAP };
  const blockers = [...HIDEOUTS.filter((o) => o.id !== id).map((o) => ({ x: o.x, z: o.z, r: o.r + LAYOUT_GAP })), ...avoid];
  let x = clamp(p.x, -lim.x, lim.x);
  let z = clamp(p.z, -lim.z, lim.z);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (const o of blockers) {
      const need = h.r + o.r;
      const d = Math.hypot(x - o.x, z - o.z);
      if (d >= need) continue;
      const n = d > 1e-9 ? { x: (x - o.x) / d, z: (z - o.z) / d } : { x: 1, z: 0 };
      x = clamp(o.x + n.x * (need + 1e-6), -lim.x, lim.x);
      z = clamp(o.z + n.z * (need + 1e-6), -lim.z, lim.z);
      moved = true;
    }
    if (!moved) return { x, z };
  }
  const clear = blockers.every((o) => Math.hypot(x - o.x, z - o.z) >= h.r + o.r - 1e-6);
  return clear ? { x, z } : null;
}

export function moveHideout(id, p) {
  const h = HIDEOUTS.find((q) => q.id === id);
  if (h) place(h, p.x, p.z);
  return h ?? null;
}

// Where every piece stands now, for saving.
export function hideoutLayout() {
  return Object.fromEntries(HIDEOUTS.map((h) => [h.id, { x: h.x, z: h.z }]));
}

// Restores a saved layout, piece by piece; a piece whose saved spot no longer fits stays home.
export function applyLayout(layout = {}) {
  resetLayout();
  for (const h of HIDEOUTS) {
    const at = layout?.[h.id];
    if (!at) continue;
    const fit = fitHideout(h.id, at);
    if (fit && Math.hypot(fit.x - at.x, fit.z - at.z) < 0.05) place(h, fit.x, fit.z);
  }
}

export function resetLayout() {
  for (const h of HIDEOUTS) {
    const home = HOME.get(h.id);
    place(h, home.x, home.z);
  }
}

// Pushes p into BOUNDS and out of every hideout circle (except `allowEnter`, a hideout id), to at
// least `clearance` beyond its edge (the body's own radius, for points the body must stand on).
export function clampWalkable(p, allowEnter = null, clearance = 0) {
  let x = clamp(p.x, BOUNDS.minX, BOUNDS.maxX);
  let z = clamp(p.z, BOUNDS.minZ, BOUNDS.maxZ);
  for (const h of HIDEOUTS) {
    if (h.id === allowEnter) continue;
    const d = Math.hypot(x - h.x, z - h.z);
    const r = h.r + clearance;
    if (d >= r) continue;
    // Exactly at the centre there is no direction: leave towards the deck centre.
    const n = d > 1e-9 ? { x: (x - h.x) / d, z: (z - h.z) / d } : norm(sub(CENTRE, h));
    x = h.x + n.x * (r + 1e-6);
    z = h.z + n.z * (r + 1e-6);
  }
  return { x, z };
}

// Nearest by distance to the footprint edge.
export function nearestHideout(p) {
  let best = HIDEOUTS[0];
  let bestD = Infinity;
  for (const h of HIDEOUTS) {
    const d = dist(p, h) - h.r;
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

export function insideHideout(p) {
  for (const h of HIDEOUTS) if (dist(p, h) < h.r) return h;
  return null;
}
