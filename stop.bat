@echo off
title Cerrar Servicios Hevcaz
color 0C
cd /d "%~dp0"
set /p confirm="¿Confirmar apagar el bot y el dashboard (PM2)? (S/N): "
if /i not "%confirm%"=="S" exit /b

echo Apagando bot-whatsapp y dashboard...
call npx pm2 stop all
echo Servicios cerrados.
pause
