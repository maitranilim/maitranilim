import { SHADES } from '../core/state.js';
import { BOUNDS, HIDEOUTS } from './deck.js';
import { SPIDER_SCALE } from './gait.js';
import { BODY_BACK, BODY_CLEARANCE, BODY_FRONT, BODY_RADIUS } from './locomotion.js';

export const MOULT_INTERVAL = 780;
export const MOULT_PHASES = [['still', 4], ['roll', 2], ['emerge', 6], ['rollBack', 2]];
const MAX_MOULTS = 50;
const DECK_SHELLS = 6;
// The emerge cast lies this far behind the body, on the same heading (R18, scaled per R25).
export const CAST_OFFSET = 1.15 * SPIDER_SCALE;

// Advances the moult clock only while the player is active.
export function tickMoultClock(state, dt, active) {
  return active ? { ...state, sinceMoult: state.sinceMoult + dt } : state;
}

export function isMoultDue(state) {
  return state.sinceMoult >= MOULT_INTERVAL;
}

// Leaves a shell in the old shade, then moves on to the next shade.
export function completeMoult(state, body, now) {
  const shell = { id: 'm' + now, shadeIndex: state.shadeIndex, at: now, x: body.x, z: body.z, rot: body.heading };
  return {
    ...state,
    shadeIndex: (state.shadeIndex + 1) % SHADES.length,
    sinceMoult: 0,
    moults: [shell, ...state.moults].slice(0, MAX_MOULTS),
  };
}

export function deckShells(state) {
  return [...state.moults].sort((a, b) => b.at - a.at).slice(0, DECK_SHELLS);
}

export function moultPhase(t) {
  let start = 0;
  for (const [phase, len] of MOULT_PHASES) {
    if (t < start + len) return { phase, p: Math.max(0, (t - start) / len) };
    start += len;
  }
  return { phase: 'done', p: 1 };
}

// Where the old skin is left when a spider standing at `body` finishes its moult.
export function castPose(body) {
  const h = body.heading;
  return { x: body.x - Math.cos(h) * CAST_OFFSET, z: body.z - Math.sin(h) * CAST_OFFSET, heading: h };
}

function segmentDist(p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

// The two ends of a segment along `heading` from `front` to `back` (offsets along the heading).
function segment(x, z, heading, front, back) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [front, back].map((t) => ({ x: x + c * t, z: z + s * t }));
}

// Whether a spider moulting at `pose` fits: the body and its cast, one capsule along the heading
// from the body's front to the cast's abdomen tip, lies inside the walkable bounds and keeps
// BODY_CLEARANCE (+ margin) from every hideout.
export function moultFits(pose, margin = 0) {
  const ends = segment(pose.x, pose.z, pose.heading, BODY_FRONT, BODY_BACK - CAST_OFFSET);
  for (const e of ends) {
    if (e.x < BOUNDS.minX + margin || e.x > BOUNDS.maxX - margin) return false;
    if (e.z < BOUNDS.minZ + margin || e.z > BOUNDS.maxZ - margin) return false;
  }
  return HIDEOUTS.every((h) => segmentDist(h, ends[0], ends[1]) >= h.r + BODY_CLEARANCE + margin);
}

const SWEEP_STEP = 0.05; // rad

// Whether the body can pivot on the spot at (x, z) from heading `from` to `to` (the shorter way,
// as locomotion turns) without its capsule touching ceramic: locomotion would block that turn.
function pivotClear(x, z, from, to) {
  const turn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const n = Math.ceil(Math.abs(turn) / SWEEP_STEP);
  for (let i = 1; i <= n; i++) {
    const [a, b] = segment(x, z, from + (turn * i) / n, BODY_FRONT, BODY_BACK);
    if (HIDEOUTS.some((h) => segmentDist(h, a, b) < h.r + BODY_RADIUS)) return false;
  }
  return true;
}

const SPOT_HEADINGS = 24;
const SPOT_RING = 0.5; // candidate spots lie on rings this far apart around the body
const SPOT_RINGS = 16;
const TURN_COST = 0.5; // u of walking worth one radian of turning

// The nearest pose (walk there, then turn on the spot) where moultFits(pose, margin) holds and
// the final turn is clear of ceramic, or null. A walk is assumed to arrive facing its direction.
export function moultSpot(body, margin = 0) {
  let best = null;
  let bestCost = Infinity;
  const consider = (x, z, walk, arrive) => {
    for (let k = 0; k < SPOT_HEADINGS; k++) {
      const heading = -Math.PI + (k * 2 * Math.PI) / SPOT_HEADINGS;
      const turn = Math.abs(Math.atan2(Math.sin(heading - arrive), Math.cos(heading - arrive)));
      const cost = walk + TURN_COST * turn;
      if (cost < bestCost && moultFits({ x, z, heading }, margin) && pivotClear(x, z, arrive, heading)) {
        best = { x, z, heading };
        bestCost = cost;
      }
    }
  };
  consider(body.x, body.z, 0, body.heading);
  for (let ring = 1; ring <= SPOT_RINGS; ring++) {
    const r = ring * SPOT_RING;
    if (r >= bestCost) break; // nothing farther can be cheaper
    const n = Math.max(8, Math.round((2 * Math.PI * r) / SPOT_RING));
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n;
      consider(body.x + Math.cos(a) * r, body.z + Math.sin(a) * r, r, a);
    }
  }
  return best;
}
