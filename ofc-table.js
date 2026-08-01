/**
 * ofc-table.js — Máquina de estados de una mesa de OFC Pineapple.
 *
 * Servidor autoritativo: el cliente nunca decide qué cartas recibe ni si una
 * jugada es legal. Este módulo no conoce sockets ni base de datos; todo el
 * tiempo entra por parámetro (`now` en ms epoch), lo que lo hace determinista
 * y testeable sin relojes reales ni timers.
 *
 * Node.js >= 18, ESM. Depende sólo de ./ofc-engine.js
 */

import { randomInt } from 'node:crypto';
import {
  OfcError, ROWS, ROW_SIZE, PINEAPPLE_STREETS, FANTASYLAND_DEAL,
  createDeck, shuffle, draw, parseCard, createEmptyBoard, isBoardComplete,
  freeSlots, placeCards, evaluateBoard, boardRoyalties, scorePair,
  qualifiesForFantasyland, staysInFantasyland,
} from './ofc-engine.js';

export const PHASE = Object.freeze({
  WAITING: 'waiting',
  PLACING: 'placing',
  SHOWDOWN: 'showdown',
});

/* ─────────────────────────── Auto-jugada ─────────────────────────── */

/** Completa un tablero de forma codiciosa: cartas altas abajo, bajas arriba. */
function greedyComplete(board, cards) {
  const sorted = [...cards].sort((a, b) => parseCard(b).rank - parseCard(a).rank);
  const next = { top: [...board.top], middle: [...board.middle], bottom: [...board.bottom] };
  let i = 0;
  for (const row of ['bottom', 'middle', 'top']) {
    while (next[row].length < ROW_SIZE[row] && i < sorted.length) next[row].push(sorted[i++]);
  }
  return next;
}

function sample(pool, n, rng) {
  const copy = pool.slice();
  for (let i = 0; i < n; i++) {
    const j = i + rng(copy.length - i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * Puntúa una colocación candidata. Con el tablero incompleto una heurística
 * estática resulta demasiado pobre (medido: 62% de manos sucias), así que se
 * estima la probabilidad de foul con rollouts Monte Carlo sobre las no vistas.
 */
function candidateScore(board, unseen, rng, rollouts) {
  if (isBoardComplete(board)) {
    const ev = evaluateBoard(board);
    // Penalización finita, no -Infinity: si todas las opciones ensucian la mano
    // hay que elegir igualmente una en vez de quedarse sin candidato.
    if (ev.foul) return -1e9;
    return 1e6 + boardRoyalties(ev).total;
  }

  const placed = ROWS.reduce((n, row) => n + board[row].length, 0);
  const needed = 13 - placed;
  const weight = { top: 1, middle: 2, bottom: 3 };
  let shape = 0;
  for (const row of ROWS) {
    for (const card of board[row]) shape += parseCard(card).rank * weight[row];
  }

  if (!unseen || unseen.length < needed || rollouts <= 0) return shape;

  let clean = 0;
  let royalties = 0;
  for (let i = 0; i < rollouts; i++) {
    const finished = greedyComplete(board, sample(unseen, needed, rng));
    const ev = evaluateBoard(finished);
    if (!ev.foul) { clean++; royalties += boardRoyalties(ev).total; }
  }
  const cleanRate = clean / rollouts;
  return cleanRate * 100_000 + (clean ? royalties / clean : 0) * 10 + shape * 0.01;
}

function enumerateAssignments(board, cards) {
  const results = [];
  const slots = freeSlots(board);
  const walk = (index, acc) => {
    if (index === cards.length) { results.push(acc.slice()); return; }
    for (const row of ROWS) {
      if (slots[row] === 0) continue;
      slots[row]--;
      acc.push({ card: cards[index], row });
      walk(index + 1, acc);
      acc.pop();
      slots[row]++;
    }
  };
  walk(0, []);
  return results;
}

function randomAssignment(board, cards, rng) {
  const pool = cards.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const slots = freeSlots(board);
  const placements = [];
  let k = 0;
  for (const row of ROWS) {
    for (let n = 0; n < slots[row]; n++) placements.push({ card: pool[k++], row });
  }
  return placements;
}

/**
 * Coloca automáticamente cuando expira el temporizador. No pretende jugar bien:
 * pretende no ensuciar la mano (foul) y mantener la partida en movimiento.
 *
 * @param {object} board tablero actual
 * @param {string[]} hand cartas en mano
 * @param {number} placeCount cuántas hay que colocar
 * @param {(n:number)=>number} rng
 * @param {{unseen?:string[], rollouts?:number, samples?:number}} [options]
 *   unseen: cartas que el jugador no puede ver, para estimar el riesgo de foul
 * @returns {{placements:Array<{card:string,row:string}>, discards:string[]}}
 */
export function autoPlace(board, hand, placeCount, rng = randomInt, options = {}) {
  if (placeCount > hand.length) {
    throw new OfcError('INVALID_AUTOPLAY', `No hay ${placeCount} cartas que colocar`);
  }
  const { unseen = null, rollouts = unseen ? 24 : 0, samples = 400 } = options;
  const discardCount = hand.length - placeCount;

  // Qué cartas se descartan: con una sola descartada se prueban todas las
  // opciones; en Fantasyland (13 de 14) se descarta directamente la más baja.
  let combos;
  if (placeCount <= 5 && discardCount <= 1) {
    combos = discardCount === 0
      ? [{ toPlace: hand.slice(), discards: [] }]
      : hand.map((card, i) => ({ toPlace: hand.filter((_, j) => j !== i), discards: [card] }));
  } else {
    const sorted = [...hand].sort((a, b) => parseCard(b).rank - parseCard(a).rank);
    combos = [{ toPlace: sorted.slice(0, placeCount), discards: sorted.slice(placeCount) }];
  }

  let best = null;
  let bestScore = -Infinity;
  for (const combo of combos) {
    const candidates = placeCount <= 5
      ? enumerateAssignments(board, combo.toPlace)
      // 13 cartas de Fantasyland: el espacio exhaustivo es inviable, se muestrea.
      : [randomAssignment(board, combo.toPlace, () => 0),
        ...Array.from({ length: samples }, () => randomAssignment(board, combo.toPlace, rng))];

    for (const placements of candidates) {
      let score;
      try {
        score = candidateScore(placeCards(board, placements), unseen, rng, rollouts);
      } catch {
        continue; // combinación inválida (fila llena): se ignora
      }
      if (score > bestScore) {
        bestScore = score;
        best = { placements, discards: combo.discards };
      }
    }
  }
  if (!best) throw new OfcError('INVALID_AUTOPLAY', 'No hay colocación válida posible');
  return best;
}

/* ─────────────────────────── Mesa ─────────────────────────── */

export class Table {
  /**
   * @param {object} config
   * @param {string} config.id
   * @param {Array<{id:string,name:string,fantasyland?:boolean}>} config.players 2 o 3
   * @param {number} [config.turnMs=30000] tiempo por colocación
   * @param {number} [config.fantasylandMs=90000] tiempo para colocar las 13 de Fantasyland
   * @param {number} [config.graceMs=60000] margen de reconexión antes de abandono
   * @param {string[]} [config.deck] mazo fijo (tests); si falta se baraja uno nuevo
   * @param {(n:number)=>number} [config.rng]
   */
  constructor({ id, players, turnMs = 30_000, fantasylandMs = 90_000, graceMs = 60_000, deck, rng = randomInt }) {
    if (!Array.isArray(players) || players.length < 2 || players.length > 3) {
      throw new OfcError('INVALID_TABLE', 'La mesa admite 2 o 3 jugadores');
    }
    const ids = new Set(players.map((p) => p.id));
    if (ids.size !== players.length) {
      throw new OfcError('INVALID_TABLE', 'Hay identificadores de jugador repetidos');
    }
    this.id = id;
    this.turnMs = turnMs;
    this.fantasylandMs = fantasylandMs;
    this.graceMs = graceMs;
    this.rng = rng;
    this._fixedDeck = deck ?? null;

    this.players = players.map((p, seat) => ({
      id: p.id,
      name: p.name,
      seat,
      board: createEmptyBoard(),
      hand: [],
      discards: [],
      fantasyland: !!p.fantasyland,
      nextFantasyland: false,
      connected: true,
      disconnectedAt: null,
      forfeited: false,
      score: 0,
    }));

    this.handNumber = 0;
    this.phase = PHASE.WAITING;
    this.street = 0;
    this.turnIndex = 0;
    this.activePlayerId = null;
    this.deadline = null;
    this.result = null;
    this.version = 0;
    this.pausedAt = null;
    this.deck = [];
  }

  /* ── pausa y serialización ── */

  /** Congela la mesa: sin nadie conectado, dejar correr el reloj sólo produciría
   *  auto-jugadas y abandonos que nadie ha visto. */
  pause(now) {
    if (this.pausedAt !== null) return [];
    this.pausedAt = now;
    this.version++;
    return [{ type: 'paused' }];
  }

  /** Reanuda desplazando todos los plazos lo que duró la pausa. */
  resume(now) {
    if (this.pausedAt === null) return [];
    const skew = now - this.pausedAt;
    this.pausedAt = null;
    if (this.deadline !== null) this.deadline += skew;
    for (const p of this.players) {
      if (p.deadline) p.deadline += skew;
      if (p.disconnectedAt !== null) p.disconnectedAt += skew;
    }
    this.version++;
    return [{ type: 'resumed', skew }];
  }

  /** Nadie conectado: la mesa puede congelarse. */
  isIdle() {
    return this.players.every((p) => !p.connected);
  }

  /** Instantánea completa. `savedAt` permite recuperar la duración de la caída. */
  toJSON(now = Date.now()) {
    return {
      v: 1,
      savedAt: now,
      id: this.id,
      turnMs: this.turnMs,
      fantasylandMs: this.fantasylandMs,
      paused: this.pausedAt !== null,
      graceMs: this.graceMs,
      handNumber: this.handNumber,
      phase: this.phase,
      street: this.street,
      turnIndex: this.turnIndex,
      activePlayerId: this.activePlayerId,
      deadline: this.deadline,
      version: this.version,
      pausedAt: this.pausedAt,
      result: this.result,
      deck: this.deck,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        board: p.board,
        hand: p.hand,
        discards: p.discards,
        fantasyland: p.fantasyland,
        nextFantasyland: p.nextFantasyland,
        connected: p.connected,
        disconnectedAt: p.disconnectedAt,
        forfeited: p.forfeited,
        score: p.score,
        deadline: p.deadline ?? null,
      })),
    };
  }

  /**
   * Rehidrata una mesa. El generador aleatorio no se serializa: se reconstruye
   * con el CSPRNG por defecto, lo que sólo afecta a la auto-jugada, nunca al
   * mazo, que viaja completo en la instantánea.
   */
  static fromJSON(snapshot) {
    if (snapshot?.v !== 1) {
      throw new OfcError('BAD_SNAPSHOT', `Versión de instantánea no soportada: ${snapshot?.v}`);
    }
    const table = new Table({
      id: snapshot.id,
      players: snapshot.players.map((p) => ({ id: p.id, name: p.name, fantasyland: p.fantasyland })),
      turnMs: snapshot.turnMs,
      fantasylandMs: snapshot.fantasylandMs,
      graceMs: snapshot.graceMs,
    });

    Object.assign(table, {
      handNumber: snapshot.handNumber,
      phase: snapshot.phase,
      street: snapshot.street,
      turnIndex: snapshot.turnIndex,
      activePlayerId: snapshot.activePlayerId,
      deadline: snapshot.deadline,
      version: snapshot.version,
      result: snapshot.result,
      deck: snapshot.deck.slice(),
      // Tras un reinicio no hay sockets: la mesa queda congelada desde el
      // instante del guardado, y al reanudar se desplazan los plazos.
      pausedAt: snapshot.pausedAt ?? snapshot.savedAt,
    });

    table.players.forEach((player, i) => {
      const saved = snapshot.players[i];
      Object.assign(player, {
        board: {
          top: saved.board.top.slice(),
          middle: saved.board.middle.slice(),
          bottom: saved.board.bottom.slice(),
        },
        hand: saved.hand.slice(),
        discards: saved.discards.slice(),
        nextFantasyland: saved.nextFantasyland,
        connected: false,
        disconnectedAt: saved.disconnectedAt ?? snapshot.savedAt,
        forfeited: saved.forfeited,
        score: saved.score,
        deadline: saved.deadline,
      });
    });

    return table;
  }

  /* ── ciclo de vida ── */

  /** Reparte y arranca una mano. Devuelve los eventos generados. */
  startHand(now) {
    if (this.phase === PHASE.PLACING) {
      throw new OfcError('HAND_IN_PROGRESS', 'Ya hay una mano en curso');
    }
    this.handNumber++;
    this.deck = this._fixedDeck ? this._fixedDeck.slice() : shuffle(createDeck(), this.rng);
    this.street = 0;
    this.turnIndex = 0;
    this.result = null;
    this.phase = PHASE.PLACING;

    for (const p of this.players) {
      p.board = createEmptyBoard();
      p.hand = [];
      p.discards = [];
      p.forfeited = false;
      p.deadline = null;
    }
    // Los jugadores en Fantasyland reciben las 14 cartas de golpe y juegan en
    // paralelo: no participan en el turno rotatorio.
    for (const p of this.players.filter((x) => x.fantasyland)) {
      p.hand = draw(this.deck, FANTASYLAND_DEAL.deal);
      p.deadline = now + this.fantasylandMs;
    }

    const events = [{ type: 'hand_started', handNumber: this.handNumber }];
    this._beginTurn(now, events);
    this.version++;
    return events;
  }

  /** Prepara la siguiente mano arrastrando quién entra en Fantasyland. */
  nextHand(now) {
    if (this.phase !== PHASE.SHOWDOWN) {
      throw new OfcError('NOT_IN_SHOWDOWN', 'La mano anterior no ha terminado');
    }
    for (const p of this.players) {
      p.fantasyland = p.nextFantasyland;
      p.nextFantasyland = false;
    }
    return this.startHand(now);
  }

  /* ── acciones de jugador ── */

  /**
   * Registra una colocación. Valida propiedad de las cartas, cupo de filas y
   * número exacto de cartas colocadas y descartadas según la calle.
   * @param {string} playerId
   * @param {{placements:Array<{card:string,row:string}>, discards:string[]}} action
   */
  place(playerId, action, now) {
    if (this.phase !== PHASE.PLACING) {
      throw new OfcError('WRONG_PHASE', 'No se admiten jugadas en este momento');
    }
    const player = this._player(playerId);
    if (player.forfeited) throw new OfcError('FORFEITED', 'El jugador ha abandonado la mano');

    const placements = action?.placements ?? [];
    const discards = action?.discards ?? [];
    const expected = player.fantasyland
      ? { place: FANTASYLAND_DEAL.place, discard: FANTASYLAND_DEAL.discard }
      : PINEAPPLE_STREETS[this.street];

    if (!player.fantasyland && this.activePlayerId !== playerId) {
      throw new OfcError('NOT_YOUR_TURN', 'No es tu turno');
    }
    if (player.hand.length === 0) {
      throw new OfcError('NO_CARDS', 'No tienes cartas pendientes de colocar');
    }
    if (placements.length !== expected.place || discards.length !== expected.discard) {
      throw new OfcError(
        'INVALID_ACTION',
        `Se esperaban ${expected.place} colocadas y ${expected.discard} descartadas`,
      );
    }

    const used = [...placements.map((p) => p.card), ...discards];
    const hand = new Set(player.hand);
    for (const card of used) {
      if (!hand.delete(card)) {
        throw new OfcError('CARD_NOT_IN_HAND', `La carta ${card} no está en tu mano`);
      }
    }

    player.board = placeCards(player.board, placements); // valida cupo y duplicados
    player.discards.push(...discards);
    player.hand = [];

    const events = [{ type: 'placed', playerId, placements }];
    if (player.fantasyland) {
      player.deadline = null;
      this._maybeShowdown(now, events);
      if (this.phase === PHASE.PLACING && !this.activePlayerId) this._beginTurn(now, events);
    } else {
      this.turnIndex++;
      this._beginTurn(now, events);
    }
    this.version++;
    return events;
  }

  /* ── conexión ── */

  disconnect(playerId, now) {
    const player = this._player(playerId);
    if (!player.connected) return [];
    player.connected = false;
    player.disconnectedAt = now;
    this.version++;
    return [{ type: 'disconnected', playerId, graceUntil: now + this.graceMs }];
  }

  reconnect(playerId) {
    const player = this._player(playerId);
    if (player.forfeited) throw new OfcError('FORFEITED', 'La mano ya se cerró por abandono');
    player.connected = true;
    player.disconnectedAt = null;
    this.version++;
    return [{ type: 'reconnected', playerId }];
  }

  /**
   * Avance del reloj. Debe llamarse periódicamente desde el transporte.
   * Aplica auto-jugada por temporizador y abandono por desconexión.
   */
  tick(now) {
    const events = [];
    if (this.pausedAt !== null) return events;
    if (this.phase !== PHASE.PLACING) return events;

    for (const p of this.players) {
      if (!p.connected && !p.forfeited && now - p.disconnectedAt >= this.graceMs) {
        p.forfeited = true;
        p.hand = [];
        p.deadline = null;
        events.push({ type: 'forfeited', playerId: p.id });
        if (this.activePlayerId === p.id) {
          this.activePlayerId = null;
          this.turnIndex++;
          this._beginTurn(now, events);
        }
      }
    }

    for (const p of this.players) {
      if (p.fantasyland && !p.forfeited && p.hand.length && p.deadline !== null && now >= p.deadline) {
        this._autoPlay(p, FANTASYLAND_DEAL.place, now, events);
      }
    }

    if (this.activePlayerId && this.deadline !== null && now >= this.deadline) {
      const active = this._player(this.activePlayerId);
      this._autoPlay(active, PINEAPPLE_STREETS[this.street].place, now, events);
    }

    this._maybeShowdown(now, events);
    if (events.length) this.version++;
    return events;
  }

  /* ── vista por jugador ── */

  /**
   * Estado redactado. Los tableros son públicos (juego a cara descubierta),
   * pero la mano pendiente y los descartes son privados, y el tablero de un
   * jugador en Fantasyland permanece oculto hasta el showdown.
   */
  getStateFor(viewerId) {
    const inShowdown = this.phase === PHASE.SHOWDOWN;
    return {
      tableId: this.id,
      version: this.version,
      handNumber: this.handNumber,
      phase: this.phase,
      street: this.street,
      activePlayerId: this.activePlayerId,
      deadline: this.deadline,
      turnMs: this.turnMs,
      fantasylandMs: this.fantasylandMs,
      paused: this.pausedAt !== null,
      you: viewerId,
      players: this.players.map((p) => {
        const hideBoard = p.fantasyland && !inShowdown && p.id !== viewerId;
        return {
          id: p.id,
          name: p.name,
          seat: p.seat,
          board: hideBoard ? createEmptyBoard() : p.board,
          placedCount: ROWS.reduce((n, row) => n + p.board[row].length, 0),
          discardCount: p.discards.length,
          discards: p.id === viewerId || inShowdown ? p.discards : undefined,
          hand: p.id === viewerId ? p.hand : undefined,
          handCount: p.hand.length,
          deadline: p.fantasyland ? p.deadline : undefined,
          fantasyland: p.fantasyland,
          connected: p.connected,
          forfeited: p.forfeited,
          score: p.score,
        };
      }),
      result: this.result,
    };
  }

  /* ── internos ── */

  _player(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) throw new OfcError('UNKNOWN_PLAYER', `Jugador desconocido: ${playerId}`);
    return player;
  }

  _turnOrder() {
    return this.players.filter((p) => !p.fantasyland);
  }

  _beginTurn(now, events) {
    this.activePlayerId = null;
    this.deadline = null;
    for (;;) {
      if (this.street >= PINEAPPLE_STREETS.length) { this._maybeShowdown(now, events); return; }
      const order = this._turnOrder();
      if (order.length === 0) { this._maybeShowdown(now, events); return; }
      if (this.turnIndex >= order.length) { this.street++; this.turnIndex = 0; continue; }

      const player = order[this.turnIndex];
      if (player.forfeited || isBoardComplete(player.board)) { this.turnIndex++; continue; }

      const street = PINEAPPLE_STREETS[this.street];
      player.hand = draw(this.deck, street.deal);
      this.activePlayerId = player.id;
      this.deadline = now + this.turnMs;
      events.push({ type: 'turn', playerId: player.id, street: this.street, deadline: this.deadline });
      return;
    }
  }

  /** Cartas que este jugador no puede ver: base honesta para los rollouts. */
  _unseenFor(player) {
    const visible = new Set([...player.hand, ...player.discards]);
    for (const p of this.players) {
      for (const row of ROWS) for (const card of p.board[row]) visible.add(card);
    }
    return createDeck().filter((card) => !visible.has(card));
  }

  _autoPlay(player, placeCount, now, events) {
    const { placements, discards } = autoPlace(player.board, player.hand, placeCount, this.rng, {
      unseen: this._unseenFor(player),
    });
    player.board = placeCards(player.board, placements);
    player.discards.push(...discards);
    player.hand = [];
    player.deadline = null;
    events.push({ type: 'auto_placed', playerId: player.id, placements });

    if (!player.fantasyland) {
      this.turnIndex++;
      this._beginTurn(now, events);
    }
  }

  _allDone() {
    return this.players.every((p) => p.forfeited || (p.hand.length === 0 && isBoardComplete(p.board)));
  }

  _maybeShowdown(now, events) {
    if (this.phase !== PHASE.PLACING || !this._allDone()) return;

    // Un abandono o un tablero incompleto se liquidan como foul.
    const evaluations = this.players.map((p) =>
      (p.forfeited || !isBoardComplete(p.board))
        ? { foul: true, forfeited: true }
        : evaluateBoard(p.board));

    const scores = new Array(this.players.length).fill(0);
    const pairwise = [];
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        const r = scorePair(evaluations[i], evaluations[j]);
        scores[i] += r.a;
        scores[j] += r.b;
        pairwise.push({ a: this.players[i].id, b: this.players[j].id, ...r });
      }
    }

    this.players.forEach((p, i) => {
      const ev = evaluations[i];
      p.score += scores[i];
      p.nextFantasyland = ev.foul
        ? false
        : (p.fantasyland ? staysInFantasyland(ev) : qualifiesForFantasyland(ev));
    });

    this.phase = PHASE.SHOWDOWN;
    this.activePlayerId = null;
    this.deadline = null;
    this.result = {
      handNumber: this.handNumber,
      pairwise,
      players: this.players.map((p, i) => ({
        id: p.id,
        delta: scores[i],
        total: p.score,
        foul: evaluations[i].foul,
        forfeited: !!evaluations[i].forfeited,
        royalties: boardRoyalties(evaluations[i]).total,
        hands: evaluations[i].foul ? null : {
          top: evaluations[i].top.name,
          middle: evaluations[i].middle.name,
          bottom: evaluations[i].bottom.name,
        },
        fantasylandNext: p.nextFantasyland,
      })),
    };
    events.push({ type: 'hand_ended', result: this.result });
  }
}
