/**
 * Prueba de integración del transporte. Levanta el servidor en un puerto libre
 * y conecta clientes WebSocket reales. Ejecutar: node --test ws-server.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, startServer } from './test-helpers.js';

test('emparejamiento, jugada válida, error de turno y reconexión', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const ana = connect(port);
  const bruno = connect(port);
  await Promise.all([ana.open, bruno.open]);

  ana.send({ type: 'auth', token: 'dev:a:Ana' });
  bruno.send({ type: 'auth', token: 'dev:b:Bruno' });
  await ana.wait((m) => m.type === 'authenticated');
  await bruno.wait((m) => m.type === 'authenticated');

  ana.send({ type: 'join', seats: 2 });
  await ana.wait((m) => m.type === 'queued');
  bruno.send({ type: 'join', seats: 2 });

  await ana.wait((m) => m.type === 'state');
  await bruno.wait((m) => m.type === 'state');

  const state = ana.lastState();
  assert.equal(state.phase, 'placing');
  assert.equal(state.players.length, 2);
  assert.equal(state.activePlayerId, 'a', 'actúa primero quien ocupa el asiento 0');

  // El rival no ve la mano de nadie más.
  const brunoView = bruno.lastState();
  assert.equal(brunoView.players.find((p) => p.id === 'a').hand, undefined);

  // Jugada fuera de turno.
  bruno.send({ type: 'place', placements: [], discards: [] });
  const error = await bruno.wait((m) => m.type === 'error');
  assert.equal(error.code, 'NOT_YOUR_TURN');

  // Jugada válida de la calle inicial: 5 cartas, 0 descartes.
  const hand = state.players.find((p) => p.id === 'a').hand;
  assert.equal(hand.length, 5);
  ana.send({
    type: 'place',
    placements: [
      { card: hand[0], row: 'bottom' }, { card: hand[1], row: 'bottom' },
      { card: hand[2], row: 'middle' }, { card: hand[3], row: 'middle' },
      { card: hand[4], row: 'top' },
    ],
    discards: [],
  });

  const turnEvent = await bruno.wait((m) => m.type === 'event' && m.event.type === 'turn' && m.event.playerId === 'b');
  assert.ok(turnEvent.event.deadline > Date.now());
  assert.equal(bruno.lastState().activePlayerId, 'b');
  assert.equal(bruno.lastState().players.find((p) => p.id === 'a').board.bottom.length, 2);

  // Reconexión: se cierra el socket y se vuelve con el mismo token.
  await ana.close();
  const anaAgain = connect(port);
  await anaAgain.open;
  anaAgain.send({ type: 'auth', token: 'dev:a:Ana' });
  const restored = await anaAgain.wait((m) => m.type === 'state');
  assert.equal(restored.state.tableId, state.tableId, 'conserva la mesa');
  assert.equal(restored.state.players.find((p) => p.id === 'a').connected, true);
  assert.equal(restored.state.players.find((p) => p.id === 'a').board.bottom.length, 2,
    'el tablero sigue donde estaba');

  await Promise.all([anaAgain.close(), bruno.close()]);
});

test('reautenticar desde un socket nuevo sin cerrar el anterior no revienta el servidor', async (t) => {
  // Regresión: esta rama comparaba socket.readyState con WebSocket.OPEN sin
  // haber importado WebSocket desde 'ws' (sólo se importaba WebSocketServer).
  // En local, si el motor de Node expone un WebSocket global (Node >=21), el
  // identificador suelto resuelve ahí por casualidad y todo parece funcionar;
  // en Railway (Node 18, sin ese global) explotaba con "WebSocket is not
  // defined" justo al reconectar — que es exactamente lo que pasa aquí, sin
  // cerrar el socket viejo primero.
  const { server, port } = await startServer();
  t.after(() => server.close());

  const first = connect(port);
  await first.open;
  first.send({ type: 'auth', token: 'dev:a:Ana' });
  await first.wait((m) => m.type === 'authenticated');

  // Mismo token, socket nuevo, el viejo sigue abierto: dispara la rama
  // existing.socket !== socket dentro de la ventana de gracia de reconexión.
  const second = connect(port);
  await second.open;
  second.send({ type: 'auth', token: 'dev:a:Ana' });
  const response = await second.wait((m) => m.type === 'authenticated' || m.type === 'error');
  assert.equal(response.type, 'authenticated', 'la reconexión rápida no debe fallar con INTERNAL');

  await second.close();
});

test('rechaza mensajes sin autenticar y tokens inválidos', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const client = connect(port);
  await client.open;

  client.send({ type: 'join', seats: 2 });
  const unauth = await client.wait((m) => m.type === 'error');
  assert.equal(unauth.code, 'UNAUTHORIZED');

  client.send({ type: 'auth', token: 'basura' });
  const badToken = await client.wait((m) => m.type === 'error' && m.message.includes('Token'));
  assert.equal(badToken.code, 'UNAUTHORIZED');

  await client.close();
});

test('la desconexión sin reconectar acaba en abandono tras el margen', async (t) => {
  const { server, port } = await startServer({ graceMs: 200, turnMs: 60_000 });
  t.after(() => server.close());

  const ana = connect(port);
  const bruno = connect(port);
  await Promise.all([ana.open, bruno.open]);
  ana.send({ type: 'auth', token: 'dev:a:Ana' });
  bruno.send({ type: 'auth', token: 'dev:b:Bruno' });
  await ana.wait((m) => m.type === 'authenticated');
  await bruno.wait((m) => m.type === 'authenticated');
  ana.send({ type: 'join', seats: 2 });
  bruno.send({ type: 'join', seats: 2 });
  await ana.wait((m) => m.type === 'state');

  await bruno.close();
  const forfeit = await ana.wait(
    (m) => m.type === 'event' && m.event.type === 'forfeited' && m.event.playerId === 'b',
    5000,
  );
  assert.equal(forfeit.event.playerId, 'b');

  await ana.close();
});

test('salas privadas: el código sienta a los dos jugadores en la misma mesa', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const ana = connect(port);
  const bruno = connect(port);
  await Promise.all([ana.open, bruno.open]);
  ana.send({ type: 'auth', token: 'dev:a:Ana' });
  bruno.send({ type: 'auth', token: 'dev:b:Bruno' });
  await ana.wait((m) => m.type === 'authenticated');
  await bruno.wait((m) => m.type === 'authenticated');

  ana.send({ type: 'create_room', seats: 2 });
  const room = await ana.wait((m) => m.type === 'room');
  assert.match(room.code, /^[BCDFGHJKLMNPQRSTVWXYZ23456789]{4}$/);
  assert.equal(room.players, 1);

  bruno.send({ type: 'join_room', code: room.code.toLowerCase() });
  await ana.wait((m) => m.type === 'state');
  const state = bruno.lastState() ?? (await bruno.wait((m) => m.type === 'state')).state;
  assert.equal(state.tableId, room.code, 'la mesa toma el código de la sala');
  assert.equal(state.players.length, 2);

  await Promise.all([ana.close(), bruno.close()]);
});

test('un código inexistente devuelve error sin sentar a nadie', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const client = connect(port);
  await client.open;
  client.send({ type: 'auth', token: 'dev:z:Zoe' });
  await client.wait((m) => m.type === 'authenticated');

  client.send({ type: 'join_room', code: 'XXXX' });
  const error = await client.wait((m) => m.type === 'error');
  assert.equal(error.code, 'UNKNOWN_ROOM');

  await client.close();
});

test('practicar contra bots: mesa instantánea y el bot resuelve su turno solo', async (t) => {
  const { server, port } = await startServer({ turnMs: 200 });
  t.after(() => server.close());

  const ana = connect(port);
  await ana.open;
  ana.send({ type: 'auth', token: 'dev:a:Ana' });
  await ana.wait((m) => m.type === 'authenticated');

  ana.send({ type: 'practice_bots', seats: 2 });
  const state = (await ana.wait((m) => m.type === 'state')).state;

  assert.equal(state.players.length, 2);
  const bot = state.players.find((p) => p.id !== 'a');
  assert.equal(bot.id, 'bot:marcos');
  assert.equal(bot.name, 'Marcos');
  assert.equal(state.activePlayerId, 'a', 'la humana ocupa el asiento 0 y actúa primero');

  const hand = state.players.find((p) => p.id === 'a').hand;
  ana.send({
    type: 'place',
    placements: [
      { card: hand[0], row: 'bottom' }, { card: hand[1], row: 'bottom' },
      { card: hand[2], row: 'middle' }, { card: hand[3], row: 'middle' },
      { card: hand[4], row: 'top' },
    ],
    discards: [],
  });

  // El turno pasa al bot; nadie manda 'place' en su nombre, y el reloj de la
  // mesa (el mismo que resuelve a un humano que se queda sin tiempo) lo hace.
  const turnToBot = await ana.wait(
    (m) => m.type === 'event' && m.event.type === 'turn' && m.event.playerId === 'bot:marcos',
  );
  assert.ok(turnToBot.event.deadline > Date.now());

  // Ojo: no basta con esperar activePlayerId === 'a', porque ese mismo valor
  // ya aparece en el primer 'state' (reparto inicial) que sigue en el buzón;
  // se comprueba directamente que el tablero del bot dejó de estar vacío. No
  // se asume ninguna distribución concreta entre filas: autoPlace() elige la
  // suya, no necesariamente la misma que la jugada manual de Ana.
  await ana.wait((m) => {
    if (m.type !== 'state') return false;
    const botBoard = m.state.players.find((p) => p.id === 'bot:marcos')?.board;
    return botBoard && (botBoard.top.length + botBoard.middle.length + botBoard.bottom.length) > 0;
  }, 4000);

  await ana.close();
});

test('la cola normal se completa con bots si no aparece rival humano a tiempo', async (t) => {
  const { server, port } = await startServer({ botFillMs: 100 });
  t.after(() => server.close());

  const ana = connect(port);
  await ana.open;
  ana.send({ type: 'auth', token: 'dev:a:Ana' });
  await ana.wait((m) => m.type === 'authenticated');

  ana.send({ type: 'join', seats: 2 });
  await ana.wait((m) => m.type === 'queued');

  const state = (await ana.wait((m) => m.type === 'state', 2000)).state;
  const opponent = state.players.find((p) => p.id !== 'a');
  assert.equal(opponent.id, 'bot:marcos', 'sin rival humano, la cola se rellena con un bot');

  await ana.close();
});

test('las manos contra bots no se guardan para estadísticas', async (t) => {
  let handEndedCalls = 0;
  const { server, port } = await startServer({
    turnMs: 200,
    onHandEnded: () => { handEndedCalls += 1; },
  });
  t.after(() => server.close());

  const ana = connect(port);
  await ana.open;
  ana.send({ type: 'auth', token: 'dev:a:Ana' });
  await ana.wait((m) => m.type === 'authenticated');

  ana.send({ type: 'practice_bots', seats: 2 });
  await ana.wait((m) => m.type === 'state');

  // Sin mandar ninguna jugada, el reloj resuelve las cinco calles de ambos
  // jugadores por autoPlace hasta el showdown: confirma que hand_ended
  // realmente se dispara y, aun así, no llega a onHandEnded.
  await ana.wait((m) => m.type === 'event' && m.event.type === 'hand_ended', 10_000);
  assert.equal(handEndedCalls, 0, 'una mano de práctica no debe persistirse');

  await ana.close();
});
