import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

// Geometry and shader builders for the spider (spiderMesh.js assembles and poses them).
// Mesh frame: +x is the body's forward axis, +y up, +z the body's right side. The gait frame's
// (x = right, z = forward) maps to mesh (z, x). Sizes are full extents: width (right) x height x length.
export const CEPH = { w: 0.55, h: 0.18, l: 0.5, x: 0.04, y: 0 };
export const ABDOMEN = { w: 0.75, h: 0.5, l: 0.85, x: -0.72, y: 0.03, pitch: 0.08 };
export const GEM = { x: 0.03, z: 0, r: 0.17 }; // hex window on the abdomen top, abdomen-local; r = circumradius
export const GEM_APOTHEM = GEM.r * Math.cos(Math.PI / 6);

// Leg segment radii (start, end). The tibia's metatarsus/tarsus split sits at TIBIA_SPLIT of its
// length and is bent METATARSUS_BEND toward the knee's side.
// The femur is the thickest; the patella is a short knuckle after the knee; the tarsus ends fine.
export const LEG_RADII = { femur: [0.076, 0.06], patella: [0.062, 0.056], tibia: [0.055, 0.044], meta: [0.042, 0.014] };
export const PATELLA_LEN = 0.11;
// How far each segment bows toward the knee's side (mid-length offset), for an organic arc.
export const LEG_BOW = { femur: 0.035, tibia: 0.014, meta: 0.01 };
export const TIBIA_SPLIT = 0.52;
export const METATARSUS_BEND = THREE.MathUtils.degToRad(8);
export const PALP = { femur: 0.2, tibia: 0.22, radii: { femur: [0.04, 0.035], tibia: [0.034, 0.027] } };

// A flattened ellipsoid with a raised carapace ridge running nose to tail and a slightly raised head.
export function cephGeometry() {
  const geo = new THREE.SphereGeometry(1, 56, 28);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const front = Math.max(0, v.x);
    // Rounded shoulders (no lens-like brim), then a broad low ridge and a slightly raised head.
    let y = Math.sign(v.y) * Math.abs(v.y) ** 0.75 * (CEPH.h / 2);
    if (v.y > 0) {
      const ridge = Math.exp(-((v.z / 0.4) ** 2)) * (1 - v.x * v.x);
      const head = THREE.MathUtils.smoothstep(v.x, -0.2, 0.7) * Math.exp(-((v.z / 0.6) ** 2));
      y += v.y * (0.022 * ridge + 0.03 * head);
    }
    p.setXYZ(i, v.x * (CEPH.l / 2), y, v.z * (CEPH.w / 2) * (1 - 0.16 * front * front));
  }
  geo.computeVertexNormals();
  return geo;
}

// Abdomen surface point for a unit-sphere direction: an egg a touch fuller toward the rear,
// flattened above and more so below, with a gentle dorsal ridge and a slightly lobed rear, so it
// reads as organic rather than a perfect balloon.
function abdomenSurface(vx, vy, vz) {
  const fuller = (1 - 0.07 * vx) * (1 + 0.035 * Math.sin(vx * 5.5 + 1.2));
  const flat = vy > 0 ? 0.9 : 0.8;
  const ridge = vy > 0 ? 0.018 * vy * Math.exp(-((vz / 0.28) ** 2)) * (1 - vx * vx) : 0;
  return [vx * (ABDOMEN.l / 2), vy * (ABDOMEN.h / 2) * fuller * flat + ridge, vz * (ABDOMEN.w / 2) * fuller];
}

export function abdomenGeometry() {
  const geo = new THREE.SphereGeometry(1, 64, 32);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...abdomenSurface(p.getX(i), p.getY(i), p.getZ(i)));
  geo.computeVertexNormals();
  return geo;
}

// Height of the abdomen's top surface at abdomen-local (x, z).
export function abdomenTop(x, z) {
  const vx = x / (ABDOMEN.l / 2);
  const fuller = (1 - 0.07 * vx) * (1 + 0.035 * Math.sin(vx * 5.5 + 1.2));
  const vz = z / ((ABDOMEN.w / 2) * fuller);
  const vy = Math.sqrt(Math.max(0, 1 - vx * vx - vz * vz));
  return abdomenSurface(vx, vy, vz)[1];
}

// Hexagonal solid of revolution around the gem axis (corners on +-z, matching the window cut).
// Each profile ring is { k: fraction of the hex radius, y } with y relative to the abdomen
// surface under that point when `onSurface`, else abdomen-local. Edges are subdivided so rings
// that follow the surface hug its curve. Flat-shaded for crisp facets.
function hexSolid(rings, sub = 6) {
  const per = 6 * sub;
  const pos = [];
  const ringPts = rings.map(({ k, y, onSurface }) => {
    const pts = [];
    for (let j = 0; j < per; j++) {
      const c = Math.floor(j / sub);
      const t = (j % sub) / sub;
      const a0 = (c * Math.PI) / 3;
      const a1 = ((c + 1) * Math.PI) / 3;
      const x = GEM.r * k * THREE.MathUtils.lerp(Math.sin(a0), Math.sin(a1), t);
      const z = GEM.r * k * THREE.MathUtils.lerp(Math.cos(a0), Math.cos(a1), t);
      pts.push([x, onSurface ? abdomenTop(GEM.x + x, GEM.z + z) + y : y, z]);
    }
    return pts;
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < per; j++) {
      const a = ringPts[i][j];
      const b = ringPts[i][(j + 1) % per];
      const c = ringPts[i + 1][(j + 1) % per];
      const d = ringPts[i + 1][j];
      pos.push(...a, ...d, ...b, ...b, ...d, ...c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

// The gem's crown: a wall that dives under the cut edge, then bevel facets up to a flat table,
// all lying just proud of the abdomen's curve so it reads as inset, not stuck on.
export function gemGeometry() {
  return hexSolid([
    { k: 1, y: -0.04, onSurface: true },
    { k: 1, y: 0.004, onSurface: true },
    { k: 0.6, y: 0.016, onSurface: true },
    { k: 0, y: 0.016, onSurface: true },
  ]);
}

// A slim hex bezel that hides the cut seam.
export function bezelGeometry() {
  return hexSolid([
    { k: 0.98, y: -0.006, onSurface: true },
    { k: 1.1, y: -0.004, onSurface: true },
    { k: 1.1, y: 0.006, onSurface: true },
    { k: 0.99, y: 0.01, onSurface: true },
  ]);
}

// The glowing pavilion under the crown: a hex cone (like a cut gem's underside), cyan at the
// culet to near-black at the girdle (vertex colours follow depth). Returns the girdle height too.
export function pavilionGeometry(depth) {
  const top = abdomenTop(GEM.x, GEM.z);
  const geo = hexSolid([
    { k: 1, y: -0.04, onSurface: true },
    { k: 0.93, y: top - 0.075 },
    { k: 0, y: top - depth },
  ]);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const stops = ['#3DF5FF', '#1D3FBF', '#050A30'].map((h) => new THREE.Color(h));
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - (top - depth)) / (depth - 0.05), 0, 1);
    if (t < 0.55) c.lerpColors(stops[0], stops[1], t / 0.55);
    else c.lerpColors(stops[1], stops[2], (t - 0.55) / 0.45);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// A watch-movement gear lying flat (axis +y): rim torus, square teeth, four spokes and a hub.
export function gearGeometry(radius) {
  const tube = radius * 0.11;
  const parts = [new THREE.TorusGeometry(radius, tube, 8, 40).rotateX(Math.PI / 2)];
  const teeth = Math.max(6, Math.round(radius * 150));
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const tooth = new THREE.BoxGeometry(tube * 2.2, tube * 1.6, tube * 1.8);
    tooth.translate(radius + tube * 1.4, 0, 0).rotateY(a);
    parts.push(tooth);
  }
  for (let i = 0; i < 4; i++) {
    parts.push(new THREE.BoxGeometry(radius * 2, tube * 0.9, tube * 1.1).rotateY((i * Math.PI) / 4 + Math.PI / 8));
  }
  parts.push(new THREE.CylinderGeometry(tube * 2.4, tube * 2.4, tube * 2.2, 16));
  return merge(parts);
}

// A rounded amber collar around a segment (axis +y, centred), for the leg bands.
export function bandGeometry(r, h) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    pts.push(new THREE.Vector2(r * (1.02 + 0.13 * Math.cos(a)), (h / 2) * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, 28);
}

// A capsule running from the origin along +y for `length`, tapering from r0 to r1 with a slight
// swell, and bowed toward +x by `bow` at mid-length.
export function segmentGeometry(length, [r0, r1], bow = 0) {
  const geo = new THREE.CapsuleGeometry(r0, length, 6, 16);
  geo.translate(0, length / 2, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp(p.getY(i) / length, 0, 1);
    const k = THREE.MathUtils.lerp(1, r1 / r0, t) * (1 + 0.14 * Math.sin(Math.PI * t)); // a slight fusiform swell
    p.setX(i, p.getX(i) * k + bow * Math.sin(Math.PI * t));
    p.setZ(i, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// Fine hairs: thin quads rooted on a segment's surface, raking outward toward the segment's tip.
// Returns segment-local matrices (segment axis +y), reproducible from `seed`.
export function hairLayout(length, [r0, r1], count, seed, bow = 0) {
  const rng = mulberry32(seed);
  const out = [];
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const t = 0.08 + 0.86 * ((i + rng()) / count);
    const phi = rng() * Math.PI * 2;
    const r = THREE.MathUtils.lerp(r0, r1, t) * 0.92;
    const out3 = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
    const rake = 0.22 + rng() * 0.38; // radians from the segment axis
    axis.set(0, Math.cos(rake), 0).addScaledVector(out3, Math.sin(rake)).normalize();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    const len = 0.55 + rng() * 0.7;
    const base = out3.clone().multiplyScalar(r).setY(t * length);
    base.x += bow * Math.sin(Math.PI * t);
    out.push(new THREE.Matrix4().compose(base, q.clone(), new THREE.Vector3(1, len, 1)));
  }
  return out;
}

export function hairGeometry() {
  return new THREE.PlaneGeometry(0.0045, 0.05).translate(0, 0.025, 0);
}

// An HDR studio environment (equirectangular half-float data): a dim blue-grey room over a bright
// floor (the white deck), with long softbox strips so glossy segments pick up crisp white streaks.
// Half float, not float: 32-bit float textures read black under linear filtering on GPUs without
// OES_texture_float_linear (many phones); half float filters everywhere.
export function studioEnvironment() {
  const w = 256;
  const h = 128;
  const data = new Uint16Array(w * h * 4);
  const half = THREE.DataUtils.toHalfFloat;
  const band = (v, a, b, soft) => THREE.MathUtils.smoothstep(v, a - soft, a) * (1 - THREE.MathUtils.smoothstep(v, b, b + soft));
  const STRIPS = [ // [lat0, lat1, lon0, lon1, brightness]
    [0.32, 0.5, 0.4, 2.2, 9],
    [0.18, 0.28, 3.3, 4.6, 4],
    [0.05, 0.14, 5.0, 6.0, 5],
  ];
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * Math.PI * 2;
      let val = lat > 0 ? THREE.MathUtils.lerp(0.1, 0.03, lat / (Math.PI / 2)) : 0.16;
      val += 3.5 * THREE.MathUtils.smoothstep(lat, 1.15, 1.3);
      for (const [a, b, c, d, k] of STRIPS) val += k * band(lat, a, b, 0.03) * band(lon, c, d, 0.05);
      const o = (j * w + i) * 4;
      // The dim room is cool blue so grazing reflections stay cobalt; the softboxes stay white.
      const room = Math.min(1, val);
      data[o] = half(val - room * 0.35);
      data[o + 1] = half(val - room * 0.2);
      data[o + 2] = half(val);
      data[o + 3] = half(1);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

// Shared uniforms for the cobalt look: a world-up colour gradient (deep -> body -> highlight)
// and a fresnel rim that also raises alpha, so Ghost keeps a glassy silhouette.
export function hushUniforms({ deep, body, highlight }) {
  return {
    hushDeep: { value: new THREE.Color(deep) },
    hushBody: { value: new THREE.Color(body) },
    hushHighlight: { value: new THREE.Color(highlight) },
    hushRimColor: { value: new THREE.Color(highlight) },
    hushRimStrength: { value: 0.5 },
    hushRimPower: { value: 2.6 },
    hushRimAlpha: { value: 0 },
    hushLift: { value: 0 },
    hushInner: { value: new THREE.Color(0, 0, 0) },
  };
}

// Patches a MeshPhysicalMaterial with the hush gradient and rim. With `gemCut`, fragments of the
// abdomen's top inside the hex window are discarded (abdomen-local coordinates).
export function patchHush(material, uniforms, { gemCut = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (gemCut) shader.defines = { ...shader.defines, HUSH_GEM_CUT: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHushN;\nvarying vec3 vHushLocal;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvHushN = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHushLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vHushN;
varying vec3 vHushLocal;
uniform vec3 hushDeep, hushBody, hushHighlight, hushRimColor;
uniform float hushRimStrength, hushRimPower, hushRimAlpha, hushLift;
uniform vec3 hushInner;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
#ifdef HUSH_GEM_CUT
{
  vec2 g = abs(vHushLocal.xz - vec2(${GEM.x.toFixed(4)}, ${GEM.z.toFixed(4)}));
  if (vHushLocal.y > 0.0 && max(g.x, dot(g, vec2(0.5, 0.8660254))) < ${(GEM_APOTHEM - 0.004).toFixed(4)}) discard;
}
#endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // Body colour on the dorsal side shading to deep on the ventral side and at the silhouette.
  // The highlight colour is left to the speculars, sheen and rim.
  float up = normalize(vHushN).y;
  float facing = saturate(abs(dot(normalize(vNormal), normalize(vViewPosition))));
  vec3 grad = mix(hushDeep, hushBody, smoothstep(-0.7, 0.6, up) * smoothstep(0.0, 0.55, facing));
#ifdef HUSH_GEM_CUT
  // Abdomen: four faint forward-pointing chevrons behind the gem, darker cobalt.
  {
    vec3 q = vHushLocal;
    float mark = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float d = abs(q.x - (${(GEM.x - GEM.r - 0.05).toFixed(3)} - 0.075 * fk - 0.55 * abs(q.z)));
      float arm = 1.0 - smoothstep(0.05, 0.13 - 0.015 * fk, abs(q.z));
      mark = max(mark, (1.0 - smoothstep(0.006, 0.014, d)) * arm);
    }
    grad = mix(grad, hushDeep * 0.5, mark * smoothstep(0.05, 0.15, q.y) * 0.5);
  }
#endif
  // Lift: glass modes clear toward the highlight where the surface faces the viewer, keeping
  // deep edges, so the body reads as coloured glass rather than paint.
  diffuseColor.rgb *= mix(grad, hushHighlight, hushLift * facing * facing);
}`)
      .replace('#include <opaque_fragment>', `{
  float hushFr = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), hushRimPower);
  outgoingLight += hushRimColor * hushFr * hushRimStrength;
  float hushFace = saturate(abs(dot(normal, normalize(vViewPosition))));
  outgoingLight += hushInner * hushFace * hushFace * hushFace; // lit from within (glass modes)
  diffuseColor.a = saturate(diffuseColor.a + hushFr * hushRimAlpha);
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => (gemCut ? 'hush-cut' : 'hush');
  return material;
}

// Unlit glow: `core` where the surface faces the viewer, fading to `edge`, scaled by `intensity`.
// `haze` makes it an additive, depth-transparent volume whose edges fade to nothing.
// `refracted: false` marks it transparent (still fully opaque), which keeps it out of three's
// transmission buffer so glass limbs don't refract it into spots.
// `glow` (0 day → 1 night) fades between an unlit-looking enamel in `day` colour, shaded by a
// soft facing term so it reads as a solid part, and the luminous core→edge glow. Haze has no
// day look: it is pure added light, so it vanishes by day.
export function glowMaterial(core, edge, intensity, { haze = false, refracted = true, day = '#000000' } = {}) {
  return new THREE.ShaderMaterial({
    defines: haze ? { HAZE: '' } : {},
    transparent: haze || !refracted,
    depthWrite: !haze,
    blending: haze ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      core: { value: new THREE.Color(core) },
      edge: { value: new THREE.Color(edge) },
      intensity: { value: intensity },
      day: { value: new THREE.Color(day) },
      glow: { value: 0 },
    },
    vertexShader: `varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 core; uniform vec3 edge; uniform float intensity;
uniform vec3 day; uniform float glow;
varying vec3 vN; varying vec3 vV;
void main() {
  float f = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  vec3 lit = mix(edge, core, f * f) * intensity;
#ifdef HAZE
  vec3 c = lit * f * f * glow;
#else
  // Day enamel: darker at grazing angles, a soft sheen where it faces the viewer.
  vec3 enamel = day * (0.45 + 0.55 * f) + vec3(0.06) * pow(f, 8.0);
  vec3 c = mix(enamel, lit, glow);
#endif
  gl_FragColor = vec4(c, 1.0);
}`,
  });
}

// Flat-shaded copy (crisp facets).
function flat(geo) {
  const g = geo.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

// Concatenates position/normal of several geometries into one non-indexed geometry.
function merge(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o);
    nor.set(g.attributes.normal.array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
