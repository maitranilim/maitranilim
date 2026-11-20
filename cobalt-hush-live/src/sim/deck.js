import { clamp, dist, norm, sub } from '../core/math.js';

export const BOUNDS = { minX: -7.4, maxX: 7.4, minZ: -4.4, maxZ: 4.4 };

const ENTRANCE_GAP = 0.2;
const CENTRE = { x: 0, z: 0 };

function makeHideout(id, kind, x, z, r) {
  // Entrance sits just outside the edge, on the side facing the deck centre.
  const dir = norm(sub(CENTRE, { x, z }));
  const d = r + ENTRANCE_GAP;
  return {
    id,
    kind,
    x,
    z,
    r,
    rot: Math.atan2(dir.z, dir.x),
    entrance: { x: x + dir.x * d, z: z + dir.z * d },
  };
}

export const HIDEOUTS = [
  makeHideout('bark', 'bark', -5.2, -2.6, 1.1),
  makeHideout('stone', 'stone', 4.6, -2.4, 1.0),
  makeHideout('litter', 'litter', -4.8, 2.6, 1.2),
  makeHideout('moss', 'moss', 1.2, 3.2, 0.8),
  makeHideout('twig', 'twig', 5.4, 2.4, 0.9),
];

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
