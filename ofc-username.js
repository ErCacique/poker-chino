/**
 * ofc-username.js — Validación de nombres de usuario elegidos por el jugador.
 *
 * Separado de ofc-db.js porque es una regla de negocio pura (sin I/O): más
 * fácil de testear y de reutilizar si algún día hay un segundo punto de
 * entrada (admin, moderación, etc.).
 */

const MIN_LENGTH = 3;
const MAX_LENGTH = 16;
const VALID_CHARS = /^[a-zA-Z0-9_]+$/;

// Lista básica, no exhaustiva: cubre los casos más obvios en ES/EN.
// Se compara en minúsculas y sin distinguir _ para pillar variantes simples.
const BANNED_WORDS = [
  'puta', 'puto', 'mierda', 'gilipollas', 'cabron', 'cabrón', 'polla', 'coño',
  'joder', 'maricon', 'maricón', 'zorra', 'nazi', 'hitler',
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'nigger', 'faggot', 'retard',
];

export function validateUsername(raw) {
  const username = typeof raw === 'string' ? raw.trim() : '';

  if (username.length < MIN_LENGTH || username.length > MAX_LENGTH) {
    return { ok: false, reason: `Debe tener entre ${MIN_LENGTH} y ${MAX_LENGTH} caracteres` };
  }
  if (!VALID_CHARS.test(username)) {
    return { ok: false, reason: 'Solo letras, números y guion bajo' };
  }
  const normalized = username.toLowerCase().replace(/_/g, '');
  if (BANNED_WORDS.some((word) => normalized.includes(word))) {
    return { ok: false, reason: 'Ese nombre no está permitido' };
  }
  return { ok: true, username };
}
