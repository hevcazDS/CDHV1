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

echo Iniciando dashboard en segundo plano...
call npx pm2 start ecosystem.config.js --only dashboard

echo Iniciando bot en esta ventana...
call node bot/index.js
