/**
 * ofc-push.js — Aviso de turno cuando la app no está delante.
 *
 * El transporte real (FCM) se aísla detrás de una interfaz mínima para que la
 * regla de "cuándo se avisa" sea comprobable sin credenciales ni red.
 *
 * FCM cubre también iOS a través de APNs, así que no hace falta un segundo
 * proveedor: lo que cambia es la configuración del proyecto, no este código.
 *
 * Node.js >= 18, ESM. FcmPusher usa jose para firmar el JWT de servicio.
 */

import { SignJWT, importPKCS8 } from 'jose';

/** No hace nada. Es el valor por defecto: sin credenciales no se avisa a nadie. */
export class NullPusher {
  async notifyTurn() {}
  async close() {}
}

/**
 * Cliente de FCM HTTP v1. Obtiene el token de acceso firmando un JWT con la
 * clave de la cuenta de servicio y lo reutiliza hasta que caduca.
 */
export class FcmPusher {
  /**
   * @param {object} options
   * @param {object} options.credentials JSON de la cuenta de servicio
   * @param {object} options.db acceso a los dispositivos registrados
   */
  constructor({ credentials, db }) {
    if (!credentials?.client_email || !credentials?.private_key || !credentials?.project_id) {
      throw new Error('Credenciales de servicio incompletas');
    }
    this.credentials = credentials;
    this.db = db;
    this.accessToken = null;
    this.expiresAt = 0;
  }

  async _token() {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;

    const key = await importPKCS8(this.credentials.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(this.credentials.client_email)
      .setSubject(this.credentials.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) throw new Error(`OAuth de Google rechazó la cuenta: ${response.status}`);

    const data = await response.json();
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  /**
   * Avisa a todos los dispositivos del jugador. Un dispositivo desregistrado
   * se borra: si no, la lista crece con tokens muertos y cada aviso cuesta más.
   */
  async notifyTurn({ playerId, tableId, secondsLeft }) {
    const devices = await this.db.devicesFor(playerId);
    if (!devices.length) return;

    const token = await this._token();
    const url = `https://fcm.googleapis.com/v1/projects/${this.credentials.project_id}/messages:send`;

    await Promise.all(devices.map(async (device) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: device.token,
            notification: {
              title: 'Te toca',
              body: `Tienes ${secondsLeft} segundos para colocar.`,
            },
            data: { tableId, kind: 'turn' },
            android: { priority: 'high', notification: { channel_id: 'turnos' } },
            apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
          },
        }),
      });

      if (response.status === 404 || response.status === 400) {
        await this.db.deleteDevice(device.token).catch(() => {});
      } else if (!response.ok) {
        console.error('[ofc] FCM respondió', response.status);
      }
    }));
  }

  async close() {}
}

/** Construye el emisor según el entorno. Sin credenciales, no avisa. */
export function createPusher({ credentialsJson = process.env.FCM_CREDENTIALS, db = null } = {}) {
  if (!credentialsJson || !db) return new NullPusher();
  try {
    return new FcmPusher({ credentials: JSON.parse(credentialsJson), db });
  } catch (error) {
    console.error('[ofc] push desactivado:', error.message);
    return new NullPusher();
  }
}
