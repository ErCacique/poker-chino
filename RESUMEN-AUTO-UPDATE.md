# Auto-Update System — Resumen Implementado

## ✓ Completado

### Backend (app.js)
- ✓ Endpoint `/api/version` — devuelve versión actual + URLs de descarga
- ✓ Endpoint `/updates/*` — sirve archivos binarios (APK, ZIP) con validación de nombre
- ✓ CORS configurado para permitir múltiples orígenes
- ✓ version.json como fuente única de versión

### Cliente Web (React + Vite)
- ✓ Hook `useCheckUpdates()` — chequea `/api/version` cada hora
- ✓ Componente `UpdateNotification` — muestra botón de actualización
- ✓ Integrado en `App.jsx` — notificación visible a todos los usuarios
- ✓ CSS styling — notificación con estética coherente
- ✓ Vite config — pasa `__APP_VERSION__` global para comparar versiones

### Cliente Desktop (Windows/Electron)
- ✓ electron-updater instalado y configurado
- ✓ `main.js` — checkForUpdatesAndNotify() cada hora
- ✓ `electron-builder.yml` — URL de servidor de updates configurada
- ✓ Auto-install en background (usuario ve notificación en next startup)

### Deployment
- ✓ `deploy.sh` — script para Linux/Mac (compila + sube a Railway)
- ✓ `deploy.ps1` — script para Windows (mismo flujo)
- ✓ Automático: lee version.json, compila, copia a `/updates/`, hace git push
- ✓ AUTO-UPDATE.md — documentación completa de cómo usar

### Testing
- ✓ Endpoint `/api/version` testado y funcionando
- ✓ Respuesta contiene versión + URLs válidas
- ✓ CORS headers presentes
- ✓ Servidor listo en :8080

## Flujo Completo

### Para actualizar a nueva versión:

```bash
# 1. Editar version.json
{
  "version": "1.2.1",
  "releaseDate": "2026-08-02",
  "description": "Nueva versión"
}

# 2. Ejecutar script de deployment
.\deploy.ps1          # Windows
bash deploy.sh        # Linux/Mac

# Automáticamente:
# - Compila Windows Electron → PineappleOFC-Windows-v1.2.1.zip
# - Compila Android APK → PineappleOFC-Android-Debug-v1.2.1.apk
# - Copia a carpeta /updates/
# - Hace git commit + push a Railway
# - Server actualiza version.json en LIVE
```

### Clientes reciben update:

**Web/Android (Capacitor):**
1. Hook detecta versión nueva en próxima hora
2. Muestra notificación con botón "Actualizar ahora"
3. Usuario toca botón → descarga APK desde `/updates/` automáticamente

**Windows (Electron):**
1. electron-updater detecta ZIP nuevo en próxima hora
2. Descarga + prepara instalación
3. Próximo restart → corre versión nueva

**iOS:**
- Bloqueado: requiere Mac para compilar

## Ejemplos de uso

### Desde terminal (testing)
```bash
# Ver versión actual + URLs
curl http://localhost:8080/api/version

# Descargar APK específico
curl http://localhost:8080/updates/PineappleOFC-Android-Debug-v1.2.0.apk -O

# Descargar ZIP específico
curl http://localhost:8080/updates/PineappleOFC-Windows-v1.2.0.zip -O
```

### Desde React (componente)
```jsx
const { updateAvailable, isInstalling, installUpdate } = useCheckUpdates();

if (updateAvailable) {
  <UpdateNotification
    update={updateAvailable}
    isInstalling={isInstalling}
    onInstall={installUpdate}
  />
}
```

## Notas técnicas

- **version.json** — la ÚNICA fuente de verdad para versión (no hardcoded en código)
- **__APP_VERSION__** — variable Vite que inyecta versión en build
- **Validación de nombres** — `/updates/*` rechaza cualquier archivo fuera del patrón `PineappleOFC-(Android|Windows)-*.(apk|zip)`
- **Intervalo de chequeo** — 1 hora (modificable en useCheckUpdates.js)
- **Grace period** — electron-updater puede tomar 24 horas entre updates (configurable)

## Próximos pasos opcionales

1. Crear interfaz de admin en web para cambiar versión sin SSH
2. Agregar changelog/release notes en UpdateNotification
3. Implementar rollback en caso de versión rota
4. Agregar estadísticas de adopción (qué % de usuarios en qué versión)
5. iOS support (requiere Mac + certificados de Apple)

## Commit

```
262d7bc: feat: implement complete auto-update system for all platforms
```
