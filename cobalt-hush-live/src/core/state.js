import { clamp } from './math.js';

export const SCHEMA_VERSION = 1;
export const MAX_MOULTS = 50;
export const DIGEST_SECONDS = 90;

export const SHADES = [
  { name: 'Cobalt', body: '#2341B8', highlight: '#8FB0FF', deep: '#0E1A5C' },
  { name: 'Sapphire', body: '#1B5FD6', highlight: '#9CC7FF', deep: '#0A2A6B' },
  { name: 'Indigo', body: '#3A2FA8', highlight: '#A9A0FF', deep: '#150F5A' },
  { name: 'Ice Cobalt', body: '#4F7FE0', highlight: '#CFE2FF', deep: '#1B3A84' },
  { name: 'Violet Cobalt', body: '#5A38C4', highlight: '#C2A8FF', deep: '#22105F' },
  { name: 'Midnight', body: '#14246E', highlight: '#6C86E0', deep: '#050A30' },
  { name: 'Glacier', body: '#3E9BD8', highlight: '#D4F1FF', deep: '#134A78' },
  { name: 'Electric', body: '#1F6BFF', highlight: '#7FF0FF', deep: '#0A2FA0' },
];

const LIGHTS = ['on', 'off'];
const MATERIALS = ['solid', 'translucent', 'ghost'];
const MOVES = ['lure', 'steer'];
export const PACES = ['calm', 'normal', 'lively'];
const SOUNDS = ['off', 'on'];

export function defaultState(now) {
  return {
    v: SCHEMA_VERSION,
    trust: 8,
    peakTrust: 8,
    satiety: 1,
    lastSeen: now,
    sinceMoult: 0,
    shadeIndex: 0,
    moults: [],
    mats: {},
    settings: { lights: 'on', material: 'translucent', move: 'lure', pace: 'normal', sound: 'off' },
  };
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const num = (n, lo, hi, dflt) => (isNum(n) ? clamp(n, lo, hi) : dflt);
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);

function cleanMoult(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !isNum(m.at)) return null;
  return {
    id: m.id,
    shadeIndex: Number.isInteger(m.shadeIndex) && m.shadeIndex >= 0 && m.shadeIndex < SHADES.length ? m.shadeIndex : 0,
    at: m.at,
    x: isNum(m.x) ? m.x : 0,
    z: isNum(m.z) ? m.z : 0,
    rot: isNum(m.rot) ? m.rot : 0,
  };
}

export function migrate(raw, now) {
  const d = defaultState(now);
  if (!raw || typeof raw !== 'object' || raw.v !== SCHEMA_VERSION) return d;
  const trust = num(raw.trust, 0, 100, d.trust);
  const moults = (Array.isArray(raw.moults) ? raw.moults : [])
    .map(cleanMoult)
    .filter(Boolean)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_MOULTS);
  const mats = {};
  if (raw.mats && typeof raw.mats === 'object' && !Array.isArray(raw.mats)) {
    for (const k of Object.keys(raw.mats)) if (isNum(raw.mats[k])) mats[k] = clamp(raw.mats[k], 0, 1);
  }
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const shade = raw.shadeIndex;
  return {
    v: SCHEMA_VERSION,
    trust,
    peakTrust: Math.max(trust, num(raw.peakTrust, 0, 100, trust)),
    satiety: num(raw.satiety, 0, 3, d.satiety),
    lastSeen: isNum(raw.lastSeen) ? raw.lastSeen : now,
    sinceMoult: num(raw.sinceMoult, 0, Infinity, 0),
    shadeIndex: Number.isInteger(shade) && shade >= 0 && shade < SHADES.length ? shade : 0,
    moults,
    mats,
    settings: {
      lights: pick(s.lights, LIGHTS, d.settings.lights),
      material: pick(s.material, MATERIALS, d.settings.material),
      move: pick(s.move, MOVES, d.settings.move),
      pace: pick(s.pace, PACES, d.settings.pace),
      sound: pick(s.sound, SOUNDS, d.settings.sound),
    },
  };
}

export function applyOffline(state, now) {
  const elapsed = Math.max(0, now - state.lastSeen);
  return {
    ...state,
    satiety: Math.max(0, state.satiety - elapsed / 1000 / DIGEST_SECONDS),
    lastSeen: now,
  };
}
