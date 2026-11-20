import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'tests/e2e/out');
mkdirSync(outDir, { recursive: true });

// Waits for a couple of rendered frames (swiftshader is slow; render runs on rAF).
function settleFrames(page) {
  return page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

// Mean Rec. 709 luminance (0-1) of the stage canvas, sampled at 64x40.
function meanLuminance(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 40;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 64, 40);
      const d = g.getImageData(0, 0, 64, 40).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      resolve(sum / (255 * 64 * 40));
    };
    img.onerror = () => reject(new Error('canvas snapshot failed'));
    img.src = document.getElementById('stage').toDataURL('image/png');
  }));
}

// The sim clock (seconds). Swiftshader renders only a frame or two a second and the sim advances at
// most 0.05 s per tick, so flows speed the sim up (test-only) and measure their windows on its clock.
const simTime = (page) => page.evaluate(() => window.__hush.simTime());

// Runs the sim fast (20 ticks per frame) until `check` (run in the page with `arg`) holds or exactly
// `simSeconds` more sim time pass; the sim pauses at that mark (test-only pauseAt) so the window is
// read exactly, then resumes at one tick per frame. Returns { value, elapsed }.
async function simWait(page, simSeconds, check, arg, wallMs = 60000) {
  const t0 = await simTime(page);
  await page.evaluate((t) => {
    window.__hush.pauseAt(t);
    window.__hush.simSpeed(20);
  }, t0 + simSeconds);
  const end = Date.now() + wallMs;
  let value;
  for (;;) {
    value = await page.evaluate(check, arg);
    if (value || (await page.evaluate(() => window.__hush.paused())) || Date.now() > end) break;
    await page.waitForTimeout(100);
  }
  const elapsed = (await simTime(page)) - t0;
  await page.evaluate(() => {
    window.__hush.pause(false);
    window.__hush.simSpeed(1);
  });
  return { value, elapsed };
}

const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs')], { cwd: root, stdio: 'ignore' });
const errors = [];
let browser;
let failed = false;
try {
  await new Promise((r) => setTimeout(r, 500));
  browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto('http://localhost:4173/?test&seed=1');
  await page.waitForFunction(() => window.__hush?.ready === true, null, { timeout: 15000 });
  // The still shots below need the spider parked at the origin, so the sim waits for the live flows.
  await page.evaluate(() => {
    window.__hush.pause(true);
    window.__hush.resetSim(0, 0, -0.4);
  });
  await settleFrames(page);
  await page.screenshot({ path: path.join(outDir, 'day.png') });
  const dayLum = await meanLuminance(page);

  // UI: the intro title fades away, then the toolbar is checked at desktop and phone sizes.
  await page.waitForTimeout(3300);
  await settleFrames(page);
  await page.screenshot({ path: path.join(outDir, 'ui-day.png') });
  const barFits = () => page.evaluate(() => {
    const r = document.querySelector('.hush-bar').getBoundingClientRect();
    const small = [...document.querySelectorAll('.hush-bar .hush-btn')].filter((b) => b.getBoundingClientRect().height < 44);
    return { ok: r.left >= 0 && r.right <= innerWidth && small.length === 0, left: r.left, right: r.right, w: innerWidth };
  });
  let fit = await barFits();
  if (!fit.ok) throw new Error('toolbar overflows or has small targets at desktop: ' + JSON.stringify(fit));
  await page.setViewportSize({ width: 390, height: 844 });
  await settleFrames(page);
  await page.screenshot({ path: path.join(outDir, 'ui-phone.png') });
  fit = await barFits();
  if (!fit.ok) throw new Error('toolbar overflows or has small targets at 390px: ' + JSON.stringify(fit));
  await page.setViewportSize({ width: 1280, height: 800 });
  await settleFrames(page);

  const legCount = await page.evaluate(() => window.__hush.spider?.legCount);
  if (legCount !== 8) throw new Error(`spider.legCount is ${legCount}, expected 8`);

  // The spider stands at the origin, which the overview camera centres; crop it at native pixels.
  const spiderClip = { x: 440, y: 270, width: 400, height: 260 };
  const shot = async (name, clip) => {
    await settleFrames(page);
    await settleFrames(page);
    await page.screenshot({ path: path.join(outDir, name), clip });
  };
  for (const m of ['solid', 'translucent', 'ghost']) {
    await page.evaluate((mat) => window.__hush.setMaterial(mat), m);
    await shot(`spider-${m}.png`, spiderClip);
  }
  await page.evaluate(() => window.__hush.debugCamera('closeup'));
  for (const m of ['solid', 'ghost']) {
    await page.evaluate((mat) => window.__hush.setMaterial(mat), m);
    await shot(`closeup-${m}.png`);
  }
  await page.evaluate(() => window.__hush.setMaterial('translucent'));
  await shot('closeup-day.png');
  await page.evaluate(() => window.__hush.debugPose({ moult: { phase: 'roll', p: 0.7 } }));
  await shot('spider-moult.png');
  await page.evaluate(() => window.__hush.debugPose(null));
  await page.evaluate(() => window.__hush.debugCamera('default'));

  await page.evaluate(() => window.__hush.setLights('off'));
  await page.waitForTimeout(1800);
  await settleFrames(page);
  await page.screenshot({ path: path.join(outDir, 'night.png') });
  const nightLum = await meanLuminance(page);
  await shot('spider-night.png', spiderClip);
  await page.evaluate(() => window.__hush.debugCamera('closeup'));
  await shot('closeup-night.png');
  await page.evaluate(() => window.__hush.debugCamera('default'));

  // Effects: a food mote, a full silk mat and one moult shell, at night.
  await page.evaluate(() => window.__hush.dropFood(2, 0));
  await page.evaluate(() => window.__hush.debugSilk());
  await page.evaluate(() => window.__hush.debugMoult());
  await settleFrames(page);
  await settleFrames(page);
  const counts = await page.evaluate(() => window.__hush.counts());
  if (counts.food !== 1) throw new Error(`food count ${counts.food}, expected 1`);
  if (counts.tripwires !== 6) throw new Error(`tripwire count ${counts.tripwires}, expected 6`);
  if (counts.shells !== 1) throw new Error(`shell count ${counts.shells}, expected 1`);
  await page.screenshot({ path: path.join(outDir, 'fx-night.png') });

  await page.evaluate(() => window.__hush.uiSetNight(1));
  await page.evaluate(() => window.__hush.uiOpenMoults());
  await page.waitForTimeout(500);
  await settleFrames(page);
  await page.screenshot({ path: path.join(outDir, 'ui-panel.png') });
  await page.evaluate(() => window.__hush.uiOpenMoults());
  await settleFrames(page);
  await page.screenshot({ path: path.join(outDir, 'ui-night.png') });

  // ---- live sim flows ----
  const hush = (fn, arg) => page.evaluate(fn, arg);
  const toScreen = (x, z) => hush(([x, z]) => window.__hush.worldToScreen(x, z), [x, z]);
  // Parks the spider at the origin (fresh brain, no food) so each flow starts from the same place.
  // Setup (clicks, moves) runs at one tick per frame: each page round trip waits on a slow frame.
  const reset = (heading = 0) => hush((h) => {
    window.__hush.simSpeed(1);
    window.__hush.resetSim(0, 0, h);
  }, heading);
  // Moving onto a toolbar button takes the pointer off the deck, so the next click arrives as a
  // still pointer rather than a fast swipe across the spider.
  const offDeck = () => page.hover('.hush-btn.moults');
  await hush(() => {
    window.__hush.setLights('on');
    window.__hush.pause(false);
  });

  // poke lowers trust: three clicks on the spider within 2 s. The position is read once; at one
  // tick per frame the spider moves < 0.3 u meanwhile.
  await reset();
  await offDeck();
  await settleFrames(page);
  const trust0 = await hush(() => window.__hush.state().trust);
  const spiderAt = await hush(() => window.__hush.spiderScreen());
  const pokeStart = Date.now();
  for (let i = 0; i < 3; i++) await page.mouse.click(spiderAt.x, spiderAt.y);
  const pokeMs = Date.now() - pokeStart;
  await settleFrames(page);
  const trust1 = await hush(() => window.__hush.state().trust);
  console.log(`smoke: poke trust ${trust0.toFixed(2)} -> ${trust1.toFixed(2)} (${pokeMs} ms)`);
  if (pokeMs > 2000) throw new Error(`pokes took ${pokeMs} ms, expected within 2 s`);
  if (!(trust0 - trust1 >= 2)) throw new Error(`poke dropped trust by ${(trust0 - trust1).toFixed(2)}, expected at least 2`);

  // feed flow: arm Feed, tap the deck at (2, 0); the spider stalks, pounces and eats.
  await reset();
  const sat0 = await hush(() => window.__hush.state().satiety);
  await page.click('.hush-btn.feed');
  const foodAt = await toScreen(2, 0);
  await page.mouse.click(foodAt.x, foodAt.y);
  const fed = await simWait(page, 10, (s0) => window.__hush.state().satiety > s0 && window.__hush.counts().food === 0, sat0);
  console.log(`smoke: feed ${fed.value ? 'eaten' : 'NOT eaten'} after ${fed.elapsed.toFixed(1)} sim s`);
  if (!fed.value) throw new Error('food not eaten within 10 sim s: ' + JSON.stringify(await hush(() => ({ s: window.__hush.state().satiety, c: window.__hush.counts(), b: window.__hush.brainState() }))));

  // keyboard feed: with Feed armed, Enter on the Feed button drops food in front of the spider.
  await reset();
  await page.click('.hush-btn.feed'); // arms it; focus stays on the button
  await page.keyboard.press('Enter');
  await settleFrames(page);
  const keyFed = await hush(() => ({
    food: window.__hush.counts().food,
    armed: document.querySelector('.hush-btn.feed').getAttribute('aria-pressed'),
    label: document.getElementById('stage').getAttribute('aria-label'),
  }));
  console.log(`smoke: keyboard feed food ${keyFed.food}, armed ${keyFed.armed}`);
  if (keyFed.food !== 1 || keyFed.armed !== 'false') throw new Error('keyboard feed: ' + JSON.stringify(keyFed));
  if (!keyFed.label?.startsWith('Cobalt Hush — an interactive cobalt tarantula.')) throw new Error(`canvas aria-label ${keyFed.label}`);

  // steer toggle: Steer, then drag from the centre to (4, 0). Trust is preset to settled (40): a shy
  // spider steers at ~0.68 u/s with a 0.4 s pause every 2 s, which needs ~5.7 s for 3 u and leaves
  // the 6 s window no margin.
  await hush(() => window.__hush.setTrust(40));
  await reset();
  await page.click('.hush-seg [data-move="steer"]');
  const steerTo = await toScreen(4, 0);
  await page.mouse.move(640, 400);
  // The window includes the drag itself (at one tick per frame, as on a real device).
  const steerStart = await simTime(page);
  await page.mouse.down();
  await page.mouse.move(steerTo.x, steerTo.y, { steps: 3 });
  await page.mouse.up();
  const dragged = (await simTime(page)) - steerStart;
  const steered = await simWait(page, Math.max(0, 6 - dragged), () => window.__hush.body().x > 3);
  const steerX = await hush(() => window.__hush.body().x);
  const steerS = dragged + steered.elapsed;
  console.log(`smoke: steer x ${steerX.toFixed(2)} after ${steerS.toFixed(1)} sim s (drag ${dragged.toFixed(1)})`);
  if (!steered.value || steerS > 6) throw new Error(`steered body x ${steerX.toFixed(2)} not above 3 within 6 sim s`);

  // lure: trust 80, Lure, press and hold at (-3, 0) for 5 sim s.
  await hush(() => window.__hush.setTrust(80));
  await reset();
  await page.click('.hush-seg [data-move="lure"]');
  const lureAt = await toScreen(-3, 0);
  await page.mouse.move(lureAt.x, lureAt.y);
  // The press runs at one tick per frame until the hold registers (350 ms), then fast to 5 s.
  const lureStart = await simTime(page);
  await page.mouse.down();
  await page.waitForFunction(() => window.__hush.brainState() === 'seekLure', null, { timeout: 30000 });
  await hush((t) => {
    window.__hush.pauseAt(t);
    window.__hush.simSpeed(20);
  }, lureStart + 5);
  await page.waitForFunction(() => window.__hush.paused(), null, { timeout: 60000 });
  const lureX = await hush(() => window.__hush.body().x);
  const lureS = (await simTime(page)) - lureStart;
  await page.mouse.up();
  await hush(() => {
    window.__hush.pause(false);
    window.__hush.simSpeed(1);
  });
  console.log(`smoke: lure x ${lureX.toFixed(2)} after ${lureS.toFixed(1)} sim s`);
  if (!(lureX < -2.4)) throw new Error(`lured body x ${lureX.toFixed(2)} not below -2.4`);

  // persistence: trust survives a reload (localStorage tier, since `claude` is absent locally), and
  // a visitor who left the lights off sees night from the very first visible frame.
  await hush(() => window.__hush.pause(true));
  await hush(() => window.__hush.setLights('off'));
  const kept = await hush(() => window.__hush.state().trust);
  await page.reload();
  await page.waitForFunction(() => window.__hush?.ready === true && window.__hush.storageKind() !== 'pending', null, { timeout: 15000 });
  const reloaded = await hush(() => ({ trust: window.__hush.state().trust, kind: window.__hush.storageKind(), revealNight: window.__hush.revealNight() }));
  console.log(`smoke: persistence trust ${kept.toFixed(2)} -> ${reloaded.trust.toFixed(2)} (${reloaded.kind}), first frame night ${reloaded.revealNight}`);
  if (reloaded.revealNight !== 1) throw new Error(`lights-off visitor: first visible frame at night level ${reloaded.revealNight}, expected 1`);
  // ... and the page is night before any script file loads: with a lights-off save and three.js
  // and main.js blocked, only the head script runs.
  const bareCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await bareCtx.addInitScript(() => localStorage.setItem('cobalt-hush-live:v1', JSON.stringify({ v: 1, settings: { lights: 'off' } })));
  const bare = await bareCtx.newPage();
  await bare.route(/\/(vendor|src)\/.*\.js$/, (r) => r.abort());
  await bare.goto('http://localhost:4173/?test&seed=1', { waitUntil: 'domcontentloaded' });
  const bareBg = await bare.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await bareCtx.close();
  console.log(`smoke: page background before boot ${bareBg}`);
  if (bareBg !== 'rgb(5, 8, 26)') throw new Error(`lights-off visitor: page background before boot ${bareBg}, expected night`);
  if (reloaded.kind !== 'local') throw new Error(`storage kind ${reloaded.kind}, expected local`);
  if (!(Math.abs(reloaded.trust - kept) <= 0.5)) throw new Error(`trust after reload ${reloaded.trust}, expected ${kept} ± 0.5`);

  // resize keeps canvas full-window.
  await page.setViewportSize({ width: 390, height: 844 });
  await settleFrames(page);
  await settleFrames(page);
  const size = await hush(() => {
    const c = document.getElementById('stage');
    return { w: c.clientWidth, h: c.clientHeight, aspect: window.__hush.cameraAspect() };
  });
  await page.screenshot({ path: path.join(outDir, 'phone.png') });
  if (size.w !== 390 || size.h !== 844) throw new Error('canvas not full-window at 390x844: ' + JSON.stringify(size));
  if (Math.abs(size.aspect - 390 / 844) > 1e-6) throw new Error('camera aspect not updated: ' + JSON.stringify(size));

  // portrait: the camera turns so the deck's long (x) axis runs up the screen, and a drag still
  // steers to the deck point under the finger (groundPoint follows the turned camera).
  await hush(() => window.__hush.setTrust(40));
  await reset(Math.PI); // facing -x, so the window measures the steering, not a turn-around
  await page.click('.hush-seg [data-move="steer"]');
  const pFrom = await toScreen(0, 0);
  const pTo = await toScreen(-4, 0);
  if (!(Math.abs(pTo.y - pFrom.y) > 4 * Math.abs(pTo.x - pFrom.x))) throw new Error(`deck x axis not vertical in portrait: ${JSON.stringify([pFrom, pTo])}`);
  await page.mouse.move(pFrom.x + 30, pFrom.y);
  const pStart = await simTime(page);
  await page.mouse.down();
  await page.mouse.move(pTo.x, pTo.y, { steps: 3 });
  await page.mouse.up();
  const pDrag = (await simTime(page)) - pStart;
  const pSteer = await simWait(page, Math.max(0, 6 - pDrag), () => window.__hush.body().x < -3);
  const pX = await hush(() => window.__hush.body().x);
  console.log(`smoke: portrait steer x ${pX.toFixed(2)} after ${(pDrag + pSteer.elapsed).toFixed(1)} sim s`);
  if (!pSteer.value) throw new Error(`portrait steer: body x ${pX.toFixed(2)} not below -3 within 6 sim s`);

  // portrait keys: D walks the spider screen-right although the camera is turned 90°.
  await reset(-Math.PI / 2); // world -z, which is screen-right in portrait
  await page.evaluate(() => document.activeElement?.blur()); // keys on the toolbar belong to it
  const kFrom = await hush(() => window.__hush.spiderScreen());
  await page.keyboard.down('KeyD');
  await simWait(page, 1.5, () => false);
  await page.keyboard.up('KeyD');
  const kTo = await hush(() => window.__hush.spiderScreen());
  const kdx = kTo.x - kFrom.x;
  const kdy = kTo.y - kFrom.y;
  console.log(`smoke: portrait key D moved ${kdx.toFixed(0)},${kdy.toFixed(0)} px`);
  if (!(kdx > 25 && Math.abs(kdy) < 0.5 * kdx)) throw new Error(`portrait key D moved the spider ${kdx.toFixed(0)},${kdy.toFixed(0)} px, expected screen-right`);

  // perf: reported, not asserted (swiftshader is slow).
  console.log(`smoke: quality ${await hush(() => window.__hush.quality())}`);

  // storage blocked: localStorage throws in a fresh context; the page still runs, in memory.
  const blocked = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  const page2 = await blocked.newPage();
  const errors2 = [];
  page2.on('console', (m) => { if (m.type() === 'error') errors2.push('console: ' + m.text()); });
  page2.on('pageerror', (e) => errors2.push('pageerror: ' + e.message));
  await page2.goto('http://localhost:4173/?test&seed=1');
  await page2.waitForFunction(() => window.__hush?.ready === true && window.__hush.storageKind() !== 'pending', null, { timeout: 15000 });
  await settleFrames(page2);
  const kind2 = await page2.evaluate(() => window.__hush.storageKind());
  await blocked.close();
  console.log(`smoke: blocked storage kind ${kind2}`);
  if (errors2.length) throw new Error('blocked-storage page errors:\n' + errors2.join('\n'));
  if (kind2 !== 'memory') throw new Error(`blocked storage kind ${kind2}, expected memory`);

  // no WebGL: a calm centred note instead of the terrarium, and no page errors.
  const noGl = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await noGl.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/.test(type) ? null : getContext.call(this, type, ...rest);
    };
  });
  const page3 = await noGl.newPage();
  const errors3 = [];
  page3.on('pageerror', (e) => errors3.push('pageerror: ' + e.message));
  await page3.goto('http://localhost:4173/?test&seed=1');
  await page3.waitForSelector('.hush-notice', { timeout: 15000 });
  const note = await page3.evaluate(() => ({
    text: document.querySelector('.hush-notice').textContent,
    visible: getComputedStyle(document.querySelector('.hush-notice')).visibility,
  }));
  await page3.screenshot({ path: path.join(outDir, 'no-webgl.png') });
  await noGl.close();
  console.log(`smoke: no-WebGL note "${note.text}" (${note.visible})`);
  if (note.text !== 'Cobalt Hush needs WebGL to run. Try another browser or device.' || note.visible !== 'visible') throw new Error('no-WebGL note: ' + JSON.stringify(note));
  if (errors3.length) throw new Error('no-WebGL page errors:\n' + errors3.join('\n'));

  console.log(`smoke: luminance day ${dayLum.toFixed(3)} night ${nightLum.toFixed(3)}`);
  if (!(dayLum > 0.8)) throw new Error(`day luminance ${dayLum.toFixed(3)} not above 0.8`);
  if (!(nightLum < 0.25)) throw new Error(`night luminance ${nightLum.toFixed(3)} not below 0.25`);
  if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  console.log('smoke: PASS');
} catch (e) {
  failed = true;
  console.error('smoke: FAIL', e.message);
} finally {
  await browser?.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
