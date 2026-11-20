import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

// The five hiding spots as heavy, natural pieces in muted tones: curled bark, a granite boulder,
// a heap of dry leaves, a moss mound and a hollow log. Every texture is drawn procedurally on a
// canvas (fixed seeds, so the deck looks the same on every visit). Each builder takes the
// hideout's footprint radius and returns { meshes, blob } with the entrance along local +x, as
// createDeck expects.

// ---------- canvas textures ----------

function canvasTexture(w, h, draw, { color = true, repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 4;
  return t;
}

// Fine per-pixel grain, +-amount on each channel.
function grain(g, w, h, amount, rand) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (rand() - 0.5) * amount;
    img.data[i] += d;
    img.data[i + 1] += d;
    img.data[i + 2] += d;
  }
  g.putImageData(img, 0, 0);
}

// Bark: dark furrows running along u, lighter plates between them. `bump` draws the height map
// (furrows dark) instead of colour.
function barkTexture(bump) {
  return canvasTexture(512, 256, (g, w, h) => {
    const rand = mulberry32(bump ? 21 : 21); // same seed: colour and height line up
    g.fillStyle = bump ? '#B8B8B8' : '#6B4E33';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const y0 = rand() * h;
      const thick = 2 + rand() * 7;
      const shade = rand();
      g.strokeStyle = bump ? `rgba(20,20,20,${0.55 + shade * 0.4})` : `rgba(${38 + shade * 18},${26 + shade * 12},${16 + shade * 8},${0.55 + shade * 0.4})`;
      g.lineWidth = thick;
      g.beginPath();
      let y = y0;
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) {
        y += (rand() - 0.5) * 5;
        g.lineTo(x, y);
      }
      g.stroke();
      if (!bump && rand() < 0.5) { // a pale lichen-worn edge along some plates
        g.strokeStyle = 'rgba(160,138,108,0.22)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(0, y0 - thick);
        g.lineTo(w, y0 - thick + (rand() - 0.5) * 8);
        g.stroke();
      }
    }
    grain(g, w, h, bump ? 30 : 22, rand);
  }, { color: !bump, repeat: [1, 1] });
}

// End grain: concentric growth rings and a few radial checks, centred in the texture.
function endGrainTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const rand = mulberry32(5);
    const cx = w / 2;
    const cy = h / 2;
    g.fillStyle = '#C8A673';
    g.fillRect(0, 0, w, h);
    for (let r = 4; r < w * 0.7; r += 3 + rand() * 5) {
      g.strokeStyle = `rgba(122,86,48,${0.25 + rand() * 0.35})`;
      g.lineWidth = 1 + rand() * 1.6;
      g.beginPath();
      g.ellipse(cx + (rand() - 0.5) * 2, cy + (rand() - 0.5) * 2, r, r * 0.97, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = 'rgba(70,46,24,0.6)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const r0 = w * (0.15 + rand() * 0.2);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * w * 0.6, cy + Math.sin(a) * w * 0.6);
      g.stroke();
    }
    grain(g, w, h, 14, rand);
  });
}

// Granite: grey with dark and pale flecks and a hint of warm feldspar.
function graniteTexture(bump) {
  return canvasTexture(512, 256, (g, w, h) => {
    const rand = mulberry32(31);
    g.fillStyle = bump ? '#909090' : '#9A9DA2';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { // soft mottling
      const x = rand() * w;
      const y = rand() * h;
      const r = 12 + rand() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const c = rand() < 0.5 ? '70,72,78' : '170,172,176';
      grad.addColorStop(0, `rgba(${c},${0.15 + rand() * 0.15})`);
      grad.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (let i = 0; i < 2600; i++) { // flecks
      const k = rand();
      g.fillStyle = bump
        ? (k < 0.5 ? 'rgba(30,30,30,0.7)' : 'rgba(220,220,220,0.7)')
        : k < 0.45 ? 'rgba(48,50,56,0.75)' : k < 0.85 ? 'rgba(214,214,218,0.7)' : 'rgba(176,140,118,0.6)';
      const s = 0.8 + rand() * 2.2;
      g.fillRect(rand() * w, rand() * h, s, s);
    }
    grain(g, w, h, 18, rand);
  }, { color: !bump, repeat: [1, 1] });
}

// One dry leaf, drawn to fill the texture: blade, darker margin, midrib and side veins, a few
// spots. Placed by the leaf geometry's shape UVs.
function leafTexture(base, edge, seed) {
  return canvasTexture(256, 128, (g, w, h) => {
    const rand = mulberry32(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const grad = g.createRadialGradient(w * 0.45, h / 2, h * 0.1, w * 0.45, h / 2, w * 0.6);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, edge);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(60,38,20,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    g.lineWidth = 1.4;
    for (let i = 1; i < 8; i++) {
      const x = (i / 8) * w * 0.92;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(x, h / 2);
        g.quadraticCurveTo(x + w * 0.06, h / 2 + side * h * 0.2, x + w * 0.12, h / 2 + side * h * 0.42);
        g.stroke();
      }
    }
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(70,44,22,${0.15 + rand() * 0.3})`;
      g.beginPath();
      g.arc(rand() * w, rand() * h, 2 + rand() * 6, 0, Math.PI * 2);
      g.fill();
    }
    grain(g, w, h, 16, rand);
  });
}

// Moss: dense green fuzz.
function mossTexture(bump) {
  return canvasTexture(256, 256, (g, w, h) => {
    const rand = mulberry32(41);
    g.fillStyle = bump ? '#808080' : '#5B7536';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const k = rand();
      g.fillStyle = bump
        ? `rgba(${k < 0.5 ? '255,255,255' : '0,0,0'},0.35)`
        : k < 0.4 ? 'rgba(122,150,72,0.6)' : k < 0.75 ? 'rgba(62,86,34,0.55)' : 'rgba(150,170,92,0.45)';
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
    }
  }, { color: !bump, repeat: [2, 2] });
}

// ---------- geometry helpers ----------

// Extrudes `shape` (drawn in the local z/y cross-section plane) along local x, centred on x = 0.
// Group 0 is the two end caps, group 1 the walls.
function extrudeAlongX(shape, length, bevel, curveSegments = 40) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 3,
    curveSegments,
  });
  geo.translate(0, 0, -(length - 2 * bevel) / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

// Wall UVs that wrap round the length axis (u along x, v around), so bark furrows run lengthwise;
// cap UVs are centred so the end-grain rings sit on the axis.
function tubeUVs(geo, radius, capRadius) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const caps = geo.groups.find((gr) => gr.materialIndex === 0);
  const inCaps = (i) => caps && i >= caps.start && i < caps.start + caps.count;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (inCaps(i)) uv.setXY(i, z / (2 * capRadius) + 0.5, y / (2 * capRadius) + 0.5);
    else uv.setXY(i, x * 0.45, ((Math.atan2(y, z) + Math.PI) / (2 * Math.PI)) * radius * 2.2);
  }
  uv.needsUpdate = true;
}

// Per-vertex multiplier: walls on the inside (`isInner(y, z)`: the hollow of a curl or a bore)
// get `inner`, everything else 1. Values above 1 lighten the bark map (a pale cambium).
function innerTint(geo, isInner, inner) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = isInner(pos.getY(i), pos.getZ(i)) ? inner : [1, 1, 1];
    col.set(k, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// Smooth seeded noise from a few sine waves: enough to break up machined forms.
function waves(seed, count = 5) {
  const rand = mulberry32(seed);
  const terms = Array.from({ length: count }, () => ({
    f: [(rand() - 0.5) * 6, (rand() - 0.5) * 6, (rand() - 0.5) * 6],
    p: rand() * Math.PI * 2,
    a: 0.4 + rand() * 0.6,
  }));
  const total = terms.reduce((s, t) => s + t.a, 0);
  return (x, y, z) => terms.reduce((s, t) => s + t.a * Math.sin(t.f[0] * x + t.f[1] * y + t.f[2] * z + t.p), 0) / total;
}

// ---------- the pieces ----------

export function natureBuilders() {
  const barkMap = barkTexture(false);
  const barkBump = barkTexture(true);
  const bark = new THREE.MeshStandardMaterial({ map: barkMap, bumpMap: barkBump, bumpScale: 2.2, roughness: 0.95, vertexColors: true });
  const endGrain = new THREE.MeshStandardMaterial({ map: endGrainTexture(), roughness: 0.85 });
  const granite = new THREE.MeshStandardMaterial({ map: graniteTexture(false), bumpMap: graniteTexture(true), bumpScale: 1.2, roughness: 0.82, vertexColors: true });
  const leaves = [
    ['#B98F55', 'rgba(110,70,30,0.6)', 3],
    ['#A06A3C', 'rgba(90,50,24,0.6)', 4],
    ['#C7A469', 'rgba(130,92,44,0.55)', 5],
    ['#8E5A35', 'rgba(70,40,20,0.6)', 6],
  ].map(([base, edge, seed]) => new THREE.MeshStandardMaterial({ map: leafTexture(base, edge, seed), roughness: 0.9, side: THREE.DoubleSide }));
  const mossMap = mossTexture(false);
  const mossBump = mossTexture(true);
  const mossGreens = ['#FFFFFF', '#D9E6C2', '#B9C99E'].map((tint) => new THREE.MeshPhysicalMaterial({
    color: tint, map: mossMap, bumpMap: mossBump, bumpScale: 3, roughness: 1,
    sheen: 1, sheenColor: new THREE.Color('#B4CE84'), sheenRoughness: 0.75,
  }));
  const soil = new THREE.MeshStandardMaterial({ color: '#3A2E22', roughness: 1 });

  return {
    // Bark: a thick curl lying along x, both open ends along the entrance axis; furrowed outside,
    // pale cambium inside, end grain on the cut ends.
    bark(r) {
      const halfWidth = r * 0.8;
      const height = r * 0.7;
      const wall = 0.17;
      const shape = new THREE.Shape();
      shape.absellipse(0, 0, halfWidth, height, 0, Math.PI, false);
      shape.absellipse(0, 0, halfWidth - wall, height - wall, Math.PI, 0, true);
      shape.closePath();
      const geo = extrudeAlongX(shape, r * 1.85, 0.05, 48);
      const n = waves(7);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { // an organic, slightly twisted curl
        const x = pos.getX(i);
        const t = 0.9 + 0.1 * ((x / (r * 0.92) + 1) / 2) + 0.05 * n(x, 0, 0);
        pos.setY(i, pos.getY(i) * t);
        pos.setZ(i, pos.getZ(i) * t + 0.04 * Math.sin(x * 2.1));
      }
      geo.computeVertexNormals();
      tubeUVs(geo, (halfWidth + height) / 2, halfWidth);
      const hw = halfWidth - wall / 2;
      const hh = height - wall / 2;
      innerTint(geo, (y, z) => (z / hw) ** 2 + (y / hh) ** 2 < 1, [2.1, 1.85, 1.55]);
      return { meshes: [new THREE.Mesh(geo, [endGrain, bark])], blob: { x: 1.2, z: 0.95, opacity: 0.48 } };
    },

    // Stone: a granite boulder with an overhanging lip on the entrance side, darker near the base.
    stone(r) {
      const h = r * 0.72;
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r * 0.6, 0), new THREE.Vector2(r * 0.74, h * 0.06)];
      pts.push(new THREE.Vector2(r * 0.9, h * 0.16), new THREE.Vector2(r * 0.99, h * 0.27));
      for (let i = 1; i <= 16; i++) {
        const a = (i / 16) * (Math.PI / 2);
        pts.push(new THREE.Vector2(r * Math.pow(Math.cos(a), 0.65), h * 0.3 + h * 0.7 * Math.pow(Math.sin(a), 0.85)));
      }
      pts[pts.length - 1].x = 0;
      const geo = new THREE.LatheGeometry(pts, 72);
      const n = waves(13, 6);
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const k = 1 + 0.09 * n(x / r, y / r, z / r) + 0.04 * n(3 * x / r, 3 * y / r, 3 * z / r);
        pos.setXYZ(i, x * k, y * (1 + 0.06 * n(z / r, x / r, 0)), z * k * 0.86);
        const ao = 0.62 + 0.38 * Math.min(1, y / (h * 0.45)); // darker toward the deck
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
        // Projected from above (the lathe's own UVs streak radially across the crown).
        uv.setXY(i, x / (2 * r) + 0.5 + y * 0.35, z / (2 * r) + 0.5 + y * 0.2);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, granite);
      mesh.rotation.z = 0.12; // the overhang lifts on the entrance side (+x)
      mesh.position.y = 0.02;
      return { meshes: [mesh], blob: { x: 1.1, z: 0.98, opacity: 0.55 } };
    },

    // Leaf litter: eleven curled dry leaves in four autumn tones, heaped higher in the middle.
    litter(r) {
      const len = r * 1.0;
      const width = r * 0.4;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(len * 0.42, width, len, 0);
      shape.quadraticCurveTo(len * 0.42, -width, 0, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 28 });
      // Cap UVs are shape coordinates: map the blade (0..len, -w..w) onto the leaf texture.
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / len, uv.getY(i) / (2 * width) + 0.5);
      geo.translate(-len / 2, 0, 0);
      geo.rotateX(-Math.PI / 2); // flat: shape y -> -z, thickness -> y
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { // curl along the length, cup across it
        const u = pos.getX(i) / (len / 2);
        const v = pos.getZ(i) / width;
        pos.setY(i, pos.getY(i) + 0.13 * len * u * u + 0.32 * width * v * v);
      }
      geo.computeVertexNormals();
      const rand = mulberry32(11);
      const meshes = [];
      const count = 11;
      for (let i = 0; i < count; i++) {
        const dir = rand() * Math.PI * 2;
        const reach = r * 0.42 * Math.sqrt(rand()) * (1 - i / (count * 1.6));
        const m = new THREE.Mesh(geo, leaves[i % leaves.length]);
        m.position.set(Math.cos(dir) * reach, 0.02 + i * 0.03, Math.sin(dir) * reach);
        m.rotation.set((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * (0.2 + i * 0.05), 'YXZ');
        m.scale.setScalar(1.05 - i * 0.025 + rand() * 0.15);
        meshes.push(m);
      }
      return { meshes, blob: { x: 1.1, z: 1.1, opacity: 0.42 } };
    },

    // Moss: a soil-dark base under a dense, velvety mound of tufts.
    moss(r) {
      const meshes = [];
      const base = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), soil);
      base.scale.set(r * 0.92, r * 0.28, r * 0.92);
      meshes.push(base);
      const geo = new THREE.SphereGeometry(1, 24, 16);
      const count = 70;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const a = i * 2.399963;
        const d = Math.sqrt(t) * r * 0.82;
        const size = r * (0.25 - 0.14 * t);
        const m = new THREE.Mesh(geo, mossGreens[i % mossGreens.length]);
        m.position.set(Math.cos(a) * d, r * 0.1 + size * 0.4 + r * 0.32 * (1 - t) ** 1.5, Math.sin(a) * d);
        m.scale.set(size, size * 0.85, size);
        meshes.push(m);
      }
      return { meshes, blob: { x: 1.15, z: 1.15, opacity: 0.55 } };
    },

    // Hollow log: a thick barked tube on its side, bore toward the entrance, rings on the cut ends.
    twig(r) {
      const outer = r * 0.5;
      const inner = outer - 0.15;
      const shape = new THREE.Shape();
      shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const geo = extrudeAlongX(shape, r * 2.05, 0.04, 48);
      const n = waves(17);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { // a slightly irregular trunk, not a pipe
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const rr = Math.hypot(y, z);
        if (rr < outer - 0.07) continue; // keep the bore round
        const k = 1 + 0.06 * n(pos.getX(i), y * 3, z * 3);
        pos.setY(i, y * k);
        pos.setZ(i, z * k);
      }
      geo.computeVertexNormals();
      tubeUVs(geo, outer, outer);
      innerTint(geo, (y, z) => Math.hypot(y, z) < (outer + inner) / 2, [0.55, 0.5, 0.45]);
      const mesh = new THREE.Mesh(geo, [endGrain, bark]);
      mesh.position.y = outer + 0.02;
      return { meshes: [mesh], blob: { x: 1.25, z: 0.7, opacity: 0.55 } };
    },
  };
}
