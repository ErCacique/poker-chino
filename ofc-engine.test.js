/**
 * Pruebas del motor OFC Pineapple. Ejecutar: node --test ofc-engine.test.js
 * Node.js >= 18 (test runner nativo, sin dependencias).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAND, OfcError, createDeck, shuffle, draw, evaluate3, evaluate5, compareHands,
  evaluateBoard, boardRoyalties, qualifiesForFantasyland, staysInFantasyland, fantasylandCardCount,
  scorePair, scoreTable, placeCards, createEmptyBoard, cardsNeeded,
} from './ofc-engine.js';

test('mazo de 52 cartas únicas y barajado no destructivo', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
  const shuffled = shuffle(deck);
  assert.equal(shuffled.length, 52);
  assert.deepEqual([...shuffled].sort(), [...deck].sort());
});

test('draw agota el mazo con error tipado', () => {
  const deck = createDeck();
  assert.equal(draw(deck, 5).length, 5);
  assert.equal(deck.length, 47);
  assert.throws(() => draw(deck, 99), (e) => e instanceof OfcError && e.code === 'DECK_EXHAUSTED');
});

test('categorías de 5 cartas', () => {
  assert.equal(evaluate5(['As', 'Ks', 'Qs', 'Js', 'Ts']).category, HAND.STRAIGHT_FLUSH);
  assert.equal(evaluate5(['As', 'Ks', 'Qs', 'Js', 'Ts']).isRoyal, true);
  assert.equal(evaluate5(['9s', '8s', '7s', '6s', '5s']).isRoyal, false);
  assert.equal(evaluate5(['Ah', 'Ad', 'Ac', 'As', '2d']).category, HAND.QUADS);
  assert.equal(evaluate5(['Ah', 'Ad', 'Ac', '2s', '2d']).category, HAND.FULL_HOUSE);
  assert.equal(evaluate5(['Ah', 'Jh', '9h', '5h', '2h']).category, HAND.FLUSH);
  assert.equal(evaluate5(['9h', '8d', '7c', '6s', '5h']).category, HAND.STRAIGHT);
  assert.equal(evaluate5(['Ah', '2d', '3c', '4s', '5h']).category, HAND.STRAIGHT);
  assert.equal(evaluate5(['Ah', '2d', '3c', '4s', '5h']).key[1], 5, 'la rueda es escalera al 5');
  assert.equal(evaluate5(['Ah', 'Ad', 'Ac', 'Ks', '2d']).category, HAND.TRIPS);
  assert.equal(evaluate5(['Ah', 'Ad', 'Kc', 'Ks', '2d']).category, HAND.TWO_PAIR);
  assert.equal(evaluate5(['Ah', 'Ad', 'Qc', '7s', '2d']).category, HAND.PAIR);
  assert.equal(evaluate5(['Ah', 'Jd', '9c', '7s', '2d']).category, HAND.HIGH_CARD);
});

test('la rueda pierde contra la escalera al 6', () => {
  const wheel = evaluate5(['Ah', '2d', '3c', '4s', '5h']);
  const six = evaluate5(['2h', '3d', '4c', '5s', '6h']);
  assert.equal(compareHands(wheel, six), -1);
});

test('comparación entre filas de 3 y 5 cartas: el kicker ausente pierde', () => {
  const topPair = evaluate3(['Kh', 'Kd', 'Ac']);   // KK con kicker A
  const midPair = evaluate5(['Ks', 'Kc', '5h', '4d', '3s']); // KK con kickers 5 4 3
  assert.equal(compareHands(topPair, midPair), 1, 'el as de la superior gana el desempate');

  const topWeak = evaluate3(['Kh', 'Kd', '2c']);
  assert.equal(compareHands(topWeak, midPair), -1);
});

test('detección de foul', () => {
  const legal = {
    top: ['2h', '3d', '5c'],                    // carta alta
    middle: ['9h', '9d', '4c', '7s', '8d'],     // pareja de 9
    bottom: ['Ah', 'Ad', 'Ac', 'Ks', 'Kd'],     // full
  };
  assert.equal(evaluateBoard(legal).foul, false);

  const fouled = {
    top: ['Ah', 'Ad', 'Ac'],                    // trío de ases arriba
    middle: ['9h', '9d', '4c', '7s', '8d'],     // solo pareja
    bottom: ['Kh', 'Kd', '2c', '3s', '4d'],     // solo pareja
  };
  assert.equal(evaluateBoard(fouled).foul, true);
});

test('royalties estándar', () => {
  const board = {
    top: ['Qh', 'Qd', '2c'],                    // QQ = 7
    middle: ['Ah', 'Ad', 'Ac', 'As', 'Kd'],     // póker = 20
    bottom: ['9h', '8h', '7h', '6h', '5h'],     // escalera de color = 15
  };
  const ev = evaluateBoard(board);
  assert.equal(ev.foul, false);
  assert.deepEqual(boardRoyalties(ev), { top: 7, middle: 20, bottom: 15, total: 42 });

  const fouled = evaluateBoard({
    top: ['Ah', 'Ad', 'Ac'],
    middle: ['9h', '9d', '4c', '7s', '8d'],
    bottom: ['Kh', 'Kd', '2c', '3s', '4d'],
  });
  assert.equal(boardRoyalties(fouled).total, 0, 'en foul no se cobran royalties');
});

test('royalties de trío arriba y pareja mínima', () => {
  const trips = evaluateBoard({
    top: ['2h', '2d', '2c'],
    middle: ['9h', '9d', '9c', '8s', '8d'],
    bottom: ['Ah', 'Ad', 'Ac', 'Ks', 'Kd'],
  });
  assert.equal(boardRoyalties(trips).top, 10, '222 = 10 puntos');

  const smallPair = evaluate3(['5h', '5d', '2c']);
  const board = { top: ['5h', '5d', '2c'], middle: ['Ah', 'Ad', '3c', '4s', '7d'], bottom: ['Kh', 'Kd', 'Kc', '2s', '3d'] };
  assert.equal(smallPair.category, HAND.PAIR);
  assert.equal(boardRoyalties(evaluateBoard(board)).top, 0, 'por debajo de 66 no hay royalty');
});

test('Fantasyland: entrada y permanencia', () => {
  const qq = evaluateBoard({
    top: ['Qh', 'Qd', '2c'],
    middle: ['Ah', 'Ad', '3c', '4s', '7d'],
    bottom: ['Kh', 'Kd', 'Kc', '2s', '3d'],
  });
  assert.equal(qualifiesForFantasyland(qq), true);
  assert.equal(staysInFantasyland(qq), false, 'QQ arriba no basta para repetir');

  const jj = evaluateBoard({
    top: ['Jh', 'Jd', '2c'],
    middle: ['Ah', 'Ad', '3c', '4s', '7d'],
    bottom: ['Kh', 'Kd', 'Kc', '2s', '3d'],
  });
  assert.equal(qualifiesForFantasyland(jj), false);

  const stay = evaluateBoard({
    top: ['5h', '5d', '5c'],
    middle: ['Ah', 'Ad', 'Ac', 'Ks', 'Kd'],
    bottom: ['9h', '9d', '9c', '9s', '8d'],
  });
  assert.equal(staysInFantasyland(stay), true, 'trío arriba mantiene Fantasyland');
});

test('Fantasyland progresivo: QQ=14, KK=15, AA=16, trío=17', () => {
  const withTop = (top) => evaluateBoard({
    top, middle: ['2h', '3d', '4c', '5s', '7d'], bottom: ['9h', '9c', '9s', '2s', '3s'],
  });
  assert.equal(fantasylandCardCount(withTop(['Qh', 'Qd', '2c'])), 14);
  assert.equal(fantasylandCardCount(withTop(['Kh', 'Kd', '2c'])), 15);
  assert.equal(fantasylandCardCount(withTop(['Ah', 'Ad', '2c'])), 16);
  assert.equal(fantasylandCardCount(withTop(['6h', '6d', '6c'])), 17);
});

test('puntuación 1-6 con scoop y royalties', () => {
  const a = evaluateBoard({
    top: ['Ah', 'Ad', '2c'],                    // AA = 9 royalties
    middle: ['Kh', 'Kd', 'Kc', '5s', '5d'],     // full = 12
    bottom: ['9h', '8h', '7h', '6h', '5h'],     // escalera de color = 15
  });
  const b = evaluateBoard({
    top: ['3h', '4d', '5c'],
    middle: ['2h', '2d', '6c', '7s', '8d'],
    bottom: ['Th', 'Td', '9s', '4c', '3s'],
  });
  const r = scorePair(a, b);
  assert.deepEqual(r.rows, [1, 1, 1]);
  assert.equal(r.scoop, 'a');
  assert.equal(r.royalties.a, 36);
  assert.equal(r.royalties.b, 0);
  assert.equal(r.a, 6 + 36);
  assert.equal(r.b, -(6 + 36));
});

test('el foul paga 6 más los royalties del rival', () => {
  const fouled = evaluateBoard({
    top: ['Ah', 'Ad', 'Ac'],
    middle: ['9h', '9d', '4c', '7s', '8d'],
    bottom: ['Kh', 'Kd', '2c', '3s', '4d'],
  });
  const clean = evaluateBoard({
    top: ['2h', '3d', '5c'],
    middle: ['Qh', 'Qd', 'Qc', '6s', '6d'],     // full = 12
    bottom: ['Th', 'Td', 'Tc', 'Ts', '8d'],     // póker = 10
  });
  const r = scorePair(fouled, clean);
  assert.equal(r.a, -(6 + 22));
  assert.equal(r.b, 6 + 22);

  const bothFoul = scorePair(fouled, fouled);
  assert.deepEqual([bothFoul.a, bothFoul.b], [0, 0]);
});

test('mesa de 3 jugadores: suma cero y sin cartas repetidas entre tableros', () => {
  const boards = [
    { top: ['Ah', 'Ad', '2c'], middle: ['Kh', 'Kd', 'Kc', '5s', '5d'], bottom: ['9h', '8h', '7h', '6h', '5h'] },
    { top: ['3h', '4d', '5c'], middle: ['2h', '2d', '6c', '7s', '8d'], bottom: ['Th', 'Td', '9s', '4c', '3s'] },
    { top: ['Jc', 'Jd', '2s'], middle: ['7c', '7d', '8c', '8s', '9c'], bottom: ['Qh', 'Qd', 'Qc', 'Qs', '3c'] },
  ];
  const { scores } = scoreTable(boards);
  assert.equal(scores.reduce((s, v) => s + v, 0), 0, 'el juego es de suma cero');

  const dup = [boards[0], boards[0]];
  assert.throws(() => scoreTable(dup), (e) => e instanceof OfcError && e.code === 'DUPLICATE_CARD');
});

test('placeCards no muta y valida filas llenas', () => {
  const empty = createEmptyBoard();
  const next = placeCards(empty, [{ card: 'As', row: 'top' }, { card: 'Kd', row: 'top' }]);
  assert.deepEqual(empty.top, [], 'el tablero original no se modifica');
  assert.deepEqual(next.top, ['As', 'Kd']);

  const full = placeCards(next, [{ card: 'Qc', row: 'top' }]);
  assert.throws(
    () => placeCards(full, [{ card: '2h', row: 'top' }]),
    (e) => e instanceof OfcError && e.code === 'ROW_FULL',
  );
  assert.throws(
    () => placeCards(next, [{ card: 'As', row: 'middle' }]),
    (e) => e instanceof OfcError && e.code === 'DUPLICATE_CARD',
  );
});

test('el mazo alcanza para 3 jugadores', () => {
  assert.equal(cardsNeeded(3), 51);
  assert.ok(cardsNeeded(3) <= 52);
  assert.equal(cardsNeeded(3, 1), 48, 'quien está en Fantasyland consume 14 en vez de 17');
});
