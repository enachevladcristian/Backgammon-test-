/* ------------------------------------------------------------------
   The shop: after clearing a stake you spend coins on perks.

   Kept deliberately small and rules-safe. Checkers are NOT for sale —
   backgammon is 15 a side and the whole engine (pips, bear-off, win
   detection) depends on it. What you can buy is dice control, a scoring
   charm, and a head start, which all feed the same goal: reaching the
   bigger stakes.

   Pure functions: no DOM, no game flow.
   ------------------------------------------------------------------ */

/** which cleared stake opens the shop — only the first one for now */
export const SHOP_AFTER_STAKE = 1;

export const HEAD_START_POINTS = 120;

/** points added to every move by the charm */
export const CHARM_POINTS = 6;

export const ITEMS = [
  {
    id: 'reroll',
    name: 'Loaded dice',
    icon: '\u2684',
    cost: 30,
    blurb: 'Reroll your dice once a game, before you move.',
    repeatable: true,
  },
  {
    id: 'charm',
    name: 'Lucky charm',
    icon: '\u2726',
    cost: 40,
    blurb: `+${CHARM_POINTS} points on every move, for the rest of the run.`,
    repeatable: true,
  },
  {
    id: 'headstart',
    name: 'Head start',
    icon: '\u2191',
    cost: 55,
    blurb: `Every new game opens with ${HEAD_START_POINTS} points already banked.`,
    repeatable: true,
  },
];

export function emptyPerks() {
  return { rerolls: 0, moveBonus: 0, headstarts: 0 };
}

export function itemById(id) {
  return ITEMS.find((i) => i.id === id) || null;
}

export function canBuy(wallet, id) {
  const item = itemById(id);
  return !!item && wallet >= item.cost;
}

/**
 * Buy an item. Never mutates: returns the new wallet and perks.
 * @returns {{ok:boolean, wallet:number, perks:object, item:object|null}}
 */
export function purchase(wallet, perks, id) {
  const item = itemById(id);
  if (!item || wallet < item.cost) return { ok: false, wallet, perks, item: null };
  const next = { ...perks };
  if (item.id === 'reroll') next.rerolls += 1;
  if (item.id === 'charm') next.moveBonus += CHARM_POINTS;
  if (item.id === 'headstart') next.headstarts += 1;
  return { ok: true, wallet: wallet - item.cost, perks: next, item };
}

/** coins paid for clearing a stake, with a little extra for a fast clear */
export function stakeCoins(level, moves = 99) {
  const base = 30 + 15 * Math.max(1, Math.round(level));
  return base + (moves <= 20 ? 10 : 0);
}

/** does clearing `level` open the shop? */
export function opensShop(level) {
  return Math.round(level) === SHOP_AFTER_STAKE;
}
