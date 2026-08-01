/**
 * ofc-engine.js — Motor de reglas de Open Face Chinese Poker (variante Pineapple).
 *
 * Módulo puro y determinista: no conoce red, jugadores ni persistencia.
 * Node.js >= 18, ESM, sin dependencias externas.
 *
 * Notación de carta: 2 caracteres, rango + palo. Ej: "As", "Td", "2c".
 *   Rangos: 2 3 4 5 6 7 8 9 T J Q K A
 *   Palos:  c (tréboles) d (diamantes) h (corazones) s (picas)
 *
 * Tablero (board):
 *   { top: string[3], middle: string[5], bottom: string[5] }
 */

import { randomInt } from 'node:crypto';

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';

export const ROW_SIZE = Object.freeze({ top: 3, middle: 5, bottom: 5 });
export const ROWS = Object.freeze(['top', 'middle', 'bottom']);

/** Categorías de mano. El orden numérico es el orden de fuerza. */
export const HAND = Object.freeze({
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
});

const HAND_NAMES = [
  'carta alta', 'pareja', 'doble pareja', 'trío', 'escalera',
  'color', 'full', 'póker', 'escalera de color',
];

/** Error de dominio: permite distinguir fallo de reglas de un bug genérico. */
export class OfcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OfcError';
    this.code = code;
  }
}

/* ─────────────────────────── Cartas y mazo ─────────────────────────── */

/** @returns {{code:string, rank:number, suit:string}} */
export function parseCard(code) {
  if (typeof code !== 'string' || code.length !== 2) {
    throw new OfcError('INVALID_CARD', `Carta inválida: ${JSON.stringify(code)}`);
  }
  const rank = RANK_CHARS.indexOf(code[0]) + 2;
  const suit = code[1];
  if (rank < 2 || !SUIT_CHARS.includes(suit)) {
    throw new OfcError('INVALID_CARD', `Carta inválida: ${code}`);
  }
  return { code, rank, suit };
}

export function createDeck() {
  const deck = [];
  for (const r of RANK_CHARS) for (const s of SUIT_CHARS) deck.push(r + s);
  return deck;
}

/**
 * Fisher-Yates. Por defecto usa crypto.randomInt (CSPRNG): en un juego con
 * ranking, un Math.random predecible es un vector de trampas real.
 * `rng(n)` permite inyectar un generador determinista en los tests.
 */
export function shuffle(deck, rng = randomInt) {
  if (!Array.isArray(deck)) throw new OfcError('INVALID_DECK', 'El mazo debe ser un array');
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Reparte `n` cartas del mazo (mutando su cola). */
export function draw(deck, n) {
  if (!Array.isArray(deck)) throw new OfcError('INVALID_DECK', 'El mazo debe ser un array');
  if (!Number.isInteger(n) || n < 1) throw new OfcError('INVALID_DRAW', `n inválido: ${n}`);
  if (deck.length < n) {
    throw new OfcError('DECK_EXHAUSTED', `Mazo agotado: quedan ${deck.length}, se piden ${n}`);
  }
  return deck.splice(0, n);
}

/* ───────────────────────── Evaluación de manos ───────────────────────── */

/**
 * Clave comparable: [categoría, t1..t5]. Longitud fija 6 para que una mano de
 * 3 cartas (fila superior) sea comparable contra una de 5 sin casos especiales:
 * los desempates que no existen valen 0, es decir, pierden el desempate.
 */
function key(category, tiebreakers) {
  const k = [category, 0, 0, 0, 0, 0];
  for (let i = 0; i < tiebreakers.length && i < 5; i++) k[i + 1] = tiebreakers[i];
  return k;
}

function groupByRank(ranks) {
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Orden: primero por frecuencia, luego por rango. Da los desempates ya listos.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
}

function straightHigh(ranks) {
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  if (uniq.length !== 5) return null;
  if (uniq[0] - uniq[4] === 4) return uniq[0];
  // Rueda A-2-3-4-5: el as cuenta como 1 y la escalera es al 5.
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) return 5;
  return null;
}

/** Evalúa 5 cartas (filas media e inferior). */
export function evaluate5(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new OfcError('INVALID_HAND', `Se esperaban 5 cartas, llegaron ${cards?.length}`);
  }
  const parsed = cards.map(parseCard);
  const ranks = parsed.map((c) => c.rank);
  const isFlush = parsed.every((c) => c.suit === parsed[0].suit);
  const sHigh = straightHigh(ranks);
  const groups = groupByRank(ranks);
  const [r0, n0] = groups[0];
  const n1 = groups[1]?.[1] ?? 0;

  let category, tiebreakers;
  if (isFlush && sHigh !== null) {
    category = HAND.STRAIGHT_FLUSH; tiebreakers = [sHigh];
  } else if (n0 === 4) {
    category = HAND.QUADS; tiebreakers = [r0, groups[1][0]];
  } else if (n0 === 3 && n1 === 2) {
    category = HAND.FULL_HOUSE; tiebreakers = [r0, groups[1][0]];
  } else if (isFlush) {
    category = HAND.FLUSH; tiebreakers = [...ranks].sort((a, b) => b - a);
  } else if (sHigh !== null) {
    category = HAND.STRAIGHT; tiebreakers = [sHigh];
  } else if (n0 === 3) {
    category = HAND.TRIPS; tiebreakers = [r0, groups[1][0], groups[2][0]];
  } else if (n0 === 2 && n1 === 2) {
    category = HAND.TWO_PAIR; tiebreakers = [r0, groups[1][0], groups[2][0]];
  } else if (n0 === 2) {
    category = HAND.PAIR; tiebreakers = [r0, groups[1][0], groups[2][0], groups[3][0]];
  } else {
    category = HAND.HIGH_CARD; tiebreakers = [...ranks].sort((a, b) => b - a);
  }

  return {
    category,
    name: HAND_NAMES[category],
    isRoyal: category === HAND.STRAIGHT_FLUSH && tiebreakers[0] === 14,
    key: key(category, tiebreakers),
  };
}

/** Evalúa 3 cartas (fila superior): sin escaleras ni colores. */
export function evaluate3(cards) {
  if (!Array.isArray(cards) || cards.length !== 3) {
    throw new OfcError('INVALID_HAND', `Se esperaban 3 cartas, llegaron ${cards?.length}`);
  }
  const ranks = cards.map(parseCard).map((c) => c.rank);
  const groups = groupByRank(ranks);
  const [r0, n0] = groups[0];

  let category, tiebreakers;
  if (n0 === 3) { category = HAND.TRIPS; tiebreakers = [r0]; }
  else if (n0 === 2) { category = HAND.PAIR; tiebreakers = [r0, groups[1][0]]; }
  else { category = HAND.HIGH_CARD; tiebreakers = [...ranks].sort((a, b) => b - a); }

  return {
    category,
    name: HAND_NAMES[category],
    isRoyal: false,
    key: key(category, tiebreakers),
  };
}

/** @returns 1 si a gana, -1 si b gana, 0 si empatan. */
export function compareHands(a, b) {
  for (let i = 0; i < 6; i++) {
    if (a.key[i] !== b.key[i]) return a.key[i] > b.key[i] ? 1 : -1;
  }
  return 0;
}

/* ──────────────────────── Tablero, foul, royalties ──────────────────────── */

function assertNoDuplicates(cards) {
  const seen = new Set();
  for (const c of cards) {
    parseCard(c);
    if (seen.has(c)) throw new OfcError('DUPLICATE_CARD', `Carta duplicada: ${c}`);
    seen.add(c);
  }
}

export function createEmptyBoard() {
  return { top: [], middle: [], bottom: [] };
}

export function isBoardComplete(board) {
  return ROWS.every((row) => (board?.[row]?.length ?? 0) === ROW_SIZE[row]);
}

/** Cartas libres por fila. Útil para validar colocaciones parciales. */
export function freeSlots(board) {
  return {
    top: ROW_SIZE.top - (board.top?.length ?? 0),
    middle: ROW_SIZE.middle - (board.middle?.length ?? 0),
    bottom: ROW_SIZE.bottom - (board.bottom?.length ?? 0),
  };
}

/**
 * Aplica colocaciones a un tablero devolviendo uno nuevo (no muta la entrada).
 * @param {object} board
 * @param {Array<{card:string,row:'top'|'middle'|'bottom'}>} placements
 */
export function placeCards(board, placements) {
  if (!Array.isArray(placements)) {
    throw new OfcError('INVALID_PLACEMENT', 'placements debe ser un array');
  }
  const next = { top: [...board.top], middle: [...board.middle], bottom: [...board.bottom] };
  for (const p of placements) {
    if (!p || !ROWS.includes(p.row)) {
      throw new OfcError('INVALID_ROW', `Fila inválida: ${p?.row}`);
    }
    parseCard(p.card);
    if (next[p.row].length >= ROW_SIZE[p.row]) {
      throw new OfcError('ROW_FULL', `La fila ${p.row} ya está completa`);
    }
    next[p.row].push(p.card);
  }
  assertNoDuplicates([...next.top, ...next.middle, ...next.bottom]);
  return next;
}

/**
 * Evalúa un tablero completo.
 * Foul = la mano no respeta superior <= media <= inferior.
 * @returns {{top:object, middle:object, bottom:object, foul:boolean}}
 */
export function evaluateBoard(board) {
  if (!isBoardComplete(board)) {
    throw new OfcError('BOARD_INCOMPLETE', 'El tablero no está completo (3/5/5)');
  }
  assertNoDuplicates([...board.top, ...board.middle, ...board.bottom]);
  const top = evaluate3(board.top);
  const middle = evaluate5(board.middle);
  const bottom = evaluate5(board.bottom);
  const foul = compareHands(top, middle) > 0 || compareHands(middle, bottom) > 0;
  return { top, middle, bottom, foul };
}

function topRoyalty(ev) {
  if (ev.category === HAND.TRIPS) return ev.key[1] + 8;      // 222 = 10 ... AAA = 22
  if (ev.category === HAND.PAIR && ev.key[1] >= 6) return ev.key[1] - 5; // 66 = 1 ... AA = 9
  return 0;
}

function middleRoyalty(ev) {
  switch (ev.category) {
    case HAND.TRIPS: return 2;
    case HAND.STRAIGHT: return 4;
    case HAND.FLUSH: return 8;
    case HAND.FULL_HOUSE: return 12;
    case HAND.QUADS: return 20;
    case HAND.STRAIGHT_FLUSH: return ev.isRoyal ? 50 : 30;
    default: return 0;
  }
}

function bottomRoyalty(ev) {
  switch (ev.category) {
    case HAND.STRAIGHT: return 2;
    case HAND.FLUSH: return 4;
    case HAND.FULL_HOUSE: return 6;
    case HAND.QUADS: return 10;
    case HAND.STRAIGHT_FLUSH: return ev.isRoyal ? 25 : 15;
    default: return 0;
  }
}

/** Royalties estándar OFC. Una mano en foul no cobra ninguno. */
export function boardRoyalties(evaluated) {
  if (evaluated.foul) return { top: 0, middle: 0, bottom: 0, total: 0 };
  const top = topRoyalty(evaluated.top);
  const middle = middleRoyalty(evaluated.middle);
  const bottom = bottomRoyalty(evaluated.bottom);
  return { top, middle, bottom, total: top + middle + bottom };
}

/* ─────────────────────────── Fantasyland ─────────────────────────── */

/** Entrada clásica: QQ o mejor en la fila superior, sin foul. */
export function qualifiesForFantasyland(evaluated) {
  if (evaluated.foul) return false;
  const t = evaluated.top;
  return t.category === HAND.TRIPS || (t.category === HAND.PAIR && t.key[1] >= 12);
}

/** Permanencia: trío arriba, full o mejor en el medio, o póker o mejor abajo. */
export function staysInFantasyland(evaluated) {
  if (evaluated.foul) return false;
  return evaluated.top.category === HAND.TRIPS
    || evaluated.middle.category >= HAND.FULL_HOUSE
    || evaluated.bottom.category >= HAND.QUADS;
}

/* ─────────────────────────── Puntuación 1-6 ─────────────────────────── */

/**
 * Enfrenta dos tableros ya evaluados. Método 1-6: ±1 por fila y +3 extra
 * al que gana las tres (scoop). Los royalties se liquidan por diferencia.
 * Quien está en foul paga 6 más los royalties del rival y no cobra los suyos.
 * @returns {{a:number, b:number, rows:number[], scoop:('a'|'b'|null), royalties:{a:number,b:number}}}
 */
export function scorePair(evalA, evalB) {
  const royA = boardRoyalties(evalA).total;
  const royB = boardRoyalties(evalB).total;

  if (evalA.foul && evalB.foul) {
    return { a: 0, b: 0, rows: [0, 0, 0], scoop: null, royalties: { a: 0, b: 0 } };
  }
  if (evalA.foul || evalB.foul) {
    const loserIsA = evalA.foul;
    const penalty = 6 + (loserIsA ? royB : royA);
    return {
      a: loserIsA ? -penalty : penalty,
      b: loserIsA ? penalty : -penalty,
      rows: loserIsA ? [-1, -1, -1] : [1, 1, 1],
      scoop: loserIsA ? 'b' : 'a',
      royalties: { a: loserIsA ? 0 : royA, b: loserIsA ? royB : 0 },
    };
  }

  const rows = ROWS.map((row) => compareHands(evalA[row], evalB[row]));
  const lineScore = rows.reduce((sum, r) => sum + r, 0);
  const wonAll = rows.every((r) => r > 0);
  const lostAll = rows.every((r) => r < 0);
  const scoopBonus = wonAll ? 3 : lostAll ? -3 : 0;
  const net = lineScore + scoopBonus + (royA - royB);

  return {
    a: net,
    b: -net,
    rows,
    scoop: wonAll ? 'a' : lostAll ? 'b' : null,
    royalties: { a: royA, b: royB },
  };
}

/**
 * Liquida una mesa de 2 o 3 jugadores. Cada jugador se enfrenta a todos los
 * demás y su resultado es la suma de los enfrentamientos (suma cero global).
 * @param {object[]} boards tableros completos, en orden de asiento
 * @returns {{scores:number[], evaluations:object[], royalties:number[], pairwise:object[]}}
 */
export function scoreTable(boards) {
  if (!Array.isArray(boards) || boards.length < 2 || boards.length > 3) {
    throw new OfcError('INVALID_TABLE', 'La mesa admite 2 o 3 jugadores');
  }
  const evaluations = boards.map(evaluateBoard);
  const all = boards.flatMap((b) => [...b.top, ...b.middle, ...b.bottom]);
  assertNoDuplicates(all); // un solo mazo: nadie puede repetir carta con otro

  const scores = new Array(boards.length).fill(0);
  const pairwise = [];
  for (let i = 0; i < evaluations.length; i++) {
    for (let j = i + 1; j < evaluations.length; j++) {
      const result = scorePair(evaluations[i], evaluations[j]);
      scores[i] += result.a;
      scores[j] += result.b;
      pairwise.push({ i, j, ...result });
    }
  }

  return {
    scores,
    evaluations,
    royalties: evaluations.map((e) => boardRoyalties(e).total),
    pairwise,
  };
}

/* ─────────────────── Estructura de reparto Pineapple ─────────────────── */

/** Cartas repartidas en cada calle: 5 iniciales y 4 rondas de 3 (coloca 2, descarta 1). */
export const PINEAPPLE_STREETS = Object.freeze([
  { street: 0, deal: 5, place: 5, discard: 0 },
  { street: 1, deal: 3, place: 2, discard: 1 },
  { street: 2, deal: 3, place: 2, discard: 1 },
  { street: 3, deal: 3, place: 2, discard: 1 },
  { street: 4, deal: 3, place: 2, discard: 1 },
]);

/** Fantasyland clásico: 14 cartas de golpe, se colocan 13 y se descarta 1. */
export const FANTASYLAND_DEAL = Object.freeze({ deal: 14, place: 13, discard: 1 });

/** Cartas necesarias para una mano completa según nº de jugadores en Fantasyland. */
export function cardsNeeded(playerCount, fantasylandCount = 0) {
  const normal = playerCount - fantasylandCount;
  return normal * 13 + normal * 4 + fantasylandCount * 14; // 13 colocadas + 4 descartes
}
