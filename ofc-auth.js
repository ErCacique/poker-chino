/**
 * ofc-auth.js — Identidad.
 *
 * Flujo: el navegador obtiene un ID token de Google (Google Identity Services),
 * el backend lo verifica contra las claves públicas de Google y emite un token
 * de sesión propio. El WebSocket sólo entiende ese token propio.
 *
 * Se emite sesión propia en vez de reutilizar el de Google porque el de Google
 * caduca en una hora, no es renovable sin volver al navegador, y una partida
 * larga con reconexiones lo sobreviviría.
 *
 * Node.js >= 18, ESM. Dependencia: jose (v5).
 */

import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { OfcError } from './ofc-engine.js';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

let jwks = null;
function googleKeys() {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)); // cachea claves y rota solo
  return jwks;
}

/**
 * Verifica el ID token emitido por Google para nuestro clientId.
 * @returns {Promise<{googleSub:string, name:string, avatarUrl:string|null, email:string|null}>}
 */
export async function verifyGoogleIdToken(idToken, { clientId }) {
  if (!clientId) throw new OfcError('CONFIG', 'Falta GOOGLE_CLIENT_ID');
  if (typeof idToken !== 'string' || !idToken) {
    throw new OfcError('UNAUTHORIZED', 'Falta el token de Google');
  }
  try {
    const { payload } = await jwtVerify(idToken, googleKeys(), {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
    });
    return {
      googleSub: payload.sub,
      name: payload.name || payload.email || 'Jugador',
      avatarUrl: payload.picture ?? null,
      email: payload.email ?? null,
    };
  } catch (error) {
    throw new OfcError('UNAUTHORIZED', `Token de Google no válido: ${error.message}`);
  }
}

/** Emite el token de sesión propio (HS256). */
export async function issueSession({ playerId, name }, { secret, ttl = '30d' }) {
  const key = secretKey(secret);
  return new SignJWT({ name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(playerId)
    .setIssuedAt()
    .setIssuer('ofc')
    .setExpirationTime(ttl)
    .sign(key);
}

export async function verifySession(token, { secret }) {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { issuer: 'ofc' });
    return { playerId: payload.sub, name: payload.name ?? payload.sub };
  } catch (error) {
    throw new OfcError('UNAUTHORIZED', `Sesión no válida: ${error.message}`);
  }
}

function secretKey(secret) {
  if (!secret || secret.length < 32) {
    throw new OfcError('CONFIG', 'SESSION_SECRET debe tener al menos 32 caracteres');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Construye el verificador que consume GameServer.
 * `allowDev` habilita los tokens "dev:<id>:<nombre>" y debe quedar apagado en
 * producción: con él, cualquiera se autentica como cualquiera.
 */
export function makeVerifyToken({ secret, allowDev = false }) {
  return async function verifyToken(token) {
    if (allowDev && typeof token === 'string' && token.startsWith('dev:')) {
      const [, playerId, name] = token.split(':');
      if (!playerId) throw new OfcError('UNAUTHORIZED', 'Token de desarrollo sin identificador');
      return { playerId, name: name || playerId };
    }
    return verifySession(token, { secret });
  };
}
