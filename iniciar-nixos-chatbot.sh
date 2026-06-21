#!/usr/bin/env bash
# iniciar-nixos-chatbot.sh — equivalente NixOS de start.bat: levanta bot +
# dashboard vía PM2 y abre la ventana de escritorio (botdashapp) en vez del
# navegador default de la máquina.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

echo "Iniciando Bot + Dashboard..."
npx pm2 start ecosystem.config.js

# Ventana tipo app de escritorio (botdashapp). Al cerrarla, pregunta si solo
# se cierra la ventana (el bot sigue corriendo via PM2) o si se apaga todo.
npm --prefix desktop start
