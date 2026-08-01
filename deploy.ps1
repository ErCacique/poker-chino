# Script de deployment automático para Windows
# Uso: .\deploy.ps1

Write-Host "=== Pineapple OFC Auto-Deploy ===" -ForegroundColor Cyan

# Leer versión de version.json
$version = (Get-Content version.json | ConvertFrom-Json).version
Write-Host "Versión actual: $version" -ForegroundColor Green

# 1. Compilar Windows Electron
Write-Host "▪ Compilando Windows Electron..." -ForegroundColor Yellow
Push-Location ofc-desktop
npm install --legacy-peer-deps
npm run dist:win
Pop-Location

# 2. Compilar Android APK
Write-Host "▪ Compilando Android APK..." -ForegroundColor Yellow
Push-Location ofc-client
npm install --legacy-peer-deps
npm run build:android:apk
Pop-Location

# 3. Crear carpeta updates si no existe
Write-Host "▪ Preparando carpeta de updates..." -ForegroundColor Yellow
if (-not (Test-Path updates)) {
    New-Item -ItemType Directory -Path updates -Force | Out-Null
}

# 4. Copiar binarios a updates/
Write-Host "▪ Copiando binarios..." -ForegroundColor Yellow
$winZip = "ofc-desktop/release/PineappleOFC-Windows-v$version.zip"
$apkFile = "ofc-client/android/app/build/outputs/apk/debug/app-debug.apk"

if (Test-Path $winZip) {
    Copy-Item $winZip "updates/PineappleOFC-Windows-v$version.zip" -Force
} else {
    Write-Host "Nota: ZIP de Windows no encontrado en $winZip" -ForegroundColor Gray
}

if (Test-Path $apkFile) {
    Copy-Item $apkFile "updates/PineappleOFC-Android-Debug-v$version.apk" -Force
} else {
    Write-Host "Nota: APK no encontrado en $apkFile" -ForegroundColor Gray
}

# 5. Subir a Railway (git push automático)
Write-Host "▪ Subiendo a Railway..." -ForegroundColor Yellow
git add -A
try {
    git commit -m "Deploy v$version : auto-update binaries"
} catch {
    Write-Host "Sin cambios para commit" -ForegroundColor Gray
}
git push railway main

Write-Host "✓ Deploy completado para v$version" -ForegroundColor Green
Write-Host "  - Los clientes chequearán updates en la próxima hora" -ForegroundColor Gray
