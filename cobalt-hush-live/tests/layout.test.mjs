import test from 'node:test';
import assert from 'node:assert/strict';
import { HIDEOUTS, LAYOUT_GAP, DECK_HALF, applyLayout, fitHideout, hideoutLayout, moveHideout, resetLayout, clampWalkable } from '../src/sim/deck.js';
import { createSilk, resetHideoutSilk } from '../src/sim/silk.js';
import { defaultState, migrate } from '../src/core/state.js';
import { mergeLoaded } from '../src/app/persistence.js';

const byId = (id) => HIDEOUTS.find((h) => h.id === id);
const clearOfOthers = (id) => {
  const h = byId(id);
  return HIDEOUTS.every((o) => o.id === id || Math.hypot(h.x - o.x, h.z - o.z) >= h.r + o.r + LAYOUT_GAP - 1e-6);
};

test('a moved hideout faces the deck centre, entrance just outside its edge', () => {
  resetLayout();
  const h = moveHideout('moss', { x: -2, z: 0 });
  assert.equal(h.x, -2);
  assert.ok(Math.abs(h.rot - 0) < 1e-9); // centre is along +x from (-2, 0)
  assert.ok(Math.abs(Math.hypot(h.entrance.x - h.x, h.entrance.z - h.z) - (h.r + 0.2)) < 1e-9);
  resetLayout();
});

test('fitHideout keeps a piece on the slab and clear of the others', () => {
  resetLayout();
  const onBark = fitHideout('moss', { x: byId('bark').x, z: byId('bark').z });
  assert.ok(onBark);
  moveHideout('moss', onBark);
  assert.ok(clearOfOthers('moss'));
  const offDeck = fitHideout('twig', { x: 40, z: -40 });
  const twig = byId('twig');
  assert.ok(offDeck.x <= DECK_HALF.x - twig.r && offDeck.z >= -(DECK_HALF.z - twig.r));
  resetLayout();
});

test('fitHideout keeps clear of an avoid circle (the spider)', () => {
  resetLayout();
  const at = fitHideout('moss', { x: 0, z: 0 }, [{ x: 0, z: 0, r: 1.5 }]);
  assert.ok(Math.hypot(at.x, at.z) >= byId('moss').r + 1.5 - 1e-6);
  resetLayout();
});

test('walkable clamping follows a moved hideout', () => {
  resetLayout();
  moveHideout('stone', fitHideout('stone', { x: 0, z: -3 }));
  const s = byId('stone');
  const p = clampWalkable({ x: s.x, z: s.z });
  assert.ok(Math.hypot(p.x - s.x, p.z - s.z) >= s.r - 1e-6);
  resetLayout();
});

test('a saved layout round-trips; an overlapping saved spot is refused', () => {
  resetLayout();
  moveHideout('twig', fitHideout('twig', { x: 2.5, z: -3.2 }));
  const saved = hideoutLayout();
  resetLayout();
  applyLayout(saved);
  assert.ok(Math.abs(byId('twig').x - saved.twig.x) < 1e-9);
  // A layout that would stack two pieces keeps the second one at home.
  applyLayout({ moss: { x: byId('litter').x, z: byId('litter').z } });
  assert.ok(clearOfOthers('moss'));
  resetLayout();
});

test('moving a hideout restarts its web at the new entrance', () => {
  resetLayout();
  const silk = createSilk({ bark: 1 }, { seed: 2 });
  assert.equal(silk.tripwires.bark.length, 6);
  moveHideout('bark', fitHideout('bark', { x: -2, z: -2.5 }));
  resetHideoutSilk(silk, 'bark');
  assert.equal(silk.mats.bark, 0);
  assert.equal(silk.tripwires.bark.length, 0);
  resetLayout();
});

test('layout is saved, repaired on load, and a session rearrangement wins a merge', () => {
  assert.deepEqual(defaultState(0).layout, {});
  const m = migrate({ v: 1, layout: { moss: { x: 1, z: 2 }, __proto__: { x: 1 }, bad: { x: 'a', z: 1 }, Twig: { x: 0, z: 0 } } }, 0);
  assert.deepEqual(m.layout, { moss: { x: 1, z: 2 } });
  const base = defaultState(0);
  const loaded = { ...defaultState(0), layout: { stone: { x: 1, z: 1 } } };
  assert.deepEqual(mergeLoaded(base, base, loaded).layout, { stone: { x: 1, z: 1 } });
  const session = { ...base, layout: { moss: { x: 3, z: 3 } } };
  assert.deepEqual(mergeLoaded(session, base, loaded).layout, { moss: { x: 3, z: 3 } });
});
