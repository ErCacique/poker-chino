import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameSocket } from '../lib/socket.js';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080';

/**
 * Sesión completa contra el servidor de juego. El estado de la mesa es siempre
 * el que envía el servidor: aquí no se deduce nada del juego, sólo se guarda lo
 * último recibido y el desfase de reloj para pintar la cuenta atrás.
 */
export function useOfcGame(token) {
  const socketRef = useRef(null);
  const [status, setStatus] = useState('offline');
  const [identity, setIdentity] = useState(null);
  const [table, setTable] = useState(null);
  const [lobby, setLobby] = useState(null); // { kind:'queued'|'room', ... }
  const [error, setError] = useState(null);
  const [log, setLog] = useState([]);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!token) return undefined;

    const socket = new GameSocket(WS_URL, {
      onStatus: setStatus,
      onMessage: (message) => {
        switch (message.type) {
          case 'authenticated':
            setIdentity({ playerId: message.playerId, name: message.name });
            break;
          case 'state':
            if (typeof message.serverNow === 'number') {
              offsetRef.current = message.serverNow - Date.now();
            }
            setTable(message.state);
            setLobby(null);
            setError(null);
            break;
          case 'queued':
            setLobby({ kind: 'queued', seats: message.seats, waiting: message.waiting });
            setError(null);
            break;
          case 'room':
            setLobby({ kind: 'room', code: message.code, seats: message.seats, players: message.players });
            setError(null);
            break;
          case 'event':
            setLog((entries) => [message.event, ...entries].slice(0, 30));
            break;
          case 'error':
            setError({ code: message.code, message: message.message });
            break;
          default:
            break;
        }
      },
    });

    socketRef.current = socket;
    socket.connect(token);
    return () => { socket.close(); socketRef.current = null; };
  }, [token]);

  const send = useCallback((message) => socketRef.current?.send(message), []);
  const reconnect = useCallback(() => socketRef.current?.reconnectNow(), []);
  const setPresence = useCallback((state) => send({ type: 'presence', state }), [send]);
  const registerDevice = useCallback(
    (deviceToken, platform) => send({ type: 'push_token', token: deviceToken, platform }),
    [send],
  );
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const you = useMemo(
    () => table?.players.find((p) => p.id === table.you) ?? null,
    [table],
  );
  const opponents = useMemo(
    () => table?.players.filter((p) => p.id !== table.you) ?? [],
    [table],
  );

  return {
    status,
    identity,
    table,
    you,
    opponents,
    lobby,
    error,
    log,
    serverNow,
    reconnect,
    setPresence,
    registerDevice,
    clearError: () => setError(null),
    joinQueue: (seats) => send({ type: 'join', seats }),
    createRoom: (seats) => send({ type: 'create_room', seats }),
    joinRoom: (code) => send({ type: 'join_room', code }),
    practiceBots: (seats) => send({ type: 'practice_bots', seats }),
    place: (placements, discards) => send({ type: 'place', placements, discards }),
    ready: () => send({ type: 'ready' }),
    leave: () => { send({ type: 'leave' }); setTable(null); setLobby(null); },
  };
}
