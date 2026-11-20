import test from 'node:test';
import assert from 'node:assert/strict';
import { createFood, dropFood, stepFood, removeFood } from '../src/sim/food.js';
import { HIDEOUTS } from '../src/sim/deck.js';

test('food max three', () => {
  const f = createFood({ seed: 1 });
  for (let i = 0; i < 4; i++) dropFood(f, { x: i, z: 0 }, i);
  assert.equal(f.items.length, 3);
  assert.deepEqual(f.items.map((it) => it.home.x), [1, 2, 3]);
});

test('food clamps out of hideout', () => {
  const stone = HIDEOUTS.find((h) => h.id === 'stone');
  const f = createFood({ seed: 1 });
  const it = dropFood(f, { x: stone.x, z: stone.z }, 0);
  assert.ok(Math.hypot(it.home.x - stone.x, it.home.z - stone.z) >= stone.r);
});

test('food flutters within 0.15 of its drop point and can be removed', () => {
  const f = createFood({ seed: 2 });
  const it = dropFood(f, { x: 0, z: 0 }, 0);
  let moved = false;
  for (let i = 0; i < 400; i++) {
    stepFood(f, 0.05);
    const d = Math.hypot(it.x - it.home.x, it.z - it.home.z);
    assert.ok(d <= 0.15 + 1e-9);
    if (d > 0.01) moved = true;
  }
  assert.ok(moved);
  removeFood(f, it.id);
  assert.equal(f.items.length, 0);
});
