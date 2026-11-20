import test from 'node:test';
import assert from 'node:assert/strict';
import { tier, applyTrust, reactionParams } from '../src/sim/trust.js';

test('trust floor', () => {
  let s = { trust: 60, peakTrust: 60 };
  for (let i = 0; i < 40; i++) {
    s = applyTrust(s, { type: 'swipe' });
    assert.ok(s.trust >= 30, `trust ${s.trust} fell below the floor`);
  }
  assert.equal(s.trust, 30);
  assert.equal(s.peakTrust, 60);
});

test('tier boundaries', () => {
  assert.equal(tier(29.9), 'shy');
  assert.equal(tier(30), 'settled');
  assert.equal(tier(69.9), 'settled');
  assert.equal(tier(70), 'bonded');
});

test('trust events and peak tracking', () => {
  const s0 = { trust: 50, peakTrust: 50, satiety: 2 };
  const fed = applyTrust(s0, { type: 'feed' });
  assert.equal(fed.trust, 56);
  assert.equal(fed.peakTrust, 56);
  assert.equal(fed.satiety, 2);
  assert.equal(s0.trust, 50, 'input is not mutated');
  assert.equal(applyTrust(s0, { type: 'gentle', dt: 2 }).trust, 50.5);
  assert.equal(applyTrust(s0, { type: 'swipe' }).trust, 47);
  assert.equal(applyTrust(s0, { type: 'poke', recentPokes: 2 }).trust, 48);
  assert.equal(applyTrust(s0, { type: 'poke', recentPokes: 3 }).trust, 43);
  assert.equal(applyTrust({ trust: 98, peakTrust: 98 }, { type: 'feed' }).trust, 100);
  assert.equal(applyTrust({ trust: 1, peakTrust: 1 }, { type: 'swipe' }).trust, 0);
});

test('reactionParams scale with trust', () => {
  const lo = reactionParams(0);
  assert.deepEqual(lo, { fleeDist: 6, startleSpeed: 4, peekDelay: 6, approachRadius: 0, canRide: false });
  const hi = reactionParams(100);
  assert.deepEqual(hi, { fleeDist: 1.5, startleSpeed: 10, peekDelay: 1.5, approachRadius: 4, canRide: true });
  assert.equal(reactionParams(29).approachRadius, 0);
  assert.ok(Math.abs(reactionParams(50).approachRadius - 3) < 1e-9);
  assert.equal(reactionParams(84.9).canRide, false);
  assert.equal(reactionParams(85).canRide, true);
});
