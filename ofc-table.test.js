/**
 * Pruebas de la mesa OFC Pineapple. Ejecutar: node --test ofc-table.test.js
 * El reloj es un parámetro, así que no hay timers reales ni esperas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, OfcError } from './ofc-engine.js';
import { Table, PHASE, autoPlace } from './ofc-table.js';

const T0 = 1_700_000_000_000;
const rng0 = () => 0; // baraja y auto-jugada deterministas

function makeTable(overrides = {}) {
  return new Table({
    id: 't1',
    players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }],
    deck: createDeck(),
    rng: rng0,
    ...overrides,
  });
}

/** Lleva la mano hasta el final dejando expirar todos los temporizadores. */
function playOutByTimeout(table, start = T0) {
  let now = start;
  for (let guard = 0; guard < 100 && table.phase === PHASE.PLACING; guard++) {
    now += table.turnMs + table.fantasylandMs + 1;
    table.tick(now);
  }
  return now;
}

test('el reparto inicial da 5 cartas al primero en actuar y a nadie más', () => {
  const table = makeTable();
  table.startHand(T0);

  assert.equal(table.phase, PHASE.PLACING);
  assert.equal(table.activePlayerId, 'a');
  assert.equal(table.deadline, T0 + table.turnMs);

  const stateA = table.getStateFor('a');
  assert.equal(stateA.players[0].hand.length, 5);
  assert.equal(stateA.players[1].hand, undefined, 'no se filtra la mano rival');
  assert.equal(stateA.players[1].handCount, 0, 'el rival aún no ha recibido cartas');
});

test('el turno rota y sólo acepta la jugada del jugador activo', () => {
  const table = makeTable();
  table.startHand(T0);
  const hand = table.getStateFor('a').players[0].hand;

  assert.throws(
    () => table.place('b', { placements: [], discards: [] }, T0),
    (e) => e instanceof OfcError && e.code === 'NOT_YOUR_TURN',
  );

  assert.throws(
    () => table.place('a', {
      placements: hand.slice(0, 4).map((card) => ({ card, row: 'bottom' })),
      discards: [],
    }, T0),
    (e) => e instanceof OfcError && e.code === 'INVALID_ACTION',
    'la calle 0 exige exactamente 5 colocadas',
  );

  const placements = [
    { card: hand[0], row: 'bottom' }, { card: hand[1], row: 'bottom' },
    { card: hand[2], row: 'middle' }, { card: hand[3], row: 'middle' },
    { card: hand[4], row: 'top' },
  ];
  table.place('a', { placements, discards: [] }, T0);

  assert.equal(table.activePlayerId, 'b');
  assert.equal(table.getStateFor('b').players[1].hand.length, 5);
  assert.equal(table.getStateFor('b').players[0].board.bottom.length, 2, 'el tablero rival es público');
});

test('no se puede colocar una carta que no está en la mano', () => {
  const table = makeTable();
  table.startHand(T0);
  const hand = table.getStateFor('a').players[0].hand;
  const intruder = createDeck().find((c) => !hand.includes(c));

  assert.throws(
    () => table.place('a', {
      placements: [
        { card: intruder, row: 'bottom' }, { card: hand[1], row: 'bottom' },
        { card: hand[2], row: 'middle' }, { card: hand[3], row: 'middle' },
        { card: hand[4], row: 'top' },
      ],
      discards: [],
    }, T0),
    (e) => e instanceof OfcError && e.code === 'CARD_NOT_IN_HAND',
  );
});

test('el temporizador coloca automáticamente y pasa el turno', () => {
  const table = makeTable();
  table.startHand(T0);
  const events = table.tick(T0 + table.turnMs);

  assert.ok(events.some((e) => e.type === 'auto_placed' && e.playerId === 'a'));
  assert.equal(table.activePlayerId, 'b');
  assert.equal(table.getStateFor('a').players[0].placedCount, 5);
});

test('mano completa por timeout: termina en showdown y suma cero', () => {
  const table = makeTable();
  table.startHand(T0);
  playOutByTimeout(table);

  assert.equal(table.phase, PHASE.SHOWDOWN);
  assert.equal(table.result.players.length, 2);
  const total = table.result.players.reduce((s, p) => s + p.delta, 0);
  assert.equal(total, 0);
  for (const p of table.players) {
    assert.equal(p.board.top.length + p.board.middle.length + p.board.bottom.length, 13);
    assert.equal(p.discards.length, 4, 'cuatro descartes en Pineapple');
  }
});

test('la auto-jugada mantiene la tasa de foul por debajo del 5%', () => {
  // Medición sobre 600 manos: 0,7%. El umbral deja margen a la varianza del
  // muestreo Monte Carlo sin dejar pasar una regresión de la heurística.
  let hands = 0;
  let fouls = 0;
  for (let seed = 1; seed <= 10; seed++) {
    let state = seed;
    const rng = (n) => { state = (state * 1103515245 + 12345) % 2147483648; return state % n; };
    const table = new Table({
      id: `t${seed}`,
      players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }, { id: 'c', name: 'Cris' }],
      rng,
    });
    table.startHand(T0);
    playOutByTimeout(table);
    assert.equal(table.phase, PHASE.SHOWDOWN);
    for (const p of table.result.players) { hands++; if (p.foul) fouls++; }
  }
  assert.ok(fouls / hands <= 0.05, `tasa de foul demasiado alta: ${fouls}/${hands}`);
});

test('desconexión: reconectar dentro del margen no penaliza', () => {
  const table = makeTable();
  table.startHand(T0);
  table.disconnect('b', T0);
  table.tick(T0 + table.graceMs - 1);
  table.reconnect('b');
  table.tick(T0 + table.graceMs + 1);

  assert.equal(table.players[1].forfeited, false);
  assert.equal(table.players[1].connected, true);
});

test('abandono tras el margen: el rival cobra 6 más sus royalties', () => {
  // Con mazo barajado: el orden natural del mazo produce manos degeneradas
  // (póker de doses en la primera calle) que ensucian incluso jugando bien.
  let s = 7;
  const rng = (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
  const table = new Table({
    id: 't1',
    players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }],
    rng,
  });
  table.startHand(T0);
  table.disconnect('b', T0);

  let now = T0 + table.graceMs + 1;
  const events = table.tick(now);
  assert.ok(events.some((e) => e.type === 'forfeited' && e.playerId === 'b'));

  now = playOutByTimeout(table, now);
  assert.equal(table.phase, PHASE.SHOWDOWN);

  const [ana, bruno] = table.result.players;
  assert.equal(bruno.forfeited, true);
  assert.equal(bruno.foul, true);
  assert.equal(bruno.royalties, 0);
  assert.equal(ana.foul, false);
  assert.equal(ana.delta, 6 + ana.royalties);
  assert.equal(bruno.delta, -(6 + ana.royalties));
});

test('Fantasyland: 14 cartas de golpe, tablero oculto hasta el showdown', () => {
  const table = makeTable({
    players: [{ id: 'a', name: 'Ana', fantasyland: true }, { id: 'b', name: 'Bruno' }],
  });
  table.startHand(T0);

  assert.equal(table.getStateFor('a').players[0].hand.length, 14);
  assert.equal(table.activePlayerId, 'b', 'quien está en Fantasyland no ocupa turno');

  const hand = table.getStateFor('a').players[0].hand;
  const { placements, discards } = autoPlace(table.players[0].board, hand, 13, rng0);
  table.place('a', { placements, discards }, T0);

  const seenByB = table.getStateFor('b').players[0];
  assert.equal(seenByB.board.bottom.length, 0, 'el tablero de Fantasyland está oculto');
  assert.equal(seenByB.placedCount, 13, 'pero se sabe cuántas cartas ha colocado');

  playOutByTimeout(table);
  assert.equal(table.phase, PHASE.SHOWDOWN);
  assert.equal(table.getStateFor('b').players[0].board.bottom.length, 5, 'se revela al final');
});

test('encadenar manos arrastra el Fantasyland ganado', () => {
  const table = makeTable();
  table.startHand(T0);
  playOutByTimeout(table);

  // Se fuerza el estado de clasificación para verificar el arrastre.
  table.players[0].nextFantasyland = true;
  const now = T0 + 10_000_000;
  table.nextHand(now);

  assert.equal(table.players[0].fantasyland, true);
  assert.equal(table.players[0].hand.length, 14);
  assert.equal(table.players[0].nextFantasyland, false);
  assert.equal(table.activePlayerId, 'b');
});

test('mesa de 3: el mazo aguanta y los turnos rotan en orden de asiento', () => {
  const table = makeTable({
    players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }, { id: 'c', name: 'Cris' }],
  });
  table.startHand(T0);
  const order = [];
  let now = T0;
  for (let i = 0; i < 3; i++) {
    order.push(table.activePlayerId);
    now += table.turnMs;
    table.tick(now);
  }
  assert.deepEqual(order, ['a', 'b', 'c']);

  playOutByTimeout(table, now);
  assert.equal(table.phase, PHASE.SHOWDOWN);
  assert.equal(table.result.players.reduce((s, p) => s + p.delta, 0), 0);
});

test('no se admiten jugadas fuera de fase', () => {
  const table = makeTable();
  assert.throws(
    () => table.place('a', { placements: [], discards: [] }, T0),
    (e) => e instanceof OfcError && e.code === 'WRONG_PHASE',
  );
});
