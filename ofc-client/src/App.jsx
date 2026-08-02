import { useCallback, useEffect, useState } from 'react';
import { useOfcGame } from './hooks/useOfcGame.js';
import { Lobby } from './components/Lobby.jsx';
import { TableView } from './components/Table.jsx';
import { SignIn } from './components/SignIn.jsx';
import { ChooseUsername } from './components/ChooseUsername.jsx';
import { Tutorial, shouldShowTutorial } from './components/Tutorial.jsx';
import { Leaderboard } from './components/Leaderboard.jsx';
import { Avatar } from './components/Avatar.jsx';
import { ProfileMenu } from './components/ProfileMenu.jsx';
import { BottomNav } from './components/BottomNav.jsx';
import { useNativeBridge } from './hooks/useNativeBridge.js';
import { useCheckUpdates } from './hooks/useCheckUpdates.js';
import { UpdateNotification } from './components/UpdateNotification.jsx';
import { GOOGLE_CLIENT_ID, loadSession, saveSession, clearSession } from './lib/auth.js';
import { loadSettings, applyTheme, applyDeck } from './lib/settings.js';

{
  const boot = loadSettings();
  applyTheme(boot.theme);
  applyDeck(boot.deck);
}

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

function Header({ status, name, session, onOpenProfile }) {
  return (
    <header className="app__head">
      <h1 className="brand">
        <svg className="brand__crest" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path d="M24 6c-6 4-9 9-9 15a9 9 0 0 0 18 0c0-6-3-11-9-15z" stroke="currentColor" strokeWidth="2" />
          <path d="M24 30v9" stroke="currentColor" strokeWidth="2" />
          <path d="M18 41c2-2.5 4-3.6 6-3.6s4 1.1 6 3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M19 6c1-2.8 3-3.8 5-3.8s4 1 5 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="brand__word">
          <span className="brand__pine">Pineapple</span>
          <span className="brand__ofc">OFC</span>
        </span>
      </h1>
      {session ? (
        <button type="button" className="menu-trigger" onClick={onOpenProfile}>
          <Avatar
            playerId={session.playerId}
            name={session.name}
            avatarUrl={session.avatarUrl}
            avatarKind={session.avatarKind}
            size={28}
          />
          <span className="app__name">{name}</span>
        </button>
      ) : (
        name && <span className="app__name">{name}</span>
      )}
      <span className={`status status--${status}`}>{STATUS_LABEL[status] ?? status}</span>
    </header>
  );
}

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [devIdentity, setDevIdentity] = useState(loadDevIdentity);
  const usesGoogle = Boolean(GOOGLE_CLIENT_ID);
  const { updateAvailable, isInstalling, installError, installUpdate } = useCheckUpdates();

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

  // Enlace de invitación: ?join=CODE entra directo a la sala en cuanto hay
  // conexión, sin que el usuario tenga que teclear el código.
  useEffect(() => {
    if (!game.joinRoom || game.status !== 'online' || game.table || game.lobby) return;
    const code = new URLSearchParams(window.location.search).get('join');
    if (!code) return;
    game.joinRoom(code);
    const url = new URL(window.location.href);
    url.searchParams.delete('join');
    window.history.replaceState({}, '', url);
  }, [game.status]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('jugar');
  const onTabChange = useCallback((tab) => {
    if (tab === 'perfil') setProfileOpen(true);
    else setActiveTab(tab);
  }, []);
  const [tutorialOpen, setTutorialOpen] = useState(shouldShowTutorial);
  const onSignedIn = useCallback((value) => setSession(value), []);
  const onSessionUpdate = useCallback((value) => {
    setSession((current) => {
      const merged = { ...current, ...value };
      saveSession(merged);
      return merged;
    });
  }, []);
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
        <ChooseUsername session={session} onDone={onSessionUpdate} />
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        status={game.status}
        name={displayName}
        session={usesGoogle ? session : null}
        onOpenProfile={() => setProfileOpen(true)}
      />
      {profileOpen && usesGoogle && (
        <ProfileMenu
          session={session}
          onClose={() => setProfileOpen(false)}
          onSessionUpdate={onSessionUpdate}
        />
      )}
      <UpdateNotification
        update={updateAvailable}
        isInstalling={isInstalling}
        installError={installError}
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

      {tutorialOpen && !game.table && <Tutorial onClose={() => setTutorialOpen(false)} />}

      {game.table ? (
        <TableView game={game} />
      ) : (
        <>
          {activeTab === 'ranking' ? (
            <Leaderboard />
          ) : (
            <Lobby
              game={game}
              name={displayName ?? ''}
              nameEditable={!usesGoogle}
              onChangeName={(value) => setDevIdentity((current) => ({ ...current, name: value }))}
              session={usesGoogle ? session : null}
            />
          )}
          <BottomNav active={profileOpen ? 'perfil' : activeTab} onChange={onTabChange} />
        </>
      )}
    </div>
  );
}
