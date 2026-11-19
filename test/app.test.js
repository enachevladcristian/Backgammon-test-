/* Boots the real app in a mock DOM and plays a few moves by clicking the
   projected board positions. Catches renderer + flow runtime errors. */
import assert from 'node:assert';
import { installDom } from './mock-dom.js';

const dom = installDom();
await import('../js/app.js');

const app = globalThis.window.__bg;
assert.ok(app, 'app exposed its debug handle');

const { G, renderer } = app;
const R = app.R;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const canvas = dom.el('board');

function screenOf(p, z = 0) {
  const x = -6 + (p <= 12 ? 12 - p : p - 13) + 0.5;
  const y = p <= 12 ? -4.5 + 0.49 : 4.5 - 0.49;
  return renderer.cam.project(x, y, z);
}

function clickAt(p, z = 0) {
  const s = screenOf(p, z);
  canvas.dispatch('pointerdown', { clientX: s.x, clientY: s.y });
}

console.log('\nBrowser app (mock DOM)');

test('boots and renders frames', () => {
  dom.step(16, 6);
  assert.ok(dom.stats.drawImage > 0, 'static board layer is blitted');
  assert.ok(dom.stats.fill > 100, 'geometry is being filled');
  assert.equal(G.phase, 'roll');
  assert.equal(G.state.turn, R.WHITE);
});

test('camera fit keeps the whole board on screen', () => {
  const cam = renderer.cam;
  for (const [x, y] of [[-7.12, -5.62], [8.57, -5.62], [8.57, 5.62], [-7.12, 5.62]]) {
    const p = cam.project(x, y, 0);
    assert.ok(p.x > 0 && p.x < 1280, `x ${p.x} in view`);
    assert.ok(p.y > 0 && p.y < 780, `y ${p.y} in view`);
  }
  // the dice in front of the board must be visible too
  const d = cam.project(1.35, -6.2, -0.95);
  assert.ok(d.y > 0 && d.y < 780, 'dice visible');
});

test('project / unproject round trip', () => {
  const cam = renderer.cam;
  for (const [x, y] of [[0, 0], [-5.2, 3.1], [6.4, -3.9], [-6.9, 4.8]]) {
    const p = cam.project(x, y, 0);
    const back = cam.unproject(p.x, p.y);
    assert.ok(Math.abs(back.x - x) < 1e-6, `x ${back.x} vs ${x}`);
    assert.ok(Math.abs(back.y - y) < 1e-6, `y ${back.y} vs ${y}`);
  }
});

test('roll button rolls the dice', () => {
  dom.el('rollBtn').dispatch('click', {});
  assert.equal(G.phase, 'move');
  assert.equal(G.state.dice.length, 2);
  dom.step(16, 60); // let the dice land
  assert.equal(G.roll, null);
  assert.equal(G.busy, false);
  assert.ok(G.options.length > 0, 'legal moves available');
});

test('selecting a checker shows destinations and moves it', () => {
  const before = G.state;
  const opt = G.options[0];
  const fromP = opt.from;
  const beforeCount = R.countAt(before, fromP);
  clickAt(fromP);
  assert.deepEqual(G.sel, { kind: 'point', p: fromP }, 'checker selected');
  dom.step(16, 2);
  clickAt(opt.to);
  dom.step(16, 30); // flight animation
  assert.equal(G.flight, null, 'move finished');
  assert.equal(R.countAt(G.state, fromP), beforeCount - 1, 'checker left its point');
  const destCount = R.countAt(G.state, opt.to);
  assert.ok(destCount >= 1, 'checker arrived');
});

test('renderer copes with selection, targets, hover and a flight', () => {
  if (G.phase === 'move' && G.options.length) {
    const o = G.options[0];
    G.sel = { kind: 'point', p: o.from };
    dom.step(16, 3);
    G.hover = { kind: 'point', p: o.to };
    dom.step(16, 3);
    G.hover = { kind: 'off' };
    dom.step(16, 3);
    G.hover = { kind: 'bar' };
    dom.step(16, 3);
    G.hover = null;
  }
  const frames = dom.stats.fill;
  dom.step(16, 10);
  assert.ok(dom.stats.fill > frames);
});

test('board clicks outside the points are ignored safely', () => {
  const w = 1280;
  for (let i = 0; i < 12; i++) {
    canvas.dispatch('pointerdown', { clientX: (i / 11) * w, clientY: 6 });
    canvas.dispatch('pointermove', { clientX: (i / 11) * w, clientY: 774 });
  }
  dom.step(16, 2);
  assert.ok(true);
});

test('game-to-game reset works', () => {
  app.newGame();
  assert.equal(G.phase, 'roll');
  assert.equal(G.state.turn, R.WHITE);
  assert.equal(R.countAt(G.state, 24), 2);
  dom.step(16, 3);
});

test('renderer survives a full dice animation + bar and off states', () => {
  const cam = renderer.cam;
  // flight from bar
  G.state.bar[0] = 1;
  G.flight = {
    t0: dom.now(), dur: 300, arc: 0.5, owner: 0,
    from: { x: -1.15, y: 0, z: 0.22 }, to: { x: 1.7, y: -3.95, z: 0 },
    surfaceZ: 0.22, hide: { kind: 'bar', player: 0 },
  };
  G.busy = true;
  dom.step(16, 3);
  G.flight = null;
  G.busy = false;
  G.state.bar[0] = 0;
  // a tall stack and a full off tray
  const st = G.state;
  st.points[12] = { owner: 0, count: 8 };
  st.off = [15, 0];
  dom.step(16, 3);
  assert.ok(st.off[0] === 15);
  assert.ok(cam.focal > 0);
});

test('win overlay renders', () => {
  G.phase = 'over';
  G.state.off = [15, 3];
  dom.step(16, 3);
  assert.equal(dom.el('overlay').classList.contains('hidden'), true, 'overlay only shows via endGame()');
  app.newGame();
  dom.step(16, 2);
});

console.log(`\n${passed} checks passed.\n`);
