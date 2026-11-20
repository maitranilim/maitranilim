import { Vector3 } from 'three';
import { createStage, startTier } from './render/scene.js';
import { createDeck } from './render/deckMesh.js';
import { createSpider } from './render/spiderMesh.js';
import { createMist, MIST_COUNTS } from './render/mist.js';
import { createFx } from './render/fx.js';
import { HIP_HEIGHT, SPIDER_SCALE } from './sim/gait.js';
import { dropFood } from './sim/food.js';
import { createSilk } from './sim/silk.js';
import { castPose, completeMoult, deckShells } from './sim/moult.js';
import { createGestures } from './input/pointer.js';
import { createUI, showNotice } from './ui/ui.js';
import { defaultState } from './core/state.js';
import { clamp, damp, lerp } from './core/math.js';
import { createSim, resetSim, tickSim } from './app/loop.js';
import { attachInput, createPointerTracker, feedAhead, keyEvents, routeGestures } from './app/inputBridge.js';
import { createPersistence, mergeLoaded, peekSettings } from './app/persistence.js';

const params = new URLSearchParams(location.search);
const testMode = params.has('test');
const seedParam = Number.parseInt(params.get('seed'), 10);
const seed = Number.isFinite(seedParam) ? seedParam : Date.now();
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;

const MAX_DT = 0.05;
const IDLE_MS = 60_000; // the moult clock only runs with input in the last minute
const LIGHTS_FADE = 1.5;
const RIDE_LIFT = 0.35 * SPIDER_SCALE;
const RIDE_FOLLOW = 2.5; // 1/s: how gently the lifted spider eases onto the pointer
const QUALITY_KEY = 'cobalt-hush-live:quality';
const NO_WEBGL = 'Cobalt Hush needs WebGL to run. Try another browser or device.';

function safeLocal() {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

// The quality tier this device stepped down to on an earlier visit, so a slow phone starts there.
function rememberedTier() {
  try {
    return safeLocal()?.getItem(QUALITY_KEY) ?? null;
  } catch {
    return null;
  }
}
function rememberTier(q) {
  try {
    safeLocal()?.setItem(QUALITY_KEY, q);
  } catch { /* not remembered: the page runs fully without storage */ }
}

// Storage starts first so it can answer while the scene builds. The local copy's settings are
// read at once, so even the first frame shows the saved lights and material.
const persist = createPersistence({ claudeUse: window.claude?.use?.bind(window.claude), localStorage: safeLocal() });
const hinted = peekSettings(safeLocal());

const canvas = document.getElementById('stage');
const uiRoot = document.getElementById('ui');
const pin = testMode ? params.get('quality') : null; // test-only: ?quality=high shoots the real look
let stage = null;
try {
  stage = createStage(canvas, {
    reducedMotion,
    preserveDrawingBuffer: testMode,
    pinQuality: pin,
    startQuality: startTier({ pin, remembered: rememberedTier(), coarse: coarsePointer }),
  });
} catch {
  showNotice(uiRoot, NO_WEBGL); // no WebGL: a calm note instead of a blank page
  document.documentElement.classList.remove('booting');
}
if (stage) live(stage);

// The live terrarium: scene, sim, input, UI and saving, on a working WebGL stage.
async function live(stage) {
  createDeck(stage.scene);
  const spider = createSpider(stage.scene, { shade: 0 });
  const mist = createMist(stage.scene, stage.quality, { reducedMotion });
  stage.onQualityChange((q) => {
    mist.setCount(MIST_COUNTS[q]);
    rememberTier(q);
  });
  // The tier this visit starts at counts as reached too, so a recovered tier keeps climbing (R28).
  if (stage.quality !== pin) rememberTier(stage.quality);
  const fx = createFx(stage);

  // What play starts from until storage answers: the defaults, in the saved settings if known.
  const base = { ...defaultState(Date.now()), ...(hinted ? { settings: hinted } : {}) };
  let state = base;
  const sim = createSim({ seed, mats: state.mats });
  const gestures = createGestures();
  const tracker = createPointerTracker();
  let lastInput = -Infinity;
  const input = attachInput(canvas, gestures, { onInput: () => { lastInput = performance.now(); } });
  let feedArmed = false;
  let lightsChanged = false;
  let pending = []; // brain events raised outside the frame (mode switches)

  const ui = createUI(uiRoot, {
    state,
    onLights: (v) => setLightsSetting(v),
    onFeedArm: (armed) => { feedArmed = armed; },
    // Enter or Space on the armed Feed button: food lands just in front of the spider.
    onFeedKey: () => {
      feedArmed = false;
      dropFood(sim.food, feedAhead(sim.body), sim.now);
    },
    onMaterial: (m) => {
      spider.setMaterial(m);
      setSettings({ material: m });
    },
    onMove: (m) => {
      if (m === 'steer') pending.push({ type: 'lure', held: false }); // a lure never outlives Lure mode
      setSettings({ move: m });
    },
  });

  function setSettings(patch) {
    state = { ...state, settings: { ...state.settings, ...patch } };
  }

  // Lights: 'on' | 'off', faded through stage/spider/UI night over 1.5 s.
  const lights = { value: 0, from: 0, to: 0, t: LIGHTS_FADE };
  function setLights(v, { fade = true } = {}) {
    lights.from = lights.value;
    lights.to = v === 'off' ? 1 : 0;
    lights.t = fade ? 0 : LIGHTS_FADE;
    if (!fade) applyNight(lights.to);
  }
  let pageIsNight = document.documentElement.classList.contains('night'); // set by index.html
  function applyNight(v) {
    lights.value = v;
    stage.setNight(v);
    spider.setNight(v);
    ui.setNight(v);
    // The page behind the canvas follows, so nothing flashes white while the canvas is hidden.
    if (pageIsNight !== v > 0.5) {
      pageIsNight = v > 0.5;
      document.documentElement.classList.toggle('night', pageIsNight);
    }
  }
  function stepLights(dt) {
    if (lights.t >= LIGHTS_FADE) return;
    lights.t = Math.min(LIGHTS_FADE, lights.t + dt);
    const k = clamp(lights.t / LIGHTS_FADE, 0, 1);
    applyNight(lerp(lights.from, lights.to, k * k * (3 - 2 * k)));
  }
  function setLightsSetting(v) {
    setSettings({ lights: v });
    setLights(v);
    lightsChanged = true; // the brain sees it for exactly one tick
  }

  // Shows a (loaded or merged) State: shade, material, lights, toolbar, moults, silk mats.
  function adopt(next, { fade }) {
    state = next;
    spider.setShade(state.shadeIndex);
    spider.setMaterial(state.settings.material);
    if ((lights.to === 1) !== (state.settings.lights === 'off')) setLights(state.settings.lights, { fade });
    ui.setSettings(state.settings);
    ui.setMoults(state.moults);
    ui.setTrust(state.trust);
    sim.silk = createSilk(state.mats, { seed });
    persist.begin(state);
  }

  window.addEventListener('resize', () => stage.resize());
  window.addEventListener('orientationchange', () => stage.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist.flush(state);
  });
  window.addEventListener('pagehide', () => persist.flush(state));

  // ---- frame ----
  let paused = false; // test-only
  let simSpeed = 1; // test-only: sim ticks per rendered frame (swiftshader renders ~1-2 fps)
  let stopAt = null; // test-only: pause once the sim clock reaches this (seconds)
  let debugPose = null; // test-only override: { moult } | { eatPulse }
  let closeup = false; // test-only camera
  let out = null; // last tick's result
  let rideK = 0;
  const rideAt = { x: 0, z: 0 };
  let time = 0;
  let last = performance.now();

  function frame(nowMs) {
    const wallDt = Math.max(0, (nowMs - last) / 1000);
    last = nowMs;
    const dt = Math.min(wallDt, MAX_DT);
    stepLights(wallDt);

    const { pointer: hover, gestures: list } = gestures.frame(nowMs);
    const pointer = tracker.update(hover ? stage.groundPoint(hover.clientX, hover.clientY) : null, nowMs, input.down);
    if (!paused) {
      const routed = routeGestures(list, {
        toWorld: (g) => stage.groundPoint(g.clientX, g.clientY),
        mode: state.settings.move,
        feedArmed,
        body: sim.body,
        silk: sim.silk,
        food: sim.food,
        now: sim.now,
      });
      if (routed.fed) {
        feedArmed = false;
        ui.setFeedArmed(false);
      }
      const events = [...pending, ...routed.events, ...keyEvents(gestures.keyVector(), state.settings.move, stage.yaw)];
      pending = [];
      const active = document.visibilityState === 'visible' && nowMs - lastInput < IDLE_MS;
      for (let i = 0; i < simSpeed; i++) {
        if (stopAt !== null && sim.now >= stopAt - 1e-9) {
          paused = true;
          stopAt = null;
          break;
        }
        const first = i === 0;
        out = tickSim(sim, state, {
          events: first ? events : [],
          threads: first ? routed.threads : [], // a ripple is felt on the tap tick only
          pointer,
          mode: state.settings.move,
          lightsJustChanged: first && lightsChanged,
          active,
          epochMs: Date.now(),
        }, dt);
        state = out.state;
        if (out.moulted) {
          spider.setShade(state.shadeIndex);
          ui.setMoults(state.moults);
        }
      }
      lightsChanged = false;
      time += dt * simSpeed;
    }

    const { body } = sim;
    spider.pose({
      body,
      gait: sim.gait,
      intent: paused ? null : out?.intent ?? null,
      moult: debugPose?.moult ?? out?.moult ?? null,
      time,
      eatPulse: debugPose?.eatPulse ?? out?.eatPulse ?? 0,
    });
    // Riding: once the body is under the pointer the spider climbs on, raised off the deck.
    const riding = !paused && out?.intent.mounted && pointer;
    if (riding) Object.assign(rideAt, { x: pointer.x, z: pointer.z });
    rideK = damp(rideK, riding ? 1 : 0, RIDE_FOLLOW, dt);
    if (rideK > 1e-3) spider.group.position.set(lerp(body.x, rideAt.x, rideK), RIDE_LIFT * rideK, lerp(body.z, rideAt.z, rideK));

    mist.update(body, lights.value, dt);
    fx.update({ silk: sim.silk, food: sim.food, shells: deckShells(state), lure: sim.brain.lure, night: lights.value, dt });
    if (closeup) frameCloseup();
    stage.render(wallDt);
    ui.setTrust(state.trust);
    persist.save(state);
    requestAnimationFrame(frame);
  }

  // Test-only: frames the spider closely ('closeup') or restores the overview ('default').
  stage.onQualityChange(() => {
    if (closeup) frameCloseup();
  });
  function debugCamera(view) {
    closeup = view === 'closeup';
    if (!closeup) stage.resize();
  }
  function frameCloseup() {
    const { body } = sim;
    const k = SPIDER_SCALE;
    const cx = body.x - 0.3 * k * Math.cos(body.heading);
    const cz = body.z - 0.3 * k * Math.sin(body.heading);
    stage.camera.position.set(cx - 0.9 * k, 3.0 * k, cz + 3.1 * k);
    stage.camera.lookAt(cx, 0.22 * k, cz);
  }

  const projected = new Vector3();
  function worldToScreen(x, z, y = 0) {
    projected.set(x, y, z).project(stage.camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((projected.x + 1) / 2) * r.width, y: r.top + ((1 - projected.y) / 2) * r.height };
  }

  // ---- boot ----
  // The page stays hidden (html.booting) until storage answers or 1.5 s pass, so a returning night
  // visitor never sees a day frame. Meanwhile one hidden render warms the shaders up.
  spider.setMaterial(state.settings.material);
  setLights(state.settings.lights, { fade: false });
  spider.pose({ body: sim.body, gait: sim.gait, time });
  mist.update(sim.body, lights.value, 0);
  stage.render(0);

  const early = await persist.boot(); // waits at most 1.5 s
  if (early) adopt(early, { fade: false });
  else {
    persist.loaded.then((loaded) => adopt(mergeLoaded(state, base, loaded), { fade: true }));
  }
  mist.update(sim.body, lights.value, 0);
  stage.render(0); // the first visible frame, in the saved lights and material
  const revealNight = lights.value; // test-only readout
  document.documentElement.classList.remove('booting');
  ui.showIntro();

  window.__hush = { ready: true, spider, setMaterial: (m) => spider.setMaterial(m) };
  if (testMode) {
    Object.assign(window.__hush, {
      setLights: (v) => {
        ui.setSettings({ lights: v }); // as if the Lights button were pressed
        setLightsSetting(v);
      },
      uiSetNight: (v) => ui.setNight(v),
      uiOpenMoults: () => document.querySelector('.hush-btn.moults').click(),
      debugCamera,
      debugPose: (o) => {
        debugPose = o;
      },
      dropFood: (x, z) => dropFood(sim.food, { x, z }, sim.now),
      counts: () => ({
        food: fx.counts().food,
        tripwires: Object.values(sim.silk.tripwires).reduce((n, w) => n + w.length, 0),
        shells: fx.counts().shells,
        draglines: sim.silk.draglines.length,
      }),
      debugSilk: () => {
        sim.silk = createSilk({ bark: 1 }, { seed }); // a full mat at the bark hideout
      },
      debugMoult: () => {
        state = completeMoult(state, castPose(sim.body), Date.now() + state.moults.length);
        spider.setShade(state.shadeIndex);
        ui.setMoults(state.moults);
      },
      pause: (on) => {
        paused = !!on;
        stopAt = null;
      },
      pauseAt: (t) => {
        stopAt = t;
      },
      paused: () => paused,
      simSpeed: (n) => {
        simSpeed = clamp(Math.round(n) || 1, 1, 40);
      },
      resetSim: (x, z, heading) => resetSim(sim, { x, z, heading }),
      simTime: () => sim.now,
      body: () => ({ x: sim.body.x, z: sim.body.z, heading: sim.body.heading }),
      brainState: () => sim.brain.state,
      state: () => structuredClone(state),
      setTrust: (t) => {
        state = { ...state, trust: t, peakTrust: Math.max(state.peakTrust, t) };
      },
      spiderScreen: () => worldToScreen(sim.body.x, sim.body.z, HIP_HEIGHT),
      worldToScreen: (x, z) => worldToScreen(x, z),
      storageKind: () => persist.kind,
      revealNight: () => revealNight,
      quality: () => stage.quality,
      cameraAspect: () => stage.camera.aspect,
    });
  }
  last = performance.now();
  requestAnimationFrame(frame);
}
