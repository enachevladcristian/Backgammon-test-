/* The shop: catalogue, purchases, coin payout and the "no extra checkers" rule. */
import assert from 'node:assert';
import * as S from '../js/shop.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log('\nShop');

test('the catalogue is sane', () => {
  assert.ok(S.ITEMS.length >= 3);
  const ids = S.ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const item of S.ITEMS) {
    assert.ok(item.cost > 0, `${item.id} has a cost`);
    assert.ok(item.name && item.blurb, `${item.id} is described`);
  }
});

test('checkers are not for sale', () => {
  // 15 a side is the game: nothing in the shop may touch the piece count
  const ids = S.ITEMS.map((i) => i.id);
  assert.deepEqual(ids.sort(), ['charm', 'headstart', 'reroll']);
  for (const item of S.ITEMS) {
    assert.ok(!/checker|piece/i.test(item.id + item.name), `${item.id} is not a piece`);
  }
});

test('empty perks start at zero', () => {
  assert.deepEqual(S.emptyPerks(), { rerolls: 0, moveBonus: 0, headstarts: 0 });
});

test('you can only buy what you can afford', () => {
  const perks = S.emptyPerks();
  assert.equal(S.canBuy(29, 'reroll'), false);
  assert.equal(S.canBuy(30, 'reroll'), true);
  assert.equal(S.canBuy(999, 'nope'), false);
  const poor = S.purchase(10, perks, 'reroll');
  assert.equal(poor.ok, false);
  assert.equal(poor.wallet, 10, 'wallet untouched');
  assert.deepEqual(poor.perks, perks, 'perks untouched');
  const unknown = S.purchase(100, perks, 'extra-checker');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.wallet, 100);
});

test('buying deducts the cost and applies the perk, without mutating', () => {
  const perks = S.emptyPerks();
  const dice = S.purchase(50, perks, 'reroll');
  assert.equal(dice.ok, true);
  assert.equal(dice.wallet, 20);
  assert.equal(dice.perks.rerolls, 1);
  assert.deepEqual(perks, S.emptyPerks(), 'the old perks object is untouched');

  const charm = S.purchase(100, dice.perks, 'charm');
  assert.equal(charm.perks.moveBonus, S.CHARM_POINTS);
  assert.equal(charm.perks.rerolls, 1, 'keeps earlier perks');

  const start = S.purchase(100, charm.perks, 'headstart');
  assert.equal(start.perks.headstarts, 1);
  assert.equal(start.perks.moveBonus, S.CHARM_POINTS);
});

test('perks stack when bought twice', () => {
  let wallet = 200;
  let perks = S.emptyPerks();
  for (let i = 0; i < 2; i++) {
    const r = S.purchase(wallet, perks, 'charm');
    wallet = r.wallet;
    perks = r.perks;
  }
  assert.equal(perks.moveBonus, S.CHARM_POINTS * 2);
  assert.equal(wallet, 200 - 40 * 2);
});

test('clearing a stake pays coins, more for a fast clear', () => {
  assert.equal(S.stakeCoins(1, 40), 45, 'stake I, slow clear');
  assert.equal(S.stakeCoins(1, 20), 55, '20 moves still counts as fast');
  assert.equal(S.stakeCoins(1, 8), 55, 'a very fast clear pays the same bonus');
  assert.equal(S.stakeCoins(1), 45, 'no move count given: no fast bonus');
  assert.equal(S.stakeCoins(2, 40), 60, 'bigger stakes pay more');
  assert.ok(S.stakeCoins(5) > S.stakeCoins(3));
});

test('coins are worth at least one item, so the first shop is always useful', () => {
  const cheapest = Math.min(...S.ITEMS.map((i) => i.cost));
  assert.ok(S.stakeCoins(1) >= cheapest, `${S.stakeCoins(1)} >= ${cheapest}`);
});

test('only the first stake opens a shop, for now', () => {
  assert.equal(S.SHOP_AFTER_STAKE, 1);
  assert.equal(S.opensShop(1), true);
  for (const level of [2, 3, 7]) assert.equal(S.opensShop(level), false, `stake ${level} has no shop yet`);
});

console.log(`\n${passed} checks passed.\n`);
