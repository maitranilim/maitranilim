import test from 'node:test';
import assert from 'node:assert/strict';
import { createBody, stepBody } from '../src/sim/locomotion.js';
import { HIDEOUTS, insideHideout } from '../src/sim/deck.js';

const OPTS = { maxSpeed: 1.2, accel: 6, turnRate: 5, arriveRadius: 0.25 };
const DT = 0.016;
const bark = HIDEOUTS.find((h) => h.id === 'bark');

test('body arrives at target', () => {
  const b = createBody(0, 0, 0);
  for (let i = 0; i < 600; i++) stepBody(b, { x: 3, z: 0 }, OPTS, DT);
  assert.ok(Math.hypot(b.x - 3, b.z) < 0.3);
  assert.ok(b.speed < 0.2);
});

test('stepBody returns the same body and null target stops it', () => {
  const b = createBody(0, 0, 0);
  for (let i = 0; i < 60; i++) stepBody(b, { x: 5, z: 0 }, OPTS, DT);
  assert.ok(b.speed > 0.5);
  assert.equal(stepBody(b, null, OPTS, DT), b);
  for (let i = 0; i < 100; i++) stepBody(b, null, OPTS, DT);
  assert.ok(b.speed < 1e-6);
  assert.ok(Math.abs(b.heading) <= Math.PI);
});

test('body never enters hideout without allowEnter', () => {
  const b = createBody(-2, -2.6, Math.PI);
  for (let i = 0; i < 800; i++) {
    stepBody(b, { x: -8, z: -2.6 }, OPTS, DT);
    assert.equal(insideHideout(b), null, `tick ${i}`);
  }
});

test('allowEnter lets it reach the centre', () => {
  const b = createBody(-2, -2.6, Math.PI);
  for (let i = 0; i < 800; i++) stepBody(b, { x: bark.x, z: bark.z }, { ...OPTS, allowEnter: 'bark' }, DT);
  assert.ok(Math.hypot(b.x - bark.x, b.z - bark.z) < 0.4);
});

test('off-deck target is reached at the wall', () => {
  const b = createBody(0, 0, 0);
  for (let i = 0; i < 800; i++) stepBody(b, { x: 20, z: 0 }, OPTS, DT);
  assert.ok(Math.abs(b.x - 7.4) < 0.3);
  assert.ok(b.speed < 0.2);
});

function runSlide(start, target, opts, dt, ticks) {
  const b = createBody(start.x, start.z, start.h ?? 0);
  for (let i = 0; i < ticks; i++) {
    const px = b.x;
    const pz = b.z;
    stepBody(b, target, opts, dt);
    const moved = Math.hypot(b.x - px, b.z - pz);
    assert.ok(moved <= opts.maxSpeed * dt + 1e-6, `tick ${i}: moved ${moved}`);
    assert.ok(b.speed <= opts.maxSpeed + 1e-6, `tick ${i}: speed ${b.speed}`);
    assert.ok(Math.abs(b.speed - Math.hypot(b.vx, b.vz)) < 1e-9);
  }
}

test('sliding along a hideout never exceeds maxSpeed', () => {
  runSlide({ x: -3.6, z: -2.6 }, { x: -7, z: -2.4 }, { ...OPTS, maxSpeed: 0.9 }, 0.05, 600);
});

test('sliding past each hideout at dt 0.016 never exceeds maxSpeed', () => {
  for (const h of HIDEOUTS) {
    // start on the deck-centre side, target straight through to the far side
    const dx = h.x === 0 ? 0 : Math.sign(h.x);
    const dz = Math.sign(h.z);
    const start = { x: h.x - dx * (h.r + 1.2), z: h.z - dz * 0.1, h: 0 };
    const target = { x: h.x + dx * (h.r + 1.2), z: h.z + dz * 0.1 };
    runSlide(start, target, { ...OPTS, maxSpeed: 0.9 }, 0.016, 1200);
    runSlide(start, target, { ...OPTS, maxSpeed: 4.5 }, 0.016, 1200);
  }
});

test('turning on the spot is gentle: capped at 0.35 x turnRate and eased in', () => {
  const b = createBody(0, 0, 0);
  let prev = b.heading;
  let fastest = 0;
  const first = [];
  for (let i = 0; i < 200; i++) {
    stepBody(b, { x: -2, z: 0.01 }, { ...OPTS, maxSpeed: 0 }, DT);
    const rate = Math.abs(b.heading - prev) / DT;
    if (i < 3) first.push(rate);
    fastest = Math.max(fastest, rate);
    prev = b.heading;
  }
  assert.ok(fastest <= 0.35 * OPTS.turnRate + 1e-9, `fastest ${fastest}`);
  assert.ok(first[0] < first[1] && first[1] < first[2], `eases in: ${first}`);
  assert.ok(Math.abs(Math.abs(b.heading) - Math.PI) < 0.02, `faces the target: ${b.heading}`);
});

test('turns never exceed turnRate per tick, even while sliding round a hideout', () => {
  const moss = HIDEOUTS.find((h) => h.id === 'moss');
  // From the far side of the moss, fleeing to its entrance: the seek turn and the slide turn add up.
  const b = createBody(moss.x, moss.z + moss.r + 0.6, 0);
  let prev = b.heading;
  for (let i = 0; i < 200; i++) {
    stepBody(b, moss.entrance, { ...OPTS, maxSpeed: 2.4 }, 0.05);
    const turn = Math.abs(((b.heading - prev + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    assert.ok(turn <= OPTS.turnRate * 0.05 + 1e-9, `tick ${i}: turned ${turn}`);
    prev = b.heading;
  }
});
