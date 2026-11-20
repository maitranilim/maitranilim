// Storage boot (bounded wait), merge of a late answer, save-on-change and flush.
import { clamp } from '../core/math.js';
import { applyOffline, migrate } from '../core/state.js';
import { STORAGE_KEY, createStorage } from '../core/storage.js';

export const BOOT_WAIT_MS = 1500;

// What counts as a change worth saving: trust, moults, mats, settings, shade. (Satiety and the
// clocks ride along with those saves and the flush on hide.)
function saveKey(s) {
  return JSON.stringify([s.trust, s.shadeIndex, s.moults.length, s.moults[0]?.id, s.mats, s.settings]);
}

// Storage answered after play began: keep the saved spider and add what happened since `base`
// (the defaults play started from). Settings the player changed this session win.
export function mergeLoaded(session, base, loaded) {
  const floor = Math.floor(loaded.peakTrust * 0.5);
  const trust = clamp(loaded.trust + (session.trust - base.trust), floor, 100);
  const mats = { ...loaded.mats };
  for (const [k, v] of Object.entries(session.mats)) mats[k] = Math.max(mats[k] ?? 0, v);
  const settings = {};
  for (const k of Object.keys(loaded.settings)) {
    settings[k] = session.settings[k] !== base.settings[k] ? session.settings[k] : loaded.settings[k];
  }
  return {
    ...loaded,
    trust,
    peakTrust: Math.max(loaded.peakTrust, trust),
    satiety: clamp(loaded.satiety + (session.satiety - base.satiety), 0, 3),
    sinceMoult: Math.max(0, loaded.sinceMoult + (session.sinceMoult - base.sinceMoult)),
    mats,
    settings,
  };
}

// The settings of the local copy, read synchronously (no waiting on storage), so the very first
// frame can already show the saved lights and material. null if there is no readable copy.
export function peekSettings(localStorage) {
  try {
    const raw = localStorage?.getItem(STORAGE_KEY);
    return raw == null ? null : migrate(JSON.parse(raw), 0).settings;
  } catch {
    return null;
  }
}

export function createPersistence({ claudeUse, localStorage, now = () => Date.now(), timeoutMs } = {}) {
  let storage = null;
  let lastKey = null; // null until begin(): nothing is saved before the saved spider is adopted
  const loaded = (async () => {
    storage = await createStorage({ claudeUse, localStorage, ...(timeoutMs ? { timeoutMs } : {}) });
    const t = now();
    return applyOffline(migrate(await storage.load(), t), t);
  })().catch(() => migrate(null, now())); // never expected; the page must run regardless

  const snapshot = (state) => ({ ...state, lastSeen: now() });

  return {
    loaded,
    get kind() {
      return storage?.kind ?? 'pending';
    },
    // Resolves to the loaded State, or null if storage has not answered within waitMs.
    boot(waitMs = BOOT_WAIT_MS) {
      let timer;
      const late = new Promise((r) => { timer = setTimeout(() => r(null), waitMs); });
      return Promise.race([loaded, late]).finally(() => clearTimeout(timer));
    },
    begin(state) {
      lastKey = saveKey(state);
    },
    save(state) {
      if (lastKey === null || !storage) return;
      const key = saveKey(state);
      if (key === lastKey) return;
      lastKey = key;
      storage.save(snapshot(state)); // storage debounces the write
    },
    flush(state) {
      if (lastKey === null || !storage) return Promise.resolve();
      if (state) storage.save(snapshot(state));
      return storage.flush();
    },
  };
}
