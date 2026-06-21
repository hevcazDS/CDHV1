@echo off
title Julio Cepeda Bot + Dashboard
cd /d "%~dp0"

REM Limpia procesos previos que puedan dejar Chrome/WhatsApp bloqueado.
call npx pm2 kill >nul 2>&1
call npx pm2 delete all >nul 2>&1
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM chrome.exe /T >nul 2>&1
taskkill /F /IM chromium.exe /T >nul 2>&1
taskkill /F /IM msedge.exe /T >nul 2>&1
taskkill /F /IM electron.exe /T >nul 2>&1

echo Iniciando bot y dashboard via PM2...
call npx pm2 start ecosystem.config.js

echo.
echo Listo. Abre http://localhost:3001 para ver el estado del bot y, si hace
echo falta, escanear el QR de WhatsApp (aparece ahi mismo, en Inicio).
echo El bot y el dashboard quedan corriendo en segundo plano via PM2.
echo Usa stop.bat para apagarlos.
pause
