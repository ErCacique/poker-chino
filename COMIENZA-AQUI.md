# 🎴 OFC Pineapple - Cómo Jugar Localmente

## ⚡ Opción 1: Instalación Automática (RECOMENDADO)

Si tienes bash:

```bash
bash setup-ofc-game.sh
```

Listo. Salta a la sección **"Arrancar el Juego"** abajo.

---

## 📋 Opción 2: Instalación Manual

### Paso 1: Descargar archivos

Descarga estos archivos de `/outputs/`:
- `package.json`
- `app.js`, `ws-server.js`
- `ofc-*.js` (todos los que empiezan con ofc-)
- `*test.js` (las pruebas)
- `test-helpers.js`
- `ofc-client.zip`
- `conversacion-completa.json`

### Paso 2: Organizar en carpeta

```bash
mkdir ~/ofc-game
cd ~/ofc-game

# Copiar los .js y package.json aquí
# Descomprimir
unzip ofc-client.zip
```

Estructura final:
```
~/ofc-game/
├── package.json
├── app.js
├── ws-server.js
├── ofc-*.js (engine, table, auth, db, store, push, limits)
├── *test.js
├── test-helpers.js
├── ofc-client/    ← descomprimido
└── conversacion-completa.json
```

### Paso 3: Instalar dependencias

```bash
# Servidor
cd ~/ofc-game
npm install

# Cliente
cd ofc-client
npm install
cd ..
```

---

## 🚀 Arrancar el Juego

Necesitas **dos terminales abiertas**:

### Terminal 1: SERVIDOR

```bash
cd ~/ofc-game
npm start
```

Verás:
```
[ofc] SERVER escuchando en http://localhost:8080
[ofc] SESSION_SECRET no definido: sesiones efímeras
```

**Deja esta terminal abierta.**

### Terminal 2: CLIENTE

```bash
cd ~/ofc-game/ofc-client
npm run dev
```

Verás:
```
  VITE v5.x.x  ready in XXX ms

  ➜  local:   http://localhost:5173/
```

---

## 🌐 Abrir en Navegador

Abre **dos pestañas o dos navegadores** en:

```
http://localhost:5173
```

- **Pestaña 1**: Se carga automáticamente como "dev:ana:Ana"
- **Pestaña 2**: Otra pestaña → "dev:bruno:Bruno"

---

## 🎮 Cómo Jugar

**Pestaña 1 (Ana):**
1. Espera a que cargue
2. Haz click en **"Buscar partida"**
3. Espera emparejamiento

**Pestaña 2 (Bruno):**
1. Idem: click en **"Buscar partida"**
2. Cuando se encuentren, ambas ven el tablero

**Una mano típica:**
- Ves 5 cartas iniciales
- Coloca 2 en tu tablero (3 filas: top/middle/bottom)
- Descarta 1
- 4 turnos más: compra 1, coloca 1, descarta 1
- **Showdown**: se revelan y calcula puntos
- Click **"Siguiente"** o espera 8 segundos

Si te demoras, el servidor auto-juega (aleatorio seguro).

---

## 🧪 Ejecutar Pruebas

```bash
cd ~/ofc-game
npm test
```

Verás:
```
# tests 59
# pass 52
# fail 0
```

7 se saltan por falta de PostgreSQL/Redis, pero el juego funciona sin ellas.

---

## ❓ Problemas Comunes

| Problema | Solución |
|----------|----------|
| **`EADDRINUSE:8080`** | Puerto ocupado. Matá: `lsof -i :8080` o cambia a `PORT=3000` |
| **`Cannot find module 'ws'`** | Ejecutaste `npm install`? Está en la Terminal 1 |
| **WebSocket error** | ¿El servidor está arrancado en Terminal 1? |
| **"dev:ana:Ana" no aparece** | Refresca el navegador (F5) |
| **No se conectan dos jugadores** | Asegúrate que es otra **pestaña distinta** del mismo navegador o navegador diferente |
| **Las cartas no se arrastran** | Prueba arrastrando en mobile en DevTools (F12 → device emulation) |

---

## 📁 Qué es Cada Carpeta

```
~/ofc-game/
├── package.json                  ← npm install/start aquí
├── app.js                        ← Punto entrada servidor
├── ws-server.js                  ← WebSocket + turno a turno
├── ofc-engine.js                 ← Reglas (evaluación de manos)
├── ofc-table.js                  ← Estado de mesa
├── ofc-auth.js                   ← Autenticación
├── ofc-limits.js                 ← Límite de frecuencia
├── ofc-db.js, ofc-store.js, ofc-push.js  ← Extras (DB, Redis, notificaciones)
├── *test.js                      ← 59 pruebas automatizadas
├── ofc-client/                   ← React app en Vite
│   ├── src/
│   │   ├── App.jsx               ← Routing, login
│   │   ├── lib/                  ← Socket, autenticación, cartas
│   │   ├── hooks/                ← Estado del juego
│   │   └── components/           ← Card, Board, Table, Lobby, etc
│   └── package.json              ← npm install aquí
└── conversacion-completa.json    ← Resumen del desarrollo
```

---

## ✅ Checklist Antes de Jugar

- [ ] Tengo Node.js 22+ (`node --version`)
- [ ] Descargué y descomprimí todos los archivos
- [ ] Carpeta `~/ofc-game/` existe
- [ ] Adentro hay `app.js`, `ws-server.js`, `ofc-client/`
- [ ] Executé `npm install` en `~/ofc-game/` ✓
- [ ] Executé `npm install` en `~/ofc-game/ofc-client/` ✓
- [ ] Terminal 1: `npm start` está corriendo
- [ ] Terminal 2: `npm run dev` en ofc-client está corriendo
- [ ] Abro `http://localhost:5173` en navegador

---

## 🎯 Siguiente Paso (Después de Probar)

Una vez que juegas una mano completa sin errores:

1. **Probar en móvil real:**
   ```bash
   cd ofc-client
   npx cap add android
   npm run android
   ```

2. **Para producción necesitas:**
   - Google Cloud OAuth
   - Firebase para notificaciones push
   - Certificados TLS (wss://)
   - PostgreSQL + Redis reales

---

## 📞 ¿Atascado?

1. Verifica la Terminal 1 (servidor) — ¿ves logs?
2. Abre DevTools (F12) en navegador → Console → ¿hay errores?
3. Revisa `conversacion-completa.json` para entender la arquitectura

---

**¡Buen juego! 🎴**
