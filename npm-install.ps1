# Script de instalacion automatica OFC PINEAPPLE

$projectDir = "C:\PROYECTOS\POKER-CHINO"
Set-Location $projectDir

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "FASE 1: Instalando dependencias"
Write-Host "========================================`n" -ForegroundColor Green

npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error al instalar dependencias" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "FASE 2: Ejecutando pruebas"
Write-Host "========================================`n" -ForegroundColor Green

npm test

if ($LASTEXITCODE -ne 0) {
    Write-Host "Algunas pruebas fallaron" -ForegroundColor Yellow
} else {
    Write-Host "Todas las pruebas pasaron!" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "FASE 3: Instalando cliente"
Write-Host "========================================`n" -ForegroundColor Green

if (Test-Path "ofc-client") {
    Set-Location "ofc-client"
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Cliente instalado" -ForegroundColor Green
    }
    Set-Location $projectDir
} else {
    Write-Host "Carpeta ofc-client no encontrada" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "LISTO PARA ARRANCAR"
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "ABRE DOS POWERSHELL:"
Write-Host ""
Write-Host "PowerShell 1 (Servidor):"
Write-Host "  PS> cd $projectDir"
Write-Host "  PS> npm start"
Write-Host ""
Write-Host "PowerShell 2 (Cliente):"
Write-Host "  PS> cd $projectDir\ofc-client"
Write-Host "  PS> npm run dev"
Write-Host ""
Write-Host "LUEGO ABRE:"
Write-Host "  http://localhost:5173"
Write-Host ""
Write-Host "========================================" -ForegroundColor Green

Read-Host "Presiona Enter para terminar"
