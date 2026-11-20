import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNDS, HIDEOUTS, clampWalkable, nearestHideout, insideHideout } from '../src/sim/deck.js';

const bark = HIDEOUTS.find((h) => h.id === 'bark');

test('clampWalkable pushes out of hideouts and bounds', () => {
  const p = clampWalkable({ x: -5.2, z: -2.6 });
  assert.ok(Math.hypot(p.x - bark.x, p.z - bark.z) >= 1.1);
  assert.equal(clampWalkable({ x: 20, z: 0 }).x, 7.4);
  assert.equal(clampWalkable({ x: 0, z: -20 }).z, BOUNDS.minZ);
  for (const h of HIDEOUTS) {
    const q = clampWalkable({ x: h.x + 0.1, z: h.z - 0.1 });
    assert.ok(Math.hypot(q.x - h.x, q.z - h.z) >= h.r);
    assert.equal(insideHideout(q), null);
  }
});

test('walkable points are left unchanged', () => {
  assert.deepEqual(clampWalkable({ x: 0, z: 0 }), { x: 0, z: 0 });
});

test('entrance is outside footprint', () => {
  assert.equal(HIDEOUTS.length, 5);
  for (const h of HIDEOUTS) {
    assert.ok(Math.hypot(h.entrance.x - h.x, h.entrance.z - h.z) > h.r, h.id);
  }
});

test('nearestHideout and insideHideout', () => {
  assert.equal(nearestHideout({ x: -5, z: -2 }).id, 'bark');
  assert.equal(insideHideout({ x: -5.2, z: -2.6 }).id, 'bark');
  assert.equal(insideHideout({ x: 0, z: 0 }), null);
});
