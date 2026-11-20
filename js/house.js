/* ------------------------------------------------------------------
   The house: the computer's perks.

   You buy perks with coins; the house earns one every time you clear a
   stake. It never cheats at the board — the moves stay legal — but it
   taxes your scoring and it buys itself the odd piece of dice control.

   Pure functions: no DOM, no game flow.
   ------------------------------------------------------------------ */

export const HOUSE_RULES = [
  {
    id: 'doublesTax',
    name: 'Doubles tax',
    kind: 'tax',
    blurb: 'Any doubles roll: your move scores a third.',
  },
  {
    id: 'secondRoll',
    name: 'Second roll',
    kind: 'power',
    blurb: 'When its dice leave it nothing to play, the house rolls again. Once a game.',
  },
  {
    id: 'blotLevy',
    name: 'Blot levy',
    kind: 'tax',
    blurb: 'Every blot you leave on the board costs 7 more.',
  },
  {
    id: 'loadedPip',
    name: 'Loaded pip',
    kind: 'power',
    blurb: 'When its dice leave it nothing to play, the house nudges a die up by one. Once a game.',
  },
  {
    id: 'sixTax',
    name: 'Six tax',
    kind: 'tax',
    blurb: 'Every roll with a 6 in it pays 6 points.',
  },
  {
    id: 'cap',
    name: 'The cap',
    kind: 'tax',
    blurb: 'No single move scores more than 40.',
  },
];

export const HOUSE_MAX = HOUSE_RULES.length;

/** the rules the house owns after clearing `cleared` stakes */
export function houseRulesFor(cleared) {
  const n = Math.max(0, Math.min(Math.round(cleared) || 0, HOUSE_MAX));
  return HOUSE_RULES.slice(0, n);
}

export function houseIds(rules) {
  return (rules || []).map((r) => r.id);
}

export function hasHouseRule(rules, id) {
  return houseIds(rules).includes(id);
}

/** the one rule the house gains when you clear your `cleared`-th stake */
export function newestRule(cleared) {
  const n = Math.max(0, Math.min(Math.round(cleared) || 0, HOUSE_MAX));
  return n ? HOUSE_RULES[n - 1] : null;
}

export const BLOT_LEVY = 7;
export const SIX_TAX = 6;
export const SCORE_CAP = 40;

/**
 * Apply the house's taxes to a move's points.
 * @param {number} total points the move earned before taxes
 * @param {{isDouble:boolean, usedSix:boolean, newBlots:number}} flags
 * @param {Array} rules the house's rules
 * @returns {{total:number, taxes:string[]}} the taxed total (never below 1)
 */
export function taxMove(total, flags = {}, rules = []) {
  let out = total;
  const taxes = [];
  for (const rule of rules) {
    if (rule.id === 'doublesTax' && flags.isDouble) {
      out = Math.round(out / 3);
      taxes.push('doubles');
    } else if (rule.id === 'blotLevy' && flags.newBlots > 0) {
      out -= BLOT_LEVY * flags.newBlots;
      taxes.push('blot');
    } else if (rule.id === 'sixTax' && flags.usedSix) {
      out -= SIX_TAX;
      taxes.push('six');
    } else if (rule.id === 'cap' && out > SCORE_CAP) {
      out = SCORE_CAP;
      taxes.push('cap');
    }
  }
  return { total: Math.max(1, Math.round(out)), taxes };
}
