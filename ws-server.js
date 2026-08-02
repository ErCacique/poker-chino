/**
 * ws-server.js — Transporte WebSocket para las mesas de OFC Pineapple.
 *
 * El servidor es autoritativo: valida cada jugada contra la máquina de estados
 * y envía a cada cliente una vista redactada. El cliente sólo propone.
 *
 * Estado en memoria: las mesas viven en el proceso. Con una sola instancia es
 * suficiente; al escalar horizontalmente hará falta afinidad por mesa (sticky
 * routing) o mover el estado a Redis. La persistencia en PostgreSQL de la
 * entrega siguiente guarda manos terminadas, no partidas en curso.
 *
 * Node.js >= 18, ESM. Dependencia: ws@8
 *
 * Protocolo cliente → servidor (JSON):
 *   { type:'auth',  token }
 *   { type:'join',  seats?:2|3 }          // cola de emparejamiento
 *   { type:'create_room', seats?:2|3 }    // sala privada, devuelve código
 *   { type:'join_room',   code }
 *   { type:'practice_bots', seats?:2|3 }  // mesa instantánea contra bots
 *   { type:'place', placements:[{card,row}], discards:[card] }
 *   { type:'ready' }                       // pedir siguiente mano
 *   { type:'leave' }
 * Protocolo servidor → cliente (JSON):
 *   { type:'authenticated', playerId, name }
 *   { type:'queued', seats, waiting }
 *   { type:'room', code, seats, players }
 *   { type:'state', state }
 *   { type:'event', event }
 *   { type:'error', code, message }
 */

import { WebSocketServer, WebSocket } from 'ws';
import { OfcError } from './ofc-engine.js';
import { Table, PHASE } from './ofc-table.js';
import { MemoryStore } from './ofc-store.js';
import { NullPusher } from './ofc-push.js';
import { SocketLimiter } from './ofc-limits.js';

/**
 * Bots de práctica: no tienen socket ni sesión, sólo un id fijo reconocible.
 * Sus turnos los resuelve el reloj de la mesa exactamente igual que a un
 * humano que se queda sin tiempo (autoPlace vía Table.tick), así que no hace
 * falta ninguna lógica de decisión aparte: basta con sentarlos y no hacer
 * nada más. Nunca se registran en sessions/playerTables porque nada necesita
 * "reconectarlos": nunca se desconectan.
 */
const BOTS = [
  { id: 'bot:marcos', name: 'Marcos' },
  { id: 'bot:maria', name: 'María' },
];
const BOT_NAMES = new Map(BOTS.map((b) => [b.id, b.name]));

// Chat de frases fijas: evita moderación de texto libre.
const CHAT_PHRASES = new Set(['👍', '😂', '😮', '🙏', 'Buena mano', 'Mala suerte', 'GG', '¡Vaya susto!']);

/**
 * Verificador de token por defecto. Formato de desarrollo: "dev:<id>:<nombre>".
 * En la entrega de autenticación se sustituye por la validación del JWT firmado
 * tras el OAuth de Google, con la misma firma: token -> {playerId, name}.
 */
export async function devVerifyToken(token) {
  if (typeof token !== 'string' || !token.startsWith('dev:')) {
    throw new OfcError('UNAUTHORIZED', 'Token inválido');
  }
  const [, playerId, name] = token.split(':');
  if (!playerId) throw new OfcError('UNAUTHORIZED', 'Token sin identificador');
  return { playerId, name: name || playerId };
}

export class GameServer {
  /**
   * @param {object} [options]
   * @param {(token:string)=>Promise<{playerId:string,name:string}>} [options.verifyToken]
   * @param {number} [options.tickMs=1000] frecuencia del reloj del servidor
   * @param {number} [options.turnMs] @param {number} [options.graceMs]
   * @param {number} [options.showdownMs=8000] pausa antes de repartir la siguiente mano
   */
  constructor({
    verifyToken = devVerifyToken,
    tickMs = 1000,
    turnMs = 30_000,
    fantasylandMs = 90_000,
    graceMs = 60_000,
    showdownMs = 8_000,
    heartbeatMs = 30_000,
    botFillMs = 30_000,
    maxPayload = 16 * 1024,
    limits = {},
    tableTtlMs = 7 * 24 * 60 * 60 * 1000,
    purgeMs = 60 * 60 * 1000,
    store = new MemoryStore(),
    onHandEnded = null,
    onDeviceToken = null,
    pusher = new NullPusher(),
  } = {}) {
    this.verifyToken = verifyToken;
    this.store = store;
    this.onHandEnded = onHandEnded;
    this.onDeviceToken = onDeviceToken;
    this.pusher = pusher;
    this.tickMs = tickMs;
    this.tableOptions = { turnMs, fantasylandMs, graceMs };
    this.showdownMs = showdownMs;
    this.heartbeatMs = heartbeatMs;
    // Cuánto espera la cola normal antes de completar los huecos con bots.
    this.botFillMs = botFillMs;
    // Tope de tamaño: ws corta la conexión con 1009 antes de reservar memoria,
    // así que un mensaje gigante no llega siquiera a JSON.parse.
    this.maxPayload = maxPayload;
    this.limits = limits;
    // El TTL en memoria acompaña al de Redis: si la instantánea ya caducó, la
    // mesa congelada en el proceso es basura que nadie va a reclamar.
    this.tableTtlMs = tableTtlMs;
    this.purgeMs = purgeMs;

    this.wss = null;
    this.timer = null;
    this.tables = new Map();      // tableId -> { table, showdownAt }
    this.sessions = new Map();    // playerId -> { socket, tableId, name }
    this.queues = new Map([[2, []], [3, []]]); // asientos -> playerIds en espera
    this.queuedAt = new Map();    // playerId -> desde cuándo espera en cola
    this.rooms = new Map();       // código -> { seats, players:[playerId] }
    this.playerTables = new Map();// playerId -> tableId, sobrevive al reinicio
    this.nextTableId = 1;
  }

  /**
   * Rehidrata las partidas guardadas. Se llama antes de listen(): las mesas
   * vuelven congeladas y sólo se reanudan cuando alguien se reconecta, de modo
   * que la caída no consume el temporizador de turno ni el margen de gracia.
   * @returns {Promise<number>} mesas recuperadas
   */
  async restore() {
    await this.store.connect?.();
    const snapshots = await this.store.loadTables();
    for (const snapshot of snapshots) {
      let table;
      try {
        table = Table.fromJSON(snapshot);
      } catch (error) {
        console.error(`[ofc] instantánea descartada (${snapshot?.id}):`, error.message);
        continue;
      }
      this.tables.set(table.id, { table, showdownAt: null });
      for (const player of table.players) this.playerTables.set(player.id, table.id);
    }
    return snapshots.length;
  }

  /** @param {import('http').Server|number} target servidor HTTP existente o puerto */
  listen(target) {
    this.wss = typeof target === 'number'
      ? new WebSocketServer({ port: target, maxPayload: this.maxPayload })
      : new WebSocketServer({ server: target, maxPayload: this.maxPayload });

    this.wss.on('connection', (socket) => this._onConnection(socket));
    this.timer = setInterval(() => this._tickAll(Date.now()), this.tickMs);
    this.timer.unref?.();
    // El latido va en su propio intervalo: atado al tick, una latencia mayor
    // que tickMs bastaría para dar por muerto a un cliente sano.
    this.heartbeat = setInterval(() => this._pingIdle(), this.heartbeatMs);
    this.heartbeat.unref?.();
    this.purge = setInterval(() => this.purgeTables(Date.now()), this.purgeMs);
    this.purge.unref?.();
    return this.wss;
  }

  async close() {
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    clearInterval(this.purge);
    this.timer = null;
    this.heartbeat = null;
    this.purge = null;
    // Una sesión desconectada conserva el asiento con socket a null.
    for (const session of this.sessions.values()) session.socket?.close();
    this.sessions.clear();
    this.tables.clear();
    await new Promise((resolve) => (this.wss ? this.wss.close(resolve) : resolve()));
  }

  /* ── conexión ── */

  _onConnection(socket) {
    socket.playerId = null;
    socket.isAlive = true;
    socket.limiter = new SocketLimiter({ ...this.limits, now: Date.now() });
    socket.on('pong', () => { socket.isAlive = true; });

    socket.on('message', (raw) => {
      // El cupo se cobra antes de parsear: el coste de JSON.parse es justo lo
      // que un cliente abusivo intentaría multiplicar.
      const verdict = socket.limiter.check(Date.now(), Boolean(socket.playerId));
      if (!verdict.allowed) {
        if (verdict.warn) {
          this._send(socket, {
            type: 'error',
            code: 'RATE_LIMITED',
            message: 'Demasiados mensajes; reduce el ritmo',
          });
        }
        // 1008 = violación de política. Cerrar en lugar de responder a cada
        // mensaje evita convertir el aviso en un amplificador de tráfico.
        if (verdict.kick) socket.close(1008, 'rate limit');
        return;
      }

      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return this._send(socket, { type: 'error', code: 'BAD_JSON', message: 'Mensaje ilegible' });
      }
      // Encadenado tras la promesa del mensaje anterior del MISMO socket: sin
      // esto, dos mensajes que llegan en la misma lectura TCP (típico: auth
      // seguido al instante de join/create_room) se procesan en paralelo, y el
      // segundo puede ejecutarse antes de que _auth() resuelva y fije
      // socket.playerId, disparando UNAUTHORIZED aunque el cliente ya se
      // autenticó. Sockets distintos siguen procesándose en paralelo entre sí.
      socket.msgQueue = (socket.msgQueue ?? Promise.resolve())
        .then(() => this._handle(socket, message))
        .catch((error) => this._sendError(socket, error));
    });

    socket.on('close', () => {
      const playerId = socket.playerId;
      if (!playerId) return;
      const session = this.sessions.get(playerId);
      if (!session || session.socket !== socket) return; // ya reemplazada por reconexión
      session.socket = null;
      session.lastSeenAt = Date.now();
      this._dequeue(playerId);
      const entry = session.tableId ? this.tables.get(session.tableId) : null;
      if (!entry) return;
      const events = entry.table.disconnect(playerId, Date.now());
      if (entry.table.isIdle()) events.push(...entry.table.pause(Date.now()));
      this._dispatch(entry, events);
    });
  }

  async _handle(socket, message) {
    if (message?.type === 'auth') return this._auth(socket, message);
    if (!socket.playerId) {
      throw new OfcError('UNAUTHORIZED', 'Debes autenticarte antes de jugar');
    }
    switch (message?.type) {
      case 'join': return this._join(socket.playerId, message.seats ?? 2);
      case 'create_room': return this._createRoom(socket.playerId, message.seats ?? 2);
      case 'join_room': return this._joinRoom(socket.playerId, message.code);
      case 'practice_bots': return this._practiceBots(socket.playerId, message.seats ?? 2);
      case 'presence': return this._presence(socket.playerId, message.state);
      case 'push_token': return this._registerDevice(socket.playerId, message);
      case 'place': return this._place(socket.playerId, message);
      case 'ready': return this._ready(socket.playerId);
      case 'leave': return this._leave(socket.playerId);
      case 'chat': return this._chat(socket.playerId, message.text);
      default:
        throw new OfcError('UNKNOWN_MESSAGE', `Tipo de mensaje desconocido: ${message?.type}`);
    }
  }

  async _auth(socket, message) {
    const { playerId, name } = await this.verifyToken(message.token);
    const existing = this.sessions.get(playerId);

    if (existing) {
      // Sesión ya existe: o bien es una reconexión legítima (mismo socket tras cierre
      // de red), o bien otro dispositivo/tab está tratando de iniciar sesión con la
      // misma cuenta. Solo permitir si es el mismo socket (reconexión); rechazar cualquier
      // otra cosa con un error explícito en vez de un cierre silencioso que causa reintentos.
      if (existing.socket !== socket) {
        // 60s, no 5s: en móvil, bloquear la pantalla o perder cobertura un
        // momento ya tarda más que eso en reconectar, y con una ventana corta
        // cualquier reconexión normal se confundía con "otro dispositivo",
        // lanzando SESSION_CONFLICT constantemente. 60s cubre el ir-y-volver
        // típico de background/foreground sin dejar de detectar una sesión
        // realmente concurrente (dos pestañas/dispositivos activos a la vez).
        const isLikelyReconnect = socket.readyState === WebSocket.OPEN && Date.now() - existing.lastSeenAt < 60_000;
        if (!isLikelyReconnect) {
          throw new OfcError('SESSION_CONFLICT', 'Tu cuenta está activa en otro dispositivo');
        }
        existing.socket?.close?.();
      }
      existing.socket = socket;
      existing.background = false;
      existing.lastSeenAt = Date.now();
      socket.playerId = playerId;
      this._send(socket, { type: 'authenticated', playerId, name: existing.name });
      const entry = existing.tableId ? this.tables.get(existing.tableId) : null;
      if (entry) this._rejoinSafely(entry, playerId, socket, existing.tableId);
      return;
    }

    socket.playerId = playerId;
    // Tras un reinicio no hay sesión en memoria, pero sí índice de mesa.
    const tableId = this.playerTables.get(playerId) ?? null;
    this.sessions.set(playerId, {
      socket, tableId, name, background: false, lastSeenAt: Date.now(),
    });
    this._send(socket, { type: 'authenticated', playerId, name });

    const entry = tableId ? this.tables.get(tableId) : null;
    if (entry) this._rejoinSafely(entry, playerId, socket, tableId);
  }

  /**
   * `authenticated` ya se ha mandado cuando esto se llama: un fallo aquí no
   * puede tirar la conexión abajo con un error genérico dejando al cliente a
   * medias (logueado pero con un aviso rojo encima). Si la mesa referenciada
   * está en un estado que no se puede reanudar (índice desincronizado tras un
   * reinicio, mesa ya liquidada, etc.), se descarta la referencia y el
   * jugador aterriza en un lobby normal en vez de ver un error.
   */
  _rejoinSafely(entry, playerId, socket, tableId) {
    try {
      this._rejoin(entry, playerId, socket);
    } catch (error) {
      console.error('[ofc] no se pudo reanudar la mesa, se descarta la referencia:', error);
      this.playerTables.delete(playerId);
      const session = this.sessions.get(playerId);
      if (session && session.tableId === tableId) session.tableId = null;
    }
  }

  /** Vuelve a sentar a un jugador: reanuda la mesa si estaba congelada. */
  _rejoin(entry, playerId, socket) {
    const events = [
      ...entry.table.resume(Date.now()),
      ...entry.table.reconnect(playerId),
    ];
    this._dispatch(entry, events);
    this._send(socket, {
      type: 'state',
      state: entry.table.getStateFor(playerId),
      serverNow: Date.now(),
    });
  }

  /* ── emparejamiento ── */

  _join(playerId, seats) {
    this._assertSeats(seats);
    const session = this.sessions.get(playerId);
    if (session.tableId) throw new OfcError('ALREADY_SEATED', 'Ya estás en una mesa');

    const queue = this.queues.get(seats);
    if (!queue.includes(playerId)) {
      queue.push(playerId);
      this.queuedAt.set(playerId, Date.now());
    }
    this._send(session.socket, { type: 'queued', seats, waiting: queue.length });

    if (queue.length < seats) return;
    const matched = queue.splice(0, seats);
    for (const id of matched) this.queuedAt.delete(id);
    this._startTable(matched);
  }

  /** Mesa instantánea contra bots: rellena el resto de asientos con Marcos/María. */
  _practiceBots(playerId, seats) {
    this._assertSeats(seats);
    const session = this.sessions.get(playerId);
    if (session.tableId) throw new OfcError('ALREADY_SEATED', 'Ya estás en una mesa');
    this._dequeue(playerId);
    const bots = BOTS.slice(0, seats - 1).map((b) => b.id);
    this._startTable([playerId, ...bots]);
  }

  /**
   * Si alguien lleva esperando rival humano más de botFillMs, se completa la
   * mesa con bots en vez de dejarle esperando indefinidamente. Se usan tantos
   * humanos como haya ya en cola antes de rellenar el resto.
   */
  _fillStaleQueues(now) {
    for (const [seats, queue] of this.queues) {
      if (!queue.length) continue;
      const oldest = this.queuedAt.get(queue[0]);
      if (oldest === undefined || now - oldest < this.botFillMs) continue;
      const humans = queue.splice(0, seats);
      for (const id of humans) this.queuedAt.delete(id);
      const bots = BOTS.slice(0, seats - humans.length).map((b) => b.id);
      this._startTable([...humans, ...bots]);
    }
  }

  /** Crea una sala privada y devuelve su código de 4 caracteres. */
  _createRoom(playerId, seats) {
    this._assertSeats(seats);
    const session = this.sessions.get(playerId);
    if (session.tableId) throw new OfcError('ALREADY_SEATED', 'Ya estás en una mesa');
    this._dequeue(playerId);

    let code;
    do { code = this._newRoomCode(); } while (this.rooms.has(code));
    this.rooms.set(code, { seats, players: [playerId] });
    this._send(session.socket, { type: 'room', code, seats, players: 1 });
  }

  _joinRoom(playerId, code) {
    const normalized = String(code ?? '').trim().toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) throw new OfcError('UNKNOWN_ROOM', 'No existe ninguna sala con ese código');

    const session = this.sessions.get(playerId);
    if (session.tableId) throw new OfcError('ALREADY_SEATED', 'Ya estás en una mesa');
    if (room.players.includes(playerId)) throw new OfcError('ALREADY_IN_ROOM', 'Ya estás en esa sala');
    if (room.players.length >= room.seats) throw new OfcError('ROOM_FULL', 'La sala está completa');

    this._dequeue(playerId);
    room.players.push(playerId);
    for (const id of room.players) {
      this._send(this.sessions.get(id)?.socket, {
        type: 'room', code: normalized, seats: room.seats, players: room.players.length,
      });
    }
    if (room.players.length === room.seats) {
      this.rooms.delete(normalized);
      this._startTable(room.players, normalized);
    }
  }

  _startTable(playerIds, roomCode = null) {
    const table = new Table({
      id: roomCode ?? `mesa-${this.nextTableId++}`,
      players: playerIds.map((id) => ({
        id,
        name: BOT_NAMES.get(id) ?? this.sessions.get(id).name,
      })),
      ...this.tableOptions,
    });
    const entry = { table, showdownAt: null };
    this.tables.set(table.id, entry);
    for (const id of playerIds) {
      if (BOT_NAMES.has(id)) continue; // los bots no tienen sesión que sentar
      this.sessions.get(id).tableId = table.id;
      this.playerTables.set(id, table.id);
    }
    this._dispatch(entry, table.startHand(Date.now()));
    return entry;
  }

  _assertSeats(seats) {
    if (seats !== 2 && seats !== 3) {
      throw new OfcError('INVALID_SEATS', 'Sólo se admiten mesas de 2 o 3');
    }
  }

  /** Sin vocales ni caracteres ambiguos: no se generan palabras ni se confunden 0/O. */
  _newRoomCode() {
    const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  /**
   * El cliente avisa cuando pasa a segundo plano. Es más fiable que deducirlo:
   * en móvil el socket puede seguir vivo un rato con la app minimizada, así que
   * "conectado" no significa "mirando la pantalla".
   */
  _presence(playerId, state) {
    if (state !== 'foreground' && state !== 'background') {
      throw new OfcError('INVALID_PRESENCE', 'Estado de presencia no válido');
    }
    const session = this.sessions.get(playerId);
    if (session) session.background = state === 'background';
  }

  _registerDevice(playerId, { token, platform }) {
    if (typeof token !== 'string' || token.length < 8) {
      throw new OfcError('INVALID_TOKEN', 'Token de dispositivo no válido');
    }
    if (!this.onDeviceToken) return;
    Promise.resolve(this.onDeviceToken({
      playerId,
      token,
      platform: platform === 'ios' ? 'ios' : 'android',
    })).catch((error) => console.error('[ofc] no se pudo registrar el dispositivo:', error.message));
  }

  _place(playerId, message) {
    const entry = this._tableOf(playerId);
    const events = entry.table.place(playerId, {
      placements: message.placements,
      discards: message.discards,
    }, Date.now());
    this._dispatch(entry, events);
  }

  _ready(playerId) {
    const entry = this._tableOf(playerId);
    if (entry.table.phase !== PHASE.SHOWDOWN) return;
    this._dispatch(entry, entry.table.nextHand(Date.now()));
    entry.showdownAt = null;
  }

  _leave(playerId) {
    const session = this.sessions.get(playerId);
    this._dequeue(playerId);
    if (!session?.tableId) return;

    const tableId = session.tableId;
    const entry = this.tables.get(tableId);
    session.tableId = null;
    this.playerTables.delete(playerId);
    if (!entry) return;

    this._dispatch(entry, entry.table.disconnect(playerId, Date.now()));
    const abandoned = entry.table.players.every((p) => this.playerTables.get(p.id) !== tableId);
    if (abandoned) this._closeTable(tableId, entry);
    else if (entry.table.isIdle()) this._dispatch(entry, entry.table.pause(Date.now()));
  }

  _chat(playerId, text) {
    if (!CHAT_PHRASES.has(text)) throw new OfcError('BAD_REQUEST', 'Mensaje no permitido');
    const entry = this._tableOf(playerId);
    for (const player of entry.table.players) {
      const socket = this.sessions.get(player.id)?.socket;
      if (socket) this._send(socket, { type: 'chat', playerId, text });
    }
  }

  _dequeue(playerId) {
    for (const queue of this.queues.values()) {
      const index = queue.indexOf(playerId);
      if (index >= 0) queue.splice(index, 1);
    }
    this.queuedAt.delete(playerId);
    for (const [code, room] of this.rooms) {
      const index = room.players.indexOf(playerId);
      if (index < 0) continue;
      room.players.splice(index, 1);
      if (room.players.length === 0) { this.rooms.delete(code); continue; }
      for (const id of room.players) {
        this._send(this.sessions.get(id)?.socket, {
          type: 'room', code, seats: room.seats, players: room.players.length,
        });
      }
    }
  }

  _tableOf(playerId) {
    const session = this.sessions.get(playerId);
    const entry = session?.tableId ? this.tables.get(session.tableId) : null;
    if (!entry) throw new OfcError('NOT_SEATED', 'No estás sentado en ninguna mesa');
    return entry;
  }

  /* ── reloj y difusión ── */

  _tickAll(now) {
    this._fillStaleQueues(now);
    for (const entry of this.tables.values()) {
      if (entry.table.pausedAt !== null) continue; // mesa congelada: nadie mirando
      const events = entry.table.tick(now);
      if (events.length) this._dispatch(entry, events);

      if (entry.table.phase === PHASE.SHOWDOWN) {
        entry.showdownAt ??= now;
        if (now - entry.showdownAt >= this.showdownMs) {
          entry.showdownAt = null;
          const everyone = entry.table.players.every((p) => p.connected);
          // Sin todos delante no se reparte otra mano: se congela y espera.
          this._dispatch(entry, everyone ? entry.table.nextHand(now) : entry.table.pause(now));
        }
      }
    }
  }

  /** Cierra y olvida la mesa. Sólo cuando ya no queda nadie sentado. */
  _closeTable(tableId, entry) {
    for (const p of entry.table.players) {
      const session = this.sessions.get(p.id);
      if (session?.tableId === tableId) session.tableId = null;
      this.playerTables.delete(p.id);
    }
    this.tables.delete(tableId);
    this.store.deleteTable(tableId).catch((error) => {
      console.error('[ofc] no se pudo borrar la instantánea:', error.message);
    });
  }

  /**
   * Barrido de mesas y sesiones abandonadas.
   *
   * `this.tables` sólo se vacía cuando todos los ocupantes hacen `leave`, y una
   * mesa congelada que nadie reclama no lo hace nunca: el TTL de Redis caduca la
   * instantánea, pero el objeto en el proceso se queda. Lo mismo con las
   * sesiones sin socket ni asiento. Ambos crecen sin techo.
   *
   * Se descartó desalojar mesas de memoria antes del TTL rehidratándolas desde
   * Redis bajo demanda: obliga a que cada acceso a `this.tables` pase a ser
   * asíncrono y abre una carrera si dos sockets del mismo jugador rehidratan a
   * la vez. Con un solo proceso y mesas de 2-3 jugadores, el techo de memoria
   * real no lo justifica.
   *
   * @param {number} [now]
   * @returns {{tables:number, sessions:number}} elementos retirados
   */
  purgeTables(now = Date.now()) {
    let tables = 0;
    for (const [tableId, entry] of this.tables) {
      // Sólo se toca lo congelado: una mesa en juego tiene a alguien delante.
      if (entry.table.pausedAt === null) continue;
      if (now - entry.table.pausedAt < this.tableTtlMs) continue;
      // Doble comprobación: un socket vivo apuntando a la mesa la salva aunque
      // el reloj diga lo contrario.
      const live = entry.table.players.some((p) => this.sessions.get(p.id)?.socket);
      if (live) continue;
      this._closeTable(tableId, entry);
      tables += 1;
    }

    let sessions = 0;
    for (const [playerId, session] of this.sessions) {
      if (session.socket || session.tableId) continue;
      if (now - (session.lastSeenAt ?? 0) < this.tableTtlMs) continue;
      this.sessions.delete(playerId);
      sessions += 1;
    }

    if (tables || sessions) {
      console.log(`[ofc] purga: ${tables} mesas, ${sessions} sesiones`);
    }
    return { tables, sessions };
  }

  _pingIdle() {
    if (!this.wss) return;
    for (const socket of this.wss.clients) {
      if (socket.isAlive === false) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }

  /** Reenvía eventos y el estado redactado a cada ocupante de la mesa. */
  _dispatch(entry, events) {
    const serverNow = Date.now();

    // El historial se persiste fuera del camino crítico: si falla la escritura
    // la partida continúa, sólo se pierde esa mano en las estadísticas.
    for (const event of events) {
      if (event.type !== 'turn' || BOT_NAMES.has(event.playerId)) continue;
      const session = this.sessions.get(event.playerId);
      // Sólo se avisa a quien no está delante: si la app está abierta ya lo ve.
      if (session?.socket && !session.background) continue;
      Promise.resolve(this.pusher.notifyTurn({
        playerId: event.playerId,
        tableId: entry.table.id,
        secondsLeft: Math.round((event.deadline - serverNow) / 1000),
      })).catch((error) => console.error('[ofc] push falló:', error.message));
    }

    // Las manos de práctica contra bots no cuentan para estadísticas ni ranking.
    const isPractice = entry.table.players.some((p) => BOT_NAMES.has(p.id));
    if (this.onHandEnded && !isPractice) {
      for (const event of events) {
        if (event.type !== 'hand_ended') continue;
        Promise.resolve(this.onHandEnded(entry.table, event.result)).catch((error) => {
          console.error('[ofc] no se pudo guardar la mano:', error.message);
        });
      }
    }

    for (const player of entry.table.players) {
      const socket = this.sessions.get(player.id)?.socket;
      if (!socket) continue;
      for (const event of events) this._send(socket, { type: 'event', event });
      // serverNow permite al cliente corregir el desfase de reloj al pintar la cuenta atrás.
      this._send(socket, { type: 'state', state: entry.table.getStateFor(player.id), serverNow });
    }
    // Persistencia best-effort: si Redis falla se sigue jugando en memoria y se
    // pierde sólo la capacidad de recuperar esa mesa tras un reinicio.
    this.store.saveTable(entry.table.id, entry.table.toJSON(serverNow)).catch((error) => {
      console.error('[ofc] no se pudo guardar la mesa:', error.message);
    });
  }

  _send(socket, payload) {
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  _sendError(socket, error) {
    const isDomain = error instanceof OfcError;
    if (!isDomain) console.error('[ofc] error inesperado:', error);
    this._send(socket, {
      type: 'error',
      code: isDomain ? error.code : 'INTERNAL',
      message: isDomain ? error.message : 'Error interno del servidor',
    });
  }
}
