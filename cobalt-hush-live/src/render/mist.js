import * as THREE from 'three';
import { clamp, damp, lerp, mulberry32 } from '../core/math.js';
import { SPIDER_SCALE } from '../sim/gait.js';

// Soft additive mist that orbits loosely around the spider and thickens at night.
export const MIST_COUNTS = { high: 600, medium: 300, low: 120 };
const MAX = MIST_COUNTS.high;
// Orbit radius (with the wobble, <= 12%, every mote stays within 1.2 x scale) and height, at the spider's scale.
const RADIUS = [0.25 * SPIDER_SCALE, 1.05 * SPIDER_SCALE];
const HEIGHT = [0.04, 0.75 * SPIDER_SCALE];
const OPACITY = { day: 0, night: 0.2 }; // mist is glow: none by day
const FOLLOW = 3; // how quickly the cloud's centre catches up with the spider (1/s)

export function createMist(scene, quality = 'high', { reducedMotion = false } = {}) {
  const rng = mulberry32(5);
  const particles = [];
  for (let i = 0; i < MAX; i++) {
    const r = lerp(RADIUS[0], RADIUS[1], Math.sqrt(rng()));
    particles.push({
      r,
      a: rng() * Math.PI * 2,
      y: lerp(HEIGHT[0], HEIGHT[1], rng() ** 1.6),
      w: (0.08 + rng() * 0.22) * (rng() < 0.5 ? -1 : 1) / r, // slower far out
      bob: rng() * Math.PI * 2,
      wobble: 0.04 + rng() * 0.08,
    });
  }
  const positions = new Float32Array(MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.PointsMaterial({
    color: '#9FDFFF',
    map: spriteTexture(),
    size: 0.55, // large, faint sprites read as haze rather than grains
    sizeAttenuation: true,
    transparent: true,
    opacity: OPACITY.day,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.name = 'mist';
  points.frustumCulled = false;
  scene.add(points);

  const centre = { x: 0, z: 0, init: false };
  let time = 0;
  setCount(MIST_COUNTS[quality] ?? MAX);

  function update(spiderPos, night, dt) {
    const step = clamp(dt, 0, 0.05);
    if (!centre.init) {
      Object.assign(centre, { x: spiderPos.x, z: spiderPos.z, init: true });
    } else {
      centre.x = damp(centre.x, spiderPos.x, FOLLOW, step);
      centre.z = damp(centre.z, spiderPos.z, FOLLOW, step);
    }
    if (!reducedMotion) time += step;
    const n = geo.drawRange.count;
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      const a = p.a + p.w * time;
      const wob = 1 + p.wobble * Math.sin(time * 0.7 + p.bob);
      positions[i * 3] = centre.x + Math.cos(a) * p.r * wob;
      positions[i * 3 + 1] = p.y + 0.05 * Math.sin(time * 0.5 + p.bob);
      positions[i * 3 + 2] = centre.z + Math.sin(a) * p.r * wob;
    }
    geo.attributes.position.needsUpdate = true;
    material.opacity = lerp(OPACITY.day, OPACITY.night, clamp(night, 0, 1));
    points.visible = material.opacity > 0.002;
  }

  function setCount(n) {
    geo.setDrawRange(0, clamp(Math.round(n), 0, MAX));
  }

  return { points, update, setCount };
}

function spriteTexture() {
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  for (let i = 0; i <= 8; i++) { // gaussian falloff, faint at the centre so overlaps read as haze
    const t = i / 8;
    grad.addColorStop(t, `rgba(255,255,255,${(0.42 * Math.exp(-4.5 * t * t) * (1 - t)).toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
