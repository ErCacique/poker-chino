/**
 * ofc-store.js — Persistencia de partidas en curso.
 *
 * Alcance deliberado: instantánea y rehidratación con un único escritor. Basta
 * para que un despliegue o una caída no corten las partidas. NO habilita varias
 * instancias: sin cerrojo por mesa, dos procesos ejecutando tick() sobre la
 * misma partida se pisarían. Para escalar en horizontal hace falta afinidad por
 * mesa en el balanceador, o añadir cerrojo y pub/sub.
 *
 * El historial terminado va a PostgreSQL, no aquí: esto guarda sólo lo vivo.
 *
 * Node.js >= 18, ESM. RedisStore necesita el paquete `redis` (v4).
 */

/** Almacén volátil. Útil en tests y en desarrollo sin Redis levantado. */
export class MemoryStore {
  constructor() {
    this.tables = new Map();
  }

  async saveTable(id, snapshot) {
    this.tables.set(id, JSON.stringify(snapshot));
  }

  async loadTables() {
    return [...this.tables.values()].map((raw) => JSON.parse(raw));
  }

  async deleteTable(id) {
    this.tables.delete(id);
  }

  async connect() { return this; }
  async close() {}
}

export class RedisStore {
  /**
   * @param {object} [options]
   * @param {string} [options.url=redis://localhost:6379]
   * @param {string} [options.prefix=ofc]
   * @param {number} [options.ttlSeconds=604800] caducidad de una partida abandonada (7 días)
   * @param {object} [options.client] cliente node-redis ya creado y conectado
   */
  constructor({ url = process.env.REDIS_URL ?? 'redis://localhost:6379', prefix = 'ofc', ttlSeconds = 604_800, client = null } = {}) {
    this.url = url;
    this.prefix = prefix;
    this.ttlSeconds = ttlSeconds;
    this.client = client;
    this.ownsClient = !client;
  }

  _key(id) {
    return `${this.prefix}:table:${id}`;
  }

  async connect() {
    if (!this.client) {
      const { createClient } = await import('redis');
      // Se abandona tras varios intentos en vez de reintentar en bucle: si Redis
      // está mal configurado conviene enterarse al arrancar, no descubrirlo el
      // día que haya que recuperar una partida.
      this.client = createClient({
        url: this.url,
        socket: {
          reconnectStrategy: (retries) => (retries > 5 ? new Error('Redis inalcanzable') : Math.min(200 * retries, 2000)),
        },
      });
      this.client.on('error', (error) => console.error('[ofc] redis:', error.message));
    }
    if (!this.client.isOpen) await this.client.connect();
    return this;
  }

  async saveTable(id, snapshot) {
    await this.client.set(this._key(id), JSON.stringify(snapshot), { EX: this.ttlSeconds });
  }

  async loadTables() {
    const snapshots = [];
    for await (const key of this.client.scanIterator({ MATCH: `${this.prefix}:table:*`, COUNT: 100 })) {
      const raw = await this.client.get(key);
      if (!raw) continue;
      try {
        snapshots.push(JSON.parse(raw));
      } catch {
        // Una instantánea corrupta no debe impedir arrancar el resto.
        console.error('[ofc] instantánea ilegible, se descarta:', key);
        await this.client.del(key);
      }
    }
    return snapshots;
  }

  async deleteTable(id) {
    await this.client.del(this._key(id));
  }

  async close() {
    if (!this.ownsClient || !this.client) return;
    // Un cliente que nunca llegó a abrir sigue con su temporizador de reintento:
    // quit() no sirve ahí, hay que destruirlo o el proceso no termina.
    if (this.client.isOpen) await this.client.quit();
    else this.client.destroy?.() ?? this.client.disconnect?.();
  }
}
