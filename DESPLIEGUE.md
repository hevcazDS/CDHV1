# Guía de despliegue — Bot WhatsApp + Dashboard (Ubuntu + Docker + Caddy)

Migración de la instancia completa (código + base de datos SQLite + número de
WhatsApp) a un servidor Ubuntu con Docker. El servidor destino **ya tiene
Caddy**; este sistema no abre ningún puerto a internet por sí mismo.

## 0. Requisitos del servidor

| Recurso | Mínimo | Nota |
|---|---|---|
| Ubuntu | 22.04+ | cualquier distro con Docker sirve |
| Docker + compose plugin | 24+ | `docker compose version` |
| RAM | 2 GB | Chromium del bot es lo que pesa (~500 MB) |
| Disco | 10 GB | imagen ~1.5 GB + BD + sesión WhatsApp |
| Caddy | ya instalado | host o contenedor (ver §4) |
| Puertos | 80/443 solo Caddy | el 3001 NUNCA se expone a internet |

## 1. Clonar y configurar

```bash
git clone <repo> bot && cd bot
mkdir -p data imagenes_clientes logs logs-bot
cp .env.example .env
nano .env
```

### Variables del `.env` (todas)

| Variable | Obligatoria | Valor en servidor |
|---|---|---|
| `DB_PATH` | — | la fija docker-compose (`/data/jugueteria.db`), no tocar |
| `CHROME_PATH` | — | la fija docker-compose (`/usr/bin/chromium`), no tocar |
| `DASHBOARD_PORT` | no | 3001 (default) |
| `DASHBOARD_USER` / `DASHBOARD_PASS` | **sí** | usuario gerente — **contraseña NUEVA**, no la de Windows |
| `DASHBOARD_NOMBRE` | no | nombre visible del gerente |
| `USER_PRIME` / `USER_PRIME_PASSWORD` / `USER_PRIME_NOMBRE` | **sí** | usuario dueño (rol prime) — contraseña nueva |
| `ASESOR_WHATSAPP` | **sí** | número que recibe alertas de escalada/stock (52..., sin +) |
| `EMAIL_HOST/PORT/USER/PASS/FROM/TO` | sí para correos | SMTP para confirmaciones y backups |
| `GOOGLE_APPLICATION_CREDENTIALS` | solo si Vision | ruta al JSON DENTRO del contenedor — móntalo como volumen extra y NUNCA lo commitees |
| `SOPORTE_HEVCAZ_NOMBRE/WHATSAPP/EMAIL` | recomendado | contacto del proveedor (widget flotante del panel) |
| `BETA_RESET_CODE` | no | déjalo VACÍO en producción (comando de borrado de datos de prueba) |
| `LOG_LEVEL` | no | `info` |
| `FLETE_UMBRAL` | no | umbral de envío gratis (default 699) |

Fijadas por `docker-compose.yml` (no van en `.env`): `DASHBOARD_HOST=0.0.0.0`,
`DASHBOARD_COOKIE_SECURE=true`, `TZ=America/Monterrey` (ajusta la TZ si la
tienda está en otra zona — los cortes de caja y campañas usan hora local).

## 2. Migrar la base de datos (el SQL)

La BD SQLite viaja como archivo. En la máquina Windows origen:

```powershell
# 1. DETÉN el bot y el dashboard (stop.bat) — nunca copies la BD con WAL activo
# 2. Consolida el WAL en el archivo principal:
sqlite3 "C:\Users\ServerHevcaz\Desktop\DB Hevcaz CB\jugueteria.db" "PRAGMA wal_checkpoint(TRUNCATE);"
# 3. Copia SOLO jugueteria.db (los .db-shm/.db-wal ya quedaron vacíos)
scp "C:\Users\ServerHevcaz\Desktop\DB Hevcaz CB\jugueteria.db" usuario@servidor:~/bot/data/
```

En el servidor, verifica integridad ANTES de arrancar:

```bash
sqlite3 data/jugueteria.db "PRAGMA integrity_check;"   # debe decir: ok
sqlite3 data/jugueteria.db "SELECT COUNT(*) FROM productos; SELECT COUNT(*) FROM clientes;"
```

Las **migraciones pendientes corren solas** al arrancar el contenedor
(`scripts/migrate.js`, idempotente, ledger en `schema_migrations`). Para una
instancia NUEVA (sin BD previa) el onboarding del panel crea todo desde cero
con `db/schema.sql` — no copies nada a `data/`.

## 3. Levantar

```bash
docker compose up -d --build          # build ~5-10 min la primera vez
docker compose logs -f app            # espera "Dashboard corriendo"
```

## 4. Caddy (TLS)

**Caddy instalado en el host** (lo normal):

```caddyfile
panel.midominio.com {
    reverse_proxy 127.0.0.1:3001
}
```

**Caddy como contenedor**: descomenta la red `proxy` en
`docker-compose.yml` (el contenedor de Caddy debe estar en esa misma red
externa) y usa `reverse_proxy bothsv:3001`. Luego `docker compose up -d`.

Recarga Caddy y verifica: `https://panel.midominio.com/health` → `ok`.

## 5. Primer arranque (orden exacto)

1. Abre `https://panel.midominio.com` → **login con el usuario prime**.
2. Tras el login aparece el **QR de WhatsApp** (exige sesión: nadie sin login
   puede vincular el número). Escanéalo con el teléfono del negocio:
   WhatsApp → Dispositivos vinculados → Vincular dispositivo.
3. La sesión queda en el volumen `wwebjs_auth` — **no** se re-escanea en
   deploys futuros.
4. Cada empleado entra después con su usuario y ve solo los paneles de su
   rol (`usuario` cajero / `gerente` / `prime` dueño). Los usuarios se crean
   en Prime → Usuarios.

## 6. Verificación post-deploy (checklist)

```bash
# Tests que SOLO pueden correr contra la BD real:
docker compose exec app node tests/test_db_flujo.js      # 15 tablas críticas
docker compose exec app node tests/test_full_bot.js      # 20 clientes simulados
# Regresión SQL de solo lectura:
docker compose exec app sh -c 'for f in tests/sql/*.sql; do echo "== $f"; sqlite3 /data/jugueteria.db < "$f"; done'
```

Prueba funcional: manda "hola" al número del negocio desde un teléfono de
prueba → menú; busca un producto → precio/stock correctos; el pedido aparece
en el panel.

## 7. Operación continua

- **Backup diario** (BD + imágenes por correo) — cron del host:
  ```
  0 11 * * * cd /home/usuario/bot && docker compose exec -T app node scripts/backup.js >> logs/backup-cron.log 2>&1
  ```
  El sistema alerta solo por email si el backup lleva >36 h sin correr.
- **Fotos de clientes**: se convierten a **WebP** al llegar (~70% menos
  espacio) y se purgan a los **30 días** — solo las ya confirmadas en el
  backup por correo, nunca se borra algo sin respaldo.
- **Actualizar código**: `git pull && docker compose up -d --build` — BD,
  sesión de WhatsApp e imágenes viven en volúmenes, sobreviven el rebuild.
- **Gestionar la BD a mano**: `docker compose exec app sqlite3 /data/jugueteria.db`
  (WAL aguanta lecturas concurrentes; evita transacciones de escritura largas).
- **Control del bot**: botones ▶️/⏹️/🔁 del header del panel (pm2 dentro del
  contenedor). `docker compose restart app` reinicia todo.
- **Logs**: `docker compose logs -f app` (pm2) · `./logs/` y `./logs-bot/`.

## 8. Rollback

```bash
git log --oneline                 # elige el commit bueno
git checkout <commit> && docker compose up -d --build
```
La BD no se revierte con git (las migraciones nunca borran columnas — un
código viejo corre bien sobre esquema más nuevo). Para desastres de datos:
restaurar el `.db.gz` del último backup por correo a `./data/`.

## 9. Qué NO hacer

- No expongas el 3001 en `0.0.0.0` del host ni lo abras en el firewall.
- No copies `.wwebjs_auth` de Windows al servidor (sesión ligada a la
  máquina; re-escanea el QR una vez).
- No edites la BD de producción sin transacción y sin backup del día.
- No pongas `BETA_RESET_CODE` en producción.
- No borres el volumen `wwebjs_auth` en un deploy (desvincula WhatsApp).
