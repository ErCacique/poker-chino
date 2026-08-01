import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { GOOGLE_CLIENT_ID, loadGoogleScript, exchangeGoogleToken, nativeGoogleSignIn, saveSession } from '../lib/auth.js';

const isNative = Capacitor.isNativePlatform();

/** Botón de acceso de Google. Sin VITE_GOOGLE_CLIENT_ID no se monta. */
export function SignIn({ onSignedIn }) {
  const slot = useRef(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  // En la app nativa el script web de Google está bloqueado por el propio
  // Google dentro de un WebView, así que ahí se usa el SDK nativo en su
  // lugar (ver handleNativeSignIn); en web/escritorio sigue el botón normal.
  useEffect(() => {
    if (isNative) return undefined;
    let cancelled = false;

    loadGoogleScript()
      .then((google) => {
        if (cancelled || !slot.current) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async ({ credential }) => {
            try {
              const session = await exchangeGoogleToken(credential);
              saveSession(session);
              onSignedIn(session);
            } catch (failure) {
              setError(failure.message);
            }
          },
        });
        google.accounts.id.renderButton(slot.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          locale: 'es',
        });
      })
      .catch((failure) => !cancelled && setError(failure.message));

    return () => { cancelled = true; };
  }, [onSignedIn]);

  async function handleNativeSignIn() {
    setError(null);
    setPending(true);
    try {
      const session = await nativeGoogleSignIn();
      saveSession(session);
      onSignedIn(session);
    } catch (failure) {
      setError(failure.message ?? 'No se pudo iniciar sesión');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel panel--waiting">
      <h2>Entrar</h2>
      <p>Necesitas una cuenta para que se guarden tus manos y puntos.</p>
      {isNative ? (
        <button type="button" className="google-btn" onClick={handleNativeSignIn} disabled={pending}>
          <span className="google-btn__icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="18" height="18">
              <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
              <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
              <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
              <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
            </svg>
          </span>
          <span>{pending ? 'Entrando…' : 'Iniciar sesión con Google'}</span>
        </button>
      ) : (
        <div ref={slot} />
      )}
      {error && <p className="alert" role="alert">{error}</p>}
    </section>
  );
}
