/**
 * Historial, ranking, sesiones y endpoints HTTP.
 * Las pruebas con base de datos se saltan solas si no hay DATABASE_URL viva.
 * Ejecutar: node --test api.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from './ofc-db.js';
import { MemoryStore } from './ofc-store.js';
import { issueSession, verifySession, makeVerifyToken, verifyGoogleIdToken } from './ofc-auth.js';
import { createApp } from './app.js';
import { connect } from './test-helpers.js';
import { OfcError } from './ofc-engine.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:ofc@localhost:5432/ofc_test';

async function openDatabase() {
  const db = new Database({ url: DATABASE_URL });
  try {
    await db.migrate();
    await db.pool.query('truncate hand_players, hands, users restart identity cascade');
    return db;
  } catch {
    await db.close().catch(() => {});
    return null;
  }
}

/* ── sesiones ── */

test('la sesión propia se firma y se verifica', async () => {
  const token = await issueSession({ playerId: 'g_123', name: 'Ana' }, { secret: SECRET });
  const session = await verifySession(token, { secret: SECRET });
  assert.deepEqual(session, { playerId: 'g_123', name: 'Ana' });
});

test('una sesión firmada con otro secreto se rechaza', async () => {
  const token = await issueSession({ playerId: 'g_123', name: 'Ana' }, { secret: SECRET });
  await assert.rejects(
    () => verifySession(token, { secret: `${SECRET}-distinto` }),
    (error) => error instanceof OfcError && error.code === 'UNAUTHORIZED',
  );
});

test('una sesión caducada se rechaza', async () => {
  const token = await issueSession({ playerId: 'g_1', name: 'Ana' }, { secret: SECRET, ttl: '1s' });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await assert.rejects(() => verifySession(token, { secret: SECRET }));
});

test('los tokens dev sólo pasan si se habilitan explícitamente', async () => {
  const strict = makeVerifyToken({ secret: SECRET, allowDev: false });
  await assert.rejects(() => strict('dev:a:Ana'), (e) => e.code === 'UNAUTHORIZED');

  const permissive = makeVerifyToken({ secret: SECRET, allowDev: true });
  assert.deepEqual(await permissive('dev:a:Ana'), { playerId: 'a', name: 'Ana' });
});

test('un token de Google inventado no cuela', async () => {
  await assert.rejects(
    () => verifyGoogleIdToken('esto.no.es', { clientId: 'cliente.apps.googleusercontent.com' }),
    (error) => error instanceof OfcError && error.code === 'UNAUTHORIZED',
  );
});

/* ── historial y ranking ── */

test('alta de usuario idempotente por sub de Google', async (t) => {
  const db = await openDatabase();
  if (!db) return t.skip(`sin PostgreSQL en ${DATABASE_URL}`);
  t.after(() => db.close());

  const first = await db.upsertUser({ googleSub: '111', name: 'Ana', avatarUrl: null });
  const second = await db.upsertUser({ googleSub: '111', name: 'Ana Renombrada', avatarUrl: 'https://x/y.png' });

  assert.equal(first.playerId, second.playerId, 'el mismo sub da el mismo jugador');
  assert.equal(second.name, 'Ana Renombrada', 'el nombre se actualiza');
  const { rows } = await db.pool.query('select count(*)::int as n from users');
  assert.equal(rows[0].n, 1);
});

test('una mano se guarda entera y alimenta el ranking', async (t) => {
  const db = await openDatabase();
  if (!db) return t.skip(`sin PostgreSQL en ${DATABASE_URL}`);
  t.after(() => db.close());

  const ana = await db.upsertUser({ googleSub: 'a', name: 'Ana' });
  const bruno = await db.upsertUser({ googleSub: 'b', name: 'Bruno' });

  for (let i = 1; i <= 3; i++) {
    await db.recordHand({
      tableId: 'K4TP',
      handNumber: i,
      players: [
        {
          userId: ana.playerId, seat: 0, delta: 8, royalties: 2, foul: false, forfeited: false,
          fantasyland: i === 3, fantasylandNext: false,
          hands: { top: 'pareja', middle: 'color', bottom: 'full' },
        },
        {
          userId: bruno.playerId, seat: 1, delta: -8, royalties: 0, foul: true, forfeited: false,
          fantasyland: false, fantasylandNext: false, hands: null,
        },
      ],
    });
  }

  const table = await db.leaderboard({ days: 30, minHands: 1 });
  assert.equal(table.length, 2);
  assert.equal(table[0].name, 'Ana', 'ordena por puntos por mano');
  assert.equal(table[0].hands, 3);
  assert.equal(table[0].points, 24);
  assert.equal(table[0].pointsPerHand, 8);
  assert.equal(table[0].foulPct, 0);
  assert.equal(table[0].fantasylandPct, 33.3);
  assert.equal(table[1].foulPct, 100);

  const history = await db.playerHistory(bruno.playerId);
  assert.equal(history.length, 3);
  assert.equal(history[0].foul, true);
  assert.equal(history[0].top, null);
});

test('el mínimo de manos deja fuera a quien apenas ha jugado', async (t) => {
  const db = await openDatabase();
  if (!db) return t.skip(`sin PostgreSQL en ${DATABASE_URL}`);
  t.after(() => db.close());

  const ana = await db.upsertUser({ googleSub: 'a', name: 'Ana' });
  await db.recordHand({
    tableId: 'T1',
    handNumber: 1,
    players: [{
      userId: ana.playerId, seat: 0, delta: 40, royalties: 30, foul: false, forfeited: false,
      fantasyland: false, fantasylandNext: true, hands: { top: 'trío', middle: 'full', bottom: 'póker' },
    }],
  });

  assert.equal((await db.leaderboard({ minHands: 10 })).length, 0);
  assert.equal((await db.leaderboard({ minHands: 1 })).length, 1);
});

/* ── endpoints ── */

test('los endpoints responden y protegen lo privado', async (t) => {
  const db = await openDatabase();
  if (!db) return t.skip(`sin PostgreSQL en ${DATABASE_URL}`);

  const app = createApp({ sessionSecret: SECRET, db, store: new MemoryStore(), allowDevTokens: true, gameOptions: { tickMs: 200 } });
  const { port } = await app.listen(0);
  t.after(() => app.close());

  const health = await fetch(`http://localhost:${port}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const board = await fetch(`http://localhost:${port}/api/leaderboard?minHands=1`);
  assert.equal(board.status, 200);
  assert.ok(Array.isArray((await board.json()).rows));

  const noAuth = await fetch(`http://localhost:${port}/api/me/history`);
  assert.equal(noAuth.status, 401);

  const ana = await db.upsertUser({ googleSub: 'a', name: 'Ana' });
  const token = await issueSession(ana, { secret: SECRET });
  const mine = await fetch(`http://localhost:${port}/api/me/history`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(mine.status, 200);

  const badLogin = await fetch(`http://localhost:${port}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: 'no-válido' }),
  });
  assert.equal(badLogin.status, 400, 'sin GOOGLE_CLIENT_ID configurado, es error de configuración');

  assert.equal((await fetch(`http://localhost:${port}/nada`)).status, 404);
});

test('una mano jugada de principio a fin acaba en la base de datos', async (t) => {
  const db = await openDatabase();
  if (!db) return t.skip(`sin PostgreSQL en ${DATABASE_URL}`);

  // Los jugadores deben existir como usuarios: hand_players apunta a users por
  // clave ajena. Con login de Google el alta ocurre al autenticarse; con tokens
  // dev hay que crearlos a mano, y si no, la mano no se guarda.
  const ana = await db.upsertUser({ googleSub: 'e2e-a', name: 'Ana' });
  const bruno = await db.upsertUser({ googleSub: 'e2e-b', name: 'Bruno' });

  const app = createApp({
    sessionSecret: SECRET,
    db,
    store: new MemoryStore(),
    allowDevTokens: true,
    gameOptions: { turnMs: 60, tickMs: 25, showdownMs: 60_000 },
  });
  const { port } = await app.listen(0);
  t.after(() => app.close());

  const anaClient = connect(port);
  const brunoClient = connect(port);
  await Promise.all([anaClient.open, brunoClient.open]);
  anaClient.send({ type: 'auth', token: `dev:${ana.playerId}:Ana` });
  brunoClient.send({ type: 'auth', token: `dev:${bruno.playerId}:Bruno` });
  await anaClient.wait((m) => m.type === 'authenticated');
  await brunoClient.wait((m) => m.type === 'authenticated');
  anaClient.send({ type: 'join', seats: 2 });
  brunoClient.send({ type: 'join', seats: 2 });

  // Nadie coloca nada: los temporizadores completan la mano por auto-jugada.
  const ended = await anaClient.wait(
    (m) => m.type === 'event' && m.event.type === 'hand_ended',
    20_000,
  );
  assert.equal(ended.event.result.players.length, 2);

  // La escritura es asíncrona y fuera del camino crítico.
  let rows = [];
  for (let i = 0; i < 40 && rows.length < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    ({ rows } = await db.pool.query(
      `select hp.user_id, hp.delta, hp.seat, h.hand_number, h.seats
         from hand_players hp join hands h on h.id = hp.hand_id
        order by hp.seat`,
    ));
  }

  assert.equal(rows.length, 2, 'la mano quedó guardada con sus dos jugadores');
  assert.equal(rows[0].user_id, ana.playerId);
  assert.equal(rows[1].user_id, bruno.playerId);
  assert.equal(rows[0].hand_number, 1);
  assert.equal(rows[0].seats, 2);
  assert.equal(rows[0].delta + rows[1].delta, 0, 'la mano es de suma cero');

  await Promise.all([anaClient.close(), brunoClient.close()]);
});
