/* ------------------------------------------------------------------
   Backgammon — application glue: game flow, input, animation, UI.
   ------------------------------------------------------------------ */

import * as R from './rules.js';
import {
  Renderer, BOARD, DICE_REST, pointX, pointY, offPos, barPos, hitTest,
  qAxisAngle, qSlerp, qMul, qNorm, qFaceUp, faceNormalForValue,
} from './scene.js';
import { bestTurn } from './ai.js';
import { BASE_POINTS, rateMove, moveLabel, stakeTarget, stakeName, gameBonus, openBlots } from './score.js';
import {
  ITEMS, HEAD_START_POINTS, emptyPerks, purchase, stakeCoins, opensShop,
} from './shop.js';
import {
  houseRulesFor, newestRule, hasHouseRule, taxMove,
} from './house.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const canvas = document.getElementById('board');
const renderer = new Renderer(canvas);

const el = {
  turnChip: document.getElementById('turnChip'),
  turnDot: document.getElementById('turnDot'),
  turnText: document.getElementById('turnText'),
  turnSub: document.getElementById('turnSub'),
  rollBtn: document.getElementById('rollBtn'),
  rollLabel: document.getElementById('rollLabel'),
  diceRow: document.getElementById('diceRow'),
  pipW: document.getElementById('pipW'),
  pipB: document.getElementById('pipB'),
  modeBtn: document.getElementById('modeBtn'),
  undoBtn: document.getElementById('undoBtn'),
  soundBtn: document.getElementById('soundBtn'),
  newBtn: document.getElementById('newBtn'),
  toast: document.getElementById('toast'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlayTitle'),
  overlaySub: document.getElementById('overlaySub'),
  overlayBtn: document.getElementById('overlayBtn'),
  hint: document.getElementById('hint'),
  stakeChip: document.getElementById('stakeChip'),
  stakeName: document.getElementById('stakeName'),
  stakeScore: document.getElementById('stakeScore'),
  stakeTarget: document.getElementById('stakeTarget'),
  stakeFill: document.getElementById('stakeFill'),
  floaters: document.getElementById('floaters'),
  rerollBtn: document.getElementById('rerollBtn'),
  shop: document.getElementById('shop'),
  shopCoins: document.getElementById('shopCoins'),
  shopItems: document.getElementById('shopItems'),
  shopDone: document.getElementById('shopDone'),
  shopSub: document.getElementById('shopSub'),
  stakeHouse: document.getElementById('stakeHouse'),
};

const G = {
  state: R.createInitialState(),
  phase: 'roll',        // 'roll' | 'move' | 'over'
  busy: false,
  sel: null,
  hover: null,
  hoverMatches: false,
  flight: null,
  roll: null,
  diceQuats: [null, null],
  options: [],
  undo: [],
  mode: 'ai',
  human: R.WHITE,
  sound: true,
  seq: 0,
  lastRoll: [0, 0],
  run: { level: 1, score: 0, target: stakeTarget(1), cleared: 0, lost: false },
  wallet: 0,
  perks: emptyPerks(),
  movesThisStake: 0,
  turnMoves: 0,
  shopOpen: false,
  shopPending: false,
  passPending: false,
  house: [],                       // rules the computer has earned
  houseUsed: { secondRoll: false, loadedPip: false },
};

const isHuman = () => G.mode === 'human' || G.state.turn === G.human;

/* --------------------------------------------------------------- sound */
let actx = null;

function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { actx = new AC(); } catch { return null; }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function noiseBurst(ctx, at, dur, freq, gain, q = 1) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(at);
}

function sfx(kind) {
  if (!G.sound) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  if (kind === 'dice') {
    for (let i = 0; i < 8; i++) {
      noiseBurst(ctx, t + i * 0.07 + Math.random() * 0.03, 0.055, 1500 + Math.random() * 2400, 0.09, 1.3);
    }
    noiseBurst(ctx, t + 0.62, 0.09, 700, 0.12, 1.1);
  } else if (kind === 'place') {
    noiseBurst(ctx, t, 0.075, 430, 0.14, 1.5);
    noiseBurst(ctx, t + 0.01, 0.05, 1400, 0.05, 1.2);
  } else if (kind === 'hit') {
    noiseBurst(ctx, t, 0.12, 260, 0.2, 1.1);
  } else if (kind === 'win') {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.11, t + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 1);
    });
  }
}

/* ------------------------------------------------------------- helpers */

function syncOptions() {
  G.options = G.phase === 'move' && G.state.dice.length ? R.legalMoveOptions(G.state) : [];
}

function srcMatches(from, sel) {
  if (!sel) return false;
  if (sel.kind === 'bar') return from === R.BAR;
  if (sel.kind === 'point') return from === sel.p;
  return false;
}

function destMatches(to, hit) {
  if (!hit) return false;
  if (hit.kind === 'off') return to === R.OFF;
  if (hit.kind === 'point') return to === hit.p;
  return false;
}

let toastTimer = null;
function toast(msg, ms = 1800) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}

/* ---------------------------------------------------------------- flow */

/* a fresh game gives you a 50/50 draw for the side you play */
function drawSide() {
  return Math.random() < 0.5 ? R.WHITE : R.BLACK;
}

function newGame(opts = {}) {
  G.seq++;
  G.state = R.createInitialState();
  G.phase = 'roll';
  G.busy = false;
  G.sel = null;
  G.flight = null;
  G.roll = null;
  G.diceQuats = [null, null];
  G.undo = [];
  G.hover = null;
  G.run.score = HEAD_START_POINTS * G.perks.headstarts;
  G.run.lost = false;
  G.movesThisStake = 0;
  G.turnMoves = 0;
  G.passPending = false;
  G.houseUsed = { secondRoll: false, loadedPip: false };
  refreshHouse();
  const asked = opts.side === R.WHITE || opts.side === R.BLACK ? opts.side : null;
  G.human = asked === null ? drawSide() : asked;
  hideOverlay();
  closeShop();
  syncOptions();
  updateUI();
  announceSide();
  if (G.shopPending) openShop();     // a stake cleared on the game's last move
  else maybeAI();
}

function announceSide() {
  if (G.mode !== 'ai') return;
  toast(`You play ${R.nameOf(G.human)}`, 2400);
}

/* ------------------------------------------------------------- the run */

/** moves you make bank points; the computer's do not */
const scoresFor = (player) => G.mode === 'human' || player === G.human;

function floatPoints(tag, at) {
  if (!at || !el.floaters) return;
  const s = renderer.cam.project(at.x, at.y, 0.24);
  const d = document.createElement('div');
  d.className = `floater${tag.total <= BASE_POINTS - 8 ? ' bad' : ''}`;
  const label = moveLabel(tag);
  d.innerHTML = `<b>+${tag.total}</b>${label ? `<span>${label}</span>` : ''}`;
  d.style.left = `${s.x.toFixed(1)}px`;
  d.style.top = `${s.y.toFixed(1)}px`;
  el.floaters.appendChild(d);
  const drop = () => {
    if (typeof d.remove === 'function') d.remove();
    else if (el.floaters) el.floaters.removeChild(d);
  };
  setTimeout(drop, 1100);
}

function awardMove(before, after, player, at) {
  if (!scoresFor(player)) return null;
  const tag = rateMove(before, after, player);
  if (G.perks.moveBonus) {
    tag.bonus = G.perks.moveBonus;
    tag.total += G.perks.moveBonus;
  }
  const roll = G.lastRoll || [];
  const taxed = taxMove(tag.total, {
    isDouble: roll.length === 2 && roll[0] === roll[1],
    usedSix: roll.includes(6),
    newBlots: Math.max(0, openBlots(after, player) - openBlots(before, player)),
  }, G.house);
  if (taxed.total !== tag.total) tag.taxes = taxed.taxes;
  tag.total = taxed.total;
  G.run.score += tag.total;
  G.movesThisStake += 1;
  floatPoints(tag, at);
  if (G.run.score >= G.run.target) clearStake();
  else updateStake();
  return tag;
}

function clearStake() {
  const level = G.run.level;
  const cleared = stakeName(level);
  const coins = stakeCoins(level, G.movesThisStake);
  G.wallet += coins;
  G.run.level = level + 1;
  G.run.score = 0;
  G.run.target = stakeTarget(G.run.level);
  G.run.cleared += 1;
  G.movesThisStake = 0;
  sfx('win');
  refreshHouse();
  const gained = newestRule(G.run.cleared);
  toast(gained ? `${cleared} cleared · +${coins} coins · house: ${gained.name}` : `${cleared} cleared · +${coins} coins`, 2800);
  updateStake();
  if (opensShop(level)) {
    G.shopPending = true;
    if (G.phase !== 'over') openShop();
  }
}

/* ----------------------------------------------------------- the shop */

function renderShop() {
  el.shopCoins.textContent = G.wallet;
  el.shopItems.innerHTML = '';
  for (const item of ITEMS) {
    const row = document.createElement('div');
    row.className = 'shop-item';
    const owned = (item.id === 'reroll' && G.perks.rerolls > 0)
      || (item.id === 'charm' && G.perks.moveBonus > 0)
      || (item.id === 'headstart' && G.perks.headstarts > 0);
    if (owned) row.classList.add('owned');
    const icon = document.createElement('span');
    icon.className = 'shop-icon';
    icon.textContent = item.icon;
    const text = document.createElement('span');
    text.className = 'shop-text';
    const name = document.createElement('b');
    name.className = 'shop-name';
    name.textContent = item.name;
    const blurb = document.createElement('span');
    blurb.className = 'shop-blurb';
    blurb.textContent = item.blurb;
    text.appendChild(name);
    text.appendChild(blurb);
    const buy = document.createElement('button');
    buy.className = 'shop-buy';
    buy.textContent = `${item.cost} coins`;
    buy.disabled = G.wallet < item.cost;
    buy.addEventListener('click', () => buyItem(item.id));
    row.appendChild(icon);
    row.appendChild(text);
    row.appendChild(buy);
    el.shopItems.appendChild(row);
  }
}

function buyItem(id) {
  ensureAudio();
  const res = purchase(G.wallet, G.perks, id);
  if (!res.ok) return;
  G.wallet = res.wallet;
  G.perks = res.perks;
  sfx('place');
  toast(`Bought ${res.item.name}`, 1500);
  renderShop();
  updateUI();
}

function openShop() {
  if (G.shopOpen) return;
  G.shopOpen = true;
  G.shopPending = false;
  G.sel = null;
  const gained = newestRule(G.run.cleared);
  el.shopSub.textContent = gained
    ? `Spend your coins — the house answers with “${gained.name}”: ${gained.blurb}`
    : 'Spend your coins — the next stake is bigger.';
  renderShop();
  el.shop.classList.remove('hidden');
  updateUI();
}

function closeShop() {
  const wasOpen = G.shopOpen;
  G.shopOpen = false;
  el.shop.classList.add('hidden');
  if (!wasOpen) return;
  G.shopPending = false;
  updateUI();
  if (G.passPending) {           // the turn that was waiting on the shop
    G.passPending = false;
    passTurn();
    return;
  }
  if (G.phase === 'move' && !G.options.length) {
    completeTurnShortly();
    return;
  }
  maybeAI();
}

/* the loaded dice: reroll before you have moved this turn */
function canReroll() {
  return G.perks.rerolls > 0
    && G.phase === 'move' && !G.busy && isHuman()
    && G.turnMoves === 0 && !G.shopOpen;
}

function rerollNow() {
  if (!canReroll()) return;
  ensureAudio();
  G.perks.rerolls -= 1;
  G.state.dice = [];
  G.phase = 'roll';
  G.sel = null;
  sfx('dice');
  toast('Rerolling', 900);
  syncOptions();
  updateUI();
  rollDice();
}

function refreshHouse() {
  G.house = houseRulesFor(G.run.cleared);
  updateStake();
}

function loseStake() {
  G.run.level = 1;
  G.run.score = 0;
  G.run.target = stakeTarget(1);
  G.run.lost = true;
  updateStake();
}

function updateStake() {
  const run = G.run;
  el.stakeName.textContent = stakeName(run.level);
  el.stakeScore.textContent = run.score;
  el.stakeTarget.textContent = run.target;
  const pct = Math.max(0, Math.min(100, (run.score / run.target) * 100));
  if (el.stakeFill.style) el.stakeFill.style.width = `${pct.toFixed(1)}%`;
  el.stakeChip.classList.toggle('ready', pct >= 75);

  if (el.stakeHouse) {
    const names = G.house.map((r) => r.name.toLowerCase());
    el.stakeHouse.textContent = names.length ? `House: ${names.join(' · ')}` : '';
    el.stakeHouse.classList.toggle('hidden', !names.length);
  }
  el.stakeChip.title = `${stakeName(run.level)}: bank ${run.target - run.score} more points to clear it`;
}

function rollDice() {
  if (G.phase !== 'roll' || G.busy || G.shopOpen) return;
  const a = 1 + Math.floor(Math.random() * 6);
  const b = 1 + Math.floor(Math.random() * 6);
  G.lastRoll = [a, b];
  G.state.dice = (a === b ? [a, a, a, a] : [a, b]).map((v) => ({ v, used: false }));
  G.phase = 'move';
  G.busy = true;
  G.sel = null;
  syncOptions();
  updateUI();
  sfx('dice');

  const now = performance.now();
  const dur = 840;
  const startQ = () => qNorm(qAxisAngle(
    [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1],
    Math.random() * TAU,
  ));
  const dice = [a, b].map((v, i) => ({
    value: v,
    p0: { x: 1.7 + i * 0.5 - Math.random() * 0.3, y: -2.6 - i * 0.35, z: 3.6 + Math.random() * 0.4 },
    p1: { x: DICE_REST[i].x, y: DICE_REST[i].y, z: -BOARD.THICK + BOARD.DIE / 2 },
    q0: startQ(),
    q1: qFaceUp(faceNormalForValue(v), Math.random() * TAU),
  }));
  G.roll = { t0: now, dur, dice };
}

function finishRoll() {
  const r = G.roll;
  G.roll = null;
  G.diceQuats = r.dice.map((d) => d.q1);
  G.busy = false;
  syncOptions();
  updateUI();
  afterRoll();
}

function afterRoll() {
  const st = G.state;
  if (G.phase !== 'move') return;
  if (!G.options.length) {
    if (!isHuman() && houseRescue()) return;
    toast(`${R.nameOf(st.turn)} has no legal moves`);
    const seq = G.seq;
    G.busy = true;
    updateUI();
    setTimeout(() => {
      if (seq !== G.seq) return;
      G.busy = false;
      passTurn();
    }, 900);
    return;
  }
  if (st.bar[st.turn] > 0) G.sel = { kind: 'bar' };
  updateUI();
  if (!isHuman()) aiMove();
}

/* the house spends a charge rather than lose its turn */
function houseRescue() {
  if (G.mode !== 'ai' || isHuman()) return false;
  const st = G.state;
  const used = G.houseUsed || {};
  // loaded pip: nudge the die that gives it something to play
  if (hasHouseRule(G.house, 'loadedPip') && !used.loadedPip) {
    for (const die of st.dice) {
      if (die.used || die.v >= 6) continue;
      const before = die.v;
      die.v = before + 1;
      syncOptions();
      if (G.options.length) {
        used.loadedPip = true;
        sfx('place');
        toast('The house loads a pip', 1500);
        updateUI();
        return true;
      }
      die.v = before;
    }
    syncOptions();
  }
  // second roll: take the dice again
  if (hasHouseRule(G.house, 'secondRoll') && !used.secondRoll) {
    used.secondRoll = true;
    toast('The house rolls again', 1500);
    rerollForAI();
    return true;
  }
  return false;
}

function rerollForAI() {
  G.state.dice = [];
  G.phase = 'roll';
  G.sel = null;
  syncOptions();
  updateUI();
  rollDice();
}

function passTurn() {
  if (G.shopOpen) {              // the shop freezes the table
    G.busy = false;
    G.passPending = true;        // hand the turn over as soon as it closes
    return;
  }
  const st = G.state;
  G.turnMoves = 0;
  st.turn = R.other(st.turn);
  st.dice = [];
  G.phase = 'roll';
  G.sel = null;
  G.undo = [];
  G.hover = null;
  G.turnMoves = 0;
  syncOptions();
  updateUI();
  maybeAI();
}

function maybeAI() {
  if (G.shopOpen) return;
  if (G.mode !== 'ai' || G.state.turn === G.human) return;
  if (G.phase !== 'roll') return;
  const seq = G.seq;
  setTimeout(() => {
    if (seq !== G.seq) return;
    if (G.phase !== 'roll' || G.busy) return;
    rollDice();
  }, 720);
}

async function aiMove() {
  const seq = G.seq;
  await sleep(380);
  // keep re-planning so the computer never stalls, even if a move is
  // invalidated by something unexpected
  let guard = 0;
  while (seq === G.seq && G.phase === 'move' && !G.busy && !isHuman() && guard++ < 12) {
    const opts = R.legalMoveOptions(G.state);
    if (!opts.length) break;
    const plan = bestTurn(G.state, G.state.turn);
    await animateMove(plan[0] || opts[0]);
    if (seq !== G.seq) return;
    await sleep(200);
  }
}

function animateMove(mv) {
  return new Promise((resolve) => {
    const st = G.state;
    const player = st.turn;
    let from;
    if (mv.from === R.BAR) {
      const bp = barPos(player, Math.max(0, st.bar[player] - 1));
      from = { x: bp.x, y: bp.y, z: bp.z };
    } else {
      from = { x: pointX(mv.from), y: pointY(mv.from), z: Math.max(0, R.countAt(st, mv.from) - 1) * BOARD.CSTEP };
    }
    let to;
    if (mv.to === R.OFF) {
      const pos = offPos(player, st.off[player]);
      to = { x: pos.x, y: pos.y, z: 0.03 };
    } else {
      to = { x: pointX(mv.to), y: pointY(mv.to), z: R.countAt(st, mv.to) * BOARD.CSTEP };
    }
    G.busy = true;
    G.sel = null;
    G.flight = {
      t0: performance.now(),
      dur: 270,
      arc: 0.42 + Math.random() * 0.12,
      owner: player,
      mv,
      from,
      to,
      surfaceZ: mv.from === R.BAR ? BOARD.BAR_TOP : 0.01,
      shrink: mv.to === R.OFF,
      hide: mv.from === R.BAR ? { kind: 'bar', player } : { kind: 'point', p: mv.from },
      resolve,
    };
    sfx('place');
    updateUI();
  });
}

function completeFlight() {
  const f = G.flight;
  G.flight = null;
  const before = G.state;
  const barBefore = [before.bar[0], before.bar[1]];
  G.undo.push({ state: before, sel: G.sel });

  let st = R.applyMove(before, f.mv, f.owner);
  st = R.useDie(st, f.mv.die);
  G.state = st;
  G.busy = false;
  if (f.owner === G.state.turn) G.turnMoves += 1;

  const opp = R.other(f.owner);
  if (st.bar[opp] > barBefore[opp]) {
    sfx('hit');
    toast(`${R.nameOf(f.owner)} hit a blot!`, 1300);
  }

  awardMove(before, st, f.owner, f.to);

  syncOptions();
  // keep the bar selected while there are still checkers to bring in
  if (st.bar[f.owner] > 0 && G.options.some((o) => o.from === R.BAR)) G.sel = { kind: 'bar' };
  const w = R.winnerOf(st);
  if (w !== null) {
    G.phase = 'over';
    updateUI();
    endGame(w);
    if (f.resolve) f.resolve();
    return;
  }

  if (!G.options.length) completeTurnShortly();
  updateUI();
  if (f.resolve) f.resolve();
}

function completeTurnShortly() {
  const seq = G.seq;
  G.busy = true;
  updateUI();
  setTimeout(() => {
    if (seq !== G.seq || G.phase !== 'move') return;
    G.busy = false;
    passTurn();
  }, 520);
}

function endGame(winner) {
  const kind = R.winKind(G.state, winner);
  const pts = kind === 'single' ? 1 : kind === 'gammon' ? 2 : 3;
  const score = kind === 'single'
    ? 'A clean single game.'
    : `${kind === 'gammon' ? 'Gammon' : 'Backgammon'} — worth ${pts} points.`;
  if (G.mode === 'ai') {
    const youWon = winner === G.human;
    el.overlayTitle.textContent = youWon ? 'You win' : 'Computer wins';
    let runLine;
    if (youWon) {
      const bonus = gameBonus(kind);
      G.run.score += bonus;
      const cleared = G.run.score >= G.run.target;
      if (cleared) clearStake();
      else updateStake();
      runLine = cleared
        ? ` +${bonus} for the win clears ${stakeName(G.run.level - 1)}.`
        : ` +${bonus} for the win — ${Math.max(0, G.run.target - G.run.score)} short of ${stakeName(G.run.level)}.`;
    } else {
      const stake = stakeName(G.run.level);
      loseStake();
      runLine = ` ${stake} lost — the run is back to stake I.`;
    }
    el.overlaySub.textContent = `${R.nameOf(winner)} takes it. ${score} You played ${R.nameOf(G.human)}.${runLine}`;
  } else {
    el.overlayTitle.textContent = `${R.nameOf(winner)} wins`;
    el.overlaySub.textContent = score;
  }
  el.overlay.classList.remove('hidden');
  sfx('win');
  updateUI();
}

function hideOverlay() {
  el.overlay.classList.add('hidden');
}

/* --------------------------------------------------------------- input */

function pickCandidate(cands, fromPoint) {
  if (cands.length === 1) return cands[0];
  const st = G.state;
  const scored = cands.map((c) => {
    if (c.to !== R.OFF) return { c, k: 0 };
    const dist = st.turn === R.WHITE ? fromPoint : 25 - fromPoint;
    return { c, k: Math.abs(c.die - dist) };
  });
  scored.sort((a, b) => a.k - b.k);
  return scored[0].c;
}

function onBoardClick(sx, sy) {
  if (G.shopOpen) return;
  if (G.phase !== 'move' || G.busy || !isHuman()) {
    if (G.phase === 'roll' && isHuman() && !G.busy) rollDice();
    return;
  }
  const st = G.state;
  const world = renderer.cam.unproject(sx, sy);
  const hit = hitTest(world);

  if (G.sel) {
    const cands = G.options.filter((o) => srcMatches(o.from, G.sel) && destMatches(o.to, hit));
    if (cands.length) {
      const fromP = G.sel.kind === 'bar' ? 0 : G.sel.p;
      animateMove(pickCandidate(cands, fromP));
      return;
    }
  }

  const sel = selectAt(hit);
  G.sel = sel;
  updateUI();
  if (hit && sel && !sel.changed) {
    // clicking the same selected source again does nothing
  }
}

function selectAt(hit) {
  if (!hit) return null;
  const st = G.state;
  const player = st.turn;
  if (hit.kind === 'bar') {
    if (st.bar[player] > 0 && G.options.some((o) => o.from === R.BAR)) return { kind: 'bar' };
    return null;
  }
  if (hit.kind === 'point') {
    const pt = st.points[hit.p - 1];
    if (pt.owner === player && pt.count > 0 && G.options.some((o) => o.from === hit.p)) {
      return { kind: 'point', p: hit.p };
    }
  }
  if (hit.kind === 'off') {
    if (G.options.some((o) => o.to === R.OFF) && st.bar[player] === 0) {
      // nothing to select, but the tray is a valid drop target already
      return null;
    }
  }
  return null;
}

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  const p = pointerPos(e);
  onBoardClick(p.x, p.y);
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointerPos(e);
  const world = renderer.cam.unproject(p.x, p.y);
  const hit = hitTest(world);
  G.hover = hit;
  let clickable = false;
  if (hit && G.phase === 'move' && !G.busy && isHuman()) {
    if (G.sel && G.options.some((o) => srcMatches(o.from, G.sel) && destMatches(o.to, hit))) clickable = true;
    else if (!G.sel && selectAtQuiet(hit)) clickable = true;
  }
  canvas.style.cursor = clickable ? 'pointer' : 'default';
});

canvas.addEventListener('pointerleave', () => { G.hover = null; });

function selectAtQuiet(hit) {
  const st = G.state;
  const player = st.turn;
  if (hit.kind === 'bar') return st.bar[player] > 0 && G.options.some((o) => o.from === R.BAR);
  if (hit.kind === 'point') {
    const pt = st.points[hit.p - 1];
    return pt.owner === player && pt.count > 0 && G.options.some((o) => o.from === hit.p);
  }
  return false;
}

el.rollBtn.addEventListener('click', () => {
  ensureAudio();
  if (isHuman() && !G.busy) rollDice();
});

el.newBtn.addEventListener('click', () => { ensureAudio(); newGame(); });
el.overlayBtn.addEventListener('click', () => { ensureAudio(); newGame(); });
el.shopDone.addEventListener('click', () => { ensureAudio(); closeShop(); });
el.rerollBtn.addEventListener('click', () => rerollNow());

el.modeBtn.addEventListener('click', () => {
  G.mode = G.mode === 'ai' ? 'human' : 'ai';
  updateUI();
  if (G.mode === 'ai' && !isHuman() && G.phase === 'roll' && !G.busy) maybeAI();
  if (G.mode === 'ai' && G.phase === 'move' && !G.busy && !isHuman()) aiMove();
});

el.undoBtn.addEventListener('click', () => {
  if (G.busy || !isHuman() || G.phase !== 'move' || !G.undo.length) return;
  const snap = G.undo.pop();
  G.state = snap.state;
  G.sel = null;
  syncOptions();
  updateUI();
});

el.soundBtn.addEventListener('click', () => {
  G.sound = !G.sound;
  el.soundBtn.classList.toggle('off', !G.sound);
  el.soundBtn.setAttribute('aria-pressed', String(G.sound));
  if (G.sound) { ensureAudio(); sfx('place'); }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (G.shopOpen) return;
    if (G.phase === 'roll' && isHuman() && !G.busy) { ensureAudio(); rollDice(); }
  } else if (e.key === 'Escape') {
    G.sel = null;
    updateUI();
  } else if (e.key === 'r' || e.key === 'R') {
    if (canReroll()) rerollNow();
  } else if (e.key === 'n' || e.key === 'N') {
    newGame();
  }
});

/* ------------------------------------------------------------------ ui */

const PIP_POS = {
  1: [[50, 50]],
  2: [[27, 27], [73, 73]],
  3: [[27, 27], [50, 50], [73, 73]],
  4: [[27, 27], [73, 27], [27, 73], [73, 73]],
  5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]],
  6: [[27, 24], [73, 24], [27, 50], [73, 50], [27, 76], [73, 76]],
};

function miniDie(value, used, empty) {
  const d = document.createElement('div');
  d.className = 'mini-die' + (used ? ' used' : '') + (empty ? ' empty' : '');
  if (empty) {
    d.innerHTML = '<span class="q">?</span>';
    return d;
  }
  for (const [x, y] of PIP_POS[value] || []) {
    const p = document.createElement('i');
    p.style.left = `${x}%`;
    p.style.top = `${y}%`;
    d.appendChild(p);
  }
  return d;
}

function updateUI() {
  const st = G.state;
  const turn = st.turn;

  // turn chip
  el.turnDot.className = `dot ${turn === R.WHITE ? 'white' : 'black'}`;
  let title;
  let sub;
  if (G.phase === 'over') {
    title = 'Game over';
    sub = 'Press New to play again';
  } else if (G.mode === 'ai') {
    if (turn === G.human) {
      title = `Your turn · ${R.nameOf(G.human)}`;
      sub = G.phase === 'roll' ? 'Roll the dice' : 'Move a checker';
    } else {
      title = `Computer · ${R.nameOf(turn)}`;
      sub = G.phase === 'roll' ? 'Rolling soon…' : 'Playing…';
    }
  } else if (turn === R.WHITE) {
    title = "White's turn";
    sub = G.phase === 'roll' ? 'Roll the dice' : 'Move a checker';
  } else {
    title = "Black's turn";
    sub = G.phase === 'roll' ? 'Roll the dice' : 'Move a checker';
  }
  if (G.busy && G.phase === 'move' && !isHuman()) sub = 'Thinking…';
  el.turnText.textContent = title;
  el.turnSub.textContent = G.busy && G.phase === 'roll' ? 'Rolling…' : sub;

  // roll button
  const canRoll = G.phase === 'roll' && !G.busy && isHuman() && !G.shopOpen;
  el.rollBtn.disabled = !canRoll;
  el.rollBtn.classList.toggle('pulse', canRoll);
  el.rollLabel.textContent = canRoll
    ? 'Roll dice'
    : G.phase === 'move'
      ? (isHuman() ? 'Make a move' : 'Playing…')
      : G.phase === 'over' ? 'Game over' : 'Rolling…';

  // dice row
  el.diceRow.innerHTML = '';
  if (!st.dice.length) {
    el.diceRow.appendChild(miniDie(1, false, true));
    el.diceRow.appendChild(miniDie(1, false, true));
  } else {
    const extra = [];
    if (st.dice.length === 4) {
      for (const d of st.dice) extra.push(miniDie(d.v, d.used, false));
    } else {
      for (const d of st.dice) extra.push(miniDie(d.v, d.used, false));
    }
    for (const d of extra) el.diceRow.appendChild(d);
    if (st.dice.length === 1) el.diceRow.appendChild(miniDie(1, false, true));
  }

  // pips
  el.pipW.textContent = R.pipCount(st, R.WHITE);
  el.pipB.textContent = R.pipCount(st, R.BLACK);
  el.pipW.parentElement.classList.toggle('active', turn === R.WHITE);
  el.pipB.parentElement.classList.toggle('active', turn === R.BLACK);
  el.pipW.parentElement.classList.toggle('you', G.mode === 'ai' && G.human === R.WHITE);
  el.pipB.parentElement.classList.toggle('you', G.mode === 'ai' && G.human === R.BLACK);

  updateStake();

  // loaded dice
  const reroll = canReroll();
  // shown whenever you own dice control, enabled only before you move this turn
  el.rerollBtn.classList.toggle('hidden', !(G.perks.rerolls > 0 && isHuman() && !G.shopOpen));
  el.rerollBtn.disabled = !reroll;
  el.rerollBtn.textContent = `Reroll · ${G.perks.rerolls}`;

  el.undoBtn.disabled = !(G.undo.length > 0 && isHuman() && !G.busy && G.phase === 'move');
  el.modeBtn.textContent = G.mode === 'ai' ? 'vs Computer' : 'Two players';
  el.modeBtn.classList.toggle('on', G.mode === 'ai');

  // hint
  if (G.phase === 'move' && isHuman() && !G.busy) {
    if (st.bar[turn] > 0) el.hint.textContent = 'Re-enter from the bar';
    else if (G.sel) el.hint.textContent = 'Tap a glowing point to move';
    else el.hint.textContent = 'Tap a checker to move it';
  } else if (G.phase === 'roll' && isHuman()) {
    el.hint.textContent = 'Press Space or tap Roll';
  } else {
    el.hint.textContent = '';
  }
}

/* ---------------------------------------------------------------- render */

function computeTargets() {
  const st = G.state;
  if (G.phase !== 'move' || G.busy || !G.sel || !isHuman()) return [];
  const mine = G.options.filter((o) => srcMatches(o.from, G.sel));
  const map = new Map();
  for (const o of mine) {
    const key = o.to === R.OFF ? 'off' : `p${o.to}`;
    if (!map.has(key)) map.set(key, { key, to: o.to, die: o.die });
  }
  const out = [];
  for (const t of map.values()) {
    if (t.to === R.OFF) {
      const pos = offPos(st.turn, Math.min(15, st.off[st.turn]));
      out.push({ ...t, x: pos.x, y: pos.y, z: 0.62 });
    } else {
      const cnt = R.countAt(st, t.to);
      out.push({ ...t, x: pointX(t.to), y: pointY(t.to), z: cnt * BOARD.CSTEP + BOARD.CH + 0.34 });
    }
  }
  return out;
}

function computeDice(now) {
  const st = G.state;
  if (G.roll) {
    const raw = clamp((now - G.roll.t0) / G.roll.dur, 0, 1);
    const e = easeOut(raw);
    return G.roll.dice.map((d) => {
      const spin = qAxisAngle([0.35, 1, 0.15], (1 - e) * 11);
      const q = qNorm(qMul(spin, qSlerp(d.q0, d.q1, e)));
      const bounce = Math.sin(Math.PI * Math.min(1, raw * 1.06)) * 1.45 * (1 - raw * 0.35);
      return {
        x: d.p0.x + (d.p1.x - d.p0.x) * e,
        y: d.p0.y + (d.p1.y - d.p0.y) * e,
        z: d.p0.z + (d.p1.z - d.p0.z) * e + bounce,
        q,
        value: d.value,
        used: false,
      };
    });
  }
  if (!st.dice.length) return [];
  const vals = st.dice[0].v === st.dice[1]?.v && st.dice.length === 4
    ? [st.dice[0].v, st.dice[0].v]
    : [st.dice[0].v, st.dice[1] ? st.dice[1].v : st.dice[0].v];
  return vals.map((v, i) => {
    const remaining = st.dice.some((d) => !d.used && d.v === v);
    const q = G.diceQuats[i] || qFaceUp(faceNormalForValue(v), i * 1.2);
    return {
      x: DICE_REST[i].x,
      y: DICE_REST[i].y,
      z: -BOARD.THICK + BOARD.DIE / 2,
      q,
      value: v,
      used: !remaining && G.phase === 'move',
    };
  });
}

function buildView(now) {
  const targets = computeTargets();
  const keys = new Set(targets.map((t) => t.key));
  const hoverMatches = !!(G.hover && G.sel && targets.some((t) => {
    if (t.to === R.OFF) return G.hover.kind === 'off';
    return G.hover.kind === 'point' && G.hover.p === t.to;
  }));
  return {
    state: G.state,
    time: now,
    selected: G.phase === 'move' && !G.busy ? G.sel : null,
    targets,
    targetKeys: keys,
    hover: G.hover,
    hoverMatches,
    flight: G.flight,
    hideTop: G.flight ? G.flight.hide : null,
    dice: computeDice(now),
  };
}

function frame(now) {
  if (G.roll && now - G.roll.t0 >= G.roll.dur) finishRoll();
  if (G.flight && now - G.flight.t0 >= G.flight.dur) completeFlight();
  renderer.render(buildView(now));
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------- boot */

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  renderer.resize(w, h, dpr);
}

window.addEventListener('resize', resize);
if (window.ResizeObserver) {
  new ResizeObserver(resize).observe(canvas);
}

resize();
newGame();          // first game also draws a side
requestAnimationFrame(frame);

// handy for debugging from the console
window.__bg = {
  G, R, renderer, newGame, rollDice, drawSide, updateStake, houseRescue, taxMove,
};
