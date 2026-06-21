# 🤖 Bot + Dashboard

Sistema completo de e-commerce con **WhatsApp Bot** y **Panel Administrativo** 🇲🇽

## 🖥️ Corre igual en Windows y en NixOS

El bot, el dashboard, el panel React (`dashboard-ui/`) y la ventana de
escritorio (**botdashapp**, basada en Electron) son el mismo código Node.js
sin importar el sistema operativo — lo único que cambia entre plataformas es
cómo se instalan las dependencias del sistema (Node, Chrome/Chromium,
herramientas de compilación nativa). Una vez instaladas, los mismos comandos
npm/pm2 arrancan todo igual en ambos lados.

Cada plataforma tiene su propio instalador de un solo comando, con la misma
filosofía: **scripts de texto plano, nunca empaquetados a un `.exe`/binario
compilado**. Las herramientas que empaquetan scripts en ejecutables (pkg,
nexe, etc.) son justo lo que los antivirus marcan como falso positivo por el
propio empaquetado — un script visible, sin ofuscar, no dispara esos
heurísticos. Por eso "un click o un comando" aquí significa *un instalador
script que puedes leer*, no un binario compilado.

**Windows** — instalar, luego arrancar/apagar:

```bat
instalador windows Chatbot.bat   :: instala/revisa todo (Node, Chrome, pm2, npm ci, build del panel, .env)
start.bat                         :: arranca bot + dashboard (PM2) y abre la ventana de escritorio (botdashapp)
stop.bat                          :: apaga bot + dashboard
```

**NixOS** — equivalente, mismos pasos:

```bash
nix develop                      # dev shell con Node 20, Chromium, sqlite, etc. (ver flake.nix)
./instalador-nixos-chatbot.sh    # instala/revisa todo (npm ci, build del panel, instala desktop, .env)
./iniciar-nixos-chatbot.sh       # arranca bot + dashboard (PM2) y abre la ventana de escritorio (botdashapp)
./detener-nixos-chatbot.sh       # apaga bot + dashboard
```

o, sin entrar manualmente al dev shell (`nix run` ya trae las dependencias
del sistema vía `runtimeInputs` en `flake.nix`):

```bash
nix run .#instalar
nix run .#iniciar
nix run .#detener
```

Si Node 20 / Chrome / herramientas de compilación ya están en el sistema,
este único comando npm funciona igual en ambas plataformas (sin la ventana
de escritorio, solo bot + dashboard vía pm2):

```bash
npm run install:all && npm run start:all
```

## 🛠️ Stack

| Componente | Tecnología |
|---|---|
| **Bot WhatsApp** | Node.js + whatsapp-web.js + Puppeteer |
| **Base de datos** | SQLite3 + better-sqlite3 |
| **Visión artificial** | Google Cloud Vision API |
| **Dashboard** | Node.js HTTP nativo (sin frameworks) |
| **Logística** | Estafeta (simulado, API Phase 2) |
| **DevOps** | NixOS + pm2 + systemd |

## 📋 Requisitos

- **Node.js 20.x** (fijado en `engines.node` — otra versión puede traer
  binarios prebuilt distintos para better-sqlite3 y dar problemas al instalar)
- **npm 10+**
- **Python 3** (para compilar better-sqlite3 si no hay binario prebuilt)
- **Chrome o Chromium instalado** — define `CHROME_PATH` en `.env`. En
  Windows hay un default; en Linux/NixOS es obligatorio (o falla al iniciar
  con un mensaje claro pidiéndolo)
- **Credenciales Google Cloud Vision** (JSON)

## 🚀 Instalación rápida

Usa siempre `npm ci`, no `npm install` — instala exactamente lo que dice
`package-lock.json`, así Windows y NixOS terminan con las mismas versiones.

### Opción 1: Node.js tradicional

```bash
# Clonar repo
git 
cd 

# Instalar dependencias (exacto, desde el lockfile)
npm ci

# Configurar variables de entorno
cp .env.example .env
# Edita .env con tus valores reales — incluye CHROME_PATH si no es Windows

# Tests
npm test

# Arrancar bot + dashboard (los dos procesos, vía pm2)
npm run start:all
```

> ⚠️ `npm start` por sí solo **solo arranca el bot** (`bot/index.js`), no el
> dashboard. Para tener ambos procesos corriendo usa siempre
> `npm run start:all` (pm2 + `ecosystem.config.js`), o arráncalos por
> separado con `npm start` y `npm run start:dashboard` en dos terminales.

### Opción 2: Con Nix (recomendado para reproducibilidad)

```bash
nix develop
npm ci
npm test
npm run start:all
```

## 🔁 Arranque automático al iniciar sesión / reiniciar el equipo

`npm run start:all` deja los dos procesos corriendo bajo pm2, pero **no
sobrevive un reinicio del equipo por sí solo**. Para que el bot y el
dashboard vuelvan a encender solos cuando el usuario inicia sesión (sin
tener que abrir una terminal):

```bash
npm run start:all      # arranca bot-whatsapp + dashboard la primera vez
pm2 save                # guarda la lista de procesos actual
pm2 startup             # imprime e instala el script de arranque del sistema
                         # (systemd/launchd/etc. — sigue las instrucciones que imprime)
```

Con esto, al reiniciar la máquina o iniciar sesión, pm2 resucita
automáticamente `bot-whatsapp` y `dashboard` en el estado en que quedaron.
A partir de ahí, el día a día **no requiere terminal**: la barra superior
del Dashboard (visible en cualquier página) tiene botones ▶️ Iniciar /
⏹️ Detener / 🔁 Reiniciar que controlan `bot-whatsapp` por pm2
directamente (el dashboard mismo sigue corriendo siempre, solo el bot se
prende/apaga desde ahí).

Si vuelves a correr `npm ci` o cambias `ecosystem.config.js`, repite
`pm2 save` para que el snapshot de arranque quede actualizado.
# CDHV1
