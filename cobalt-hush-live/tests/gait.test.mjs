import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGS, GROUPS, HIP_HEIGHT, SPIDER_SCALE, createGait, stepGait, solveTwoBone, localToWorld } from '../src/sim/gait.js';
import { createBody, stepBody } from '../src/sim/locomotion.js';

const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const OPTS = { maxSpeed: 1.2, accel: 6, turnRate: 5, arriveRadius: 0.25 };

function lcg(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

test('leg table matches spec', () => {
  assert.equal(LEGS.length, 8);
  assert.deepEqual(GROUPS.flat().sort(), LEGS.map((l) => l.id).sort());
  for (const l of LEGS) {
    // Spec values are design units; the spider is built at SPIDER_SCALE.
    const femur = l.femur / SPIDER_SCALE;
    const tibia = l.tibia / SPIDER_SCALE;
    assert.ok(Math.abs(Math.abs(l.hip.x) - 0.22 * SPIDER_SCALE) < 1e-12);
    assert.equal(l.hip.x > 0, l.side === 1);
    assert.ok(femur >= 0.55 && femur <= 0.75 && tibia >= 0.6 && tibia <= 0.85);
  }
});

test('solveTwoBone keeps bone lengths', () => {
  const r = lcg(7);
  for (let i = 0; i < 50; i++) {
    const root = { x: r() - 0.5, y: 0.28, z: r() - 0.5 };
    const a = 0.6 + r() * 0.1, b = 0.7 + r() * 0.1;
    const dir = { x: r() - 0.5, y: -r() * 0.3, z: r() - 0.5 };
    const l = Math.hypot(dir.x, dir.y, dir.z);
    const reach = (0.3 + r() * 0.65) * (a + b);
    const target = { x: root.x + (dir.x / l) * reach, y: root.y + (dir.y / l) * reach, z: root.z + (dir.z / l) * reach };
    const { knee, foot } = solveTwoBone(root, target, a, b, { x: 0, y: 1, z: 0 });
    assert.ok(Math.abs(d3(knee, root) - a) < 1e-6);
    assert.ok(Math.abs(d3(foot, knee) - b) < 1e-6);
    assert.ok(d3(foot, target) < 1e-6);
  }
});

test('unreachable target clamps', () => {
  const root = { x: 0, y: 0.28, z: 0 };
  const { foot } = solveTwoBone(root, { x: a(), y: 0.28, z: 0 }, 0.6, 0.7, { x: 0, y: 1, z: 0 });
  assert.ok(Math.abs(d3(foot, root) - 1.3) < 1e-6);
  function a() { return 1.3 + 1; }
});

test('knee bends toward pole', () => {
  const root = { x: 0, y: 0.28, z: 0 };
  const target = { x: 0.9, y: 0, z: 0.2 };
  const { knee } = solveTwoBone(root, target, 0.6, 0.7, { x: 0, y: 1, z: 0 });
  assert.ok(knee.y > Math.max(root.y, target.y));
});

test('localToWorld uses forward/right convention', () => {
  const b = createBody(1, 2, Math.PI / 2); // faces +z
  const f = localToWorld(b, { x: 0, z: 1 });
  assert.ok(Math.abs(f.x - 1) < 1e-9 && Math.abs(f.z - 3) < 1e-9);
  const rt = localToWorld(b, { x: 1, z: 0 });
  assert.ok(Math.abs(rt.x - 0) < 1e-9 && Math.abs(rt.z - 2) < 1e-9);
});

test('never more than four feet in air', () => {
  const body = createBody(-6, 0, 0);
  const gait = createGait(body);
  let sawAir = false;
  for (let i = 0; i < 5 / 0.016; i++) {
    stepBody(body, { x: 7, z: 0 }, OPTS, 0.016);
    stepGait(gait, body, 0.016, {});
    const air = LEGS.filter((l) => !gait.feet[l.id].planted).map((l) => l.id);
    assert.ok(air.length <= 4);
    if (air.length) {
      sawAir = true;
      assert.ok(GROUPS.some((g) => air.every((id) => g.includes(id))), `mixed groups ${air}`);
    }
  }
  assert.ok(sawAir);
});

test('standing still plants all feet', () => {
  const body = createBody(0, 0, 0);
  const gait = createGait(body);
  for (let i = 0; i < 63; i++) stepGait(gait, body, 0.016, {});
  for (const l of LEGS) {
    assert.equal(gait.feet[l.id].planted, true);
    assert.equal(gait.feet[l.id].y, 0);
  }
  assert.equal(HIP_HEIGHT, 0.28 * SPIDER_SCALE);
});

// The one exception to "one group in the air at a time": a foot more than 2x the threshold off its
// rest point may step out of turn, but only while fewer than 4 feet are up.
test('emergency step lets a far-off foot step out of turn, never past 4 in the air', () => {
  const setup = (airborne) => {
    const body = createBody(0, 0, 0);
    const gait = createGait(body);
    for (const id of airborne) Object.assign(gait.feet[id], { planted: false, t: 0.5, y: 0.1 });
    gait.feet.R1.x += 0.8; // a group-1 foot left far behind, while group 0 is mid-step
    return { body, gait };
  };
  const a = setup(['L1', 'R2']);
  stepGait(a.gait, a.body, 0.001, {});
  assert.equal(a.gait.feet.R1.planted, false, 'R1 steps out of turn');
  assert.deepEqual(LEGS.filter((l) => !a.gait.feet[l.id].planted).map((l) => l.id).sort(), ['L1', 'R1', 'R2']);

  const b = setup(GROUPS[0]);
  stepGait(b.gait, b.body, 0.001, {});
  assert.equal(b.gait.feet.R1.planted, true, 'R1 waits: four feet are already up');
  assert.equal(LEGS.filter((l) => !b.gait.feet[l.id].planted).length, 4);
});

test('a pivot on the spot keeps planted feet still and close to rest', () => {
  const body = createBody(0, 0, 0);
  const gait = createGait(body);
  let worst = 0;
  for (let i = 0; i < 3 / 0.016; i++) {
    const before = Object.fromEntries(LEGS.map((l) => [l.id, { ...gait.feet[l.id] }]));
    stepBody(body, { x: -0.6, z: 0.05 }, { ...OPTS, maxSpeed: 0 }, 0.016); // turn to face behind
    stepGait(gait, body, 0.016, {});
    for (const l of LEGS) {
      const f = gait.feet[l.id];
      if (!f.planted) continue;
      if (before[l.id].planted) assert.ok(f.x === before[l.id].x && f.z === before[l.id].z, `${l.id} slid`);
      const r = localToWorld(body, l.rest);
      worst = Math.max(worst, Math.hypot(f.x - r.x, f.z - r.z));
    }
  }
  assert.ok(Math.abs(Math.abs(body.heading) - Math.PI) < 0.1, `heading ${body.heading}`);
  assert.ok(worst < 0.45, `worst planted drift ${worst}`);
});
