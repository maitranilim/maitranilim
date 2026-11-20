import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, tickBrain, DOZE_AFTER, STRETCH_TIME, CLEAN_TIME } from '../src/sim/brain.js';
import { createBody, stepBody } from '../src/sim/locomotion.js';

const DT = 0.05;
const STEP = { accel: 6, turnRate: 5, arriveRadius: 0.25 };
const ctxOf = (over = {}) => ({
  body: createBody(0, 0, 0), trust: 50, satiety: 1, mode: 'lure', pointer: null, events: [],
  food: [], threads: [], lightsJustChanged: false, moultDue: false, now: 0, ...over,
});
function run(brain, ctx, seconds, each = () => {}) {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    const intent = tickBrain(brain, ctx, DT);
    stepBody(ctx.body, intent.target, { ...STEP, maxSpeed: intent.maxSpeed, allowEnter: intent.allowEnter, face: intent.face }, DT);
    ctx.events = [];
    ctx.lightsJustChanged = false;
    ctx.now += DT;
    if (each(ctx, intent) === false) break;
  }
}

test('left alone, it dozes after a calm spell, settling into the doze pose', () => {
  const brain = createBrain({ seed: 3 });
  const ctx = ctxOf();
  let dozeAt = null;
  let last = null;
  run(brain, ctx, DOZE_AFTER + 12, (c, intent) => {
    if (intent.state === 'doze' && dozeAt === null) dozeAt = c.now;
    last = intent;
  });
  assert.ok(dozeAt !== null && dozeAt >= DOZE_AFTER, `dozed at ${dozeAt}`);
  assert.equal(last.state, 'doze');
  assert.equal(last.anim.kind, 'doze');
  assert.equal(last.anim.p, 1);
  assert.equal(last.maxSpeed, 0);
});

test('a nearby cursor never lets it doze', () => {
  const brain = createBrain({ seed: 3 });
  const ctx = ctxOf({ pointer: { x: 2, z: 0, speed: 0.1, down: false } });
  run(brain, ctx, DOZE_AFTER + 12, (c, intent) => assert.notEqual(intent.state, 'doze'));
});

test('stirred from a doze, it stretches before reacting', () => {
  const brain = createBrain({ seed: 3 });
  const ctx = ctxOf();
  run(brain, ctx, DOZE_AFTER + 12);
  assert.equal(brain.state, 'doze');
  ctx.pointer = { x: ctx.body.x + 1.5, z: ctx.body.z, speed: 0.2, down: false };
  const seen = [];
  run(brain, ctx, STRETCH_TIME + 1, (c, intent) => {
    if (seen[seen.length - 1] !== intent.state) seen.push(intent.state);
    if (intent.state === 'stretch') assert.equal(intent.anim.kind, 'stretch');
  });
  assert.equal(seen[0], 'stretch');
  assert.ok(['alert', 'approach'].includes(seen[seen.length - 1]), seen.join(' > '));
});

test('a poke wakes a dozing spider straight away (no stretch first)', () => {
  const brain = createBrain({ seed: 3 });
  const ctx = ctxOf({ trust: 80 });
  run(brain, ctx, DOZE_AFTER + 12);
  ctx.events = [{ type: 'poke' }];
  const intent = tickBrain(brain, ctx, DT);
  assert.equal(intent.twitch, true);
  assert.notEqual(intent.state, 'stretch');
});

test('after a meal it cleans its fangs, then carries on', () => {
  const brain = createBrain({ seed: 5 });
  const ctx = ctxOf({ food: [{ id: 'f1', x: 2, z: 0 }] });
  const seen = [];
  run(brain, ctx, 14, (c, intent) => {
    if (seen[seen.length - 1] !== intent.state) seen.push(intent.state);
    if (intent.eatFoodId) { c.food = []; c.satiety += 1; }
    if (intent.state === 'clean') assert.equal(intent.anim.kind, 'clean');
  });
  const i = seen.indexOf('eat');
  assert.ok(i >= 0, seen.join(' > '));
  assert.equal(seen[i + 1], 'clean');
  assert.ok(seen.length > i + 2, 'never finished cleaning');
});

test('up close to a still cursor it taps it', () => {
  const brain = createBrain({ seed: 2 });
  const ctx = ctxOf({ trust: 75, pointer: { x: 2, z: 0, speed: 0, down: false } });
  let tapped = false;
  run(brain, ctx, 10, (c, intent) => {
    // Keep the pointer from going perfectly still long enough to ride (riding needs 85+ anyway).
    if (intent.anim?.kind === 'tap') tapped = true;
  });
  assert.ok(tapped);
});

test('cleaning is a short, bounded pause', () => {
  assert.ok(CLEAN_TIME > 1 && CLEAN_TIME < 4);
  assert.ok(STRETCH_TIME > 1 && STRETCH_TIME < 3);
});
