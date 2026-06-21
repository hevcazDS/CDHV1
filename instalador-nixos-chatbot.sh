#!/usr/bin/env bash
# instalador-nixos-chatbot.sh — equivalente NixOS de instalador-windows-chatbot.ps1:
# revisa qué ya está instalado y solo reinstala lo que falta o está roto.
#
# Texto plano, sin empaquetar a binario — mismo criterio que el instalador de
# Windows (ver su cabecera): un script visible es más fácil de auditar y no
# depende de herramientas de empaquetado. Pensado para correr dentro de
# `nix develop` (o con `nix run .#instalar`), donde Node 20 / sqlite / chromium
# ya los provee flake.nix — pero también funciona si Node 20+ ya está en PATH.
#
# Uso no interactivo: ENV_PATH=/ruta/a/.env ./instalador-nixos-chatbot.sh
set -uo pipefail

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32mOK: %s\033[0m\n' "$1"; }
warn() { printf '    \033[33mAVISO: %s\033[0m\n' "$1"; }
err()  { printf '    \033[31mERROR: %s\033[0m\n' "$1"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# ── Reporte final — qué se pidió vs qué quedó realmente instalado. Se llena
# conforme avanza el script y se escribe a disco tanto al terminar bien como
# en cualquier salida fatal (npm ci, etc.), para que un fallo a medias deje
# constancia de qué sí alcanzó a quedar listo.
REPORTE_PATH="$REPO_ROOT/reporte-instalacion.txt"
NODE_VERSION_DETECTADA="(no detectado)"
NPM_VERSION_DETECTADA="(no detectado)"
PM2_STATUS="no verificado"
NPM_CI_STATUS="no ejecutado"
DASHBOARD_UI_STATUS="no ejecutado"
REACT_VERSION_INSTALADA="(no detectado)"
DESKTOP_STATUS="no ejecutado"
ENV_STATUS="no configurado"
DB_STATUS="no configurada"

escribir_reporte() {
  {
    echo "Reporte de instalación — Chatbot Julio Cepeda (NixOS/Linux)"
    echo "Fecha: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "================================================="
    echo "Node.js requerido: 20.x | detectado: $NODE_VERSION_DETECTADA"
    echo "npm detectado: $NPM_VERSION_DETECTADA"
    echo "Chromium detectado: ${CHROME_PATH_DETECTADO:-no encontrado}"
    echo "pm2: $PM2_STATUS"
    echo "-------------------------------------------------"
    echo "npm ci (dependencias raíz, exacto a package-lock.json): $NPM_CI_STATUS"
    echo "dashboard-ui (panel React, npm install + build): $DASHBOARD_UI_STATUS"
    echo "  React realmente instalado en dashboard-ui/node_modules: $REACT_VERSION_INSTALADA"
    echo "desktop (ventana Electron / botdashapp, npm install): $DESKTOP_STATUS"
    echo "-------------------------------------------------"
    echo ".env: $ENV_STATUS"
    echo "Base de datos: $DB_STATUS"
    echo "================================================="
  } > "$REPORTE_PATH"
  ok "Reporte de instalación escrito en: $REPORTE_PATH"
}

echo "================================================="
echo "  Instalador NixOS - Chatbot Julio Cepeda"
echo "================================================="

# ── 1) Node.js ──────────────────────────────────────────────────────────
step "Verificando Node.js (se requiere 20.x)"
if ! command -v node >/dev/null 2>&1; then
  err "Node.js no encontrado en PATH. Entra al dev shell primero: nix develop"
  escribir_reporte
  exit 1
fi
NODE_VERSION_DETECTADA="$(node --version)"
NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" = "20" ]; then
  ok "Node.js $NODE_VERSION_DETECTADA"
else
  warn "Node.js $NODE_VERSION_DETECTADA instalado, pero el proyecto fue probado en 20.x."
  warn "Si entraste con 'nix develop' deberías tener la 20.x del flake.nix."
fi

# ── 2) npm ──────────────────────────────────────────────────────────────
step "Verificando npm"
if ! command -v npm >/dev/null 2>&1; then
  err "npm no encontrado (debería venir junto con Node.js)."
  escribir_reporte
  exit 1
fi
NPM_VERSION_DETECTADA="$(npm --version)"
ok "npm $NPM_VERSION_DETECTADA"

# ── 3) Chromium (para CHROME_PATH) ───────────────────────────────────────
step "Verificando Chromium"
CHROME_PATH_DETECTADO=""
for candidato in chromium chromium-browser google-chrome; do
  if command -v "$candidato" >/dev/null 2>&1; then
    CHROME_PATH_DETECTADO="$(command -v "$candidato")"
    ok "Encontrado: $CHROME_PATH_DETECTADO"
    break
  fi
done
if [ -z "$CHROME_PATH_DETECTADO" ]; then
  warn "No se encontró chromium en PATH. Si estás en 'nix develop' debería estar (flake.nix lo incluye)."
  warn "Si no, define CHROME_PATH manualmente en .env."
fi

# ── 4) pm2 (gestor de procesos) ──────────────────────────────────────────
step "Verificando pm2"
if npx --no-install pm2 --version >/dev/null 2>&1; then
  PM2_STATUS="disponible ($(npx --no-install pm2 --version))"
  ok "pm2 $(npx --no-install pm2 --version)"
else
  PM2_STATUS="no disponible (se usará 'npx pm2' al arrancar)"
  warn "pm2 no está disponible todavía; se usará 'npx pm2' (lo descarga la primera vez) al arrancar."
fi

# ── 5) Estado de node_modules ─────────────────────────────────────────────
step "Revisando node_modules"
NEEDS_FRESH=0
if [ ! -d node_modules ]; then
  warn "node_modules no existe todavía."
  NEEDS_FRESH=1
else
  if node -e "require('better-sqlite3')" >/dev/null 2>&1; then
    ok "node_modules presente y el módulo nativo carga bien."
  else
    warn "better-sqlite3 no carga (node_modules corrupto o de otra plataforma)."
    NEEDS_FRESH=1
  fi
fi
if [ "$NEEDS_FRESH" = "1" ] && [ -d node_modules ]; then
  step "Borrando node_modules para reinstalar desde cero"
  rm -rf node_modules
fi

# ── 6) Instalar dependencias — siempre exacto al lockfile ────────────────
step "Instalando dependencias (npm ci)"
if ! npm ci; then
  err "npm ci falló. Revisa el mensaje de arriba (¿faltan herramientas de compilación para algún módulo nativo? prueba 'nix develop')."
  NPM_CI_STATUS="FALLÓ"
  escribir_reporte
  exit 1
fi
ok "Dependencias instaladas."
NPM_CI_STATUS="OK"

# ── 6b) Panel en React (dashboard-ui) ────────────────────────────────────
step "Instalando y compilando el panel (dashboard-ui)"
if (cd dashboard-ui && npm install); then
  if (cd dashboard-ui && npm run build); then
    ok "Panel en React compilado (dashboard-ui/dist)."
    DASHBOARD_UI_STATUS="OK (install + build)"
  else
    warn "El build de dashboard-ui falló. El dashboard caerá al HTML clásico (dashboard.html)."
    DASHBOARD_UI_STATUS="install OK, build FALLÓ"
  fi
else
  warn "npm install en dashboard-ui falló. El dashboard caerá al HTML clásico (dashboard.html)."
  DASHBOARD_UI_STATUS="install FALLÓ"
fi
if [ -f dashboard-ui/node_modules/react/package.json ]; then
  REACT_VERSION_INSTALADA="$(node -p "require('./dashboard-ui/node_modules/react/package.json').version" 2>/dev/null || echo "(no se pudo leer la version)")"
else
  REACT_VERSION_INSTALADA="NO instalado (revisa el log de npm install de arriba)"
fi

# ── 6c) Ventana de escritorio (desktop, Electron / botdashapp) ───────────
step "Instalando la ventana de escritorio (desktop / botdashapp)"
if (cd desktop && npm install); then
  ok "Ventana de escritorio (botdashapp) lista."
  DESKTOP_STATUS="OK"
else
  warn "npm install en desktop falló. iniciar-nixos-chatbot.sh no podrá abrir la ventana de escritorio."
  DESKTOP_STATUS="FALLÓ"
fi

# Helper: escribe o reemplaza una clave=valor en .env (la agrega si no existía).
set_env_var() {
  local clave="$1" valor="$2"
  if grep -qE "^${clave}=" .env 2>/dev/null; then
    # usa | como delimitador de sed porque algunos valores (rutas Windows
    # copiadas a un .env, URLs) pueden traer '/'
    sed -i "s|^${clave}=.*|${clave}=${valor}|" .env
  else
    printf '%s=%s\n' "$clave" "$valor" >> .env
  fi
}

# Helper: pregunta interactiva con valor por defecto. Si no hay terminal (CI,
# ENV_PATH no interactivo, etc.) usa el default sin bloquear esperando input.
ask_var() {
  local prompt="$1" default="$2" valor=""
  if [ -t 0 ]; then
    read -r -p "    $prompt${default:+ [$default]}: " valor || true
  fi
  echo "${valor:-$default}"
}

# ── 7) .env ────────────────────────────────────────────────────────────
step "Configurando .env"
ENV_LISTO=0
MODO_ENV=""

if [ -n "${ENV_PATH:-}" ]; then
  # Modo no interactivo explícito: ya nos dijeron de dónde copiarlo.
  if [ -f "$ENV_PATH" ]; then
    cp "$ENV_PATH" .env
    ok ".env copiado desde: $ENV_PATH"
    ENV_LISTO=1
    ENV_STATUS="copiado desde ENV_PATH ($ENV_PATH)"
  else
    err "ENV_PATH apunta a un archivo que no existe: $ENV_PATH"
    ENV_STATUS="ERROR: ENV_PATH no existe ($ENV_PATH)"
  fi
elif [ -f .env ] && [ -t 0 ]; then
  ok ".env ya existe en esta carpeta."
  MODO_ENV="$(ask_var '¿Usar el .env existente (U), apuntar a OTRO archivo .env (O), o crear uno nuevo guiado (N)?' U)"
elif [ -f .env ]; then
  ok ".env ya existe en esta carpeta (sin terminal interactiva, se usa tal cual)."
  ENV_LISTO=1
  ENV_STATUS="existente, sin cambios (sin terminal interactiva)"
else
  MODO_ENV="$(ask_var '¿Tienes ya un .env de otra instalación/backup que quieras usar (O), o prefieres llenarlo paso a paso (N)?' N)"
fi

if [ -n "${MODO_ENV:-}" ]; then
case "$(echo "${MODO_ENV:-}" | tr '[:lower:]' '[:upper:]')" in
  U)
    ENV_LISTO=1
    ENV_STATUS="existente, sin cambios"
    ;;
  O)
    ORIGEN="$(ask_var 'Ruta completa al archivo .env a usar' '')"
    if [ -n "$ORIGEN" ] && [ -f "$ORIGEN" ]; then
      cp "$ORIGEN" .env
      ok ".env copiado desde: $ORIGEN"
      ENV_LISTO=1
      ENV_STATUS="copiado desde: $ORIGEN"
    else
      err "No se encontró ese archivo: $ORIGEN"
      ENV_STATUS="ERROR: no se encontró $ORIGEN"
    fi
    ;;
  N)
    cp .env.example .env
    step "Llenando .env paso a paso (Enter para dejar el valor entre []) "
    NOMBRE_NEGOCIO="$(ask_var 'Nombre del negocio (para personalizar al bot)' '')"
    TONO_BOT="$(ask_var 'Tono del bot: A=formal, B=casual, C=amigable, D=ventas/urgencia' C)"
    set_env_var DASHBOARD_USER "$(ask_var 'Usuario admin del dashboard' admin)"
    DASH_PASS_NUEVO="$(ask_var 'Password del usuario admin del dashboard' '')"
    [ -n "$DASH_PASS_NUEVO" ] && set_env_var DASHBOARD_PASS "$DASH_PASS_NUEVO"
    USER_PRIME_NUEVO="$(ask_var 'Usuario "prime" (inventario/sucursales) -- vacío si no se usa todavía' '')"
    if [ -n "$USER_PRIME_NUEVO" ]; then
      set_env_var USER_PRIME "$USER_PRIME_NUEVO"
      set_env_var USER_PRIME_PASSWORD "$(ask_var 'Password del usuario prime' '')"
    fi
    set_env_var CHROME_PATH "$(ask_var 'Ruta a chromium/chrome' "$CHROME_PATH_DETECTADO")"
    set_env_var ASESOR_WHATSAPP "$(ask_var 'WhatsApp del asesor humano (con código de país, ej. 521...)' '')"
    set_env_var FLETE_UMBRAL "$(ask_var 'Monto mínimo de compra para envío gratis' 699)"
    ok ".env creado paso a paso."
    ENV_LISTO=1
    ENV_STATUS="creado paso a paso (guiado)"
    ;;
  *)
    warn "Opción no reconocida ($MODO_ENV) -- se deja .env como estaba."
    ENV_LISTO=1
    ENV_STATUS="sin cambios (opción no reconocida: $MODO_ENV)"
    ;;
esac
fi

if [ "$ENV_LISTO" != "1" ] && [ -f .env.example ]; then
  cp .env.example .env
  warn ".env creado desde .env.example (vacío). EDÍTALO con tus valores reales antes de arrancar."
  ENV_LISTO=1
  ENV_STATUS="creado desde .env.example (vacío -- falta editar con valores reales)"
elif [ "$ENV_LISTO" != "1" ]; then
  warn "No existe .env ni .env.example. Crea .env manualmente con las variables que necesita el bot."
  ENV_STATUS="ERROR: no existe .env ni .env.example"
fi

if [ "$ENV_LISTO" = "1" ] && [ -f .env ]; then
  for clave in DASHBOARD_PASS ASESOR_WHATSAPP; do
    linea="$(grep -E "^${clave}=" .env || true)"
    if [ -z "$linea" ] || [ "$linea" = "${clave}=" ] || [ "$linea" = "${clave}=cambiar_esto" ]; then
      warn "$clave está vacío o con el valor de ejemplo en .env -- revísalo antes de arrancar."
    fi
  done
  if [ -n "$CHROME_PATH_DETECTADO" ] && ! grep -qE '^CHROME_PATH=.+' .env; then
    set_env_var CHROME_PATH "$CHROME_PATH_DETECTADO"
    ok "CHROME_PATH agregado a .env automáticamente."
  fi
fi

# ── 8) Base de datos ─────────────────────────────────────────────────────
step "Configurando la base de datos"
DB_PATH_ACTUAL="$(grep -E '^DB_PATH=' .env 2>/dev/null | cut -d= -f2-)"
if [ -n "$DB_PATH_ACTUAL" ] && [ -f "$DB_PATH_ACTUAL" ]; then
  ok "DB_PATH ya apunta a un archivo existente: $DB_PATH_ACTUAL -- se verifica que tenga todo lo necesario."
  node scripts/instalarBaseDeDatos.js verificar-y-completar "$DB_PATH_ACTUAL"
  DB_STATUS="existente, verificada/completada: $DB_PATH_ACTUAL"
else
  MODO_DB="$(ask_var '¿Crear una base de datos NUEVA (N) o ya tienes una y solo hay que apuntarla/completarla (E)?' N)"
  if [ "$(echo "$MODO_DB" | tr '[:lower:]' '[:upper:]')" = "E" ]; then
    RUTA_DB="$(ask_var 'Ruta completa al archivo .db existente' '')"
    SALIDA_DB="$(node scripts/instalarBaseDeDatos.js verificar-y-completar "$RUTA_DB")"
    DB_MODO_DESC="existente, verificada/completada"
  else
    RUTA_DB="$(ask_var 'Ruta donde crear la base de datos nueva' "$REPO_ROOT/db/jugueteria.db")"
    SALIDA_DB="$(node scripts/instalarBaseDeDatos.js crear-nueva "$RUTA_DB" "${NOMBRE_NEGOCIO:-}" "${TONO_BOT:-}")"
    DB_MODO_DESC="nueva, creada desde cero"
  fi
  DB_PATH_RESULTANTE="$(echo "$SALIDA_DB" | grep '^DB_PATH=' | cut -d= -f2-)"
  if [ -n "$DB_PATH_RESULTANTE" ]; then
    set_env_var DB_PATH "$DB_PATH_RESULTANTE"
    ok "DB_PATH escrito en .env: $DB_PATH_RESULTANTE"
    DB_STATUS="$DB_MODO_DESC: $DB_PATH_RESULTANTE"
  else
    err "No se pudo determinar la ruta de la base de datos -- revisa el mensaje de arriba y define DB_PATH manualmente en .env."
    DB_STATUS="ERROR: no se pudo determinar la ruta (revisa el log de arriba)"
  fi
fi

escribir_reporte

echo ""
echo "================================================="
echo "  Listo."
echo "  Revisa .env y luego corre ./iniciar-nixos-chatbot.sh (o npm run start:all)."
echo "  Reporte de instalación: $REPORTE_PATH"
echo "================================================="
