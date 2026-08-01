/**
 * Identidad en el cliente.
 *
 * Google devuelve un ID token en el navegador; el backend lo valida y entrega
 * un token de sesión propio, que es el único que viaja por el WebSocket. El de
 * Google no se guarda: caduca en una hora y no sirve para una partida larga.
 */

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

const STORAGE_KEY = 'ofc.session';

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

let scriptPromise = null;

/** Carga el script de Google Identity Services una sola vez. */
export function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('No se pudo cargar el acceso de Google'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Canjea el ID token de Google por la sesión propia. */
export async function exchangeGoogleToken(idToken) {
  const response = await fetch(`${API_URL}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? 'No se pudo iniciar sesión');
  return data; // { token, playerId, name, avatarUrl }
}

/**
 * Login nativo (Android/iOS). Evita por completo el WebView: el script de
 * Google Identity Services está bloqueado ahí por política de Google, así
 * que dentro de la app usamos el SDK nativo de Google Sign-In en su lugar.
 */
export async function nativeGoogleSignIn() {
  const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
  await GoogleAuth.initialize();
  const user = await GoogleAuth.signIn();
  return exchangeGoogleToken(user.authentication.idToken);
}

/** Fija el username elegido por el jugador; devuelve una sesión nueva (el JWT lleva el nombre embebido). */
export async function setUsername(token, username) {
  const response = await fetch(`${API_URL}/api/me/username`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ username }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? 'No se pudo guardar el nombre');
  return data; // { token, id, name, avatarUrl, usernameSet }
}

export async function fetchLeaderboard({ days = 30, minHands = 5 } = {}) {
  const response = await fetch(`${API_URL}/api/leaderboard?days=${days}&minHands=${minHands}`);
  if (!response.ok) throw new Error('No se pudo cargar la clasificación');
  return (await response.json()).rows;
}
