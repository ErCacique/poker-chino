# OFC PINEAPPLE - INSTALADOR WINDOWS

$ErrorActionPreference = "Stop"

Write-Host "================================"
Write-Host "OFC PINEAPPLE - Instalador"
Write-Host "================================" -ForegroundColor Cyan

$projectDir = "C:\PROYECTOS\POKER-CHINO"
Set-Location $projectDir

# Verificar Node.js
Write-Host "[1/5] Verificando Node.js..."
$nodeVersion = node --version
Write-Host "[OK] Node.js $nodeVersion"

# Crear directorios
Write-Host "[2/5] Creando directorios..."
$dirs = @("ofc-client", "tests", "src")
foreach ($dir in $dirs) {
  $fullPath = Join-Path $projectDir $dir
  if (-not (Test-Path $fullPath)) {
    New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
  }
}
Write-Host "[OK] Directorios listos"

# Instalar npm
Write-Host "[3/5] Instalando dependencias NPM..."
if (Test-Path "node_modules") {
  Write-Host "[OK] node_modules ya existe"
} else {
  npm install --silent
  Write-Host "[OK] Dependencias instaladas"
}

# Crear .env
Write-Host "[4/5] Configurando variables..."
$envFile = Join-Path $projectDir ".env"
if (-not (Test-Path $envFile)) {
  @"
NODE_ENV=development
PORT=8080
ALLOW_DEV_TOKENS=1
"@ | Set-Content $envFile
  Write-Host "[OK] .env creado"
}

# Verificar
Write-Host "[5/5] Verificando instalacion..."
if ((Test-Path "package.json") -and (Test-Path "node_modules")) {
  Write-Host "[OK] Instalacion completa"
} else {
  Write-Host "[ERROR] Falta algo"
  exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "TODO LISTO PARA JUGAR" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "ARCHIVOS QUE NECESITAS DESCARGAR:"
Write-Host ""
Write-Host "1. Abre: https://claude.ai/share/dbc047d2-cc59-476c-88f0-b16749f8e07d"
Write-Host ""
Write-Host "2. Descarga estos archivos y coloca en: C:\PROYECTOS\POKER-CHINO\"
Write-Host "   - ofc-engine.js"
Write-Host "   - ofc-table.js"
Write-Host "   - app.js (o ws-server.js)"
Write-Host "   - ofc-auth.js, ofc-db.js, ofc-store.js, ofc-push.js, ofc-limits.js"
Write-Host "   - test-helpers.js"
Write-Host "   - Todos los *.test.js"
Write-Host ""
Write-Host "3. Descarga ofc-client.zip y extrae en: C:\PROYECTOS\POKER-CHINO\ofc-client\"
Write-Host ""
Write-Host "LUEGO EJECUTA:"
Write-Host ""
Write-Host "PowerShell 1 (Servidor):"
Write-Host "  PS> cd C:\PROYECTOS\POKER-CHINO"
Write-Host "  PS> npm start"
Write-Host ""
Write-Host "PowerShell 2 (Cliente):"
Write-Host "  PS> cd C:\PROYECTOS\POKER-CHINO\ofc-client"
Write-Host "  PS> npm install"
Write-Host "  PS> npm run dev"
Write-Host ""
Write-Host "LUEGO ABRE:"
Write-Host "  http://localhost:5173"
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
