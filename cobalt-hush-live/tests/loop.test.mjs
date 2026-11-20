import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, tickSim, applyTrustEvents, resetSim, SWIPE_COOLDOWN } from '../src/app/loop.js';
import { SPIDER_SCALE } from '../src/sim/gait.js';
import { defaultState } from '../src/core/state.js';
import { dropFood } from '../src/sim/food.js';
import { CAST_OFFSET, MOULT_INTERVAL } from '../src/sim/moult.js';

const DT = 0.05;
const input = (over = {}) => ({ events: [], threads: [], pointer: null, mode: 'lure', lightsJustChanged: false, active: true, epochMs: 1000, ...over });

function run(sim, state, seconds, over = {}, each = () => {}) {
  let s = state;
  let out = null;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    out = tickSim(sim, s, input(over), DT);
    s = out.state;
    if (each(out) === false) break;
  }
  return { state: s, out };
}

test('huge dt advances the sim clock by one clamped tick only', () => {
  const sim = createSim({ seed: 1 });
  const before = { x: sim.body.x, z: sim.body.z };
  tickSim(sim, defaultState(0), input(), 3600);
  assert.equal(sim.now, 0.05);
  assert.ok(Math.hypot(sim.body.x - before.x, sim.body.z - before.z) < 0.1);
});

test('swipe trust events respect a 1.5 s cooldown; other events always apply', () => {
  const sim = createSim({ seed: 1 });
  let s = { ...defaultState(0), trust: 50, peakTrust: 50 };
  sim.now = 10;
  s = applyTrustEvents(sim, s, [{ type: 'swipe' }]);
  assert.equal(s.trust, 47);
  sim.now = 10 + SWIPE_COOLDOWN - 0.1;
  s = applyTrustEvents(sim, s, [{ type: 'swipe' }, { type: 'feed' }]);
  assert.equal(s.trust, 53);
  sim.now = 10 + SWIPE_COOLDOWN + 0.01;
  s = applyTrustEvents(sim, s, [{ type: 'swipe' }]);
  assert.equal(s.trust, 50);
});

test('pokes pass recentPokes straight through to trust', () => {
  const sim = createSim({ seed: 1 });
  let s = { ...defaultState(0), trust: 60, peakTrust: 60 };
  for (let i = 0; i < 3; i++) s = tickSim(sim, s, input({ events: [{ type: 'poke' }] }), DT).state;
  assert.equal(s.trust, 60 - 2 - 2 - 7);
});

test('eating removes the food and adds one satiety', () => {
  const sim = createSim({ seed: 1 });
  resetSim(sim, { x: 0, z: 0, heading: 0 });
  dropFood(sim.food, { x: 1.5, z: 0 }, 0);
  let ate = 0;
  const { state } = run(sim, defaultState(0), 12, {}, (out) => {
    if (out.ate) ate++;
    return sim.food.items.length > 0;
  });
  assert.equal(ate, 1);
  assert.equal(sim.food.items.length, 0);
  assert.ok(state.satiety > 1.9 && state.satiety <= 2, `satiety ${state.satiety}`);
});

test('the brain stalks the food home point, not its flutter', () => {
  const sim = createSim({ seed: 1 });
  resetSim(sim, { x: 0, z: 0, heading: 0 });
  const item = dropFood(sim.food, { x: 2, z: 0 }, 0);
  const { out } = run(sim, defaultState(0), 0.5);
  assert.equal(out.intent.state, 'stalk');
  assert.deepEqual(out.intent.target, { x: item.home.x, z: item.home.z });
});

test('satiety digests while playing at 1 per 90 s', () => {
  const sim = createSim({ seed: 1 });
  const { state } = run(sim, { ...defaultState(0), satiety: 2 }, 9);
  assert.ok(Math.abs(state.satiety - 1.9) < 1e-6, `satiety ${state.satiety}`);
});

test('moult clock only runs while active', () => {
  const sim = createSim({ seed: 1 });
  const a = run(sim, defaultState(0), 1, { active: true }).state;
  assert.ok(Math.abs(a.sinceMoult - 1) < 1e-6);
  const b = run(sim, a, 1, { active: false }).state;
  assert.equal(b.sinceMoult, a.sinceMoult);
});

test('a due moult plays through, then leaves the cast behind the body in the old shade', () => {
  const sim = createSim({ seed: 1 });
  resetSim(sim, { x: 1, z: 0.5, heading: 0.3 });
  let s = { ...defaultState(0), sinceMoult: MOULT_INTERVAL };
  const phases = new Set();
  let moulted = 0;
  let at = null;
  for (let i = 0; i < 20 / DT; i++) {
    const out = tickSim(sim, s, input({ epochMs: 5000 }), DT);
    s = out.state;
    if (out.moult) phases.add(out.moult.phase);
    if (out.moulted) {
      moulted++;
      at = { x: sim.body.x, z: sim.body.z, h: sim.body.heading };
    }
  }
  assert.deepEqual([...phases], ['still', 'roll', 'emerge', 'rollBack']);
  assert.equal(moulted, 1);
  assert.equal(s.moults.length, 1);
  assert.equal(s.shadeIndex, 1);
  assert.equal(s.moults[0].shadeIndex, 0);
  assert.equal(s.moults[0].at, 5000);
  assert.equal(CAST_OFFSET, 1.15 * SPIDER_SCALE);
  // The cast lies behind by the offset at the size the spider was when it moulted (a juvenile here).
  const size = defaultState(0).size;
  assert.equal(s.moults[0].size, size);
  assert.ok(Math.abs(s.moults[0].x - (at.x - Math.cos(at.h) * CAST_OFFSET * size)) < 1e-9);
  assert.ok(Math.abs(s.moults[0].z - (at.z - Math.sin(at.h) * CAST_OFFSET * size)) < 1e-9);
  assert.ok(s.size > size, 'it grew');
  assert.equal(s.moults[0].rot, at.h);
  assert.ok(s.sinceMoult < 7, 'clock restarted');
});

test('eat pulse rises from zero while eating and is zero otherwise', () => {
  const sim = createSim({ seed: 1 });
  resetSim(sim, { x: 0, z: 0, heading: 0 });
  dropFood(sim.food, { x: 1.2, z: 0 }, 0);
  let maxPulse = 0;
  run(sim, defaultState(0), 12, {}, (out) => {
    if (out.intent.state !== 'eat') assert.equal(out.eatPulse, 0);
    else maxPulse = Math.max(maxPulse, out.eatPulse);
  });
  assert.ok(maxPulse > 0.9, `max pulse ${maxPulse}`);
});

test('resetSim places the body, replants the gait and clears food', () => {
  const sim = createSim({ seed: 1 });
  dropFood(sim.food, { x: 2, z: 0 }, 0);
  run(sim, defaultState(0), 2);
  resetSim(sim, { x: -3, z: 1, heading: 1 });
  assert.equal(sim.body.x, -3);
  assert.equal(sim.body.z, 1);
  assert.equal(sim.body.speed, 0);
  assert.equal(sim.food.items.length, 0);
  assert.ok(Object.values(sim.gait.feet).every((f) => f.planted));
  assert.equal(sim.brain.state, 'wander');
});

test('pace scales walking speed; lively never pushes past the flee speed', async () => {
  const { paced } = await import('../src/app/loop.js');
  assert.equal(paced(1, 'normal'), 1);
  assert.ok(Math.abs(paced(1, 'calm') - 0.65) < 1e-9);
  assert.ok(Math.abs(paced(1, 'lively') - 1.45) < 1e-9);
  assert.equal(paced(4.5, 'lively'), 4.5); // a flee stays at flee speed
  assert.equal(paced(1, 'nonsense'), 1);
});
