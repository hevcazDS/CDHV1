@echo off
title Control del bot - Hevcaz
cd /d "%~dp0"

if "%~1"=="" goto :menu
goto :ejecutar

:menu
echo.
echo  1. Encender bot
echo  2. Apagar bot
echo  3. Reiniciar bot (tambien reabre Electron)
echo.
set /p opcion="Elige una opcion (1-3): "
if "%opcion%"=="1" set accion=start
if "%opcion%"=="2" set accion=stop
if "%opcion%"=="3" set accion=restart
if not defined accion (
    echo Opcion invalida.
    pause
    exit /b 1
)
goto :correr

:ejecutar
set accion=%~1

:correr
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bot-control.ps1" -Accion %accion%
echo.
echo Listo.
pause
