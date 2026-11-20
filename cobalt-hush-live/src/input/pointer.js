// Pure gesture logic: no DOM. Driven by plain events { x, y, t (ms), id, pointerType }.
const SPEED_WINDOW_MS = 120;
const KEY_AXES = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export function createGestures({ holdMs = 350, slopPx = 8 } = {}) {
  let active = null; // { id, x0, y0, t0, mode: 'pending'|'hold'|'drag' }
  let hover = null; // { x, y, id, pointerType }: last known pointer position
  let speed = { px: 0, t: 0 };
  let queue = [];
  const keys = new Set();

  const push = (type, x, y) => queue.push({ type, clientX: x, clientY: y });

  function track(e) {
    if (hover && e.t > speed.t) {
      const dt = Math.max(1, e.t - speed.t);
      speed = { px: (Math.hypot(e.x - hover.x, e.y - hover.y) / dt) * 1000, t: e.t };
    } else {
      speed = { px: 0, t: e.t };
    }
    hover = { x: e.x, y: e.y, id: e.id, pointerType: e.pointerType };
  }

  function endActive(x, y) {
    if (active?.mode === 'hold') push('holdEnd', x, y);
    else if (active?.mode === 'drag') push('dragEnd', x, y);
    active = null;
  }

  return {
    down(e) {
      if (active) return;
      active = { id: e.id, x0: e.x, y0: e.y, t0: e.t, mode: 'pending' };
      track(e);
    },
    move(e) {
      if (active && e.id !== active.id) return;
      if (!active && hover && hover.id !== e.id && hover.pointerType !== 'mouse') return;
      if (!active && e.pointerType !== 'mouse') return; // touch/pen only count while down
      track(e);
      if (!active) return;
      if (active.mode === 'pending' && Math.hypot(e.x - active.x0, e.y - active.y0) > slopPx) {
        active.mode = 'drag';
        push('dragStart', e.x, e.y);
        push('dragMove', e.x, e.y);
      } else if (active.mode === 'drag') push('dragMove', e.x, e.y);
      else if (active.mode === 'hold') push('holdMove', e.x, e.y);
    },
    up(e) {
      if (!active || e.id !== active.id) return;
      track(e);
      if (active.mode === 'pending') {
        if (e.t - active.t0 < holdMs) push('tap', e.x, e.y);
        else {
          push('holdStart', e.x, e.y);
          active.mode = 'hold';
        }
      }
      endActive(e.x, e.y);
      if (e.pointerType !== 'mouse') hover = null;
    },
    cancel(id) {
      if (id !== undefined && (!active || active.id !== id) && hover?.id !== id) return;
      if (hover) endActive(hover.x, hover.y);
      active = null;
      hover = null;
    },
    leave() {
      this.cancel();
    },
    frame(now) {
      if (active?.mode === 'pending' && now - active.t0 >= holdMs) {
        active.mode = 'hold';
        push('holdStart', hover.x, hover.y);
      }
      const gestures = queue;
      queue = [];
      const pointer = hover
        ? { clientX: hover.x, clientY: hover.y, speedPx: now - speed.t > SPEED_WINDOW_MS ? 0 : speed.px }
        : null;
      return { pointer, gestures };
    },
    keyDown(code) {
      if (KEY_AXES[code]) keys.add(code);
    },
    keyUp(code) {
      keys.delete(code);
    },
    blur() {
      keys.clear();
    },
    keyVector() {
      let dx = 0;
      let dz = 0;
      for (const k of keys) {
        dx += KEY_AXES[k][0];
        dz += KEY_AXES[k][1];
      }
      dx = Math.max(-1, Math.min(1, dx));
      dz = Math.max(-1, Math.min(1, dz));
      if (dx && dz) {
        dx *= Math.SQRT1_2;
        dz *= Math.SQRT1_2;
      }
      return { dx: dx + 0, dz: dz + 0 };
    },
  };
}
