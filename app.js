/**
 * app.js — Punto de entrada. Compone las piezas y expone HTTP + WebSocket en
 * el mismo puerto: el WebSocket se engancha al servidor HTTP, así que no hay
 * dos puertos que abrir ni dos orígenes que configurar en el cliente.
 *
 * Variables de entorno:
 *   PORT                 (8080)
 *   SESSION_SECRET       obligatoria en producción, mínimo 32 caracteres
 *   GOOGLE_CLIENT_ID     obligatoria para el login real
 *   DATABASE_URL         sin ella no hay historial ni ranking
 *   REDIS_URL            sin ella un reinicio pierde las partidas en curso
 *   ALLOW_DEV_TOKENS=1   habilita tokens dev: (sólo desarrollo)
 *   CORS_ORIGIN          origen del cliente (http://localhost:5173)
 *
 * Node.js >= 18, ESM.
 */

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { GameServer } from './ws-server.js';
import { MemoryStore, RedisStore } from './ofc-store.js';
import { Database } from './ofc-db.js';
import { makeVerifyToken, verifyGoogleIdToken, issueSession, verifySession } from './ofc-auth.js';
import { createPusher } from './ofc-push.js';
import { OfcError } from './ofc-engine.js';

const MAX_BODY = 16 * 1024;

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new OfcError('BODY_TOO_LARGE', 'Cuerpo demasiado grande'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new OfcError('BAD_JSON', 'Cuerpo JSON ilegible'));
      }
    });
    request.on('error', reject);
  });
}

function send(response, status, payload, corsOrigin) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': corsOrigin,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  response.end(body);
}

/**
 * Construye la aplicación completa sin arrancarla.
 * @returns {{httpServer:http.Server, game:GameServer, db:Database|null, store:object, listen:Function, close:Function}}
 */
export function createApp({
  sessionSecret = process.env.SESSION_SECRET,
  googleClientId = process.env.GOOGLE_CLIENT_ID,
  databaseUrl = process.env.DATABASE_URL,
  redisUrl = process.env.REDIS_URL,
  allowDevTokens = process.env.ALLOW_DEV_TOKENS === '1',
  corsOrigin = process.env.CORS_ORIGIN ?? '*',
  db = databaseUrl ? new Database({ url: databaseUrl }) : null,
  store = redisUrl ? new RedisStore({ url: redisUrl }) : new MemoryStore(),
  pusher = null,
  gameOptions = {},
} = {}) {
  // En desarrollo se genera un secreto efímero: sirve para arrancar, e invalida
  // las sesiones en cada reinicio, que es justo lo que debe pasar sin secreto fijo.
  const secret = sessionSecret ?? randomBytes(32).toString('hex');
  if (!sessionSecret) console.warn('[ofc] SESSION_SECRET no definido: sesiones efímeras');

  const notifier = pusher ?? createPusher({ db });

  // Los cupos se pueden apretar sin tocar código si aparece abuso en producción.
  const envLimits = {};
  if (process.env.WS_RATE_CAPACITY) envLimits.capacity = Number(process.env.WS_RATE_CAPACITY);
  if (process.env.WS_RATE_PER_SEC) envLimits.refillPerSec = Number(process.env.WS_RATE_PER_SEC);

  const game = new GameServer({
    limits: envLimits,
    ...(process.env.WS_MAX_PAYLOAD ? { maxPayload: Number(process.env.WS_MAX_PAYLOAD) } : {}),
    ...(process.env.TABLE_TTL_MS ? { tableTtlMs: Number(process.env.TABLE_TTL_MS) } : {}),
    ...gameOptions,
    store,
    pusher: notifier,
    verifyToken: makeVerifyToken({ secret, allowDev: allowDevTokens }),
    onHandEnded: db ? (table, result) => recordHand(db, table, result) : null,
    onDeviceToken: db ? (device) => db.saveDevice({ userId: device.playerId, ...device }) : null,
  });

  // CORS_ORIGIN admite una lista separada por comas (web de producción, localhost
  // de desarrollo, y https://localhost que usan las apps nativas de Capacitor).
  // Cada respuesta refleja el Origin de la petición si está en la lista, en vez
  // de fijar uno solo: con un único valor fijo, cualquier origen legítimo que no
  // sea justo ese se queda sin acceso por CORS.
  const allowedOrigins = corsOrigin.split(',').map((origin) => origin.trim());
  function resolveCorsOrigin(request) {
    if (allowedOrigins.includes('*')) return '*';
    const requestOrigin = request.headers.origin;
    return requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
  }

  const httpServer = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
    const corsOrigin = resolveCorsOrigin(request);
    try {
      if (request.method === 'OPTIONS') return send(response, 204, {}, corsOrigin);

      if (request.method === 'GET' && url.pathname === '/health') {
        return send(response, 200, { ok: true, tables: game.tables.size }, corsOrigin);
      }

      if (request.method === 'POST' && url.pathname === '/auth/google') {
        const { idToken } = await readJson(request);
        const profile = await verifyGoogleIdToken(idToken, { clientId: googleClientId });
        if (!db) throw new OfcError('CONFIG', 'Sin base de datos no se pueden crear cuentas');
        const user = await db.upsertUser(profile);
        const token = await issueSession(user, { secret });
        return send(response, 200, { token, ...user }, corsOrigin);
      }

      if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
        if (!db) throw new OfcError('CONFIG', 'Sin base de datos no hay clasificación');
        const rows = await db.leaderboard({
          days: Number(url.searchParams.get('days') ?? 30),
          minHands: Number(url.searchParams.get('minHands') ?? 10),
          limit: Math.min(Number(url.searchParams.get('limit') ?? 50), 200),
        });
        return send(response, 200, { rows }, corsOrigin);
      }

      if (request.method === 'GET' && url.pathname === '/api/me/history') {
        if (!db) throw new OfcError('CONFIG', 'Sin base de datos no hay historial');
        const header = request.headers.authorization ?? '';
        const session = await verifySession(header.replace(/^Bearer /i, ''), { secret });
        const rows = await db.playerHistory(session.playerId, {
          limit: Math.min(Number(url.searchParams.get('limit') ?? 20), 100),
        });
        return send(response, 200, { rows }, corsOrigin);
      }

      return send(response, 404, { error: 'NOT_FOUND' }, corsOrigin);
    } catch (error) {
      const domain = error instanceof OfcError;
      if (!domain) console.error('[ofc] error HTTP:', error);
      const status = !domain ? 500 : error.code === 'UNAUTHORIZED' ? 401 : 400;
      return send(response, status, {
        error: domain ? error.code : 'INTERNAL',
        message: domain ? error.message : 'Error interno',
      }, corsOrigin);
    }
  });

  return {
    httpServer,
    game,
    db,
    store,
    async listen(port = Number(process.env.PORT ?? 8080)) {
      if (db) await db.migrate();
      const recovered = await game.restore();
      game.listen(httpServer);
      await new Promise((resolve) => httpServer.listen(port, resolve));
      return { port: httpServer.address().port, recovered };
    },
    async close() {
      await game.close();
      await notifier.close?.();
      await new Promise((resolve) => httpServer.close(resolve));
      await store.close?.();
      await db?.close();
    },
  };
}

/** Traduce el resultado de la mesa a filas de historial. */
async function recordHand(db, table, result) {
  await db.recordHand({
    tableId: table.id,
    handNumber: result.handNumber,
    players: result.players.map((player) => {
      const seat = table.players.find((p) => p.id === player.id);
      return {
        userId: player.id,
        seat: seat?.seat ?? 0,
        delta: player.delta,
        royalties: player.royalties,
        foul: player.foul,
        forfeited: player.forfeited,
        fantasyland: !!seat?.fantasyland,
        fantasylandNext: player.fantasylandNext,
        hands: player.hands,
      };
    }),
  });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  const { port, recovered } = await app.listen();
  console.log(`[ofc] http y ws en :${port} · mesas recuperadas: ${recovered}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => { await app.close(); process.exit(0); });
  }
}
