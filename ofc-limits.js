/**
 * ofc-limits.js — Control de frecuencia de mensajes por socket.
 *
 * Cubo de fichas (token bucket) puro: el tiempo entra como parámetro, igual que
 * en ofc-table.js, para que las pruebas no dependan de temporizadores reales.
 *
 * Se descartó la ventana deslizante con array de marcas de tiempo: guarda una
 * entrada por mensaje y con muchos sockets abiertos el coste de memoria es
 * proporcional al tráfico. El cubo guarda dos números por socket.
 *
 * Node.js >= 18, ESM. Sin dependencias.
 */

/** Cubo de fichas: se rellena de forma continua, no por ventanas discretas. */
export class TokenBucket {
  /**
   * @param {object} options
   * @param {number} options.capacity  fichas máximas acumulables (ráfaga)
   * @param {number} options.refillPerSec fichas repuestas por segundo (ritmo sostenido)
   * @param {number} options.now marca de tiempo inicial en ms
   */
  constructor({ capacity, refillPerSec, now = Date.now() }) {
    if (!(capacity > 0)) throw new RangeError('capacity debe ser > 0');
    if (!(refillPerSec > 0)) throw new RangeError('refillPerSec debe ser > 0');
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.updatedAt = now;
  }

  /**
   * Consume una ficha si la hay.
   * @param {number} now marca de tiempo en ms
   * @returns {boolean} true si el mensaje pasa, false si debe descartarse
   */
  take(now) {
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Fichas disponibles ahora mismo, sin consumir. Útil en pruebas y métricas. */
  peek(now) {
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;
    return Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
  }
}

/** @typedef {{allowed:boolean, warn:boolean, kick:boolean}} LimitVerdict */

/**
 * Límite por socket con dos regímenes: antes y después de autenticarse.
 *
 * Un socket sin autenticar es anónimo y barato de abrir, así que su cupo es
 * mucho más estrecho: sólo necesita mandar un `auth`. Una vez identificado el
 * jugador, el cupo se abre a lo que exige el juego (colocar, presencia, ready).
 */
export class SocketLimiter {
  /**
   * @param {object} [options]
   * @param {number} [options.capacity=20] ráfaga permitida una vez autenticado
   * @param {number} [options.refillPerSec=10] ritmo sostenido autenticado
   * @param {number} [options.anonCapacity=5] ráfaga antes de autenticarse
   * @param {number} [options.anonRefillPerSec=0.5] ritmo sostenido anónimo
   * @param {number} [options.maxStrikes=20] descartes tolerados antes de cerrar
   * @param {number} [options.warnEveryMs=1000] espaciado mínimo entre avisos
   * @param {number} [options.now]
   */
  constructor({
    capacity = 20,
    refillPerSec = 10,
    anonCapacity = 5,
    anonRefillPerSec = 0.5,
    maxStrikes = 20,
    warnEveryMs = 1_000,
    now = Date.now(),
  } = {}) {
    this.anon = new TokenBucket({ capacity: anonCapacity, refillPerSec: anonRefillPerSec, now });
    this.auth = new TokenBucket({ capacity, refillPerSec, now });
    this.maxStrikes = maxStrikes;
    this.warnEveryMs = warnEveryMs;
    this.strikes = 0;
    this.lastWarnAt = -Infinity;
  }

  /**
   * @param {number} now
   * @param {boolean} authenticated
   * @returns {LimitVerdict} allowed: procesar; warn: enviar aviso; kick: cerrar
   */
  check(now, authenticated) {
    // El cubo anónimo se sigue consumiendo tras autenticarse para que un socket
    // no pueda gastar su cupo estrecho, autenticarse y volver a empezar de cero.
    const bucket = authenticated ? this.auth : this.anon;
    if (bucket.take(now)) return { allowed: true, warn: false, kick: false };

    this.strikes += 1;
    const kick = this.strikes >= this.maxStrikes;
    const warn = !kick && now - this.lastWarnAt >= this.warnEveryMs;
    if (warn) this.lastWarnAt = now;
    return { allowed: false, warn, kick };
  }
}
