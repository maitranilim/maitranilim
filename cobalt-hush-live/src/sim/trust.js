import { clamp, lerp } from '../core/math.js';

export const SHY_BELOW = 30;
export const BONDED_FROM = 70;
const RIDE_FROM = 85;
export const POKE_STREAK = 3; // pokes within the poke window that cost extra trust and send it to hide

export function tier(trust) {
  if (trust < SHY_BELOW) return 'shy';
  if (trust < BONDED_FROM) return 'settled';
  return 'bonded';
}

function delta(event) {
  switch (event?.type) {
    case 'gentle':
      return 0.25 * (Number.isFinite(event.dt) ? Math.max(0, event.dt) : 0);
    case 'feed':
      return 6;
    case 'swipe':
      return -3;
    case 'poke':
      return (event.recentPokes ?? 0) >= POKE_STREAK ? -7 : -2;
    default:
      return 0;
  }
}

// Pure: returns a shallow copy with updated trust and peakTrust. Trust never drops below half the peak.
export function applyTrust(state, event) {
  const floor = Math.floor(state.peakTrust * 0.5);
  const trust = clamp(state.trust + delta(event), floor, 100);
  return { ...state, trust, peakTrust: Math.max(state.peakTrust, trust) };
}

export function reactionParams(trust) {
  const t = trust / 100;
  return {
    fleeDist: lerp(6, 1.5, t),
    startleSpeed: lerp(4, 10, t),
    peekDelay: lerp(6, 1.5, t),
    approachRadius: t < 0.3 ? 0 : lerp(2, 4, t),
    canRide: trust >= RIDE_FROM,
  };
}
