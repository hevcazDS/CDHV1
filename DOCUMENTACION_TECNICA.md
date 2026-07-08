# Documentación técnica — Bot WhatsApp + Dashboard

Este archivo concentra la explicación del proyecto, sus funciones clave y el
historial de fixes/decisiones que antes vivía en comentarios dentro del
código. El código se mantiene limpio; lo no-obvio se documenta aquí.
(`CLAUDE.md` es la guía operativa para el asistente; este archivo es la
referencia humana.)

## Arquitectura

Dos procesos independientes sobre una misma SQLite (WAL, FKs on, busy 5s):

| Proceso | Entry point | Qué hace |
|---|---|---|
| Bot | `bot/index.js` | Cliente whatsapp-web.js + pipeline de mensajes |
| Dashboard | `dashboard/server.js` | API `http` nativo (sin framework) + sirve el build React |

El dashboard escribe en la tabla `configuracion`; el bot la lee con caché de
60s (`bot/flows/_config.js`) — así los toggles/tono cambian sin reiniciar.
`services/stockWatcher.js` corre como hijo forked del bot (si el fork falla,
cae a modo in-process y lo persiste en `configuracion.stockwatcher_modo`).

## Bot — pipeline de mensajes (`bot/index.js`)

Orden por mensaje entrante: burst guard global → timeout post-bloqueo →
rate limiter por usuario (10/min, 30/5min, 3 img/min) → filtro de contenido
(`cfCheck`, blacklist + score, con detección de evasión por espacios y
leet-speak) → detección de frustración (`esFrustracion`, cliente alterado
pero sin groserías → humano) → preprocesado de imagen (Google Vision
opcional) → detección de queja (`quejaCheck`, folio `CASO-YYYYMMDD-NNN`) →
detector de intención de compra (solo en MENU) → `actionHandler.handleAction`.

Reglas fijas:
- **Jamás escribir primero**: números sin fila en `clientes` se bloquean en
  `registrarContactoEntrante` — no es configurable a propósito.
- Mutex por usuario (`_enProceso`): nunca dos mensajes del mismo número en
  paralelo.
- `cola_notificaciones` se procesa cada 30s con espaciado entre envíos
  (ráfagas instantáneas son patrón de spam para WhatsApp); si un JID
  `@c.us` falla por LID se reintenta como `@lid` y se persiste el corregido.
- `_normalize` mapea leet-speak (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, $→s, @→a)
  solo en tokens con al menos una letra (no toca precios/folios).

## Bot — sesiones y flujos

- `sessionManager.js`: Map en memoria (TTL 30 min, máx 500, LRU) respaldado
  en `sesiones_bot`. Al expirar una sesión con carrito → `carritos_abandonados`.
- `actionHandler.js` es el único router. Orden: venta previa POS pendiente →
  puntos ("mis puntos") → motivo de abandono (solo MENU) → reset betatestor →
  **privacidad/opt-out** (BAJA/ALTA/PRIVACIDAD, ver abajo) → reset global
  (hola/menu/0) → devolución → "ver carrito" → dispatch a flows → hook LLM →
  fallback (se registra en `log_eventos` tipo `fallback` = dataset del LLM).
- Un flow que truena resetea la sesión a MENU (no tumba el bot).
- Flows por giro: `giroFlows.flowsDeGiro(giro)` se mergea después de los
  universales — hueco de extensión, vacío por default.

## Privacidad / LFPDPPP (migración 0020)

- Primer contacto: se encola un aviso corto de privacidad por
  `cola_notificaciones` (una sola vez, al crear la fila de cliente).
- `PRIVACIDAD` → aviso completo (ARCO, opcional `aviso_privacidad_url` en
  `configuracion`). `BAJA`/`no molestar` → `clientes.marketing_opt_out=1`.
  `ALTA` → lo revierte.
- El guard central está en `stockWatcher._insertCola`: las campañas de
  marketing (`carrito_abandonado_2h/24h`, `oferta_por_vencer(_24h)`,
  `reactivacion_dormidos`) se omiten si el cliente está en opt-out; los
  transaccionales (CSAT, seguimiento, preventa, alertas al asesor) siempre
  salen. Los masivos del dashboard filtran en `construirAudienciaMasivo`
  (`COALESCE(c.marketing_opt_out,0)=0`).

## Dashboard backend (`dashboard/server.js` + `dashboard/routes/*`)

- Auth: sesiones server-side, cookie `jc_session` HttpOnly/SameSite=Lax
  (+`Secure` con `DASHBOARD_COOKIE_SECURE=true`). Passwords con
  `crypto.scryptSync`. Roles jerárquicos: `usuario(1) < gerente(2) < prime(3)`
  — `requireSession(req,res,['gerente'])` = gerente O superior.
- Rutas públicas: solo `login`, `logout`, `me`, `onboarding*`.
  **`/api/bot/qr` exige sesión** (fix 2026-07: quien ve el QR puede vincular
  el WhatsApp del negocio; el flujo es login → QR → operar, ver `App.jsx`).
- `server.listen` usa `DASHBOARD_HOST` (default `127.0.0.1`; en Docker el
  compose lo pone en `0.0.0.0` — sin esto el contenedor es inalcanzable).
- Control del bot: `/api/bot/start|stop|restart` ejecutan `pm2` con
  `execFile` (nunca `shell:true` — DEP0190). Por eso el contenedor Docker es
  ÚNICO con `pm2-runtime`: en contenedores separados este control se rompe.
- `construirAudienciaMasivo` vive a nivel de módulo y lo usan preview y envío
  real (misma query, no pueden divergir). Siempre excluye tags
  `troll/blacklist/devolucion/queja` y opt-out de marketing.
- Estáticos sin auth a propósito (la pantalla de login es parte del bundle).
  Sin `dashboard-ui/dist`, `/` responde un aviso de "corre el build"
  (`dashboard.html` legado se eliminó 2026-07).

## Dashboard frontend (`dashboard-ui/`)

React + Vite + Mantine + **Tailwind v4** (solo capa utilities — sin preflight,
porque el reset pisaría los estilos de Mantine; integrado vía
`@tailwindcss/vite` en `vite.config.js`).

- **Tema**: variables CSS en `styles.css`. Default = claro minimalista
  (lienzo gris `#eceef1`, tarjetas blancas con sombra suave, acento charcoal
  monocromo `#1d1f24` — según la referencia visual del cliente). `dark` y
  `confort` (dark + `data-confort="on"`, bajo contraste) siguen en el
  ThemeSwitcher; la elección persiste en localStorage (`jc-tema-modo`).
  Mantine `primaryColor:'dark'` para que sus controles sean monocromos.
- **Tipografía**: Inter self-hosteada vía `@fontsource` (nunca Google Fonts
  CDN — la CSP es `default-src 'self'`). Subset latin alcanza para español.
- **Code-splitting**: todas las páginas son `React.lazy`; vendors fijados en
  chunks cacheables (`vite.config.js` manualChunks). recharts NO va en la
  carga inicial: la gráfica de Inicio (`components/GraficaSemana.jsx`,
  Recharts BarChart monocromo) se carga lazy dentro de la página.
- **Inicio**: KPIs con tarjeta oscura de acento (`kpi-dark`) para "Ventas
  cobradas hoy", chips de tendencia reales (hoy vs ayer de `/api/metricas`),
  gráfica de 7 días (rellena días vacíos con 0), tabla "Últimos pedidos" con
  pills de estatus.
- **Layout**: AppShell de Mantine. El ancho del navbar SOLO se declara en el
  prop (`navbar={{width}}`); duplicarlo en CSS desalinea el offset de Main.
  El padding va en el prop `padding` (un padding plano en `.content` pisaba
  el cálculo y encimaba la tabla bajo el sidebar — bug real ya corregido).
  Sidebar: acordeón de un grupo abierto (todos expandidos desbordaban en
  laptop), tarjeta oscura de soporte del proveedor (`/api/soporte`, env
  `SOPORTE_HEVCAZ_*`), pie con avatar/rol. Sin breakpoint móvil a propósito
  (app de escritorio).
- **Chat en vivo**: `Notificaciones.jsx`, hilo por cliente con
  `refetchInterval` 5s; el botón "💬 Chatear" de Cola de Atención llega con
  `?cliente=<id>`. "Regresar al bot" reanuda el flujo en el paso indicado
  (`PUT /api/clientes/:id/reanudar-bot`, el bot lo detecta en el siguiente
  mensaje vía versión de sesión, migración 0010).
- `queryClient` con `staleTime: 10s`: el panel refresca por
  `invalidateQueries` tras cada mutación, no por foco de pestaña.

## Esquema / migraciones

- **Fuente de verdad**: `migrations/*.sql` + `scripts/migrate.js` (idempotente,
  ledger `schema_migrations`). Todo cambio se espeja a mano en `db/schema.sql`.
- Regla dura: columna nueva `NOT NULL` SIEMPRE con `DEFAULT` o backfill en la
  misma migración (una `usuarios.nombre NOT NULL` sin default tumbó el
  dashboard en producción en cada arranque — incidente real).
- No agregar DDL inline en código nuevo (los `CREATE TABLE IF NOT EXISTS`
  dispersos son legacy, no el patrón a seguir).
- `db/schema.sql` tiene drift histórico vs producción (p.ej. `cola_emails`
  con `html_body`+`cuerpo_html`): ante duda, `PRAGMA table_info` contra la
  BD real.

## Tests

- `npm run test:bot` — 117/117. Evalúa el código real de `bot/index.js` con
  DB mockeada; si la DB real no existe usa una réplica interna (los helpers
  replicados deben mantenerse espejo del código real — el fix del leet-speak
  en `_norm` fue exactamente eso).
- `tests/test_dashboard_api.js` — 19/19, servidor real contra SQLite en
  memoria; su schema mock debe crecer cuando los endpoints usan columnas
  nuevas (`pagado_en`, `metodo_entrega`, `repartidor_*`, `marketing_opt_out`).
- Contract tests standalone: `test_lealtad/dashboard_control/marketing/
  referidos/puntos_compra` — replican el SQL real para fijar columnas.
- Requieren BD real (solo pasan en el servidor): `test_db_flujo`,
  `test_full_bot`, `test_notificaciones`, `tests/sql/*.sql`.

## Despliegue (Docker en Ubuntu; local Windows con start.bat)

- Contenedor único `pm2-runtime` (ver arriba por qué), Chromium del sistema,
  cliente `sqlite3` incluido para gestionar `/data/jugueteria.db`.
- Puerto publicado solo en `127.0.0.1` del host; Caddy da TLS:
  `panel.midominio.com { reverse_proxy 127.0.0.1:3001 }`.
- Volúmenes: `./data` (BD), `wwebjs_auth` (sesión WhatsApp), imágenes, logs.
- Primer arranque: login prime → QR (exige sesión) → escanear → operar.
- Ver README sección "Despliegue en servidor" para los comandos completos.

## Historial de fixes relevantes

| Fecha | Fix |
|---|---|
| 2026-06 | 7,293 filas huérfanas en `inventarios` limpiadas; PK real de producción es `id_inventory` |
| 2026-06 | Default de puntos unificado en `puntosService.puntosActivo()` (handler y dashboard divergían) |
| 2026-06 | `DEFAULT_OFF` de módulos unificado en `bot/flows/modulosDefaults.js` (bot y panel habían drifteado) |
| 2026-07 | Purga pre-despliegue: NixOS/instaladores/dashboard.html legado eliminados |
| 2026-07 | LFPDPPP: aviso de privacidad + BAJA/ALTA + `marketing_opt_out` (migración 0020) |
| 2026-07 | `/api/bot/qr` pasa de público a con-sesión; flujo login→QR |
| 2026-07 | `DASHBOARD_HOST` configurable (Docker necesita 0.0.0.0) |
| 2026-07 | Rediseño UI: tema claro default, Tailwind utilities, Recharts en Inicio, Inter |
| 2026-07 | Réplica de tests igualada al `_normalize` real (leet-speak) |

## Palabras/copy

- "gratis" solo puede describir envío/flete, nunca precio de producto.
- Todo copy del bot pasa por `t()`/`vocab()` (`_config.js`) parametrizado por
  giro (`_giros.js`) — la instancia Julio Cepeda rinde byte-idéntico.
