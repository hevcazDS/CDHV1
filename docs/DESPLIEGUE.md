# Despliegue y operación de infraestructura

Modelo **instancia por cliente**: cada cliente = carpeta clonada + SQLite propia
+ número de WhatsApp propio. Objetivo de servidor: **Docker sobre Ubuntu**; en
Windows quedan `start.bat`/`stop.bat` para dev/revisión local.

## Índice
1. [Instalar / clonar una instancia](#instalar--clonar-una-instancia)
2. [Variables de entorno (.env)](#variables-de-entorno-env)
3. [Migraciones](#migraciones)
4. [Procesos: PM2 / Docker / Electron](#procesos-pm2--docker--electron)
5. [Respaldos](#respaldos)
6. [Correo tienda (BD) vs respaldos (.env)](#correo-tienda-bd-vs-respaldos-env)

---

## Instalar / clonar una instancia

```bash
npm ci                      # instala según package-lock (preferido sobre npm install)
cp .env.example .env         # llenar valores reales (el bot sale si falta DB_PATH/CHROME_PATH)
node scripts/migrate.js      # aplica migrations/*.sql (idempotente)
npm run build:dashboard-ui   # construye dashboard-ui/dist (server.js lo sirve)
npm run start:all            # bot + dashboard vía pm2
```

`package.json install:all` = `npm ci` + build UI + instala `desktop/`. Base de
datos fresca: `scripts/instalarBaseDeDatos.js` (usa `db/schema.sql` — recuerda
que puede estar drifteado; preferir `migrate.js` para llegar al esquema real).
Instancia demo: `scripts/crearInstanciaDemo.js`, `scripts/demoMetricas.js`.

**Onboarding**: una instancia nueva (BD vacía) arranca el wizard
(`Onboarding.jsx`, `POST /api/onboarding` público) que crea el primer usuario
**prime**, elige el **giro**, nombre/moneda/IVA/tono y métodos de pago activos.
La migración `0014` es data-aware: una instancia que ya tiene productos
(= Julio Cepeda) se siembra con `negocio_configurado=1` y **nunca** ve el
onboarding.

## Variables de entorno (.env)

Cada entry point llama `require('dotenv').config()` como primera acción; **no hay
bootstrap compartido** — todo entry point nuevo necesita su propio `config()`
antes de requerir módulos que leen `process.env` al cargar (`db_connection.js`,
`validators.js`).

**Obligatorias** (el bot hace `process.exit(1)` si faltan, `bot/validators.js`):
`DB_PATH`, `CHROME_PATH`. Advertencia no-fatal si falta `ASESOR_WHATSAPP` o
`DASHBOARD_PASS`.

| Grupo | Variables |
|---|---|
| Dashboard | `DASHBOARD_PORT` (3001), `DASHBOARD_USER`, `DASHBOARD_PASS`, `DASHBOARD_HOST`, `DASHBOARD_COOKIE_SECURE`, `TRUST_PROXY` |
| Usuario prime seed | `USER_PRIME`, `USER_PRIME_PASSWORD` |
| Bot | `CHROME_PATH`, `ASESOR_WHATSAPP`, `WWEB_WEB_VERSION`, `DB_PATH`, `FLETE_UMBRAL` |
| Correo/respaldos | `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`, `EMAIL_CEDIS`, `EMAIL_PERSONAL`, `EMAIL_EXTRA`, `BACKUP_DEST` |
| Vision | `GOOGLE_APPLICATION_CREDENTIALS` |
| Soporte Hevcaz | `SOPORTE_HEVCAZ_NOMBRE`, `_WHATSAPP`, `_EMAIL` |
| Otros | `LOG_LEVEL`, `LOG_FILE`, `NODE_ENV`, `BETA_RESET_CODE` |

> Integraciones sensibles (PAC/pasarela) **no** van en `.env`: se configuran
> desde **Prime** y se guardan cifradas at-rest en la BD
> (`pac_cifrado_activo`, `services/secretos.js`/`pacService.js`).

## Migraciones

`node scripts/migrate.js` aplica `migrations/*.sql` en orden, tolerando
`duplicate column`/`already exists` (idempotente), y lleva libro en
`schema_migrations`. **Es la fuente de verdad del esquema.** Regla: toda columna
`NOT NULL` nueva trae `DEFAULT` o backfill en la misma migración y se espeja a
mano en `db/schema.sql`. Backfill contable histórico:
`scripts/backfill_contable.js`. Ver [BASE_DE_DATOS.md](BASE_DE_DATOS.md).

## Procesos: PM2 / Docker / Electron

`ecosystem.config.js` define **dos apps pm2**: `bot-whatsapp` (`bot/index.js`) y
`dashboard` (`dashboard/server.js`), ambas con `cwd: __dirname` (funcionan desde
cualquier ruta). `stockWatcher` no está en pm2: lo forkea el bot en su
`ready`. Los scripts de `scripts/` (backup, generar sustitutos) corren manual/
cron, fuera de pm2.

- `npm run start:all` — pm2 + ecosystem.
- `npm start` / `npm run start:dashboard` — uno solo.
- `start.bat` (Windows) — `pm2 start ecosystem.config.js` + abre la ventana Electron (`desktop/`, paquete `botdashapp`) en vez del navegador. `stop.bat` = `pm2 stop all`.
- **Docker sobre Ubuntu** es el objetivo de servidor. Los instaladores NixOS/Windows fueron eliminados.

Control del bot desde el panel: `/api/bot/start|stop|restart|status`
(`core.js`), que invoca `pm2` directamente (nunca `shell:true` en ese
`execFile`).

## Respaldos

`scripts/backup.js` (cron, no pm2):
- **11:00** — respaldo comprimido de la BD por correo. `node scripts/backup.js db`.
- **11:30** — imágenes nuevas de clientes (`bot/imagenes_clientes/`), registro en `.backup_registro.json` para no reenviar. `node scripts/backup.js imagenes`.
- Cifrado opcional del respaldo (`backup_cifrado_modo`, `services/cryptoBackup.js`); si se omite el cifrado esperado, alerta por `EMAIL_*`.
- `stockWatcher` corre `checkBackupReciente` (alerta si no hubo respaldo en 36h) y `purgarImagenesAntiguas` (borra imágenes >60d **solo** si ya están en el registro de respaldo).

## Correo tienda (BD) vs respaldos (.env)

**Separación deliberada** (comentada en `scripts/backup.js`):

- **Respaldos** usan **siempre** la cuenta del `.env` (`EMAIL_USER`/`EMAIL_PASS`, `EMAIL_HOST/PORT`). Es la cuenta operativa del integrador. Destino: `email_backup_destino` de la BD (Prime > General), o por default la misma cuenta de respaldos; admite varios separados por coma; `BACKUP_DEST` como fallback de `.env`.
- **Correo de la tienda** (el que el negocio configura para sí, módulo `correo_activo`): vive en la BD como `bot_email_*` (Prime > General), independiente del `.env`. Es la cuenta con la que el negocio manda correos a *sus* clientes.

Así el respaldo llega siempre aunque el cliente no configure su propio correo, y
el correo del negocio no compromete la cuenta de respaldos del proveedor.

## Discrepancias con CLAUDE.md

1. CLAUDE.md no documenta que **PAC/pasarela se configuran desde Prime cifrados en BD**, no por `.env`.
2. La separación **correo tienda (`bot_email_*` en BD) vs respaldos (`.env`)** no está en CLAUDE.md.
3. `USER_PRIME`/`USER_PRIME_PASSWORD` y el rol prime como primer usuario del onboarding están al día; el resto de roles especialistas no se siembran por `.env` (se crean desde el panel).
