/* ------------------------------------------------------------------
   Simple but sensible computer opponent.
   Enumerates every legal turn (respecting the "play as many dice as
   possible" rule via rules.legalMoveOptions) and scores the resulting
   positions with a hand-tuned heuristic.
   ------------------------------------------------------------------ */

import {
  WHITE, BLACK, other, dirOf, pipCount, legalMoveOptions, applyMove,
  ownerAt, countAt, isHome, remainingValues,
} from './rules.js';

const MAX_NODES = 6000;

function removeOne(values, v) {
  const out = values.slice();
  const i = out.indexOf(v);
  if (i >= 0) out.splice(i, 1);
  return out;
}

function keyOf(s, player, dice) {
  let k = player + '|' + s.bar[0] + ',' + s.bar[1] + '|';
  for (let i = 0; i < 24; i++) {
    const p = s.points[i];
    if (p.count > 0) k += (i + 1) + ':' + p.owner + 'x' + p.count + ',';
  }
  return k + '|' + dice.slice().sort().join(',');
}

/** How many enemy checkers are within direct hitting distance of `p`. */
function threat(s, player, p) {
  const opp = other(player);
  const d = dirOf(opp); // enemy travel direction
  let n = 0;
  for (let die = 1; die <= 6; die++) {
    const from = p - d * die;
    if (from >= 1 && from <= 24 && ownerAt(s, from) === opp) n++;
  }
  if (s.bar[opp] > 0) {
    // the enemy can re-enter into its home board and hit there
    if (isHome(opp, p)) n += 2;
  }
  return n;
}

export function evaluate(s, me) {
  const opp = other(me);
  let score = 0;

  const pipMe = pipCount(s, me);
  const pipOpp = pipCount(s, opp);
  score += (pipOpp - pipMe) * 1.0;

  score += (s.off[me] - s.off[opp]) * 18;
  score += (s.bar[opp] - s.bar[me]) * 24;

  for (let p = 1; p <= 24; p++) {
    const owner = ownerAt(s, p);
    const n = countAt(s, p);
    if (n === 0) continue;
    if (owner === me) {
      if (n === 1) {
        score -= 9 + threat(s, me, p) * 4;
        if (isHome(me, p)) score += 4; // a blot deep in the home board is safer
      } else {
        score += 5;
        if (isHome(me, p)) score += 2;
        if (n >= 3) score += 1;
        if (n > 5) score -= (n - 5) * 2; // don't pile up forever
        // a point made in front of enemy stragglers is valuable
        let oppBehind = false;
        if (me === WHITE) {
          for (let q = p + 1; q <= 24; q++) if (ownerAt(s, q) === opp) { oppBehind = true; break; }
        } else {
          for (let q = p - 1; q >= 1; q--) if (ownerAt(s, q) === opp) { oppBehind = true; break; }
        }
        if (oppBehind) score += 3;
      }
    } else {
      if (n === 1) score += 8;
      else {
        score -= 3;
        if (isHome(opp, p)) score -= 2;
      }
    }
  }

  // solid home board matters once bearing off starts
  if (s.off[me] > 0) {
    let blocked = 0;
    for (let i = 0; i < 6; i++) {
      const p = me === WHITE ? i + 1 : i + 19;
      if (countAt(s, p) >= 2) blocked++;
    }
    score += blocked * 4;
  }

  return score;
}

/**
 * Choose the best full turn for `player`.
 * @returns {Array<{from:number|'bar', to:number|'off', die:number}>}
 */
export function bestTurn(s, player) {
  const dice = remainingValues(s);
  if (!dice.length) return [];
  let best = -Infinity;
  let bestSeq = [];
  let nodes = 0;
  const seen = new Set();

  const dfs = (st, rem, seq) => {
    if (nodes > MAX_NODES) return;
    const opts = rem.length
      ? legalMoveOptions({ ...st, dice: rem.map((v) => ({ v, used: false })) }, player)
      : [];
    if (!opts.length) {
      const v = evaluate(st, player);
      if (v > best || (v === best && seq.length > bestSeq.length)) {
        best = v;
        bestSeq = seq.slice();
      }
      return;
    }
    const k = keyOf(st, player, rem);
    if (seen.has(k)) return;
    seen.add(k);
    for (const mv of opts) {
      const ns = applyMove(st, mv, player);
      dfs(ns, removeOne(rem, mv.die), seq.concat([mv]));
    }
  };

  dfs(s, dice, []);
  if (!bestSeq.length) {
    const opts = legalMoveOptions(s, player);
    if (opts.length) bestSeq = [opts[0]];
  }
  return bestSeq;
}

export { WHITE, BLACK };
