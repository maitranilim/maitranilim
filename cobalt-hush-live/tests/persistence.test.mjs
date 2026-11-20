import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence, mergeLoaded, peekSettings } from '../src/app/persistence.js';
import { defaultState } from '../src/core/state.js';

const KEY = 'cobalt-hush-live:v1';
function fakeLocal(initial = {}) {
  const data = { ...initial };
  let writes = 0;
  return {
    data,
    get writes() { return writes; },
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { writes++; data[k] = v; },
  };
}

test('boot loads, migrates and applies offline digestion once', async () => {
  const saved = { ...defaultState(0), trust: 42, peakTrust: 50, satiety: 3, lastSeen: 1000, mats: { bark: 0.5 } };
  const ls = fakeLocal({ [KEY]: JSON.stringify(saved) });
  const p = createPersistence({ localStorage: ls, now: () => 1000 + 90_000 });
  assert.equal(p.kind, 'pending');
  const st = await p.boot(1500);
  assert.equal(p.kind, 'local');
  assert.equal(st.trust, 42);
  assert.equal(st.peakTrust, 50);
  assert.ok(Math.abs(st.satiety - 2) < 1e-9);
  assert.equal(st.lastSeen, 91_000);
  assert.deepEqual(st.mats, { bark: 0.5 });
});

test('corrupt saves boot as defaults', async () => {
  const ls = fakeLocal({ [KEY]: '{"v":1,"trust":"NaN","moults":7' });
  const st = await createPersistence({ localStorage: ls, now: () => 5 }).boot(1500);
  assert.deepEqual(st, defaultState(5));
});

test('blocked storage boots in memory', async () => {
  const ls = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const p = createPersistence({ localStorage: ls, claudeUse: async () => null, now: () => 0 });
  assert.deepEqual(await p.boot(1500), defaultState(0));
  assert.equal(p.kind, 'memory');
});

test('boot gives up waiting after the limit; the late answer still arrives', async () => {
  let answer;
  const claudeUse = () => new Promise((r) => { answer = r; });
  const p = createPersistence({ claudeUse, localStorage: fakeLocal(), now: () => 0, timeoutMs: 200 });
  const t0 = Date.now();
  assert.equal(await p.boot(30), null);
  assert.ok(Date.now() - t0 < 150);
  answer(null); // no db: falls to local
  const late = await p.loaded;
  assert.deepEqual(late, defaultState(0));
  assert.equal(p.kind, 'local');
});

test('saves only after begin, only on change, and flush writes the latest with lastSeen', async () => {
  const ls = fakeLocal();
  let clock = 100;
  const p = createPersistence({ localStorage: ls, now: () => clock });
  const s0 = await p.boot(1500);
  p.save({ ...s0, trust: 20 }); // before begin: ignored
  await p.flush(null);
  assert.equal(ls.writes, 0);

  p.begin(s0);
  p.save(s0); // unchanged: no save queued
  await p.flush(null);
  assert.equal(ls.writes, 0);

  p.save({ ...s0, satiety: 2 }); // satiety alone is not a save trigger
  await p.flush(null);
  assert.equal(ls.writes, 0);

  for (const change of [{ trust: 9 }, { mats: { bark: 0.2 } }, { settings: { ...s0.settings, lights: 'off' } }, { shadeIndex: 2 }, { moults: [{ id: 'm1', shadeIndex: 0, at: 1, x: 0, z: 0, rot: 0 }] }]) {
    const before = ls.writes;
    p.save({ ...s0, ...change });
    await p.flush(null);
    assert.equal(ls.writes, before + 1, JSON.stringify(change));
  }

  clock = 777;
  await p.flush({ ...s0, trust: 33 });
  const stored = JSON.parse(ls.data[KEY]);
  assert.equal(stored.trust, 33);
  assert.equal(stored.lastSeen, 777);
});

test('a late load keeps saved progress and adds what happened this session', () => {
  const base = defaultState(0);
  const session = { ...base, trust: 10, peakTrust: 10, satiety: 1.5, sinceMoult: 3, mats: { bark: 0.1 }, settings: { ...base.settings, material: 'ghost' } };
  const loaded = {
    ...defaultState(0),
    trust: 60,
    peakTrust: 70,
    satiety: 0.2,
    sinceMoult: 100,
    shadeIndex: 3,
    mats: { bark: 0.4, moss: 1 },
    moults: [{ id: 'm1', shadeIndex: 2, at: 1, x: 0, z: 0, rot: 0 }],
    settings: { lights: 'off', material: 'solid', move: 'steer' },
  };
  const m = mergeLoaded(session, base, loaded);
  assert.equal(m.trust, 62);
  assert.equal(m.peakTrust, 70);
  assert.equal(m.satiety, 0.7);
  assert.equal(m.sinceMoult, 103);
  assert.equal(m.shadeIndex, 3);
  assert.deepEqual(m.moults, loaded.moults);
  assert.deepEqual(m.mats, { bark: 0.4, moss: 1 });
  assert.deepEqual(m.settings, { lights: 'off', material: 'ghost', move: 'steer' });
  // Losses this session still respect the loaded trust floor.
  const lost = mergeLoaded({ ...session, trust: 0 }, base, { ...loaded, trust: 36 });
  assert.equal(lost.trust, 35);
});

test('peekSettings reads the saved settings synchronously, for the very first frame', () => {
  const saved = { ...defaultState(0), settings: { lights: 'off', material: 'ghost', move: 'steer' } };
  assert.deepEqual(peekSettings(fakeLocal({ [KEY]: JSON.stringify(saved) })), saved.settings);
  assert.equal(peekSettings(fakeLocal()), null);
  assert.equal(peekSettings(null), null);
  assert.equal(peekSettings({ getItem() { throw new Error('blocked'); } }), null);
  assert.equal(peekSettings(fakeLocal({ [KEY]: '{bad' })), null);
  // Repaired like any load: unknown values fall back to the defaults.
  const odd = { ...defaultState(0), settings: { lights: 'dim', material: 'ghost' } };
  assert.deepEqual(peekSettings(fakeLocal({ [KEY]: JSON.stringify(odd) })), { lights: 'on', material: 'ghost', move: 'lure' });
});
