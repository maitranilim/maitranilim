import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, tickSim } from '../src/app/loop.js';
import { defaultState } from '../src/core/state.js';
import { HIDEOUTS } from '../src/sim/deck.js';
import { SPIDER_SCALE } from '../src/sim/gait.js';
import { MOULT_INTERVAL } from '../src/sim/moult.js';

// 200 seeded runs of the real tick: the spider wanders for a while, then a moult comes due and
// plays through. Every stored shell must lie wholly on the deck and clear of every hideout.
const DT = 0.05;
const RUNS = 200;
const DECK = { x: 8, z: 5 };

// The cast as a capsule, modelled here independently of the sim: the shell lies at (x, z) along
// `rot`, from its abdomen tip (1.145 behind at design scale) to its front (0.29 ahead), radius 0.3,
// all times SPIDER_SCALE; the segment ends are inset by the radius.
const R = 0.3 * SPIDER_SCALE;
const FRONT = 0.29 * SPIDER_SCALE - R;
const BACK = -1.145 * SPIDER_SCALE + R;

function segDist(p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

function castProblems(shell) {
  const c = Math.cos(shell.rot);
  const s = Math.sin(shell.rot);
  const ends = [FRONT, BACK].map((t) => ({ x: shell.x + c * t, z: shell.z + s * t }));
  const bad = [];
  for (const e of ends) {
    if (Math.abs(e.x) + R > DECK.x || Math.abs(e.z) + R > DECK.z) bad.push(`off deck at ${e.x.toFixed(2)},${e.z.toFixed(2)}`);
  }
  for (const h of HIDEOUTS) {
    const d = segDist(h, ends[0], ends[1]);
    if (d < h.r + R) bad.push(`in ${h.id} by ${(h.r + R - d).toFixed(2)}`);
  }
  return bad;
}

test('200 seeded wander-then-moult runs leave every cast on the deck and clear of ceramic', () => {
  const bad = [];
  for (let seed = 1; seed <= RUNS; seed++) {
    const sim = createSim({ seed });
    const wander = 5 + ((seed * 37) % 60); // seconds of play before the moult comes due
    let state = { ...defaultState(0), sinceMoult: MOULT_INTERVAL - wander };
    let shell = null;
    const limit = Math.round((wander + 60) / DT);
    for (let n = 0; n < limit && !shell; n++) {
      const out = tickSim(sim, state, { events: [], threads: [], pointer: null, mode: 'lure', active: true, epochMs: seed }, DT);
      state = out.state;
      if (out.moulted) shell = state.moults[0];
    }
    if (!shell) {
      bad.push(`seed ${seed}: never moulted (${sim.brain.state})`);
      continue;
    }
    const problems = castProblems(shell);
    if (problems.length) bad.push(`seed ${seed}: ${problems.join(', ')}`);
  }
  assert.deepEqual(bad, []);
});
