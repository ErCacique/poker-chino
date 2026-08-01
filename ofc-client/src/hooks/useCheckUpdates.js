import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
const CHECK_INTERVAL = 60 * 60 * 1000; // chequear cada hora

/**
 * Chequea actualizaciones disponibles y notifica al usuario.
 * En web: simplemente log. En Android/iOS: descarga e instala.
 * En Windows (Electron): electron-updater lo maneja automáticamente.
 */
export function useCheckUpdates() {
  const [updateAvailable, setUpdateAvailable] = useState(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState(null);

  async function checkForUpdates() {
    try {
      const res = await fetch(`${API_URL}/api/version`);
      if (!res.ok) return;
      const { version, downloads } = await res.json();

      // Obtener versión actual de la app
      const currentVersion = __APP_VERSION__ ?? '0.0.0';
      if (version !== currentVersion) {
        setUpdateAvailable({ version, downloads });
      }
    } catch (err) {
      console.warn('[ofc] check for updates failed:', err.message);
    }
  }

  useEffect(() => {
    checkForUpdates();
    const timer = setInterval(checkForUpdates, CHECK_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  async function installUpdate() {
    if (!updateAvailable) return;
    setIsInstalling(true);
    setInstallError(null);
    try {
      if (Capacitor.isNativePlatform()) {
        const platform = Capacitor.getPlatform();
        const url = updateAvailable.downloads[platform === 'ios' ? 'ios' : 'android'];
        if (!url) throw new Error(`No hay descarga disponible para ${platform}`);

        // En Android: abrir el link para que el user descargue manualmente
        // (auto-install programático requiere permisos especiales). Si el
        // plugin de App falla o no está disponible, caemos a navegar la
        // propia WebView a la URL: sigue disparando la descarga del sistema.
        try {
          await App.openUrl({ url });
        } catch {
          window.location.href = url;
        }
      } else {
        window.open(updateAvailable.downloads.windows ?? '#', '_blank');
      }
      // Windows/Electron nativo: electron-updater lo maneja automáticamente,
      // no pasa por aquí.
    } catch (err) {
      console.error('[ofc] update install failed:', err.message);
      setInstallError('No se pudo abrir la descarga. Vuelve a intentarlo.');
    } finally {
      setIsInstalling(false);
    }
  }

  return { updateAvailable, isInstalling, installError, installUpdate };
}
