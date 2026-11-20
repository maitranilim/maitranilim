const DEBOUNCE_MS = 3000;
const TIMEOUT_MS = 10000;
// After a failed db save the db is tried again on a later save, backing off 3 s, 6 s, ... 60 s.
const RETRY_MS = 3000;
const RETRY_MAX_MS = 60000;
const SPIDER_DOC = 'spider';
export const STORAGE_KEY = 'cobalt-hush-live:v1';

function withTimeout(p, ms) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([Promise.resolve(p), t]).finally(() => clearTimeout(timer));
}

// Accept a plain object/null, or a snapshot with exists/data().
function unwrapSnapshot(snap) {
  if (snap && typeof snap.data === 'function') {
    if (snap.exists === false) return null;
    return snap.data() ?? null;
  }
  if (snap && typeof snap === 'object' && 'exists' in snap && typeof snap.exists !== 'function') {
    return snap.exists ? (snap.data ?? null) : null;
  }
  return snap ?? null;
}

// Whichever saved state was saved last (by lastSeen); `a` on a tie.
function newer(a, b) {
  if (!a || !b) return a ?? b ?? null;
  const t = (o) => (typeof o.lastSeen === 'number' && Number.isFinite(o.lastSeen) ? o.lastSeen : -Infinity);
  return t(b) > t(a) ? b : a;
}

// kind is the primary tier: 'db', 'local' or 'memory'. When localStorage works every save also
// keeps a local copy, and load takes the newer of the db and local copies, so a db write that
// failed loses nothing. Only a db that fails to load demotes; failed db saves are retried.
export async function createStorage({ claudeUse, localStorage, key = STORAGE_KEY, timeoutMs = TIMEOUT_MS, now = () => Date.now() } = {}) {
  let kind = 'memory';
  let dbDoc = null;
  let memory = null;

  if (typeof claudeUse === 'function') {
    try {
      const db = await withTimeout(claudeUse('db'), timeoutMs);
      const user = db ? await withTimeout(claudeUse('user'), timeoutMs) : null;
      if (db && user) {
        const id = await withTimeout(user.id(), timeoutMs);
        dbDoc = db.collection('data/users/' + id).doc(SPIDER_DOC);
        kind = 'db';
      }
    } catch { dbDoc = null; }
  }
  let localOk = false;
  try {
    if (localStorage) {
      localStorage.getItem(key);
      localOk = true;
    }
  } catch { /* no local copy */ }
  if (kind !== 'db' && localOk) kind = 'local';

  const store = { kind };

  function readLocal() {
    if (!localOk) return null;
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch { return null; } // unreadable or corrupt = no saved data
  }

  function writeLocal(state) {
    if (!localOk) return;
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* quota or blocked: db or memory still has it */ }
  }

  store.load = async () => {
    if (store.kind === 'memory') return memory;
    let fromDb = null;
    if (store.kind === 'db') {
      try { fromDb = unwrapSnapshot(await withTimeout(dbDoc.get(), timeoutMs)); } catch {
        store.kind = localOk ? 'local' : 'memory';
        if (store.kind === 'memory') return memory;
      }
    }
    return newer(fromDb, readLocal());
  };

  let pending = null;
  let hasPending = false;
  let timer = null;
  let inflight = Promise.resolve();
  let dbFails = 0;
  let dbRetryAt = -Infinity;

  async function write() {
    if (!hasPending) return;
    const state = pending;
    hasPending = false;
    memory = state;
    writeLocal(state);
    if (store.kind !== 'db' || now() < dbRetryAt) return;
    try {
      await withTimeout(dbDoc.set(state), timeoutMs);
      dbFails = 0;
      dbRetryAt = -Infinity;
    } catch {
      dbFails++;
      dbRetryAt = now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (dbFails - 1));
    }
  }

  store.save = (state) => {
    pending = state;
    memory = state;
    hasPending = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      inflight = inflight.then(write);
    }, DEBOUNCE_MS);
    if (timer.unref) timer.unref();
  };

  store.flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    inflight = inflight.then(write);
    return inflight;
  };

  return store;
}
