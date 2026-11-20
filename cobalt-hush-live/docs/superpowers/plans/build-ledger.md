# SDD ledger — plan: /tmp/claude-0/-home-user-maitranilim/a9c9d1e6-8707-57c2-8371-2d14d17d32d3/scratchpad/cobalt-hush-live/docs/superpowers/plans/2026-11-19-cobalt-hush-live.md
Spec: docs/superpowers/specs/2026-11-19-cobalt-hush-live-design.md (reachable). Branch: build (base 73a0c14). Repo is local-only in scratchpad.

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1/T7/T8/T9/T11 main.js, smoke.mjs | sequential extensions | ok |
| T2→T3,T5,T6,T11 | math/state/storage | ok; T11 passes window.claude?.use bound |
| T3→T5 | stepBody opts ← Intent.maxSpeed/allowEnter | ok |
| T4→T8 | LEGS, solveTwoBone, gait.feet{x,y,z} | ok |
| T5↔T6 | moult 14s == sum MOULT_PHASES (4+2+6+2) | ok |
| T8→T9 | createShellMesh | T8 Produces omits it → R1 |
| T1 vs T7/T9/T11 | smoke URL; ?test needed for preserveDrawingBuffer/debug hooks | R2 |
| T5 | createBrain() vs createBrain({seed}) in tests | R3 |
| T10→T11 | hold gestures in steer mode undefined | R4 |
| T7/T8 | reducedMotion reaches stage but not mist | R5 |
| T12 | publish = outside side effect | covered by approved design (new private artifact) → R6 |
| each task self-consistent | tests vs code vs files | ok otherwise |

Ruling R1: Task 8 also exports createShellMesh(shadeIndex) -> Object3D — T9 consumes it — cost: small.
Ruling R2: smoke always opens /?test&seed=1 from Task 1 on — debug-only hooks need it — cost: none.
Ruling R3: createBrain({seed}={}) with optional seed — tests need determinism — cost: none.
Ruling R4: in steer mode, holdStart/holdMove also produce steer events at that point — spec "drag anywhere"; a still press should also steer — cost: small.
Ruling R5: createMist(scene, quality, {reducedMotion}) — global constraint — cost: none.
Ruling R6: Task 12 publish proceeds without stopping — user approved "new private artifact" in design; artifacts start private — cost: an extra private artifact the user can delete.

## Models
Implementers: T1,T2,T3,T4,T6,T9,T10 sonnet; T5,T7,T8,T11 opus. Task reviewers: sonnet. Final review: opus.

## Progress
Ruling R7: vendor three/build/three.module.js + three.core.js (r0.187 ships no three.module.min.js); import map -> ./vendor/three/three.module.js — verified ls node_modules/three/build — cost: ~1.4MB unminified, fine under 16MiB.
Note: review packages exclude vendor/ and package-lock.json (generated code).
Task 1: complete (commits 73a0c14..2d4459f, review clean). Minor noted: smoke uses ambient playwright (not in package.json, intentional per env); fixed 500ms server wait — revisit in Task 11 if flaky.
Ruling R8: npm test = node --test "tests/*.test.mjs" (Node 22 treats bare dir as module; keeps e2e out) — cost: none.
Ruling R9: SHADES 1–7 hex chosen by implementer; Task 8 visual review may retune — cost: cosmetic.
Task 2: minor (deferred): a single transient db.set failure demotes db→local for the session (no retry).
Task 2: minor (deferred): no tests for 3000ms debounce coalescing or for load-time db failure demotion.
Task 2: minor (deferred): moult ids are not de-duplicated in migrate.
Task 2: minor (sent into round 1 as cheap): memory read-your-writes in save().
Task 2: fix round 1/5 (2 addressed, 0 open — corrupt local JSON demoted tier; memory read-your-writes; commits 55866a1..45bfca1)
Task 2: complete (commits 2d4459f..45bfca1, review clean)
Ruling R10: clampWalkable(p, allowEnter=null) optional 2nd arg accepted — needed so stepBody doesn't eject from an allowed hideout — cost: none.
Ruling R11: stepBody clamps its target internally via clampWalkable(target, allowEnter) so off-deck/inside-hideout targets are reachable (Review Focus #5) — cost: none.
Note: commit trailers from subagents vary (local-only repo; harmless).
Task 3: complete (commits 45bfca1..1b404d6, review clean)
Task 3: minor (deferred): clampWalkable pushes out of hideouts sequentially (no overlap today).
Task 3: minor (deferred): stepBody doesn't clamp dt itself — main/brain must clamp (Task 5/11 check).
Task 3: minor (deferred): no test for in-hideout target without allowEnter.
Ruling R12: gait frame conventions (local z fwd, x right; localToWorld; HIP_HEIGHT 0.28; feet world xyz) given in T4 dispatch — binding for T8 — cost: none.
Task 4: complete (commits 1b404d6..0f7a30d, review clean)
Task 4: minor (deferred): still-plant test doesn't start from displaced feet; no tests for lift peak / landing offset / degenerate pole; legById rebuilt per tick.
Ruling R13: brain.js at 409 lines stays unsplit (≈60 lines constants; split would need 3rd module) — cost: readability only.
Ruling R14: ctx.now is in SECONDS; lure persists until {type:'lure', held:false}; main (T11) must send it on hold release — carry into T11 dispatch.
Ruling R15: mulberry32 exported from src/core/math.js for reuse (T6) — cost: none.
Task 3: reopened — stepBody speed grows unbounded while sliding along hideout (≈5.5 u/s vs 0.9) found by T5 implementer — fix round 1 via T3 implementer.
Task 3: fix round 1/5 (1 addressed, 0 open — speed cap while sliding; commits 208cf9d..60dd6cd)
Task 3: re-complete (fix 60dd6cd, review clean). minor (deferred): dt 0.016 slide test doesn't assert it enters each hideout's margin.
Task 5: complete (commits 0f7a30d..208cf9d, review clean)
Task 5: ⚠️ food inside hideout → stalk stuck: resolved by T6 dropFood clamping (brief test 'food clamps out of hideout'); ctx.threads is per-tick only (main adds on tap tick) so investigate re-entry is bounded — verify in T11.
Task 5: minor (deferred): investigate re-entry resets timer if threads persisted; seekLure uses nearestHideout (surface dist) not nearest entrance; no regression tests for investigate/lights-idle/moult-exit/hop/bonded lure speed; moult can pre-empt hide/peek; ride no exit if trust drops <85; reactionParams doesn't clamp trust; stalk has no timeout.
Task 6: complete (commits 60dd6cd..97817ea, review clean)
Task 6: minor (deferred): tripwires reallocated every tick while building; food mote can flutter ~0.14 into hideout/edge (brain should target item home or clamp — check T11); removeFood reassigns food.items (callers must re-read); `?? 0` in silk tests.
Ruling R16: Task 7 interpretation calls accepted — PCFShadowMap radius 4 (r0.187 lacks PCFSoft); scene renders at 1/1.25 exposure, scaled up at output (T8 glow must account ×1.25); night adds navy deck self-glow + 0.08 moonlight beyond "ambient 0.05" (else pieces vanish); camera fits whole deck within 92% of both axes; contact blobs always on under hideouts; first 2 s ignored for quality timing; createStage gains preserveDrawingBuffer option. Controller viewed day.png/night.png: polished. — cost: cosmetic.
Task 7: minor (deferred): throwing onQualityChange listener aborts loop; deck material found by name lookup; tier step-down and groundPoint untested (closure); groundPoint returns off-deck hits (R11 clamps downstream).
Task 7: minor (sent into round 1 as cheap): dispose shadow map on low tier.
Task 7: fix round 1/5 (2 addressed, 0 open — slow frames counted; low-tier shadow map disposed; commits 23ccc54..10ac1e5)
Task 7: complete (commits 97817ea..10ac1e5, review clean). minor (deferred): a single tab-sleep frame counts as 0.25 s in a window.
Task 8: dispatched (opus), base 10ac1e5.
Task 8: first pass 25b186f. Controller viewed closeups: night excellent; day reads as glossy toy plastic (lavender egg, stilt legs) — conflicts with anti-goal "no cartoon" → visual refinement round before review.
Ruling R17: Task 8 may change LEGS rest reach/femur/tibia in src/sim/gait.js for a low, wide tarantula stance (knees just above carapace) provided all gait tests still pass — the spec's look outranks Task 4's chosen numbers — cost: re-check gait tests.
Ruling R18: moult shell hand-off — main (T11) calls completeMoult with the emerge-cast position (body − forward×1.15, same heading), and createShellMesh renders the on-its-back cast pose, so no jump at completion; no change to moult.js — cost: none.
Ruling R19: Task 8 interpretations accepted (ghost settings, knee rings, amber gem bezel, transparent joint rings, setMaterial/spider exposed without ?test, deckMesh exports contact-shadow helpers, spiderParts.js split).
Task 8: refinement fb6fcf2 viewed — stance now low/wide, abdomen organic; still slightly lavender under swiftshader low tier. Ruling R20: accept for now; after T11, do a visual polish pass judged at forced high quality (test-only ?quality=high) before publish — cost: one extra pass. spiderMesh.js 525 lines accepted.
Task 8: complete (commits 10ac1e5..fb6fcf2, review clean)
Task 8: minor (deferred): solveLimb/pose small per-frame allocations; duplicate onQualityChange handlers in main; mist centre moves under reducedMotion (orbit frozen) — acceptable; GLOW_MAX 2.2 not ×1.25-compensated — check in R20 polish pass.
Task 8→9 note: createShellMesh returns fresh materials; T9 must dispose them when a shell is removed.
Task 9: controller viewed fx-night.png — silk fan, amber mote, ghost shell read well. Polish-pass note (R20): spider reads small at overview scale; consider camera framing or modest scale-up.
Task 9: complete (commits fb6fcf2..68a9a0a, review clean)
Task 9: minor (deferred): per-frame {x,z,alpha} allocations in fx silk build; disposeShell duplicated in fx.js and spiderMesh.js; fx has no dispose(); dead `light.intensity=0`; ripple is radial from hit point (data has no segment); shells don't receive setNight — check in polish pass.
Polish-pass note (R20): portrait phones show deck as thin strip — rotate camera 90° in portrait so deck's long axis runs vertically (screen→world mapping via groundPoint stays correct); spider small at overview — frame tighter / scale up modestly. Controller viewed ui-day.png & ui-phone.png: toolbar polished.
Ruling R21: pending press on up → tap if < holdMs, else holdStart+holdEnd (no dead zone) — cost: none.
Task 10: minor (deferred): pointer.js:36 dead code; same-timestamp speed reset; ui.js no destroy()/doc Escape listener not removed + redundant panel Escape; .ico-slot rule order; missing UI tests (Escape/focus/aria-pressed), leave-during-drag, mismatched-id up.
Task 10: minor (sent into round 1 as cheap): cancel(id); date guard.
Task 10: fix round 1/5 (4 addressed, 0 open — tap/hold dead zone; night on-accent contrast; cancel(id); date guard; commits 2180ae1..07551ea)
Task 10: complete (commits 68a9a0a..07551ea, review clean). Ruling R22: tapMs option removed (dead after R21) — cost: none.
Task 11: dispatched (opus), base 07551ea.
Task 11: implemented 480670d (DONE_WITH_CONCERNS). Ruling R23: steer e2e presets trust 40; satiety digests in play (DIGEST_SECONDS 90) — accepted.
Ruling R24: Polish task "11b" after T11 review (opus): (a) foot sliding — planted-foot drift p95 1.14u; fix gait (step trigger/turn-in-place handling) and/or turn-rate-at-low-speed so p95 drift ≤ 0.45u in wander/flee/steer sims, gait tests still pass; (b) medium tier pixelRatio = min(dpr,1.5); (c) R20 visual pass at forced high tier: true cobalt colour, GLOW ×1.25 check, spider framing/scale, portrait camera rotation, shells respond to night. — cost: one task.
Task 11: complete (commits 07551ea..480670d, review clean)
Task 11: minor (deferred): saveKey JSON.stringify per frame; main wiring behaviours lack automated coverage; simWait race (false negative only); duplicated cast formula (main debugMoult vs loop); late merge drops early silk; record.mjs helper unreferenced.
Task 11b: dispatched (opus) per R24, base 480670d; includes right-click gesture filter (cheap minor) and ride-pose check.
Task 11b: implemented 480670d..643325b. Controller viewed polish/day.png, close-solid.png, phone-night.png: true cobalt, good presence, portrait works.
Ruling R25: SPIDER_SCALE 1.35 accepted (body ≈1.9u; HIP_HEIGHT 0.378 world; R18 cast offset 1.15×1.35) — supersedes "≈1.4u" body length and R12/R18 literal numbers; single constant reverts — cost: none.
Ruling R26: drift max 0.88 at 20 fps floor accepted (p95 ≤0.28); step-time floor 0.45; pivot caps 0.35×/0.7× turnRate; startle onset 0.6–0.7 s accepted. Legs clipping into ceramic beside hideouts → deferred (tell user).
Ruling R27: body silhouette (capsule) must clear hideouts except allowEnter; avoidance margin scales with SPIDER_SCALE — cost: slightly wider berths.
Task 11b: minor (deferred): gait.omega raw per-tick derivative (safe today); frameCloseup not portrait-aware (test-only).
Task 11b: minor (sent into round 1 as cheap): emerge-shell setNight caching; pointerup button guard; scale body-relative brain distances.
Task 11b: minor (deferred): flee drift max 1.10 at 20 fps floor (60 fps fine); moss vs bounds 5 mm; abdomen can overhang deck edge at walls (≈0.35u max).
Task 11b: fix round 1/5 (5 addressed, 0 open — body capsule clearance; drift scenario proofs; shell night cache; pointerup guard; scaled brain distances; commits 643325b..29d9f1f)
Task 11b: complete (commits 480670d..29d9f1f, review clean). minor (deferred): capsule radius 0.405 < abdomen half-width 0.51 → ≤0.1u mesh can graze ceramic at widest point; f=0 fallback push may exceed budget (unobserved).
Final review: dispatched (opus), range 73a0c14..29d9f1f.
Final review: With fixes — 6 Important + 6 cheap minors → single fix wave (opus), base 29d9f1f. Brief: final-fix-brief.md
Final fix wave: 8 commits 29d9f1f..fff4cfb (136 tests, e2e PASS). Rulings: R29 brain.js 470 lines stays unsplit (extension of R13) — cost: readability; R30 one hidden shader-compile render before storage answers accepted (never visible) — cost: none; R31 keyboard steering can't enter hideouts (only pointer) — cost: minor feature gap.
Ruling R28: remembered quality tier starts one tier above next visit (coarse pointer capped at medium) so it can recover — cost: a few seconds of possible chop on truly slow devices each visit.
Fix wave follow-up 3adace4 (R28 start tier + head night script). Ruling R32: inline head script is allowed (artifact CSP allows inline scripts; importmap already inline) — cost: none.
Final fix wave: re-review clean (12/12 addressed). Range 29d9f1f..3adace4.
Final: parked — premoult has no hard-cap fallback if moultSpot returns null — Ruling: never observed (200 runs max 6 s); spider would stand still until next 12 s re-pick; acceptable for v1 — cost: rare frozen moment.
Final: parked — a throw in live() before reveal leaves the page blank (only createStage failure handled) — Ruling: no known throw path; acceptable for v1 — cost: blank page on an unforeseen bug.
Task 12: complete — published slug 279b40fe…, declared db+user, verified 37 files.
