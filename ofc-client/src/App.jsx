import { useCallback, useEffect, useState } from 'react';
import { useOfcGame } from './hooks/useOfcGame.js';
import { Lobby } from './components/Lobby.jsx';
import { TableView } from './components/Table.jsx';
import { SignIn } from './components/SignIn.jsx';
import { ChooseUsername } from './components/ChooseUsername.jsx';
import { Leaderboard } from './components/Leaderboard.jsx';
import { useNativeBridge } from './hooks/useNativeBridge.js';
import { useCheckUpdates } from './hooks/useCheckUpdates.js';
import { UpdateNotification } from './components/UpdateNotification.jsx';
import { GOOGLE_CLIENT_ID, loadSession, saveSession, clearSession } from './lib/auth.js';

const STATUS_LABEL = {
  connecting: 'Conectando',
  online: 'En línea',
  reconnecting: 'Reconectando',
  offline: 'Desconectado',
};

/**
 * Identidad local para desarrollo. Sólo se usa cuando no hay cliente de Google
 * configurado; el servidor la rechaza salvo que arranque con ALLOW_DEV_TOKENS.
 */
function loadDevIdentity() {
  // sessionStorage, no localStorage: aislado por pestaña para poder probar
  // varios jugadores dev: a la vez en el mismo navegador.
  const stored = sessionStorage.getItem('ofc.identity');
  if (stored) return JSON.parse(stored);
  return { id: `p${Math.random().toString(36).slice(2, 8)}`, name: 'Invitado' };
}

function Header({ status, name }) {
  return (
    <header className="app__head">
      <h1 className="brand">
        Pineapple<span className="brand__mark">OFC</span>
      </h1>
      {name && <span className="app__name">{name}</span>}
      <span className={`status status--${status}`}>{STATUS_LABEL[status] ?? status}</span>
    </header>
  );
}

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [devIdentity, setDevIdentity] = useState(loadDevIdentity);
  const usesGoogle = Boolean(GOOGLE_CLIENT_ID);
  const { updateAvailable, isInstalling, installUpdate } = useCheckUpdates();

  useEffect(() => {
    if (!usesGoogle) sessionStorage.setItem('ofc.identity', JSON.stringify(devIdentity));
  }, [devIdentity, usesGoogle]);

  // Sin username propio no se conecta al servidor de juego: entrar a una mesa
  // con el nombre de Google todavía puesto dejaría a otros jugadores viéndolo
  // antes de que el jugador confirme el que realmente quiere usar.
  const needsUsername = usesGoogle && session && !session.usernameSet;
  const token = usesGoogle
    ? (session && !needsUsername ? session.token ?? null : null)
    : `dev:${devIdentity.id}:${devIdentity.name || devIdentity.id}`;

  const game = useOfcGame(token);
  useNativeBridge(game);
  const onSignedIn = useCallback((value) => setSession(value), []);
  const onUsernameChosen = useCallback((value) => { saveSession(value); setSession(value); }, []);
  const displayName = usesGoogle ? session?.name : devIdentity.name;

  if (usesGoogle && !session) {
    return (
      <div className="app">
        <Header status={game.status} />
        <SignIn onSignedIn={onSignedIn} />
      </div>
    );
  }

  if (needsUsername) {
    return (
      <div className="app">
        <Header status={game.status} />
        <ChooseUsername session={session} onDone={onUsernameChosen} />
      </div>
    );
  }

  return (
    <div className="app">
      <Header status={game.status} name={displayName} />
      <UpdateNotification
        update={updateAvailable}
        isInstalling={isInstalling}
        onInstall={installUpdate}
      />

      {game.error && (
        <p className="alert" role="alert" onClick={game.clearError}>
          {game.error.message}
          {game.error.code === 'UNAUTHORIZED' && usesGoogle && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => { clearSession(); setSession(null); }}
            >
              Volver a entrar
            </button>
          )}
        </p>
      )}

      {game.table ? (
        <TableView game={game} />
      ) : (
        <>
          <Lobby
            game={game}
            name={displayName ?? ''}
            onChangeName={(value) => {
              if (usesGoogle) {
                const updated = { ...session, name: value };
                setSession(updated);
                saveSession(updated);
              } else {
                setDevIdentity((current) => ({ ...current, name: value }));
              }
            }}
          />
          <Leaderboard />
        </>
      )}
    </div>
  );
}
