# Arquitectura

## Índice
1. [Dos procesos, una SQLite](#dos-procesos-una-sqlite)
2. [Sistema de módulos (toggles)](#sistema-de-módulos-toggles)
3. [Tronco de rutas del dashboard](#tronco-de-rutas-del-dashboard)
4. [RBAC / roles y áreas](#rbac--roles-y-áreas)
5. [Migraciones](#migraciones)
6. [Extensibilidad por giro](#extensibilidad-por-giro)
7. [Motor de flujo visual](#motor-de-flujo-visual)
8. [Hook LLM](#hook-llm)
9. [Servicios standalone](#servicios-standalone)

---

## Dos procesos, una SQLite

`bot/index.js` (cliente WhatsApp) y `dashboard/server.js` (panel HTTP) son
**entry points/procesos separados** (ver `ecosystem.config.js`), ambos
leyendo/escribiendo el **mismo archivo SQLite** vía `bot/db_connection.js`
(WAL, busy timeout 5s, FKs on). El dashboard escribe la tabla `configuracion`
que el bot **polea** (cache de 60s, `bot/flows/_config.js`): así el tono y los
toggles de módulo se propagan **sin reiniciar el bot**.

```
        ┌─────────────────────┐        ┌──────────────────────────┐
        │   bot/index.js      │        │  dashboard/server.js     │
        │  (whatsapp-web.js)  │        │  (http nativo, sin fwk)  │
        └──────────┬──────────┘        └─────────────┬────────────┘
                   │  lee configuracion (cache 60s)   │ escribe configuracion
                   │  cola_notificaciones (poll 30s)  │ sirve dashboard-ui/dist
                   ▼                                  ▼
             ┌───────────────────────────────────────────┐
             │   SQLite (better-sqlite3, WAL)             │
             │   bot/db_connection.js  ·  DB_PATH         │
             └───────────────────────────────────────────┘
                   ▲
                   │  fork()  (crash aislado)
        ┌──────────┴───────────────┐
        │ services/stockWatcher    │  (stock, waitlist, CSAT, carritos
        │   .worker.js             │   abandonados, backups, suscripciones,
        └──────────────────────────┘   cobranza fiado…)
```

`stockWatcher` corre como **proceso hijo forked** desde el `client.on('ready')`
del bot; si `fork()` falla, cae a in-process por hora y persiste el modo en
`configuracion.stockwatcher_modo`.

El **`cola_notificaciones`** es la cola única de salida del bot: cualquier
mensaje que el sistema quiera mandar (dashboard, stockWatcher, recordatorios)
se encola ahí y el bot la polea cada 30s → rate-limit y auditoría uniformes,
con fallback `@c.us`→`@lid`.

## Sistema de módulos (toggles)

Un **módulo** es una capacidad encendible/apagable por instancia, guardada como
fila `configuracion.<clave>_activo`. **Única fuente de verdad de los defaults:**
`bot/flows/modulosDefaults.js` exporta:

- `DEFAULT_OFF` — lista de claves que arrancan **apagadas**. Todo lo NO listado arranca **encendido**.
- `DEPENDE_DE` — dependencias tipo Odoo (ej. `facturacion_activo` exige `contabilidad_activo`).
- `MODULOS_POR_GIRO` — qué enciende cada giro al terminar el onboarding (una sola vez, solo instancias nuevas).

Lo consumen **dos procesos**: `bot/flows/_config.js` (`moduloActivo()` = lo que
hace el bot) y `dashboard/routes/primeConfig.js` (`GET /api/modulo/:clave` = lo
que ve el panel). Antes estaban duplicados y driftearon; ahora ambos importan
el mismo archivo. `services/configFlags.js` (`flagActivo(db, clave, defaultOn)`)
es el helper que leen las rutas.

Catálogo exhaustivo en [MODULOS.md](MODULOS.md).

## Tronco de rutas del dashboard

`dashboard/server.js` es un servidor `http` de un solo archivo (sin Express):
rate-limit por IP + `SECURITY_HEADERS` fijos en cada respuesta JSON. El ruteo
es una **secuencia de módulos** (no un router table clásico). Cada archivo en
`dashboard/routes/*.js` declara sus rutas como **datos** en un arreglo `RUTAS`
y las envuelve con `_construirModulo.js` (`construirModulo(RUTAS, {prefijo})`),
que devuelve la misma firma `(req, res, p, u, ctx, next)` que el dispatch
espera. Ventajas: el **gate queda explícito por ruta** y el índice canónico
(`scripts/rutas/inventario.js`) lo lee del arreglo, no parseando `if`s.

Cada `def` de ruta:
```js
{ metodo:'POST', path:'/api/citas' | /^\/api\/citas\/(\d+)$/, area:'operacion'|areas:[...]|roles:['gerente'], pin?:true, handler }
```
- `area`/`areas`: exige `requireSession` + `permite(rol, area)` (basta una de `areas`).
- `roles`: exige `requireSession(req,res,roles)` (rango mínimo).
- sin gate: solo el gate global de `server.js` (cualquier sesión).
- `pin:true`: operación sensible — el tronco lee el body, valida el PIN de autorización (gerente+ pasa sin PIN) y deja bitácora forzada en `configuracion_log` **antes** del handler.

`server.js` aplica **un `requireSession` global** (cualquier sesión) a todo
`/api/*` salvo la whitelist pública (`login`/`logout`/`me`/`onboarding*`/
`flota/status`). Ver inventario completo en [API.md](API.md).

Para regenerar el índice: `node scripts/rutas/inventario.js` (`--json`,
`--check` para detectar colisiones).

## RBAC / roles y áreas

Login real + sesiones server-side (no HTTP Basic). Tabla `usuarios`
(`username`, `password_hash`+`salt` con `crypto.scryptSync`, `rol`). Cookie
`jc_session` (`HttpOnly; SameSite=Lax`). **Única fuente de verdad:**
`dashboard/permisos.js` (espejo en `dashboard-ui/src/lib/permisos.js`).

**Jerárquicos** (`RANGO_ROL`): `prime`(3) > `gerente`(2, "Administrador" en UI)
> especialistas(1). Un `roles:['gerente']` deja pasar gerente **y** prime
(rango mínimo).

**Especialistas** (`AREAS_POR_ROL`) — solo entran a sus áreas; gerente/prime
pasan todas:

| Rol | Áreas |
|---|---|
| `cajero` | pos |
| `operador` (`usuario` legacy) | pos, operacion |
| `almacen` | almacen |
| `compras` | compras, almacen_lectura |
| `rh` | rrhh |
| `contabilidad` | finanzas, rrhh, cortes |
| `auditor` | **todas, solo lectura** — `server.js` bloquea todo método ≠ GET para este rol en un punto único |

Un gerente puede crear/editar/borrar `ROLES_CREABLES_POR_GERENTE`
(cajero/operador/almacen/compras/rh/contabilidad); gerente y prime solo los
gestiona prime. Prime no puede borrarse a sí mismo ni al último prime.

> Nota: la migración `0023` consolidó el viejo rol `admin` en `gerente`; `0025`
> añadió `auditor`. `server.js` mapea `admin→`rango de gerente por seguridad.

## Migraciones

`scripts/migrate.js` + `migrations/*.sql` + tabla-libro `schema_migrations`:
runner idempotente (tolera `duplicate column name`/`already exists`). **Es la
fuente de verdad del esquema** — por encima de `db/schema.sql`, que ha
drifteado respecto a producción. Hay 87 migraciones a la fecha
(`0001`–`0087`). Regla vigente: toda columna `NOT NULL` nueva debe traer
`DEFAULT` o `UPDATE` de backfill en la misma migración versionada, y
espejarse a mano en `db/schema.sql`. Ver [BASE_DE_DATOS.md](BASE_DE_DATOS.md).

Ledgers **inmutables** (migración `0030`): triggers `BEFORE UPDATE/DELETE`
sobre `asientos`, `asientos_detalle` e `inventario_movimientos` (kardex) que
lanzan error — los libros no se editan ni borran, solo se reversan con asiento
contrario.

## Extensibilidad por giro

Tres puntos de extensión coordinados, **inertes por defecto** (Julio Cepeda
byte-idéntico), diseñados para **fallar cerrado**:

- **Presets de giro** (`bot/flows/_giros.js`): cada instancia elige `configuracion.giro`. El giro define el vocabulario del bot (`{item}/{items}/{emoji}`), overrides de frases, el **menú adaptativo** (`menuDeGiro` — cuántas de las 5 opciones canónicas mostrar) y, vía `modulosDefaults.MODULOS_POR_GIRO`, qué módulos enciende al onboarding.
- **Registro de flujos por giro** (`bot/flows/giroFlows.js`): `actionHandler.js` mezcla `[...FLOWS, ...giroFlows.flowsDeGiro(giro)]`. `GIRO_FLOWS` está vacío hoy (sin cambio de comportamiento) pero es el hueco documentado para añadir un flujo por giro sin tocar el router.
- **Motor de flujo visual** (ver abajo) — la vía "sin código" para el mismo fin.

## Motor de flujo visual

Módulo `motor_flujo_activo` (**default OFF**). Con OFF, los `FLOWS` de código
mandan y Julio Cepeda es byte-idéntico; incluso ON sin grafo activo, el motor
no-opea. Permite definir el comportamiento del bot como un **grafo** editable
desde un lienzo React Flow (Prime → editor del bot).

- **Datos** (migraciones `0065`–`0067`): `flujo_grafo` (versiones), `flujo_nodo` (nodo + `render` + `pos_x/pos_y`), `flujo_arista`.
- **Motor** (`bot/flows/motor/`): `grafo.js`, `interprete.js` (ejecuta el grafo), `actions.js` (cada acción mapea a un helper de `_shared.js`: buscar/agregar/cotizar/ETA/escalar), `linter.js` (valida el grafo), `seeder.js` + `plantillas/`.
- **API** (`dashboard/routes/motorFlujo.js`, prime-only): `/api/prime/motor` (grafo actual), `/versiones`, `/revertir`, `/simular`, `/plantillas`, `/acciones`, `/activar`, `PUT /grafo`.
- Piezas informativas del bot para el lienzo: `cotizacion_activo` (cotiza el carrito) y `tiempo_entrega_activo` (ETA de envío), ambas OFF por defecto, con diálogo en las FRASES (4 tonos).

## Hook LLM

`bot/handlers/llmHandler.js` — **único** punto de integración futura de un LLM,
llamado en `actionHandler.js` **justo antes** del fallback de reglas (el LLM
solo ve el texto libre que el motor de reglas no pudo rutear). **Doble gate y
falla cerrado**: `llmActivo()` = `moduloActivo('llm_activo')` (en `DEFAULT_OFF`)
**AND** una key configurada (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`). Hoy
`handle()` siempre devuelve `null` (passthrough). Documenta la completación
prevista: Anthropic SDK, modelo `claude-opus-4-8` (+ `claude-haiku-4-5` para
clasificar intención), tool-use mapeado a helpers de `_shared.js`, loop
agéntico. El call site traga cualquier error y cae al fallback normal.

**Dataset de entrenamiento**: `services/mensajeService.js` persiste `paso_actual`
+ `intencion` por mensaje (migración `0019`); `services/datasetExport.js`
(`POST /api/prime/exportar-llm`, prime-only) serializa el dataset a JSONL, lo
gzipea y lo envía por correo al destino de respaldo (teléfono **enmascarado**).
El entrenamiento es un proceso externo off-production.

## Servicios standalone (`services/`)

Lógica de negocio invocada tanto por bot como por dashboard, no atada a un
proceso. Los más relevantes:

| Servicio | Rol |
|---|---|
| `contabilidadService.js` | Motor de partida doble (asientos, libro mayor, cierre de período). Ver [CONTABILIDAD.md](CONTABILIDAD.md). |
| `cfdiService.js` / `pacService.js` / `pacProviders.js` | Lectura de CFDI + timbrado 4.0 con PAC real (Facturapi/Facturama). |
| `nominaService.js` | Nómina LFT (aguinaldo, finiquito, IMSS patronal, séptimo día). |
| `kardexService.js` | Movimientos de inventario inmutables. |
| `costeoService.js` | Costo de ventas / costeo. |
| `stockService.js` / `stockWatcher.js` / `.worker.js` | Motor de stock multi-sucursal + automatizaciones. |
| `emailService.js` | SMTP hand-rolled sobre `net`/`tls` (sin nodemailer). |
| `estafetaService.js` | Simulación de guías de envío (Fase 1). |
| `crmBot.js` / `crmCampanas.js` | Pipeline CRM alimentado por el bot + campañas. |
| `gatewayService.js` / `gatewayProviders.js` / `pagoLinkService.js` | Links/pasarela de pago (andamiaje configurable). |
| `secretos.js` / `cryptoBackup.js` | Cifrado at-rest de secretos y respaldos. |

---

## Discrepancias con CLAUDE.md

1. CLAUDE.md describe **3 roles** (`usuario`/`gerente`/`prime`). El código tiene **~9**: cajero, operador, almacen, compras, rh, contabilidad, auditor + gerente + prime (`permisos.js`).
2. CLAUDE.md dice "no framework" para la UI; hoy la UI usa **Mantine** además de React/Vite (correcto que el backend sigue sin framework).
3. CLAUDE.md no menciona el **motor de flujo visual**, **CFDI/PAC real**, **nómina**, **CRM**, **almacén/kardex**, **mesas/cocina**, **citas**, **fiados** ni **correo** — todos presentes.
4. El ruteo ya no es "40+ `if (p===...)` en un `handleAPI`": son **~336 rutas en 30 módulos** vía tronco declarativo `_construirModulo.js`.
5. `contabilidad_activo` en CLAUDE.md se describe OFF; hoy arranca **ON** (un ERP con ventas lleva sus libros).
