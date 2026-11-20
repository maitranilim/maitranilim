// Behaviour brain: a single state object with explicit timers. It never moves the body or mutates
// trust; each tick it returns an Intent (target, speed, look, trust events) for the caller to apply.
// ctx.now is in seconds. Seeded RNG only.
import { add, clamp, dist, lerp, mulberry32, norm, scale, sub } from '../core/math.js';
import { HIDEOUTS, clampWalkable, insideHideout, nearestHideout } from './deck.js';
import { SPIDER_SCALE } from './gait.js';
import { BODY_CLEARANCE, capsuleHideout } from './locomotion.js';
import { moultFits, moultSpot } from './moult.js';
import { POKE_STREAK, SHY_BELOW, reactionParams, tier } from './trust.js';

export const MAX_DT = 0.05;
// Distances measured against the spider's own size (arrival, reach, hop, gap) scale with it;
// perception ranges, wander reach and speeds do not.
const S = SPIDER_SCALE;
const DEFAULT_SEED = 1;

const WANDER_SPEED = 0.9;
const WANDER_REACH = [1, 3]; // wander targets lie this far from the body
const WALK_TIME = [1, 3];
const PAUSE_TIME = [0.8, 2.5];
const GROOM_TIME = 2.5;
const GROOM_CHANCE = 0.1;
const ARRIVED = 0.3 * S;

const HOP_DIST = 0.25 * S;
const HOP_TIME = 0.5;
const HOP_SPEED = 1.2;
const POKE_WINDOW = 4;

const FLEE_SPEED = 2.4;
const SKITTER_MAX = 3; // a settled or bonded spider's short skitter gives up after this
const FLEE_MAX = 6; // give up on the entrance and dive in if it takes longer than this
const ENTRANCE_REACHED = 0.5 * S;
const HIDE_SPEED = 1.2;
const PEEK_TIME = 2;
const PEEK_SPEED = 0.5;
const PEEK_DEPTH = 0.6; // fraction of the hideout radius, towards its entrance

const STEER_KEY_REACH = 1.5;
const STEER_WALK = 1.6;
const STEER_PAUSE = 0.4;

const LURE_SPEED = 1;
const BONDED_LURE_BOOST = 1.3;
const LURE_HESITATE = 1;

const STALK_SPEED = 0.6;
const STALK_DIST = 0.9 * S;
const STALK_PAUSE = 0.8;
const POUNCE_TIME = 0.25;
const POUNCE_SPEED = 3.5;
const EAT_TIME = 3;
const FULL = 3;

const INVESTIGATE_SPEED = 0.8;
const INVESTIGATE_MAX = 6;

const ALERT_RADIUS = 3;
const SLOW_POINTER = 1.5;
const APPROACH_SPEED = 0.5;
const APPROACH_GAP = 0.8 * S;
const STILL_POINTER = 0.2;
const RIDE_RADIUS = 1.2 * S;
const RIDE_HOLD = 2;
const RIDE_RELEASE = 6;
const RIDE_SPEED = 3; // once on board it is carried along
const RIDE_MOUNT = 0.3; // it climbs on only once the body is this close under the pointer

// Before moulting it finds ground where the body and the cast it leaves behind both fit (R27).
const MOULT_MARGIN = 0.25; // spots are picked with this much room, so settling never spoils the fit
const SPOT_REACHED = 0.15;
const STOPPED = 0.02; // speed (u/s) and turn (rad/s) below which the body counts as still
const PREMOULT_MAX = 12; // re-pick the spot if reaching it takes longer than this
const FACE_STALL = 0.5; // ... or if the turn to face it stalls this long (ceramic in the way)

const LIGHTS_IDLE = 1.2;
const EPS = 1e-9;

// Lower rank = higher priority. A trigger of priority p interrupts the current state when p < rank
// (or p === rank for retargetable states). `hop` (poke hop, state 'alert') and `lights` (state 'idle')
// are ranks for state variants, not states.
const RANK = {
  moult: 1,
  premoult: 1,
  hop: 2,
  flee: 3,
  hide: 3,
  peek: 3,
  pounce: 3.5,
  eat: 3.5,
  steered: 4,
  seekLure: 5,
  stalk: 6,
  investigate: 7,
  alert: 8,
  approach: 8,
  ride: 8,
  lights: 9,
  wander: 10,
  idle: 10,
  groom: 10,
};

const MOULTING = new Set(['premoult', 'moult']);
const HIDING = new Set(['flee', 'hide', 'peek']); // a due moult waits for these to finish

const pt = (p) => (p ? { x: p.x, z: p.z } : null);
const hideout = (id) => HIDEOUTS.find((h) => h.id === id);
const span = (rng, [a, b]) => lerp(a, b, rng());

function nearest(points, p) {
  let best = null;
  let bestD = Infinity;
  for (const q of points) {
    const d = dist(q, p);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

function enter(brain, state, data = {}, phase = 0, rank = RANK[state]) {
  brain.state = state;
  brain.rank = rank;
  brain.data = data;
  brain.timers.state = 0;
  brain.timers.phase = phase;
  if (state === 'steered') brain.timers.cycle = 0;
}

function startWalk(brain) {
  enter(brain, 'wander', { target: null }, span(brain.rng, WALK_TIME));
}

function startPause(brain) {
  if (brain.rng() < GROOM_CHANCE) enter(brain, 'groom', {}, GROOM_TIME);
  else enter(brain, 'idle', {}, span(brain.rng, PAUSE_TIME));
}

// Picks the hideout whose entrance is far from the threat but near the body (nearest when no threat).
function enterFlee(brain, body, from) {
  let best = null;
  let bestScore = -Infinity;
  let bestD = Infinity;
  for (const h of HIDEOUTS) {
    const d = dist(h.entrance, body);
    const score = from ? dist(h.entrance, from) - d : -d;
    if (score > bestScore + EPS || (Math.abs(score - bestScore) <= EPS && d < bestD)) {
      best = h;
      bestScore = score;
      bestD = d;
    }
  }
  enter(brain, 'flee', { hideoutId: best.id });
}

// A settled or bonded spider skitters `reach` straight away from the threat, then pauses.
function enterSkitter(brain, body, from, reach) {
  let away = norm(sub(body, from));
  if (away.x === 0 && away.z === 0) away = { x: -Math.cos(body.heading), z: -Math.sin(body.heading) };
  enter(brain, 'flee', { to: clampWalkable(add(body, scale(away, reach)), null, BODY_CLEARANCE) });
}

function enterHop(brain, body, from) {
  let away = from ? norm(sub(body, from)) : { x: 0, z: 0 };
  if (away.x === 0 && away.z === 0) away = { x: -Math.cos(body.heading), z: -Math.sin(body.heading) };
  enter(brain, 'alert', { hop: add(body, scale(away, HOP_DIST)), from: pt(from) }, HOP_TIME, RANK.hop);
}

// A steer point inside a hideout means "go in": its centre, with leave to enter it.
function steerTarget(p) {
  const h = insideHideout(p);
  return h ? { x: h.x, z: h.z, enter: h.id } : { x: p.x, z: p.z, enter: null };
}

function enterSeekLure(brain, c) {
  if (tier(c.trust) === 'shy') {
    enter(brain, 'seekLure', { leg: 'hesitate', via: pt(nearestHideout(c.body).entrance) }, LURE_HESITATE);
  } else {
    enter(brain, 'seekLure', { leg: 'direct' });
  }
}

function socialState(brain, c) {
  const p = c.pointer;
  if (!p) return null;
  if (brain.timers.still >= RIDE_HOLD - EPS) return 'ride'; // `still` only accrues when canRide
  if (p.speed >= SLOW_POINTER) return null;
  const d = dist(c.body, p);
  if (d >= ALERT_RADIUS) return null;
  return d < c.rp.approachRadius ? 'approach' : 'alert';
}

// Applies the priority list. Higher-priority triggers return early; the others are gated by rank.
function arbitrate(brain, c, poked) {
  const { body, pointer: p, rp } = c;
  if (c.moultDue && !HIDING.has(brain.state)) {
    if (!MOULTING.has(brain.state)) enter(brain, 'premoult', { spot: null, stall: 0 });
    return;
  }
  if (MOULTING.has(brain.state)) startWalk(brain);
  if (poked) {
    // Repeated pokes make it hide whatever the trust.
    if (c.trust < SHY_BELOW || brain.pokes.length >= POKE_STREAK) enterFlee(brain, body, p);
    else enterHop(brain, body, p);
    return;
  }
  if (c.mode === 'lure' && p && brain.rank > RANK.flee && p.speed > rp.startleSpeed && dist(body, p) < rp.fleeDist) {
    // How far it runs depends on trust: a shy spider runs to cover, others skitter a short way.
    if (c.trust < SHY_BELOW) enterFlee(brain, body, p);
    else enterSkitter(brain, body, p, rp.fleeDist);
    c.out.trustEvents.push({ type: 'swipe' });
    return;
  }
  if (c.mode === 'steer' && c.steer && brain.rank >= RANK.steered) {
    if (brain.state === 'steered') brain.data.target = c.steer;
    else enter(brain, 'steered', { target: c.steer });
    return;
  }
  if (brain.lure && brain.rank > RANK.seekLure) return enterSeekLure(brain, c);
  if (c.food.length && c.satiety < FULL && brain.rank > RANK.stalk) {
    return enter(brain, 'stalk', { foodId: nearest(c.food, body).id, crouched: false });
  }
  if (c.threads.length && brain.rank >= RANK.investigate) {
    return enter(brain, 'investigate', { target: pt(nearest(c.threads, body)) });
  }
  if (brain.rank >= RANK.alert && brain.state !== 'ride') {
    const s = socialState(brain, c);
    if (s) {
      if (s !== brain.state) enter(brain, s);
      return;
    }
    if (brain.rank === RANK.alert) startWalk(brain);
  }
  if (c.lightsJustChanged && brain.rank > RANK.lights) enter(brain, 'idle', {}, LIGHTS_IDLE, RANK.lights);
}

function social(c, look) {
  const d = dist(c.body, c.pointer);
  if (c.dt > 0) c.out.trustEvents.push({ type: 'gentle', dt: c.dt });
  return { look, frontLegsRaise: clamp(1 - d / ALERT_RADIUS, 0, 1) };
}

function pause(brain) {
  if (brain.timers.phase <= 0) startWalk(brain);
  return {};
}

// Each handler returns partial Intent fields; it may transition (the new state then runs too).
const HANDLERS = {
  wander(brain, c) {
    const data = brain.data;
    if (!data.target) {
      const a = brain.rng() * Math.PI * 2;
      const r = span(brain.rng, WANDER_REACH);
      data.target = clampWalkable({ x: c.body.x + Math.cos(a) * r, z: c.body.z + Math.sin(a) * r }, null, BODY_CLEARANCE);
    }
    if (brain.timers.phase <= 0 || dist(c.body, data.target) < ARRIVED) return startPause(brain);
    return { target: data.target, maxSpeed: WANDER_SPEED };
  },
  idle: pause,
  groom: pause,
  // Walks to (or turns to face) a pose where the body and its cast fit, stops, then moults.
  premoult(brain, c) {
    const b = c.body;
    if (Math.abs(b.speed) < STOPPED && Math.abs(b.turn ?? 0) < STOPPED && moultFits(b)) return enter(brain, 'moult');
    if (moultFits(b, MOULT_MARGIN)) return {}; // room enough: come to a stop here
    const data = brain.data;
    if (!data.spot || brain.timers.state >= PREMOULT_MAX || data.stall >= FACE_STALL) {
      data.spot = moultSpot(b, MOULT_MARGIN);
      data.stall = 0;
      brain.timers.state = 0;
    }
    if (!data.spot) return {};
    if (dist(b, data.spot) > SPOT_REACHED) return { target: data.spot, maxSpeed: WANDER_SPEED };
    data.stall = Math.abs(b.turn ?? 0) < STOPPED ? data.stall + c.dt : 0;
    return { face: data.spot.heading };
  },
  moult() {
    return {};
  },
  alert(brain, c) {
    const { hop, from } = brain.data;
    if (hop) {
      if (brain.timers.phase <= 0) return startWalk(brain);
      return { target: hop, maxSpeed: HOP_SPEED, look: from };
    }
    if (!c.pointer) return startWalk(brain);
    // Target with zero speed: turn on the spot to face the pointer.
    return { ...social(c, c.pointer), target: c.pointer, maxSpeed: 0 };
  },
  approach(brain, c) {
    const p = c.pointer;
    if (!p) return startWalk(brain);
    const d = dist(c.body, p);
    const move =
      d > APPROACH_GAP
        ? { target: sub(p, scale(norm(sub(p, c.body)), APPROACH_GAP)), maxSpeed: APPROACH_SPEED }
        : { target: p, maxSpeed: 0 };
    return { ...social(c, p), ...move };
  },
  // It walks under the pointer at a walking pace (no lunge), then climbs on and is carried.
  ride(brain, c) {
    const p = c.pointer;
    if (!p || p.speed > RIDE_RELEASE) return startWalk(brain);
    if (!brain.data.mounted && dist(c.body, p) < RIDE_MOUNT) brain.data.mounted = true;
    const mounted = !!brain.data.mounted;
    return { target: p, maxSpeed: mounted ? RIDE_SPEED : WANDER_SPEED, look: p, mounted };
  },
  flee(brain, c) {
    const { to } = brain.data;
    if (to) {
      if (dist(c.body, to) < ARRIVED || brain.timers.state >= SKITTER_MAX) return startPause(brain);
      return { target: to, maxSpeed: FLEE_SPEED };
    }
    const h = hideout(brain.data.hideoutId);
    if (dist(c.body, h.entrance) < ENTRANCE_REACHED || brain.timers.state >= FLEE_MAX) {
      return enter(brain, 'hide', { hideoutId: h.id }, c.rp.peekDelay);
    }
    return { target: h.entrance, maxSpeed: FLEE_SPEED };
  },
  hide(brain) {
    const h = hideout(brain.data.hideoutId);
    if (brain.timers.phase <= 0) return enter(brain, 'peek', { hideoutId: h.id }, PEEK_TIME);
    return { target: h, maxSpeed: HIDE_SPEED, allowEnter: h.id };
  },
  peek(brain) {
    const h = hideout(brain.data.hideoutId);
    if (brain.timers.phase <= 0) return startWalk(brain);
    const out = add(h, scale(norm(sub(h.entrance, h)), h.r * PEEK_DEPTH));
    return { target: out, maxSpeed: PEEK_SPEED, allowEnter: h.id, look: h.entrance };
  },
  steered(brain, c) {
    const target = brain.data.target;
    if (c.mode !== 'steer' || dist(c.body, target) < ARRIVED) return startPause(brain);
    const paused = c.trust < SHY_BELOW && (brain.timers.cycle + EPS) % (STEER_WALK + STEER_PAUSE) >= STEER_WALK;
    return { target, maxSpeed: paused ? 0 : lerp(0.6, 1.4, c.trust / 100), allowEnter: target.enter };
  },
  seekLure(brain, c) {
    const lure = brain.lure;
    const data = brain.data;
    if (!lure) return startWalk(brain);
    if (data.leg === 'hesitate') {
      if (brain.timers.phase > 0) return { look: lure };
      data.leg = 'via';
    }
    if (data.leg === 'via') {
      if (dist(c.body, data.via) >= ENTRANCE_REACHED) return { target: data.via, maxSpeed: LURE_SPEED, look: data.via };
      data.leg = 'direct';
    }
    const boost = tier(c.trust) === 'bonded' ? BONDED_LURE_BOOST : 1;
    return { target: lure, maxSpeed: LURE_SPEED * boost, look: lure };
  },
  stalk(brain, c) {
    const data = brain.data;
    const f = c.food.find((q) => q.id === data.foodId);
    if (!f || c.satiety >= FULL) return startWalk(brain);
    if (!data.crouched && dist(c.body, f) <= STALK_DIST) {
      data.crouched = true;
      brain.timers.phase = STALK_PAUSE;
    }
    if (!data.crouched) return { target: f, maxSpeed: STALK_SPEED, look: f };
    if (brain.timers.phase <= 0) return enter(brain, 'pounce', { foodId: f.id }, POUNCE_TIME);
    return { target: f, maxSpeed: 0, look: f };
  },
  pounce(brain, c) {
    const f = c.food.find((q) => q.id === brain.data.foodId);
    if (!f) return startWalk(brain);
    if (brain.timers.phase <= 0) {
      c.out.eatFoodId = f.id;
      c.out.trustEvents.push({ type: 'feed' });
      return enter(brain, 'eat', { at: pt(f) }, EAT_TIME);
    }
    return { target: f, maxSpeed: POUNCE_SPEED, look: f };
  },
  eat(brain) {
    if (brain.timers.phase <= 0) return startWalk(brain);
    return { look: brain.data.at };
  },
  investigate(brain, c) {
    const target = brain.data.target;
    if (dist(c.body, target) < ARRIVED || brain.timers.state >= INVESTIGATE_MAX) return startPause(brain);
    return { target, maxSpeed: INVESTIGATE_SPEED, look: target };
  },
};

export function createBrain({ seed } = {}) {
  const brain = {
    state: 'wander',
    rank: RANK.wander,
    timers: { state: 0, phase: 0, still: 0, cycle: 0 },
    data: {},
    lure: null,
    pokes: [],
    rng: mulberry32(seed ?? DEFAULT_SEED),
  };
  startWalk(brain);
  return brain;
}

// Reads ctx.events: records pokes (emitting their trust events), the held lure, and this tick's steer point.
function ingest(brain, c) {
  let poked = false;
  brain.pokes = brain.pokes.filter((t) => c.now - t < POKE_WINDOW);
  for (const e of c.events) {
    if (e.type === 'poke') {
      poked = true;
      brain.pokes.push(c.now);
      c.out.trustEvents.push({ type: 'poke', recentPokes: brain.pokes.length });
    } else if (e.type === 'lure') {
      brain.lure = e.held ? pt(e) : null;
    } else if (e.type === 'steer') {
      c.steer = steerTarget(e);
    } else if (e.type === 'steerKeys') {
      c.steer = { x: c.body.x + e.dx * STEER_KEY_REACH, z: c.body.z + e.dz * STEER_KEY_REACH, enter: null };
    }
  }
  return poked;
}

export function tickBrain(brain, ctx, dtIn) {
  const dt = Number.isFinite(dtIn) ? clamp(dtIn, 0, MAX_DT) : 0;
  const c = {
    ...ctx,
    events: ctx.events ?? [],
    food: ctx.food ?? [],
    threads: ctx.threads ?? [],
    now: ctx.now ?? 0,
    dt,
    rp: reactionParams(ctx.trust),
    steer: null,
    out: { eatFoodId: null, trustEvents: [] },
  };
  const t = brain.timers;
  t.state += dt;
  t.phase -= dt;
  if (brain.state === 'steered') t.cycle += dt;
  const p = c.pointer;
  const still = p && c.rp.canRide && p.speed < STILL_POINTER && dist(c.body, p) < RIDE_RADIUS;
  t.still = still ? t.still + dt : 0;

  const poked = ingest(brain, c);
  arbitrate(brain, c, poked);

  let res = {};
  for (let i = 0; i < 4; i++) {
    const data = brain.data;
    res = HANDLERS[brain.state](brain, c) ?? {};
    if (brain.data === data) break; // no transition: this state's output stands
  }

  const intent = {
    state: brain.state,
    target: pt(res.target),
    face: Number.isFinite(res.face) ? res.face : null,
    maxSpeed: res.maxSpeed ?? 0,
    allowEnter: res.allowEnter ?? null,
    look: pt(res.look),
    frontLegsRaise: res.frontLegsRaise ?? 0,
    mounted: res.mounted === true, // riding on the pointer (lifted off the deck)
    twitch: poked,
    eatFoodId: c.out.eatFoodId,
    trustEvents: c.out.trustEvents,
  };
  // Never let the caller's walkable clamp eject a body that is still (even partly) in a hideout.
  if (!intent.allowEnter) intent.allowEnter = capsuleHideout(c.body)?.id ?? null;
  return intent;
}
