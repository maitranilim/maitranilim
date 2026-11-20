import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, tickSim } from '../src/app/loop.js';
import { defaultState } from '../src/core/state.js';
import { LEGS, SPIDER_SCALE, localToWorld } from '../src/sim/gait.js';
import { HIDEOUTS } from '../src/sim/deck.js';

// 60 s of the real tick (brain -> stepBody -> stepGait) at a laptop's 60 fps, in three kinds of
// play, seeds 1-3. Measures planted-foot drift (each planted foot's distance from its current rest
// target), how much each scenario really played (flee time, steered travel), and whether the body
// ever touched ceramic it wasn't allowed into.
const DT = 1 / 60;
const SECONDS = 60;

// Fast pointer passes: every 8 s a pointer sweeps 6 u past the spider in 0.6 s (10 u/s).
function flee(sim, t, input) {
  const ph = t % 8;
  if (ph >= 0.6) return;
  const b = sim.body;
  const k = ph / 0.6;
  input.pointer = { x: b.x - 3 + 6 * k, z: b.z + 1.2, speed: 10, down: false };
}

// Zig-zag steering across the deck and back; each seed swings a different width.
function zigzag(seed) {
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push({ x: -6 + 2 * i, z: (i % 2 ? 1 : -1) * (0.8 + 0.5 * seed) });
  let i = 0;
  let dir = 1;
  let held = 0;
  return (sim, t, input) => {
    input.mode = 'steer';
    held += DT;
    const g = pts[i];
    const fresh = t === 0 || Math.hypot(sim.body.x - g.x, sim.body.z - g.z) < 0.4 || held > 3;
    if (!fresh) return;
    if (t > 0) {
      if (i + dir < 0 || i + dir >= pts.length) dir = -dir;
      i += dir;
    }
    held = 0;
    input.events.push({ type: 'steer', ...pts[i] });
  };
}

// The body as a capsule along the heading, modelled here independently of locomotion: from the
// abdomen tip (1.145 behind the body point at design scale) to the cephalothorax front (0.29
// ahead), radius 0.3, all times SPIDER_SCALE. The segment ends are inset by the radius.
const CAP_R = 0.3 * SPIDER_SCALE;
const CAP_FRONT = 0.29 * SPIDER_SCALE - CAP_R;
const CAP_BACK = -1.145 * SPIDER_SCALE + CAP_R;
function touchesCeramic(body, allowEnter) {
  const c = Math.cos(body.heading);
  const s = Math.sin(body.heading);
  return HIDEOUTS.find((h) => {
    if (h.id === allowEnter) return false;
    const t = Math.min(CAP_FRONT, Math.max(CAP_BACK, (h.x - body.x) * c + (h.z - body.z) * s));
    return Math.hypot(body.x + c * t - h.x, body.z + s * t - h.z) < h.r + CAP_R - 1e-9;
  });
}

function play(kind, seed) {
  const sim = createSim({ seed });
  const trust = kind === 'steer' ? 40 : 8;
  let state = { ...defaultState(0), trust, peakTrust: trust };
  const drive = kind === 'flee' ? flee : kind === 'steer' ? zigzag(seed) : () => {};
  const samples = [];
  const prev = {};
  let slid = 0;
  let fleeTime = 0;
  let travel = 0;
  const overlaps = [];
  for (let n = 0; n < Math.round(SECONDS / DT); n++) {
    const input = { events: [], threads: [], pointer: null, mode: 'lure', active: true, epochMs: 0 };
    drive(sim, n * DT, input);
    const from = { x: sim.body.x, z: sim.body.z };
    const out = tickSim(sim, state, input, DT);
    state = out.state;
    travel += Math.hypot(sim.body.x - from.x, sim.body.z - from.z);
    if (out.intent.state === 'flee') fleeTime += DT;
    const hit = touchesCeramic(sim.body, out.intent.allowEnter);
    if (hit && overlaps.length < 3) overlaps.push(`t ${(n * DT).toFixed(2)} ${hit.id} (${out.intent.state})`);
    for (const leg of LEGS) {
      const f = sim.gait.feet[leg.id];
      const p = prev[leg.id];
      if (f.planted) {
        const r = localToWorld(sim.body, leg.rest);
        samples.push(Math.hypot(f.x - r.x, f.z - r.z));
        if (p?.planted && (p.x !== f.x || p.y !== f.y || p.z !== f.z)) slid++;
      }
      prev[leg.id] = { planted: f.planted, x: f.x, y: f.y, z: f.z };
    }
  }
  samples.sort((a, b) => a - b);
  return { p95: samples[Math.floor(0.95 * samples.length)], max: samples.at(-1), slid, fleeTime, travel, overlaps };
}

const runs = [];
for (const kind of ['wander', 'flee', 'steer']) {
  for (const seed of [1, 2, 3]) runs.push({ kind, seed, ...play(kind, seed) });
}

test('drift scenarios really play: flees happen, steering travels', () => {
  const bad = [];
  for (const r of runs) {
    if (r.kind === 'flee' && !(r.fleeTime >= 3)) bad.push(`flee seed ${r.seed}: ${r.fleeTime.toFixed(2)} s fleeing`);
    if (r.kind === 'steer' && !(r.travel >= 30)) bad.push(`steer seed ${r.seed}: ${r.travel.toFixed(2)} u travelled`);
  }
  assert.deepEqual(bad, []);
});

test('planted feet drift stays small', () => {
  const bad = [];
  for (const { kind, seed, p95, max, slid } of runs) {
    const at = `${kind} seed ${seed}: p95 ${p95.toFixed(3)} max ${max.toFixed(3)} slid ${slid}`;
    if (slid !== 0 || !(p95 <= 0.45) || !(max <= 0.8)) bad.push(at);
  }
  assert.deepEqual(bad, []);
});

test('body capsule never overlaps ceramic', () => {
  const bad = runs.filter((r) => r.overlaps.length).map((r) => `${r.kind} seed ${r.seed}: ${r.overlaps.join(', ')}`);
  assert.deepEqual(bad, []);
});
