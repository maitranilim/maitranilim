# Cobalt Hush: Live — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private claude.ai artifact page where a procedurally built, glowing, glassy cobalt tarantula lives on a white deck and reacts to the cursor or touch. You can feed it, lure or steer it, and switch the lights. It also builds trust, silk and moults that persist.

**Architecture:** Simulation and rendering are kept separate. `src/sim/*` and `src/core/*` are pure ES modules with no DOM or three.js imports. They are unit-tested with `node --test`. `src/render/*` turns sim state into a three.js scene (with bloom post-processing) every frame. `src/main.js` runs one loop: input → sim tick → render. three.js is vendored into `vendor/three/` and mapped with an import map, so the published artifact loads only its own files.

**Tech Stack:** Vanilla ES modules, three.js r0.187.0 (vendored from npm), EffectComposer + UnrealBloomPass + OutputPass, node:test, Playwright (pre-installed Chromium) for smoke tests, artifact `db` + `user` capabilities for saving.

**Spec:** `docs/superpowers/specs/2026-11-19-cobalt-hush-live-design.md`

**Project root:** `/tmp/claude-0/-home-user-maitranilim/a9c9d1e6-8707-57c2-8371-2d14d17d32d3/scratchpad/cobalt-hush-live` (its own local git repo; nothing is pushed anywhere, since the user's GitHub profile repo is the wrong home for this).

## Global Constraints

- The page must load nothing from outside except Google Fonts (Orbitron 500/700, Inter 400/500). All JavaScript is the page's own files (artifact CSP).
- The page must not use alert/confirm/prompt, downloads, window.open or service workers (sandboxed frame).
- Every storage call is wrapped in try/catch. The page runs fully with no storage.
- World units: deck spans x ∈ [-8, 8], z ∈ [-5, 5], y up. The spider's body is about 1.4 units long. All sim numbers below use these units and seconds.
- Palette (from the original art): cobalt `#2341B8`, highlight `#8FB0FF`, deep `#0E1A5C`, shadow navy `#0B1235`, amber `#FFB547`/`#C96A12`, cyan glow `#3DF5FF`, gem core `#E9FFFF`. Day background `#F7F8FB`, deck `#FFFFFF`. Night background `#05081A`, deck `#0A0F2A`.
- No cartoon features: no eyes with pupils, no mouth, no squash-and-stretch. Movement is bursty but never lunges toward the pointer.
- Simulation `dt` is clamped to ≤ 0.05 s per tick.
- Title copy: "COBALT HUSH" (Orbitron 700, uppercase, letter-spacing 0.22em). Control labels: "Lights", "Feed", "Solid" / "Translucent" / "Ghost", "Lure" / "Steer", "Moults".
- Respect `prefers-reduced-motion`: mist does not drift, the camera does not ease, and bloom does not pulse.

## Review Focus

1. **No saving available** (signed-out friend, `localStorage` throws, `claude.use` missing or resolving `null`): the page runs fully without errors and progress lasts only for the session. → Task 2 test `storage falls back to memory when everything throws`.
2. **Corrupt or old saved state** (missing fields, `NaN` trust, unknown `v`, wrong types): migrated to safe defaults with no crash, and valid fields are kept. → Task 2 test `migrate repairs bad fields`.
3. **Long tab sleep** (hours away, then a huge `dt`): no teleporting or flee burst. Offline time is applied once, to satiety digestion only. → Task 5 test `huge dt is clamped`. Task 2 test `applyOffline digests satiety only`.
4. **Pointer leaves the canvas, or window resize / phone rotation:** the pointer becomes `null`, the spider calms down, and the camera aspect updates. → Task 5 test `null pointer calms to wander`. Task 11 e2e `resize keeps canvas full-window`.
5. **Food, lure or steer target inside a hideout or off the deck:** clamped to the nearest walkable point, and the spider never walks through ceramic. → Task 3 tests `clampWalkable pushes out of hideouts and bounds`.

---

### Task 1: Scaffold, vendored three.js, static server, blank scene

**Files:**
- Create: `package.json` (`"type":"module"`, scripts `test: node --test tests/`, `e2e: node tests/e2e/smoke.mjs`, `serve: node tools/serve.mjs`, devDependency `three@0.187.0`)
- Create: `tools/vendor.mjs`. It copies `node_modules/three/build/three.module.min.js` → `vendor/three/three.module.min.js`, plus these files from `examples/jsm/` with their relative paths kept: `postprocessing/{EffectComposer,RenderPass,ShaderPass,MaskPass,Pass,UnrealBloomPass,OutputPass}.js`, `shaders/{CopyShader,LuminosityHighPassShader,OutputShader}.js` → `vendor/three/addons/...`
- Create: `tools/serve.mjs`: a static server on port 4173 serving the project root with correct MIME types for `.js/.mjs/.css/.html/.json`
- Create: `index.html`. Import map `{"three":"./vendor/three/three.module.min.js","three/addons/":"./vendor/three/addons/"}`, Google Fonts link, `<canvas id="stage">`, `<div id="ui">`, `<script type="module" src="./src/main.js">`
- Create: `src/main.js` (temporary: renders the deck plane only)
- Create: `tests/e2e/smoke.mjs`
- Create: `.gitignore` (`node_modules/`, `tests/e2e/out/`)

- [ ] **Step 1:** `npm install` then `node tools/vendor.mjs`. Expected: `vendor/three/addons/postprocessing/UnrealBloomPass.js` exists and `grep -l "from 'three'" vendor/three/addons -r` lists the addons (bare `three` is resolved by the import map).
- [ ] **Step 2: Write the smoke test** `tests/e2e/smoke.mjs`. It starts `tools/serve.mjs` as a child process and launches Chromium with `args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']`, viewport 1280×800, deviceScaleFactor 1. It opens `http://localhost:4173/`, waits for `window.__hush?.ready === true` (timeout 15 s), and asserts there are zero `console.error` / `pageerror` events. It saves `tests/e2e/out/day.png` and exits non-zero on failure.
- [ ] **Step 3:** Run `npm run e2e`. Expected: FAIL (`__hush` is never ready).
- [ ] **Step 4:** In `src/main.js`, create a WebGLRenderer on `#stage`, add the deck plane, render one frame, then set `window.__hush = { ready: true }`.
- [ ] **Step 5:** Run `npm run e2e`. Expected: PASS, and `day.png` shows a white deck.
- [ ] **Step 6:** Commit with message `chore: scaffold page, vendor three r0.187, smoke test`.

### Task 2: Core math, persistent state, storage

**Files:**
- Create: `src/core/math.js`, `src/core/state.js`, `src/core/storage.js`
- Test: `tests/state.test.mjs`, `tests/storage.test.mjs`

**Interfaces — Produces:**
- `math.js`: `clamp(v,a,b)`, `lerp(a,b,t)`, `damp(current,target,lambda,dt)` (exponential), `wrapAngle(a)` → (-π, π], `v2(x,z)`, `dist(a,b)`, `len(v)`, `norm(v)`, `add/sub/scale(v,…)`. Vectors are `{x,z}` plain objects.
- `state.js`:
  - `SCHEMA_VERSION = 1`
  - `defaultState(now:number) → State`
  - `migrate(raw:any, now:number) → State`
  - `applyOffline(state, now) → State`
  - `SHADES`: an array of 8 `{name, body, highlight, deep}` hex triples. Index 0 is Cobalt (`#2341B8`,`#8FB0FF`,`#0E1A5C`). Then, in order: Sapphire, Indigo, Ice Cobalt, Violet Cobalt, Midnight, Glacier, Electric.
- `State` = `{ v:1, trust:number(0–100, default 8), peakTrust:number, satiety:number(0–3, default 1), lastSeen:number(ms), sinceMoult:number(s active), shadeIndex:int, moults:Array<{id:string, shadeIndex:int, at:number(ms), x:number, z:number, rot:number}>, mats:Record<hideoutId, number 0–1>, settings:{lights:'on'|'off', material:'solid'|'translucent'|'ghost', move:'lure'|'steer'} }`. Defaults: lights `'on'`, material `'translucent'`, move `'lure'`. `moults` is capped at the 50 newest.
- `storage.js`: `async createStorage({ claudeUse?, localStorage?, key='cobalt-hush-live:v1' }) → { kind:'db'|'local'|'memory', load():Promise<any|null>, save(state):void }`. `save` is debounced to 3000 ms and also has `flush():Promise<void>`. db path: `const user = await claudeUse('user'); const id = await user.id(); db.collection('data/users/'+id).doc('spider')`, using `get()` / `set(state)`. Every await is raced against a 10 s timeout. On any failure, fall to the next tier (db → local → memory).

- [ ] **Step 1: Write failing tests.**
  - `migrate repairs bad fields`: `migrate({v:1, trust:NaN, satiety:'x', moults:'no', settings:{lights:'off'}}, 0)` → `trust===8`, `satiety===1`, `moults` is `[]`, `settings.lights==='off'`, `settings.material==='translucent'`.
  - `migrate(null)` and `migrate({v:99})` both deep-equal `defaultState(0)` (apart from `lastSeen`).
  - `migrate clamps trust`: input trust 250 → 100.
  - `applyOffline digests satiety only`: state `{satiety:3, trust:50, lastSeen:0}` at `now = 3_600_000` → `satiety===0`, `trust===50`, `lastSeen===now`. Digestion rate is 1 per 90 s.
  - `moults capped at 50`: 60 entries in → the 50 with the highest `at` come out.
  - `storage falls back to memory when everything throws`: `claudeUse` rejects, and `localStorage.getItem` / `setItem` throw → `kind==='memory'`. `save(x)` then `flush()` then `load()` → deep-equals `x`, with no exception.
  - `storage uses local when db is null`: `claudeUse` resolves `null` and a working localStorage stub is given → `kind==='local'`. After `flush`, the stub holds JSON under the key.
  - `storage uses db`: a stub `claudeUse('db')` returns an object whose `collection(p).doc(k)` records `set` calls, and `claudeUse('user')` returns `{id:async()=>'u1'}` → `kind==='db'` and the path is `'data/users/u1'`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the three modules to the interfaces above.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat(core): state schema, migration, tiered storage`.

### Task 3: Deck layout and locomotion

**Files:**
- Create: `src/sim/deck.js`, `src/sim/locomotion.js`
- Test: `tests/deck.test.mjs`, `tests/locomotion.test.mjs`

**Interfaces — Produces:**
- `deck.js`:
  - `BOUNDS = {minX:-7.4, maxX:7.4, minZ:-4.4, maxZ:4.4}` (walkable area)
  - `HIDEOUTS`: 5 entries `{id, kind, x, z, r, rot, entrance:{x,z}}`. Each footprint is a circle of radius `r`. Coordinates: `bark` (-5.2,-2.6,r 1.1), `stone` (4.6,-2.4,r 1.0), `litter` (-4.8,2.6,r 1.2), `moss` (1.2,3.2,r 0.8), `twig` (5.4,2.4,r 0.9). Each `entrance` sits 0.2 outside the edge, on the side facing the deck centre.
  - `clampWalkable(p) → {x,z}`
  - `nearestHideout(p) → hideout`
  - `insideHideout(p) → hideout|null`
- `locomotion.js`: `createBody(x,z,heading) → Body {x,z,heading,speed,vx,vz}`, and `stepBody(body, target|null, opts:{maxSpeed, accel, turnRate, arriveRadius, allowEnter?:hideoutId}, dt) → body`. Steering is "seek + arrive". Hideout circles are avoided with a tangent push (unless that hideout's id is `allowEnter`), followed by `clampWalkable`. Defaults: `maxSpeed` 1.2 when walking (4.5 when fleeing, set by the caller), `accel` 6, `turnRate` 5 rad/s, `arriveRadius` 0.25.

- [ ] **Step 1: Write failing tests.**
  - `clampWalkable pushes out of hideouts and bounds`: `clampWalkable({x:-5.2,z:-2.6})` is at distance ≥ 1.1 from bark. `clampWalkable({x:20,z:0}).x === 7.4`.
  - `entrance is outside footprint`: every hideout's entrance is more than `r` from its centre.
  - `body arrives at target`: a body at (0,0) with target (3,0), after 600 ticks of dt 0.016 → distance < 0.3 and `speed` < 0.2.
  - `body never enters hideout without allowEnter`: a body at (-2,-2.6) heading for (-8,-2.6) for 800 ticks → `insideHideout` is `null` on every tick.
  - `allowEnter lets it reach the centre`: same route with `allowEnter:'bark'` and target = bark centre → it ends within 0.4 of the centre.
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat(sim): deck layout and steering`.

### Task 4: Gait and leg IK

**Files:**
- Create: `src/sim/gait.js`
- Test: `tests/gait.test.mjs`

**Interfaces — Produces:**
- `LEGS`: 8 entries `{id:'L1'…'R4', side:-1|1, index:0–3, hip:{x,z} (body-local), rest:{x,z} (body-local foot rest), femur:number, tibia:number}`. Hip x is ±0.22. Hip z values are 0.30, 0.12, -0.06, -0.22. Rest reach grows toward the back legs, so leg 1 reaches forward and leg 4 reaches back. Femur 0.55–0.75 and tibia 0.6–0.85, longest at legs 1 and 4.
- `GROUPS = [['L1','R2','L3','R4'], ['R1','L2','R3','L4']]`
- `createGait(body) → Gait {feet: Record<id,{x,y,z, planted:boolean, t:number, from, to}>, activeGroup:0|1}`
- `stepGait(gait, body, dt, {stepThreshold=0.32, stepTime=0.14, lift=0.16}) → gait`. Only the active group may step. The group swaps once all its feet have planted and any foot of the other group is past the threshold. `stepTime` scales by `clamp(1.2/ max(body.speed,0.3), 0.6, 1.4)`. Feet in the air follow a sine lift and land at the rest target plus 0.6 × velocity × stepTime.
- `solveTwoBone(root:{x,y,z}, target:{x,y,z}, a:number, b:number, poleUp:{x,y,z}) → {knee:{x,y,z}, foot:{x,y,z}}`. If the target is out of reach, the foot stops at full reach along the line. The knee bends toward `poleUp`.

- [ ] **Step 1: Write failing tests.**
  - `solveTwoBone keeps bone lengths`: for 50 random reachable targets, `|knee−root| ≈ a` and `|foot−knee| ≈ b` (±1e-6), and `foot ≈ target`.
  - `unreachable target clamps`: a target at distance `a+b+1` → `|foot−root| ≈ a+b`.
  - `knee bends toward pole`: with `poleUp = (0,1,0)`, `knee.y > max(root.y, target.y)`.
  - `never more than four feet in air`: walk a body straight at 1.2 u/s for 5 s → on every tick, unplanted feet ≤ 4, and all of them belong to one group.
  - `standing still plants all feet`: speed 0 for 1 s → all 8 feet are planted.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat(sim): tetrapod gait and two-bone IK`.

### Task 5: Trust model and behaviour brain

**Files:**
- Create: `src/sim/trust.js`, `src/sim/brain.js`
- Test: `tests/trust.test.mjs`, `tests/brain.test.mjs`

**Interfaces — Consumes:** `deck.js`, `locomotion.js` (Task 3), `math.js` (Task 2).

**Interfaces — Produces:**
- `trust.js`:
  - `tier(trust) → 'shy'|'settled'|'bonded'`. Shy is below 30, settled is 30 to 69, bonded is 70 and up.
  - `applyTrust(state, event) → state`. The events and their effects:
    - `{type:'gentle', dt}` adds 0.25 × dt.
    - `{type:'feed'}` adds 6.
    - `{type:'swipe'}` subtracts 3. The caller enforces a 1.5 s cooldown.
    - `{type:'poke', recentPokes:int}` subtracts 2, and a further 5 when `recentPokes ≥ 3` within 4 s.
    - The result is clamped to `[floor, 100]`, where `floor = floor(peakTrust × 0.5)`. `peakTrust` updates to the maximum reached.
  - `reactionParams(trust) → {fleeDist: lerp(6,1.5,t), startleSpeed: lerp(4,10,t), peekDelay: lerp(6,1.5,t), approachRadius: t<0.3?0:lerp(2,4,t), canRide: trust≥85}`, where `t = trust/100`.
- `brain.js`: `createBrain() → Brain`, and `tickBrain(brain, ctx, dt) → Intent`. `dt` is clamped to 0.05 inside.
  - `ctx = {body, trust, satiety, mode:'lure'|'steer', pointer: null | {x,z,speed,down:boolean}, events:Array<Event>, food:Array<{id,x,z}>, threads:Array<{x,z}> /*vibration sources this tick*/, lightsJustChanged:boolean, moultDue:boolean, now:number}`
  - `Event`: `{type:'poke'}`, `{type:'lure', x, z, held:boolean}`, `{type:'steer', x, z}`, `{type:'steerKeys', dx, dz}`
  - States: `wander`, `idle`, `groom`, `alert`, `approach`, `flee`, `hide`, `peek`, `stalk`, `pounce`, `eat`, `seekLure`, `steered`, `investigate`, `ride`, `moult`
  - `Intent = {state, target:{x,z}|null, maxSpeed, allowEnter:string|null, look:{x,z}|null, frontLegsRaise:0–1, twitch:boolean, eatFoodId:string|null, trustEvents:Array<event>}`
  - Priorities, highest first:
    1. `moult`: when `moultDue` and the spider isn't fleeing. It stays in this state for 14 s, and the moult module decides when it's done.
    2. Poke: sets `twitch:true` and emits a `poke` trust event. With trust below 30 it then goes to `flee`; otherwise it does a 0.25 u hop back.
    3. Startle, in lure mode only: the pointer is within `fleeDist` and moving faster than `startleSpeed` → `flee`. It flees to the nearest hideout entrance away from the pointer, then `hide` (allowEnter that hideout) for `peekDelay`, then `peek` for 2 s, then `wander`. It emits a `swipe` trust event.
    4. Steer mode with a `steer` or `steerKeys` event → `steered`. Target = the event point (keys: body + (dx,dz) × 1.5). `maxSpeed` = lerp(0.6, 1.4, trust/100). With trust below 30 it pauses 0.4 s every 1.6 s.
    5. Lure held → `seekLure`. Shy: the route goes via the nearest hideout entrance first, after a 1 s hesitation. Settled: it walks straight. Bonded: it walks straight at 1.3× speed and then waits.
    6. Food present and satiety below 3 → `stalk` (it approaches to 0.9 u at 0.6 maxSpeed and pauses 0.8 s), then `pounce` (0.25 s at 3.5 u/s), then `eat` for 3 s. It emits `feed` and sets `eatFoodId`.
    7. Threads (vibration) → `investigate` the nearest source.
    8. Pointer slow (below 1.5 u/s) and within 3 u → `alert`: it faces the pointer, raises its front legs by 1 − d/3, and emits `gentle`. If the pointer is within `approachRadius` → `approach` to 0.8 u. If `canRide` and the pointer is still (speed under 0.2) within 1.2 u for 2 s → `ride` (target = pointer every tick, which the renderer lifts onto it). `ride` ends when the pointer speed exceeds 6.
    9. `lightsJustChanged` → `idle` for 1.2 s.
    10. Otherwise it cycles `wander` (random walkable targets, maxSpeed 0.9, burst-pause: walk 1–3 s, pause 0.8–2.5 s), `groom` (2.5 s, 10% of pauses) and `idle`.

- [ ] **Step 1: Write failing tests**, each driving `tickBrain` with a fixed seed. `createBrain({seed})` uses mulberry32.
  - `trust floor`: peak 60, then 40 swipes → trust never drops below 30.
  - `tier boundaries`: 29.9 → shy, 30 → settled, 70 → bonded.
  - `fast pointer startles shy spider`: trust 10, pointer 1.5 u away at 9 u/s, lure mode → state `flee`, and `trustEvents` contains a swipe.
  - `fast pointer ignored in steer mode`: same setup with mode `'steer'` → state ≠ `flee`.
  - `poke always twitches`: any mode → `twitch === true`.
  - `steer follows target`: a steer event at (3,0) → state `steered`, target (3,0).
  - `shy lure routes via cover`: trust 10, lure at (0,4) → the first non-null target equals the nearest hideout entrance. Trust 80 → the target equals the lure point.
  - `food stalk → pounce → eat`: one food item at (2,0), with the body stepped by `stepBody` along each intent → it reaches `eat` within 8 s of sim time, and a `feed` event is emitted exactly once.
  - `full spider ignores food`: satiety 3 → never `stalk`.
  - `null pointer calms to wander`: after a `flee`, with pointer `null` for 15 s → it ends in `wander`, `idle` or `groom`.
  - `huge dt is clamped`: one `tickBrain(…, 3600)` from wander → it behaves exactly like `dt = 0.05`. Compare the timers.
  - `ride needs bonded`: trust 60, pointer still at 1 u for 3 s → never `ride`. Trust 90 → `ride`.
  - `moult preempts everything but flee`: `moultDue` while wandering → `moult`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. The brain is a single state object with explicit timers. Seeded RNG only, with no `Math.random` in sim code.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat(sim): trust model and behaviour brain`.

### Task 6: Food, silk and moult simulations

**Files:**
- Create: `src/sim/food.js`, `src/sim/silk.js`, `src/sim/moult.js`
- Test: `tests/food.test.mjs`, `tests/silk.test.mjs`, `tests/moult.test.mjs`

**Interfaces — Consumes:** `deck.js` (`clampWalkable`, `HIDEOUTS`, `nearestHideout`), `state.js` (`SHADES`, `State`).

**Interfaces — Produces:**
- `food.js`:
  - `createFood()`
  - `dropFood(food, p, now) → item`. Clamped walkable; at most 3 items, and the oldest is dropped when full.
  - `stepFood(food, dt)`: each mote drifts on a small random flutter within a 0.15 u radius of its drop point.
  - `removeFood(food, id)`
- `silk.js`:
  - `createSilk(mats)`
  - `stepSilk(silk, body, brainState, dt)`:
    - Dragline: a point every 0.15 u moved, with a 40 s life and at most 600 points.
    - Mat building: while in wander/idle/groom within 1.6 u of a hideout entrance, that hideout's mat progress rises by dt/45. Tripwire count is `floor(progress × 6)`, laid as rays from the entrance at fixed angles (seeded by hideout id), 1.2 u long.
  - `threadHit(silk, p, radius=0.25) → {x,z}|null`. Tests segments of the draglines and tripwires.
  - `ripple(silk, p)`: adds a 1.2 s ripple record that the renderer reads.
  - `matsSnapshot(silk) → Record<id,number>`
- `moult.js`:
  - `MOULT_INTERVAL = 780`
  - `tickMoultClock(state, dt, active:boolean) → state` (advances `sinceMoult` only when active)
  - `isMoultDue(state) → boolean`
  - `completeMoult(state, body, now) → state`: pushes a shell `{id, shadeIndex: old, at:now, x, z, rot}`, advances `shadeIndex` by 1 mod 8, and resets `sinceMoult`.
  - `deckShells(state) → the 6 newest moults`
  - `MOULT_PHASES = [['still',4],['roll',2],['emerge',6],['rollBack',2]]`
  - `moultPhase(t) → {phase, p:0–1}`
- "Active" means the tab is visible and there was pointer or key input within the last 60 s (computed in main).

- [ ] **Step 1: Write failing tests.**
  - `food max three`: dropping 4 items keeps the 3 newest.
  - `food clamps out of hideout`: a drop at the stone centre lands outside the stone.
  - `dragline expires`: move the body 3 u, then step 41 s → 0 points.
  - `mat grows near entrance`: idle 45 s at the bark entrance → `matsSnapshot().bark ≈ 1` and there are 6 tripwires.
  - `threadHit finds tripwire`: after the above, the midpoint of one tripwire → not null. A point 2 u away → null.
  - `moult due after 780 active seconds`: tick 779 → not due. Tick 1 more → due. Inactive time doesn't count.
  - `completeMoult advances shade and stores shell`: shadeIndex 7 → 0. `moults.length` grows by 1, and the shell's `shadeIndex === 7`.
  - `deckShells caps at six`: with 9 moults → 6 newest.
  - `moultPhase`: t 5 → roll. t 13 → rollBack. t 14+ → `{phase:'done'}`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat(sim): food, silk and moult`.

### Task 7: Scene, lighting, day/night, bloom, quality tiers, deck mesh

**Files:**
- Create: `src/render/scene.js`, `src/render/deckMesh.js`
- Modify: `src/main.js` (use these)

**Interfaces — Produces:**
- `createStage(canvas, {reducedMotion}) → Stage {renderer, scene, camera, composer, bloom, setNight(v:0–1), resize(), render(dt), quality:'high'|'medium'|'low', groundPoint(clientX, clientY) → {x,z}|null}`
  - Camera: PerspectiveCamera, fov 35. Placed so the camera looks at (0,0,0) from 55° above the horizontal, with the 16×10 deck filling about 92% of the shorter screen side. On portrait screens it shows the whole deck width.
  - Day rig: hemisphere light plus a soft directional light with PCFSoft shadows.
  - Night rig: ambient at 0.05, and the spider's own glow is a PointLight added by the spider (Task 8).
  - `setNight(v)` blends background, deck colour, light intensities, bloom strength (0.25 → 1.1) and bloom threshold (0.85 → 0.1).
  - Quality tiers start at `high`: pixelRatio min(dpr, 2), shadow map 2048, bloom at full resolution.
  - The average frame time is measured over 2 s windows. Above 22 ms it steps down one tier, and never steps back up:
    - **medium:** pixelRatio 1.5, shadow map 1024, bloom at half resolution.
    - **low:** pixelRatio 1, shadows off (contact blob sprites instead), bloom at half resolution.
  - Exposes `onQualityChange(cb)`.
- `createDeck(scene) → {hideoutMeshes: Record<id, Object3D>}`
  - Deck: a rounded-corner white slab, with a matte material at roughness 0.9.
  - Hideouts are matte white ceramic (`MeshStandardMaterial`, roughness 0.55, colour `#F4F5F8`), built from three primitives and lathe/extrude shapes:
    - **bark:** a curled half-tube, open toward the entrance
    - **stone:** a flattened sphere with an undercut lip
    - **litter:** 7 overlapping thin leaf-shaped extrusions
    - **moss:** a cluster of small spheres
    - **twig:** a hollow cylinder lying on its side
  - Each one is placed at its `HIDEOUTS` x/z/rot.

- [ ] **Step 1: Extend smoke test.** After ready, call `window.__hush.setLights('off')`, wait 1.8 s, and save `night.png`. Assert that the mean luminance of `night.png` is below 0.25 and that of `day.png` is above 0.8. Compute this in-page from `canvas.toDataURL` (sampled at 64×40), with `preserveDrawingBuffer` turned on only when `?test` is in the query.
- [ ] **Step 2:** Run `npm run e2e`. Expected: FAIL (`setLights` is missing).
- [ ] **Step 3:** Implement, and expose `__hush.setLights(v)`. It tweens `setNight` over 1.5 s.
- [ ] **Step 4:** Run `npm run e2e`. Expected: PASS. Open `day.png` and `night.png` and look at them: hideouts read as white ceramic and night is deep blue-black.
- [ ] **Step 5:** Commit with message `feat(render): stage, day/night rig, bloom, ceramic deck`.

### Task 8: Spider mesh, materials, pose and mist

**Files:**
- Create: `src/render/spiderMesh.js`, `src/render/mist.js`

**Interfaces — Consumes:** `LEGS`, `solveTwoBone`, `Gait` (Task 4); `Body` (Task 3); `SHADES` (Task 2).

**Interfaces — Produces:**
- `createSpider(scene, {shade}) → Spider`, with these methods:
  - `setMaterial('solid'|'translucent'|'ghost')`
  - `setShade(shadeIndex)`
  - `setNight(v)`
  - `pose({body, gait, intent, moult:{phase,p}|null, time, eatPulse:0–1})`
  - `group` (Object3D)
  - `glowLight` (PointLight, intensity 0 by day up to 2.2 at night, distance 6, colour `#3DF5FF`)
- **Geometry:**
  - Cephalothorax: a flattened ellipsoid (0.55 × 0.18 × 0.5) with a carapace ridge.
  - Abdomen: an ellipsoid (0.75 × 0.5 × 0.85), set behind a thin pedicel.
  - Gem window: a hexagonal prism inset on top of the abdomen. Behind it sit 3 `TorusGeometry`-plus-teeth gears that rotate at different speeds, plus an emissive core `#E9FFFF`.
  - Legs: each has femur and tibia tubes (`CapsuleGeometry`) placed by `solveTwoBone`, with a fixed-ratio metatarsus/tarsus split along the tibia (bent 8°).
  - Amber band rings on legs 2 and 3, and on the pedipalps, at mid-femur.
  - Cyan emissive joint spheres at the knees.
  - Pedipalps: two short legs that do a small tapping cycle while exploring.
  - Fine hair: an `InstancedMesh` of thin quads along the legs, with low opacity.
- **Materials:** `MeshPhysicalMaterial`.

  | Setting | Solid | Translucent | Ghost |
  |---|---|---|---|
  | transmission | 0 | 0.85 | 0.95 |
  | thickness | — | 0.6 | — |
  | roughness | 0.35 | 0.15 | — |
  | clearcoat | 1 | 1 | — |
  | opacity | — | — | 0.22 |
  | depthWrite | — | — | false |
  | emissive rim | — | — | stronger |

  All three get a fresnel rim (via `onBeforeCompile`) in the shade's highlight colour. The gears stay visible in Translucent and Ghost.
- **Pose:** places the group at the body and heading, and solves each leg from its world hip to `gait.feet[id]`. It applies `frontLegsRaise` (legs 1 lifted by up to 0.35 u, pedipalps raised) and `twitch` (a 120 ms decaying high-frequency jitter of the legs and a 0.04 body hop).
  - Moult phases: `roll` rotates the body 180° on its long axis. `emerge` shows the old shell mesh (a clone in Ghost material at the shell's shade) separating backward. `rollBack` returns.
  - `eatPulse` scales the abdomen by 1 + 0.04 × pulse and brightens the gem.
- **Mist** — `createMist(scene, quality) → {update(spiderPos, night, dt), setCount(n)}`:
  - Particles: Points with additive soft sprites drawn from a canvas texture. Counts are 600, 300 and 120 by quality tier.
  - Placement: they orbit loosely around the spider, within 1.2 u.
  - Opacity: 0.08 by day, 0.35 at night.

- [ ] **Step 1: Extend smoke test.** It sets material to each of the 3 options, saves `spider-solid/translucent/ghost.png` (day) and `spider-night.png`, and asserts no errors. It also asserts `__hush.spider.legCount === 8`.
- [ ] **Step 2:** Run `npm run e2e`. Expected: FAIL.
- [ ] **Step 3:** Implement, wire into `main.js` with a static body at (0,0) and a planted gait, and expose `__hush.setMaterial(m)` and `__hush.spider`.
- [ ] **Step 4:** Run `npm run e2e`. Expected: PASS. Look at the four screenshots and check them against the anti-goals (no cartoon look, the gem reads clearly, translucency shows the gears). Iterate on materials until they read well, then re-run.
- [ ] **Step 5:** Commit with message `feat(render): procedural glass tarantula and mist`.

### Task 9: Effects — silk, food motes, lure light, shells, ripples

**Files:**
- Create: `src/render/fx.js`

**Interfaces — Consumes:** silk, food and moult outputs (Task 6); `Stage` (Task 7); the shell clone factory from `spiderMesh.js` (`createShellMesh(shadeIndex) → Object3D`, which Task 8 also exports).

**Interfaces — Produces:** `createFx(stage) → {update({silk, food, shells, lure:{x,z,strength}|null, night, dt})}`

- **Silk:** `Line2`-free thin lines using `LineSegments` with `LineBasicMaterial`.
  - Draglines fade by age.
  - Each mat is a faint translucent disc plus its tripwires.
  - Colour is `#C7D5EE` by day and `#BFEFFF` emissive-ish at night (bloom picks it up).
  - A ripple is a brightness pulse travelling along the hit segment over 1.2 s.
- **Food mote:** a small emissive sphere (`#FFE3A3`) with two soft wing sprites that flutter at 9 Hz and a tiny PointLight at night.
- **Lure:** a soft radial sprite on the deck that grows over 0.3 s while held, in cyan-white.
- **Shells:** `createShellMesh` instances at the stored x/z/rot, in Ghost material at their shade. At most 6.

- [ ] **Step 1: Extend smoke test.**
  - `__hush.dropFood(2,0)` → `__hush.counts().food === 1`.
  - `__hush.debugSilk()` → seeds a full mat at bark, and `counts().tripwires === 6`.
  - `__hush.debugMoult()` → completes one moult, and `counts().shells === 1`.
  - Save `fx-night.png`.
- [ ] **Step 2:** Run `npm run e2e`. Expected: FAIL.
- [ ] **Step 3:** Implement, and add those debug hooks to `__hush`. They're exposed only when `?test` is in the query.
- [ ] **Step 4:** Run `npm run e2e`. Expected: PASS. Look at `fx-night.png`.
- [ ] **Step 5:** Commit with message `feat(render): silk, food, lure and shell effects`.

### Task 10: Input and UI

**Files:**
- Create: `src/input/pointer.js`, `src/ui/ui.js`, `src/ui/ui.css`
- Test: `tests/gesture.test.mjs`

**Interfaces — Produces:**
- `pointer.js`: `createGestures({tapMs=250, holdMs=350, slopPx=8}) → {down(e), move(e), up(e), cancel(), frame(now) → {pointer:{clientX,clientY,speedPx}|null, gestures:Array<{type:'tap'|'holdStart'|'holdMove'|'holdEnd'|'dragStart'|'dragMove'|'dragEnd', clientX, clientY}>}}`
  - This is pure logic driven by plain event objects `{x, y, t, id, pointerType}`.
  - Only the first active pointer id is tracked.
  - The pointer becomes `null` on leave or cancel, and for touch when no finger is down.
  - Keys: WASD and the arrow keys are tracked as `{dx,dz}` via `keyVector()`.
- `ui.js`: `createUI(root, {state, onLights, onFeedArm, onMaterial, onMove}) → {setTrust(t), setFeedArmed(b), setMoults(list), setSettings(s), showIntro()}`
  - Bottom-centre glass toolbar: `backdrop-filter: blur(14px)`, white at 0.55 by day, navy at 0.45 at night, radius 18px. Contents: Lights, Feed, Material, a Lure|Steer segmented control, and Moults with a count badge. Buttons are at least 44 px high, use inline SVG icons and Inter 500 13px labels, and have visible `:focus-visible` rings.
  - Trust ring, top-right: a 28 px SVG arc with stroke `#2341B8` (day) / `#3DF5FF` (night), with no number. Its `aria-label` names the tier.
  - Moults panel: a slide-up glass sheet listing each shell as a swatch, its shade name and a date (`Intl.DateTimeFormat` short).
  - Intro: "COBALT HUSH", centred, fades in over 0.6 s, holds 1.6 s, then fades out over 0.8 s.

- [ ] **Step 1: Write failing tests.**
  - `quick press is a tap`: down at 0 then up at 120 ms with 2 px of movement → one `tap`.
  - `long press is a hold`: down, then `frame` at 400 ms → `holdStart`. Move 3 px → `holdMove`. Up → `holdEnd`.
  - `drag beyond slop`: down, then move 20 px at 60 ms → `dragStart` and then `dragMove`, and no tap on up.
  - `second finger ignored`: events with a second id produce no gestures.
  - `touch with no finger down gives null pointer`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `pointer.js`, then `ui.js` and `ui.css`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat(ui): gestures, toolbar, trust ring, moults panel`.

### Task 11: Main wiring, persistence, full e2e

**Files:**
- Modify: `src/main.js`
- Modify: `tests/e2e/smoke.mjs`

**Interfaces — Consumes:** all of the above.

**main.js responsibilities:**
- **Boot:** `createStorage({claudeUse: window.claude?.use?.bind(window.claude), localStorage: safeLocal()})`, where `safeLocal` returns `null` if access throws. Then `migrate(await load())` and `applyOffline`. Build the stage, deck, spider, fx, UI and sim objects, then call `showIntro`.
  - Boot must not wait more than 1.5 s for storage. Start with defaults and merge once storage answers.
- **Each frame** (rAF, with `dt` clamped to 0.05):
  - Turn gestures into world points via `groundPoint`, and produce brain events by these rules:
    - **tap:**
      - If Feed is armed → `dropFood`, then disarm.
      - Else, if within 0.6 u of the body → `poke`. Track `recentPokes` within a 4 s window.
      - Else, if `threadHit` → `ripple`, and add it to `ctx.threads`.
    - **hold (lure mode):** a `lure` event.
    - **drag (steer mode), or keys:** `steer` / `steerKeys`.
  - Pointer world position and speed in u/s feed the brain's `pointer`.
  - Then tick, in order: `tickBrain` → `stepBody(intent)` → `stepGait` → `stepFood`, `stepSilk`, `tickMoultClock`. Apply `intent.trustEvents` (with a 1.5 s swipe cooldown), `eatFoodId` (call `removeFood`, then satiety +1) and moult completion (when `moultPhase` is `done`, call `completeMoult`, then `spider.setShade`). Finally, `spider.pose`, `fx.update`, `stage.render`, and the UI's `setTrust`.
- **Lights and activity:** a Lights toggle sets `ctx.lightsJustChanged = true` for exactly one tick. `active` (for the moult clock) is true when `document.visibilityState === 'visible'` and the last pointer or key input was under 60 s ago.
- **Ride state:** the spider's group follows the pointer point, raised 0.35 u.
- **Saving:** `save(state)` runs on every trust, moult, mat or settings change (debounced), plus `flush()` on `visibilitychange` → hidden and on `pagehide`. Mats come from `matsSnapshot`.
- **Resize:** `stage.resize` on `resize` and `orientationchange`.

- [ ] **Step 1: Extend smoke test** with these flows (seeded via `?test&seed=1`):
  - `poke lowers trust`: read `__hush.state().trust`, click the spider's screen position (`__hush.spiderScreen()`) 3× within 2 s → trust drops by at least 2.
  - `feed flow`: click the Feed button, then click the deck at the `__hush.worldToScreen(2,0)` position → within 10 s, `state().satiety` has risen and `counts().food === 0`.
  - `steer toggle`: click "Steer", then drag from the centre to `worldToScreen(4,0)` → within 6 s the body x is above 3.
  - `lure`: click "Lure", then press and hold at `worldToScreen(-3,0)` for 5 s with trust preset to 80 via `__hush.setTrust(80)` → body x is below -2.4.
  - `persistence`: reload the page → trust is within 0.5 of the value before the reload (localStorage tier, since `claude` is absent locally).
  - `storage blocked`: a new context with `addInitScript` that makes `localStorage` throw → `ready` with zero errors, and `__hush.storageKind() === 'memory'`.
  - `resize keeps canvas full-window`: set viewport 390×844 → the canvas client size equals the viewport. Save `phone.png`.
  - `perf`: `__hush.quality()` is reported (logged, not asserted, since swiftshader is slow).
- [ ] **Step 2:** Run `npm run e2e`. Expected: FAIL on the new flows.
- [ ] **Step 3:** Implement the wiring.
- [ ] **Step 4:** Run `npm test && npm run e2e`. Expected: all PASS. Review `phone.png`, `day.png` and `night.png`, plus a 10-second recording of each state (`recordVideo`, test-only), checking movement quality: bursty, not lunging, legs planted.
- [ ] **Step 5:** Commit with message `feat: wire sim, render, input and persistence`.

### Task 12: Publish as a private artifact and verify

**Files:** none new. Publishes `index.html`, `src/**`, `vendor/three/**` (just the files `tools/vendor.mjs` copied) and `src/ui/ui.css`. Does **not** publish `node_modules`, `tests`, `tools` or `docs`.

- [ ] **Step 1:** Run `npm test && npm run e2e` one last time. Expected: PASS.
- [ ] **Step 2:** `publish_files` with no slug. Title "Cobalt Hush — Live", icon "spider", and every page file with `as` equal to its project-relative path.
- [ ] **Step 3:** `declare_capabilities` on the new slug with `{db:{}, user:{}}`.
- [ ] **Step 4:** Verify. Run `list_files` on the new slug and check that `vendor/three/three.module.min.js` and `src/main.js` are present. Then `db_list` (after the user opens the page once) shows only `data/users/<id>/spider` once they've played.
- [ ] **Step 5:** Commit with message `chore: publish record`. Save the artifact slug and URL in `docs/superpowers/plans/PUBLISHED.md`.
- [ ] **Step 6:** Give the user the URL in one sentence, and ask them to try it on a laptop and a phone.
