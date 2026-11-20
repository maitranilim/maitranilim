import test from 'node:test';
import assert from 'node:assert/strict';

// 32-bit float textures can only be sampled with linear filtering where OES_texture_float_linear
// exists (many phones lack it: the env map would read black). Half float filters everywhere.
test('the studio environment is a half-float texture with the HDR values intact', async () => {
  const THREE = await import('three');
  const { studioEnvironment } = await import('../src/render/spiderParts.js');
  const tex = studioEnvironment();
  assert.equal(tex.type, THREE.HalfFloatType);
  assert.ok(tex.image.data instanceof Uint16Array);
  assert.equal(tex.magFilter, THREE.LinearFilter);
  const values = Array.from(tex.image.data, (h) => THREE.DataUtils.fromHalfFloat(h));
  assert.ok(values.reduce((m, v) => Math.max(m, v), 0) > 8, 'softbox highlights stay brighter than 1');
  assert.ok(values.every((v) => Number.isFinite(v) && v >= 0));
});
