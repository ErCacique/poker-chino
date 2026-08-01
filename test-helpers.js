/**
 * Utilidades comunes a las pruebas de integración: un cliente WebSocket con
 * espera por predicado y el arranque del servidor en un puerto libre.
 */

import WebSocket from 'ws';
import { GameServer } from './ws-server.js';

export function connect(port) {
  const socket = new WebSocket(`ws://localhost:${port}`);
  const inbox = [];
  const waiters = [];

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    inbox.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(message)) {
        waiters[i].resolve(message);
        waiters.splice(i, 1);
      }
    }
  });

  return {
    socket,
    inbox,
    open: new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    send: (payload) => socket.send(JSON.stringify(payload)),
    /** Espera un mensaje que cumpla el predicado, mirando también los ya recibidos. */
    wait(match, timeoutMs = 3000) {
      const found = inbox.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timeout esperando mensaje. Recibidos: ${inbox.map((m) => m.type).join(', ')}`)),
          timeoutMs,
        );
        waiters.push({ match, resolve: (message) => { clearTimeout(timer); resolve(message); } });
      });
    },
    lastState() {
      return [...inbox].reverse().find((m) => m.type === 'state')?.state ?? null;
    },
    close: () => new Promise((resolve) => { socket.once('close', resolve); socket.close(); }),
  };
}

export async function startServer(options = {}) {
  const server = new GameServer({ turnMs: 60_000, showdownMs: 60_000, tickMs: 50, ...options });
  await server.restore();
  const wss = server.listen(0);
  await new Promise((resolve) => wss.once('listening', resolve));
  return { server, port: wss.address().port };
}
