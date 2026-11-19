/* Computer opponent: legality, speed and full self-play games. */
import assert from 'node:assert';
import * as R from '../js/rules.js';
import { bestTurn, evaluate } from '../js/ai.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withRoll(s, a, b) {
  const ns = R.cloneState(s);
  ns.dice = (a === b ? [a, a, a, a] : [a, b]).map((v) => ({ v, used: false }));
  return ns;
}

console.log('\nComputer opponent');

test('opens with a sensible move and uses both dice', () => {
  const s = withRoll(R.createInitialState(), 6, 5);
  const plan = bestTurn(s, R.WHITE);
  assert.equal(plan.length, 2, 'two moves planned');
  let st = s;
  for (const mv of plan) {
    const legal = R.legalMoveOptions(st);
    assert.ok(legal.some((o) => o.from === mv.from && o.to === mv.to && o.die === mv.die),
      `planned move ${mv.from}->${mv.to} (${mv.die}) is legal`);
    st = R.useDie(R.applyMove(st, mv, R.WHITE), mv.die);
  }
  assert.ok(st.dice.every((d) => d.used));
});

test('prefers hitting a blot over a quiet move', () => {
  const s = R.createInitialState();
  s.points = Array.from({ length: 24 }, () => ({ owner: -1, count: 0 }));
  s.points[16] = { owner: 0, count: 1 };   // white on 17
  s.points[0] = { owner: 0, count: 14 };   // rest on 1
  s.points[11] = { owner: 1, count: 1 };   // black blot on 12  (hit with a 5)
  s.points[23] = { owner: 1, count: 14 };
  const st = withRoll(s, 5, 2);
  const plan = bestTurn(st, R.WHITE);
  const first = plan[0];
  assert.ok(first.from === 17 && first.to === 12 && first.die === 5,
    `expected the hit, got ${first.from}->${first.to}`);
});

test('answers a roll in reasonable time (worst case)', () => {
  const rnd = mulberry32(99);
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    let s = R.createInitialState();
    // play ~15 random turns to get a mid-game mess
    for (let t = 0; t < 15; t++) {
      const a = 1 + Math.floor(rnd() * 6);
      const b = 1 + Math.floor(rnd() * 6);
      s = withRoll(s, a, b);
      let guard = 0;
      while (guard++ < 4) {
        const opts = R.legalMoveOptions(s);
        if (!opts.length) break;
        const mv = opts[Math.floor(rnd() * opts.length)];
        s = R.useDie(R.applyMove(s, mv, s.turn), mv.die);
      }
      s.turn = R.other(s.turn);
      s.dice = [];
    }
    s = withRoll(s, 6, 6);
    const t0 = performance.now();
    bestTurn(s, s.turn);
    worst = Math.max(worst, performance.now() - t0);
  }
  console.log(`      worst case ${worst.toFixed(1)} ms`);
  assert.ok(worst < 250, `too slow: ${worst}ms`);
});

test('AI plays 40 complete games against itself', () => {
  const rnd = mulberry32(4242);
  let games = 0;
  for (let g = 0; g < 40; g++) {
    let s = R.createInitialState();
    let turns = 0;
    while (R.winnerOf(s) === null) {
      const a = 1 + Math.floor(rnd() * 6);
      const b = 1 + Math.floor(rnd() * 6);
      s = withRoll(s, a, b);
      let guard = 0;
      while (guard++ < 6) {
        const opts = R.legalMoveOptions(s);
        if (!opts.length) break;
        const plan = bestTurn(s, s.turn);
        const mv = plan[0] || opts[0];
        // the planned move must be legal right now
        assert.ok(opts.some((o) => o.from === mv.from && o.to === mv.to && o.die === mv.die),
          'AI move is legal');
        s = R.useDie(R.applyMove(s, mv, s.turn), mv.die);
      }
      s.turn = R.other(s.turn);
      s.dice = [];
      if (++turns > 600) throw new Error('AI game did not finish');
    }
    assert.equal(s.off[R.winnerOf(s)], 15);
    games++;
  }
  assert.equal(games, 40);
});

test('evaluation prefers fewer pips', () => {
  const a = R.createInitialState();
  const b = R.cloneState(a);
  // one white checker advanced 13 -> 8 (no new blots, just less distance)
  b.points[12] = { owner: 0, count: 4 };
  b.points[7] = { owner: 0, count: 4 };
  assert.equal(R.pipCount(b, R.WHITE), R.pipCount(a, R.WHITE) - 5);
  assert.ok(evaluate(b, R.WHITE) > evaluate(a, R.WHITE));
});

console.log(`\n${passed} checks passed.\n`);
