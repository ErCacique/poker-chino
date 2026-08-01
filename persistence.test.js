/**
 * Reinicio del servidor. Se levanta una mesa, se mata el proceso lógico y se
 * arranca otro con el mismo almacén: la partida debe volver intacta y con los
 * plazos desplazados, no consumidos por la caída.
 *
 * La variante con Redis se salta sola si no hay servidor en REDIS_URL.
 * Ejecutar: node --test persistence.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, startServer } from './test-helpers.js';
import { MemoryStore, RedisStore } from './ofc-store.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function seatTwoPlayers(port) {
  const ana = connect(port);
  const bruno = connect(port);
  await Promise.all([ana.open, bruno.open]);
  ana.send({ type: 'auth', token: 'dev:a:Ana' });
  bruno.send({ type: 'auth', token: 'dev:b:Bruno' });
  await ana.wait((m) => m.type === 'authenticated');
  await bruno.wait((m) => m.type === 'authenticated');
  ana.send({ type: 'join', seats: 2 });
  bruno.send({ type: 'join', seats: 2 });
  await ana.wait((m) => m.type === 'state');
  await bruno.wait((m) => m.type === 'state');
  return { ana, bruno };
}

/** Coloca las 5 cartas de la calle inicial con quien tenga el turno. */
async function playFirstStreet(client) {
  const state = client.lastState();
  const hand = state.players.find((p) => p.id === state.you).hand;
  client.send({
    type: 'place',
    placements: [
      { card: hand[0], row: 'bottom' }, { card: hand[1], row: 'bottom' },
      { card: hand[2], row: 'middle' }, { card: hand[3], row: 'middle' },
      { card: hand[4], row: 'top' },
    ],
    discards: [],
  });
  await client.wait((m) => m.type === 'event' && m.event.type === 'placed');
  return hand;
}

test('la partida sobrevive a un reinicio y los plazos se desplazan', async (t) => {
  const store = new MemoryStore();

  const first = await startServer({ store, graceMs: 5_000 });
  const { ana, bruno } = await seatTwoPlayers(first.port);
  const anaHand = await playFirstStreet(ana);
  // El estado viaja por socket: hay que esperar a que le llegue también a Bruno.
  await bruno.wait((m) => m.type === 'event' && m.event.type === 'turn' && m.event.playerId === 'b');

  const before = bruno.lastState();
  assert.equal(before.activePlayerId, 'b');
  const remainingBefore = before.deadline - Date.now();

  // Caída: se cierra el servidor con las mesas todavía en juego.
  await first.server.close();
  await Promise.all([ana.close(), bruno.close()]);
  assert.equal((await store.loadTables()).length, 1, 'la instantánea queda guardada');

  await new Promise((resolve) => setTimeout(resolve, 400)); // tiempo caído

  const second = await startServer({ store, graceMs: 5_000 });
  t.after(() => second.server.close());
  assert.equal(second.server.tables.size, 1, 'la mesa se rehidrata al arrancar');

  const anaAgain = connect(second.port);
  await anaAgain.open;
  anaAgain.send({ type: 'auth', token: 'dev:a:Ana' });
  const restored = (await anaAgain.wait((m) => m.type === 'state')).state;

  assert.equal(restored.tableId, before.tableId);
  assert.equal(restored.handNumber, 1);
  assert.deepEqual(
    restored.players.find((p) => p.id === 'a').board.bottom,
    [anaHand[0], anaHand[1]],
    'el tablero vuelve tal cual estaba',
  );
  assert.equal(restored.activePlayerId, 'b', 'el turno sigue donde estaba');

  const remainingAfter = restored.deadline - Date.now();
  assert.ok(
    remainingAfter > remainingBefore - 300,
    `la caída no debe consumir el turno (antes ${remainingBefore}ms, después ${remainingAfter}ms)`,
  );

  await anaAgain.close();
});

test('sin nadie conectado la mesa se congela y no auto-juega', async (t) => {
  const store = new MemoryStore();
  const { server, port } = await startServer({ store, turnMs: 150, graceMs: 60_000 });
  t.after(() => server.close());

  const { ana, bruno } = await seatTwoPlayers(port);
  const tableId = ana.lastState().tableId;
  const placedBefore = ana.lastState().players.find((p) => p.id === 'a').placedCount;

  await Promise.all([ana.close(), bruno.close()]);
  await new Promise((resolve) => setTimeout(resolve, 600)); // varios turnos de margen

  const entry = server.tables.get(tableId);
  assert.ok(entry.table.pausedAt !== null, 'la mesa queda congelada');
  assert.equal(
    entry.table.players[0].board.bottom.length + entry.table.players[0].board.middle.length
      + entry.table.players[0].board.top.length,
    placedBefore,
    'nadie ha colocado cartas mientras no había público',
  );
});

test('RedisStore guarda y recupera la mesa', async (t) => {
  const store = new RedisStore({ url: REDIS_URL, prefix: `ofctest${process.pid}` });
  try {
    await store.connect();
  } catch {
    t.skip(`sin Redis en ${REDIS_URL}`);
    return;
  }
  t.after(async () => {
    for (const snapshot of await store.loadTables()) await store.deleteTable(snapshot.id);
    await store.close();
  });

  const first = await startServer({ store });
  const { ana, bruno } = await seatTwoPlayers(first.port);
  await playFirstStreet(ana);
  await bruno.wait((m) => m.type === 'event' && m.event.type === 'turn' && m.event.playerId === 'b');
  const before = ana.lastState();

  await first.server.close();
  await Promise.all([ana.close(), bruno.close()]);

  const snapshots = await store.loadTables();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].id, before.tableId);
  assert.equal(snapshots[0].deck.length, 52 - 5 - 5, 'el mazo restante viaja en la instantánea');

  const second = await startServer({ store });
  t.after(() => second.server.close());
  const brunoAgain = connect(second.port);
  await brunoAgain.open;
  brunoAgain.send({ type: 'auth', token: 'dev:b:Bruno' });
  const restored = (await brunoAgain.wait((m) => m.type === 'state')).state;

  assert.equal(restored.tableId, before.tableId);
  assert.equal(restored.players.find((p) => p.id === 'a').board.bottom.length, 2);
  await brunoAgain.close();
});
