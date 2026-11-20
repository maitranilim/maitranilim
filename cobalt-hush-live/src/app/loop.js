// One simulation tick: brain -> body -> gait -> food, silk, moult clock, then the brain's side
// effects (trust events, eating, moult completion) applied to the saved State. Pure: no DOM, no three.
import { clamp } from '../core/math.js';
import { DIGEST_SECONDS } from '../core/state.js';
import { MAX_DT, createBrain, tickBrain } from '../sim/brain.js';
import { createBody, stepBody } from '../sim/locomotion.js';
import { createGait, stepGait } from '../sim/gait.js';
import { createFood, removeFood, stepFood } from '../sim/food.js';
import { createSilk, stepSilk } from '../sim/silk.js';
import { castPose, completeMoult, isMoultDue, moultPhase, tickMoultClock } from '../sim/moult.js';
import { applyTrust } from '../sim/trust.js';

export const SWIPE_COOLDOWN = 1.5; // seconds between swipe trust penalties
const FULL = 3;
const EAT_PULSE_HZ = 2 / 3; // two gentle pulses over the 3 s meal, ending at rest
const BODY_OPTS = { accel: 6, turnRate: 5, arriveRadius: 0.25 };
const START = { x: 0, z: 0, heading: -0.4 };

export function createSim({ seed = 1, mats = {} } = {}) {
  const body = createBody(START.x, START.z, START.heading);
  return {
    seed,
    now: 0, // sim clock, seconds
    body,
    gait: createGait(body),
    brain: createBrain({ seed }),
    food: createFood({ seed }),
    silk: createSilk(mats, { seed }),
    lastSwipe: -Infinity,
    moultT: null, // seconds since the brain entered 'moult'
  };
}

// Places the spider (planted, at rest) with a fresh brain and no food. Silk and the clock stay.
export function resetSim(sim, { x = START.x, z = START.z, heading = START.heading } = {}) {
  sim.body = createBody(x, z, heading);
  sim.gait = createGait(sim.body);
  sim.brain = createBrain({ seed: sim.seed });
  sim.food.items = [];
  sim.moultT = null;
}

export function applyTrustEvents(sim, state, events) {
  let s = state;
  for (const e of events) {
    if (e.type === 'swipe') {
      if (sim.now - sim.lastSwipe < SWIPE_COOLDOWN) continue;
      sim.lastSwipe = sim.now;
    }
    s = applyTrust(s, e);
  }
  return s;
}

// input: { events, threads, pointer, mode, lightsJustChanged, active, epochMs }.
// Returns { state, intent, moult, moulted, ate, eatPulse }.
export function tickSim(sim, state, input, dtIn) {
  const dt = Number.isFinite(dtIn) ? clamp(dtIn, 0, MAX_DT) : 0;
  sim.now += dt;
  const { body } = sim;
  const intent = tickBrain(
    sim.brain,
    {
      body,
      trust: state.trust,
      satiety: state.satiety,
      mode: input.mode,
      pointer: input.pointer ?? null,
      events: input.events ?? [],
      // The walkable drop point, not the fluttering mote.
      food: sim.food.items.map((it) => ({ id: it.id, x: it.home.x, z: it.home.z })),
      threads: input.threads ?? [],
      lightsJustChanged: !!input.lightsJustChanged,
      moultDue: isMoultDue(state),
      now: sim.now,
    },
    dt,
  );
  stepBody(body, intent.target, { ...BODY_OPTS, maxSpeed: intent.maxSpeed, allowEnter: intent.allowEnter, face: intent.face }, dt);
  stepGait(sim.gait, body, dt);
  stepFood(sim.food, dt);
  stepSilk(sim.silk, body, intent.state, dt);
  let s = tickMoultClock(state, dt, !!input.active);

  s = applyTrustEvents(sim, s, intent.trustEvents);
  const ate = !!intent.eatFoodId;
  if (ate) removeFood(sim.food, intent.eatFoodId);
  const satiety = clamp(s.satiety + (ate ? 1 : 0) - dt / DIGEST_SECONDS, 0, FULL);
  s = { ...s, satiety, mats: { ...sim.silk.mats } };

  sim.moultT = intent.state === 'moult' ? (sim.moultT ?? 0) + dt : null;
  let moult = sim.moultT === null ? null : moultPhase(sim.moultT);
  let moulted = false;
  if (moult?.phase === 'done') {
    s = completeMoult(s, castPose(body), input.epochMs);
    sim.moultT = null;
    moult = null;
    moulted = true;
  }

  const eatPulse = intent.state === 'eat' ? 0.5 * (1 - Math.cos(2 * Math.PI * EAT_PULSE_HZ * sim.brain.timers.state)) : 0;
  return { state: s, intent, moult, moulted, ate, eatPulse };
}
