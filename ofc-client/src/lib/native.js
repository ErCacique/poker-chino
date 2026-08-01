/**
 * Puente con la capa nativa (Capacitor). Todo va con importación dinámica y
 * try/catch: el mismo código corre en el navegador, donde estos plugins no
 * existen o lanzan "not implemented", y ahí simplemente no hace nada.
 */

export function isNative() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

export function platform() {
  return globalThis.Capacitor?.getPlatform?.() ?? 'web';
}

/** Vibración corta al llegar el turno. En web no hace nada. */
export async function tapFeedback() {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    // Sin plugin nativo: se ignora, no es funcionalidad crítica.
  }
}

/**
 * Escucha el paso a segundo plano. En nativo usa el ciclo de vida de la app;
 * en web cae en visibilitychange, que da la misma señal con menos precisión.
 * @returns {Promise<() => void>} función para dejar de escuchar
 */
export async function onActiveChange(callback) {
  if (isNative()) {
    try {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appStateChange', ({ isActive }) => callback(isActive));
      return () => handle.remove();
    } catch {
      // Si el plugin falla se usa igualmente el camino web.
    }
  }
  const listener = () => callback(!document.hidden);
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

/**
 * Pide permiso de notificaciones y registra el dispositivo.
 * Devuelve una función de limpieza; si el usuario deniega, no hace nada más.
 */
export async function registerPush(onToken) {
  if (!isNative()) return () => {};
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt') status = await PushNotifications.requestPermissions();
    if (status.receive !== 'granted') return () => {};

    const registration = await PushNotifications.addListener('registration', ({ value }) => {
      onToken(value, platform());
    });
    const failure = await PushNotifications.addListener('registrationError', (error) => {
      console.error('[ofc] no se pudo registrar el push:', error);
    });

    await PushNotifications.register();
    return () => { registration.remove(); failure.remove(); };
  } catch {
    return () => {};
  }
}
