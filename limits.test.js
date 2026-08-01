/**
 * limits.test.js — Límites de frecuencia y purga de mesas abandonadas.
 *
 * Ejecutar: node --test limits.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket, SocketLimiter } from './ofc-limits.js';
import { connect, startServer } from './test-helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── cubo de fichas ── */

test('el cubo agota la ráfaga y se rellena con el tiempo', () => {
  const bucket = new TokenBucket({ capacity: 3, refillPerSec: 1, now: 0 });

  assert.equal(bucket.take(0), true);
  assert.equal(bucket.take(0), true);
  assert.equal(bucket.take(0), true);
  assert.equal(bucket.take(0), false, 'la cuarta en el mismo instante sobra');

  assert.equal(bucket.take(999), false, 'aún no ha pasado un segundo entero');
  assert.equal(bucket.take(1000), true, 'un segundo repone una ficha');
  assert.equal(bucket.take(1000), false, 'y sólo una');
});

test('el cubo no acumula más allá de su capacidad', () => {
  const bucket = new TokenBucket({ capacity: 2, refillPerSec: 10, now: 0 });
  assert.equal(bucket.peek(60_000), 2, 'un minuto parado no da 600 fichas');
});

test('el cupo anónimo es independiente del autenticado', () => {
  const limiter = new SocketLimiter({
    anonCapacity: 2, anonRefillPerSec: 0.5, capacity: 10, refillPerSec: 10, now: 0,
  });

  assert.equal(limiter.check(0, false).allowed, true);
  assert.equal(limiter.check(0, false).allowed, true);
  assert.equal(limiter.check(0, false).allowed, false, 'agotado el cupo anónimo');
  assert.equal(limiter.check(0, true).allowed, true, 'autenticarse abre el cupo ancho');
});

test('el aviso se espacia y la expulsión llega tras acumular descartes', () => {
  const limiter = new SocketLimiter({
    capacity: 1, refillPerSec: 0.001, maxStrikes: 3, warnEveryMs: 1000, now: 0,
  });

  assert.equal(limiter.check(0, true).allowed, true, 'la única ficha');

  assert.deepEqual(limiter.check(0, true), { allowed: false, warn: true, kick: false });
  assert.equal(limiter.check(10, true).warn, false, 'no se avisa dos veces en 10 ms');
  assert.equal(limiter.check(20, true).kick, true, 'tercer descarte: fuera');
});

/* ── integración: el servidor corta al cliente abusivo ── */

test('un cliente que inunda el socket recibe RATE_LIMITED y acaba expulsado', async (t) => {
  const { server, port } = await startServer({
    limits: { anonCapacity: 2, anonRefillPerSec: 0.01, maxStrikes: 5, warnEveryMs: 0 },
  });
  t.after(() => server.close());

  const client = connect(port);
  await client.open;
  const closed = new Promise((resolve) => client.socket.on('close', resolve));

  // Sin autenticar el cupo es de 2 mensajes; 20 lo desbordan de sobra.
  for (let i = 0; i < 20; i += 1) client.send({ type: 'join', seats: 2 });

  const code = await closed;
  assert.equal(code, 1008, 'cierre por violación de política');
  assert.ok(
    client.inbox.some((m) => m.code === 'RATE_LIMITED'),
    'avisó antes de cerrar',
  );
});

test('el ritmo normal de juego no dispara el límite', async (t) => {
  const { server, port } = await startServer({ limits: { capacity: 20, refillPerSec: 10 } });
  t.after(() => server.close());

  const client = connect(port);
  await client.open;
  client.send({ type: 'auth', token: 'dev:ana:Ana' });
  await client.wait((m) => m.type === 'authenticated');

  // Diez mensajes seguidos: una mano completa manda menos que esto.
  for (let i = 0; i < 10; i += 1) client.send({ type: 'presence', state: 'foreground' });
  await sleep(100);

  assert.equal(
    client.inbox.some((m) => m.code === 'RATE_LIMITED'), false,
    'el juego normal cabe de sobra en el cupo',
  );
});

/* ── purga ── */

test('la purga retira mesas congeladas caducadas y respeta las vivas', async (t) => {
  const { server, port } = await startServer({ tableTtlMs: 1000 });
  t.after(() => server.close());

  const ana = connect(port);
  const bruno = connect(port);
  await Promise.all([ana.open, bruno.open]);
  ana.send({ type: 'auth', token: 'dev:ana:Ana' });
  bruno.send({ type: 'auth', token: 'dev:bruno:Bruno' });
  await ana.wait((m) => m.type === 'authenticated');
  await bruno.wait((m) => m.type === 'authenticated');

  ana.send({ type: 'join', seats: 2 });
  bruno.send({ type: 'join', seats: 2 });
  await ana.wait((m) => m.type === 'state');

  assert.equal(server.tables.size, 1);
  const tableId = [...server.tables.keys()][0];

  // Mesa en juego: la purga no la toca aunque el TTL sea de un segundo.
  assert.deepEqual(server.purgeTables(Date.now() + 10_000), { tables: 0, sessions: 0 });
  assert.equal(server.tables.size, 1, 'una mesa activa sobrevive');

  await Promise.all([ana.close(), bruno.close()]);
  await sleep(150);

  const entry = server.tables.get(tableId);
  assert.notEqual(entry.table.pausedAt, null, 'sin nadie delante queda congelada');

  assert.equal(
    server.purgeTables(entry.table.pausedAt + 500).tables, 0,
    'antes del TTL sigue reclamable',
  );
  assert.equal(server.tables.size, 1);

  const removed = server.purgeTables(entry.table.pausedAt + 2000);
  assert.equal(removed.tables, 1);
  assert.equal(server.tables.size, 0);
  assert.equal(server.playerTables.has('ana'), false, 'el índice también se limpia');
});

test('la purga retira sesiones huérfanas pero no las que conservan asiento', async (t) => {
  const { server, port } = await startServer({ tableTtlMs: 1000 });
  t.after(() => server.close());

  const client = connect(port);
  await client.open;
  client.send({ type: 'auth', token: 'dev:ana:Ana' });
  await client.wait((m) => m.type === 'authenticated');

  assert.equal(server.sessions.size, 1);
  assert.equal(
    server.purgeTables(Date.now() + 10_000).sessions, 0,
    'con socket abierto no se toca',
  );

  await client.close();
  await sleep(100);

  const session = server.sessions.get('ana');
  assert.equal(session.socket, null);
  assert.equal(server.purgeTables(session.lastSeenAt + 500).sessions, 0, 'aún dentro del TTL');

  // Con asiento pendiente tampoco se borra, aunque haya caducado.
  session.tableId = 'mesa-fantasma';
  assert.equal(server.purgeTables(session.lastSeenAt + 5000).sessions, 0);

  session.tableId = null;
  assert.equal(server.purgeTables(session.lastSeenAt + 5000).sessions, 1);
  assert.equal(server.sessions.size, 0);
});
