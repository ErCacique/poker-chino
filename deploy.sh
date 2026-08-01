#!/bin/bash
# Script de deployment automático: compila, comprime y sube las nuevas versiones a Railway.

set -e

echo "=== Pineapple OFC Auto-Deploy ==="

# Leer versión de version.json
VERSION=$(jq -r '.version' version.json)
echo "Versión actual: $VERSION"

# 1. Compilar Windows Electron
echo "▪ Compilando Windows Electron..."
cd ofc-desktop
npm install --legacy-peer-deps
npm run dist:win
cd ..

# 2. Compilar Android APK
echo "▪ Compilando Android APK..."
cd ofc-client
npm install --legacy-peer-deps
npm run build:android:apk
cd ..

# 3. Crear carpeta updates si no existe
echo "▪ Preparando carpeta de updates..."
mkdir -p updates

# 4. Copiar binarios a updates/
echo "▪ Copiando binarios..."
cp "ofc-desktop/release/PineappleOFC-Windows-v${VERSION}.zip" updates/ 2>/dev/null || \
  zip -r "updates/PineappleOFC-Windows-v${VERSION}.zip" ofc-desktop/release/ -x "*.tar.gz" "*.exe" "*/node_modules/*"
cp "ofc-client/android/app/build/outputs/apk/debug/app-debug.apk" "updates/PineappleOFC-Android-Debug-v${VERSION}.apk" 2>/dev/null || \
  echo "Nota: APK no encontrado en ubicación esperada"

# 5. Subir a Railway (git push automático)
echo "▪ Subiendo a Railway..."
git add -A
git commit -m "Deploy v${VERSION}: auto-update binaries" || echo "Sin cambios para commit"
git push railway main

echo "✓ Deploy completado para v${VERSION}"
echo "  - Los clientes chequearán updates en la próxima hora"
