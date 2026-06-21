#!/usr/bin/env bash
# detener-nixos-chatbot.sh — equivalente NixOS de stop.bat.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

read -r -p "¿Confirmar apagar el bot y el dashboard (PM2)? (s/N): " confirm
case "$confirm" in
  s|S) ;;
  *) exit 0 ;;
esac

echo "Apagando bot-whatsapp y dashboard..."
npx pm2 stop all
echo "Servicios cerrados."
