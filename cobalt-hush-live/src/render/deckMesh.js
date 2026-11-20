import * as THREE from 'three';
import { HIDEOUTS } from '../sim/deck.js';
import { mulberry32 } from '../core/math.js';

export const DECK_THICKNESS = 0.4;
const DECK_SIZE = { x: 16, z: 10 };
const DECK_CORNER = 0.9;
const CERAMIC = '#F4F5F8';
const SHADOW_NAVY = '#0B1235';

// Builds the white deck slab (top face at y = 0) and the five ceramic hideouts.
// Each hideout is modelled with its entrance along local +x, then turned to face HIDEOUTS[i].rot.
export function createDeck(scene) {
  // One soft studio-light falloff across the slab (bright centre, faintly cooler edges) keeps the
  // white from reading as flat CG without any visible texture.
  const deckMaterial = new THREE.MeshStandardMaterial({ color: '#FFFFFF', map: falloffTexture(), roughness: 0.9, metalness: 0 });
  const deck = new THREE.Mesh(deckGeometry(), deckMaterial);
  deck.name = 'deck';
  deck.receiveShadow = true;
  scene.add(deck);

  const ceramic = new THREE.MeshStandardMaterial({ color: CERAMIC, roughness: 0.55, metalness: 0 });
  const blobTexture = contactShadowTexture();
  const builders = { bark, stone, litter, moss, twig };

  const hideoutMeshes = {};
  for (const h of HIDEOUTS) {
    const group = new THREE.Group();
    group.name = `hideout-${h.id}`;
    const { meshes, blob } = builders[h.kind](h.r, ceramic);
    for (const m of meshes) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    group.add(contactShadow(blobTexture, h.r * blob.x, h.r * blob.z, blob.opacity));
    group.position.set(h.x, 0, h.z);
    group.rotation.y = -h.rot; // three's +y rotation turns +x toward -z; HIDEOUTS rot is atan2(z, x)
    scene.add(group);
    hideoutMeshes[h.id] = group;
  }
  return { hideoutMeshes };
}

function deckGeometry() {
  const hx = DECK_SIZE.x / 2;
  const hz = DECK_SIZE.z / 2;
  const bevel = 0.08;
  const geo = new THREE.ExtrudeGeometry(roundedRect(hx - bevel, hz - bevel, DECK_CORNER), {
    depth: DECK_THICKNESS - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 16,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.max.y, 0);
  return geo;
}

function roundedRect(hx, hz, r) {
  const s = new THREE.Shape();
  s.moveTo(-hx + r, -hz);
  s.lineTo(hx - r, -hz);
  s.quadraticCurveTo(hx, -hz, hx, -hz + r);
  s.lineTo(hx, hz - r);
  s.quadraticCurveTo(hx, hz, hx - r, hz);
  s.lineTo(-hx + r, hz);
  s.quadraticCurveTo(-hx, hz, -hx, hz - r);
  s.lineTo(-hx, -hz + r);
  s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
  return s;
}

// Extrudes `shape` (drawn in the local z/y cross-section plane) along local x, centred on x = 0.
function extrudeAlongX(shape, length, bevel) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 3,
    curveSegments: 40,
  });
  geo.translate(0, 0, -(length - 2 * bevel) / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

// Bark: a curled half-tube lying along x, so both open ends face along the entrance axis.
function bark(r, material) {
  const halfWidth = r * 0.72;
  const height = r * 0.62;
  const wall = 0.09;
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, halfWidth, height, 0, Math.PI, false);
  shape.absellipse(0, 0, halfWidth - wall, height - wall, Math.PI, 0, true);
  shape.closePath();
  const geo = extrudeAlongX(shape, r * 1.8, 0.035);
  // Taper the far end a touch so it reads as organic rather than machined.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = 0.92 + 0.08 * ((pos.getX(i) / (r * 0.9) + 1) / 2);
    pos.setY(i, pos.getY(i) * t);
    pos.setZ(i, pos.getZ(i) * t);
  }
  geo.computeVertexNormals();
  return { meshes: [new THREE.Mesh(geo, material)], blob: { x: 1.15, z: 0.9, opacity: 0.32 } };
}

// Stone: a flattened lathe dome whose widest lip overhangs an undercut base.
function stone(r, material) {
  const h = r * 0.58;
  const pts = [new THREE.Vector2(0, 0.0), new THREE.Vector2(r * 0.62, 0.0), new THREE.Vector2(r * 0.74, h * 0.06)];
  // Lip flare, then a superellipse dome up to the crown.
  pts.push(new THREE.Vector2(r * 0.9, h * 0.16), new THREE.Vector2(r * 0.98, h * 0.26));
  for (let i = 1; i <= 14; i++) {
    const a = (i / 14) * (Math.PI / 2);
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push(new THREE.Vector2(r * Math.pow(c, 0.7), h * 0.3 + h * 0.7 * Math.pow(s, 0.9)));
  }
  pts[pts.length - 1].x = 0;
  const geo = new THREE.LatheGeometry(pts, 64);
  geo.scale(1, 1, 0.84);
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.z = 0.1; // the overhang lifts on the entrance side (+x)
  mesh.position.y = 0.02;
  return { meshes: [mesh], blob: { x: 1.05, z: 0.95, opacity: 0.38 } };
}

// Leaf litter: seven thin bowed leaves heaped irregularly (fixed seed, so the pile never changes).
const LEAF_COUNT = 7;
const LITTER_SEED = 11;
function litter(r, material) {
  const len = r * 0.95;
  const width = r * 0.36;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(len * 0.45, width, len, 0);
  shape.quadraticCurveTo(len * 0.45, -width, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.015,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 24,
  });
  geo.translate(-len / 2, 0, 0);
  geo.rotateX(-Math.PI / 2); // lay the leaf flat: shape y -> -z, thickness -> y
  const rand = mulberry32(LITTER_SEED);
  const meshes = [];
  for (let i = 0; i < LEAF_COUNT; i++) {
    const dir = rand() * Math.PI * 2;
    const reach = r * 0.38 * Math.sqrt(rand());
    const m = new THREE.Mesh(geo, material);
    // Later leaves sit higher and lean more, so the heap rises toward its middle.
    m.position.set(Math.cos(dir) * reach, 0.03 + i * 0.035, Math.sin(dir) * reach);
    m.rotation.set((rand() - 0.5) * 0.6, rand() * Math.PI * 2, (rand() - 0.5) * (0.25 + i * 0.07), 'YXZ');
    m.scale.setScalar(0.8 + rand() * 0.25);
    meshes.push(m);
  }
  return { meshes, blob: { x: 1.05, z: 1.05, opacity: 0.3 } };
}

// Moss: a tuft of small spheres on a golden-angle spiral, larger and taller toward the middle.
function moss(r, material) {
  const geo = new THREE.SphereGeometry(1, 28, 18);
  const meshes = [];
  const count = 24;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const a = i * 2.399963;
    const d = Math.sqrt(t) * r * 0.78;
    const size = r * (0.3 - 0.17 * t);
    const m = new THREE.Mesh(geo, material);
    m.position.set(Math.cos(a) * d, size * (0.55 + 0.5 * (1 - t)), Math.sin(a) * d);
    m.scale.set(size, size * 0.9, size);
    meshes.push(m);
  }
  return { meshes, blob: { x: 1.15, z: 1.15, opacity: 0.4 } };
}

// Twig: a hollow cylinder on its side, its bore pointing at the entrance.
function twig(r, material) {
  const outer = r * 0.42;
  const inner = outer - 0.08;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = extrudeAlongX(shape, r * 2, 0.03);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = outer + 0.03;
  return { meshes: [mesh], blob: { x: 1.2, z: 0.62, opacity: 0.4 } };
}

// A soft radial contact shadow just above the deck: the AO that grounds each sculpture.
export function contactShadow(texture, sx, sz, opacity) {
  const mat = new THREE.MeshBasicMaterial({
    color: SHADOW_NAVY,
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  m.scale.set(sx, sz, 1);
  m.renderOrder = 1;
  m.name = 'contactShadow';
  return m;
}

export function contactShadowTexture() {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * 2 - 1;
      const y = ((j + 0.5) / n) * 2 - 1;
      const d = Math.min(1, Math.hypot(x, y));
      const a = Math.pow(1 - d * d, 2.2);
      const k = (j * n + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// A single radial falloff stretched over the whole top face. The extruded deck's top face is
// UV-mapped in world units (x, z within the slab), so repeat/offset map it once, edge to edge.
function falloffTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.72);
  grad.addColorStop(0, '#FFFFFF');
  grad.addColorStop(0.55, '#FBFCFE');
  grad.addColorStop(1, '#EAEEF6');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / DECK_SIZE.x, 1 / DECK_SIZE.z);
  t.offset.set(0.5, 0.5);
  return t;
}
