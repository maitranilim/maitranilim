import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../src/core/storage.js';

test('storage falls back to memory when everything throws', async () => {
  const ls = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  const st = await createStorage({ claudeUse: async () => { throw new Error('no'); }, localStorage: ls });
  assert.equal(st.kind, 'memory');
  const x = { v: 1, trust: 12 };
  st.save(x);
  await st.flush();
  assert.deepEqual(await st.load(), x);
});

test('storage with nothing provided is memory', async () => {
  const st = await createStorage({});
  assert.equal(st.kind, 'memory');
  assert.equal(await st.load(), null);
});

test('storage uses local when db is null', async () => {
  const data = {};
  const ls = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
  const st = await createStorage({ claudeUse: async () => null, localStorage: ls });
  assert.equal(st.kind, 'local');
  st.save({ v: 1, trust: 9 });
  await st.flush();
  assert.deepEqual(JSON.parse(data['cobalt-hush-live:v1']), { v: 1, trust: 9 });
  assert.deepEqual(await st.load(), { v: 1, trust: 9 });
});

test('storage uses db', async () => {
  const sets = [];
  let path = null;
  let stored = null;
  const db = {
    collection(p) {
      path = p;
      return { doc: (k) => ({ get: async () => stored, set: async (o) => { sets.push([k, o]); stored = o; } }) };
    },
  };
  const claudeUse = async (n) => (n === 'db' ? db : n === 'user' ? { id: async () => 'u1' } : null);
  const st = await createStorage({ claudeUse });
  assert.equal(st.kind, 'db');
  assert.equal(path, 'data/users/u1');
  st.save({ v: 1, trust: 4 });
  await st.flush();
  assert.deepEqual(sets, [['spider', { v: 1, trust: 4 }]]);
  assert.deepEqual(await st.load(), { v: 1, trust: 4 });
});

test('db snapshot with data()/exists is accepted; a failing set still leaves a local copy', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ v: 1, trust: 2 }) }), set: async () => { throw new Error('x'); } }) }) };
  const data = {};
  const ls = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  const claudeUse = async (n) => (n === 'db' ? db : { id: async () => 'u' });
  const st = await createStorage({ claudeUse, localStorage: ls });
  assert.equal(st.kind, 'db');
  assert.deepEqual(await st.load(), { v: 1, trust: 2 });
  st.save({ v: 1, trust: 3 });
  await st.flush();
  assert.deepEqual(JSON.parse(data['cobalt-hush-live:v1']), { v: 1, trust: 3 });
});

test('hanging db times out to local', async () => {
  const ls = { getItem: () => null, setItem() {} };
  const st = await createStorage({ claudeUse: () => new Promise(() => {}), localStorage: ls, timeoutMs: 20 });
  assert.equal(st.kind, 'local');
});

test('corrupt local value is treated as no data and is overwritten later', async () => {
  const data = { 'cobalt-hush-live:v1': '{bad' };
  const ls = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  const st = await createStorage({ localStorage: ls });
  assert.equal(st.kind, 'local');
  assert.equal(await st.load(), null);
  assert.equal(st.kind, 'local');
  st.save({ v: 1, trust: 5 });
  await st.flush();
  assert.deepEqual(JSON.parse(data['cobalt-hush-live:v1']), { v: 1, trust: 5 });
});

test('memory mode reads its own writes before flush', async () => {
  const st = await createStorage({});
  st.save({ v: 1, trust: 77 });
  assert.deepEqual(await st.load(), { v: 1, trust: 77 });
});

const KEY = 'cobalt-hush-live:v1';
const settle = () => new Promise((r) => setImmediate(r));

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

// A db whose doc get/set behave as `get()` and `set(o)` say; records every set attempt.
function fakeDb({ get = async () => null, set = async () => {} } = {}) {
  const attempts = [];
  const db = { collection: () => ({ doc: () => ({ get, set: async (o) => { attempts.push(o); return set(o); } }) }) };
  return { attempts, claudeUse: async (n) => (n === 'db' ? db : n === 'user' ? { id: async () => 'u' } : null) };
}

test('a failed db save is retried on the next save, and every save keeps a local copy', async () => {
  let fails = 1;
  let stored = null;
  const { attempts, claudeUse } = fakeDb({ set: async (o) => { if (fails-- > 0) throw new Error('offline'); stored = o; } });
  const ls = fakeLocal();
  let clock = 0;
  const st = await createStorage({ claudeUse, localStorage: ls, now: () => clock });
  st.save({ v: 1, trust: 1, lastSeen: 1 });
  await st.flush();
  assert.equal(st.kind, 'db', 'one failure does not demote to local for good');
  assert.deepEqual(JSON.parse(ls.data[KEY]), { v: 1, trust: 1, lastSeen: 1 });
  clock = 3000; // the next save comes at least one debounce later
  st.save({ v: 1, trust: 2, lastSeen: 2 });
  await st.flush();
  assert.equal(attempts.length, 2);
  assert.deepEqual(stored, { v: 1, trust: 2, lastSeen: 2 });
  assert.deepEqual(JSON.parse(ls.data[KEY]), { v: 1, trust: 2, lastSeen: 2 });
});

test('repeated db failures back off: 3 s, then 6 s', async () => {
  const { attempts, claudeUse } = fakeDb({ set: async () => { throw new Error('offline'); } });
  let clock = 0;
  const st = await createStorage({ claudeUse, localStorage: fakeLocal(), now: () => clock });
  for (const t of [0, 3000, 6000, 9000]) {
    clock = t;
    st.save({ v: 1, trust: t, lastSeen: t });
    await st.flush();
  }
  assert.equal(attempts.length, 3); // at 0, 3000 and 9000; 6000 is inside the 6 s backoff
  assert.equal(st.kind, 'db');
});

test('load takes whichever of db and local was saved last', async () => {
  const stale = { v: 1, trust: 10, lastSeen: 100 };
  const fresh = { v: 1, trust: 20, lastSeen: 200 };
  const local = fakeLocal({ [KEY]: JSON.stringify(fresh) });
  const st = await createStorage({ claudeUse: fakeDb({ get: async () => stale }).claudeUse, localStorage: local });
  assert.equal(st.kind, 'db');
  assert.deepEqual(await st.load(), fresh);
  const st2 = await createStorage({ claudeUse: fakeDb({ get: async () => fresh }).claudeUse, localStorage: fakeLocal({ [KEY]: JSON.stringify(stale) }) });
  assert.deepEqual(await st2.load(), fresh);
  const st3 = await createStorage({ claudeUse: fakeDb({ get: async () => null }).claudeUse, localStorage: fakeLocal({ [KEY]: JSON.stringify(stale) }) });
  assert.deepEqual(await st3.load(), stale);
});

test('a db that fails to load demotes to local and loads the local copy', async () => {
  const saved = { v: 1, trust: 30, lastSeen: 5 };
  const { attempts, claudeUse } = fakeDb({ get: async () => { throw new Error('denied'); } });
  const ls = fakeLocal({ [KEY]: JSON.stringify(saved) });
  const st = await createStorage({ claudeUse, localStorage: ls });
  assert.equal(st.kind, 'db');
  assert.deepEqual(await st.load(), saved);
  assert.equal(st.kind, 'local');
  st.save({ v: 1, trust: 31, lastSeen: 6 });
  await st.flush();
  assert.equal(attempts.length, 0);
  assert.equal(JSON.parse(ls.data[KEY]).trust, 31);
});

test('saves within the 3 s debounce coalesce into one write of the latest', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ls = fakeLocal();
  const st = await createStorage({ localStorage: ls });
  for (const trust of [1, 2, 3]) {
    st.save({ v: 1, trust });
    t.mock.timers.tick(900);
    await settle();
  }
  assert.equal(ls.writes, 0);
  t.mock.timers.tick(300); // 3 s after the first save
  await settle();
  assert.equal(ls.writes, 1);
  assert.equal(JSON.parse(ls.data[KEY]).trust, 3);
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(ls.writes, 1);
});
