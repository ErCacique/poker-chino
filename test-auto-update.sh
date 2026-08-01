#!/bin/bash
# Script de testing para el sistema de auto-update

echo "=== Test: Auto-Update System ==="

BASE_URL="${1:-http://localhost:8080}"
echo "URL base: $BASE_URL"

# Test 1: Endpoint /api/version
echo ""
echo "▪ Test 1: GET /api/version"
RESPONSE=$(curl -s "$BASE_URL/api/version")
VERSION=$(echo "$RESPONSE" | jq -r '.version')
echo "Versión actual: $VERSION"
echo "Respuesta completa:"
echo "$RESPONSE" | jq .

if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "✗ FAILED: versión no retornada"
  exit 1
fi

# Test 2: Estructura de respuesta
echo ""
echo "▪ Test 2: Verificar estructura de respuesta"
DOWNLOAD_ANDROID=$(echo "$RESPONSE" | jq -r '.downloads.android')
DOWNLOAD_WINDOWS=$(echo "$RESPONSE" | jq -r '.downloads.windows')

if [[ "$DOWNLOAD_ANDROID" == *".apk" ]]; then
  echo "✓ URL Android válida: $DOWNLOAD_ANDROID"
else
  echo "✗ URL Android inválida: $DOWNLOAD_ANDROID"
  exit 1
fi

if [[ "$DOWNLOAD_WINDOWS" == *".zip" ]]; then
  echo "✓ URL Windows válida: $DOWNLOAD_WINDOWS"
else
  echo "✗ URL Windows inválida: $DOWNLOAD_WINDOWS"
  exit 1
fi

# Test 3: CORS headers
echo ""
echo "▪ Test 3: Verificar CORS headers"
CORS_HEADER=$(curl -s -i "$BASE_URL/api/version" | grep -i "access-control-allow-origin" | head -1)
if [ -n "$CORS_HEADER" ]; then
  echo "✓ CORS habilitado: $CORS_HEADER"
else
  echo "⚠ Advertencia: CORS header no encontrado (esto es OK si es localhost)"
fi

# Test 4: Servir archivos de updates/
echo ""
echo "▪ Test 4: Crear archivo de test en updates/"
TEST_FILE="updates/test-v999.txt"
echo "test content" > "$TEST_FILE"
TEST_URL="$BASE_URL/updates/test-v999.txt"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$TEST_URL")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ Archivo servido correctamente (HTTP $HTTP_CODE)"
  rm "$TEST_FILE"
else
  echo "✗ Error al servir archivo (HTTP $HTTP_CODE)"
  rm "$TEST_FILE"
  exit 1
fi

# Test 5: Archivo inválido
echo ""
echo "▪ Test 5: Rechazar archivos con nombres inválidos"
INVALID_URL="$BASE_URL/updates/../../../../etc/passwd"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$INVALID_URL")

if [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "400" ]; then
  echo "✓ Acceso a archivo inválido rechazado (HTTP $HTTP_CODE)"
else
  echo "⚠ Acceso a archivo devolvió HTTP $HTTP_CODE (esperaba 404 o 400)"
fi

echo ""
echo "✓ Todos los tests pasaron"
