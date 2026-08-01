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
    try {
      if (Capacitor.isNativePlatform()) {
        const platform = Capacitor.getPlatform();
        const url = updateAvailable.downloads[platform === 'ios' ? 'ios' : 'android'];
        if (!url) throw new Error(`No download URL for ${platform}`);

        // En Android: abrir el link para que el user descargue manualmente
        // (auto-install programático requiere permisos especiales)
        await App.openUrl({ url });
      }
      // Windows: electron-updater lo maneja automáticamente
    } catch (err) {
      console.error('[ofc] update install failed:', err.message);
    } finally {
      setIsInstalling(false);
    }
  }

  return { updateAvailable, isInstalling, installUpdate };
}
