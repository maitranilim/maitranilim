import * as THREE from 'three';
import { LEGS, HIP_HEIGHT, SPIDER_SCALE, solveTwoBone, createGait } from '../sim/gait.js';
import { SHADES } from '../core/state.js';
import { clamp, damp, lerp } from '../core/math.js';
import { contactShadow, contactShadowTexture } from './deckMesh.js';
import {
  CEPH, ABDOMEN, GEM, LEG_RADII, LEG_BOW, PATELLA_LEN, TIBIA_SPLIT, METATARSUS_BEND, PALP,
  cephGeometry, abdomenGeometry, abdomenTop, gemGeometry, bezelGeometry, pavilionGeometry, gearGeometry,
  segmentGeometry, bandGeometry, hairLayout, hairGeometry, studioEnvironment, hushUniforms, patchHush, glowMaterial,
} from './spiderParts.js';

// Procedural glass tarantula. Mesh frame (see spiderParts.js): +x forward, +y up, +z right.
// root = yaw only (body x/z/heading); torso = body height, hop and moult roll; legs live in root space.
// The rig is modelled in design units and root is scaled by SPIDER_SCALE, so world-unit gait
// numbers are divided by it on the way in (DESIGN).
const DESIGN = 1 / SPIDER_SCALE;
const DESIGN_HIP = HIP_HEIGHT * DESIGN;

// Translucent is thin, cobalt-tinted glass (attenuated toward the body colour) so the interior
// (gears, spine, gem glow) shows through and the white deck behind reads blue, not pale; `inner`
// is its faint lit-from-within glow. `spec` is the base layer's specular: Solid keeps it low so
// the broad white sheen of the studio doesn't wash the cobalt to periwinkle; the clearcoat keeps
// its crisp streaks.
const MODES = {
  solid: { transmission: 0, thickness: 0, roughness: 0.35, clearcoat: 1, opacity: 1, rim: 0.3, rimAlpha: 0, lift: 0, inner: 0, shadow: true, tint: 1, spec: 0.3 },
  translucent: { transmission: 0.85, thickness: 0.25, roughness: 0.15, clearcoat: 1, opacity: 1, rim: 0.45, rimAlpha: 0, lift: 0.5, inner: 0.1, shadow: true, tint: 0.3, spec: 1 },
  ghost: { transmission: 0.95, thickness: 0, roughness: 0.15, clearcoat: 0.5, opacity: 0.22, rim: 1.1, rimAlpha: 0.55, lift: 0.6, inner: 0, shadow: false, tint: 0, spec: 1 },
};
const ABDOMEN_CLEARCOAT = 0.35; // a satin abdomen: softer, fewer mirror streaks than the legs
const SHEEN = { legs: 0.45, ceph: 0.3, abdomen: 0.6 };
const WHITE = new THREE.Color('#FFFFFF');
const BLACK = new THREE.Color('#000000');
// Per-part gradients from one shade: body colour dorsally to deep ventrally, dimmed so the lit
// result lands on the true cobalt rather than washing out to periwinkle. The cephalothorax is a
// touch lighter and the abdomen darker, as in the original illustration.
const DIM = 0.55;
function palettes(shade) {
  const c = (h) => new THREE.Color(h);
  const deep = c(shade.deep).multiplyScalar(0.8);
  const body = c(shade.body).multiplyScalar(DIM);
  return {
    legs: { deep, body, highlight: c(shade.highlight) },
    ceph: { deep: deep.clone(), body: c(shade.body).lerp(c(shade.highlight), 0.2).multiplyScalar(DIM), highlight: c(shade.highlight).lerp(WHITE, 0.3) },
    abdomen: { deep: deep.clone().lerp(BLACK, 0.4), body: body.clone().lerp(deep, 0.35), highlight: c(shade.highlight) },
  };
}
const PARTS = ['legs', 'ceph', 'abdomen'];
// Velvet sheen and fresnel rim lean from the pale highlight toward the body colour by the mode's
// `tint`: a pale (lavender) sheen over Solid washes the cobalt out, while glass wants pale edges.
const sheenColor = (shade, tint = 0) => new THREE.Color(shade.body).lerp(new THREE.Color(shade.highlight), 0.5 * (1 - tint));
const rimColor = (shade, tint = 0) => new THREE.Color(shade.highlight).lerp(new THREE.Color(shade.body), 0.5 * tint);
const AMBER = { deep: '#C96A12', body: '#FFB547', highlight: '#FFF2D6' };
const GLOW = '#3DF5FF';
const GLOW_COLOR = new THREE.Color(GLOW);
const GLOW_MAX = 2.2;
const HAIR_DAY = new THREE.Color();
const HAIR_NIGHT = new THREE.Color();
const PAVILION_DAY = new THREE.Color(0.2, 0.3, 0.55);
const PAVILION_NIGHT = new THREE.Color(0.36, 0.36, 0.36);
const RAISE_LIFT = 0.35;
const TWITCH_TIME = 0.12;
const TWITCH_HOP = 0.04;
const SHELL_SLIDE = 1.15; // design units: the cast ends up 1.15 x SPIDER_SCALE behind the body (R18, loop's CAST_OFFSET)
const EXPLORING = new Set(['wander', 'investigate', 'approach', 'seekLure', 'stalk']);
const GEARS = [ // abdomen-local offsets from the gem centre, depth below the surface, radius, rad/s
  { x: -0.03, z: 0.025, depth: 0.05, r: 0.066, speed: 0.45 },
  { x: 0.064, z: -0.035, depth: 0.065, r: 0.044, speed: -0.68 },
  { x: -0.01, z: -0.075, depth: 0.085, r: 0.03, speed: 1.1 },
];
const PAVILION_DEPTH = 0.2;
const HAIRS = { femur: 44, tibia: 24, meta: 14, palp: 10 }; // densest on the femur: velvety
const PALPS = [-1, 1].map((side) => ({
  side,
  hip: new THREE.Vector3(CEPH.x + 0.23, CEPH.y - 0.04, 0.085 * side),
  rest: new THREE.Vector3(0.56, 0, 0.16 * side),
}));

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};
let envMap = null;
const studio = () => (envMap ??= studioEnvironment());

// ---- rig construction ----------------------------------------------------------------------

function makeMaterials(shade, shell) {
  const physical = (extra) => new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', envMap: studio(), ior: 1.45, ...extra });
  const pal = palettes(shade);
  const parts = {};
  for (const name of PARTS) {
    const uniforms = hushUniforms(pal[name]);
    const material = patchHush(physical({
      attenuationColor: new THREE.Color(shade.body), attenuationDistance: 0.6,
      sheen: SHEEN[name], sheenColor: sheenColor(shade), sheenRoughness: 0.5,
    }), uniforms, { gemCut: name === 'abdomen' && !shell });
    parts[name] = { uniforms, material };
  }
  if (shell) return { parts };
  const amberUniforms = hushUniforms(AMBER);
  amberUniforms.hushRimColor.value.set('#FFD58A');
  amberUniforms.hushRimStrength.value = 0.25;
  return {
    parts,
    band: patchHush(physical({ metalness: 0.55, roughness: 0.22, clearcoat: 1, emissive: new THREE.Color(AMBER.deep) }), amberUniforms),
    gem: new THREE.MeshPhysicalMaterial({
      color: '#E9FFFF', transmission: 1, thickness: 0.1, roughness: 0.03, ior: 1.6, clearcoat: 1,
      envMap: studio(), flatShading: true,
    }),
    pavilion: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    gear: new THREE.MeshStandardMaterial({ color: '#E8B86A', metalness: 1, roughness: 0.36, envMap: studio(), emissive: new THREE.Color('#C96A12') }),
    // By day these are enamel, not light: a deep sapphire well behind the gears, a dark inner
    // spine, and satin teal joint rings. They only glow as the lights go down.
    core: glowMaterial('#E9FFFF', GLOW, 1, { day: '#0E2556' }),
    haze: glowMaterial('#3DF5FF', '#1D3FBF', 1, { haze: true }),
    spine: glowMaterial('#9FF6FF', '#1D3FBF', 1, { day: '#1A2C66' }),
    joint: glowMaterial('#DFFFFF', GLOW, 1, { refracted: false, day: '#2A6587' }),
    hair: new THREE.MeshBasicMaterial({ color: shade.deep, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
  };
}

function mesh(geo, material, parent, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

// Builds the meshes. A `shell` rig (moult cast) has only skin: no gem, gears, glow, bands or hair.
function buildRig(shadeIndex, { shell = false } = {}) {
  const shade = SHADES[shadeIndex];
  const mats = makeMaterials(shade, shell);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);

  const skin = mats.parts.legs.material;
  mesh(cached('ceph', cephGeometry), mats.parts.ceph.material, torso).position.set(CEPH.x, CEPH.y, 0);
  const pedicel = mesh(cached('pedicel', () => new THREE.CylinderGeometry(0.05, 0.06, 0.16, 16).rotateZ(Math.PI / 2)), skin, torso);
  pedicel.position.set(CEPH.x - CEPH.l / 2 - 0.02, CEPH.y + 0.01, 0);
  for (const side of [-1, 1]) {
    const chel = mesh(cached('chelicera', () => new THREE.SphereGeometry(1, 20, 12).scale(0.075, 0.055, 0.05)), skin, torso);
    chel.position.set(CEPH.x + CEPH.l / 2 - 0.02, CEPH.y - 0.035, 0.058 * side);
    chel.rotation.z = -0.5;
  }

  const abdomen = new THREE.Group();
  abdomen.position.set(ABDOMEN.x, ABDOMEN.y, 0);
  abdomen.rotation.z = ABDOMEN.pitch;
  torso.add(abdomen);
  mesh(cached('abdomen', abdomenGeometry), mats.parts.abdomen.material, abdomen);

  root.scale.setScalar(SPIDER_SCALE);
  const rig = { shell, shade: shadeIndex, mats, root, torso, abdomen, legs: [], palps: [], gears: [] };
  if (!shell) buildGem(rig);

  for (const leg of LEGS) {
    const hip = new THREE.Vector3(leg.hip.z, 0, leg.hip.x).multiplyScalar(DESIGN);
    const banded = !shell && (leg.index === 1 || leg.index === 2);
    rig.legs.push(buildLimb(rig, { hip, side: leg.side, femur: leg.femur * DESIGN, tibia: leg.tibia * DESIGN, rest: new THREE.Vector3(leg.rest.z, 0, leg.rest.x).multiplyScalar(DESIGN), radii: LEG_RADII, split: true, banded, seed: 11 + rig.legs.length }));
  }
  for (const p of PALPS) {
    rig.palps.push(buildLimb(rig, { hip: p.hip, side: p.side, femur: PALP.femur, tibia: PALP.tibia, rest: p.rest, radii: PALP.radii, split: false, banded: !shell, seed: 41 + rig.palps.length }));
  }
  if (!shell) buildHair(rig);
  return rig;
}

function buildGem(rig) {
  const { mats, abdomen } = rig;
  const top = abdomenTop(GEM.x, GEM.z);
  const at = (o) => {
    o.position.set(GEM.x, 0, GEM.z);
    return o;
  };
  at(mesh(cached('gem', gemGeometry), mats.gem, abdomen));
  at(mesh(cached('bezel', bezelGeometry), mats.band, abdomen));
  at(mesh(cached('pavilion', () => pavilionGeometry(PAVILION_DEPTH)), mats.pavilion, abdomen, false));
  for (const g of GEARS) {
    const gear = mesh(cached(`gear${g.r}`, () => gearGeometry(g.r)), mats.gear, abdomen, false);
    gear.position.set(GEM.x + g.x, top - g.depth, GEM.z + g.z);
    rig.gears.push({ mesh: gear, speed: g.speed });
  }
  const core = mesh(cached('core', () => new THREE.SphereGeometry(0.04, 20, 12)), mats.core, abdomen, false);
  core.position.set(GEM.x, top - PAVILION_DEPTH + 0.06, GEM.z);
  // A soft luminous core filling the abdomen. The skin's depth hides it in Solid and Translucent;
  // Ghost (no depth write) lets it glow through.
  const haze = mesh(cached('abdomen', abdomenGeometry), mats.haze, abdomen, false);
  haze.scale.setScalar(0.72);
  haze.position.y = -0.02;
  haze.renderOrder = 2;
  // A faint inner "spine" along the dorsal midline, seen through the glass in Translucent only.
  const spine = mesh(cached('spine', () => new THREE.CapsuleGeometry(0.024, 0.6, 6, 12).rotateZ(Math.PI / 2)), mats.spine, abdomen, false);
  spine.position.set(-0.02, 0.06, 0);
  const cephSpine = mesh(cached('cephSpine', () => new THREE.CapsuleGeometry(0.014, 0.36, 6, 10).rotateZ(Math.PI / 2)), mats.spine, rig.torso, false);
  cephSpine.position.set(CEPH.x - 0.02, CEPH.y + 0.01, 0);
  rig.spines = [spine, cephSpine];
  rig.glowLight = new THREE.PointLight(GLOW, 0, 6);
  rig.glowLight.position.set(GEM.x, 1.8, GEM.z);
  abdomen.add(rig.glowLight);
}

function buildLimb(rig, { hip, side, femur, tibia, rest, radii, split, banded, seed }) {
  const { mats, root, torso, shell } = rig;
  const skin = mats.parts.legs.material;
  const coxa = mesh(cached(`coxa${radii.femur[0]}`, () => new THREE.SphereGeometry(radii.femur[0] * 1.1, 16, 10)), skin, torso);
  coxa.position.copy(hip);
  const tibLen = (split ? tibia * TIBIA_SPLIT : tibia) - (split ? PATELLA_LEN : 0);
  const bows = split ? LEG_BOW : { femur: LEG_BOW.femur * 0.4, tibia: LEG_BOW.tibia * 0.4 };
  const metaLen = tibia * (1 - TIBIA_SPLIT);
  const limb = {
    hip, side, femur, tibia, rest, split, tibLen, metaLen, seed,
    femurMesh: mesh(cached(`f${femur}${radii.femur}`, () => segmentGeometry(femur, radii.femur, bows.femur)), skin, root),
    patellaMesh: split ? mesh(cached('patella', () => segmentGeometry(PATELLA_LEN, radii.patella)), skin, root) : null,
    tibiaMesh: mesh(cached(`t${tibLen}${radii.tibia}`, () => segmentGeometry(tibLen, radii.tibia, bows.tibia)), skin, root),
    metaMesh: split ? mesh(cached(`m${metaLen}`, () => segmentGeometry(metaLen, radii.meta, bows.meta)), skin, root) : null,
    bows,
    coxa,
    knee: mesh(cached(`knee${radii.femur[1]}`, () => new THREE.SphereGeometry(radii.femur[1] * 1.02, 18, 12)), skin, root),
    radii,
  };
  if (shell) return limb;
  // Glowing rings at the joints: where the tibia leaves the patella, and round the metatarsus.
  const ring = (r, parent, y) => {
    const m = mesh(cached(`ring${r}`, () => new THREE.TorusGeometry(r, 0.0075, 8, 28).rotateX(Math.PI / 2)), mats.joint, parent, false);
    m.position.y = y;
  };
  ring(radii.tibia[0] * 1.08, limb.tibiaMesh, split ? 0 : radii.tibia[0] * 0.9);
  if (split) ring(radii.meta[0] * 1.1, limb.metaMesh, 0);
  if (banded) {
    const r = (radii.femur[0] + radii.femur[1]) / 2;
    const band = mesh(cached(`band${r}${femur}`, () => bandGeometry(r * 1.06, femur * 0.15)), mats.band, limb.femurMesh);
    band.position.set(bows.femur, femur * 0.5, 0); // on the bowed femur's mid-length
  }
  return limb;
}

function buildHair(rig) {
  const entries = [];
  const add = (limb, key, length, radii, count) => {
    const bow = limb.bows[key.replace('Mesh', '')];
    for (const m of hairLayout(length, radii, count, limb.seed * 7 + entries.length, bow)) entries.push({ limb, key, m });
  };
  for (const limb of [...rig.legs, ...rig.palps]) {
    const palp = !limb.split;
    add(limb, 'femurMesh', limb.femur, limb.radii.femur, palp ? HAIRS.palp : HAIRS.femur);
    add(limb, 'tibiaMesh', limb.tibLen, limb.radii.tibia, palp ? HAIRS.palp : HAIRS.tibia);
    if (limb.metaMesh) add(limb, 'metaMesh', limb.metaLen, limb.radii.meta, HAIRS.meta);
  }
  const hair = new THREE.InstancedMesh(cached('hair', hairGeometry), rig.mats.hair, entries.length);
  hair.frustumCulled = false;
  rig.root.add(hair);
  rig.hair = { mesh: hair, entries };
}

// ---- solving -------------------------------------------------------------------------------

const v = () => new THREE.Vector3();
const tmp = {
  hip: v(), curl: v(), pole: v(), target: v(), knee: v(), foot: v(), mid: v(), dir: v(), bend: v(), side: v(), depth: v(),
  patEnd: v(), femDir: v(),
  basis: new THREE.Matrix4(), m: new THREE.Matrix4(),
};
const P = (o) => ({ x: o.x, y: o.y, z: o.z });

// Orients a segment (local +y) from a to b, with its local +x (the bow side) toward `toward`.
function place(meshObj, a, b, nominal, toward) {
  const { dir, side, depth, basis } = tmp;
  dir.subVectors(b, a);
  const L = dir.length() || 1e-6;
  dir.divideScalar(L);
  side.copy(toward).addScaledVector(dir, -toward.dot(dir));
  if (side.lengthSq() < 1e-8) side.set(0, 0, 1).addScaledVector(dir, -dir.z);
  side.normalize();
  depth.crossVectors(side, dir);
  meshObj.quaternion.setFromRotationMatrix(basis.makeBasis(side, dir, depth));
  meshObj.position.copy(a);
  meshObj.scale.set(1, L / nominal, 1);
  meshObj.updateMatrix();
}

// Solves one limb in root space. `ground` is its foot target with the body upright; `roll` (0-1)
// blends toward a curl over the belly (moult on its back: feet in the air, knees up and out),
// expressed in the torso frame, where the belly side is -y.
function solveLimb(limb, torso, ground, roll) {
  const { hip, curl, pole, target } = tmp;
  hip.copy(limb.hip).applyMatrix4(torso.matrix);
  curl.set(limb.hip.x * 1.1 + 0.04, -0.55, limb.side * 0.34).applyMatrix4(torso.matrix);
  target.copy(ground).lerp(curl, roll);
  // Knees bend up in the leg's vertical plane; on its back they splay out and toward the belly.
  pole.set(0, 1 - 1.6 * roll, limb.side * roll).applyQuaternion(torso.quaternion);
  const { knee, foot } = solveTwoBone(P(hip), P(target), limb.femur, limb.tibia, P(pole));
  tmp.knee.set(knee.x, knee.y, knee.z);
  tmp.foot.set(foot.x, foot.y, foot.z);
  place(limb.femurMesh, hip, tmp.knee, limb.femur, pole);
  limb.knee.position.copy(tmp.knee);
  if (!limb.split) {
    place(limb.tibiaMesh, tmp.knee, tmp.foot, limb.tibLen, pole);
    return;
  }
  // Metatarsus/tarsus split at a fixed ratio along the tibia, bent toward the knee's side.
  const { mid, bend, patEnd, femDir } = tmp;
  bend.subVectors(tmp.foot, tmp.knee);
  const L = bend.length();
  bend.divideScalar(L || 1);
  // The patella leaves the knee between the femur's and the tibia's directions, rounding the joint.
  femDir.subVectors(tmp.knee, hip).normalize().multiplyScalar(0.35).add(bend).normalize();
  patEnd.copy(tmp.knee).addScaledVector(femDir, PATELLA_LEN);
  mid.copy(tmp.knee).addScaledVector(bend, L * TIBIA_SPLIT);
  bend.multiplyScalar(-pole.dot(bend)).add(pole).normalize(); // pole, perpendicular to knee->foot
  mid.addScaledVector(bend, METATARSUS_BEND * L * TIBIA_SPLIT * (1 - TIBIA_SPLIT));
  place(limb.patellaMesh, tmp.knee, patEnd, PATELLA_LEN, pole);
  place(limb.tibiaMesh, patEnd, mid, limb.tibLen, pole);
  place(limb.metaMesh, mid, tmp.foot, limb.metaLen, pole);
}

// Positions the torso and solves every limb. `targets(limb, i)` returns the limb's ground target.
function solveRig(rig, { height = DESIGN_HIP, roll = 0, targets }) {
  const e = roll * roll * (3 - 2 * roll);
  rig.torso.position.set(0, height + 0.08 * e + 0.13 * Math.sin(Math.PI * e), 0);
  rig.torso.rotation.x = Math.PI * e;
  rig.torso.updateMatrix();
  rig.legs.forEach((limb, i) => solveLimb(limb, rig.torso, targets(limb, i), e));
  rig.palps.forEach((limb, i) => solveLimb(limb, rig.torso, targets(limb, 8 + i), e));
  if (rig.hair) {
    const { mesh: hair, entries } = rig.hair;
    entries.forEach((h, i) => hair.setMatrixAt(i, tmp.m.multiplyMatrices(h.limb[h.key].matrix, h.m)));
    hair.instanceMatrix.needsUpdate = true;
  }
}

// ---- materials -----------------------------------------------------------------------------

function applyMode(rig, mode) {
  const s = MODES[mode];
  const skins = PARTS.map((n) => rig.mats.parts[n].material);
  for (const { uniforms } of Object.values(rig.mats.parts)) {
    uniforms.hushRimAlpha.value = s.rimAlpha;
    uniforms.hushLift.value = s.lift;
    uniforms.hushRimStrength.value = s.rim;
  }
  for (const m of skins) {
    const satin = m === rig.mats.parts.abdomen.material;
    Object.assign(m, {
      transmission: s.transmission, thickness: s.thickness, roughness: s.roughness, specularIntensity: s.spec,
      clearcoat: satin ? Math.min(s.clearcoat, ABDOMEN_CLEARCOAT) : s.clearcoat, clearcoatRoughness: satin ? 0.28 : 0.08,
      opacity: s.opacity, transparent: s.opacity < 1, depthWrite: s.opacity >= 1,
    });
    m.needsUpdate = true;
  }
  for (const o of rig.spines ?? []) o.visible = mode === 'translucent';
  if (rig.mats.band) {
    Object.assign(rig.mats.band, { transparent: mode === 'ghost', opacity: mode === 'ghost' ? 0.5 : 1, depthWrite: mode !== 'ghost' });
    rig.mats.band.needsUpdate = true;
  }
  rig.root.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && (skins.includes(o.material) || o.material === rig.mats.band)) o.castShadow = s.shadow;
  });
  // Knee and hip spheres only fill the joints; seen through Ghost glass they read as beads.
  for (const limb of [...rig.legs, ...rig.palps]) limb.knee.visible = limb.coxa.visible = mode !== 'ghost';
}

// Ghost-material moult cast of the body and legs, at the given shade, lying on its back with its
// legs curled up: the exact pose the cast has when the spider's emerge phase leaves it behind
// (ruling R18), so the stored shell takes over without a jump. Place it with
// position.set(x, 0, z) and rotation.y = -heading.
// root.userData.setNight(v) fades it with the lights, like the spider.
export function createShellMesh(shadeIndex) {
  const rig = buildRig(shadeIndex, { shell: true });
  applyMode(rig, 'ghost');
  solveRig(rig, { roll: 1, targets: (limb) => limb.rest });
  rig.root.name = 'moultShell';
  rig.root.userData.setNight = (v) => shellNight(rig, v);
  shellNight(rig, 0);
  return rig.root;
}

// An empty cast is fainter than the living spider: a soft pale rim by day; at night a dim cyan
// edge that catches the glow (its fresnel rim is unlit, so left at day strength it would blaze).
const SHELL_RIM = { day: 0.65, night: 0.3 };
function shellNight(rig, value) {
  const night = clamp(value, 0, 1);
  const shade = SHADES[rig.shade];
  for (const { uniforms: u, material: m } of Object.values(rig.mats.parts)) {
    u.hushRimStrength.value = MODES.ghost.rim * lerp(SHELL_RIM.day, SHELL_RIM.night, night);
    u.hushRimColor.value.copy(rimColor(shade, 0.4)).lerp(GLOW_COLOR, 0.5 * night);
    m.emissive.set(shade.deep);
    m.emissiveIntensity = lerp(0, 0.3, night);
    m.envMapIntensity = lerp(1, 0.06, night);
  }
}

// Removes a moult cast and frees its own materials (geometry is shared through the cache).
function disposeShell(root) {
  root.removeFromParent();
  const mats = new Set();
  root.traverse((o) => o.material && mats.add(o.material));
  for (const m of mats) m.dispose();
}

// ---- spider --------------------------------------------------------------------------------

export function createSpider(scene, { shade = 0 } = {}) {
  const rig = buildRig(shade);
  scene.add(rig.root);
  rig.root.name = 'spider';
  const blob = contactShadow(contactShadowTexture(), 0.95, 0.62, 0.34);
  blob.position.x = -0.3;
  rig.root.add(blob);

  let mode = 'translucent';
  let night = 0;
  let lastTime = null;
  let raise = 0;
  let tap = 0;
  let twitch = 0;
  let pulse = 0;
  let shell = null; // { shade, root, night } — the cast shown during the moult's emerge phase

  function refresh() {
    const s = MODES[mode];
    const shadeDef = SHADES[rig.shade];
    for (const name of PARTS) {
      const { uniforms: u, material: m } = rig.mats.parts[name];
      u.hushRimStrength.value = s.rim * lerp(1, 0.8, night);
      u.hushRimColor.value.copy(rimColor(shadeDef, s.tint)).lerp(GLOW_COLOR, 0.35 * night);
      m.sheenColor.copy(sheenColor(shadeDef, s.tint));
      m.emissive.set(shadeDef.deep);
      m.emissiveIntensity = lerp(0, 0.35, night);
      m.sheen = SHEEN[name] * lerp(1, 0.25, night);
      u.hushInner.value.copy(GLOW_COLOR).multiplyScalar(s.inner * lerp(0, 0.5, night)); // no inner light by day
    }
    rig.mats.spine.uniforms.intensity.value = 0.3;
    rig.mats.spine.uniforms.glow.value = night;
    for (const m of [...PARTS.map((n) => rig.mats.parts[n].material), rig.mats.band, rig.mats.gem]) {
      m.envMapIntensity = lerp(1, 0.06, night);
    }
    rig.mats.gear.envMapIntensity = lerp(0.55, 0.06, night);
    rig.mats.band.emissiveIntensity = lerp(0, 0.25, night);
    rig.mats.gear.emissiveIntensity = lerp(0, 0.4, night);
    rig.mats.joint.uniforms.intensity.value = 1.35;
    rig.mats.joint.uniforms.glow.value = night;
    rig.mats.haze.uniforms.intensity.value = 0.45;
    rig.mats.haze.uniforms.glow.value = night;
    // Day: dark velvet hairs (pale ones read as scratches on the cobalt); night: they catch the glow.
    rig.mats.hair.color.copy(HAIR_DAY.set(shadeDef.deep)).lerp(HAIR_NIGHT.set(shadeDef.highlight), night);
    rig.mats.hair.opacity = lerp(0.5, 0.32, night) * (mode === 'ghost' ? 0.5 : 1);
    rig.glowLight.intensity = GLOW_MAX * night;
    blob.material.opacity = lerp(0.34, 0.14, night) * (mode === 'ghost' ? 0.5 : 1);
  }

  function setGem() {
    // The gem's facets are unlit colour, so by day they are dimmed to deep sapphire glass.
    rig.mats.pavilion.color.copy(PAVILION_DAY).lerp(PAVILION_NIGHT, night).multiplyScalar(1 + 0.6 * pulse);
    rig.mats.core.uniforms.intensity.value = 0.42 * (1 + 0.8 * pulse); // low enough that the gears still read through the bloom
    rig.mats.core.uniforms.glow.value = Math.min(1, night + 0.6 * pulse); // eating lights it, even by day
  }

  function showShell(moult) {
    const visible = moult && (moult.phase === 'emerge' || moult.phase === 'rollBack');
    if (!visible) {
      if (shell) shell.root.visible = false;
      return;
    }
    if (!shell || shell.shade !== rig.shade) {
      if (shell) disposeShell(shell.root);
      shell = { shade: rig.shade, root: createShellMesh(rig.shade), night: 0 };
      shell.root.scale.setScalar(1); // already inside the scaled spider root
      rig.root.add(shell.root);
    }
    shell.root.visible = true;
    if (shell.night !== night) { // re-fade only when the lights changed
      shell.root.userData.setNight(night);
      shell.night = night;
    }
    const p = moult.phase === 'emerge' ? moult.p : 1;
    shell.root.position.x = -SHELL_SLIDE * p * p * (3 - 2 * p); // the old cast slides off backward
  }

  const ground = v();
  function pose({ body, gait, intent = null, moult = null, time = 0, eatPulse = 0 }) {
    const dt = lastTime === null ? 0 : clamp(time - lastTime, 0, 0.05);
    lastTime = time;
    raise = damp(raise, intent?.frontLegsRaise ?? 0, 12, dt);
    tap = damp(tap, EXPLORING.has(intent?.state) ? 1 : 0, 6, dt);
    if (intent?.twitch) twitch = TWITCH_TIME;
    else twitch = Math.max(0, twitch - dt);
    const k = twitch / TWITCH_TIME; // 1 -> 0 over the twitch
    const hop = k > 0 ? TWITCH_HOP * Math.sin(Math.PI * (1 - k)) : 0;

    rig.root.position.set(body.x, 0, body.z);
    rig.root.rotation.y = -body.heading;
    const c = Math.cos(body.heading);
    const s = Math.sin(body.heading);
    const roll = !moult ? 0 : moult.phase === 'roll' ? moult.p : moult.phase === 'emerge' ? 1 : moult.phase === 'rollBack' ? 1 - moult.p : 0;

    solveRig(rig, {
      height: DESIGN_HIP + hop,
      roll,
      targets(limb, i) {
        if (i < 8) {
          const f = gait.feet[LEGS[i].id];
          const dx = f.x - body.x;
          const dz = f.z - body.z;
          ground.set(c * dx + s * dz, f.y, -s * dx + c * dz).multiplyScalar(DESIGN);
          if (LEGS[i].index === 0) ground.y += RAISE_LIFT * raise;
        } else {
          ground.copy(limb.rest);
          const phase = time * Math.PI * 2 * 1.7 + (limb.side > 0 ? Math.PI : 0);
          ground.y += 0.05 * tap * Math.max(0, Math.sin(phase)) + 0.2 * raise;
          ground.x -= 0.06 * raise;
        }
        if (k > 0) { // a decaying high-frequency shiver
          ground.y += 0.03 * k * (0.5 + 0.5 * Math.sin(time * 95 + i * 2.1));
          ground.x += 0.025 * k * Math.sin(time * 120 + i * 1.3);
        }
        return ground;
      },
    });

    for (const g of rig.gears) g.mesh.rotation.y = time * g.speed;
    pulse = clamp(eatPulse, 0, 1);
    rig.abdomen.scale.setScalar(1 + 0.04 * pulse);
    setGem();
    showShell(moult);
  }

  function setMaterial(m) {
    if (!MODES[m]) return;
    mode = m;
    applyMode(rig, m);
    refresh();
  }

  function setShade(i) {
    rig.shade = clamp(Math.trunc(i) || 0, 0, SHADES.length - 1);
    const d = SHADES[rig.shade];
    const pal = palettes(d);
    for (const name of PARTS) {
      const { uniforms: u, material: m } = rig.mats.parts[name];
      u.hushDeep.value.copy(pal[name].deep);
      u.hushBody.value.copy(pal[name].body);
      u.hushHighlight.value.copy(pal[name].highlight);
      m.attenuationColor.set(d.body);
    }
    rig.mats.hair.color.set(d.highlight);
    refresh();
  }

  function setNight(value) {
    night = clamp(value, 0, 1);
    refresh();
    setGem();
  }

  setShade(shade);
  setMaterial(mode);
  setNight(0);
  pose({ body: { x: 0, z: 0, heading: 0 }, gait: createGait({ x: 0, z: 0, heading: 0, vx: 0, vz: 0 }) });

  return {
    group: rig.root,
    glowLight: rig.glowLight,
    legCount: rig.legs.length,
    setMaterial,
    setShade,
    setNight,
    pose,
  };
}
