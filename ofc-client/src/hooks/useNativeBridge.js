import { useEffect } from 'react';
import { onActiveChange, registerPush } from '../lib/native.js';

/**
 * Conecta la app con el ciclo de vida del móvil.
 *
 * Dos cosas que sólo se pueden resolver aquí: avisar al servidor de que el
 * jugador ya no está delante, para que le mande el aviso push en vez de darlo
 * por presente; y forzar la reconexión al volver, sin esperar a que el socket
 * descubra por su cuenta que Android lo suspendió.
 */
export function useNativeBridge({ setPresence, registerDevice, reconnect }) {
  useEffect(() => {
    let stopListening = () => {};
    let stopPush = () => {};
    let cancelled = false;

    onActiveChange((isActive) => {
      setPresence(isActive ? 'foreground' : 'background');
      if (isActive) reconnect();
    }).then((stop) => {
      if (cancelled) stop(); else stopListening = stop;
    });

    registerPush((token, devicePlatform) => registerDevice(token, devicePlatform))
      .then((stop) => {
        if (cancelled) stop(); else stopPush = stop;
      });

    return () => {
      cancelled = true;
      stopListening();
      stopPush();
    };
  }, [setPresence, registerDevice, reconnect]);
}
