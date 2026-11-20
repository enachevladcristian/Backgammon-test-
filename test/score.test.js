/* The run's scoring: base points, speed bonus/penalty, tactics and stakes. */
import assert from 'node:assert';
import * as S from '../js/score.js';
import * as R from '../js/rules.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const start = () => R.createInitialState();
const move = (s, from, to, die, player = R.WHITE) => R.applyMove(s, { from, to, die }, player);

console.log('\nRun scoring');

test('every move banks a base of 20', () => {
  assert.equal(S.BASE_POINTS, 20);
  const s = start();
  const scored = S.rateMove(s, move(s, 13, 7, 6), R.WHITE);
  assert.equal(scored.base, 20);
  assert.ok(scored.total >= 20, 'a decent move beats the base');
});

test('a longer advance scores higher than a shorter one', () => {
  const s = start();
  const six = S.rateMove(s, move(s, 13, 7, 6), R.WHITE);
  const one = S.rateMove(s, move(s, 8, 7, 1), R.WHITE);
  assert.ok(six.total > one.total, `6-pip ${six.total} beats 1-pip ${one.total}`);
  assert.ok(six.speed > one.speed, 'speed tracks the pips covered');
});

test('coming off the bar is scored as fast, and pays to enter', () => {
  const s = start();
  s.bar[0] = 1;
  const entered = S.rateMove(s, move(s, R.BAR, 22, 3), R.WHITE);
  assert.ok(entered.tags.some((t) => t.label === 'enter'), 'enter tag');
  assert.ok(entered.faster > 0, 'leaving the bar is real progress');
  assert.ok(entered.speed > 0, 'and scores for it');
  assert.ok(entered.total > S.BASE_POINTS, 'beats the base');
});

test('hitting a blot pays a bonus', () => {
  const s = start();
  s.points[4] = { owner: R.BLACK, count: 1 };   // lone black checker on 5
  const hit = S.rateMove(s, move(s, 8, 5, 3), R.WHITE);
  const quiet = S.rateMove(s, move(s, 8, 6, 2), R.WHITE);
  assert.ok(hit.tags.some((t) => t.label === 'hit' && t.points === 12), 'hit tag worth 12');
  assert.ok(hit.total > quiet.total, `hit ${hit.total} > quiet ${quiet.total}`);
});

test('leaving a blot costs points', () => {
  const s = start();
  // 13 -> 7 strands a lone checker; 13 -> 8 joins the stack already there
  const strip = S.rateMove(s, move(s, 13, 7, 6), R.WHITE);
  const safe = S.rateMove(s, move(s, 13, 8, 5), R.WHITE);
  assert.ok(strip.tags.some((t) => t.label === 'blot' && t.points < 0), 'blot penalty');
  assert.ok(!safe.tags.some((t) => t.label === 'blot'), 'no penalty joining a stack');
  assert.ok(safe.total > strip.total, 'the safe move scores more');
});

test('bearing off pays, and a finished race scores the speed bonus', () => {
  const s = start();
  s.points = s.points.map(() => ({ owner: -1, count: 0 }));
  s.points[2] = { owner: R.WHITE, count: 1 };   // one checker on 3
  s.off = [14, 0];
  const off = S.rateMove(s, move(s, 3, R.OFF, 3), R.WHITE);
  assert.ok(off.tags.some((t) => t.label === 'off' && t.points === 8), 'off tag worth 8');
  assert.ok(off.speed > 0, 'closing the race is fast');
});

test('the race rating drops as you get closer to finishing', () => {
  const s = start();
  const after = move(s, 13, 7, 6);
  assert.ok(S.raceRating(after, R.WHITE) < S.raceRating(s, R.WHITE));
  assert.ok(S.raceRating(s, R.BLACK) === S.raceRating(s, R.WHITE), 'symmetric start');
});

test('a move can never be worth less than one point', () => {
  const s = start();
  s.points[12] = { owner: 0, count: 4 };
  s.points[11] = { owner: R.BLACK, count: 2 };
  const worst = S.rateMove(s, move(s, 13, 12, 1), R.WHITE);
  assert.ok(worst.total >= 1);
});

test('stakes escalate and stay in reach of a single game', () => {
  assert.equal(S.stakeTarget(1), 500);
  assert.equal(S.stakeTarget(2), 1000);
  assert.ok(S.stakeTarget(3) > S.stakeTarget(2));
  assert.ok(S.stakeTarget(12) > S.stakeTarget(6), 'keeps growing past the table');
  assert.equal(S.stakeName(1), 'Stake I');
  assert.equal(S.stakeName(2), 'Stake II');
  assert.equal(S.stakeName(3), 'Stake III');
});

test('winning pays more the harder the win', () => {
  assert.equal(S.gameBonus('single'), 150);
  assert.equal(S.gameBonus('gammon'), 300);
  assert.equal(S.gameBonus('backgammon'), 450);
});

test('ordinary moves average comfortably above the base', () => {
  const s = start();
  const withDice = { ...s, dice: [{ v: 3, used: false }, { v: 5, used: false }] };
  const opts = R.legalMoveOptions(withDice);
  assert.ok(opts.length >= 2, 'several legal moves to compare');
  const totals = opts.map((o) => S.rateMove(s, R.applyMove(s, o, R.WHITE), R.WHITE).total);
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  assert.ok(avg > S.BASE_POINTS, `average ${avg.toFixed(1)} is above the base`);
  assert.ok(Math.max(...totals) > Math.min(...totals), 'moves are not all worth the same');
});

test('a full game banks well past stake I', () => {
  // a rough per-game total: ~45 of your own moves at a little over the base,
  // plus the win bonus — comfortably more than the first stake
  const perGame = 45 * 24 + S.gameBonus('single');
  assert.ok(perGame > S.stakeTarget(1), `${perGame} > ${S.stakeTarget(1)}`);
});

console.log(`\n${passed} checks passed.\n`);
