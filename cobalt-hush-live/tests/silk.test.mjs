import test from 'node:test';
import assert from 'node:assert/strict';
import { createSilk, stepSilk, threadHit, ripple, matsSnapshot } from '../src/sim/silk.js';
import { HIDEOUTS } from '../src/sim/deck.js';

const bark = HIDEOUTS.find((h) => h.id === 'bark');
const body = (x, z) => ({ x, z, heading: 0, speed: 0, vx: 0, vz: 0 });

test('dragline expires', () => {
  const s = createSilk({}, { seed: 1 });
  const b = body(0, 0);
  for (let i = 0; i < 30; i++) {
    b.x += 0.1;
    stepSilk(s, b, 'wander', 0.05);
  }
  assert.ok(s.draglines.length > 0);
  for (let i = 0; i < 41; i++) stepSilk(s, b, 'wander', 1);
  assert.equal(s.draglines.length, 0);
});

test('dragline is capped at 600 points', () => {
  const s = createSilk({}, { seed: 1 });
  const b = body(0, 0);
  for (let i = 0; i < 1000; i++) {
    b.x = i % 2 ? 0.2 : 0;
    stepSilk(s, b, 'wander', 0.01);
  }
  assert.ok(s.draglines.length <= 600);
});

test('mat grows near entrance', () => {
  const s = createSilk({}, { seed: 1 });
  const b = body(bark.entrance.x, bark.entrance.z);
  for (let i = 0; i < 46; i++) stepSilk(s, b, 'idle', 1);
  const m = matsSnapshot(s);
  assert.ok(Math.abs(m.bark - 1) < 1e-9);
  assert.equal(s.tripwires.bark.length, 6);
  assert.equal(m.stone ?? 0, 0);
});

test('mat does not grow while hunting or far away', () => {
  const s = createSilk({}, { seed: 1 });
  stepSilk(s, body(bark.entrance.x, bark.entrance.z), 'stalk', 10);
  stepSilk(s, body(0, 0), 'idle', 10);
  assert.equal(matsSnapshot(s).bark ?? 0, 0);
});

test('threadHit finds tripwire', () => {
  const s = createSilk({}, { seed: 1 });
  const b = body(bark.entrance.x, bark.entrance.z);
  for (let i = 0; i < 46; i++) stepSilk(s, b, 'groom', 1);
  s.draglines.length = 0;
  const seg = s.tripwires.bark[0];
  const mid = { x: (seg.a.x + seg.b.x) / 2, z: (seg.a.z + seg.b.z) / 2 };
  const hit = threadHit(s, mid);
  assert.ok(hit);
  assert.ok(Math.hypot(hit.x - mid.x, hit.z - mid.z) < 0.25);
  assert.equal(threadHit(s, { x: 0, z: 0 }), null);
});

test('threadHit finds dragline segment; mats restore from snapshot', () => {
  const s = createSilk({ moss: 0.5 }, { seed: 1 });
  assert.equal(s.tripwires.moss.length, 3);
  const b = body(0, 0);
  for (let i = 0; i < 5; i++) {
    b.x += 0.2;
    stepSilk(s, b, 'wander', 0.05);
  }
  assert.ok(threadHit(s, { x: 0.5, z: 0.1 }));
});

test('ripples are recorded and expire after 1.2 s', () => {
  const s = createSilk({}, { seed: 1 });
  ripple(s, { x: 1, z: 1 });
  assert.equal(s.ripples.length, 1);
  stepSilk(s, body(0, 0), 'idle', 0.6);
  assert.equal(s.ripples.length, 1);
  assert.ok(s.ripples[0].age > 0.5);
  stepSilk(s, body(0, 0), 'idle', 0.7);
  assert.equal(s.ripples.length, 0);
});
