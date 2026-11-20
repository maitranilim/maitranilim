import { clamp, wrapAngle } from '../core/math.js';

// The spider is designed at 1.4 u long and built at SPIDER_SCALE (polish pass, R24: at the
// overview it read too small). Every leg number below is a design value times the scale, so the
// gait, the IK and the mesh (which divides it back out) stay consistent.
export const SPIDER_SCALE = 1.35;
export const HIP_HEIGHT = 0.28 * SPIDER_SCALE;

const S = SPIDER_SCALE;
const mk = (id, side, index, hz, rx, rz, femur, tibia) => ({
  id, side, index,
  hip: { x: 0.22 * side * S, z: hz * S },
  rest: { x: rx * side * S, z: rz * S },
  femur: femur * S, tibia: tibia * S,
});

// A low, wide tarantula stance (design units): feet planted 1.0-1.26 out to the side, so the knees
// sit just above the carapace (~0.5-0.6 high) with ~0.2 of reach to spare. Leg 1 reaches forward,
// leg 4 back.
const SPEC = [
  [0, 0.30, 1.125, 1.205, 0.70, 0.80],
  [1, 0.12, 1.263, 0.40, 0.62, 0.72],
  [2, -0.06, 1.219, -0.384, 0.60, 0.70],
  [3, -0.22, 1.023, -1.112, 0.72, 0.82],
];
export const LEGS = [];
for (const [side, name] of [[-1, 'L'], [1, 'R']]) {
  for (const [i, hz, rx, rz, f, t] of SPEC) LEGS.push(mk(`${name}${i + 1}`, side, i, hz, rx, rz, f, t));
}

export const GROUPS = [['L1', 'R2', 'L3', 'R4'], ['R1', 'L2', 'R3', 'L4']];

export function localToWorld(body, local) {
  const c = Math.cos(body.heading), s = Math.sin(body.heading);
  return {
    x: body.x + c * local.z - s * local.x,
    z: body.z + s * local.z + c * local.x,
  };
}

// Mean distance of the rest feet from the body centre: a pivot sweeps them at |omega| * this.
const REST_RADIUS = LEGS.reduce((n, l) => n + Math.hypot(l.rest.x, l.rest.z), 0) / LEGS.length;
const LEAD = 0.6; // feet land this fraction of a step time ahead of the moving rest point
const TIDY = 0.5; // a stepping group also re-places mates more than this fraction of the threshold off
const EMERGENCY = 2; // any foot this many thresholds off may step out of turn (at most 4 in the air)
const MAX_AIR = 4;
const GROUP_LEGS = GROUPS.map((g) => LEGS.filter((l) => g.includes(l.id)));

// The body extrapolated `t` seconds ahead at its current velocity and turn rate.
function ahead(gait, body, t) {
  return { x: body.x + body.vx * t, z: body.z + body.vz * t, heading: body.heading + gait.omega * t };
}

// Growth: the gait stands and steps at the spider's size (rest feet, step threshold and lift scale).
const restOf = (gait, leg) => (gait.size === 1 ? leg.rest : { x: leg.rest.x * gait.size, z: leg.rest.z * gait.size });

export function createGait(body, size = 1) {
  const feet = {};
  for (const leg of LEGS) {
    const p = localToWorld(body, { x: leg.rest.x * size, z: leg.rest.z * size });
    feet[leg.id] = { x: p.x, y: 0, z: p.z, planted: true, t: 0, from: { x: p.x, z: p.z }, to: { x: p.x, z: p.z } };
  }
  return { feet, activeGroup: 0, heading: body.heading, omega: 0, size };
}

// Tetrapod gait. Planted feet never move. Groups alternate: a group steps only when every foot is
// down, and it lifts every foot that will be past the threshold by the time a step lands (so the
// stance never strays more than a threshold), plus mates already TIDY-way off, so the four move
// as one. The step time shortens with the feet's ground speed, which includes the pivot sweep.
// Out of turn, only a foot EMERGENCY thresholds off may step, and only while fewer than 4 are up.
export function stepGait(gait, body, dt, { stepThreshold: baseThreshold = 0.32, stepTime = 0.14, lift: baseLift = 0.16 } = {}) {
  gait.size ??= 1;
  const stepThreshold = baseThreshold * gait.size;
  const lift = baseLift * gait.size;
  if (dt > 0) gait.omega = wrapAngle(body.heading - (gait.heading ?? body.heading)) / dt;
  gait.heading = body.heading;
  const footSpeed = Math.hypot(body.vx, body.vz) + Math.abs(gait.omega) * REST_RADIUS * gait.size;
  const time = stepTime * clamp(1.2 / Math.max(footSpeed, 0.3), 0.45, 1.4);
  const landing = ahead(gait, body, LEAD * time);
  const later = ahead(gait, body, time);
  const off = (leg, at) => {
    const f = gait.feet[leg.id];
    const r = localToWorld(at, restOf(gait, leg));
    return Math.hypot(f.x - r.x, f.z - r.z);
  };
  const startStep = (leg) => {
    const f = gait.feet[leg.id];
    f.planted = false;
    f.t = 0;
    f.from = { x: f.x, z: f.z };
    f.to = localToWorld(landing, restOf(gait, leg));
  };

  // advance airborne feet
  for (const leg of LEGS) {
    const f = gait.feet[leg.id];
    if (f.planted) continue;
    f.to = localToWorld(landing, restOf(gait, leg));
    f.t = Math.min(1, f.t + dt / time);
    f.x = f.from.x + (f.to.x - f.from.x) * f.t;
    f.z = f.from.z + (f.to.z - f.from.z) * f.t;
    if (f.t >= 1) { f.planted = true; f.y = 0; f.x = f.to.x; f.z = f.to.z; }
    else f.y = lift * Math.sin(Math.PI * f.t);
  }

  if (LEGS.every((l) => gait.feet[l.id].planted)) {
    const due = (g) => GROUP_LEGS[g].some((l) => off(l, later) > stepThreshold);
    const other = 1 - gait.activeGroup;
    if (due(other)) gait.activeGroup = other;
    if (due(gait.activeGroup)) {
      for (const l of GROUP_LEGS[gait.activeGroup]) if (off(l, later) > stepThreshold * TIDY) startStep(l);
    }
  }

  let air = LEGS.filter((l) => !gait.feet[l.id].planted).length;
  for (const l of LEGS) {
    if (air >= MAX_AIR) break;
    if (gait.feet[l.id].planted && off(l, body) > stepThreshold * EMERGENCY) {
      startStep(l);
      air++;
    }
  }
  return gait;
}

const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul3 = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len3 = (a) => Math.hypot(a.x, a.y, a.z);
const unit3 = (a) => { const l = len3(a) || 1; return mul3(a, 1 / l); };

export function solveTwoBone(root, target, a, b, poleUp) {
  const delta = sub3(target, root);
  const raw = len3(delta);
  const dir = raw > 1e-9 ? mul3(delta, 1 / raw) : { x: 0, y: -1, z: 0 };
  const d = clamp(raw, Math.abs(a - b) + 1e-6, a + b);
  const foot = add3(root, mul3(dir, d));
  // distance along dir to the knee's projection, and its height off the line
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  let bend = sub3(poleUp, mul3(dir, dot3(poleUp, dir)));
  if (len3(bend) < 1e-6) bend = sub3({ x: 0, y: 1, z: 0 }, mul3(dir, dir.y));
  if (len3(bend) < 1e-6) bend = { x: 1, y: 0, z: 0 };
  const knee = add3(add3(root, mul3(dir, along)), mul3(unit3(bend), h));
  return { knee, foot };
}
