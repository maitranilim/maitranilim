// Turns gestures into brain events, and wires DOM pointer/key events into the gesture recogniser.
// routeGestures, keyEvents and createPointerTracker are pure (no DOM) and unit-tested.
import { dist } from '../core/math.js';
import { clampWalkable, insideHideout } from '../sim/deck.js';
import { SPIDER_SCALE } from '../sim/gait.js';
import { BODY_CLEARANCE } from '../sim/locomotion.js';
import { dropFood } from '../sim/food.js';
import { ripple, threadHit } from '../sim/silk.js';

export const POKE_RADIUS = 0.6 * SPIDER_SCALE; // taps this close to the body centre poke it
const FEED_AHEAD = 1.5;
const THREAD_RADIUS = 0.25;
const SPEED_WINDOW_MS = 120;

// env: { toWorld(gesture) -> {x,z}|null, mode, feedArmed, body, silk, food, now (sim s) }.
// Drops food and ripples silk directly. Returns { events, threads (this tick only), fed }.
export function routeGestures(list, env) {
  const events = [];
  const threads = [];
  let fed = false;
  for (const g of list) {
    if (g.type === 'dragEnd') continue;
    if (g.type === 'holdEnd') {
      events.push({ type: 'lure', held: false });
      continue;
    }
    const p = env.toWorld(g);
    if (!p) continue;
    if (g.type === 'tap') {
      if (env.feedArmed && !fed) {
        dropFood(env.food, p, env.now);
        fed = true;
      } else if (dist(p, env.body) <= POKE_RADIUS) {
        events.push({ type: 'poke' });
      } else {
        const hit = threadHit(env.silk, p, THREAD_RADIUS);
        if (hit) {
          ripple(env.silk, hit);
          threads.push(hit);
        }
      }
    } else if (env.mode === 'steer') {
      // Drags steer; so does a still press (R4). A point inside a hideout stays as it is: steering
      // there walks the spider in (the brain makes it the hideout's centre).
      const at = insideHideout(p) ? { x: p.x, z: p.z } : clampWalkable(p, null, BODY_CLEARANCE);
      events.push({ type: 'steer', ...at });
    } else if (g.type === 'holdStart' || g.type === 'holdMove') {
      events.push({ type: 'lure', held: true, ...clampWalkable(p, null, BODY_CLEARANCE) });
    }
  }
  return { events, threads, fed };
}

// Keys give a screen direction (dx right, dz down, as the deck reads in landscape); `yaw` is the
// camera's turn about y (fitCamera turns it 90 deg in portrait), so W stays screen-up and D
// screen-right whichever way the deck is shown.
// Where food lands when fed from the keyboard: FEED_AHEAD in front of the spider, walkable.
export function feedAhead(body) {
  return clampWalkable({ x: body.x + Math.cos(body.heading) * FEED_AHEAD, z: body.z + Math.sin(body.heading) * FEED_AHEAD });
}

export function keyEvents({ dx, dz }, mode, yaw = 0) {
  if (mode !== 'steer' || !(dx || dz)) return [];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [{ type: 'steerKeys', dx: dx * c + dz * s, dz: dz * c - dx * s }];
}

// World-space pointer speed (u/s) over a short window. A null point (pointer gone) starts afresh,
// so re-entering the deck never reads as a fast swipe.
export function createPointerTracker() {
  let samples = [];
  return {
    update(p, tMs, down) {
      if (!p) {
        samples = [];
        return null;
      }
      samples.push({ x: p.x, z: p.z, t: tMs });
      // Keep one sample at or beyond the window edge as the base (at low frame rates, the last frame).
      while (samples.length > 2 && samples[1].t <= tMs - SPEED_WINDOW_MS) samples.shift();
      const base = samples[0];
      const span = tMs - base.t;
      const speed = span > 0 ? (dist(base, p) / span) * 1000 : 0;
      return { x: p.x, z: p.z, speed, down: !!down };
    },
  };
}

// DOM wiring. onInput() fires on any pointer or key activity.
export function attachInput(canvas, gestures, { onInput = () => {} } = {}) {
  canvas.style.touchAction = 'none';
  let pressed = null; // pointerId of the press in progress
  const ev = (e) => ({ x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, pointerType: e.pointerType });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // right/middle clicks do nothing
    onInput();
    pressed = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    gestures.down(ev(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    onInput();
    gestures.move(ev(e));
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // the release of an ignored click
    onInput();
    if (pressed === e.pointerId) pressed = null;
    gestures.up(ev(e));
  });
  canvas.addEventListener('pointercancel', (e) => {
    if (pressed === e.pointerId) pressed = null;
    gestures.cancel(e.pointerId);
  });
  canvas.addEventListener('pointerleave', () => {
    pressed = null;
    gestures.leave();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press lures on touch
  // Keys on toolbar/panel buttons (Space, Enter, arrows) belong to the buttons, not to steering.
  const inUi = (e) => e.target instanceof Element && !!e.target.closest('#ui');
  window.addEventListener('keydown', (e) => {
    if (inUi(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    onInput();
    gestures.keyDown(e.code);
  });
  window.addEventListener('keyup', (e) => gestures.keyUp(e.code));
  window.addEventListener('blur', () => {
    pressed = null;
    gestures.blur();
    gestures.cancel();
  });
  return {
    get down() {
      return pressed !== null;
    },
  };
}
