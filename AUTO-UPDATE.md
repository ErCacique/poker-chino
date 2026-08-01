# Sistema de Auto-Update Automático

El sistema permite que cada modificación de la versión se propague automáticamente a todos los clientes (Android, Windows, web).

## Flujo Completo

### 1. Actualizar versión
```bash
# Editar version.json
{
  "version": "1.2.1",
  "releaseDate": "2026-08-02",
  "description": "Mi cambio"
}
```

### 2. Compilar nuevas versiones
```bash
# Windows (PowerShell)
.\deploy.ps1

# Linux/Mac
bash deploy.sh
```

Script automático:
- Compila Windows Electron (`npm run dist:win`)
- Compila Android APK (`npm run build:android:apk`)
- Copia binarios a `updates/`
- Sube a Railway con `git push railway main`

### 3. Clientes detectan y descargan update

**Web/Android (Capacitor):**
- Hook `useCheckUpdates()` chequea `/api/version` cada hora
- Si versión remota > versión actual, muestra `<UpdateNotification>`
- Usuario toca "Actualizar ahora" → descarga APK desde `/updates/`

**Windows (Electron):**
- `electron-updater` chequea `/updates/` cada hora (configurado en `electron-builder.yml`)
- Si hay ZIP más nuevo, descarga y instala automáticamente
- Usuario reinicia app y corre versión nueva

## Archivos clave

- **version.json** — única fuente de verdad para la versión actual
- **app.js** — endpoint `/api/version` (devuelve versión + URLs) y `/updates/*` (sirve binarios)
- **ofc-client/hooks/useCheckUpdates.js** — hook React que chequea updates
- **ofc-client/components/UpdateNotification.jsx** — UI de notificación
- **ofc-desktop/main.js** — electron-updater configurado
- **ofc-desktop/electron-builder.yml** — URL de servidor de updates
- **deploy.sh/deploy.ps1** — scripts de compilación + upload

## Notas

1. El servidor debe tener una carpeta `updates/` con permisos de lectura donde Railway pueda servir binarios
2. En desarrollo, los clientes chequean `http://localhost:8080/api/version`
3. En producción, chequean `https://ofc-server-production-eada.up.railway.app/api/version`
4. Modificar `version.json` sin hacer deploy no dispara updates
5. El primer chequeo es inmediato; luego cada hora

## Testing

```bash
# Bump versión de prueba
echo '{"version": "1.2.1", ...}' > version.json

# En navegador:
curl http://localhost:8080/api/version
# → Devuelve {"version": "1.2.1", "downloads": {...}}

# Chequear que UpdateNotification aparece en React (dev mode)
# Console debe mostrar: "[ofc] check for updates failed" o "[ofc] update available"
```
