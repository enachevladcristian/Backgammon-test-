/* Rules engine checks + random self-play. Run with: npm test */
import assert from 'node:assert';
import * as R from '../js/rules.js';

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

function countOnBoard(s, player) {
  let n = 0;
  for (const pt of s.points) if (pt.owner === player) n += pt.count;
  return n;
}

function invariants(s) {
  assert.equal(s.bar[0] + s.off[0] + countOnBoard(s, 0), 15, 'white checker count');
  assert.equal(s.bar[1] + s.off[1] + countOnBoard(s, 1), 15, 'black checker count');
  for (let p = 1; p <= 24; p++) {
    const pt = s.points[p - 1];
    assert.ok(pt.count >= 0, 'no negative stacks');
    if (pt.count === 0) continue;
    assert.ok(pt.owner === 0 || pt.owner === 1, 'owner set when occupied');
    if (pt.count > 1) assert.ok(pt.owner === 0 || pt.owner === 1);
  }
}

/** empty board, no checkers anywhere */
function empty() {
  const s = R.createInitialState();
  s.points = Array.from({ length: 24 }, () => ({ owner: -1, count: 0 }));
  s.bar = [0, 0];
  s.off = [0, 0];
  s.dice = [];
  return s;
}

const put = (s, p, owner, n) => { s.points[p - 1] = { owner, count: n }; return s; };
const dice = (s, values) => { s.dice = values.map((v) => ({ v, used: false })); return s; };

console.log('\nBackgammon rules');

test('initial position matches the standard board (167 pips each)', () => {
  const s = R.createInitialState();
  invariants(s);
  assert.equal(R.pipCount(s, R.WHITE), 167);
  assert.equal(R.pipCount(s, R.BLACK), 167);
  assert.equal(R.countAt(s, 24), 2);
  assert.equal(R.countAt(s, 13), 5);
  assert.equal(R.countAt(s, 8), 3);
  assert.equal(R.countAt(s, 6), 5);
  assert.equal(R.ownerAt(s, 6), R.WHITE);
  assert.equal(R.ownerAt(s, 19), R.BLACK);
});

test('white moves toward point 1, black toward point 24', () => {
  const s = empty();
  put(s, 20, R.WHITE, 1); put(s, 1, R.WHITE, 14);
  put(s, 5, R.BLACK, 1); put(s, 24, R.BLACK, 14);
  dice(s, [4]);
  const w = R.legalMoveOptions(s);
  assert.ok(w.some((o) => o.from === 20 && o.to === 16));
  const t = { ...R.cloneState(s), turn: R.BLACK };
  const b = R.legalMoveOptions(t);
  assert.ok(b.some((o) => o.from === 5 && o.to === 9));
});

test('entry from the bar goes into the opponent home board', () => {
  const s = empty();
  s.bar[0] = 1;
  s.off[0] = 14;
  put(s, 22, R.BLACK, 2);
  s.off[1] = 13;
  dice(s, [3]);
  assert.equal(R.legalMoveOptions(s).length, 0, 'point 22 is blocked');

  dice(s, [2]);
  const opts = R.legalMoveOptions(s);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].from, 'bar');
  assert.equal(opts[0].to, 23);
});

test('a blot can be hit and goes to the bar', () => {
  const s = empty();
  put(s, 17, R.WHITE, 1);
  put(s, 1, R.WHITE, 14);
  put(s, 12, R.BLACK, 1);
  s.off[1] = 14;
  dice(s, [5]);
  const mv = R.legalMoveOptions(s).find((o) => o.from === 17 && o.to === 12);
  assert.ok(mv, 'hit is available');
  const ns = R.applyMove(s, mv, R.WHITE);
  assert.equal(ns.bar[R.BLACK], 1);
  assert.equal(R.ownerAt(ns, 12), R.WHITE);
  assert.equal(R.countAt(ns, 12), 1);
  invariants(ns);
});

test('a made point cannot be landed on', () => {
  const s = empty();
  put(s, 17, R.WHITE, 1); put(s, 1, R.WHITE, 14);
  put(s, 12, R.BLACK, 2); s.off[1] = 13;
  dice(s, [5]);
  assert.ok(!R.legalMoveOptions(s).some((o) => o.to === 12));
});

test('bearing off requires every checker in the home board', () => {
  const s = empty();
  put(s, 4, R.WHITE, 4);
  put(s, 6, R.WHITE, 10);
  put(s, 12, R.WHITE, 1);
  s.off[1] = 15;
  dice(s, [2]);
  const opts = R.legalMoveOptions(s);
  assert.ok(opts.length > 0);
  assert.ok(!opts.some((o) => o.to === 'off'), 'no bear off while one checker is outside');
  assert.equal(R.allInHome(s, R.WHITE), false);
});

test('an oversized die only bears off from the farthest point', () => {
  const s = empty();
  put(s, 1, R.WHITE, 2);
  put(s, 4, R.WHITE, 3);
  put(s, 6, R.WHITE, 10);
  s.off[1] = 15;
  assert.equal(R.allInHome(s, R.WHITE), true);

  dice(s, [6]);
  const six = R.legalMoveOptions(s).filter((o) => o.to === 'off');
  assert.equal(six.length, 1);
  assert.equal(six[0].from, 6, 'only the 6-point may take the oversized bear off');

  dice(s, [5]);
  const five = R.legalMoveOptions(s).filter((o) => o.to === 'off');
  assert.equal(five.length, 0, 'the 5 plays 6 -> 1 instead of bearing off');
});

test('must use both dice when both are playable', () => {
  const s = empty();
  put(s, 11, R.WHITE, 1);
  put(s, 16, R.WHITE, 14);
  put(s, 24, R.BLACK, 15);
  dice(s, [2, 3]);
  const opts = R.legalMoveOptions(s);
  assert.ok(opts.length > 0);
  for (const o of opts) {
    const ns = R.useDie(R.applyMove(s, o), o.die);
    assert.ok(R.legalMoveOptions(ns).length > 0, 'a legal follow-up must exist');
  }
});

test('only the 4 can be played, so only the 4 is offered', () => {
  const s = empty();
  put(s, 6, R.WHITE, 15);        // all white checkers stacked on the 6-point
  put(s, 5, R.BLACK, 2);         // the 5-point is blocked
  s.off[1] = 13;
  dice(s, [1, 4]);
  const opts = R.legalMoveOptions(s);
  assert.ok(opts.length > 0);
  assert.ok(opts.every((o) => o.die === 4), 'only the 4 is offered');
});

test('when both dice are playable but not both, the higher one must be used', () => {
  const s = empty();
  put(s, 3, R.WHITE, 15);        // 3 -> 2 (die 1) or 3 -> 1 (die 2); 1 then blocks the 2
  put(s, 1, R.BLACK, 2);         // hmm: point 1 blocked makes die 2 unplayable
  s.off[1] = 13;
  dice(s, [2, 4]);
  // 3-2 = 1 blocked, 3-4 = -1 -> bear off with the 4 from the farthest point
  const opts = R.legalMoveOptions(s);
  assert.ok(opts.every((o) => o.die === 4 && o.to === 'off'), 'the 4 bears off, the 2 cannot be played');
});

test('doubles give up to four moves', () => {
  const s = dice(R.createInitialState(), [3, 3, 3, 3]);
  let st = s;
  let moves = 0;
  while (moves < 6) {
    const opts = R.legalMoveOptions(st);
    if (!opts.length) break;
    st = R.useDie(R.applyMove(st, opts[0]), opts[0].die);
    moves++;
  }
  assert.ok(moves >= 2 && moves <= 4, `played ${moves} moves`);
});

test('random self-play: 300 full games keep invariants and finish', () => {
  const rnd = mulberry32(1234567);
  for (let g = 0; g < 300; g++) {
    let s = R.createInitialState();
    let turns = 0;
    let winner = null;
    while (winner === null) {
      const a = 1 + Math.floor(rnd() * 6);
      const b = 1 + Math.floor(rnd() * 6);
      s.dice = (a === b ? [a, a, a, a] : [a, b]).map((v) => ({ v, used: false }));
      let guard = 0;
      while (true) {
        const opts = R.legalMoveOptions(s);
        if (!opts.length) break;
        const mv = opts[Math.floor(rnd() * opts.length)];
        s = R.useDie(R.applyMove(s, mv, s.turn), mv.die);
        invariants(s);
        if (guard++ > 8) throw new Error('too many moves in one turn');
      }
      winner = R.winnerOf(s);
      s.turn = R.other(s.turn);
      s.dice = [];
      if (++turns > 800) throw new Error('game did not finish');
    }
    assert.equal(s.off[winner], 15);
    invariants(s);
  }
});

console.log(`\n${passed} checks passed.\n`);
