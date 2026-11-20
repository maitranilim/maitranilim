import test from 'node:test';
import assert from 'node:assert/strict';
import { TIER_SETTINGS, cameraYaw, fitCamera, startTier, tierPixelRatio } from '../src/render/scene.js';
import { keyEvents } from '../src/app/inputBridge.js';

test('stepping quality down never raises the pixel count', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    const [high, medium, low] = ['high', 'medium', 'low'].map((t) => tierPixelRatio(t, dpr));
    assert.ok(high >= medium && medium >= low, `dpr ${dpr}: ${high} ${medium} ${low}`);
    assert.equal(medium, Math.min(dpr, 1.5));
    assert.equal(low, Math.min(dpr, 1));
  }
});

test('the camera fits the whole deck, its long axis along the long side of the screen', async () => {
  const THREE = await import('three');
  for (const aspect of [1280 / 800, 390 / 844]) {
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 200);
    fitCamera(camera, aspect);
    const ndc = (x, z) => new THREE.Vector3(x, 0, z).project(camera);
    for (const x of [-8, 8]) for (const z of [-5, 5]) {
      const p = ndc(x, z);
      assert.ok(Math.abs(p.x) <= 0.92 + 1e-6 && Math.abs(p.y) <= 0.92 + 1e-6, `aspect ${aspect}: corner ${x},${z} at ${p.x},${p.y}`);
    }
    // The deck's 16 u axis runs across a landscape screen and up a portrait one.
    const long = ndc(8, 0).sub(ndc(-8, 0));
    const portrait = aspect < 1;
    assert.ok(portrait ? Math.abs(long.y) > Math.abs(long.x) * 5 : Math.abs(long.x) > Math.abs(long.y) * 5, `aspect ${aspect}: long axis ${long.x},${long.y}`);
    // Screen -> ground round trip (what groundPoint does) lands back on the deck point.
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    for (const [x, z] of [[3, -2], [-6.5, 4], [0, 0]]) {
      const p = ndc(x, z);
      ray.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
      assert.ok(Math.hypot(hit.x - x, hit.z - z) < 1e-6, `aspect ${aspect}: ${x},${z} -> ${hit.x},${hit.z}`);
    }
  }
});

test('steering keys move the spider the way they point on screen, landscape and portrait', async () => {
  const THREE = await import('three');
  for (const aspect of [1280 / 800, 390 / 844]) {
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 200);
    fitCamera(camera, aspect);
    const screen = (x, z) => new THREE.Vector3(x, 0, z).project(camera);
    const from = screen(0, 0);
    for (const [key, v, want] of [['D', { dx: 1, dz: 0 }, [1, 0]], ['W', { dx: 0, dz: -1 }, [0, 1]]]) {
      const [{ dx, dz }] = keyEvents(v, 'steer', cameraYaw(aspect));
      const to = screen(dx, dz);
      const sx = to.x - from.x;
      const sy = to.y - from.y; // NDC y is up
      const along = sx * want[0] + sy * want[1];
      const across = Math.abs(sx * want[1] - sy * want[0]);
      assert.ok(along > 0 && across < along * 0.05, `aspect ${aspect.toFixed(2)} ${key}: screen move ${sx.toFixed(3)},${sy.toFixed(3)}`);
    }
  }
});

test('the start tier (R28): one above the remembered tier, phones no higher than medium, a test pin wins', () => {
  assert.equal(startTier({ remembered: 'low', coarse: false }), 'medium');
  assert.equal(startTier({ remembered: 'medium', coarse: false }), 'high');
  assert.equal(startTier({ remembered: 'high', coarse: true }), 'medium');
  assert.equal(startTier({ coarse: true }), 'medium');
  assert.equal(startTier({ coarse: false }), 'high');
  assert.equal(startTier({ remembered: 'high' }), 'high');
  assert.equal(startTier({ remembered: 'low', coarse: true }), 'medium');
  assert.equal(startTier({ remembered: 'bogus' }), 'high');
  assert.equal(startTier({ pin: 'low', remembered: 'high' }), 'low');
  assert.equal(startTier({ pin: 'high', coarse: true, remembered: 'low' }), 'high');
});

test('the low tier drops MSAA and renders transmission at half resolution', () => {
  assert.equal(TIER_SETTINGS.low.samples, 0);
  assert.equal(TIER_SETTINGS.low.transmission, 0.5);
  for (const t of ['high', 'medium']) {
    assert.ok(TIER_SETTINGS[t].samples > 0);
    assert.equal(TIER_SETTINGS[t].transmission, 1);
  }
});
