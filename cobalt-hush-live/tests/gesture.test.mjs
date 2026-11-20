import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestures } from '../src/input/pointer.js';

const ev = (x, y, t, id = 1, pointerType = 'touch') => ({ x, y, t, id, pointerType });
const types = (r) => r.gestures.map((g) => g.type);

test('quick press is a tap', () => {
  const g = createGestures({});
  g.down(ev(100, 100, 0));
  g.move(ev(102, 100, 60));
  g.up(ev(102, 100, 120));
  const r = g.frame(130);
  assert.deepEqual(types(r), ['tap']);
  assert.equal(r.gestures[0].clientX, 102);
  assert.equal(r.gestures[0].clientY, 100);
});

test('long press is a hold', () => {
  const g = createGestures({});
  g.down(ev(50, 50, 0));
  assert.deepEqual(types(g.frame(100)), []);
  assert.deepEqual(types(g.frame(400)), ['holdStart']);
  g.move(ev(53, 50, 420));
  assert.deepEqual(types(g.frame(430)), ['holdMove']);
  g.up(ev(53, 50, 500));
  assert.deepEqual(types(g.frame(510)), ['holdEnd']);
});

test('drag beyond slop', () => {
  const g = createGestures({});
  g.down(ev(0, 0, 0));
  g.move(ev(20, 0, 60));
  assert.deepEqual(types(g.frame(70)), ['dragStart', 'dragMove']);
  g.move(ev(30, 0, 90));
  assert.deepEqual(types(g.frame(100)), ['dragMove']);
  g.up(ev(30, 0, 120));
  assert.deepEqual(types(g.frame(130)), ['dragEnd']);
});

test('a drag never turns into a hold or tap', () => {
  const g = createGestures({});
  g.down(ev(0, 0, 0));
  g.move(ev(20, 0, 60));
  g.frame(70);
  assert.deepEqual(types(g.frame(900)), []);
});

test('second finger ignored', () => {
  const g = createGestures({});
  g.down(ev(10, 10, 0, 1));
  g.down(ev(200, 200, 10, 2));
  g.move(ev(300, 300, 20, 2));
  g.up(ev(300, 300, 30, 2));
  const r = g.frame(40);
  assert.deepEqual(types(r), []);
  assert.equal(r.pointer.clientX, 10);
  g.up(ev(10, 10, 100, 1));
  assert.deepEqual(types(g.frame(110)), ['tap']);
});

test('touch with no finger down gives null pointer', () => {
  const g = createGestures({});
  assert.equal(g.frame(0).pointer, null);
  g.move(ev(5, 5, 10));
  assert.equal(g.frame(20).pointer, null);
  g.down(ev(5, 5, 30));
  assert.notEqual(g.frame(40).pointer, null);
  g.up(ev(5, 5, 60));
  assert.equal(g.frame(70).pointer, null);
});

test('hovering mouse has a pointer until leave', () => {
  const g = createGestures({});
  g.move(ev(40, 60, 10, 1, 'mouse'));
  const r = g.frame(20);
  assert.equal(r.pointer.clientX, 40);
  assert.deepEqual(types(r), []);
  g.leave();
  assert.equal(g.frame(30).pointer, null);
});

test('mouse pointer persists after up; cancel ends an active hold', () => {
  const g = createGestures({});
  g.down(ev(1, 1, 0, 1, 'mouse'));
  g.frame(400);
  g.cancel();
  const r = g.frame(410);
  assert.deepEqual(types(r), ['holdEnd']);
  assert.equal(r.pointer, null);
});

test('speedPx reflects recent motion and decays when still', () => {
  const g = createGestures({});
  g.move(ev(0, 0, 0, 1, 'mouse'));
  g.move(ev(30, 40, 100, 1, 'mouse'));
  assert.ok(Math.abs(g.frame(110).pointer.speedPx - 500) < 1);
  assert.equal(g.frame(600).pointer.speedPx, 0);
});

test('keyVector: WASD and arrows, normalized, screen-up is -z', () => {
  const g = createGestures({});
  assert.deepEqual(g.keyVector(), { dx: 0, dz: 0 });
  g.keyDown('KeyW');
  assert.deepEqual(g.keyVector(), { dx: 0, dz: -1 });
  g.keyDown('ArrowRight');
  const v = g.keyVector();
  assert.ok(Math.abs(v.dx - Math.SQRT1_2) < 1e-9 && Math.abs(v.dz + Math.SQRT1_2) < 1e-9);
  g.keyUp('KeyW');
  assert.deepEqual(g.keyVector(), { dx: 1, dz: 0 });
  g.keyDown('KeyA');
  assert.deepEqual(g.keyVector(), { dx: 0, dz: 0 });
  g.blur();
  assert.deepEqual(g.keyVector(), { dx: 0, dz: 0 });
});

test('release between tap and hold times is still a tap', () => {
  const g = createGestures({});
  g.down(ev(5, 5, 0));
  g.up(ev(5, 5, 300));
  assert.deepEqual(types(g.frame(310)), ['tap']);
});

test('late release with no frame in between is holdStart then holdEnd', () => {
  const g = createGestures({});
  g.down(ev(5, 5, 0));
  g.up(ev(5, 5, 500));
  assert.deepEqual(types(g.frame(510)), ['holdStart', 'holdEnd']);
});

test('cancel for an untracked pointer id is ignored', () => {
  const g = createGestures({});
  g.down(ev(5, 5, 0, 1));
  g.cancel(2);
  assert.notEqual(g.frame(10).pointer, null);
  g.cancel(1);
  assert.equal(g.frame(20).pointer, null);
});
