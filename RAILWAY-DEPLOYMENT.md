# Deployment a Railway — Guía Paso a Paso

## Estado Actual

El sistema de auto-update está completamente implementado y listo para Railway. Necesita solo **2 pasos** para conectar:

## Paso 1: Conectar Git a Railway

```bash
# Crear nuevo proyecto en Railway (si no existe)
# https://railway.app/new

# Conectar repositorio GitHub
# 1. Ir a railway.app → New Project
# 2. Seleccionar "GitHub"
# 3. Autorizar Railway a acceder a tu GitHub
# 4. Seleccionar repositorio
# 5. Railway auto-detecta Procfile / package.json y despliega

# O manualmente:
railway link
railway up
```

## Paso 2: Asegurar que carpeta `updates/` existe

Railway necesita servir archivos de `updates/`. Si no existe, crearla:

```bash
mkdir -p updates/
touch updates/.gitkeep  # Placeholder para git
git add updates/
git commit -m "create updates directory for binaries"
git push
```

## Verificar que funciona

Una vez que Railway redeploy (automático):

```bash
# Reemplazar con tu dominio Railway
curl https://ofc-server-production-eada.up.railway.app/api/version

# Debería devolver:
# {"version":"1.2.0","downloads":{"android":"https://...","windows":"https://..."}}
```

## Flujo de Auto-Update en Producción

```
1. Editar version.json: "1.2.1"
2. Ejecutar: .\deploy.ps1
3. Script compila + hace git push railway main
4. Railway redeploy (automático, ~2 min)
5. Clientes detectan versión nueva en próxima hora
6. Descarga + instalan automáticamente
7. Todos corren 1.2.1 sin hacer nada
```

## Checklist de Deployment

- [x] Código auto-update implementado
- [x] Endpoint `/api/version` funcionando
- [x] Endpoint `/updates/*` funcionando
- [x] Scripts deploy.sh / deploy.ps1 funcionando
- [x] version.json creado
- [ ] Repository conectado a Railway
- [ ] Carpeta `updates/` existe en Railway
- [ ] Primer push a Railway completado
- [ ] Endpoint `/api/version` accesible desde Railway

## Comandos Útiles

```bash
# Ver estado de Railway
railway status

# Ver logs de deployment
railway logs

# Hacer push a Railway
git push railway main

# Compilar y testear localmente antes de push
.\deploy.ps1          # genera archivos en updates/
curl http://localhost:8080/api/version

# Ver qué versión está corriendo en Railway
curl https://ofc-server-production-eada.up.railway.app/health
curl https://ofc-server-production-eada.up.railway.app/api/version
```

## Troubleshooting

**Problema:** `/api/version` devuelve 404
- **Causa:** version.json no existe en Railway
- **Solución:** Hacer `git push` para que incluya version.json

**Problema:** `/updates/*` devuelve 404
- **Causa:** Carpeta updates/ no existe o archivo no está ahí
- **Solución:** Correr `.\deploy.ps1` para generar binarios, hacer push

**Problema:** Electron updater no encuentra ZIP
- **Causa:** electron-builder.yml apunta a URL incorrecta
- **Solución:** Verificar que `publish.url` en `ofc-desktop/electron-builder.yml` es correcto

**Problema:** Clientes web no ven UpdateNotification
- **Causa:** Vite no está compilando con `__APP_VERSION__`
- **Solución:** Ejecutar `npm run build` en ofc-client, verificar que vite.config.js lee version.json

## Notas

- Railway auto-detects cambios en `main` y redeploy automático (2-3 min)
- Logs de error están en `railway logs` (no en stdout)
- Database y Redis están provisioned automáticamente
- HTTPS está configurado automáticamente
- No requiere manual scaling si todos los usuarios están en 1-2 plataformas
