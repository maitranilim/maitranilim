import test from 'node:test';
import assert from 'node:assert/strict';
import { routeGestures, keyEvents, createPointerTracker, attachInput, feedAhead, POKE_RADIUS } from '../src/app/inputBridge.js';
import { SPIDER_SCALE } from '../src/sim/gait.js';
import { createBody } from '../src/sim/locomotion.js';
import { createFood } from '../src/sim/food.js';
import { createSilk } from '../src/sim/silk.js';
import { HIDEOUTS } from '../src/sim/deck.js';

// Gestures carry screen coords; this fake maps them straight to world x/z.
const g = (type, x, z) => ({ type, clientX: x, clientY: z });
const toWorld = (e) => ({ x: e.clientX, z: e.clientY });

function env(over = {}) {
  return {
    toWorld,
    mode: 'lure',
    feedArmed: false,
    body: createBody(0, 0, 0),
    silk: createSilk({}, { seed: 1 }),
    food: createFood({ seed: 1 }),
    now: 3,
    ...over,
  };
}

test('armed tap drops one food at the walkable point, then later taps act normally', () => {
  const e = env({ feedArmed: true });
  const out = routeGestures([g('tap', 0.2, 0), g('tap', 0.3, 0)], e);
  assert.equal(out.fed, true);
  assert.equal(e.food.items.length, 1);
  assert.deepEqual(e.food.items[0].home, { x: 0.2, z: 0 });
  assert.equal(e.food.items[0].at, 3);
  assert.deepEqual(out.events, [{ type: 'poke' }]);
});

test('armed tap inside a hideout drops food outside the ceramic', () => {
  const h = HIDEOUTS[0];
  const e = env({ feedArmed: true });
  routeGestures([g('tap', h.x, h.z + 0.1)], e);
  const home = e.food.items[0].home;
  assert.ok(Math.hypot(home.x - h.x, home.z - h.z) >= h.r);
});

test('tap within the poke radius (0.6 u at design scale) of the body is a poke; farther away it is not', () => {
  assert.equal(POKE_RADIUS, 0.6 * SPIDER_SCALE);
  assert.deepEqual(routeGestures([g('tap', POKE_RADIUS - 0.05, 0)], env()).events, [{ type: 'poke' }]);
  assert.deepEqual(routeGestures([g('tap', POKE_RADIUS + 0.1, 0)], env()).events, []);
});

test('tap on a thread ripples it and reports the thread for this tick only', () => {
  const e = env();
  e.silk.draglines.push({ x: 2, z: 0, age: 0 }, { x: 3, z: 0, age: 0 });
  const out = routeGestures([g('tap', 2.5, 0.1)], e);
  assert.deepEqual(out.events, []);
  assert.deepEqual(out.threads, [{ x: 2.5, z: 0 }]);
  assert.equal(e.silk.ripples.length, 1);
  assert.deepEqual(routeGestures([g('tap', 5, 3)], e).threads, []);
});

test('tap off the ground does nothing', () => {
  const out = routeGestures([g('tap', 0, 0)], env({ toWorld: () => null, feedArmed: true }));
  assert.deepEqual(out, { events: [], threads: [], fed: false });
});

test('lure mode: hold lures at the walkable point until release; drag does nothing', () => {
  const out = routeGestures([g('holdStart', 9, 0), g('holdMove', -3, 0), g('holdEnd', -3, 0), g('dragStart', 1, 1), g('dragMove', 2, 1)], env());
  assert.deepEqual(out.events, [
    { type: 'lure', held: true, x: 7.4, z: 0 },
    { type: 'lure', held: true, x: -3, z: 0 },
    { type: 'lure', held: false },
  ]);
});

test('steer mode: drags and holds steer at the walkable point (R4)', () => {
  const out = routeGestures([g('dragStart', 1, 0), g('dragMove', 4, 9), g('dragEnd', 4, 9), g('holdStart', -2, 0), g('holdMove', -2.5, 0)], env({ mode: 'steer' }));
  assert.deepEqual(out.events, [
    { type: 'steer', x: 1, z: 0 },
    { type: 'steer', x: 4, z: 4.4 },
    { type: 'steer', x: -2, z: 0 },
    { type: 'steer', x: -2.5, z: 0 },
  ]);
});

test('steer mode: a point inside a hideout is kept raw, so the brain can steer it in; lures are still pushed out', () => {
  const h = HIDEOUTS[0];
  const inside = { x: h.x + 0.3, z: h.z - 0.2 };
  assert.deepEqual(routeGestures([g('dragMove', inside.x, inside.z)], env({ mode: 'steer' })).events, [{ type: 'steer', ...inside }]);
  // Just outside the ceramic (within the body's clearance) it is still pushed clear.
  const near = routeGestures([g('dragMove', h.x + h.r + 0.1, h.z)], env({ mode: 'steer' })).events[0];
  assert.ok(Math.hypot(near.x - h.x, near.z - h.z) > h.r + 0.3, JSON.stringify(near));
  const lure = routeGestures([g('holdStart', inside.x, inside.z)], env()).events[0];
  assert.ok(Math.hypot(lure.x - h.x, lure.z - h.z) > h.r, JSON.stringify(lure));
});

test('keyboard feeding drops food 1.5 u in front of the spider, clamped walkable', () => {
  const p = feedAhead(createBody(1, 0.5, Math.PI / 2));
  assert.ok(Math.abs(p.x - 1) < 1e-9 && Math.abs(p.z - 2) < 1e-9, JSON.stringify(p));
  assert.deepEqual(feedAhead(createBody(7, 0, 0)), { x: 7.4, z: 0 }); // facing the edge
  const h = HIDEOUTS[0];
  const q = feedAhead(createBody(h.x + h.r + 1, h.z, Math.PI)); // facing into the bark
  assert.ok(Math.hypot(q.x - h.x, q.z - h.z) >= h.r);
});

test('keys steer only in steer mode and only when pressed', () => {
  assert.deepEqual(keyEvents({ dx: 1, dz: 0 }, 'steer'), [{ type: 'steerKeys', dx: 1, dz: 0 }]);
  assert.deepEqual(keyEvents({ dx: 0, dz: 0 }, 'steer'), []);
  assert.deepEqual(keyEvents({ dx: 1, dz: 0 }, 'lure'), []);
});

test('keys map through the camera yaw, so W is screen-up and D screen-right in portrait too', () => {
  const near = (a, b) => Math.abs(a.dx - b.dx) < 1e-9 && Math.abs(a.dz - b.dz) < 1e-9;
  const map = (v, yaw) => keyEvents(v, 'steer', yaw)[0];
  // Landscape (yaw 0): the screen's up is world -z and its right is +x.
  assert.ok(near(map({ dx: 1, dz: 0 }, 0), { dx: 1, dz: 0 }));
  assert.ok(near(map({ dx: 0, dz: -1 }, 0), { dx: 0, dz: -1 }));
  // Portrait (yaw 90 deg): the screen's up is world -x and its right is -z.
  assert.ok(near(map({ dx: 1, dz: 0 }, Math.PI / 2), { dx: 0, dz: -1 }), JSON.stringify(map({ dx: 1, dz: 0 }, Math.PI / 2)));
  assert.ok(near(map({ dx: 0, dz: -1 }, Math.PI / 2), { dx: -1, dz: 0 }));
  assert.ok(near(map({ dx: Math.SQRT1_2, dz: Math.SQRT1_2 }, Math.PI / 2), { dx: Math.SQRT1_2, dz: -Math.SQRT1_2 }));
});

test('pointer tracker reports world speed in u/s and resets on null', () => {
  const tr = createPointerTracker();
  assert.equal(tr.update(null, 0, false), null);
  assert.deepEqual(tr.update({ x: 0, z: 0 }, 1000, false), { x: 0, z: 0, speed: 0, down: false });
  const p = tr.update({ x: 0.3, z: 0.4 }, 1100, true);
  assert.ok(Math.abs(p.speed - 5) < 1e-9, `speed ${p.speed}`);
  assert.equal(p.down, true);
  // Still pointer: speed falls to zero once the window holds only still samples.
  tr.update({ x: 0.3, z: 0.4 }, 1200, true);
  assert.equal(tr.update({ x: 0.3, z: 0.4 }, 1400, true).speed, 0);
  // Re-entering after null starts fresh (no speed spike from the jump).
  tr.update(null, 1500, false);
  assert.equal(tr.update({ x: 5, z: 3 }, 1520, false).speed, 0);
});

test('right and middle mouse buttons are ignored; touch and the main button press', () => {
  const hadWindow = 'window' in globalThis;
  globalThis.window ??= new EventTarget();
  try {
    const canvas = Object.assign(new EventTarget(), { style: {}, setPointerCapture() {} });
    const downs = [];
    const ups = [];
    const gestures = { down: (e) => downs.push(e.pointerType), move() {}, up: (e) => ups.push(e.pointerType), cancel() {}, leave() {}, keyDown() {}, keyUp() {}, blur() {} };
    const input = attachInput(canvas, gestures);
    const press = (pointerType, button, pointerId = 1) => {
      canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType, button, pointerId, clientX: 5, clientY: 5 }));
    };
    const release = (pointerType, button, pointerId = 1) => {
      canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerType, button, pointerId, clientX: 5, clientY: 5 }));
    };
    press('mouse', 2);
    release('mouse', 2);
    press('mouse', 1);
    release('mouse', 1);
    assert.deepEqual(downs, []);
    assert.deepEqual(ups, []);
    assert.equal(input.down, false);
    press('mouse', 0);
    press('touch', 0, 2);
    release('mouse', 0);
    assert.deepEqual(downs, ['mouse', 'touch']);
    assert.deepEqual(ups, ['mouse']);
  } finally {
    if (!hadWindow) delete globalThis.window;
  }
});
