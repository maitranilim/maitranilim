import * as THREE from 'three';
import { HIDEOUTS } from '../sim/deck.js';
import { natureBuilders } from './nature.js';

export const DECK_THICKNESS = 0.4;
const DECK_SIZE = { x: 16, z: 10 };
const DECK_CORNER = 0.9;
const SHADOW_NAVY = '#0B1235';

// Builds the white deck slab (top face at y = 0) and the five natural hideouts (see nature.js).
// Each hideout is modelled with its entrance along local +x, then turned to face HIDEOUTS[i].rot.
export function createDeck(scene) {
  // One soft studio-light falloff across the slab (bright centre, faintly cooler edges) keeps the
  // white from reading as flat CG without any visible texture.
  const deckMaterial = new THREE.MeshStandardMaterial({ color: '#FFFFFF', map: falloffTexture(), roughness: 0.9, metalness: 0 });
  const deck = new THREE.Mesh(deckGeometry(), deckMaterial);
  deck.name = 'deck';
  deck.receiveShadow = true;
  scene.add(deck);

  const blobTexture = contactShadowTexture();
  const builders = natureBuilders();

  const hideoutMeshes = {};
  for (const h of HIDEOUTS) {
    const group = new THREE.Group();
    group.name = `hideout-${h.id}`;
    const piece = new THREE.Group(); // the piece itself, lifted while carried; its shadow stays put
    const { meshes, blob } = builders[h.kind](h.r);
    for (const m of meshes) {
      m.castShadow = true;
      m.receiveShadow = true;
      piece.add(m);
    }
    group.add(piece, contactShadow(blobTexture, h.r * blob.x, h.r * blob.z, blob.opacity));
    group.userData.piece = piece;
    scene.add(group);
    hideoutMeshes[h.id] = group;
    placeHideout(h.id, h.x, h.z, h.rot);
  }

  // Moves a hideout's meshes (`lift` raises the piece above its shadow while it is carried).
  function placeHideout(id, x, z, rot, lift = 0) {
    const group = hideoutMeshes[id];
    if (!group) return;
    group.position.set(x, 0, z);
    group.rotation.y = -rot; // three's +y rotation turns +x toward -z; HIDEOUTS rot is atan2(z, x)
    group.userData.piece.position.y = lift;
  }
  return { hideoutMeshes, placeHideout };
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
