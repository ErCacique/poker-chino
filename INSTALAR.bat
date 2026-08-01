@echo off
setlocal enabledelayedexpansion

title OFC PINEAPPLE - Instalador

echo.
echo ========================================
echo   OFC PINEAPPLE - Instalador Windows
echo ========================================
echo.

cd /d "%~dp0"

REM Verificar Node.js
echo Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Node.js no encontrado!
    echo Descarga Node.js desde: https://nodejs.org/
    echo Luego ejecuta este script de nuevo.
    pause
    exit /b 1
)

echo [OK] Node.js instalado

REM Crear directorios
echo.
echo Creando directorios...
if not exist "ofc-client" mkdir ofc-client
if not exist "tests" mkdir tests
echo [OK] Directorios creados

REM Instalar dependencias
echo.
echo Instalando dependencias NPM...
call npm install --silent

if errorlevel 1 (
    echo.
    echo ERROR: fallo al instalar dependencias
    pause
    exit /b 1
)

echo [OK] Dependencias instaladas

REM Ejecutar pruebas
echo.
echo ========================================
echo Ejecutando pruebas...
echo ========================================
call npm test 2>nul

REM Instalar cliente
echo.
echo Instalando cliente React...
cd ofc-client
call npm install --silent 2>nul
cd ..
echo [OK] Cliente instalado

REM Mostrar instrucciones finales
echo.
echo ========================================
echo      LISTO PARA ARRANCAR!
echo ========================================
echo.
echo ABRE DOS POWERSHELL (no cierres ninguna):
echo.
echo PowerShell 1 (Servidor):
echo   PS ^> cd C:\PROYECTOS\POKER-CHINO
echo   PS ^> npm start
echo.
echo PowerShell 2 (Cliente):
echo   PS ^> cd C:\PROYECTOS\POKER-CHINO\ofc-client
echo   PS ^> npm run dev
echo.
echo LUEGO ABRE EN NAVEGADOR:
echo   http://localhost:5173
echo.
echo Abre dos pestanas o navegadores y click en Buscar partida
echo.
echo ========================================
echo.

pause
