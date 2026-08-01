# Empaquetado móvil (Capacitor)

El mismo código corre en web, Android e iOS. Capacitor no reescribe nada:
envuelve el `dist` de Vite en una app nativa y expone ciclo de vida, háptica y
notificaciones push.

## Requisitos

- Android: Android Studio con SDK 34+ y JDK 17.
- iOS: macOS con Xcode 15+ y CocoaPods.

## Alta de plataformas (una sola vez)

```bash
npm install
npx cap add android
npx cap add ios        # sólo en macOS
```

Esto crea las carpetas `android/` e `ios/`, que **sí** se versionan: contienen
la configuración de firma, permisos e iconos.

## Ciclo de trabajo

```bash
npm run android        # compila, sincroniza y abre Android Studio
npm run ios
npm run sync           # sólo sincronizar tras cambiar dependencias nativas
```

Durante el desarrollo con recarga en caliente, añade a `capacitor.config.json`:

```json
"server": { "url": "http://TU_IP_LOCAL:5173", "cleartext": true }
```

y quítalo antes de publicar.

## Notificaciones push

1. Crea el proyecto en Firebase y añade una app Android con el mismo `appId`
   que `capacitor.config.json` (`com.pineappleofc.app`).
2. Descarga `google-services.json` y déjalo en `android/app/`.
3. Para iOS, sube la clave de APNs a Firebase y añade `GoogleService-Info.plist`
   al proyecto de Xcode, con la capacidad Push Notifications activada.
4. En el servidor, exporta la cuenta de servicio de Firebase:

```bash
export FCM_CREDENTIALS="$(cat cuenta-de-servicio.json)"
```

Sin esa variable el servidor no envía nada y el juego funciona igual, sólo que
sin avisos.

El canal de Android se llama `turnos`; créalo en el arranque nativo si quieres
controlar su importancia y sonido por separado.

## Conexión al servidor

`VITE_API_URL` y `VITE_WS_URL` se compilan dentro del paquete, así que apuntan
al servidor de producción, no a localhost. En Android sólo se permite `https` y
`wss`: el tráfico en claro está desactivado en la configuración.
