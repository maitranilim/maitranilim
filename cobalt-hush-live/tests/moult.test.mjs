import test from 'node:test';
import assert from 'node:assert/strict';
import { MOULT_INTERVAL, CAST_OFFSET, castPose, moultFits, tickMoultClock, isMoultDue, completeMoult, deckShells, moultPhase } from '../src/sim/moult.js';
import { SPIDER_SCALE } from '../src/sim/gait.js';
import { defaultState } from '../src/core/state.js';

test('moult due after 780 active seconds', () => {
  let s = defaultState(0);
  s = tickMoultClock(s, 100, false);
  assert.equal(s.sinceMoult, 0);
  for (let i = 0; i < 779; i++) s = tickMoultClock(s, 1, true);
  assert.equal(isMoultDue(s), false);
  s = tickMoultClock(s, 1, true);
  assert.equal(isMoultDue(s), true);
  assert.equal(MOULT_INTERVAL, 780);
});

test('completeMoult advances shade and stores shell', () => {
  const s = { ...defaultState(0), shadeIndex: 7, sinceMoult: 800 };
  const out = completeMoult(s, { x: 1, z: 2, heading: 0.5 }, 1000);
  assert.equal(out.shadeIndex, 0);
  assert.equal(out.sinceMoult, 0);
  assert.equal(out.moults.length, s.moults.length + 1);
  const shell = out.moults[0];
  assert.equal(shell.shadeIndex, 7);
  assert.equal(shell.at, 1000);
  assert.deepEqual([shell.x, shell.z, shell.rot], [1, 2, 0.5]);
  assert.equal(typeof shell.id, 'string');
  assert.equal(s.moults.length, 0);
});

test('completeMoult keeps at most 50 moults', () => {
  let s = defaultState(0);
  for (let i = 0; i < 55; i++) s = completeMoult(s, { x: 0, z: 0, heading: 0 }, i);
  assert.equal(s.moults.length, 50);
  assert.equal(s.moults[0].at, 54);
});

test('deckShells caps at six', () => {
  const s = defaultState(0);
  s.moults = Array.from({ length: 9 }, (_, i) => ({ id: 'm' + i, shadeIndex: 0, at: i, x: 0, z: 0, rot: 0 }));
  const shells = deckShells(s);
  assert.equal(shells.length, 6);
  assert.deepEqual(shells.map((m) => m.at).sort((a, b) => b - a), [8, 7, 6, 5, 4, 3]);
});

test('moultPhase', () => {
  assert.equal(moultPhase(0).phase, 'still');
  assert.equal(moultPhase(5).phase, 'roll');
  assert.ok(Math.abs(moultPhase(5).p - 0.5) < 1e-9);
  assert.equal(moultPhase(9).phase, 'emerge');
  assert.equal(moultPhase(13).phase, 'rollBack');
  assert.deepEqual(moultPhase(14), { phase: 'done', p: 1 });
  assert.deepEqual(moultPhase(99), { phase: 'done', p: 1 });
});

test('castPose leaves the cast CAST_OFFSET behind on the same heading; moultFits needs room for both', () => {
  assert.equal(CAST_OFFSET, 1.15 * SPIDER_SCALE);
  const cast = castPose({ x: 1, z: 2, heading: Math.PI / 2 });
  assert.ok(Math.abs(cast.x - 1) < 1e-9 && Math.abs(cast.z - (2 - CAST_OFFSET)) < 1e-9 && cast.heading === Math.PI / 2);
  assert.equal(moultFits({ x: 0, z: 0, heading: 0 }), true);
  assert.equal(moultFits({ x: -6, z: 0, heading: 0 }), false, 'cast past the left edge');
  assert.equal(moultFits({ x: 6, z: 0, heading: 0 }), true, 'facing the right edge, cast towards the centre');
  assert.equal(moultFits({ x: 1.2, z: 0.5, heading: -Math.PI / 2 }), false, 'cast into the moss');
});
