import { useState } from 'react';

export function Lobby({ game, name, onChangeName, nameEditable = true }) {
  const { lobby, joinQueue, createRoom, joinRoom, leave } = game;
  const [seats, setSeats] = useState(2);
  const [code, setCode] = useState('');

  if (lobby?.kind === 'queued') {
    return (
      <section className="panel panel--waiting">
        <h2>Buscando rivales</h2>
        <p>Mesa de {lobby.seats}. En cola: {lobby.waiting}.</p>
        <div className="pulse" aria-hidden="true"><span /><span /><span /></div>
        <button type="button" className="btn btn--ghost" onClick={leave}>Cancelar</button>
      </section>
    );
  }

  if (lobby?.kind === 'room') {
    return (
      <section className="panel panel--waiting">
        <h2>Sala creada</h2>
        <p className="code" aria-label={`Código de sala ${lobby.code.split('').join(' ')}`}>{lobby.code}</p>
        <p>Pásalo a quien quieras. Dentro: {lobby.players} de {lobby.seats}.</p>
        <button type="button" className="btn btn--ghost" onClick={leave}>Cerrar sala</button>
      </section>
    );
  }

  return (
    <section className="panel">
      <label className="field">
        <span>Tu nombre en la mesa</span>
        {nameEditable ? (
          <input
            value={name}
            maxLength={16}
            onChange={(event) => onChangeName(event.target.value)}
            placeholder="Ana"
          />
        ) : (
          <input value={name} readOnly disabled />
        )}
        {!nameEditable && (
          <span className="board-note" style={{ margin: '2px 0 0', textAlign: 'left' }}>
            Es tu nombre de usuario. Se cambia desde tu perfil (arriba a la derecha).
          </span>
        )}
      </label>

      <div className="field">
        <span>Jugadores</span>
        <div className="seg">
          {[2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className={`seg__item ${seats === n ? 'is-on' : ''}`}
              onClick={() => setSeats(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="btn btn--primary" onClick={() => joinQueue(seats)}>
        Buscar partida
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => createRoom(seats)}>
        Crear sala privada
      </button>

      <div className="join-code">
        <input
          value={code}
          maxLength={4}
          placeholder="Código"
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        <button
          type="button"
          className="btn btn--ghost"
          disabled={code.length !== 4}
          onClick={() => joinRoom(code)}
        >
          Entrar
        </button>
      </div>
    </section>
  );
}
