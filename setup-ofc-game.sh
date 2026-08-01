#!/bin/bash
set -e

echo "╔════════════════════════════════════════════════════════╗"
echo "║  SETUP OFC PINEAPPLE GAME - Instalación Automática    ║"
echo "╚════════════════════════════════════════════════════════╝"
echo

# 1. Crear carpeta
echo "📁 Creando directorio de proyecto..."
mkdir -p ~/ofc-game
cd ~/ofc-game
echo "   ✓ Carpeta: ~/ofc-game"
echo

# 2. Copiar archivos del servidor
echo "📋 Copiando archivos del servidor..."
cp /mnt/user-data/outputs/package.json .
cp /mnt/user-data/outputs/app.js .
cp /mnt/user-data/outputs/ws-server.js .
cp /mnt/user-data/outputs/ofc-*.js .
cp /mnt/user-data/outputs/test-helpers.js .
cp /mnt/user-data/outputs/*test.js .
echo "   ✓ Archivos copiados"
echo

# 3. Descomprimir cliente
echo "📦 Descomprimiendo cliente React..."
unzip -q /mnt/user-data/outputs/ofc-client.zip
echo "   ✓ Cliente listo en: ofc-client/"
echo

# 4. Copiar resumen
cp /mnt/user-data/outputs/conversacion-completa.json .
echo "   ✓ Documentación: conversacion-completa.json"
echo

# 5. Crear .env
echo "⚙️  Creando archivo de configuración..."
cat > .env << 'ENV'
PORT=8080
ALLOW_DEV_TOKENS=1
SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "dev-secret-change-in-production")
ENV
echo "   ✓ .env creado"
echo

# 6. Instalar dependencias servidor
echo "📥 Instalando dependencias del servidor..."
npm install --silent 2>&1 | grep -E "^(added|up to date)" || echo "   ✓ npm install completado"
echo

# 7. Instalar cliente
echo "📥 Instalando dependencias del cliente..."
cd ofc-client
npm install --silent 2>&1 | grep -E "^(added|up to date)" || echo "   ✓ npm install completado"
cd ..
echo

# 8. Verificar estructura
echo "✅ Verificación de archivos..."
FILES_NEEDED=("package.json" "app.js" "ws-server.js" "ofc-engine.js" "ofc-table.js")
MISSING=0
for f in "${FILES_NEEDED[@]}"; do
  if [ -f "$f" ]; then
    echo "   ✓ $f"
  else
    echo "   ✗ FALTA: $f"
    MISSING=$((MISSING + 1))
  fi
done

if [ -d "ofc-client/src" ]; then
  echo "   ✓ ofc-client/src/"
else
  echo "   ✗ FALTA: ofc-client/src"
  MISSING=$((MISSING + 1))
fi

echo
if [ $MISSING -eq 0 ]; then
  echo "╔════════════════════════════════════════════════════════╗"
  echo "║            ✅ TODO LISTO PARA JUGAR                   ║"
  echo "╚════════════════════════════════════════════════════════╝"
  echo
  echo "📍 UBICACIÓN: ~/ofc-game/"
  echo
  echo "🚀 PARA ARRANCAR:"
  echo
  echo "   Terminal 1 (Servidor):"
  echo "   $ cd ~/ofc-game"
  echo "   $ npm start"
  echo
  echo "   Terminal 2 (Cliente):"
  echo "   $ cd ~/ofc-game/ofc-client"
  echo "   $ npm run dev"
  echo
  echo "   Abre navegador en: http://localhost:5173"
  echo
  echo "🧪 PARA EJECUTAR PRUEBAS:"
  echo "   $ npm test"
  echo
else
  echo "❌ ERROR: Faltan $MISSING archivos. Contacta al desarrollador."
  exit 1
fi
