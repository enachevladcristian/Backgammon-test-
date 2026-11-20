/* ------------------------------------------------------------------
   The run: a tiny roguelike layer over the board.

   Every checker move banks a base of 20 points, plus a speed bonus or
   penalty from how much faster (or slower) it makes your race, plus a
   little for the tactical events — hitting, making a point, bearing off.

   Points go into a stake. Clear a stake and the next one is bigger; lose
   the game before you clear it and the run drops back to stake I.

   Pure functions only: no DOM, no game flow, so it can be tested alone.
   ------------------------------------------------------------------ */

import { WHITE, other, pipCount } from './rules.js';

export const BASE_POINTS = 20;

/** classic average pips per roll in a pure race */
const PIPS_PER_ROLL = 8.5;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** a player's home board: 1-6 for White, 19-24 for Black */
export function inHome(player, p) {
  return player === WHITE ? p >= 1 && p <= 6 : p >= 19 && p <= 24;
}

/** own blots that can still be hit */
export function openBlots(state, player) {
  let n = 0;
  for (let p = 1; p <= 24; p++) {
    const pt = state.points[p - 1];
    if (pt.owner === player && pt.count === 1 && !inHome(player, p)) n++;
  }
  return n;
}

/** own points holding two or more checkers */
export function madePoints(state, player) {
  let n = 0;
  for (const pt of state.points) if (pt.owner === player && pt.count >= 2) n++;
  return n;
}

/**
 * How much race work this player still has: pips at the classic 8.5 per roll,
 * plus a couple of rolls for every checker still on the bar (you cannot move
 * until it is back). Lower is better, so a move is "faster" when this drops.
 * Exposed blots are deliberately not counted here — they are scored as a
 * tactic, so a blot is never penalised twice.
 */
export function raceRating(state, player) {
  return pipCount(state, player) / PIPS_PER_ROLL + state.bar[player] * 2.4;
}

/**
 * What one checker move is worth.
 * @returns {{base:number, speed:number, tactical:number, total:number, faster:number, tags:Array}}
 */
export function rateMove(before, after, player) {
  const opp = other(player);
  // how much closer to the finish this move took you (in rolls)
  const faster = raceRating(before, player) - raceRating(after, player);
  const speed = clamp(Math.round(faster * 14), -16, 28);

  let tactical = 0;
  const tags = [];
  const add = (label, points) => {
    if (!points) return;
    tactical += points;
    tags.push({ label, points });
  };

  add('hit', (after.bar[opp] - before.bar[opp]) * 12);
  add('point', (madePoints(after, player) - madePoints(before, player)) * 9);
  add('blot', (openBlots(after, player) - openBlots(before, player)) * -7);
  add('off', (after.off[player] - before.off[player]) * 8);
  add('enter', (before.bar[player] - after.bar[player]) * 5);

  const total = Math.max(1, BASE_POINTS + speed + tactical);
  return { base: BASE_POINTS, speed, tactical, total, faster, tags };
}

/** one short word for the floating badge */
export function moveLabel(scored) {
  const tag = scored.tags.find((t) => t.points > 0) || scored.tags[0];
  if (tag) return tag.label;
  if (scored.speed >= 9) return 'fast';
  if (scored.speed <= 2) return 'slow';
  return '';
}

/* ------------------------------------------------------------- stakes */

const STAKE_TARGETS = [500, 1000, 1600, 2400, 3400, 4600];

/** points needed to clear stake `level` (1-based) */
export function stakeTarget(level) {
  const i = Math.max(1, Math.round(level)) - 1;
  if (i < STAKE_TARGETS.length) return STAKE_TARGETS[i];
  return STAKE_TARGETS[STAKE_TARGETS.length - 1] + (i - STAKE_TARGETS.length + 1) * 1400;
}

/** what winning the game is worth, by win kind */
export function gameBonus(kind) {
  return kind === 'backgammon' ? 450 : kind === 'gammon' ? 300 : 150;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** stake label, e.g. 1 -> "Stake I" */
export function stakeName(level) {
  const i = Math.max(1, Math.round(level)) - 1;
  return `Stake ${ROMAN[i] || level}`;
}
