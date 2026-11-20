// Copies the three.js pieces we use into vendor/three (artifact CSP blocks most CDNs).
// three r187 no longer ships a .min build; three.module.js re-exports from three.core.js, so both are copied.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules/three');
const dst = path.join(root, 'vendor/three');

const copy = (from, to) => {
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to);
};

for (const f of ['three.module.js', 'three.core.js']) copy(path.join(src, 'build', f), path.join(dst, f));

const addons = [
  ...['EffectComposer', 'RenderPass', 'ShaderPass', 'MaskPass', 'Pass', 'UnrealBloomPass', 'OutputPass'].map((n) => `postprocessing/${n}.js`),
  ...['CopyShader', 'LuminosityHighPassShader', 'OutputShader'].map((n) => `shaders/${n}.js`),
];
for (const a of addons) copy(path.join(src, 'examples/jsm', a), path.join(dst, 'addons', a));
console.log('vendored three into vendor/three');
