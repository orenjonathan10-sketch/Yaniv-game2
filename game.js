'use strict';
/* ============================================================
   יניב! — משחק קלפים לנייד
   נגד בוטים · באותו מכשיר · אונליין ממכשירים שונים (PeerJS)
   ============================================================ */

/* ---------- כלים ---------- */
const $ = s => document.querySelector(s);
const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

/* ---------- צלילים (WebAudio, ללא קבצים) ---------- */
let audioCtx = null;
let muted = localStorage.getItem('yaniv-muted') === '1';
function ac() {
  if (!audioCtx) { const C = window.AudioContext || window.webkitAudioContext; if (C) audioCtx = new C(); }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function blip(freq, dur = .09, type = 'triangle', gain = .13, delay = 0) {
  if (muted) return;
  const ctx = ac(); if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + .02);
}
const snd = {
  select() { blip(660, .05, 'sine', .08); },
  throw()  { blip(300, .08); blip(430, .08, 'triangle', .11, .05); },
  draw()   { blip(520, .07, 'sine', .1); },
  deal()   { blip(390, .05, 'sine', .07); },
  yaniv()  { [523, 659, 784, 1047].forEach((f, i) => blip(f, .18, 'triangle', .14, i * .1)); },
  assaf()  { [330, 262, 196].forEach((f, i) => blip(f, .22, 'sawtooth', .1, i * .12)); },
  win()    { [523, 659, 784, 1047, 1319].forEach((f, i) => blip(f, .22, 'triangle', .14, i * .12)); },
  slap()   { blip(180, .12, 'square', .12); blip(700, .09, 'triangle', .11, .06); },
  bad()    { blip(160, .16, 'sawtooth', .09); },
};

/* ---------- קלפים ---------- */
const SUITS = ['♠', '♥', '♦', '♣'];
const RED_SUIT = s => s === 1 || s === 2;
const RNAME = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
let cardSeq = 0;

function newDeck() {
  const d = [];
  for (let s = 0; s < 4; s++)
    for (let r = 1; r <= 13; r++) d.push({ id: ++cardSeq, r, s, j: false });
  d.push({ id: ++cardSeq, r: 0, s: -1, j: true });
  d.push({ id: ++cardSeq, r: 0, s: -1, j: true });
  return shuffle(d);
}
const val = c => c.j ? 0 : (c.r > 10 ? 10 : c.r);
const handSum = h => h.reduce((a, c) => a + val(c), 0);
const cardName = c => c.j ? "ג'וקר" : RNAME[c.r] + SUITS[c.s];
const describeCards = cs => cs.map(cardName).join(' ');
const pub = c => ({ id: c.id, r: c.r, s: c.s, j: c.j });

/* בדיקת חוקיות זריקה: קלף בודד / סט (אותו ערך) / רצף (3+ באותה צורה, ג'וקר משלים) */
function validThrow(cards) {
  if (!cards.length) return null;
  if (cards.length === 1) return { type: 'single', ordered: [...cards] };
  const nj = cards.filter(c => !c.j), jk = cards.filter(c => c.j);
  if (nj.length === 0) return { type: 'set', ordered: [...cards] }; // זוג ג'וקרים
  if (jk.length === 0 && nj.every(c => c.r === nj[0].r)) return { type: 'set', ordered: [...cards] };
  if (cards.length >= 3 && nj.every(c => c.s === nj[0].s)) {
    const ranks = nj.map(c => c.r).sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i++) if (ranks[i] === ranks[i - 1]) return null;
    const min = ranks[0], max = ranks[ranks.length - 1];
    const gaps = (max - min + 1) - nj.length;
    if (gaps < 0 || gaps > jk.length) return null;
    const extra = jk.length - gaps;
    if ((min - 1) + (13 - max) < extra) return null;
    const hiExt = Math.min(extra, 13 - max);
    const loExt = extra - hiExt;
    const bySlot = new Map(nj.map(c => [c.r, c]));
    const jpool = [...jk];
    const ordered = [];
    for (let r = min - loExt; r <= max + hiExt; r++) ordered.push(bySlot.get(r) || jpool.pop());
    return { type: 'run', ordered };
  }
  return null;
}

/* ============================================================
   מנוע המשחק (רץ אצל המארח / מקומית)
   ============================================================ */
const BOT_POOL = [
  { n: 'דני', a: '🦊' }, { n: 'נועה', a: '🐼' }, { n: 'יוסי', a: '🐯' },
  { n: 'מאיה', a: '🦉' }, { n: 'רוני', a: '🐸' }, { n: 'שירה', a: '🐰' },
];
const AVATARS = ['😎', '🤠', '🦁', '🐼', '🐯', '🦊', '🐸', '🐰', '🦉', '🐨'];
const YANIV_MAX = 7;

let GAMEMODE = null; // 'bots' | 'hotseat' | 'online'
const G = {
  diff: 'med', target: 100, slap: true,
  players: [], deck: [], pile: [],
  turn: 0, starter: 0, round: 0,
  phase: 'idle', // turn | slap | reveal | roundEnd | over
  pending: null,
  over: false,
  slapFor: -1, slapCard: null, slapTimer: null, turnNo: 0,
  results: null, winnerSeat: -1,
  fx: [], fxSeq: 0,
};

const activeIdx = () => G.players.map((p, i) => p.out ? -1 : i).filter(i => i >= 0);
const nextActive = i => { let k = i; do { k = (k + 1) % G.players.length; } while (G.players[k].out); return k; };
const topThrow = () => G.pile[G.pile.length - 1];
function throwEnds(t) {
  if (!t || !t.cards.length) return [];
  const a = t.cards[0], b = t.cards[t.cards.length - 1];
  return a === b ? [a] : [a, b];
}

function fx(kind, data) {
  G.fx.push({ seq: ++G.fxSeq, kind, ...data });
  if (G.fx.length > 10) G.fx.shift();
}

function startGame(cfg) {
  Object.assign(G, {
    diff: cfg.diff || 'med', target: cfg.target, slap: cfg.slap,
    players: cfg.players, round: 0, starter: 0, over: false,
    pile: [], pending: null, results: null, winnerSeat: -1, fx: [], fxSeq: 0,
  });
  G.turnNo = 0;
  clearTimeout(G.slapTimer);
  UI.lastFxSeq = 0; UI.lastRound = 0; UI.curtainFor = ''; UI.selected.clear();
  $('#tb-target').textContent = 'עד ' + G.target;
  showScreen('game');
  startRound();
}

function startRound() {
  G.round++;
  G.deck = newDeck();
  G.pile = [];
  G.pending = null;
  G.results = null;
  for (const p of G.players) p.hand = [];
  for (let k = 0; k < 5; k++) for (const i of activeIdx()) G.players[i].hand.push(G.deck.pop());
  for (const i of activeIdx()) sortHand(G.players[i]);
  G.pile.push({ cards: [G.deck.pop()], by: -1 });
  G.turn = G.players[G.starter].out ? nextActive(G.starter) : G.starter;
  G.phase = 'deal';
  fx('sound', { name: 'deal' });
  sync();
  setTimeout(beginTurn, 700);
}

function sortHand(p) {
  p.hand.sort((a, b) => (a.j ? 99 : a.r) - (b.j ? 99 : b.r) || a.s - b.s);
}

function beginTurn() {
  if (G.over) return;
  const p = G.players[G.turn];
  G.turnNo++;
  G.pending = null;
  if (p.hand.length === 0) { declareYaniv(G.turn); return; } // יד ריקה = יניב אוטומטי
  G.phase = 'turn';
  sync();
  if (p.bot) botTurn(p).catch(console.error);
}

/* פעולה משחקן (מקומי או מהרשת) */
function applyAction(seat, a) {
  if (!a || G.over && a.k !== 'again') return;
  if (a.k === 'move') applyMove(seat, a.ids || [], a.src);
  else if (a.k === 'yaniv') {
    const p = G.players[seat];
    if (G.phase === 'turn' && G.turn === seat && !p.bot && handSum(p.hand) <= YANIV_MAX) declareYaniv(seat);
  }
  else if (a.k === 'slap') applySlap(seat, !!a.take);
  else if (a.k === 'next') { if (G.phase === 'roundEnd' && (NET.role !== 'host' || seat === 0)) startRound(); }
}

/* זרוק + משוך בפעולה אחת: src = 'deck' או id של קלף קצה בערימה */
function applyMove(seat, ids, src) {
  if (G.phase !== 'turn' || G.turn !== seat) return;
  const p = G.players[seat];
  const cards = ids.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
  if (!cards.length || cards.length !== ids.length) return;
  const v = validThrow(cards);
  if (!v) return;
  let pileCard = null;
  if (src !== 'deck') {
    pileCard = throwEnds(topThrow()).find(c => c.id === src);
    if (!pileCard) return;
  }
  p.hand = p.hand.filter(c => !cards.includes(c));
  G.pending = { cards: v.ordered, by: seat };
  fx('sound', { name: 'throw' });

  let drawn = null, fromDeck = false;
  if (pileCard) {
    drawn = takeFromPile(pileCard);
    fx('toast', { msg: `${p.name} זרק ${describeCards(v.ordered)} ולקח את ה-${cardName(pileCard)}` });
  } else {
    drawn = drawFromDeck();
    if (drawn) fromDeck = true;
    else { const e = throwEnds(topThrow()); if (e.length) drawn = takeFromPile(e[0]); }
    fx('toast', { msg: `${p.name} זרק ${describeCards(v.ordered)} ומשך מהקופה` });
  }
  if (drawn) { p.hand.push(drawn); sortHand(p); }
  fx('sound', { name: 'draw' });

  if (G.slap && fromDeck && drawn && canSlap(drawn, G.pending)) {
    G.phase = 'slap';
    G.slapFor = seat;
    G.slapCard = drawn;
    clearTimeout(G.slapTimer);
    G.slapTimer = setTimeout(() => applySlap(seat, false), 3500);
    sync();
    return;
  }
  commitTurn();
}

function applySlap(seat, take) {
  if (G.phase !== 'slap' || G.slapFor !== seat) return;
  clearTimeout(G.slapTimer);
  const p = G.players[seat];
  if (take && G.slapCard) {
    const i = p.hand.indexOf(G.slapCard);
    if (i >= 0) {
      p.hand.splice(i, 1);
      G.pending.cards.push(G.slapCard);
      fx('sound', { name: 'slap' });
      fx('toast', { msg: `${p.name} הצמיד ${cardName(G.slapCard)}! 🖐` });
    }
  }
  G.slapCard = null;
  G.slapFor = -1;
  commitTurn();
}

function drawFromDeck() {
  if (!G.deck.length) recycleDeck();
  return G.deck.pop() || null;
}
function recycleDeck() {
  if (G.pile.length <= 1) return;
  const keep = G.pile.pop();
  G.deck = shuffle(G.pile.flatMap(t => t.cards));
  G.pile = [keep];
}
function takeFromPile(card) {
  const t = topThrow();
  const i = t ? t.cards.indexOf(card) : -1;
  if (i < 0) return null;
  t.cards.splice(i, 1);
  return card;
}
function canSlap(drawn, pending) {
  if (!pending || drawn.j) return false;
  const nj = pending.cards.filter(c => !c.j);
  return nj.length > 0 && nj.every(c => c.r === nj[0].r) && drawn.r === nj[0].r;
}

function commitTurn() {
  if (G.pending) { G.pile.push(G.pending); G.pending = null; }
  G.phase = 'busy';
  sync();
  G.turn = nextActive(G.turn);
  setTimeout(beginTurn, G.players[G.turn].bot ? 250 : 450);
}

/* ---------- יניב / אסף / ניקוד ---------- */
async function declareYaniv(caller) {
  G.phase = 'reveal';
  const cp = G.players[caller];
  const cSum = handSum(cp.hand);
  fx('toast', { msg: `${cp.name} מכריז יניב עם ${cSum}!` });
  fx('splash', { text: 'יניב!', red: false });
  fx('sound', { name: 'yaniv' });
  sync();
  await sleep(1500);

  let assafer = -1, best = Infinity;
  for (const i of activeIdx()) {
    if (i === caller) continue;
    const s = handSum(G.players[i].hand);
    if (s <= cSum && s < best) { best = s; assafer = i; }
  }
  if (assafer >= 0) {
    fx('toast', { msg: `${G.players[assafer].name} עם ${best} — אסף!` });
    fx('splash', { text: 'אסף!!', red: true });
    fx('sound', { name: 'assaf' });
    sync();
    await sleep(1600);
  }

  const results = [];
  for (const i of activeIdx()) {
    const p = G.players[i];
    const s = handSum(p.hand);
    let add, badge;
    if (i === caller && assafer < 0) { add = 0; badge = 'yaniv'; }
    else if (i === caller) { add = s + 30; badge = 'caught'; }
    else if (i === assafer) { add = 0; badge = 'assaf'; }
    else { add = s; badge = null; }
    let total = p.score + add;
    let halved = false;
    if (add > 0 && total > 0 && total % 50 === 0) { total = total / 2; halved = true; }
    p.score = total;
    const out = total > G.target;
    if (out) p.out = true;
    results.push({
      seat: i, name: p.name, avatar: p.avatar,
      hand: p.hand.map(pub), sum: s, add, halved, badge, out, total,
    });
  }

  G.starter = assafer >= 0 ? assafer : caller;
  G.results = results;
  const alive = activeIdx();
  if (alive.length <= 1) {
    G.over = true;
    if (alive.length === 0) {
      const w = results.reduce((a, b) => (a.total <= b.total ? a : b));
      G.players[w.seat].out = false;
    }
    G.winnerSeat = activeIdx()[0];
    G.phase = 'over';
    fx('sound', { name: G.players[G.winnerSeat].bot ? 'assaf' : 'win' });
  } else {
    G.phase = 'roundEnd';
  }
  sync();
}

/* ---------- בוטים ---------- */
async function botTurn(p) {
  await sleep(900 + rnd(500));
  if (G.over || G.players[G.turn] !== p || G.phase !== 'turn') return;
  const s = handSum(p.hand);
  if (s <= YANIV_MAX && botCallsYaniv(p, s)) { declareYaniv(G.turn); return; }

  const combo = bestThrow(p.hand);
  p.hand = p.hand.filter(c => !combo.ordered.includes(c));
  G.pending = { cards: combo.ordered, by: G.turn };
  fx('sound', { name: 'throw' });
  fx('toast', { msg: `${p.name} זרק ${describeCards(combo.ordered)}` });
  sync();
  await sleep(950);

  const pick = botDrawChoice(p, topThrow());
  let drawn, fromDeck = false;
  if (pick) {
    drawn = takeFromPile(pick);
    fx('toast', { msg: `${p.name} לקח את ה-${cardName(pick)} מהערימה` });
  } else {
    drawn = drawFromDeck();
    if (drawn) fromDeck = true;
    else { const e = throwEnds(topThrow()); if (e.length) drawn = takeFromPile(e[0]); }
    if (fromDeck) fx('toast', { msg: `${p.name} משך מהקופה` });
  }
  if (drawn) { p.hand.push(drawn); sortHand(p); }
  fx('sound', { name: 'draw' });
  sync();

  if (G.slap && fromDeck && drawn && canSlap(drawn, G.pending) && botSlaps()) {
    await sleep(500);
    p.hand.splice(p.hand.indexOf(drawn), 1);
    G.pending.cards.push(drawn);
    fx('sound', { name: 'slap' });
    fx('toast', { msg: `${p.name} הצמיד ${cardName(drawn)}! 🖐` });
    sync();
  }
  await sleep(450);
  commitTurn();
}

function botCallsYaniv(p, s) {
  if (s === 0) return true;
  const others = activeIdx().filter(i => G.players[i] !== p);
  if (G.diff === 'easy') return s <= 2 || Math.random() < 0.45;
  if (G.diff === 'med') return s <= 3 || Math.random() < 0.6;
  if (s <= 2) return true;
  let risk = 0;
  for (const i of others) {
    const n = G.players[i].hand.length;
    if (n <= 2) risk += 0.4; else if (n === 3) risk += 0.2; else risk += 0.05;
  }
  return Math.random() > Math.min(0.9, risk) * (s / YANIV_MAX);
}

function allCombos(hand) {
  const out = hand.map(c => [c]);
  const jks = hand.filter(c => c.j);
  const byR = new Map();
  for (const c of hand) if (!c.j) {
    if (!byR.has(c.r)) byR.set(c.r, []);
    byR.get(c.r).push(c);
  }
  for (const g of byR.values()) if (g.length >= 2) out.push([...g]);
  if (jks.length === 2) out.push([...jks]);
  for (let s = 0; s < 4; s++) {
    const inSuit = new Map(hand.filter(c => !c.j && c.s === s).map(c => [c.r, c]));
    if (!inSuit.size) continue;
    for (let start = 1; start <= 11; start++) {
      for (let len = 3; start + len - 1 <= 13; len++) {
        const combo = [];
        let missing = 0, real = 0;
        for (let r = start; r < start + len; r++) {
          const c = inSuit.get(r);
          if (c) { combo.push(c); real++; } else missing++;
        }
        if (real >= 1 && missing <= jks.length) out.push([...combo, ...jks.slice(0, missing)]);
      }
    }
  }
  return out;
}

function bestThrow(hand) {
  let best = null, bestScore = -Infinity;
  for (const combo of allCombos(hand)) {
    const v = validThrow(combo);
    if (!v) continue;
    const jn = combo.filter(c => c.j).length;
    const score = combo.reduce((a, c) => a + val(c), 0) - jn * 9 + combo.length * 0.2;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best || validThrow([hand[0]]);
}

function botDrawChoice(p, prev) {
  const opts = throwEnds(prev);
  let bestC = null, bestSc = 0.5;
  for (const c of opts) {
    let sc = 0;
    if (c.j) sc = 100;
    else {
      const v = val(c);
      if (p.hand.some(h => !h.j && h.r === c.r)) sc = Math.max(sc, 13 - v);
      if (p.hand.some(h => !h.j && h.s === c.s && Math.abs(h.r - c.r) <= 1)) sc = Math.max(sc, 11 - v);
      if (v <= 2) sc = Math.max(sc, 7 - v);
    }
    if (sc > bestSc) { bestSc = sc; bestC = c; }
  }
  if (G.diff === 'easy' && bestC && !bestC.j && Math.random() < 0.4) bestC = null;
  return bestC;
}
const botSlaps = () => G.diff === 'easy' ? Math.random() < 0.5 : true;

/* ============================================================
   VIEW — מה שכל שחקן רואה (נשלח גם ברשת)
   ============================================================ */
function buildView(seat) {
  const p = G.players[seat];
  const sum = handSum(p.hand);
  return {
    seat,
    round: G.round, target: G.target, deckCount: G.deck.length,
    turn: G.turn, phase: G.phase, over: G.over, turnNo: G.turnNo,
    players: G.players.map(x => ({
      name: x.name, avatar: x.avatar, score: x.score, out: x.out,
      bot: x.bot, n: x.hand.length, disc: !!x.disconnected,
    })),
    top: (topThrow() ? topThrow().cards : []).map(pub),
    pendingCards: G.pending ? G.pending.cards.map(pub) : null,
    ends: throwEnds(topThrow()).map(c => c.id),
    hand: p.hand.map(pub), sum,
    canYaniv: G.phase === 'turn' && G.turn === seat && sum <= YANIV_MAX,
    slap: (G.phase === 'slap' && G.slapFor === seat && G.slapCard) ? pub(G.slapCard) : null,
    results: (G.phase === 'roundEnd' || G.phase === 'over') ? G.results : null,
    winnerSeat: G.winnerSeat,
    fx: G.fx.slice(),
  };
}

function myLocalSeat() {
  if (GAMEMODE === 'hotseat') {
    if (!G.players.length) return 0;
    return G.players[G.turn] && !G.players[G.turn].out ? G.turn : (activeIdx()[0] ?? 0);
  }
  return 0; // בוטים / מארח אונליין
}

/* עדכון תצוגה + שידור לכל השחקנים המרוחקים */
function sync() {
  applyView(buildView(myLocalSeat()));
  if (NET.role === 'host') {
    for (let i = 0; i < G.players.length; i++) {
      const c = G.players[i].conn;
      if (c && c.open) { try { c.send({ t: 'state', v: buildView(i) }); } catch (e) {} }
    }
  }
}

/* ============================================================
   רשת — PeerJS (מארח סמכותי, אורחים שולחים פעולות)
   ============================================================ */
const NET = { role: null, peer: null, conn: null, code: null };
const LOBBY = { players: [], target: 100, slap: true, started: false };
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[rnd(CODE_CHARS.length)]).join('');
const peerId = code => 'yaniv-heb-' + code;

// שרת איתות משלנו (Render). כשה-host ריק — נופלים לענן הציבורי של PeerJS.
const PEER_SERVER = { host: '', port: 443, path: '/ps', secure: true };

function peerOpts() {
  const m = location.search.match(/[?&]ps=([^&]+)/); // עקיפה לבדיקות: ?ps=cloud או ?ps=host:port
  if (m) {
    const v = decodeURIComponent(m[1]);
    if (v === 'cloud') return { debug: 1 };
    const [h, po] = v.split(':');
    return { host: h, port: +po || 9000, path: '/ps', secure: false, debug: 1 };
  }
  if (PEER_SERVER.host) return { ...PEER_SERVER, debug: 1 };
  return { debug: 1 };
}

// Render (בתוכנית חינם) מרדים את השרת אחרי חוסר פעילות; ההתעוררות אורכת עד דקה.
// מעירים אותו מראש כשנכנסים למסך האונליין, וממתינים לו לפני יצירת Peer.
let peerWarm = false;
async function warmPeerServer(msgEl) {
  if (peerWarm || !PEER_SERVER.host || /[?&]ps=/.test(location.search)) return;
  const url = 'https://' + PEER_SERVER.host + PEER_SERVER.path;
  for (let i = 0; i < 15; i++) {
    try { await fetch(url, { mode: 'no-cors', cache: 'no-store' }); peerWarm = true; return; } catch (e) {}
    if (msgEl && i === 0) msgEl.textContent = 'מעיר את השרת… בפעם הראשונה זה יכול לקחת עד דקה';
    await new Promise(r => setTimeout(r, 5000));
  }
}

async function hostRoom() {
  cleanupNet();
  NET.role = 'host';
  NET.code = makeCode();
  $('#online-msg').textContent = 'יוצר חדר…';
  await warmPeerServer($('#online-msg'));
  $('#online-msg').textContent = 'יוצר חדר…';
  const peer = new Peer(peerId(NET.code), peerOpts());
  NET.peer = peer;
  peer.on('open', () => {
    LOBBY.players = [{ name: myName(), avatar: myAvatar(), bot: false, conn: null }];
    LOBBY.started = false;
    $('#online-msg').textContent = '';
    showLobby();
  });
  peer.on('connection', conn => setupHostConn(conn));
  peer.on('error', e => {
    if (e.type === 'unavailable-id') { hostRoom(); return; } // קוד תפוס — מגרילים חדש
    $('#online-msg').textContent = 'שגיאת חיבור: ' + (e.type || e.message || e);
    cleanupNet();
  });
}

function setupHostConn(conn) {
  conn.on('data', msg => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const name = String(msg.name || 'אורח').slice(0, 12) || 'אורח';
      const avatar = AVATARS.includes(msg.avatar) ? msg.avatar : '🤠';
      if (LOBBY.started || LOBBY.players.length >= 6) { try { conn.send({ t: 'reject', why: LOBBY.started ? 'המשחק כבר התחיל' : 'החדר מלא' }); conn.close(); } catch (e) {} return; }
      LOBBY.players.push({ name, avatar, bot: false, conn });
      conn._seatName = name;
      broadcastLobby();
    } else if (msg.t === 'act') {
      const seat = G.players.findIndex(p => p.conn === conn);
      if (seat >= 0) applyAction(seat, msg.a);
    }
  });
  conn.on('close', () => hostDropConn(conn));
  conn.on('error', () => hostDropConn(conn));
}

function hostDropConn(conn) {
  if (!LOBBY.started) {
    const i = LOBBY.players.findIndex(p => p.conn === conn);
    if (i > 0) { LOBBY.players.splice(i, 1); broadcastLobby(); }
    return;
  }
  const seat = G.players.findIndex(p => p.conn === conn);
  if (seat < 0) return;
  const p = G.players[seat];
  if (p.disconnected) return;
  p.disconnected = true;
  p.bot = true; // בוט ממשיך במקומו
  p.conn = null;
  fx('toast', { msg: `${p.name} התנתק — בוט ממשיך במקומו 🤖` });
  if (!G.over) {
    if (G.phase === 'slap' && G.slapFor === seat) applySlap(seat, false);
    else if (G.phase === 'turn' && G.turn === seat) botTurn(p).catch(console.error);
    else sync();
  }
}

function broadcastLobby() {
  renderLobby();
  LOBBY.players.forEach((p, i) => {
    if (p.conn && p.conn.open) {
      try {
        p.conn.send({
          t: 'lobby', code: NET.code, you: i,
          players: LOBBY.players.map(x => ({ name: x.name, avatar: x.avatar, bot: x.bot })),
        });
      } catch (e) {}
    }
  });
}

function startOnlineGame() {
  if (LOBBY.players.length < 2) { $('#lobby-msg').textContent = 'צריך לפחות שחקן אחד נוסף (או בוט)'; return; }
  LOBBY.started = true;
  GAMEMODE = 'online';
  const players = LOBBY.players.map(p => ({
    name: p.name, avatar: p.avatar, bot: p.bot, conn: p.conn || null,
    hand: [], score: 0, out: false, disconnected: false,
  }));
  startGame({ players, target: LOBBY.target, slap: LOBBY.slap, diff: 'hard' });
}

async function joinRoom(code) {
  cleanupNet();
  NET.role = 'client';
  NET.code = code;
  $('#online-msg').textContent = 'מתחבר לחדר ' + code + '…';
  await warmPeerServer($('#online-msg'));
  $('#online-msg').textContent = 'מתחבר לחדר ' + code + '…';
  const peer = new Peer(peerOpts());
  NET.peer = peer;
  let joined = false;
  peer.on('open', () => {
    const conn = peer.connect(peerId(code), { reliable: true });
    NET.conn = conn;
    conn.on('open', () => { conn.send({ t: 'hello', name: myName(), avatar: myAvatar() }); });
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'lobby') {
        joined = true;
        GAMEMODE = 'online';
        UI.lastFxSeq = 0; UI.lastRound = 0; UI.selected.clear();
        $('#online-msg').textContent = '';
        showLobby(msg);
      } else if (msg.t === 'state') {
        if ($('#scr-game').classList.contains('active') === false) showScreen('game');
        $('#tb-target').textContent = 'עד ' + msg.v.target;
        applyView(msg.v);
      } else if (msg.t === 'reject') {
        $('#online-msg').textContent = msg.why || 'אי אפשר להצטרף';
        cleanupNet();
      } else if (msg.t === 'end') {
        netLost('המארח סגר את החדר');
      }
    });
    conn.on('close', () => { if (joined) netLost('החיבור למארח נותק'); else $('#online-msg').textContent = 'חדר לא נמצא — בדקו את הקוד'; });
    conn.on('error', () => netLost('שגיאת חיבור'));
  });
  peer.on('error', e => {
    if (e.type === 'peer-unavailable') $('#online-msg').textContent = 'חדר ' + code + ' לא נמצא — בדקו את הקוד';
    else $('#online-msg').textContent = 'שגיאת רשת: ' + (e.type || '');
    cleanupNet();
  });
}

function netLost(why) {
  if (!NET.role) return;
  cleanupNet();
  $('#net-msg').textContent = why || '';
  $('#net-ovl').hidden = false;
}

function cleanupNet() {
  if (NET.role === 'host') {
    for (const p of LOBBY.players) if (p.conn && p.conn.open) { try { p.conn.send({ t: 'end' }); } catch (e) {} }
    for (const p of G.players || []) if (p.conn && p.conn.open) { try { p.conn.send({ t: 'end' }); } catch (e) {} }
  }
  try { NET.peer && NET.peer.destroy(); } catch (e) {}
  NET.role = null; NET.peer = null; NET.conn = null;
  LOBBY.players = []; LOBBY.started = false;
}

/* ---------- לובי ---------- */
function showLobby(clientMsg) {
  showScreen('lobby');
  if (NET.role === 'host') {
    $('#room-code').textContent = NET.code.split('').join(' ');
    $('#lobby-host-opts').hidden = false;
    $('#btn-start-online').hidden = false;
    $('#lobby-msg').textContent = 'שלחו לחברים את הקוד או את הקישור 👆';
    renderLobby();
  } else {
    $('#room-code').textContent = (clientMsg.code || NET.code).split('').join(' ');
    $('#lobby-host-opts').hidden = true;
    $('#btn-start-online').hidden = true;
    $('#lobby-msg').textContent = 'ממתינים למארח שיתחיל את המשחק…';
    renderLobbyList(clientMsg.players, clientMsg.you);
  }
}

function renderLobby() {
  renderLobbyList(LOBBY.players.map(p => ({ name: p.name, avatar: p.avatar, bot: p.bot })), 0);
}

function renderLobbyList(players, you) {
  const box = $('#lobby-players');
  box.innerHTML = '';
  players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'lobby-player';
    el.innerHTML = `
      <span class="lp-ava">${p.avatar}</span>
      <span class="lp-name">${escapeHtml(p.name)}${i === you ? ' (אני)' : ''}</span>
      ${i === 0 ? '<span class="lp-tag">מארח 👑</span>' : ''}
      ${p.bot ? '<span class="lp-tag">בוט 🤖</span>' : ''}`;
    if (NET.role === 'host' && i > 0) {
      const kick = document.createElement('button');
      kick.className = 'lp-kick';
      kick.textContent = '✕';
      kick.title = 'הסר';
      kick.addEventListener('click', () => {
        const pl = LOBBY.players[i];
        if (pl.conn) { try { pl.conn.send({ t: 'reject', why: 'הוסרת מהחדר' }); pl.conn.close(); } catch (e) {} }
        LOBBY.players.splice(i, 1);
        broadcastLobby();
      });
      el.appendChild(kick);
    }
    box.appendChild(el);
  });
}

/* ============================================================
   UI — תצוגה מונחית VIEW (זהה מקומית וברשת)
   ============================================================ */
const UI = { view: null, selected: new Set(), lastFxSeq: 0, lastRound: 0, curtainFor: '', slapTicker: null };

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('#scr-' + id).classList.add('active');
}

function applyView(v) {
  UI.view = v;
  for (const f of v.fx || []) {
    if (f.seq > UI.lastFxSeq) { UI.lastFxSeq = f.seq; runFx(f); }
  }
  const ids = new Set(v.hand.map(c => c.id));
  for (const id of [...UI.selected]) if (!ids.has(id)) UI.selected.delete(id);

  // וילון העברת מכשיר (באותו מכשיר בלבד)
  if (GAMEMODE === 'hotseat' && v.phase === 'turn' && !v.players[v.turn].bot && !v.players[v.turn].out) {
    const key = v.round + ':' + v.turnNo;
    if (UI.curtainFor !== key && countHumans(v) > 1) {
      UI.curtainFor = key;
      $('#curtain-avatar').textContent = v.players[v.turn].avatar;
      $('#curtain-title').textContent = 'התור של ' + v.players[v.turn].name;
      $('#curtain').hidden = false;
    }
  }

  const dealAnim = v.round !== UI.lastRound;
  UI.lastRound = v.round;
  $('#tb-round').textContent = 'סיבוב ' + v.round;
  renderGame(v, dealAnim);

  $('#round-end').hidden = v.phase !== 'roundEnd';
  if (v.phase === 'roundEnd') showRoundEnd(v);
  $('#game-over').hidden = v.phase !== 'over';
  if (v.phase === 'over') showGameOver(v);
}

const countHumans = v => v.players.filter(p => !p.bot && !p.out).length;

function runFx(f) {
  if (f.kind === 'toast') toast(f.msg);
  else if (f.kind === 'splash') { splash(f.text, f.red); if (f.red) vibrate([60, 40, 60]); else vibrate([30, 60, 30]); }
  else if (f.kind === 'sound' && snd[f.name]) snd[f.name]();
}

function cardHTML(c, mini = false) {
  const cls = ['card'];
  if (mini) cls.push('mini');
  if (c.j) cls.push('joker');
  else if (RED_SUIT(c.s)) cls.push('red');
  const inner = c.j
    ? `<div class="pip">★</div><div class="jlab">ג'וקר</div>`
    : `<div class="tl">${RNAME[c.r]}<br>${SUITS[c.s]}</div><div class="pip">${SUITS[c.s]}</div><div class="br">${RNAME[c.r]}<br>${SUITS[c.s]}</div>`;
  return `<div class="${cls.join(' ')}" data-id="${c.id}">${inner}</div>`;
}
function cardEl(c, mini = false) {
  const t = document.createElement('template');
  t.innerHTML = cardHTML(c, mini).trim();
  return t.content.firstChild;
}

function renderGame(v, dealAnim = false) {
  const myTurn = v.turn === v.seat && v.phase === 'turn' && !v.players[v.seat].bot;
  const curtainUp = !$('#curtain').hidden ||
    (GAMEMODE === 'hotseat' && v.phase === 'deal' && countHumans(v) > 1);

  /* יריבים */
  const opBox = $('#opponents');
  opBox.innerHTML = '';
  for (let k = 1; k < v.players.length; k++) {
    const i = (v.seat + k) % v.players.length;
    const p = v.players[i];
    const el = document.createElement('div');
    el.className = 'oppo' + (i === v.turn && !v.over ? ' active' : '') + (p.out ? ' out' : '');
    el.innerHTML = `
      <div class="oppo-ava">${p.avatar}</div>
      <div class="oppo-name">${escapeHtml(p.name)}${p.disc ? ' 🤖' : ''}</div>
      <div class="oppo-cards">${'<div class="mini-back"></div>'.repeat(Math.min(p.n, 8))}</div>
      <div class="oppo-score">${p.score}</div>`;
    opBox.appendChild(el);
  }

  /* קופה — לחיצה זורקת ומושכת */
  $('#deck-count').textContent = v.deckCount;
  $('#deck').classList.toggle('drawable', myTurn && !curtainUp);

  /* ערימה — קלפי הקצה לחיצים */
  const pileEl = $('#pile');
  pileEl.innerHTML = '';
  const addPileCard = (c, opts = {}) => {
    const el = cardEl(c);
    if (opts.fresh) el.classList.add('fresh');
    if (opts.sep) el.classList.add('sep');
    if (opts.under) el.classList.add('under');
    if (opts.drawable) {
      el.classList.add('drawable');
      el.addEventListener('click', () => submitMove(c.id));
    }
    pileEl.appendChild(el);
  };
  if (v.pendingCards) {
    for (const c of v.top) addPileCard(c, { under: true });
    v.pendingCards.forEach((c, i) => addPileCard(c, { fresh: true, sep: i === 0 && v.top.length > 0 }));
  } else {
    for (const c of v.top) addPileCard(c, { fresh: true, drawable: myTurn && !curtainUp && v.ends.includes(c.id) });
  }

  /* באנר תור */
  const cur = v.players[v.turn];
  $('#turn-banner').textContent =
    v.over ? '' :
    v.phase === 'reveal' ? 'חושפים קלפים…' :
    v.phase === 'slap' ? (v.slap ? 'הזדמנות להצמדה!' : 'ממתינים להצמדה…') :
    myTurn ? 'התור שלך!' :
    v.phase === 'turn' || v.phase === 'busy' ? `התור של ${cur.avatar} ${cur.name}…` : '';

  /* היד שלי */
  const meP = v.players[v.seat];
  $('#me-name').textContent = `${meP.avatar} ${meP.name}`;
  $('#me-name').classList.toggle('active', myTurn);
  const sumEl = $('#me-sum');
  sumEl.textContent = 'סכום: ' + v.sum;
  sumEl.classList.toggle('low', v.sum <= YANIV_MAX);

  const handEl = $('#hand');
  handEl.classList.remove('shake');
  handEl.innerHTML = '';
  v.hand.forEach((c, idx) => {
    const el = curtainUp ? Object.assign(document.createElement('div'), { className: 'card back' }) : cardEl(c);
    if (dealAnim && !curtainUp) { el.classList.add('dealt'); el.style.animationDelay = (idx * 60) + 'ms'; }
    if (UI.selected.has(c.id)) el.classList.add('sel');
    el.addEventListener('click', () => {
      if (!myTurn) return;
      if (UI.selected.has(c.id)) UI.selected.delete(c.id); else UI.selected.add(c.id);
      snd.select();
      renderGame(UI.view);
    });
    handEl.appendChild(el);
  });

  /* כפתור יניב קבוע + רמז + הצמדה */
  $('#btn-yaniv').disabled = !v.canYaniv;
  $('#btn-yaniv').textContent = v.canYaniv ? `יניב! (${v.sum})` : 'יניב!';
  const hint = $('#act-hint');
  const slapBtn = $('#btn-slap');
  if (v.slap) {
    slapBtn.hidden = false;
    hint.hidden = true;
    startSlapTicker(v.slap);
  } else {
    slapBtn.hidden = true;
    stopSlapTicker();
    hint.hidden = false;
    hint.textContent = !myTurn ? '' :
      UI.selected.size ? selHint(v) : 'בחר קלפים ולחץ על הקופה או על הערימה';
  }
}

function selHint(v) {
  const sel = v.hand.filter(c => UI.selected.has(c.id));
  const t = validThrow(sel);
  const sum = sel.reduce((a, c) => a + val(c), 0);
  if (!t) return '⚠️ לא חוקי: זוג/שלישייה או רצף בצורה';
  return `נבחרו ${sel.length === 1 ? 'קלף אחד' : sel.length + ' קלפים'} (${sum}) — לחץ על הקופה או על הערימה`;
}

function startSlapTicker(card) {
  stopSlapTicker();
  let left = 3;
  const btn = $('#btn-slap');
  btn.textContent = `🖐 הצמד את ה-${cardName(card)}! (${left})`;
  UI.slapTicker = setInterval(() => {
    left--;
    if (left <= 0) { stopSlapTicker(); return; }
    btn.textContent = `🖐 הצמד את ה-${cardName(card)}! (${left})`;
  }, 1000);
}
function stopSlapTicker() { clearInterval(UI.slapTicker); UI.slapTicker = null; }

/* שליחת מהלך: זרוק נבחרים + משוך מ-src ('deck' או id קלף) */
function submitMove(src) {
  const v = UI.view;
  if (!v || v.phase !== 'turn' || v.turn !== v.seat) return;
  if (!$('#curtain').hidden) return;
  const sel = v.hand.filter(c => UI.selected.has(c.id));
  if (!validThrow(sel)) {
    snd.bad(); vibrate(60);
    $('#hand').classList.add('shake');
    toast(sel.length ? '⚠️ הזריקה לא חוקית — זוג/שלישייה או רצף בצורה' : '⚠️ קודם בחרו קלפים לזריקה');
    return;
  }
  const ids = sel.map(c => c.id);
  UI.selected.clear();
  act({ k: 'move', ids, src });
}

/* פעולה: מקומית ישירות למנוע, ברשת — למארח */
function act(a) {
  if (NET.role === 'client') { try { NET.conn.send({ t: 'act', a }); } catch (e) {} }
  else applyAction(UI.view ? UI.view.seat : 0, a);
}

/* ---------- סוף סיבוב / משחק ---------- */
function showRoundEnd(v) {
  const box = $('#re-rows');
  box.innerHTML = '';
  $('#re-title').textContent = `סוף סיבוב ${v.round}`;
  for (const r of v.results) {
    const row = document.createElement('div');
    row.className = 're-row' + (r.badge === 'yaniv' || r.badge === 'assaf' ? ' winner' : '') + (r.out ? ' loser' : '');
    let badges = '';
    if (r.badge === 'yaniv') badges += '<span class="re-badge gold">יניב! 🏆</span>';
    if (r.badge === 'assaf') badges += '<span class="re-badge red">אסף!</span>';
    if (r.badge === 'caught') badges += '<span class="re-badge red">נתפס +30</span>';
    if (r.halved) badges += '<span class="re-badge green">חצי! 🎉</span>';
    if (r.out) badges += '<span class="re-badge gray">הודח</span>';
    row.innerHTML = `
      <div class="re-ava">${r.avatar}</div>
      <div class="re-main">
        <div class="re-name">${escapeHtml(r.name)} ${badges}</div>
        <div class="re-cards">${r.hand.map(c => cardHTML(c, true)).join('')}</div>
      </div>
      <div class="re-nums">
        <div class="re-delta ${r.add === 0 ? 'zero' : ''}">${r.add === 0 ? '+0' : '+' + r.add}</div>
        <div class="re-total">${r.total}<small>סה"כ</small></div>
      </div>`;
    box.appendChild(row);
  }
  const isHost = NET.role !== 'client';
  $('#re-next').hidden = !isHost;
  $('#re-wait').hidden = isHost;
}

function showGameOver(v) {
  const w = v.players[v.winnerSeat] || v.players[0];
  $('#go-avatar').textContent = w.avatar;
  $('#go-title').textContent = v.winnerSeat === v.seat ? 'ניצחת! 🏆🎉' : `${w.name} ניצח! 🏆`;
  const box = $('#go-table');
  box.innerHTML = '';
  [...v.players].map((p, i) => ({ p, i })).sort((a, b) => a.p.score - b.p.score).forEach(({ p, i }, rank) => {
    const row = document.createElement('div');
    row.className = 're-row' + (i === v.winnerSeat ? ' winner' : ' loser');
    row.innerHTML = `
      <div class="re-ava">${['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'][rank] || ''}</div>
      <div class="re-main"><div class="re-name">${p.avatar} ${escapeHtml(p.name)}</div></div>
      <div class="re-nums"><div class="re-total">${p.score}<small>נקודות</small></div></div>`;
    box.appendChild(row);
  });
  if (v.winnerSeat === v.seat) confetti();
}

/* ---------- אפקטים ---------- */
function toast(msg, ms = 2100) {
  const box = $('#toasts');
  while (box.children.length > 2) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 400); }, ms);
}

function splash(text, red) {
  const sp = $('#splash'), t = $('#splash-text');
  t.textContent = text;
  t.className = red ? 'red' : '';
  sp.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  setTimeout(() => { sp.hidden = true; }, 1400);
}

function confetti() {
  const box = $('#confetti');
  box.hidden = false;
  box.innerHTML = '';
  const emo = ['🎉', '🎊', '⭐', '🃏', '🏆', '✨'];
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('span');
    p.className = 'conf-p';
    p.textContent = emo[rnd(emo.length)];
    p.style.left = rnd(100) + 'vw';
    p.style.animationDuration = (2 + Math.random() * 2.4) + 's';
    p.style.animationDelay = (Math.random() * 1.2) + 's';
    box.appendChild(p);
  }
  setTimeout(() => { box.hidden = true; box.innerHTML = ''; }, 5200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
   מסך הבית, זהות והגדרות
   ============================================================ */
const setupCfg = { panel: 'bots', nOpp: 2, nHum: 2, diff: 'med', target: 100, slap: 1 };

const myName = () => ($('#inp-name').value.trim() || 'שחקן').slice(0, 12);
const myAvatar = () => $('#btn-avatar').textContent;
$('#inp-name').value = localStorage.getItem('yaniv-name') || '';
$('#btn-avatar').textContent = localStorage.getItem('yaniv-avatar') || '😎';
$('#inp-name').addEventListener('change', () => localStorage.setItem('yaniv-name', myName()));
$('#btn-avatar').addEventListener('click', () => {
  const cur = AVATARS.indexOf(myAvatar());
  const next = AVATARS[(cur + 1) % AVATARS.length];
  $('#btn-avatar').textContent = next;
  localStorage.setItem('yaniv-avatar', next);
  snd.select();
});

document.querySelectorAll('#home-menu .menu-btn[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    ac();
    const panel = btn.dataset.panel;
    setupCfg.panel = panel;
    $('#home-menu').hidden = true;
    if (panel === 'online') {
      $('#online-panel').hidden = false;
      $('#online-msg').textContent = '';
      warmPeerServer(null); // מעירים את שרת האיתות מראש, ברקע
    } else {
      $('#setup-panel').hidden = false;
      $('#setup-title').textContent = panel === 'bots' ? '🤖 משחק נגד בוטים' : '📱 באותו מכשיר';
      $('#row-opponents').hidden = panel !== 'bots';
      $('#row-diff').hidden = panel !== 'bots';
      $('#row-humans').hidden = panel !== 'hotseat';
    }
  });
});

document.querySelectorAll('.seg').forEach(seg => {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    const key = seg.dataset.key;
    const v = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
    setupCfg[key] = v;
    if (key === 'target') LOBBY.target = +v;
    if (key === 'slap') LOBBY.slap = !!+v;
    snd.select();
  });
});

document.querySelectorAll('.btn-back').forEach(b => b.addEventListener('click', () => {
  $('#setup-panel').hidden = true;
  $('#online-panel').hidden = true;
  $('#home-menu').hidden = false;
}));

$('#btn-start-local').addEventListener('click', () => {
  ac();
  GAMEMODE = setupCfg.panel;
  let players;
  if (GAMEMODE === 'bots') {
    players = [{ name: myName(), avatar: myAvatar(), bot: false, hand: [], score: 0, out: false }];
    shuffle([...BOT_POOL]).slice(0, setupCfg.nOpp).forEach(b =>
      players.push({ name: b.n, avatar: b.a, bot: true, hand: [], score: 0, out: false }));
  } else {
    players = [];
    for (let i = 0; i < setupCfg.nHum; i++)
      players.push({ name: 'שחקן ' + (i + 1), avatar: AVATARS[i % AVATARS.length], bot: false, hand: [], score: 0, out: false });
  }
  startGame({ players, target: setupCfg.target, slap: !!+setupCfg.slap, diff: setupCfg.diff });
});

/* אונליין */
$('#btn-host').addEventListener('click', () => { ac(); hostRoom(); });
$('#btn-join').addEventListener('click', () => {
  ac();
  const code = $('#inp-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('#online-msg').textContent = 'הקוד הוא 4 תווים'; return; }
  joinRoom(code);
});
$('#inp-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });

$('#btn-add-bot').addEventListener('click', () => {
  if (LOBBY.players.length >= 6) return;
  const used = LOBBY.players.map(p => p.name);
  const b = BOT_POOL.find(x => !used.includes(x.n)) || BOT_POOL[rnd(BOT_POOL.length)];
  LOBBY.players.push({ name: b.n, avatar: b.a, bot: true, conn: null });
  broadcastLobby();
});

$('#btn-start-online').addEventListener('click', () => startOnlineGame());

$('#btn-leave-lobby').addEventListener('click', () => {
  cleanupNet();
  goHome();
});

$('#btn-share').addEventListener('click', async () => {
  const code = (NET.code || '').toUpperCase();
  const url = location.origin + location.pathname + '?join=' + code;
  const text = `בואו לשחק יניב! 🎴 קוד חדר: ${code}\n${url}`;
  try {
    if (navigator.share) await navigator.share({ title: 'יניב!', text, url });
    else { await navigator.clipboard.writeText(text); toast('הקישור הועתק 📋'); }
  } catch (e) {}
});

/* וילון */
$('#curtain-go').addEventListener('click', () => {
  $('#curtain').hidden = true;
  if (UI.view) renderGame(UI.view, true);
});

/* פעולות משחק */
$('#deck').addEventListener('click', () => submitMove('deck'));
$('#btn-yaniv').addEventListener('click', () => { if (UI.view && UI.view.canYaniv) act({ k: 'yaniv' }); });
$('#btn-slap').addEventListener('click', () => act({ k: 'slap', take: true }));
$('#re-next').addEventListener('click', () => act({ k: 'next' }));

$('#go-again').addEventListener('click', () => {
  $('#game-over').hidden = true;
  if (NET.role) { cleanupNet(); }
  goHome();
});

$('#net-home').addEventListener('click', () => {
  $('#net-ovl').hidden = true;
  goHome();
});

function goHome() {
  G.over = true;
  clearTimeout(G.slapTimer);
  stopSlapTicker();
  GAMEMODE = null;
  UI.view = null; UI.selected.clear(); UI.curtainFor = ''; UI.lastRound = 0;
  ['curtain', 'round-end', 'game-over', 'scores-ovl', 'net-ovl'].forEach(id => $('#' + id).hidden = true);
  showScreen('home');
  $('#setup-panel').hidden = true;
  $('#online-panel').hidden = true;
  $('#home-menu').hidden = false;
}

/* סרגל עליון */
$('#btn-exit').addEventListener('click', () => {
  if (confirm('לצאת מהמשחק?' + (NET.role === 'host' ? ' החדר ייסגר לכולם.' : ''))) {
    cleanupNet();
    goHome();
  }
});
$('#btn-sound').addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem('yaniv-muted', muted ? '1' : '0');
  $('#btn-sound').textContent = muted ? '🔇' : '🔊';
});
$('#btn-sound').textContent = muted ? '🔇' : '🔊';

$('#btn-scores').addEventListener('click', () => {
  if (!UI.view) return;
  const box = $('#scores-rows');
  box.innerHTML = '';
  [...UI.view.players].sort((a, b) => a.score - b.score).forEach(p => {
    const row = document.createElement('div');
    row.className = 're-row' + (p.out ? ' loser' : '');
    row.innerHTML = `
      <div class="re-ava">${p.avatar}</div>
      <div class="re-main"><div class="re-name">${escapeHtml(p.name)} ${p.out ? '<span class="re-badge gray">הודח</span>' : ''}</div></div>
      <div class="re-nums"><div class="re-total">${p.score}<small>נקודות</small></div></div>`;
    box.appendChild(row);
  });
  $('#scores-ovl').hidden = false;
});
$('#scores-close').addEventListener('click', () => { $('#scores-ovl').hidden = true; });

$('#btn-sort').addEventListener('click', () => {
  if (!UI.view) return;
  if (NET.role === 'client') {
    UI.view.hand.sort((a, b) => (a.j ? 99 : a.r) - (b.j ? 99 : b.r) || a.s - b.s);
    renderGame(UI.view);
  } else {
    const p = G.players[UI.view.seat];
    if (p) { sortHand(p); sync(); }
  }
});

/* חוקים */
$('#btn-rules').addEventListener('click', () => { $('#rules-ovl').hidden = false; });
$('#rules-close').addEventListener('click', () => { $('#rules-ovl').hidden = true; });

/* הצטרפות מקישור ?join=CODE */
(function autoJoin() {
  const m = location.search.match(/[?&]join=([A-Za-z0-9]{4})/);
  if (m) {
    $('#home-menu').hidden = true;
    $('#online-panel').hidden = false;
    $('#inp-code').value = m[1].toUpperCase();
    $('#online-msg').textContent = 'לחצו "הצטרף" כדי להיכנס לחדר ' + m[1].toUpperCase();
  }
})();

/* מניעת זום כפול באייפון */
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
