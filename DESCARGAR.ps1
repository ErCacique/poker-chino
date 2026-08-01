# Script para descargar archivos del proyecto
# El usuario debe ejecutar esto después de descargar los archivos

$projectDir = "C:\PROYECTOS\POKER-CHINO"

Write-Host "============================================"
Write-Host "OFC PINEAPPLE - Verificador de Archivos"
Write-Host "============================================`n"

# Lista de archivos requeridos
$requiredFiles = @(
    "ofc-engine.js",
    "ofc-table.js",
    "app.js",
    "ws-server.js",
    "ofc-auth.js",
    "ofc-db.js",
    "ofc-store.js",
    "ofc-push.js",
    "ofc-limits.js",
    "test-helpers.js",
    "ofc-engine.test.js",
    "ofc-table.test.js",
    "ws-server.test.js"
)

Write-Host "Instrucciones de descarga:`n"
Write-Host "1. Abre: https://claude.ai/share/dbc047d2-cc59-476c-88f0-b16749f8e07d"
Write-Host "2. Busca los botones 'Ver Ofc engine', 'Ver Ofc table', etc."
Write-Host "3. Descarga cada archivo y guarda en: $projectDir"
Write-Host "4. Descarga ofc-client.zip y extrae en: $projectDir\ofc-client"
Write-Host ""

$downloaded = 0
Write-Host "Verificando archivos descargados:`n"
foreach ($file in $requiredFiles) {
    $path = Join-Path $projectDir $file
    if (Test-Path $path) {
        $size = (Get-Item $path).Length / 1024
        Write-Host "[OK] $file ($([math]::Round($size, 2)) KB)"
        $downloaded++
    } else {
        Write-Host "[FALTA] $file"
    }
}

Write-Host ""
Write-Host "Progreso: $downloaded / $($requiredFiles.Count) archivos"
Write-Host ""

if ($downloaded -eq $requiredFiles.Count) {
    Write-Host "Todos los archivos descargados. Ejecutando instalacion..." -ForegroundColor Green
    & "$projectDir\npm-install.ps1"
} else {
    Write-Host "Descargar los archivos faltantes y ejecuta este script de nuevo" -ForegroundColor Yellow
    Read-Host "Presiona Enter para cerrar"
}
