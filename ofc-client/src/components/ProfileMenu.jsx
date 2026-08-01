import { useEffect, useState } from 'react';
import { Avatar, AVATAR_PRESET_ICONS } from './Avatar.jsx';
import { setUsername, setAvatar, fetchStats } from '../lib/auth.js';
import {
  fetchFriends, sendFriendRequest, respondFriendRequest, removeFriendship,
} from '../lib/friends.js';
import { loadSettings, saveSettings, applyTheme } from '../lib/settings.js';

const TABS = ['Perfil', 'Estadísticas', 'Amigos', 'Ajustes'];

const STAT_LABELS = {
  hands: 'Manos jugadas',
  points: 'Puntos totales',
  pointsPerHand: 'Puntos/mano',
  royaltiesPerHand: 'Royalties/mano',
  foulPct: '% manos sucias',
  fantasylandPct: '% fantasyland',
};

/** Reduce cualquier imagen a un JPEG pequeño antes de mandarla al servidor. */
function resizeImageToDataUrl(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagen no válida'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function ProfileMenu({ session, onClose, onSessionUpdate }) {
  const [tab, setTab] = useState('Perfil');

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-panel" onClick={(event) => event.stopPropagation()}>
        <div className="profile-panel__head">
          <h2>Tu cuenta</h2>
          <button type="button" className="profile-panel__close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <nav className="profile-tabs">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              className={tab === name ? 'is-active' : ''}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        <div className="profile-body">
          {tab === 'Perfil' && <ProfileTab session={session} onSessionUpdate={onSessionUpdate} />}
          {tab === 'Estadísticas' && <StatsTab session={session} />}
          {tab === 'Amigos' && <FriendsTab session={session} />}
          {tab === 'Ajustes' && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

function ProfileTab({ session, onSessionUpdate }) {
  const [name, setName] = useState(session.name ?? '');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function handleUsername(event) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const updated = await setUsername(session.token, name.trim());
      onSessionUpdate(updated);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  async function applyAvatar(payload) {
    setError(null);
    setPending(true);
    try {
      const updated = await setAvatar(session.token, payload);
      onSessionUpdate(updated);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await applyAvatar({ kind: 'custom', dataUrl });
    } catch (failure) {
      setError(failure.message);
    }
  }

  return (
    <>
      <div className="avatar-current">
        <Avatar
          playerId={session.playerId}
          name={session.name}
          avatarUrl={session.avatarUrl}
          avatarKind={session.avatarKind}
          size={56}
        />
        <label className="btn btn--ghost" style={{ cursor: 'pointer' }}>
          Subir foto
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} hidden disabled={pending} />
        </label>
      </div>

      <div className="avatar-grid">
        {Object.entries(AVATAR_PRESET_ICONS).map(([id, icon]) => (
          <button
            key={id}
            type="button"
            className={`avatar-grid__item ${session.avatarKind === 'preset' && session.avatarUrl === `preset:${id}` ? 'is-selected' : ''}`}
            onClick={() => applyAvatar({ kind: 'preset', presetId: id })}
            disabled={pending}
            aria-label={id}
          >
            {icon}
          </button>
        ))}
      </div>

      <form className="field" onSubmit={handleUsername}>
        <span>Nombre de usuario</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={16}
          disabled={pending}
        />
        <button type="submit" className="btn btn--primary" disabled={pending || !name.trim() || name.trim() === session.name}>
          Guardar nombre
        </button>
      </form>

      {error && <p className="alert" role="alert">{error}</p>}
    </>
  );
}

function StatsTab({ session }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchStats(session.token)
      .then((data) => !cancelled && setStats(data))
      .catch((failure) => !cancelled && setError(failure.message));
    return () => { cancelled = true; };
  }, [session.token]);

  if (error) return <p className="alert" role="alert">{error}</p>;
  if (!stats) return <p className="board-note">Cargando…</p>;
  if (!stats.hands) return <p className="board-note">Todavía no has jugado ninguna mano.</p>;

  return (
    <div className="stats-grid">
      {Object.entries(STAT_LABELS).map(([key, label]) => (
        <div className="stat-tile" key={key}>
          <span className="stat-tile__value">
            {stats[key]}{key.endsWith('Pct') ? '%' : ''}
          </span>
          <span className="stat-tile__label">{label}</span>
        </div>
      ))}
    </div>
  );
}

function FriendsTab({ session }) {
  const [data, setData] = useState(null);
  const [username, setUsernameInput] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  function reload() {
    return fetchFriends(session.token).then(setData).catch((failure) => setError(failure.message));
  }

  useEffect(() => { reload(); }, [session.token]);

  async function handleAdd(event) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await sendFriendRequest(session.token, username.trim());
      setUsernameInput('');
      await reload();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  async function handleRespond(id, accept) {
    setError(null);
    try {
      await respondFriendRequest(session.token, id, accept);
      await reload();
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function handleRemove(id) {
    setError(null);
    try {
      await removeFriendship(session.token, id);
      await reload();
    } catch (failure) {
      setError(failure.message);
    }
  }

  return (
    <>
      <form className="join-code" onSubmit={handleAdd}>
        <input
          value={username}
          onChange={(event) => setUsernameInput(event.target.value)}
          placeholder="Nombre de usuario"
          maxLength={16}
        />
        <button type="submit" className="btn btn--ghost" disabled={pending || !username.trim()}>
          Añadir
        </button>
      </form>

      {error && <p className="alert" role="alert">{error}</p>}

      {!data ? (
        <p className="board-note">Cargando…</p>
      ) : (
        <>
          {data.incoming.length > 0 && (
            <div>
              <span className="eyebrow">Solicitudes recibidas</span>
              {data.incoming.map((row) => (
                <div className="friend-row" key={row.id}>
                  <Avatar playerId={row.otherId} name={row.name} avatarUrl={row.avatarUrl} avatarKind={row.avatarKind} size={32} />
                  <span className="friend-row__name">{row.name}</span>
                  <button type="button" className="btn btn--primary" onClick={() => handleRespond(row.id, true)}>Aceptar</button>
                  <button type="button" className="btn btn--ghost" onClick={() => handleRespond(row.id, false)}>Rechazar</button>
                </div>
              ))}
            </div>
          )}

          <div>
            <span className="eyebrow">Amigos</span>
            {data.friends.length === 0 && <p className="board-note">Todavía no tienes amigos añadidos.</p>}
            {data.friends.map((row) => (
              <div className="friend-row" key={row.id}>
                <Avatar playerId={row.otherId} name={row.name} avatarUrl={row.avatarUrl} avatarKind={row.avatarKind} size={32} />
                <span className="friend-row__name">{row.name}</span>
                <button type="button" className="btn btn--ghost" onClick={() => handleRemove(row.id)}>Quitar</button>
              </div>
            ))}
          </div>

          {data.outgoing.length > 0 && (
            <div>
              <span className="eyebrow">Solicitudes enviadas</span>
              {data.outgoing.map((row) => (
                <div className="friend-row" key={row.id}>
                  <Avatar playerId={row.otherId} name={row.name} avatarUrl={row.avatarUrl} avatarKind={row.avatarKind} size={32} />
                  <span className="friend-row__name">{row.name}</span>
                  <span className="tag tag--warn">Pendiente</span>
                  <button type="button" className="btn btn--ghost" onClick={() => handleRemove(row.id)}>Cancelar</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function SettingsTab() {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => { applyTheme(settings.theme); }, []);

  function update(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  }

  return (
    <>
      <div className="settings-row">
        <span>Tema claro</span>
        <button
          type="button"
          className={`toggle ${settings.theme === 'light' ? 'is-on' : ''}`}
          onClick={() => update({ theme: settings.theme === 'light' ? 'dark' : 'light' })}
          aria-label="Alternar tema claro"
        />
      </div>
      <div className="settings-row">
        <span>Sonido</span>
        <button
          type="button"
          className={`toggle ${settings.sound ? 'is-on' : ''}`}
          onClick={() => update({ sound: !settings.sound })}
          aria-label="Alternar sonido"
        />
      </div>
    </>
  );
}
