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

# TUI con whiptail (paquete `newt`, ya en flake.nix) cuando hay una terminal
# real disponible -- pantallas claras de "qué está pasando" y menús de
# flechas en vez de tener que teclear una letra a mano (menos probabilidad
# de "marcar algo mal" sin querer). Si no hay whiptail (terminal mínima,
# CI, pipe) todo cae automáticamente al mismo texto plano de siempre: nada
# de lo de abajo es obligatorio para que el instalador funcione.
HAVE_WHIPTAIL=0
if command -v whiptail >/dev/null 2>&1 && [ -t 0 ] && [ -t 1 ]; then
  HAVE_WHIPTAIL=1
fi
TUI_TITULO="Instalador - Chatbot Julio Cepeda"
PASO_ACTUAL=0

step() {
  PASO_ACTUAL=$((PASO_ACTUAL + 1))
  printf '\n\033[36m==> %s\033[0m\n' "$1"
  if [ "$HAVE_WHIPTAIL" = "1" ]; then
    whiptail --title "$TUI_TITULO" --infobox "Paso $PASO_ACTUAL\n\n$1" 9 70
    sleep 1
  fi
}
ok()   { printf '    \033[32mOK: %s\033[0m\n' "$1"; }
warn() { printf '    \033[33mAVISO: %s\033[0m\n' "$1"; }
err()  { printf '    \033[31mERROR: %s\033[0m\n' "$1"; }

# Menú de una sola letra (U/O/N, N/E, etc.) con flechas en vez de teclear a
# mano. $1 = texto descriptivo (mismo que ya se usaba como prompt de
# ask_var), $2 = letra default, resto = pares letra/descripción para el
# menú. Si no hay whiptail, o el usuario cancela con Esc, cae al prompt de
# texto de siempre (ask_var) con ese mismo texto descriptivo.
pedir_opcion() {
  local titulo="$1" default="$2"; shift 2
  if [ "$HAVE_WHIPTAIL" = "1" ]; then
    local seleccion
    if seleccion="$(whiptail --title "$TUI_TITULO" --menu "$titulo" 16 76 6 "$@" --default-item "$default" 3>&1 1>&2 2>&3)"; then
      echo "$seleccion"
      return 0
    fi
    warn "Cancelado -- se usa la opción por defecto ($default)."
    echo "$default"
    return 0
  fi
  ask_var "$titulo" "$default"
}

# Como ask_var pero en un cuadro whiptail (más claro que escribir en la
# misma línea del prompt) cuando hay terminal TUI disponible.
pedir_valor() {
  local titulo="$1" default="$2"
  if [ "$HAVE_WHIPTAIL" = "1" ]; then
    local valor
    if valor="$(whiptail --title "$TUI_TITULO" --inputbox "$titulo" 10 70 "$default" 3>&1 1>&2 2>&3)"; then
      echo "$valor"
      return 0
    fi
    echo "$default"
    return 0
  fi
  ask_var "$titulo" "$default"
}

# Como pedir_valor pero enmascarando la entrada (passwordbox) -- para
# DASHBOARD_PASS/USER_PRIME_PASSWORD, que en texto plano sí muestran lo que
# se teclea.
pedir_password() {
  local titulo="$1"
  if [ "$HAVE_WHIPTAIL" = "1" ]; then
    local valor
    if valor="$(whiptail --title "$TUI_TITULO" --passwordbox "$titulo" 10 70 3>&1 1>&2 2>&3)"; then
      echo "$valor"
      return 0
    fi
    echo ""
    return 0
  fi
  ask_var "$titulo" ""
}

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
MIGRACIONES_STATUS="no ejecutado"

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
    echo "Migraciones (migrations/*.sql): $MIGRACIONES_STATUS"
    echo "================================================="
  } > "$REPORTE_PATH"
  ok "Reporte de instalación escrito en: $REPORTE_PATH"
  # Mismo contenido en una pantalla TUI con scroll -- se llama desde TODAS
  # las salidas (éxito y fallos a medias), así que esto siempre refleja el
  # estado real, no solo el del final feliz.
  if [ "$HAVE_WHIPTAIL" = "1" ]; then
    whiptail --title "$TUI_TITULO" --scrolltext --textbox "$REPORTE_PATH" 22 78
  fi
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
  MODO_ENV="$(pedir_opcion '¿Qué hacer con el .env que ya existe en esta carpeta?' U \
    U 'Usar el .env existente, sin cambios' \
    O 'Apuntar a OTRO archivo .env ya existente' \
    N 'Crear uno nuevo, paso a paso')"
elif [ -f .env ]; then
  ok ".env ya existe en esta carpeta (sin terminal interactiva, se usa tal cual)."
  ENV_LISTO=1
  ENV_STATUS="existente, sin cambios (sin terminal interactiva)"
else
  MODO_ENV="$(pedir_opcion '¿Ya tienes un .env de otra instalación/backup, o prefieres llenarlo paso a paso?' N \
    O 'Ya tengo un .env de otra instalación/backup' \
    N 'Llenarlo paso a paso (guiado)')"
fi

if [ -n "${MODO_ENV:-}" ]; then
case "$(echo "${MODO_ENV:-}" | tr '[:lower:]' '[:upper:]')" in
  U)
    ENV_LISTO=1
    ENV_STATUS="existente, sin cambios"
    ;;
  O)
    ORIGEN="$(pedir_valor 'Ruta completa al archivo .env a usar' '')"
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
    NOMBRE_NEGOCIO="$(pedir_valor 'Nombre del negocio (para personalizar al bot)' '')"
    TONO_BOT="$(pedir_opcion 'Tono del bot' C \
      A 'Formal' \
      B 'Casual' \
      C 'Amigable (recomendado)' \
      D 'Ventas / urgencia')"
    set_env_var DASHBOARD_USER "$(pedir_valor 'Usuario admin del dashboard' admin)"
    DASH_PASS_NUEVO="$(pedir_password 'Password del usuario admin del dashboard')"
    [ -n "$DASH_PASS_NUEVO" ] && set_env_var DASHBOARD_PASS "$DASH_PASS_NUEVO"
    USER_PRIME_NUEVO="$(pedir_valor 'Usuario "prime" (inventario/sucursales) -- vacío si no se usa todavía' '')"
    if [ -n "$USER_PRIME_NUEVO" ]; then
      set_env_var USER_PRIME "$USER_PRIME_NUEVO"
      set_env_var USER_PRIME_PASSWORD "$(pedir_password 'Password del usuario prime')"
    fi
    set_env_var CHROME_PATH "$(pedir_valor 'Ruta a chromium/chrome' "$CHROME_PATH_DETECTADO")"
    set_env_var ASESOR_WHATSAPP "$(pedir_valor 'WhatsApp del asesor humano (con código de país, ej. 521...)' '')"
    set_env_var FLETE_UMBRAL "$(pedir_valor 'Monto mínimo de compra para envío gratis' 699)"
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
  MODO_DB="$(pedir_opcion '¿Qué hacer con la base de datos?' N \
    N 'Crear una base de datos NUEVA desde cero' \
    E 'Ya tengo una -- solo apuntarla/completarla')"
  if [ "$(echo "$MODO_DB" | tr '[:lower:]' '[:upper:]')" = "E" ]; then
    RUTA_DB="$(pedir_valor 'Ruta completa al archivo .db existente' '')"
    SALIDA_DB="$(node scripts/instalarBaseDeDatos.js verificar-y-completar "$RUTA_DB")"
    DB_MODO_DESC="existente, verificada/completada"
  else
    RUTA_DB="$(pedir_valor 'Ruta donde crear la base de datos nueva' "$REPO_ROOT/db/jugueteria.db")"
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

# ── 9) Migraciones versionadas ───────────────────────────────────────────
# db/schema.sql ya trae mirroreado el contenido de migrations/*.sql (ver
# convención en CLAUDE.md), así que esto normalmente no aplica nada nuevo —
# es la red de seguridad para si algún día una migración se sube sin
# mirrorear a tiempo, y además deja poblada schema_migrations desde el
# primer arranque. Idempotente: tolera columnas/tablas que ya existen.
if [[ "$DB_STATUS" != ERROR:* ]]; then
  step "Aplicando migraciones versionadas (migrations/*.sql)"
  if node scripts/migrate.js; then
    MIGRACIONES_STATUS="aplicadas (ver detalle arriba)"
    ok "Migraciones al día."
  else
    MIGRACIONES_STATUS="ERROR -- revisa el log de arriba"
    err "Alguna migración falló -- revisa el log de arriba antes de arrancar el bot."
  fi
else
  MIGRACIONES_STATUS="omitido (no se determinó DB_PATH)"
fi

escribir_reporte

echo ""
echo "================================================="
echo "  Listo."
echo "  Revisa .env y luego corre ./iniciar-nixos-chatbot.sh (o npm run start:all)."
echo "  Reporte de instalación: $REPORTE_PATH"
echo "================================================="
