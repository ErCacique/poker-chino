# OFC PINEAPPLE - Juego Multijugador de Poker Chino

## Instalacion Rapida en Windows

### Paso 1: Descargar archivos del proyecto

1. Abre este enlace en tu navegador:
   ```
   https://claude.ai/share/dbc047d2-cc59-476c-88f0-b16749f8e07d
   ```

2. Descarga estos archivos y coloca en `C:\PROYECTOS\POKER-CHINO\`:

   **Servidor (13 archivos):**
   - ofc-engine.js
   - ofc-table.js
   - app.js (o ws-server.js)
   - ofc-auth.js
   - ofc-db.js
   - ofc-store.js
   - ofc-push.js
   - ofc-limits.js
   - test-helpers.js
   - ofc-engine.test.js
   - ofc-table.test.js
   - ws-server.test.js
   - Todos los *.test.js disponibles

   **Cliente:**
   - ofc-client.zip → Extrae en `C:\PROYECTOS\POKER-CHINO\ofc-client\`

### Paso 2: Ejecutar instalador

1. Abre PowerShell
2. Ejecuta:
   ```powershell
   cd C:\PROYECTOS\POKER-CHINO
   .\DESCARGAR.ps1
   ```

Esto verificara que todos los archivos esten descargados e instalara todo automaticamente.

### Paso 3: Arrancar servidor y cliente

**Terminal 1 (Servidor):**
```powershell
cd C:\PROYECTOS\POKER-CHINO
npm start
```

Veras:
```
[ofc] SERVER escuchando en http://localhost:8080
```

**Terminal 2 (Cliente):**
```powershell
cd C:\PROYECTOS\POKER-CHINO\ofc-client
npm run dev
```

Veras:
```
➜  local:   http://localhost:5173/
```

### Paso 4: Jugar

1. Abre navegador en: http://localhost:5173
2. Abre dos pestanas (o dos navegadores)
3. Pestaña 1: Click "Buscar partida"
4. Pestaña 2: Click "Buscar partida"
5. ¡A jugar!

## Comandos utiles

```powershell
# Ejecutar todas las pruebas
npm test

# Ejecutar pruebas especificas
npm run test:engine
npm run test:table
npm run test:server
npm run test:limits
```

## Requisitos

- Node.js 22+
- npm 11+
- Windows 10 o superior
- Navegador moderno (Chrome, Firefox, Edge)

## Estructura del Proyecto

```
ofc-game/
├── package.json              # Dependencias
├── app.js                    # Servidor HTTP + WebSocket
├── ofc-engine.js             # Reglas del juego (motor puro)
├── ofc-table.js              # Maquina de estados
├── ofc-auth.js               # Autenticacion
├── ofc-db.js                 # Base de datos
├── ofc-store.js              # Persistencia (Redis/Memory)
├── ofc-push.js               # Notificaciones push
├── ofc-limits.js             # Limitador de frecuencia
├── test-helpers.js           # Utilidades de test
├── *.test.js                 # Pruebas unitarias
│
└── ofc-client/               # Cliente React (Vite)
    ├── package.json
    ├── vite.config.js
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   ├── hooks/
    │   └── lib/
    └── node_modules/
```

## Problemas Comunes

**Puerto 8080 ocupado:**
```powershell
netstat -ano | findstr :8080
taskkill /PID <PID> /F
```

**WebSocket no conecta:**
- Verificar que npm start este corriendo en Terminal 1
- Verificar http://localhost:8080 en navegador

**Las cartas no se arrastran:**
- En desktop, abrir DevTools (F12) → Emulation → Device (mobile)
- En movil real, funcionan con Pointer Events

**UNAUTHORIZED:**
- Recargar pagina (F5)
- Verificar que ALLOW_DEV_TOKENS=1 este en .env

## Archivos del Proyecto

Los archivos estan disponibles en:
https://claude.ai/share/dbc047d2-cc59-476c-88f0-b16749f8e07d

O descarga el ZIP completo si disponible.

## Proximos Pasos

Una vez que funcione localmente:

1. Probar en movil real (Android/iOS)
2. Crear cliente OAuth en Google Cloud Console
3. Configurar PostgreSQL para persistencia
4. Configurar Firebase para notificaciones push
5. Desplegar con TLS (HTTPS/WSS)

## Contacto

Para dudas sobre el codigo, revisa conversacion-completa.json

---

**Estado:** Completamente funcional para pruebas locales
**Tests:** 59 pruebas verdes
**Ultima actualizacion:** 2026-07-29
