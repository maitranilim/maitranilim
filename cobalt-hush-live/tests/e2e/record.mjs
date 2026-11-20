// Test-only movement review (not part of `npm run e2e`): for each flow, records a 10 s video
// (recordVideo, its own context) and a 6-frame contact sheet of crops round the spider, taken
// exactly 0.5 sim s apart (the sim pauses for each shot). Output: tests/e2e/out/record/.
//   node tests/e2e/record.mjs [flow...]   flows: wander startle feed steer
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'tests/e2e/out/record');
mkdirSync(outDir, { recursive: true });
const VIEW = { width: 1280, height: 800 };
const CROP = { width: 420, height: 300 };

const FLOWS = {
  // No input: bursts of walking and pauses.
  async wander() {},
  // A shy spider, a fast swipe across the deck near it.
  async startle(page, toScreen) {
    const a = await toScreen(-2.5, 1.2);
    const b = await toScreen(2.5, 1.2);
    await page.mouse.move(a.x, a.y);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.mouse.move(b.x, b.y);
  },
  async feed(page, toScreen) {
    await page.click('.hush-btn.feed');
    const p = await toScreen(1.8, 0.4);
    await page.mouse.click(p.x, p.y);
    await page.hover('.hush-btn.moults');
  },
  async steer(page, toScreen) {
    await page.click('.hush-seg [data-move="steer"]');
    const t = await toScreen(4, 1);
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(t.x, t.y, { steps: 3 });
    await page.mouse.up();
    await page.hover('.hush-btn.moults');
  },
};

async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto('http://localhost:4173/?test&seed=1');
  await page.waitForFunction(() => window.__hush?.ready === true && window.__hush.storageKind() !== 'pending', null, { timeout: 20000 });
  await page.hover('.hush-btn.moults'); // pointer off the deck
  await page.evaluate(() => window.__hush.resetSim(0, 0, 0));
  const toScreen = (x, z) => page.evaluate(([x, z]) => window.__hush.worldToScreen(x, z), [x, z]);
  return { page, toScreen };
}

async function video(browser, name) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, recordVideo: { dir: outDir, size: VIEW } });
  const { page, toScreen } = await open(context);
  await FLOWS[name](page, toScreen);
  await page.waitForTimeout(10000);
  const sim = await page.evaluate(() => window.__hush.simTime());
  const file = await page.video().path();
  await context.close();
  renameSync(file, path.join(outDir, `${name}.webm`));
  return sim;
}

async function sheet(browser, name) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const { page, toScreen } = await open(context);
  await FLOWS[name](page, toScreen);
  const frames = [];
  const t0 = await page.evaluate(() => window.__hush.simTime());
  for (let i = 0; i < 6; i++) {
    await page.evaluate((t) => { window.__hush.pauseAt(t); window.__hush.simSpeed(5); }, t0 + 0.5 * i);
    await page.waitForFunction(() => window.__hush.paused(), null, { timeout: 60000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const info = await page.evaluate(() => ({ s: window.__hush.spiderScreen(), b: window.__hush.body(), st: window.__hush.brainState(), t: window.__hush.simTime() }));
    const clip = {
      x: Math.round(Math.min(Math.max(0, info.s.x - CROP.width / 2), VIEW.width - CROP.width)),
      y: Math.round(Math.min(Math.max(0, info.s.y - CROP.height / 2), VIEW.height - CROP.height)),
      ...CROP,
    };
    const png = await page.screenshot({ clip });
    frames.push({ png: png.toString('base64'), label: `t+${(info.t - t0).toFixed(1)}s ${info.st} (${info.b.x.toFixed(2)}, ${info.b.z.toFixed(2)})` });
    await page.evaluate(() => window.__hush.pause(false));
  }
  await context.close();

  const board = await browser.newPage({ viewport: { width: CROP.width * 3, height: (CROP.height + 22) * 2 } });
  await board.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(3,${CROP.width}px);font:12px sans-serif;background:#222;color:#eee">${frames
    .map((f) => `<div><img src="data:image/png;base64,${f.png}" style="display:block"><div style="height:22px;line-height:22px;padding-left:6px">${f.label}</div></div>`)
    .join('')}</body>`);
  await board.screenshot({ path: path.join(outDir, `${name}-sheet.png`) });
  await board.close();
  return frames.map((f) => f.label);
}

const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs')], { cwd: root, stdio: 'ignore' });
let browser;
try {
  await new Promise((r) => setTimeout(r, 500));
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FLOWS);
  for (const name of names) {
    const sim = await video(browser, name);
    console.log(`record: ${name}.webm (10 s wall, ${sim.toFixed(2)} sim s)`);
    console.log(`record: ${name}-sheet.png\n  ` + (await sheet(browser, name)).join('\n  '));
  }
} finally {
  await browser?.close();
  server.kill();
}
