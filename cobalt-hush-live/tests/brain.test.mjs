import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, tickBrain } from '../src/sim/brain.js';
import { createBody, stepBody } from '../src/sim/locomotion.js';
import { HIDEOUTS, nearestHideout } from '../src/sim/deck.js';
import { moultFits } from '../src/sim/moult.js';
import { reactionParams } from '../src/sim/trust.js';

const DT = 0.05;
const STEP = { accel: 6, turnRate: 5, arriveRadius: 0.25 };

function makeCtx(over = {}) {
  return {
    body: createBody(0, 0, 0),
    trust: 50,
    satiety: 1,
    mode: 'lure',
    pointer: null,
    events: [],
    food: [],
    threads: [],
    lightsJustChanged: false,
    moultDue: false,
    now: 0,
    ...over,
  };
}

// Ticks the brain for `seconds`, stepping the body along each intent. `each(ctx, intent)` runs after every tick.
function run(brain, ctx, seconds, each = () => {}) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const intent = tickBrain(brain, ctx, DT);
    stepBody(ctx.body, intent.target, { ...STEP, maxSpeed: intent.maxSpeed, allowEnter: intent.allowEnter, face: intent.face }, DT);
    ctx.events = [];
    ctx.lightsJustChanged = false;
    ctx.now += DT;
    if (each(ctx, intent) === false) break;
  }
}

test('fast pointer startles shy spider', () => {
  const brain = createBrain({ seed: 1 });
  const ctx = makeCtx({ trust: 10, pointer: { x: 1.5, z: 0, speed: 9, down: false } });
  const intent = tickBrain(brain, ctx, DT);
  assert.equal(intent.state, 'flee');
  assert.equal(brain.state, 'flee');
  assert.ok(intent.trustEvents.some((e) => e.type === 'swipe'));
});

test('fast pointer ignored in steer mode', () => {
  const brain = createBrain({ seed: 1 });
  const ctx = makeCtx({ trust: 10, mode: 'steer', pointer: { x: 1.5, z: 0, speed: 9, down: false } });
  const intent = tickBrain(brain, ctx, DT);
  assert.notEqual(intent.state, 'flee');
  assert.ok(!intent.trustEvents.some((e) => e.type === 'swipe'));
});

test('poke always twitches', () => {
  for (const mode of ['lure', 'steer']) {
    for (const trust of [10, 60]) {
      const brain = createBrain({ seed: 2 });
      const ctx = makeCtx({ mode, trust, events: [{ type: 'poke' }] });
      const intent = tickBrain(brain, ctx, DT);
      assert.equal(intent.twitch, true, `${mode} ${trust}`);
      assert.deepEqual(intent.trustEvents.filter((e) => e.type === 'poke'), [{ type: 'poke', recentPokes: 1 }]);
      if (trust < 30) assert.equal(intent.state, 'flee');
      else assert.notEqual(intent.state, 'flee');
      ctx.events = [];
      assert.equal(tickBrain(brain, ctx, DT).twitch, false);
    }
  }
});

test('poke reports pokes in the last 4 s', () => {
  const brain = createBrain({ seed: 2 });
  const ctx = makeCtx({ trust: 60 });
  const counts = [];
  for (const now of [0, 1, 2, 7]) {
    ctx.now = now;
    ctx.events = [{ type: 'poke' }];
    counts.push(tickBrain(brain, ctx, DT).trustEvents.find((e) => e.type === 'poke').recentPokes);
  }
  assert.deepEqual(counts, [1, 2, 3, 1]);
});

test('three pokes in 2 s make even a bonded spider flee and hide', () => {
  const brain = createBrain({ seed: 2 });
  const ctx = makeCtx({ trust: 80 });
  const seen = [];
  run(brain, ctx, 12, (c, intent) => {
    if (seen.at(-1) !== intent.state) seen.push(intent.state);
    // Pokes land at 0.05, 1.0 and 1.95 s.
    if ([0, 19, 38].includes(Math.round(c.now / DT) - 1)) c.events = [{ type: 'poke' }];
    return intent.state !== 'hide';
  });
  const fled = seen.indexOf('flee');
  assert.ok(fled >= 0, seen.join(','));
  assert.equal(seen.at(-1), 'hide', seen.join(','));
  assert.ok(!seen.slice(fled).some((st) => st !== 'flee' && st !== 'hide'), seen.join(','));
});

test('a settled or bonded spider skitters a short way from a fast pointer, never to a hideout', () => {
  for (const trust of [30, 80]) {
    const brain = createBrain({ seed: 1 });
    const ctx = makeCtx({ trust, pointer: { x: 1.5, z: 0, speed: 12, down: false } });
    const first = tickBrain(brain, ctx, DT);
    assert.equal(first.state, 'flee');
    assert.ok(first.trustEvents.some((e) => e.type === 'swipe'));
    const { fleeDist } = reactionParams(trust);
    const d = Math.hypot(first.target.x - ctx.body.x, first.target.z - ctx.body.z);
    assert.ok(d <= fleeDist + 0.3, `trust ${trust}: skitter ${d.toFixed(2)} > ${fleeDist}`);
    assert.ok(first.target.x < ctx.body.x, 'skitters away from the pointer');
    ctx.pointer = null;
    const seen = new Set();
    run(brain, ctx, 10, (c, intent) => seen.add(intent.state));
    assert.ok(!seen.has('hide') && !seen.has('peek'), `trust ${trust}: ${[...seen].join(',')}`);
    assert.ok(['wander', 'idle', 'groom'].includes(brain.state), brain.state);
  }
});

test('steer follows target', () => {
  const brain = createBrain({ seed: 3 });
  const ctx = makeCtx({ mode: 'steer', events: [{ type: 'steer', x: 3, z: 0 }] });
  const intent = tickBrain(brain, ctx, DT);
  assert.equal(intent.state, 'steered');
  assert.deepEqual(intent.target, { x: 3, z: 0 });
  assert.ok(Math.abs(intent.maxSpeed - 1.0) < 1e-9);

  ctx.events = [{ type: 'steerKeys', dx: 0, dz: -1 }];
  const keyed = tickBrain(brain, ctx, DT);
  assert.equal(keyed.state, 'steered');
  assert.deepEqual(keyed.target, { x: 0, z: -1.5 });
});

test('steering into a hiding spot walks the spider in', () => {
  const bark = HIDEOUTS.find((h) => h.id === 'bark');
  const brain = createBrain({ seed: 3 });
  const ctx = makeCtx({ mode: 'steer', body: createBody(-2, -1, Math.PI), events: [{ type: 'steer', x: bark.x, z: bark.z }] });
  const first = tickBrain(brain, ctx, DT);
  assert.equal(first.state, 'steered');
  assert.equal(first.allowEnter, 'bark');
  assert.deepEqual(first.target, { x: bark.x, z: bark.z });
  let closest = Infinity;
  run(brain, ctx, 10, (c, intent) => {
    if (intent.state === 'steered') assert.equal(intent.allowEnter, 'bark');
    closest = Math.min(closest, Math.hypot(c.body.x - bark.x, c.body.z - bark.z));
  });
  assert.ok(closest < 0.5, `closest ${closest.toFixed(2)}`);
});

test('shy steering pauses 0.4 s every 1.6 s', () => {
  const brain = createBrain({ seed: 3 });
  const ctx = makeCtx({ mode: 'steer', trust: 10 });
  const speeds = [];
  for (let i = 0; i < 40; i++) {
    ctx.events = [{ type: 'steer', x: 6, z: 0 }];
    ctx.body = createBody(0, 0, 0); // keep it far from the target
    speeds.push(tickBrain(brain, ctx, DT).maxSpeed);
  }
  const paused = speeds.filter((s) => s === 0).length;
  assert.equal(paused, 8); // 0.4 s of every 2 s at 0.05 s ticks
  assert.ok(speeds.slice(0, 31).every((s) => s > 0));
});

test('shy lure routes via cover', () => {
  const lure = { type: 'lure', x: 0, z: 4, held: true };
  const shy = createBrain({ seed: 4 });
  const ctx = makeCtx({ trust: 10, events: [lure] });
  const expected = nearestHideout(ctx.body).entrance;
  let first = null;
  let firstAt = null;
  run(shy, ctx, 3, (c, intent) => {
    assert.equal(intent.state, 'seekLure');
    if (intent.target) {
      first = intent.target;
      firstAt = c.now;
      return false;
    }
  });
  assert.deepEqual(first, expected);
  assert.ok(firstAt >= 1 - 1e-9, `hesitated only ${firstAt} s`);

  const bonded = createBrain({ seed: 4 });
  const intent = tickBrain(bonded, makeCtx({ trust: 80, events: [lure] }), DT);
  assert.equal(intent.state, 'seekLure');
  assert.deepEqual(intent.target, { x: 0, z: 4 });
});

test('lure release ends seekLure', () => {
  const brain = createBrain({ seed: 4 });
  const ctx = makeCtx({ trust: 50, events: [{ type: 'lure', x: 3, z: 0, held: true }] });
  run(brain, ctx, 0.5);
  assert.equal(brain.state, 'seekLure');
  ctx.events = [{ type: 'lure', x: 3, z: 0, held: false }];
  tickBrain(brain, ctx, DT);
  assert.notEqual(brain.state, 'seekLure');
});

test('food stalk → pounce → eat', () => {
  const brain = createBrain({ seed: 5 });
  const ctx = makeCtx({ food: [{ id: 'f1', x: 2, z: 0 }] });
  const seen = [];
  let feeds = 0;
  let eatAt = null;
  run(brain, ctx, 8, (c, intent) => {
    if (seen[seen.length - 1] !== intent.state) seen.push(intent.state);
    feeds += intent.trustEvents.filter((e) => e.type === 'feed').length;
    if (intent.state === 'eat' && eatAt === null) eatAt = c.now;
    if (intent.eatFoodId) {
      assert.equal(intent.eatFoodId, 'f1');
      c.food = c.food.filter((f) => f.id !== intent.eatFoodId);
      c.satiety += 1;
    }
  });
  assert.ok(eatAt !== null && eatAt <= 8, 'never ate');
  assert.equal(feeds, 1);
  const i = seen.indexOf('stalk');
  assert.deepEqual(seen.slice(i, i + 3), ['stalk', 'pounce', 'eat']);
});

test('full spider ignores food', () => {
  const brain = createBrain({ seed: 5 });
  const ctx = makeCtx({ satiety: 3, food: [{ id: 'f1', x: 2, z: 0 }] });
  run(brain, ctx, 8, (c, intent) => assert.notEqual(intent.state, 'stalk'));
});

test('null pointer calms to wander', () => {
  const brain = createBrain({ seed: 6 });
  const ctx = makeCtx({ trust: 10, pointer: { x: 1.5, z: 0, speed: 9, down: false } });
  assert.equal(tickBrain(brain, ctx, DT).state, 'flee');
  ctx.pointer = null;
  const seen = new Set();
  run(brain, ctx, 15, (c, intent) => seen.add(intent.state));
  assert.ok(seen.has('hide') && seen.has('peek'), [...seen].join(','));
  assert.ok(['wander', 'idle', 'groom'].includes(brain.state), brain.state);
});

test('huge dt is clamped', () => {
  const a = createBrain({ seed: 7 });
  const b = createBrain({ seed: 7 });
  assert.equal(a.state, 'wander');
  const ia = tickBrain(a, makeCtx(), 3600);
  const ib = tickBrain(b, makeCtx(), 0.05);
  assert.deepEqual(a.timers, b.timers);
  assert.equal(a.state, b.state);
  assert.deepEqual(ia, ib);
});

test('ride needs bonded', () => {
  const still = () => ({ x: 1, z: 0, speed: 0, down: false });
  const settled = createBrain({ seed: 8 });
  run(settled, makeCtx({ trust: 60, pointer: still() }), 3, (c, intent) => assert.notEqual(intent.state, 'ride'));

  const bonded = createBrain({ seed: 8 });
  const ctx = makeCtx({ trust: 90, pointer: still() });
  let rode = false;
  run(bonded, ctx, 3, (c, intent) => {
    if (intent.state === 'ride') {
      rode = true;
      assert.deepEqual(intent.target, { x: 1, z: 0 });
    }
  });
  assert.ok(rode);
  ctx.pointer = { x: 1, z: 0, speed: 7, down: false };
  tickBrain(bonded, ctx, DT);
  assert.notEqual(bonded.state, 'ride');
});

test('ride: it walks under the pointer at walking pace, and only then climbs on', () => {
  const p = { x: 1.5, z: 0, speed: 0, down: false };
  const brain = createBrain({ seed: 8 });
  const ctx = makeCtx({ trust: 90, pointer: p });
  let rode = false;
  let mountedAt = null;
  run(brain, ctx, 10, (c, intent) => {
    if (intent.state !== 'ride') return;
    rode = true;
    const d = Math.hypot(c.body.x - p.x, c.body.z - p.z);
    if (!intent.mounted) {
      assert.equal(mountedAt, null, 'climbed off again');
      assert.ok(intent.maxSpeed <= 0.9 && c.body.speed <= 0.9 + 1e-9, `approach at ${intent.maxSpeed} / ${c.body.speed}`);
    } else if (mountedAt === null) mountedAt = d;
  });
  assert.ok(rode, 'never rode');
  assert.ok(mountedAt !== null && mountedAt < 0.3, `climbed on at ${mountedAt}`);
});

test('slow pointer nearby: alert, gentle, raised legs', () => {
  const brain = createBrain({ seed: 9 });
  const intent = tickBrain(brain, makeCtx({ trust: 20, pointer: { x: 1.5, z: 0, speed: 0.5, down: false } }), DT);
  assert.equal(intent.state, 'alert');
  assert.deepEqual(intent.look, { x: 1.5, z: 0 });
  assert.ok(Math.abs(intent.frontLegsRaise - 0.5) < 1e-9);
  assert.deepEqual(intent.trustEvents, [{ type: 'gentle', dt: DT }]);
});

test('a due moult preempts food: it settles on clear ground first, then moults', () => {
  const brain = createBrain({ seed: 10 });
  const ctx = makeCtx();
  run(brain, ctx, 0.5);
  assert.equal(brain.state, 'wander');
  ctx.moultDue = true;
  ctx.food = [{ id: 'f1', x: 2, z: 0 }];
  const seen = [];
  run(brain, ctx, 10, (c, intent) => {
    if (seen.at(-1) !== intent.state) seen.push(intent.state);
    return intent.state !== 'moult';
  });
  assert.deepEqual(seen, ['premoult', 'moult']);
  assert.ok(Math.abs(ctx.body.speed) < 0.02, `moulting at speed ${ctx.body.speed}`);
  assert.ok(moultFits(ctx.body), 'moulting where the cast would not fit');
});

test('a due moult waits for flee, hide and peek to finish', () => {
  const brain = createBrain({ seed: 10 });
  const ctx = makeCtx({ trust: 10, pointer: { x: 1.5, z: 0, speed: 9, down: false } });
  assert.equal(tickBrain(brain, ctx, DT).state, 'flee');
  ctx.pointer = null;
  ctx.moultDue = true;
  const seen = [];
  run(brain, ctx, 40, (c, intent) => {
    if (seen.at(-1) !== intent.state) seen.push(intent.state);
    return intent.state !== 'moult';
  });
  assert.deepEqual(seen.slice(0, 3), ['flee', 'hide', 'peek']);
  assert.equal(seen.at(-1), 'moult');
  assert.ok(seen.indexOf('premoult') > seen.indexOf('peek'), seen.join(','));
});
