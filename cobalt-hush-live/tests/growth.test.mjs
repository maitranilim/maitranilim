import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, migrate, SIZE, PATTERNS } from '../src/core/state.js';
import { completeMoult, unlocksAt } from '../src/sim/moult.js';

const body = { x: 0, z: 0, heading: 0 };
const moultN = (n, start = defaultState(0)) => {
  let s = start;
  for (let i = 0; i < n; i++) s = completeMoult(s, body, 1000 + i * 7919);
  return s;
};

test('a new spider starts as a juvenile and grows a little each moult, up to adult size', () => {
  const s0 = defaultState(0);
  assert.equal(s0.size, SIZE.juvenile);
  const s1 = completeMoult(s0, body, 1000);
  assert.ok(Math.abs(s1.size - (SIZE.juvenile + SIZE.step)) < 1e-9);
  assert.equal(s1.moults[0].size, SIZE.juvenile, 'the shell keeps the old size');
  assert.equal(moultN(30).size, SIZE.adult);
});

test('saves from before growth are treated as full-grown; sizes are clamped', () => {
  assert.equal(migrate({ v: 1, trust: 40 }, 0).size, 1);
  assert.equal(migrate({ v: 1, size: 9 }, 0).size, 1.2);
  assert.equal(migrate({ v: 1, moults: [{ id: 'm1', at: 1 }] }, 0).moults[0].size, 1);
});

test('patterns unlock at their milestones and the newest is worn', () => {
  const s1 = moultN(1);
  assert.ok(s1.patterns.includes('chevron'));
  assert.equal(s1.pattern, s1.patterns[s1.patterns.length - 1]);
  const s5 = moultN(5);
  for (const p of ['faint', 'chevron', 'constellation', 'gilded']) assert.ok(s5.patterns.includes(p), p);
  assert.ok(moultN(8).patterns.includes('opal'), 'the rare one is found by the eighth moult at the latest');
  assert.equal(new Set(moultN(12).patterns).size, moultN(12).patterns.length, 'no duplicates');
});

test('the rare pattern never comes on the first moult, and its roll is stable', () => {
  assert.ok(!unlocksAt(1, ['faint'], 12345).includes('opal'));
  assert.deepEqual(unlocksAt(4, ['faint'], 777), unlocksAt(4, ['faint'], 777));
});

test('pattern state is repaired on load', () => {
  const m = migrate({ v: 1, patterns: ['faint', 'opal', 'nonsense'], pattern: 'nonsense' }, 0);
  assert.deepEqual(m.patterns, ['faint', 'opal']);
  assert.equal(m.pattern, 'faint');
  assert.deepEqual(migrate({ v: 1 }, 0).patterns, ['faint']);
  assert.ok(PATTERNS.includes(migrate({ v: 1, patterns: ['opal'], pattern: 'opal' }, 0).pattern));
});
