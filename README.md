# 🤖 Bot + Dashboard

Sistema completo de e-commerce con **WhatsApp Bot** y **Panel Administrativo** 🇲🇽

## 🖥️ Plataformas

- **Windows** — entorno local de desarrollo/revisión (`start.bat` / `stop.bat`).
- **Ubuntu + Docker** — objetivo de despliegue en servidor.

El bot, el dashboard, el panel React (`dashboard-ui/`) y la ventana de
escritorio (**botdashapp**, basada en Electron) son el mismo código Node.js
sin importar el sistema operativo — lo único que cambia entre plataformas es
cómo se instalan las dependencias del sistema (Node, Chrome/Chromium,
herramientas de compilación nativa). Una vez instaladas, los mismos comandos
npm/pm2 arrancan todo igual en ambos lados.

**Windows** — arrancar/apagar:

```bat
start.bat                         :: arranca bot + dashboard (PM2) y abre la ventana de escritorio (botdashapp)
stop.bat                          :: apaga bot + dashboard
```

Si Node 20 / Chrome / herramientas de compilación ya están en el sistema,
este único comando npm instala todo (sin la ventana de escritorio, solo
bot + dashboard vía pm2):

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
| **Panel React** | `dashboard-ui/` (Vite), servido estático por el mismo proceso |
| **Logística** | Estafeta (simulado, API Phase 2) |
| **DevOps** | pm2 local · Docker en el servidor |

## 📋 Requisitos

- **Node.js 20.x** (fijado en `engines.node` — otra versión puede traer
  binarios prebuilt distintos para better-sqlite3 y dar problemas al instalar)
- **npm 10+**
- **Python 3** (para compilar better-sqlite3 si no hay binario prebuilt)
- **Chrome o Chromium instalado** — define `CHROME_PATH` en `.env`. En
  Windows hay un default; en Linux es obligatorio (o falla al iniciar
  con un mensaje claro pidiéndolo)
- **Credenciales Google Cloud Vision** (JSON)

## 🚀 Instalación rápida

Usa siempre `npm ci`, no `npm install` — instala exactamente lo que dice
`package-lock.json`, así todas las máquinas terminan con las mismas versiones.

```bash
# Instalar dependencias (exacto, desde el lockfile)
npm ci

# Configurar variables de entorno
cp .env.example .env
# Edita .env con tus valores reales — incluye CHROME_PATH si no es Windows

# Panel React
npm run build:dashboard-ui

# Tests
npm test

# Arrancar bot + dashboard (los dos procesos, vía pm2)
npm run start:all
```

> ⚠️ `npm start` por sí solo **solo arranca el bot** (`bot/index.js`), no el
> dashboard. Para tener ambos procesos corriendo usa siempre
> `npm run start:all` (pm2 + `ecosystem.config.js`), o arráncalos por
> separado con `npm start` y `npm run start:dashboard` en dos terminales.

## 🐳 Despliegue en servidor (Ubuntu + Docker)

Un solo contenedor corre bot + dashboard bajo `pm2-runtime` — así los botones
▶️/⏹️/🔁 del dashboard (que controlan el bot vía pm2) siguen funcionando.
La imagen instala Chromium del sistema y construye el panel React en el build.

```bash
# 1. En el servidor: clonar el repo y preparar el entorno
git clone <repo> && cd <repo>
cp .env.example .env          # llena valores reales; DB_PATH/CHROME_PATH los
                              # fija docker-compose, no hace falta tocarlos.
                              # USA CONTRASEÑAS NUEVAS (DASHBOARD_PASS, USER_PRIME_PASSWORD)

# 2. Subir la base de datos real al volumen
mkdir -p data imagenes_clientes logs logs-bot
scp/rsync ... jugueteria.db → ./data/jugueteria.db

# 3. Levantar (las migraciones corren solas al arrancar el contenedor)
docker compose up -d --build

# 4. Vincular WhatsApp: el QR sale en los logs
docker compose logs -f app
```

Notas de operación:

- **El puerto 3001 solo escucha en 127.0.0.1 del host** (ver
  `docker-compose.yml`). El acceso remoto es vía el **Caddy del servidor**
  (TLS automático) — bloque mínimo en el Caddyfile:
  `panel.midominio.com { reverse_proxy 127.0.0.1:3001 }`.
  Si Caddy corre como **contenedor**, descomenta la red `proxy` en
  `docker-compose.yml` y usa `reverse_proxy bothsv:3001` en el Caddyfile.
- **Zona horaria**: el contenedor corre con `TZ=America/Monterrey` (los
  cortes de caja, reportes y campañas usan hora local de SQLite) — ajústala
  si la tienda está en otra zona.
  La cookie de sesión ya va con `Secure` (`DASHBOARD_COOKIE_SECURE=true`).
- **Primer arranque**: 1) entra al panel y loguéate con el usuario prime,
  2) tras el login aparece el QR de WhatsApp — escanéalo con el teléfono del
  negocio (el QR exige sesión: nadie sin login puede vincular el número),
  3) a partir de ahí cada quien entra con su usuario y ve solo los paneles
  de su rol (usuario/gerente/prime).
- **Gestionar la BD a mano**: la imagen trae el cliente `sqlite3` —
  `docker compose exec app sqlite3 /data/jugueteria.db` (es la misma BD viva
  del bot; SQLite en WAL aguanta lecturas concurrentes sin problema, evita
  dejar transacciones de escritura abiertas).
- **Persistencia**: `./data` (SQLite), volumen `wwebjs_auth` (sesión de
  WhatsApp — no se re-escanea el QR en cada deploy), `./imagenes_clientes`,
  `./logs`.
- **Backups**: cron en el host, p. ej.
  `0 11 * * * cd /ruta/repo && docker compose exec -T app node scripts/backup.js`
  (el sistema ya alerta por email si el backup lleva >36h sin correr).
- **Actualizar**: `git pull && docker compose up -d --build` (la BD y la
  sesión de WhatsApp viven en volúmenes, sobreviven el rebuild).
- **Tests contra la BD real** (post-deploy):
  `docker compose exec app node tests/test_db_flujo.js`.

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
