/**
 * Cliente WebSocket del juego. Reconecta con backoff exponencial y reenvía el
 * token en cuanto vuelve la conexión: el servidor conserva el asiento durante
 * el margen de gracia, así que una reconexión rápida devuelve la mano intacta.
 */

const BASE_DELAY = 500;
const MAX_DELAY = 8000;

export class GameSocket {
  /**
   * @param {string} url  p.ej. ws://localhost:8080
   * @param {{onMessage:(msg:object)=>void, onStatus:(status:string)=>void}} handlers
   */
  constructor(url, { onMessage, onStatus }) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.token = null;
    this.socket = null;
    this.attempts = 0;
    this.closedByUs = false;
    this.retryTimer = null;
    this.pending = [];
  }

  connect(token) {
    this.token = token;
    this.closedByUs = false;
    this._open();
  }

  _open() {
    clearTimeout(this.retryTimer);
    this.onStatus(this.attempts ? 'reconnecting' : 'connecting');

    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      return this._scheduleRetry();
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempts = 0;
      this.onStatus('online');
      socket.send(JSON.stringify({ type: 'auth', token: this.token }));
      for (const message of this.pending.splice(0)) socket.send(JSON.stringify(message));
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return; // mensaje ilegible: se descarta en vez de romper la sesión
      }
      this.onMessage(message);
    });

    socket.addEventListener('close', () => {
      if (this.closedByUs) return this.onStatus('offline');
      this._scheduleRetry();
    });

    // 'error' siempre viene seguido de 'close': basta con no dejarlo sin manejar.
    socket.addEventListener('error', () => {});
  }

  _scheduleRetry() {
    this.onStatus('reconnecting');
    const delay = Math.min(BASE_DELAY * 2 ** this.attempts, MAX_DELAY);
    this.attempts++;
    this.retryTimer = setTimeout(() => this._open(), delay);
  }

  /** Reconexión inmediata, sin esperar al backoff. La usa el regreso a primer plano. */
  reconnectNow() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.closedByUs || !this.token) return;
    clearTimeout(this.retryTimer);
    this.attempts = 0;
    this._open();
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.pending.push(message); // se reenvía al recuperar la conexión
    }
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.retryTimer);
    this.socket?.close();
  }
}
