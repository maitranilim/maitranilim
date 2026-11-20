import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';
import { HIDEOUTS } from '../sim/deck.js';
import { createShellMesh } from './spiderMesh.js';

// Thin luminous silk, food motes, the lure glow and moult shells.
const DAY_SILK = new THREE.Color('#C7D5EE');
const NIGHT_SILK = new THREE.Color('#BFEFFF');
const WHITE = new THREE.Color('#FFFFFF');
const SILK_Y = 0.012;
const MAX_DRAG_SEGS = 600;
const WIRE_SUBDIV = 10;
const MAX_WIRES = 6;
const DRAG_LIFE = 40;
const RIPPLE_LIFE = 1.2;
const RIPPLE_REACH = 2.2; // how far a pulse travels along the threads
const MAT_RADIUS = 1.0;
const WING_HZ = 9;
const LURE_GROW = 0.3;
const MAX_SHELLS = 6;
const MAX_FOOD = 3;

function softTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// A moth's forewing: warm tan with a darker margin, faint veins and one eye-spot. Drawn root at
// the left edge so it hinges at the body.
function mothWingTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d');
  const wing = new Path2D('M4 48 C 30 18, 80 4, 124 14 C 118 46, 104 74, 70 88 C 40 90, 16 70, 4 48 Z');
  const fill = g.createLinearGradient(0, 48, 128, 48);
  fill.addColorStop(0, '#8A6238');
  fill.addColorStop(0.55, '#C9A574');
  fill.addColorStop(1, '#B08A58');
  g.fillStyle = fill;
  g.fill(wing);
  g.save();
  g.clip(wing);
  g.strokeStyle = 'rgba(80,52,28,0.45)';
  g.lineWidth = 1.5;
  for (const [x, y] of [[120, 16], [112, 50], [92, 76], [66, 86]]) {
    g.beginPath();
    g.moveTo(6, 48);
    g.quadraticCurveTo(50, 44, x, y);
    g.stroke();
  }
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(78,50,26,0.7)';
  g.stroke(wing); // darker margin
  g.restore();
  g.fillStyle = '#4A321C';
  g.beginPath();
  g.arc(80, 44, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#E8D3A8';
  g.beginPath();
  g.arc(80, 44, 4, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A line-segment buffer with per-vertex RGBA, drawn as thin translucent lines.
function segmentBuffer(maxSegs, y) {
  const pos = new Float32Array(maxSegs * 6);
  const col = new Float32Array(maxSegs * 8);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  let n = 0;
  return {
    lines,
    reset: () => (n = 0),
    // Pushes one segment; `a`/`b` are {x,z,alpha}; pulse(x,z) returns 0..1 brightness boost.
    push(a, b, base, pulse) {
      if (n >= maxSegs) return;
      for (let k = 0; k < 2; k++) {
        const p = k ? b : a;
        const i = (n * 2 + k) * 3;
        pos[i] = p.x;
        pos[i + 1] = y;
        pos[i + 2] = p.z;
        const boost = pulse(p.x, p.z);
        const j = (n * 2 + k) * 4;
        col[j] = lerp(base.r, 1, boost);
        col[j + 1] = lerp(base.g, 1, boost);
        col[j + 2] = lerp(base.b, 1, boost);
        col[j + 3] = clamp(p.alpha + boost * 0.8, 0, 1);
      }
      n++;
    },
    commit() {
      geo.setDrawRange(0, n * 2);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

function disposeMaterials(root) {
  const mats = new Set();
  root.traverse((o) => o.material && mats.add(o.material));
  for (const m of mats) m.dispose();
}

export function createFx(stage) {
  const scene = stage.scene;
  const root = new THREE.Group();
  root.name = 'fx';
  scene.add(root);

  // ---- silk ----
  const drag = segmentBuffer(MAX_DRAG_SEGS, SILK_Y);
  const wires = segmentBuffer(HIDEOUTS.length * MAX_WIRES * WIRE_SUBDIV, SILK_Y + 0.003);
  drag.lines.name = 'draglines';
  wires.lines.name = 'tripwires';
  root.add(drag.lines, wires.lines);

  const discTex = softTexture([[0, 'rgba(255,255,255,0.35)'], [0.7, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
  const discs = new Map();
  for (const h of HIDEOUTS) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(MAT_RADIUS, 40),
      new THREE.MeshBasicMaterial({ map: discTex, transparent: true, opacity: 0, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(h.entrance.x, SILK_Y - 0.004, h.entrance.z);
    m.visible = false;
    root.add(m);
    discs.set(h.id, m);
  }

  // ---- food: a small moth by day, a glowing mote by night ----
  // (lights are pre-created so the light count never changes)
  const moteTex = softTexture([[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
  const shadowTex = softTexture([[0, 'rgba(0,0,0,1)'], [0.45, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']]);
  const wingTex = mothWingTexture();
  const glowWingGeo = new THREE.PlaneGeometry(0.2, 0.1);
  glowWingGeo.translate(0.1, 0, 0);
  const dayWingGeo = new THREE.PlaneGeometry(0.26, 0.19);
  dayWingGeo.translate(0.13, 0, 0);
  const bodyGeo = new THREE.SphereGeometry(0.045, 14, 10);
  bodyGeo.scale(0.85, 0.75, 2.1); // a slim moth body along local z
  const shadowGeo = new THREE.PlaneGeometry(0.6, 0.5);
  shadowGeo.rotateX(-Math.PI / 2);
  const motes = [];
  for (let i = 0; i < MAX_FOOD; i++) {
    const g = new THREE.Group();
    g.scale.setScalar(1.4); // big enough to spot on the deck from the overview
    g.visible = false;
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#6E4A28', roughness: 0.75, emissive: new THREE.Color('#FFE3A3'), emissiveIntensity: 0 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: moteTex, color: '#FFD488', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    halo.scale.setScalar(0.32);
    g.add(body, halo);
    const dayWingMat = new THREE.MeshStandardMaterial({ map: wingTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.85 });
    const glowWingMat = new THREE.MeshBasicMaterial({ map: moteTex, color: '#FFF1CF', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const wings = [1, -1].map((side) => {
      const pivot = new THREE.Group();
      const hinge = new THREE.Group(); // flaps about the wing's own root edge
      const day = new THREE.Mesh(dayWingGeo, dayWingMat);
      day.rotation.x = -Math.PI / 2; // lies flat, hinged at the body
      day.castShadow = true;
      if (side < 0) day.scale.y = -1; // mirror the pattern for the left wing
      const glow = new THREE.Mesh(glowWingGeo, glowWingMat);
      glow.rotation.x = -Math.PI / 2;
      hinge.add(day, glow);
      pivot.add(hinge);
      pivot.rotation.y = side > 0 ? 0.35 : Math.PI - 0.35;
      pivot.userData.side = side;
      g.add(pivot);
      return pivot;
    });
    const light = new THREE.PointLight('#FFD79A', 0, 2.6, 2);
    light.position.y = 0.05;
    g.add(light);
    root.add(g);
    // A soft shadow on the deck so the moth reads as hovering, not pasted on.
    const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, color: '#1A2550', transparent: true, opacity: 0, depthWrite: false }));
    shadow.visible = false;
    root.add(shadow);
    motes.push({ group: g, wings, light, halo, body: bodyMat, dayWing: dayWingMat, glowWing: glowWingMat, shadow });
  }

  // ---- lure ----
  const lureTex = softTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
  const lureMat = new THREE.MeshBasicMaterial({ map: lureTex, color: '#BFF8FF', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const lureMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 40), lureMat);
  lureMesh.rotation.x = -Math.PI / 2;
  lureMesh.position.y = 0.016;
  lureMesh.visible = false;
  root.add(lureMesh);
  let lureT = 0;

  // ---- shells ----
  const shells = new Map(); // moult id -> Object3D
  let shellNight = 0; // the lights level the shells last faded to

  let time = 0;
  const silkColor = new THREE.Color();

  function updateSilk(silk, night) {
    silkColor.copy(DAY_SILK).lerp(NIGHT_SILK, night);
    const ripples = silk.ripples;
    const pulse = (x, z) => {
      let b = 0;
      for (const r of ripples) {
        const k = r.age / RIPPLE_LIFE;
        const d = Math.hypot(x - r.x, z - r.z);
        const e = (d - k * RIPPLE_REACH) / 0.28;
        b = Math.max(b, Math.exp(-e * e) * (1 - k));
      }
      return b;
    };
    const none = () => 0;
    const dayK = lerp(0.8, 1, night);

    drag.reset();
    const pts = silk.draglines;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 0.6) continue; // a jump, not a trail
      const fa = { x: a.x, z: a.z, alpha: Math.max(0, 1 - a.age / DRAG_LIFE) * 0.7 * dayK };
      const fb = { x: b.x, z: b.z, alpha: Math.max(0, 1 - b.age / DRAG_LIFE) * 0.7 * dayK };
      drag.push(fa, fb, silkColor, ripples.length ? pulse : none);
    }
    drag.commit();

    wires.reset();
    for (const h of HIDEOUTS) {
      const mat = silk.mats[h.id] ?? 0;
      const disc = discs.get(h.id);
      disc.visible = mat > 0.001;
      disc.material.opacity = mat * lerp(0.1, 0.07, night);
      disc.material.color.copy(silkColor);
      for (const s of silk.tripwires[h.id] ?? []) {
        for (let k = 0; k < WIRE_SUBDIV; k++) {
          const t0 = k / WIRE_SUBDIV;
          const t1 = (k + 1) / WIRE_SUBDIV;
          const p0 = { x: lerp(s.a.x, s.b.x, t0), z: lerp(s.a.z, s.b.z, t0), alpha: 0.7 * dayK };
          const p1 = { x: lerp(s.a.x, s.b.x, t1), z: lerp(s.a.z, s.b.z, t1), alpha: 0.7 * dayK };
          wires.push(p0, p1, silkColor, ripples.length ? pulse : none);
        }
      }
    }
    wires.commit();
  }

  function updateFood(food, night) {
    const items = food?.items ?? [];
    const day = 1 - night;
    motes.forEach((m, i) => {
      const it = items[i];
      m.group.visible = !!it;
      m.shadow.visible = !!it;
      m.light.intensity = 0;
      if (!it) return;
      const bob = 0.17 + 0.03 * Math.sin(time * 2.3 + i * 1.7);
      m.group.position.set(it.x, bob, it.z);
      m.group.rotation.y = 0.6 * Math.sin(time * 0.7 + i * 2.1); // drifts its heading a little
      const flap = Math.sin(time * Math.PI * 2 * WING_HZ + i);
      for (const w of m.wings) w.children[0].rotation.x = 0.15 + 0.7 * flap;
      // Day: an opaque little moth. Night: the same moth, glowing warm.
      m.dayWing.opacity = lerp(1, 0.35, night);
      m.glowWing.opacity = 0.4 * night;
      m.body.emissiveIntensity = 0.9 * night;
      m.halo.material.opacity = 0.5 * night;
      m.light.intensity = 0.7 * night;
      m.shadow.position.set(it.x, SILK_Y - 0.006, it.z);
      m.shadow.material.opacity = lerp(0.07, 0.3, day) * (1 - 0.6 * (bob - 0.14) / 0.06);
    });
  }

  function updateLure(lure, dt) {
    if (!lure) {
      lureT = 0;
      lureMesh.visible = false;
      return;
    }
    lureT = Math.min(LURE_GROW, lureT + dt);
    const k = lureT / LURE_GROW;
    const e = k * k * (3 - 2 * k);
    lureMesh.visible = true;
    lureMesh.position.x = lure.x;
    lureMesh.position.z = lure.z;
    lureMesh.scale.setScalar(Math.max(0.001, e * 0.9));
    lureMat.opacity = e * clamp(0.35 + 0.5 * (lure.strength ?? 1), 0, 0.85);
  }

  function updateShells(list, night) {
    const wanted = new Map();
    for (const s of (list ?? []).slice(0, MAX_SHELLS)) wanted.set(s.id, s);
    for (const [id, mesh] of shells) {
      if (wanted.has(id)) continue;
      mesh.removeFromParent();
      disposeMaterials(mesh); // fresh per-shell materials; geometry is shared
      shells.delete(id);
    }
    for (const [id, s] of wanted) {
      if (shells.has(id)) continue;
      const mesh = createShellMesh(s.shadeIndex);
      mesh.position.set(s.x, 0, s.z);
      mesh.rotation.y = -s.rot;
      mesh.userData.setNight(night);
      root.add(mesh);
      shells.set(id, mesh);
    }
    if (night !== shellNight) for (const mesh of shells.values()) mesh.userData.setNight(night);
    shellNight = night;
  }

  function update({ silk, food, shells: shellList, lure = null, night = 0, dt = 0 }) {
    const step = clamp(dt, 0, 0.05);
    time += step;
    if (silk) updateSilk(silk, night);
    updateFood(food, night);
    updateLure(lure, step);
    updateShells(shellList, night);
  }

  return { update, counts: () => ({ food: motes.filter((m) => m.group.visible).length, shells: shells.size }) };
}
