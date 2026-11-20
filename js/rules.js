/* ------------------------------------------------------------------
   Backgammon rules engine
   Points are numbered 1..24 (index = p - 1).
   White (0) travels 24 -> 1, Black (1) travels 1 -> 24.
   White's home board is 1..6, Black's is 19..24.
   The bar is where hit checkers wait; entry is into the opponent's home.
   ------------------------------------------------------------------ */

export const WHITE = 0;
export const BLACK = 1;
export const BAR = 'bar';
export const OFF = 'off';

export const other = (p) => (p === WHITE ? BLACK : WHITE);
export const dirOf = (p) => (p === WHITE ? -1 : 1);
export const nameOf = (p) => (p === WHITE ? 'White' : 'Black');
export const isHome = (p, pt) => (p === WHITE ? pt <= 6 : pt >= 19);

export function createInitialState() {
  const points = [];
  for (let i = 0; i < 24; i++) points.push({ owner: -1, count: 0 });
  const set = (n, owner, count) => { points[n - 1] = { owner, count }; };
  // White: 24 (2), 13 (5), 8 (3), 6 (5) — 167 pips
  set(24, WHITE, 2);
  set(13, WHITE, 5);
  set(8, WHITE, 3);
  set(6, WHITE, 5);
  // Black: 1 (2), 12 (5), 17 (3), 19 (5) — 167 pips
  set(1, BLACK, 2);
  set(12, BLACK, 5);
  set(17, BLACK, 3);
  set(19, BLACK, 5);
  return {
    points,
    bar: [0, 0],
    off: [0, 0],
    turn: WHITE,
    dice: [],
    winner: null,
    hits: [0, 0],
  };
}

export function cloneState(s) {
  return {
    points: s.points.map((p) => ({ owner: p.owner, count: p.count })),
    bar: [s.bar[0], s.bar[1]],
    off: [s.off[0], s.off[1]],
    turn: s.turn,
    dice: s.dice.map((d) => ({ v: d.v, used: d.used })),
    winner: s.winner,
    hits: [s.hits[0], s.hits[1]],
  };
}

export function remainingValues(s) {
  return s.dice.filter((d) => !d.used).map((d) => d.v);
}

export function remainingDice(s) {
  return s.dice.filter((d) => !d.used);
}

export function useDie(s, value) {
  const ns = cloneState(s);
  for (const d of ns.dice) {
    if (!d.used && d.v === value) { d.used = true; break; }
  }
  return ns;
}

export function countAt(s, p) {
  const pt = s.points[p - 1];
  return pt ? pt.count : 0;
}

export function ownerAt(s, p) {
  const pt = s.points[p - 1];
  return pt ? pt.owner : -1;
}

export function totalCheckers(s, player) {
  let n = s.bar[player] + s.off[player];
  for (const pt of s.points) if (pt.owner === player) n += pt.count;
  return n;
}

export function canLand(s, player, to) {
  const pt = s.points[to - 1];
  if (!pt || pt.count === 0) return true;
  if (pt.owner === player) return true;
  return pt.count === 1; // blot
}

export function allInHome(s, player) {
  if (s.bar[player] > 0) return false;
  for (let i = 0; i < 24; i++) {
    const pt = s.points[i];
    if (pt.owner === player && pt.count > 0 && !isHome(player, i + 1)) return false;
  }
  return true;
}

/** Farthest point from bearing off (white: highest number, black: lowest). */
export function farthestPoint(s, player) {
  if (player === WHITE) {
    for (let p = 24; p >= 1; p--) if (countAt(s, p) > 0 && ownerAt(s, p) === WHITE) return p;
  } else {
    for (let p = 1; p <= 24; p++) if (countAt(s, p) > 0 && ownerAt(s, p) === BLACK) return p;
  }
  return -1;
}

/** All single-die moves for `player` with `die`. */
export function legalMovesForDie(s, player, die) {
  const moves = [];
  if (s.bar[player] > 0) {
    const to = player === WHITE ? 25 - die : die;
    if (canLand(s, player, to)) moves.push({ from: BAR, to, die });
    return moves;
  }
  const home = allInHome(s, player);
  const far = home ? farthestPoint(s, player) : -1;
  for (let pn = 1; pn <= 24; pn++) {
    const pt = s.points[pn - 1];
    if (pt.owner !== player || pt.count === 0) continue;
    const to = pn + dirOf(player) * die;
    if (to >= 1 && to <= 24) {
      if (canLand(s, player, to)) moves.push({ from: pn, to, die });
    } else if (home) {
      // exact bear-off, or an oversized die from the farthest point
      if (to <= 0 || to >= 25) {
        if (pn === far) moves.push({ from: pn, to: OFF, die });
      }
    }
  }
  return moves;
}

/** Apply one move. Returns a new state (turn is unchanged). */
export function applyMove(s, mv, player) {
  const P = player === undefined ? s.turn : player;
  const ns = cloneState(s);
  if (mv.from === BAR) {
    ns.bar[P] = Math.max(0, ns.bar[P] - 1);
  } else {
    const src = ns.points[mv.from - 1];
    src.count -= 1;
    if (src.count <= 0) { src.count = 0; src.owner = -1; }
  }
  if (mv.to === OFF) {
    ns.off[P] += 1;
  } else {
    const dst = ns.points[mv.to - 1];
    if (dst.count > 0 && dst.owner !== P) {
      if (dst.count === 1) {
        dst.count = 0;
        dst.owner = -1;
        ns.bar[other(P)] += 1;
        ns.hits[P] += 1;
      }
    }
    if (dst.count === 0) { dst.count = 1; dst.owner = P; }
    else if (dst.owner === P) dst.count += 1;
  }
  return ns;
}

/* ---------------- search helpers ---------------- */

function positionsKey(s, player, dice) {
  let k = player + '|' + s.bar[0] + ',' + s.bar[1] + '|';
  for (let i = 0; i < 24; i++) {
    const p = s.points[i];
    if (p.count > 0) k += (i + 1) + ':' + p.owner + 'x' + p.count + ',';
  }
  return k + '|' + dice.slice().sort().join(',');
}

function removeOne(values, v) {
  const out = values.slice();
  const i = out.indexOf(v);
  if (i >= 0) out.splice(i, 1);
  return out;
}

/** Maximum number of dice usable from this position. */
function maxDice(s, player, dice, memo) {
  if (!dice.length) return 0;
  const key = positionsKey(s, player, dice);
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  const seen = new Set();
  for (const d of dice) {
    if (seen.has(d)) continue;
    seen.add(d);
    for (const mv of legalMovesForDie(s, player, d)) {
      const ns = applyMove(s, mv, player);
      const n = 1 + maxDice(ns, player, removeOne(dice, d), memo);
      if (n > best) best = n;
      if (best === dice.length) break;
    }
    if (best === dice.length) break;
  }
  memo.set(key, best);
  return best;
}

/**
 * Legal single moves that form part of an optimal (maximum dice used) turn.
 */
export function legalMoveOptions(s, player) {
  const P = player === undefined ? s.turn : player;
  const dice = remainingValues(s);
  if (!dice.length) return [];
  const memo = new Map();
  const best = maxDice(s, P, dice, memo);
  if (best === 0) return [];
  const out = [];
  const seen = new Set();
  for (const d of dice) {
    if (seen.has(d)) continue;
    seen.add(d);
    for (const mv of legalMovesForDie(s, P, d)) {
      const ns = applyMove(s, mv, P);
      const n = 1 + maxDice(ns, P, removeOne(dice, d), memo);
      if (n === best) out.push({ from: mv.from, to: mv.to, die: d });
    }
  }
  // Only one die can be played: the higher number must be used.
  if (best === 1 && new Set(dice).size > 1 && out.length) {
    const top = Math.max(...out.map((o) => o.die));
    return out.filter((o) => o.die === top);
  }
  return out;
}

export function legalMovesForDieOptions(s, player, diceValues) {
  const memo = new Map();
  const best = maxDice(s, player, diceValues, memo);
  if (best === 0) return [];
  const out = [];
  const seen = new Set();
  for (const d of diceValues) {
    if (seen.has(d)) continue;
    seen.add(d);
    for (const mv of legalMovesForDie(s, player, d)) {
      const ns = applyMove(s, mv, player);
      const n = 1 + maxDice(ns, player, removeOne(diceValues, d), memo);
      if (n === best) out.push({ from: mv.from, to: mv.to, die: d });
    }
  }
  return out;
}

export function pipCount(s, player) {
  let n = s.bar[player] * 25;
  for (let i = 0; i < 24; i++) {
    const pt = s.points[i];
    if (pt.owner !== player || pt.count === 0) continue;
    const p = i + 1;
    n += pt.count * (player === WHITE ? p : 25 - p);
  }
  return n;
}

export function winnerOf(s) {
  if (s.off[WHITE] >= 15) return WHITE;
  if (s.off[BLACK] >= 15) return BLACK;
  return null;
}

/** 'single' | 'gammon' | 'backgammon' — how badly the loser lost. */
export function winKind(s, winner) {
  const loser = other(winner);
  if (s.off[loser] > 0) return 'single';
  // backgammon: loser still has a checker in the winner's home board (or on the bar)
  const homeStart = winner === WHITE ? 1 : 19;
  const homeEnd = winner === WHITE ? 6 : 24;
  for (let p = homeStart; p <= homeEnd; p++) {
    if (ownerAt(s, p) === loser) return 'backgammon';
  }
  if (s.bar[loser] > 0) return 'backgammon';
  return 'gammon';
}
