/* The house: the computer's escalating perks and its taxes on the player. */
import assert from 'node:assert';
import * as H from '../js/house.js';
import { openBlots } from '../js/score.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log('\nThe house');

test('the house starts with nothing', () => {
  assert.deepEqual(H.houseRulesFor(0), []);
  assert.equal(H.newestRule(0), null);
  assert.equal(H.HOUSE_MAX, H.HOUSE_RULES.length);
});

test('it earns one rule per stake you clear, in order', () => {
  assert.deepEqual(H.houseIds(H.houseRulesFor(1)), ['doublesTax']);
  assert.deepEqual(H.houseIds(H.houseRulesFor(2)), ['doublesTax', 'secondRoll']);
  assert.equal(H.houseRulesFor(3).length, 3);
  assert.equal(H.houseRulesFor(99).length, H.HOUSE_MAX, 'capped, never endless');
  assert.equal(H.newestRule(2).id, 'secondRoll');
  assert.equal(H.newestRule(99).id, H.HOUSE_RULES.at(-1).id);
});

test('the rules mix scoring taxes with board powers', () => {
  const kinds = new Set(H.HOUSE_RULES.map((r) => r.kind));
  assert.deepEqual([...kinds].sort(), ['power', 'tax']);
  const powers = H.HOUSE_RULES.filter((r) => r.kind === 'power').map((r) => r.id);
  assert.deepEqual(powers.sort(), ['loadedPip', 'secondRoll']);
  for (const rule of H.HOUSE_RULES) {
    assert.ok(rule.name && rule.blurb, `${rule.id} is described`);
  }
});

test('hasHouseRule looks rules up by id', () => {
  const two = H.houseRulesFor(2);
  assert.equal(H.hasHouseRule(two, 'secondRoll'), true);
  assert.equal(H.hasHouseRule(two, 'cap'), false);
  assert.equal(H.hasHouseRule([], 'doublesTax'), false);
});

test('no rules, no tax', () => {
  const r = H.taxMove(57, { isDouble: true, usedSix: true, newBlots: 2 }, []);
  assert.equal(r.total, 57);
  assert.deepEqual(r.taxes, []);
});

test('the doubles tax takes two thirds of any doubles move', () => {
  const rules = H.houseRulesFor(1);
  assert.equal(H.taxMove(57, { isDouble: true }, rules).total, 19);
  assert.deepEqual(H.taxMove(57, { isDouble: true }, rules).taxes, ['doubles']);
  assert.equal(H.taxMove(57, { isDouble: false }, rules).total, 57, 'a mixed roll is untouched');
  // every combination of equal dice is taxed, not just 6-6
  for (const v of [1, 2, 3, 4, 5, 6]) {
    assert.equal(H.taxMove(60, { isDouble: true, value: v }, rules).total, 20, `${v}-${v}`);
  }
});

test('the blot levy bites per blot, and stacks with the doubles tax', () => {
  const rules = H.houseRulesFor(3);          // doubles, second roll, blot levy
  assert.equal(H.taxMove(50, { newBlots: 1 }, rules).total, 43);
  assert.equal(H.taxMove(50, { newBlots: 2 }, rules).total, 36);
  assert.equal(H.taxMove(50, { newBlots: 0 }, rules).total, 50);
  assert.equal(H.taxMove(60, { isDouble: true, newBlots: 1 }, rules).total, 13, '20 - 7');
});

test('the six tax charges any roll with a 6 in it', () => {
  const rules = H.houseRulesFor(5);
  assert.equal(H.taxMove(50, { usedSix: true }, rules).total, 44);
  assert.equal(H.taxMove(50, { usedSix: false }, rules).total, 50);
});

test('the cap tops a move out at 40', () => {
  const rules = H.houseRulesFor(6);
  const big = H.taxMove(120, {}, rules);
  assert.equal(big.total, 40);
  assert.deepEqual(big.taxes, ['cap']);
  assert.equal(H.taxMove(30, {}, rules).total, 30, 'small moves keep their points');
});

test('taxes never take a move below 1', () => {
  const rules = H.houseRulesFor(6);
  const crushed = H.taxMove(2, { isDouble: true, usedSix: true, newBlots: 3 }, rules);
  assert.equal(crushed.total, 1);
  assert.ok(crushed.taxes.length >= 3, 'and it says why');
});

test('a full stack of rules stays in a sane range', () => {
  // a good non-double move on the worst ruleset still pays
  const rules = H.houseRulesFor(99);
  const good = H.taxMove(64, { isDouble: false, usedSix: false, newBlots: 0 }, rules);
  assert.equal(good.total, 40, 'capped, still worth playing for');
  assert.ok(Number.isFinite(good.total) && good.total > 0);
});

test('the blot flag the app feeds in matches score.js openBlots', () => {
  // the app computes newBlots as openBlots(after) - openBlots(before);
  // make sure the helper those numbers come from is the one we expect
  assert.equal(typeof openBlots, 'function');
  const pos = { points: Array.from({ length: 24 }, () => ({ owner: null, count: 0 })) };
  pos.points[10] = { owner: 0, count: 1 };   // p 11: outside either home board
  assert.equal(openBlots(pos, 0), 1);
  pos.points[10].count = 2;
  assert.equal(openBlots(pos, 0), 0);
});

console.log(`\n${passed} checks passed.\n`);
