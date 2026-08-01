import { API_URL } from '../lib/auth.js';

// Debe reflejar AVATAR_PRESETS en ofc-avatar.js (server): mismos ids.
export const AVATAR_PRESET_ICONS = {
  spade: '♠', heart: '♥', club: '♣', diamond: '♦',
  fox: '🦊', cat: '🐱', owl: '🦉', bear: '🐻',
};

/** Avatar de un jugador, sea cual sea su modalidad (google/preset/custom). */
export function Avatar({ playerId, name, avatarUrl, avatarKind, size = 32 }) {
  const style = { width: size, height: size, fontSize: size * 0.55 };

  if (avatarKind === 'preset' && avatarUrl?.startsWith('preset:')) {
    const icon = AVATAR_PRESET_ICONS[avatarUrl.slice('preset:'.length)] ?? '?';
    return <span className="avatar avatar--preset" style={style} aria-hidden="true">{icon}</span>;
  }
  if (avatarKind === 'custom' && playerId) {
    return (
      <img
        className="avatar"
        style={style}
        src={`${API_URL}/api/avatar/${playerId}`}
        alt=""
        onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
      />
    );
  }
  if (avatarUrl) {
    return <img className="avatar" style={style} src={avatarUrl} alt="" referrerPolicy="no-referrer" />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return <span className="avatar avatar--fallback" style={style} aria-hidden="true">{initial}</span>;
}
