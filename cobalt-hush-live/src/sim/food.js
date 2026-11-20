import { mulberry32 } from '../core/math.js';
import { clampWalkable } from './deck.js';

export const MAX_FOOD = 3;
const FLUTTER = 0.1; // per-axis amplitude; the combined offset stays under 0.15 u

export function createFood({ seed = 1 } = {}) {
  return { items: [], nextId: 1, rng: mulberry32(seed) };
}

// Drops a mote at the nearest walkable point; the oldest goes when more than MAX_FOOD.
export function dropFood(food, p, now) {
  const home = clampWalkable(p);
  const r = food.rng;
  const item = {
    id: 'f' + food.nextId++,
    at: now,
    home,
    x: home.x,
    z: home.z,
    t: 0,
    fx: 1.5 + r() * 1.5,
    fz: 1.5 + r() * 1.5,
    px: r() * Math.PI * 2,
    pz: r() * Math.PI * 2,
  };
  food.items.push(item);
  while (food.items.length > MAX_FOOD) food.items.shift();
  return item;
}

export function stepFood(food, dt) {
  for (const it of food.items) {
    it.t += dt;
    it.x = it.home.x + FLUTTER * Math.sin(it.t * it.fx + it.px);
    it.z = it.home.z + FLUTTER * Math.sin(it.t * it.fz + it.pz);
  }
}

export function removeFood(food, id) {
  food.items = food.items.filter((it) => it.id !== id);
}
