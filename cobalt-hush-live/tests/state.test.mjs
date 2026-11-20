import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, migrate, applyOffline, SHADES, SCHEMA_VERSION } from '../src/core/state.js';
import { clamp, lerp, damp, wrapAngle, dist, len, norm, add, sub, scale, v2 } from '../src/core/math.js';

test('migrate repairs bad fields', () => {
  const s = migrate({ v: 1, trust: NaN, satiety: 'x', moults: 'no', settings: { lights: 'off' } }, 0);
  assert.equal(s.trust, 8);
  assert.equal(s.satiety, 1);
  assert.deepEqual(s.moults, []);
  assert.equal(s.settings.lights, 'off');
  assert.equal(s.settings.material, 'translucent');
  assert.equal(s.settings.move, 'lure');
});

test('migrate(null) and unknown version give defaults', () => {
  assert.deepEqual(migrate(null, 5), defaultState(5));
  assert.deepEqual(migrate({ v: 99 }, 5), defaultState(5));
  assert.equal(defaultState(7).lastSeen, 7);
  assert.equal(SCHEMA_VERSION, 1);
});

test('migrate clamps trust and keeps valid fields', () => {
  assert.equal(migrate({ v: 1, trust: 250 }, 0).trust, 100);
  const s = migrate({ v: 1, trust: 30, peakTrust: 10, shadeIndex: 3, mats: { a: 2, b: 0.5, c: 'x' }, lastSeen: 1234 }, 0);
  assert.equal(s.trust, 30);
  assert.equal(s.peakTrust, 30);
  assert.equal(s.shadeIndex, 3);
  assert.deepEqual(s.mats, { a: 1, b: 0.5 });
  assert.equal(s.lastSeen, 1234);
});

test('migrate sanitises shadeIndex and moult entries', () => {
  const s = migrate({ v: 1, shadeIndex: 99, moults: [{ id: 'm1', shadeIndex: 2, at: 5, x: 1, z: 2, rot: 0.5 }, null, { id: 7 }, 'z'] }, 0);
  assert.equal(s.shadeIndex, 0);
  assert.equal(s.moults.length, 1);
  assert.equal(s.moults[0].id, 'm1');
});

test('SHADES', () => {
  assert.equal(SHADES.length, 8);
  assert.deepEqual(SHADES[0], { name: 'Cobalt', body: '#2341B8', highlight: '#8FB0FF', deep: '#0E1A5C' });
  assert.deepEqual(SHADES.slice(1).map((s) => s.name),
    ['Sapphire', 'Indigo', 'Ice Cobalt', 'Violet Cobalt', 'Midnight', 'Glacier', 'Electric']);
});

test('applyOffline digests satiety only', () => {
  const s = applyOffline({ ...defaultState(0), satiety: 3, trust: 50, lastSeen: 0 }, 3_600_000);
  assert.equal(s.satiety, 0);
  assert.equal(s.trust, 50);
  assert.equal(s.lastSeen, 3_600_000);
  const t = applyOffline({ ...defaultState(0), satiety: 2, lastSeen: 0 }, 90_000);
  assert.ok(Math.abs(t.satiety - 1) < 1e-9);
  const back = applyOffline({ ...defaultState(0), satiety: 2, lastSeen: 1000 }, 0);
  assert.equal(back.satiety, 2);
});

test('moults capped at 50', () => {
  const moults = [];
  for (let i = 0; i < 60; i++) moults.push({ id: 'm' + i, shadeIndex: 0, at: (i * 7919) % 1000 + i, x: 0, z: 0, rot: 0 });
  const out = migrate({ v: 1, moults }, 0).moults;
  assert.equal(out.length, 50);
  const expected = moults.map((m) => m.at).sort((a, b) => b - a).slice(0, 50);
  assert.deepEqual(out.map((m) => m.at).sort((a, b) => b - a), expected);
});

test('math helpers', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(wrapAngle(-Math.PI) > 0);
  assert.ok(wrapAngle(7) <= Math.PI && wrapAngle(7) > -Math.PI);
  assert.equal(dist(v2(0, 0), v2(3, 4)), 5);
  assert.equal(len(v2(3, 4)), 5);
  assert.deepEqual(norm(v2(0, 0)), { x: 0, z: 0 });
  assert.deepEqual(add(v2(1, 2), v2(3, 4)), { x: 4, z: 6 });
  assert.deepEqual(sub(v2(1, 2), v2(3, 4)), { x: -2, z: -2 });
  assert.deepEqual(scale(v2(1, 2), 2), { x: 2, z: 4 });
  assert.equal(damp(0, 10, 5, 0), 0);
  const d = damp(0, 10, 5, 1);
  assert.ok(Math.abs(d - 10 * (1 - Math.exp(-5))) < 1e-9);
});
