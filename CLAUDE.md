# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WhatsApp bot + admin dashboard for **Julio Cepeda Jugueterías** (Mexican e-commerce/toys). The bot and the dashboard *backend* are plain Node.js, no web framework — `whatsapp-web.js` for the bot, native `http` for the dashboard API, `better-sqlite3` for storage. The dashboard *frontend* is a separate React + Vite SPA (`dashboard-ui/`), built to a static bundle and served by that same native `http` server — there is still no Express/Next/etc. on the backend, the framework is scoped to the UI layer only.

| Component | Tech |
|---|---|
| WhatsApp Bot | Node.js + whatsapp-web.js + Puppeteer |
| Database | SQLite3 via better-sqlite3 (WAL mode) |
| Computer vision | Google Cloud Vision API (product photo lookup) |
| Dashboard API | Native Node `http` server, no framework |
| Dashboard UI | React + Vite (`dashboard-ui/`), built to static files served by the API process |
| Desktop shell | Electron (`desktop/`) — wraps the dashboard URL instead of the OS default browser |
| Shipping | Estafeta (simulated; real API is "Phase 2") |
| Process management | pm2 (`ecosystem.config.js`) / systemd, NixOS dev shell |

## Commands

```bash
npm ci                       # install deps exactly per package-lock.json (preferred over npm install)
cp .env.example .env        # then fill in real values — bot exits at startup if DB_PATH/CHROME_PATH missing
npm start                   # bot only -> bot/index.js
npm run start:dashboard     # dashboard only -> dashboard/server.js (default port 3001)
npm run start:all           # both, via pm2 + ecosystem.config.js
npm run dev                 # bot with nodemon
npm run stop                # pm2 stop all
npm run dev:dashboard-ui    # Vite dev server for the React UI, proxies /api to :3001
npm run build:dashboard-ui  # builds dashboard-ui/dist — server.js serves it if present, else falls back to dashboard.html
start.bat                   # Windows: pm2 start ecosystem.config.js + opens the Electron desktop window (desktop/)
npm test                    # node tests/test_bot.js && node tests/test_db_flujo.js
npm run test:bot            # node tests/test_bot.js
npm run test:db             # node tests/test_db_flujo.js
nix develop                 # reproducible dev shell (Node 20, Python3, sqlite, chromium)
```

`npm run lint` is a no-op placeholder (`echo 'Linting...'`) — there is no real linter configured.

`package.json`'s `test`/`test:bot`/`test:db` scripts now point at the real files (`test_bot.js`, `test_db_flujo.js`); there's no `test:dashboard` script because the only dashboard "test" is `tests/test_dashboard.html`, a manual browser tool (open it and click buttons against a running dashboard), not something npm can run.

Tests run with plain `node`, not a test runner (no Jest/Mocha) — e.g. `node tests/test_bot.js --verbose --suite queja`. `test_bot.js` patches `Module._load` to intercept `require('./db_connection')` and substitute an in-memory mock DB, then re-evaluates the source of `bot/index.js` up to (excluding) the `whatsapp-web.js` client construction, so the message-processing pipeline (rate limiter, content filter, complaint detection, etc.) can be tested without a live WhatsApp session. The mock DB's `run()` handler special-cases the literal SQL `clearSession` in `bot/sessionManager.js` uses (it inlines `'MENU'`/`'{}'` into the query text and only binds `id_usuario`), so don't assume every `sesiones_bot` write binds 3 positional params when extending the mock.

`npm run test:bot` is **100/100 passing, exit 0**.

`tests/` has grown beyond what `package.json` wires up. None of these have npm scripts — run them directly with `node`:
- `test_lealtad.js`, `test_dashboard_control.js`, `test_marketing.js` — "contract" tests: each spins up its own in-memory `better-sqlite3` DB with a hand-copied subset of the schema and replicates the real SQL from `puntosService.js` / `dashboard/server.js` / `stockWatcher.js`, to pin down the exact columns those modules depend on without touching production. All pass standalone, no real DB needed.
- `test_full_bot.js` — simulates 20 concurrent customers through `actionHandler.handleAction` end-to-end, no WhatsApp involved. Loads `.env` from the project root (not from `tests/`) and then asserts that critical tables (`cola_notificaciones`, `cola_atencion`, etc.) exist on `DB_PATH`; in a checkout without a real seeded DB it exits 1 with a clear "TABLA FALTANTE" message rather than crashing — that's expected, not a bug, since this test needs a real database to mean anything.
- `test_db_flujo.js` — same story: checks that 15 critical tables and several specific columns exist on the real DB. Needs a real seeded SQLite file at `DB_PATH`; without one every assertion fails with "no such table".
- `test_notificaciones.js` — exercises real email/WhatsApp delivery against `EMAIL_*`/`ASESOR_WHATSAPP` env vars and the real DB; without those configured it reports clear ❌/⚠️ per missing piece rather than crashing.
- `test_beta_notificaciones.js` was **deleted** — it was a one-off manual beta-seeding script with hardcoded real customer data (name, phone, order totals), not a repeatable automated test.
- `tests/sql/*.sql` — read-only regression queries run with `sqlite3` (or a readonly `better-sqlite3` connection) directly against a real database copy (`Base de datos demo/jugueteria.db`), not against test fixtures; see `tests/sql/README.md`. They exist to catch schema-assumption bugs that contract tests can't, since contract tests use a schema someone hand-typed rather than the real one.

None of the tests above that need a real seeded database (`test_full_bot.js`, `test_db_flujo.js`, `test_notificaciones.js`, `tests/sql/*.sql`) can pass in this checkout — there is no `Base de datos demo/jugueteria.db` or any other seeded `.db` file committed (and `*.db` is gitignored), so they correctly report missing tables rather than silently no-opping. Don't read a 0-pass run from these as a regression unless `DB_PATH` actually points at a real seeded database.

`migraciones_pendientes/` (a scratch folder of paired `NNNN_verificar_*.sql`/`NNNN_migrar_*.sql` files for schema assumptions that couldn't be checked from this checkout) has been **deleted** — its contents were confirmed applied against the real production database, satisfying its own README's stated deletion criterion. `tests/sql/*.sql` remains as the permanent regression layer for this same class of schema-assumption bug.

## Architecture

### Two independent processes, one SQLite DB

`bot/index.js` (WhatsApp client) and `dashboard/server.js` (HTTP admin panel) are separate entry points/processes (see `ecosystem.config.js`), both reading/writing the same SQLite file via `bot/db_connection.js` (WAL mode, 5s busy timeout, FKs on). The dashboard writes to a `configuracion` table that the bot polls (60s cache, see `bot/flows/_config.js`) — this is how tone/module toggles propagate **without restarting the bot**.

`services/stockWatcher.js` runs as a forked child process (`services/stockWatcher.worker.js`), started from the bot's `client.on('ready')` handler, so a crash there doesn't take down WhatsApp. If `fork()` itself fails, it falls back to running in-process on an hourly interval. Beyond its original stock/waitlist/CSAT checks, it now also drives marketing automation — `checkCarritosAbandonados24h` (24h-later abandoned-cart coupon), `checkOfertasPorVencer`, `checkSeguimiento48h`, and `checkClientesDormidos` (reactivation messages to customers with no recent orders) — all feeding `cola_notificaciones` like everything else, so they're rate-limited and auditable the same way.

### Message pipeline (`bot/index.js`)

Every inbound WhatsApp message goes through a numbered pipeline embedded directly in `index.js` (not split into modules) before reaching the session/flow router:

1. Burst guard (global rate spike → 10s silence)
2. Post-block timeout (silently ignore users recently blocked by the content filter)
3. Per-user rate limiter (`_rl` Map, sliding window: 10/min, 30/5min, 3 images/min)
4. Content filter (`cfCheck` — blacklist + risk-score scan of Spanish/English profanity, with letter-spacing evasion detection); blocked users get auto-tagged `blacklist` and repeated offenders escalate silently to `ASESOR`
5. Frustration detection (`esFrustracion` — distinct from the content filter; routes visibly-angry-but-clean language to a human)
6. Image preprocessing — downloads media, optionally calls Google Vision (`bot/imageAnalyzer.js`, only if configured and `vision_activo` config flag is on), converts the result into a synthetic text query, and saves the image under `bot/imagenes_clientes/` for the dashboard
7. Complaint detection (`quejaCheck`, a 2-step stateful flow keyed by phrases in `_QUEJA_L1`/`_QUEJA_L2` plus tone heuristics) — escalates to `ASESOR` with a generated `CASO-YYYYMMDD-NNN` case number
8. Buying-intent detector + troll/blacklist word filter — only applies when `paso_actual === 'MENU'`; a large regex of Spanish purchase-intent verb forms extracts a product query and injects it as a `SEARCHING` action, bypassing the normal flow
9. Main handler — delegates to `bot/actionHandler.js`

A per-user mutex (`_enProceso` Set) prevents concurrent processing of two messages from the same sender. `sendSafe`/`sendWithTyping` wrap `client.sendMessage` with a 15s timeout and a simulated "typing..." delay.

A `cola_notificaciones` (notification queue) table is polled every 30s to send queued WhatsApp messages — including a fallback that retries `@c.us` JIDs as `@lid` if WhatsApp returns a LID-related error, then persists the corrected JID back onto the customer record.

### Session + flow routing (`bot/sessionManager.js`, `bot/actionHandler.js`, `bot/flows/`)

- **Sessions**: `sessionManager.js` keeps an in-memory `Map` (30 min TTL, max 500 entries, LRU-ish eviction) backed by the `sesiones_bot` SQLite table for durability across restarts. Each session is `{ paso_actual, data }` — `paso_actual` is a state name from the `S` enum in `bot/flows/_shared.js`. Abandoned carts are persisted to `carritos_abandonados` on session expiry.
- **Routing**: `actionHandler.handleAction` is the single router. Global shortcuts (reset to menu, "ver carrito", devolución detection) are checked first, then it dispatches to whichever module in the `FLOWS` array declares the current `paso_actual` in its exported `STEPS` array:
  - `flows/menuFlow.js` — MENU, SEARCHING, WIZARD, VIEW_PRODUCT, ADD_MORE
  - `flows/cartFlow.js` — SHOW_CART, CONFIRM_ORDER, OFERTAS, CUPON
  - `flows/orderFlow.js` — ASK_CP, SPLIT_*, DELIVERY, PICKUP_CONFIRM
  - `flows/addressFlow.js` — ASK_NOMBRE..ASK_REF
  - `flows/asesorFlow.js` — ASESOR, LISTA_ESPERA, SUSTITUTO, PREVENTA, CSAT, DEVOLUCION
  - A flow throwing resets the session to MENU rather than crashing the bot (caught per-flow in the dispatch loop).
- **Shared logic** lives in `bot/flows/_shared.js` and is the real domain layer: product search/scoring (`searchProducts`, name > seo_description > tags > category, boosted by stock level), the recommendation wizard (`wizardSearch`), cart math, coupon application, split pickup/delivery partitioning by per-branch stock (`partirCarrito`), and order persistence (`grabarPedidoPickup`/`grabarPedidoEnvio`/`grabarPedidoSplit`). All flow modules import from here rather than talking to the DB directly for these concerns.
- **Tone/copy** is centralized in `bot/flows/_config.js`: four tone presets (A=formal, B=casual, C=friendly/default, D=sales-urgency) keyed by phrase ID, selected via the `configuracion.tono_bot` DB row and exposed through `t(clave, vars)`. Per-module feature flags (`puntos_activo`, `vision_activo`, etc.) are read the same way via `moduloActivo(clave)`. Business rule encoded in a comment here: the word "gratis" (free) may only ever describe shipping/flete, never product price.

### Loyalty points (`bot/handlers/puntosHandler.js`, `bot/handlers/puntosService.js`)

A separate module from the main pipeline/flow router, called directly from `bot/index.js` so it can intercept a raw message (a `TK-XXXXXXXX` ticket code) regardless of the user's current `paso_actual`. Gated end-to-end by the `puntos_activo` config flag (`puntosActivo()` checks `configuracion` directly, fails closed — returns `false`/inactive on any DB error) — when off, `handle()` always returns `null` and is invisible to the customer. Rules live in `puntosService.js`: 1 point per peso spent, 2,000 points = a 10%-off coupon (90-day validity, single use, not stackable), a 2-hour claim window per ticket, and anti-fraud caps of 2 tickets/day and 2/week per customer. The dashboard manages this via the `/api/puntos/*` endpoints (`config`, `ticket/:id`, `preparar`, `ranking`, `usados`) in `dashboard/server.js`.

### Standalone services (`services/`)

Beyond `stockWatcher.js`/`stockWatcher.worker.js` (see above), `services/` holds business logic invoked from both the bot and the dashboard, not bound to either process:
- `emailService.js` — hand-rolled SMTP client over raw `net`/`tls` (no `nodemailer`), used for order notification emails. Configured entirely via `EMAIL_*` env vars; `isConfigured()` gates whether sends are attempted.
- `estafetaService.js` — shipping guide simulation ("Phase 1"): generates a fake tracking number and computes a real delivery date 2 business days out (Estafeta doesn't deliver Sundays), with a 2pm cutoff after which the "ship date" rolls to the next day. A real-API integration point (`_callEstafetaAPI()`) is stubbed for "Phase 2" but not wired in.
- `stockService.js` — multi-strategy stock engine: national-network lookup ranked by per-branch delivery days (`DIAS_ENTREGA` map) and a flat `$149` shipping cost, plus waitlist/preventa/substitute-product strategies consumed by `bot/flows/_shared.js` and `stockWatcher.js`.

### Maintenance scripts (`scripts/`)

Not part of `ecosystem.config.js` — run manually/cron, not under pm2:
- `scripts/backup.js` — emails a compressed DB backup (11:00) and any new customer images from `bot/imagenes_clientes/` (11:30) via the same hand-rolled SMTP code pattern as `emailService.js`; tracks already-sent images in a local `.backup_registro.json` so re-runs don't resend. `node scripts/backup.js [db|imagenes]` to run one piece.
- `scripts/generar_sustitutos.js` — one-off (or per-catalog-refresh) batch job that populates `productos_similares` by scoring candidate products against a base product (category, brand, age range, gender, shared tags, price proximity within ±35%) and keeping the top scorers (max 5/product, min score 3). Exposed in the dashboard read/write path via `/api/sustitutos/*`.

### Validation (`bot/validators.js`)

Zod schemas validate dashboard POST bodies (`NotificarSchema`, `MasivoSchema`, `GuiaSchema`, `PreventaSchema`, `ModuloConfigSchema`) and incoming WhatsApp messages (`validarMensajeWhatsApp` rejects groups, broadcasts, status updates, and echoes of the bot's own messages). `validarEnv()` enforces `DB_PATH` and `CHROME_PATH` as hard requirements at boot (`process.exit(1)` if missing) and warns (non-fatal) if `ASESOR_WHATSAPP` or `DASHBOARD_PASS` are unset/default.

### Dashboard backend (`dashboard/server.js`)

Single-file native `http` server (no Express). Per-IP rate limiting and a fixed `SECURITY_HEADERS` object applied to every JSON response (CSP, X-Frame-Options, HSTS, etc.). Talks to the same `bot/db_connection.js` module the bot uses. All routing is a flat sequence of `if (p === '/api/...')` checks in one `handleAPI` function (40+ routes) rather than a router table — covers orders/guides, returns (`/api/devoluciones`), the human-attention queue (`/api/cola_atencion`), loyalty points (`/api/puntos/*`), promotions/coupons (`/api/promociones`, `/api/cupon/*`), substitutes (`/api/sustitutos/*`), tone/module config (`/api/tono`, `/api/modulo/:clave`), and bot process control (`/api/bot/start|stop|restart|status`, shelling out to `pm2.cmd`/`pm2` directly rather than going through `npm run start:all`; never pass `shell:true` to that `execFile` call — Node flags it as DEP0190 since args aren't escaped, and resolving the platform binary name directly is enough).

**Auth**: real login + server-side sessions, not HTTP Basic Auth. A `usuarios` table (`username`, `password_hash`+`salt` via Node's native `crypto.scryptSync`, `rol` ∈ `admin`|`prime`) is seeded once at boot from `DASHBOARD_USER`/`DASHBOARD_PASS` (role `admin`) and `USER_PRIME`/`USER_PRIME_PASSWORD` if set (role `prime`) — there's no user-management UI yet, env vars are still the source of truth for credentials. `POST /api/login` issues an `HttpOnly; SameSite=Lax` cookie (`jc_session`) backed by an in-memory `Map<token, {username,rol,expires}>` (8h TTL); `GET /api/me` / `POST /api/logout` round it out. `requireSession(req, res, rolesPermitidos?)` is the single gate — called once globally (any logged-in role) in the main server callback for all `/api/*` except `/api/login`, `/api/logout`, `/api/me`, and called again with `['prime']` at each Prime-only route. **Prime is a role, not a section or a separate Basic Auth realm** — what used to be `requireAuthPrime()` against `USER_PRIME`/`USER_PRIME_PASSWORD` directly is now just `requireSession(req, res, ['prime'])`.

Static assets are served unauthenticated on purpose — `serveStatic()` serves `dashboard-ui/dist` if it exists (the React build), falling back to the legacy `dashboard.html` if not. The login screen itself is part of that bundle/static HTML, so it has to be reachable before a session exists; everything under `/api/*` (except the three routes above) still requires a valid session.

**Bot status history**: `bot_status_log` table + `registrarCambioEstatusBot(estatus, motivo)` records a row only when the PM2-derived status actually changes (not on every poll), so `GET /api/bot/status-history` gives a real timeline instead of just the current snapshot — backs the animated status widget in the React header.

**Prime shipping cost**: `PUT /api/prime/envio/:id_pedido` (existing) corrects the shipping cost of one already-created order. `PUT /api/prime/envio-default` (no order id in the path) instead writes a `costo_envio_default` key into `configuracion`, for setting the default going forward without referencing any specific order — the order id is opt-in, not required.

### Dashboard frontend (`dashboard-ui/`)

React + Vite SPA, builds to `dashboard-ui/dist` (`npm run build:dashboard-ui`), which `dashboard/server.js` serves statically — no separate frontend server in production, same "one Node process" deployment shape as before. `npm run dev:dashboard-ui` runs the Vite dev server with `/api` proxied to `http://localhost:3001` for local development against a running backend.

Structure: `src/context/AuthContext.jsx` wraps `/api/login`/`/api/me`/`/api/logout` and exposes `{ user, login, logout }`; `src/api.js` is a tiny `fetch` wrapper (`credentials:'include'` for the session cookie, no axios; `get`/`post`/`put`/`del` — `del` takes an optional body for routes like `DELETE /api/cola/programados` that need one to identify the target); `src/components/Layout.jsx` is the sidebar+header shell (the sidebar hides/shows the "Prime" link based on `user.rol`, not a separate page/section); `src/components/BotStatusWidget.jsx` polls `/api/bot/status` and renders the animated header widget + `/api/bot/status-history` dropdown with start/stop/restart actions. Visual system is a hand-written `src/styles.css` (dark palette, CSS custom properties, no UI library) — deliberately avoids loading Google Fonts so it doesn't need a CSP exception; falls back to the OS system font stack.

All 20 sections of the legacy `dashboard.html` have been ported to `src/pages/`: Inicio, Pedidos, Devoluciones, Clientes, Guías Estafeta, Notificaciones (individual + masivo, including the POS "venta previa" sub-feature), Cola de envíos, Cola de atención, Lista de Espera, Preventas, Ofertas, Promociones, Sustitutos, Puntos QR, Ranking, Métricas (the old "conversión" page), Búsquedas, Módulos, Beta/Pruebas, and Prime (role-gated). `dashboard.html` itself is kept only as historical reference for route shapes — it's no longer served by `dashboard/server.js` once `dashboard-ui/dist` exists. Reusable building blocks: `components/Badge.jsx` (per-domain color maps — `pago`, `devolucion`, `cola`, `guia`, `notif`, keyed by string value) and `components/Modal.jsx`; `lib/format.js` exports `fmt`/`fdate`/`soloTelefono`. A few legacy features were deliberately **not** ported because they had no real backend behind them (confirmed by grep before excluding, not assumed): the Módulos page's theme switcher and the Métricas page's "reporte automático diario" scheduler — both were `localStorage`-only no-ops in the legacy JS, with zero server-side cron/sending logic.

### Desktop shell (`desktop/`)

Electron app, package name **`botdashapp`** (`desktop/package.json`'s `name`, and `app.setName('botdashapp')` in `main.js` — the internal process/app identifier, distinct from the user-facing `BrowserWindow` title `'Julio Cepeda — Panel'`, which stays as business branding). Not packaged/signed (run via `npm --prefix desktop start` / `npx --prefix desktop electron desktop`, no installer). `main.js` opens a single `BrowserWindow` pointed at `DASHBOARD_URL` (default `http://localhost:3001`), retrying `loadURL` for ~20s in case PM2 hasn't finished bringing the dashboard up yet. Closing the window intercepts the `close` event and shows a native confirm dialog with three choices — Cancel, "Solo cerrar ventana" (just destroys the window; the bot and dashboard keep running under PM2, since they're independent OS processes, not children of Electron), and "Apagar todo" (`pm2 stop all` via the same platform-aware `execFile` pattern as `dashboard/server.js`, then quits). `start.bat` launches `pm2 start ecosystem.config.js` then this Electron window instead of opening the OS default browser; `stop.bat` now just runs `pm2 stop all` instead of killing whatever's bound to port 3000 (stale port from before the dashboard moved to 3001). Both `.bat` files `cd /d "%~dp0"` (the script's own directory) rather than a hardcoded path, so they work from any checkout location; `ecosystem.config.js`'s two pm2 apps set `cwd: __dirname` for the same reason.

NixOS has the same three-script shape as Windows, one-to-one: `instalador-nixos-chatbot.sh` (≈ `instalador-windows-chatbot.ps1` — Node/npm/chromium checks, `npm ci`, builds `dashboard-ui`, `npm install`s `desktop/`, sets up `.env`, auto-detects `CHROME_PATH` via `command -v chromium`), `iniciar-nixos-chatbot.sh` (≈ `start.bat`), `detener-nixos-chatbot.sh` (≈ `stop.bat`) — also runnable as `nix run .#instalar` / `.#iniciar` / `.#detener` (`flake.nix`'s `apps` output, wrapping each script with `pkgs.writeShellApplication` so Node/Chromium are on `PATH` without requiring `nix develop` first). Same anti-AV-false-positive rule as the Windows `.ps1` applies here too — plain shell scripts, never packaged into a compiled binary. `package.json` also exposes `install:all` (a single npm command — `npm ci` + build `dashboard-ui` + install `desktop/` — that works unchanged on both platforms once system-level deps like Node/Chrome are present) plus `install:nixos`/`start:nixos`/`stop:nixos` thin wrappers around the three `.sh` scripts.

### Logging (`bot/logger.js`)

Custom leveled logger (`debug|info|warn|error`, controlled by `LOG_LEVEL` env var), writes colorized to console and plain to a file under `bot/logs/`. Auto-redacts phone numbers in both `userId` fields and ad-hoc log lines (`replace(/(\d{3})\d+(\d{4})/, '$1***$2')`) — preserve this redaction pattern when adding new log calls that include a phone number.

### Env loading

`bot/index.js`, `bot/db_connection.js`, `dashboard/server.js`, `services/emailService.js`, `services/stockWatcher.worker.js`, and `scripts/backup.js` each independently call `require('dotenv').config()` as their first action (before any other `require`, so env vars are set before dependent modules read `process.env`). There's no shared bootstrap module — every new entry point needs its own `require('dotenv').config()` call at the top, and it must come before requiring modules that read env vars at load time (e.g. `db_connection.js`, `validators.js`). `tests/test_full_bot.js` hand-rolls its own minimal `.env` line parser instead of using `dotenv`, reading from the project root (`path.join(__dirname, '..', '.env')`, since the script itself lives in `tests/`).
