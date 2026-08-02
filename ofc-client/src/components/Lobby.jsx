import { useEffect, useState } from 'react';
import { fetchStats } from '../lib/auth.js';

/** Resumen de puntos/mano y rango mostrado en el hero de la lobby. */
function HeroStats({ session }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!session?.token) return;
    let cancelled = false;
    fetchStats(session.token).then((data) => !cancelled && setStats(data)).catch(() => {});
    return () => { cancelled = true; };
  }, [session?.token]);

  const ppm = stats?.hands ? stats.pointsPerHand : null;

  return (
    <div className="hero__row">
      <div className="hero__stat">
        <b>{stats?.hands ?? '–'}</b>
        <span>Manos</span>
      </div>
      <div className="hero__stat">
        <b>{ppm != null ? (ppm > 0 ? `+${ppm}` : ppm) : '–'}</b>
        <span>Puntos/mano</span>
      </div>
      <div className="hero__stat">
        <b>{stats?.fantasylandPct != null ? `${stats.fantasylandPct}%` : '–'}</b>
        <span>Fantasyland</span>
      </div>
    </div>
  );
}

export function Lobby({ game, name, onChangeName, nameEditable = true, session }) {
  const { lobby, joinQueue, createRoom, joinRoom, practiceBots, leave } = game;
  const [seats, setSeats] = useState(2);
  const [code, setCode] = useState('');
  const [showMore, setShowMore] = useState(false);

  if (lobby?.kind === 'queued') {
    return (
      <section className="panel panel--waiting">
        <h2>Buscando rivales</h2>
        <p>Mesa de {lobby.seats}. En cola: {lobby.waiting}.</p>
        <p className="board-note">Si no aparece nadie en 30s, se completa con bots.</p>
        <div className="pulse" aria-hidden="true"><span /><span /><span /></div>
        <button type="button" className="btn btn--ghost" onClick={leave}>Cancelar</button>
      </section>
    );
  }

  if (lobby?.kind === 'room') {
    const link = `${window.location.origin}${window.location.pathname}?join=${lobby.code}`;
    const share = () => {
      if (navigator.share) navigator.share({ title: 'Pineapple OFC', text: 'Únete a mi mesa', url: link });
      else navigator.clipboard?.writeText(link);
    };
    return (
      <section className="panel panel--waiting">
        <h2>Sala creada</h2>
        <p className="code" aria-label={`Código de sala ${lobby.code.split('').join(' ')}`}>{lobby.code}</p>
        <p>Pásalo a quien quieras. Dentro: {lobby.players} de {lobby.seats}.</p>
        <button type="button" className="btn btn--primary" onClick={share}>
          {navigator.share ? 'Compartir enlace' : 'Copiar enlace'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={leave}>Cerrar sala</button>
      </section>
    );
  }

  return (
    <section className="lobby-home">
      <div className="hero">
        {session && <HeroStats session={session} />}
        <div className="field hero__seats">
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
        <button type="button" className="btn btn--primary hero__cta" onClick={() => joinQueue(seats)}>
          Jugar
        </button>
      </div>

      <div className="secondary-row">
        <button type="button" className="sbtn" onClick={() => practiceBots(seats)}>
          Vs. bots
        </button>
        <button type="button" className="sbtn" onClick={() => createRoom(seats)}>
          Sala privada
        </button>
        <button type="button" className="sbtn" onClick={() => setShowMore((v) => !v)}>
          Unirme
        </button>
      </div>
      <p className="board-note" style={{ margin: 0, textAlign: 'center' }}>
        Vs. bots: {seats === 2 ? 'contra Marcos.' : 'contra Marcos y María.'} No cuenta para tus estadísticas.
      </p>

      {showMore && (
        <div className="panel">
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
                Es tu nombre de usuario. Se cambia desde tu perfil.
              </span>
            )}
          </label>
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
        </div>
      )}
    </section>
  );
}
