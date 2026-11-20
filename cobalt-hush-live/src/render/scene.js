import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { lerp } from '../core/math.js';
import { DECK_THICKNESS } from './deckMesh.js';

const FOV = 35;
const ELEVATION = THREE.MathUtils.degToRad(55);
const DECK_HALF = { x: 8, z: 5 };
const DECK_FILL = 0.92; // fraction of the viewport the deck may span, in both directions

const TIERS = ['high', 'medium', 'low'];
// Each tier caps the device pixel ratio, so a step down never renders more pixels. `samples` is
// the MSAA of the scene buffer; `transmission` the resolution scale of the glass transmission pass.
export const TIER_SETTINGS = {
  high: { maxPixelRatio: 2, shadowMap: 2048, bloomScale: 1, samples: 4, transmission: 1 },
  medium: { maxPixelRatio: 1.5, shadowMap: 1024, bloomScale: 0.5, samples: 4, transmission: 1 },
  low: { maxPixelRatio: 1, shadowMap: 0, bloomScale: 0.5, samples: 0, transmission: 0.5 },
};
export const tierPixelRatio = (tier, dpr) => Math.min(dpr || 1, TIER_SETTINGS[tier].maxPixelRatio);

// The tier to start at (R28): a (test-only) pin wins. Otherwise one tier above the tier remembered
// from the last visit (high stays high), so a single slow moment can't pin a device low for good;
// the frame-time step-down finds the right level again. Phones (coarse pointer) start no higher
// than medium.
export function startTier({ pin = null, remembered = null, coarse = false } = {}) {
  if (TIERS.includes(pin)) return pin;
  const above = TIERS.includes(remembered) ? Math.max(0, TIERS.indexOf(remembered) - 1) : 0;
  return TIERS[Math.max(above, coarse ? TIERS.indexOf('medium') : 0)];
}
const FRAME_WINDOW = 2; // seconds
const SLOW_FRAME = 0.022; // seconds
const MAX_COUNTED_FRAME = 0.25; // longer frames count as this long, so a tab sleep can't swamp a window

// The scene renders into the HDR buffer at 1/EXPOSURE of its display level, so day whites stay
// under the 0.85 bloom threshold and only real glow blooms; OutputPass scales back up.
const BEAM_ANGLE = 0.32; // radians: a pool roughly the spider's size plus a margin
const BEAM_HEIGHT = 9;
const FOLLOW_LEAN = 0.16; // fraction of the spider's offset the view shifts toward it
const FOLLOW_ZOOM = 0.97; // a touch closer than the whole-deck fit
const FOLLOW_EASE = 1.6; // 1/s: slow, so the camera drifts rather than tracks
const EXPOSURE = 1.25;
// Neutral tone mapping compresses near-white; this lift puts the deck and backdrop back at white.
const NEUTRAL_LIFT = 1.3;
const buffered = (hex) => new THREE.Color(hex).multiplyScalar(1 / EXPOSURE);

const DAY = {
  background: buffered('#F7F8FB'),
  deck: new THREE.Color('#FFFFFF'),
  deckGlow: new THREE.Color('#000000'),
  hemi: 1.2,
  sun: 1.5,
  sunColor: new THREE.Color('#FFFFFF'),
  ambient: 0,
  bloomStrength: 0.25,
  bloomThreshold: 0.85,
  skyColor: new THREE.Color('#FFFFFF'),
  groundColor: new THREE.Color('#B9C2D6'),
  beam: 0.12, // a whisper of key light by day: more would push the cobalt into tone-mapped white
  beamColor: new THREE.Color('#FFFFFF'),
};
const NIGHT = {
  background: buffered('#080A16'),
  deck: new THREE.Color('#1C2034'),
  deckGlow: buffered('#0B0E1E'), // emissive, so the slab reads deep navy, not void (greyed: Neutral tone mapping crushes dark red/green)
  hemi: 0.14, // a cool night sky, so forms read without flattening the dark
  sun: 0.16, // the moon: soft blue light and shadows across the whole deck
  sunColor: new THREE.Color('#8FA8FF'),
  ambient: 0.05,
  bloomStrength: 1.1,
  bloomThreshold: 0.1,
  skyColor: new THREE.Color('#5D73B8'),
  groundColor: new THREE.Color('#0B1028'),
  beam: 3, // the moonbeam: a pool of cool light that follows the spider and shows its whole body
  beamColor: new THREE.Color('#A9C2FF'),
};

// The stage starts at `startQuality` (see startTier) and steps down from there on slow frames.
// `pinQuality` (test-only) fixes the tier: no frame-time step-down.
export function createStage(canvas, { reducedMotion = false, preserveDrawingBuffer = false, pinQuality = null, startQuality = 'high' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Khronos PBR Neutral: base colours stay true, but bright highlights roll off softly instead of
  // clipping to flat white streaks.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = EXPOSURE * NEUTRAL_LIFT;
  renderer.shadowMap.enabled = true;
  // r0.187 removed PCFSoftShadowMap; PCF with a sampling radius is its soft replacement.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = DAY.background.clone();

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200);

  const hemi = new THREE.HemisphereLight('#FFFFFF', '#B9C2D6', DAY.hemi);
  const sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sun);
  sun.position.set(-5, 12, -4);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 30 });
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const ambient = new THREE.AmbientLight('#8FB0FF', DAY.ambient);
  // A soft spotlight that tracks the spider: barely there by day, a moonbeam by night.
  const beam = new THREE.SpotLight(DAY.beamColor, DAY.beam, 0, BEAM_ANGLE, 0.85, 0);
  beam.position.set(-1.5, BEAM_HEIGHT, 1.2);
  scene.add(hemi, sun, sun.target, ambient, beam, beam.target);
  const focus = new THREE.Vector3(); // eased spider position the beam and the camera lean toward
  const base = new THREE.Vector3(); // the camera's whole-deck position from fitCamera

  let quality = TIERS.includes(pinQuality) ? pinQuality : TIERS.includes(startQuality) ? startQuality : 'high';
  const pinned = quality === pinQuality;
  const qualityListeners = [];
  let deckMaterial = null; // found by name once createDeck has added the 'deck' mesh

  // The HDR scene buffer; resize() sizes it.
  const sceneTarget = (samples) => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, sceneTarget(TIER_SETTINGS[quality].samples));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), DAY.bloomStrength, 0.4, DAY.bloomThreshold);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function applyQuality() {
    const s = TIER_SETTINGS[quality];
    renderer.setPixelRatio(tierPixelRatio(quality, window.devicePixelRatio));
    composer.setPixelRatio(renderer.getPixelRatio());
    renderer.transmissionResolutionScale = s.transmission;
    if (composer.renderTarget1.samples !== s.samples) composer.reset(sceneTarget(s.samples));
    sun.castShadow = s.shadowMap > 0;
    const resized = s.shadowMap > 0 && sun.shadow.mapSize.x !== s.shadowMap;
    if (resized) sun.shadow.mapSize.set(s.shadowMap, s.shadowMap);
    if (resized || !sun.castShadow) {
      sun.shadow.map?.dispose(); // free the old map; three reallocates it at the new size if needed
      sun.shadow.map = null;
    }
    resize();
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    const pr = renderer.getPixelRatio();
    const k = TIER_SETTINGS[quality].bloomScale;
    bloom.setSize(Math.round(w * pr * k), Math.round(h * pr * k));
    fitCamera(camera, w / h);
    base.copy(camera.position);
    placeCamera();
  }

  // Gentle follow: the camera keeps the whole deck in view but leans a little toward the spider
  // and eases in slightly. Off under reduced motion.
  function placeCamera() {
    if (reducedMotion) return;
    camera.position.copy(base).multiplyScalar(FOLLOW_ZOOM);
    camera.position.x += focus.x * FOLLOW_LEAN;
    camera.position.z += focus.z * FOLLOW_LEAN;
    camera.lookAt(focus.x * FOLLOW_LEAN, 0, focus.z * FOLLOW_LEAN);
    camera.updateMatrixWorld();
  }
  function follow(x, z, dt, { snap = false } = {}) {
    const k = snap ? 1 : 1 - Math.exp(-FOLLOW_EASE * dt);
    focus.x += (x - focus.x) * k;
    focus.z += (z - focus.z) * k;
    beam.position.set(focus.x - 1.5, BEAM_HEIGHT, focus.z + 1.2);
    beam.target.position.set(focus.x, 0, focus.z);
    beam.target.updateMatrixWorld();
    placeCamera();
  }

  function setNight(v) {
    const night = THREE.MathUtils.clamp(v, 0, 1);
    scene.background.lerpColors(DAY.background, NIGHT.background, night);
    deckMaterial ??= scene.getObjectByName('deck')?.material ?? null;
    deckMaterial?.color.lerpColors(DAY.deck, NIGHT.deck, night);
    deckMaterial?.emissive.lerpColors(DAY.deckGlow, NIGHT.deckGlow, night);
    hemi.intensity = lerp(DAY.hemi, NIGHT.hemi, night);
    sun.intensity = lerp(DAY.sun, NIGHT.sun, night);
    sun.color.lerpColors(DAY.sunColor, NIGHT.sunColor, night);
    ambient.intensity = lerp(DAY.ambient, NIGHT.ambient, night);
    hemi.color.lerpColors(DAY.skyColor, NIGHT.skyColor, night);
    hemi.groundColor.lerpColors(DAY.groundColor, NIGHT.groundColor, night);
    beam.intensity = lerp(DAY.beam, NIGHT.beam, night);
    beam.color.lerpColors(DAY.beamColor, NIGHT.beamColor, night);
    renderer.toneMappingExposure = EXPOSURE * lerp(NEUTRAL_LIFT, 1, night); // the lift is for day whites only
    bloom.strength = lerp(DAY.bloomStrength, NIGHT.bloomStrength, night);
    bloom.threshold = lerp(DAY.bloomThreshold, NIGHT.bloomThreshold, night);
  }

  // Frame-time monitor: steps quality down (never up) when a 2 s window averages above 22 ms.
  // The first window is a warm-up (shader compiles), so it is not judged.
  let windowTime = 0;
  let windowFrames = 0;
  let warmedUp = false;
  function monitor(dt) {
    if (pinned || !(dt > 0)) return;
    windowTime += Math.min(dt, MAX_COUNTED_FRAME);
    windowFrames += 1;
    if (windowTime < FRAME_WINDOW) return;
    const slow = windowTime / windowFrames > SLOW_FRAME;
    windowTime = 0;
    windowFrames = 0;
    if (!warmedUp) {
      warmedUp = true;
      return;
    }
    const i = TIERS.indexOf(quality);
    if (slow && i < TIERS.length - 1) {
      quality = TIERS[i + 1];
      applyQuality();
      for (const cb of qualityListeners) cb(quality);
    }
  }

  function render(dt = 0) {
    monitor(dt);
    composer.render(dt);
  }

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  function groundPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  applyQuality();
  setNight(0);

  return {
    renderer,
    scene,
    camera,
    composer,
    bloom,
    reducedMotion,
    setNight,
    resize,
    render,
    groundPoint,
    follow,
    get quality() {
      return quality;
    },
    get yaw() {
      return cameraYaw(camera.aspect);
    },
    onQualityChange(cb) {
      qualityListeners.push(cb);
    },
  };
}

// On a portrait screen the view turns 90° about y, so the deck's long (x) axis runs up the screen
// instead of shrinking to a thin strip across it.
export const cameraYaw = (aspect) => (aspect < 1 ? Math.PI / 2 : 0);

// Distance along the 55° view direction at which the whole deck fits DECK_FILL of the viewport.
export function fitCamera(camera, aspect) {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const yaw = cameraYaw(aspect);
  const flat = Math.cos(ELEVATION);
  const dir = new THREE.Vector3(Math.sin(yaw) * flat, Math.sin(ELEVATION), Math.cos(yaw) * flat);
  const corners = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, -DECK_THICKNESS]) {
    corners.push(new THREE.Vector3(sx * DECK_HALF.x, y, sz * DECK_HALF.z));
  }
  const p = new THREE.Vector3();
  const fits = (d) => {
    camera.position.copy(dir).multiplyScalar(d);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return corners.every((c) => {
      p.copy(c).project(camera);
      return Math.abs(p.x) <= DECK_FILL && Math.abs(p.y) <= DECK_FILL;
    });
  };
  let lo = 5;
  let hi = 300;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  fits(hi);
}
