import { clamp, sub, wrapAngle } from '../core/math.js';
import { HIDEOUTS, clampWalkable } from './deck.js';
import { SPIDER_SCALE } from './gait.js';

const DEFAULTS = { maxSpeed: 1.2, accel: 6, turnRate: 5, arriveRadius: 0.25 };
const AVOID_MARGIN = 0.15;
// The body (cephalothorax front to abdomen tip, 0.29 ahead of and 1.145 behind the body point at
// design scale) collides as a capsule of radius BODY_RADIUS: a segment along the heading from
// BODY_BACK to BODY_FRONT (the ends inset by the radius, so the capsule spans tip to front).
export const BODY_RADIUS = 0.3 * SPIDER_SCALE;
export const BODY_FRONT = 0.29 * SPIDER_SCALE - BODY_RADIUS;
export const BODY_BACK = -1.145 * SPIDER_SCALE + BODY_RADIUS;
// Points the body is sent to stand on keep this far from ceramic, so it can actually reach them.
export const BODY_CLEARANCE = BODY_RADIUS + 0.05;
const ARRIVE_SLOW_FACTOR = 4; // start slowing at arriveRadius * this
const STOP_EPS = 0.02;
// Below PIVOT_SPEED the turn rate scales down with speed, to PIVOT_MIN of it when standing, so
// pivots on the spot are gentle and the feet can keep up. An urgent move (maxSpeed above
// PIVOT_CALM, e.g. a flee) raises that floor in proportion, so a startle doesn't dawdle.
const PIVOT_SPEED = 0.6;
const PIVOT_MIN = 0.35;
const PIVOT_CALM = 1.2;
// Turning has momentum: the turn speed ramps at TURN_ACCEL and brakes in time to stop on the
// heading, so a turn starts gently instead of snapping to full rate (the feet can follow).
const TURN_ACCEL = 24; // rad/s^2
const TURN_GAIN = 8; // rad/s of turn per radian of heading error, near the end of a turn

export function createBody(x, z, heading) {
  return { x, z, heading: wrapAngle(heading), speed: 0, vx: 0, vz: 0, turn: 0 };
}

function approach(v, target, maxDelta) {
  return v + clamp(target - v, -maxDelta, maxDelta);
}

// How far the body capsule at (x, z, heading) reaches into hideout h (<= 0: clear), and the
// outward unit normal from h through the capsule's nearest point.
function capsuleDepth(x, z, heading, h) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const t = clamp((h.x - x) * c + (h.z - z) * s, BODY_BACK, BODY_FRONT);
  const qx = x + c * t - h.x;
  const qz = z + s * t - h.z;
  const d = Math.hypot(qx, qz);
  const n = d > 1e-9 ? { x: qx / d, z: qz / d } : { x: -c, z: -s };
  return { depth: h.r + BODY_RADIUS - d, n };
}

// The first hideout (other than `except`) the body capsule overlaps, or null.
export function capsuleHideout(body, except = null) {
  for (const h of HIDEOUTS) {
    if (h.id !== except && capsuleDepth(body.x, body.z, body.heading, h).depth > 0) return h;
  }
  return null;
}

// Seek + arrive, with tangent-push avoidance of hideout circles. With no target, `opts.face` (a
// heading) turns the body on the spot to face it. Mutates and returns `body`.
export function stepBody(body, target, opts, dt) {
  const { maxSpeed, accel, turnRate: fullTurn, arriveRadius, allowEnter, face } = { ...DEFAULTS, ...opts };
  const pivotMin = clamp((PIVOT_MIN * maxSpeed) / PIVOT_CALM, PIVOT_MIN, 1);
  const turnRate = fullTurn * clamp(Math.abs(body.speed) / PIVOT_SPEED, pivotMin, 1);
  const pose0 = { x: body.x, z: body.z, heading: body.heading };
  const heading0 = body.heading;
  // Steer to the nearest walkable point so off-deck / in-hideout targets are reachable.
  const goal = target ? clampWalkable(target, allowEnter ?? null, BODY_CLEARANCE) : null;
  const toTarget = goal ? sub(goal, body) : null;
  const d = toTarget ? Math.hypot(toTarget.x, toTarget.z) : 0;

  // Turn towards a heading error, braking in time to stop on it.
  const turnFor = (err) => Math.sign(err) * Math.min(turnRate, Math.sqrt(2 * TURN_ACCEL * Math.abs(err)) * 0.9, TURN_GAIN * Math.abs(err));
  let desiredSpeed = 0;
  let wantTurn = 0;
  if (goal && d > STOP_EPS) {
    const err = wrapAngle(Math.atan2(toTarget.z, toTarget.x) - body.heading);
    wantTurn = turnFor(err);
    // Arrive: ramp the desired speed down inside the slow zone; walk only where we face.
    const arrive = Math.min(1, d / (arriveRadius * ARRIVE_SLOW_FACTOR));
    desiredSpeed = maxSpeed * arrive * Math.max(0, Math.cos(err));
  } else if (!goal && Number.isFinite(face)) {
    wantTurn = turnFor(wrapAngle(face - body.heading));
  }
  body.turn = clamp(approach(body.turn ?? 0, wantTurn, TURN_ACCEL * dt), -turnRate, turnRate);
  body.heading = wrapAngle(body.heading + body.turn * dt);
  body.speed = approach(body.speed, desiredSpeed, accel * dt);

  let vx = Math.cos(body.heading) * body.speed;
  let vz = Math.sin(body.heading) * body.speed;
  const speedBeforePush = body.speed;

  // Tangent push: wherever the body capsule is near a hideout, cancel the velocity heading into it
  // (at the capsule's nearest point) and slide round the side nearer the target.
  for (const h of HIDEOUTS) {
    if (h.id === allowEnter) continue;
    const { depth, n } = capsuleDepth(body.x + vx * dt, body.z + vz * dt, body.heading, h);
    if (depth <= -AVOID_MARGIN) continue;
    const vin = vx * n.x + vz * n.z;
    if (vin >= 0) continue;
    vx -= n.x * vin;
    vz -= n.z * vin;
    let tan = { x: -n.z, z: n.x };
    if (toTarget && tan.x * toTarget.x + tan.z * toTarget.z < 0) tan = { x: -tan.x, z: -tan.z };
    vx -= tan.x * vin; // vin < 0, so this adds |vin| along the tangent
    vz -= tan.z * vin;
  }

  // Sliding must never speed the body up: hard-cap at maxSpeed and at the pre-push speed.
  const cap = Math.min(maxSpeed, speedBeforePush);
  const sp = Math.hypot(vx, vz);
  if (sp > cap) {
    vx *= cap / sp;
    vz *= cap / sp;
  }

  const p = clampWalkable({ x: body.x + vx * dt, z: body.z + vz * dt }, allowEnter);
  body.vx = vx;
  body.vz = vz;
  body.speed = Math.hypot(vx, vz);
  // Follow the actual motion (differs from heading only while sliding round a hideout), gently
  // (at the pivot rate: it may crab a little); both turns together stay within the turn rate.
  let heading = body.heading;
  if (body.speed > 0.05) {
    const slide = pivotMin * fullTurn * dt;
    const err = clamp(wrapAngle(Math.atan2(vz, vx) - heading), -slide, slide);
    const turned = wrapAngle(heading - heading0);
    heading = wrapAngle(heading0 + clamp(turned + err, -turnRate * dt, turnRate * dt));
  }
  placeClear(body, pose0, p, wrapAngle(heading - heading0), maxSpeed * dt - Math.hypot(p.x - pose0.x, p.z - pose0.z), allowEnter, dt);
  return body;
}

// Extra depth the capsule at (x, z, heading) reaches into each hideout, beyond what it had at the
// start of the tick, as the push that takes it back out (a body that starts overlapping, e.g.
// leaving its hideout, is never shoved, only kept from going deeper).
function clearPush(pose0, x, z, heading, allowEnter) {
  let px = 0;
  let pz = 0;
  for (const h of HIDEOUTS) {
    if (h.id === allowEnter) continue;
    const before = Math.max(0, capsuleDepth(pose0.x, pose0.z, pose0.heading, h).depth);
    const { depth, n } = capsuleDepth(x, z, heading, h);
    if (depth <= before) continue;
    px += n.x * (depth - before);
    pz += n.z * (depth - before);
  }
  return { x: px, z: pz };
}

// Sets the final pose: position p and the turn, with the capsule kept out of ceramic. A turn that
// swings the abdomen into a hideout steps the body out of the way, but the step plus the walk may
// not exceed maxSpeed for the tick (`budget`), so the turn is cut back if needed. Ceramic wins over
// the walkable bounds (a soft margin inside the deck): beside the moss the push may cross them by
// a few mm.
function placeClear(body, pose0, p, turn, budget, allowEnter, dt) {
  const at = (f) => {
    const heading = wrapAngle(pose0.heading + f * turn);
    return { heading, push: clearPush(pose0, p.x, p.z, heading, allowEnter) };
  };
  let f = 1;
  let best = at(1);
  if (Math.hypot(best.push.x, best.push.z) > Math.max(0, budget) + 1e-12) {
    let lo = 0;
    let hi = 1;
    best = at(0);
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const m = at(mid);
      if (Math.hypot(m.push.x, m.push.z) <= Math.max(0, budget)) {
        lo = mid;
        best = m;
      } else hi = mid;
    }
    f = lo;
    if (dt > 0) body.turn = (f * turn) / dt; // the blocked part of the turn leaves no momentum
  }
  body.heading = best.heading;
  body.x = p.x + best.push.x;
  body.z = p.z + best.push.z;
}
