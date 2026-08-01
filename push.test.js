/**
 * Aviso de turno y registro de dispositivos.
 * El transporte FCM no se prueba aquí: se sustituye por un emisor de mentira y
 * se comprueba la regla, que es la parte que puede equivocarse.
 * Ejecutar: node --test push.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, startServer } from './test-helpers.js';
import { Database } from './ofc-db.js';
import { NullPusher, createPusher } from './ofc-push.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:ofc@localhost:5432/ofc_test';

/** Emisor de mentira: apunta a quién se habría avisado. */
class FakePusher extends NullPusher {
  constructor() {
    super();
    this.sent = [];
  }

  async notifyTurn(payload) {
    this.sent.push(payload);
  }
}

async function seatTwo(port, { anaToken = 'dev:a:Ana', brunoToken = 'dev:b:Bruno' } = {}) {
  const ana = connect(port);
  const bruno = connect(port);
  await Promise.all([ana.open, bruno.open]);
  ana.send({ type: 'auth', token: anaToken });
  bruno.send({ type: 'auth', token: brunoToken });
  await ana.wait((m) => m.type === 'authenticated');
  await bruno.wait((m) => m.type === 'authenticated');
  ana.send({ type: 'join', seats: 2 });
  bruno.send({ type: 'join', seats: 2 });
  await ana.wait((m) => m.type === 'state');
  await bruno.wait((m) => m.type === 'state');
  return { ana, bruno };
}

test('con la app delante no se envía ningún aviso', async (t) => {
  const pusher = new FakePusher();
  const { server, port } = await startServer({ pusher });
  t.after(() => server.close());

  const { ana, bruno } = await seatTwo(port);
  assert.equal(pusher.sent.length, 0, 'Ana está mirando la pantalla, no hace falta avisarla');

  await Promise.all([ana.close(), bruno.close()]);
});

test('en segundo plano sí se avisa del turno, con los segundos que quedan', async (t) => {
  const pusher = new FakePusher();
  const { server, port } = await startServer({ pusher, turnMs: 30_000 });
  t.after(() => server.close());

  const { ana, bruno } = await seatTwo(port);
  const tableId = ana.lastState().tableId;

  // Bruno minimiza la app antes de que le llegue el turno.
  bruno.send({ type: 'presence', state: 'background' });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const hand = ana.lastState().players.find((p) => p.id === 'a').hand;
  ana.send({
    type: 'place',
    placements: [
      { card: hand[0], row: 'bottom' }, { card: hand[1], row: 'bottom' },
      { card: hand[2], row: 'middle' }, { card: hand[3], row: 'middle' },
      { card: hand[4], row: 'top' },
    ],
    discards: [],
  });
  await ana.wait((m) => m.type === 'event' && m.event.type === 'turn' && m.event.playerId === 'b');

  assert.equal(pusher.sent.length, 1);
  assert.deepEqual(
    { playerId: pusher.sent[0].playerId, tableId: pusher.sent[0].tableId },
    { playerId: 'b', tableId },
  );
  assert.ok(pusher.sent[0].secondsLeft > 25 && pusher.sent[0].secondsLeft <= 30);

  await Promise.all([ana.close(), bruno.close()]);
});

test('volver al primer plano deja de generar avisos', async (t) => {
  const pusher = new FakePusher();
  const { server, port } = await startServer({ pusher });
  t.after(() => server.close());

  const { ana, bruno } = await seatTwo(port);
  bruno.send({ type: 'presence', state: 'background' });
  bruno.send({ type: 'presence', state: 'foreground' });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const hand = ana.lastState().players.find((p) => p.id === 'a').hand;
  ana.send({
    type: 'place',
    placements: [
      { card: hand[0], row: 'bottom' }, { card: hand[1], row: 'bottom' },
      { card: hand[2], row: 'middle' }, { card: hand[3], row: 'middle' },
      { card: hand[4], row: 'top' },
    ],
    discards: [],
  });
  await ana.wait((m) => m.type === 'event' && m.event.type === 'turn' && m.event.playerId === 'b');

  assert.equal(pusher.sent.length, 0);
  await Promise.all([ana.close(), bruno.close()]);
});

test('un estado de presencia inventado se rechaza', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const client = connect(port);
  await client.open;
  client.send({ type: 'auth', token: 'dev:z:Zoe' });
  await client.wait((m) => m.type === 'authenticated');

  client.send({ type: 'presence', state: 'dormido' });
  const error = await client.wait((m) => m.type === 'error');
  assert.equal(error.code, 'INVALID_PRESENCE');

  await client.close();
});

test('sin credenciales de FCM el emisor no hace nada en vez de fallar', async () => {
  const pusher = createPusher({ credentialsJson: undefined, db: null });
  assert.ok(pusher instanceof NullPusher);
  await pusher.notifyTurn({ playerId: 'a', tableId: 'X', secondsLeft: 30 });

  const broken = createPusher({ credentialsJson: '{"esto":"no vale"}', db: {} });
  assert.ok(broken instanceof NullPusher, 'unas credenciales rotas no deben tumbar el arranque');
});

test('el token de dispositivo se guarda y sigue a la última cuenta', async (t) => {
  const db = new Database({ url: DATABASE_URL });
  try {
    await db.migrate();
    await db.pool.query('truncate devices, hand_players, hands, users restart identity cascade');
  } catch {
    await db.close().catch(() => {});
    return t.skip(`sin PostgreSQL en ${DATABASE_URL}`);
  }
  t.after(() => db.close());

  const ana = await db.upsertUser({ googleSub: 'push-a', name: 'Ana' });
  const bruno = await db.upsertUser({ googleSub: 'push-b', name: 'Bruno' });

  const { server, port } = await startServer({
    onDeviceToken: (device) => db.saveDevice({ userId: device.playerId, ...device }),
  });
  t.after(() => server.close());

  const client = connect(port);
  await client.open;
  client.send({ type: 'auth', token: `dev:${ana.playerId}:Ana` });
  await client.wait((m) => m.type === 'authenticated');
  client.send({ type: 'push_token', token: 'token-de-un-movil-real', platform: 'android' });
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.deepEqual(await db.devicesFor(ana.playerId), [{ token: 'token-de-un-movil-real', platform: 'android' }]);

  // El mismo móvil, otra cuenta: el token cambia de dueño, no se duplica.
  client.send({ type: 'auth', token: `dev:${bruno.playerId}:Bruno` });
  await client.wait((m) => m.type === 'authenticated' && m.name === 'Bruno');
  client.send({ type: 'push_token', token: 'token-de-un-movil-real', platform: 'android' });
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal((await db.devicesFor(ana.playerId)).length, 0);
  assert.equal((await db.devicesFor(bruno.playerId)).length, 1);

  await client.close();
});
