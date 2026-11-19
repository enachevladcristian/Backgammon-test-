/* Boots the real app in a mock DOM and plays a few moves by clicking the
   projected board positions. Catches renderer + flow runtime errors. */
import assert from 'node:assert';
import { installDom } from './mock-dom.js';
import { pointX, pointY, barPos, offPos, BOARD } from '../js/scene.js';

const dom = installDom();
await import('../js/app.js');

const app = globalThis.window.__bg;
assert.ok(app, 'app exposed its debug handle');

const { G, renderer } = app;
const R = app.R;

// the side you play is drawn at random on every new game, so pin it here to
// keep the rest of the suite deterministic
app.newGame({ side: R.WHITE });

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const canvas = dom.el('board');

function screenOf(p, z = 0) {
  return renderer.cam.project(pointX(p), pointY(p), z);
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
  const corners = [[BOARD.OUT_X0, BOARD.OUT_Y0], [BOARD.OUT_X1, BOARD.OUT_Y0],
    [BOARD.OUT_X1, BOARD.OUT_Y1], [BOARD.OUT_X0, BOARD.OUT_Y1]];
  for (const [x, y] of corners) {
    const p = cam.project(x, y, 0);
    assert.ok(p.x > 0 && p.x < 1280, `x ${p.x} in view`);
    assert.ok(p.y > 0 && p.y < 780, `y ${p.y} in view`);
  }
  // the dice in front of the board must be visible too
  const d = cam.project(1.4, -5.84, -BOARD.THICK);
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
  // a double is four playable dice
  assert.ok(G.state.dice.length === 2 || G.state.dice.length === 4, 'two dice, or four on a double');
  assert.ok(G.state.dice.every((d) => d.v >= 1 && d.v <= 6));
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

test('every point maps to a distinct column, and the bar is its own target', () => {
  const cols = new Map();
  for (let p = 1; p <= 24; p++) {
    const k = Math.round(pointX(p) * 10);
    cols.set(k, (cols.get(k) || 0) + 1);
  }
  assert.equal(cols.size, 12, '12 columns');
  for (const n of cols.values()) assert.equal(n, 2, 'one point per row in each column');
  // the vertical bar in the middle has no point on it
  assert.ok(Math.abs(pointX(19) - pointX(18)) > 1.5, 'a gap across the bar');
  const bar = renderer.cam.project(0, 0, 0);
  canvas.dispatch('pointerdown', { clientX: bar.x, clientY: bar.y });
  assert.equal(G.sel, null);
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
  app.newGame({ side: R.WHITE });
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
    from: barPos(0), to: { x: pointX(6), y: pointY(6), z: 0 },
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
  app.newGame({ side: R.WHITE });
  dom.step(16, 2);
});

test('a new game draws a side at random, about half for each colour', () => {
  const realRandom = Math.random;
  const draws = [];
  try {
    // walk the draws across the whole 0..1 range
    for (let i = 0; i < 20; i++) {
      Math.random = () => (i + 0.5) / 20;
      app.newGame();
      draws.push(G.human);
    }
  } finally {
    Math.random = realRandom;
  }
  assert.equal(draws.filter((s) => s === R.WHITE).length, 10, 'lower half of the range is White');
  assert.equal(draws.filter((s) => s === R.BLACK).length, 10, 'upper half is Black');
  assert.ok(new Set(draws).size === 2, 'both sides come up');
});

test('an explicit side pins the draw, the pip card tags it', () => {
  // the mock gives every element the same parent, so build the two pip rows
  const doc = globalThis.document;
  const wRow = doc.createElement('div');
  const bRow = doc.createElement('div');
  wRow.appendChild(dom.el('pipW'));
  bRow.appendChild(dom.el('pipB'));

  app.newGame({ side: R.BLACK });
  assert.equal(G.human, R.BLACK);
  assert.equal(dom.el('toast').textContent, 'You play Black', 'the draw is announced');
  assert.equal(wRow.classList.contains('you'), false);
  assert.equal(bRow.classList.contains('you'), true, 'black row is tagged');

  app.newGame({ side: R.WHITE });
  assert.equal(G.human, R.WHITE);
  assert.equal(wRow.classList.contains('you'), true, 'white row is tagged');
  assert.equal(bRow.classList.contains('you'), false);
});

// the mock DOM only fakes rAF and performance.now; setTimeout is real, so the
// computer's think time has to be waited out for real here
{
  const name = 'drawing black lets the computer open the game';
  app.newGame({ side: R.BLACK });
  assert.equal(G.state.turn, R.WHITE, 'white always opens');
  assert.equal(G.mode, 'ai');
  assert.equal(dom.el('rollBtn').disabled, true, 'you cannot roll for the computer');
  assert.equal(dom.el('turnText').textContent, 'Computer · White');
  await new Promise((r) => setTimeout(r, 820));
  assert.equal(G.phase, 'move', 'computer rolled for itself');
  assert.ok(G.state.dice.length >= 2, 'dice are in play');
  app.newGame({ side: R.WHITE });
  passed++;
  console.log(`  ok  ${name}`);
}

console.log(`\n${passed} checks passed.\n`);
