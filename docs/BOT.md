# Bot de WhatsApp

`bot/index.js` (cliente whatsapp-web.js + Puppeteer). Proceso separado del
dashboard, comparte la SQLite. Ver [ARQUITECTURA.md](ARQUITECTURA.md).

## Índice
1. [Pipeline de mensajes](#pipeline-de-mensajes)
2. [Sesiones](#sesiones)
3. [Enrutamiento de flujos](#enrutamiento-de-flujos)
4. [Estados (enum `S`)](#estados-enum-s)
5. [Flujos por giro](#flujos-por-giro)
6. [Motor de flujo visual](#motor-de-flujo-visual)
7. [Cola de salida](#cola-de-salida)

---

## Pipeline de mensajes

Todo mensaje entrante pasa por una tubería numerada embebida en `index.js`
antes de llegar al router de sesión/flujo. Un **mutex por usuario** (`_enProceso`
Set) evita procesar dos mensajes del mismo remitente a la vez.

```
mensaje WhatsApp
  1. burstCheck()        → spike global de tráfico → 10s de silencio
  2. post-block timeout  → ignora usuarios recién bloqueados por el filtro
  3. rate limiter _rl    → ventana deslizante: 10/min, 30/5min, 3 imágenes/min
  4. cfCheck()           → filtro de contenido (blacklist + score de groserías
                            ES/EN, detección de letras espaciadas); auto-tag
                            'blacklist' + escalado silencioso a ASESOR
  5. esFrustracion()     → lenguaje enojado pero limpio → humano (distinto de #4)
  6. imagen              → descarga media, Vision opcional (si vision_activo),
                            convierte a query de texto, guarda en imagenes_clientes
  7. quejaCheck()        → queja en 2 pasos → escala a ASESOR con CASO-YYYYMMDD-NNN
  8. intención de compra → si paso_actual==='MENU', regex de verbos de compra
                            extrae producto e inyecta acción SEARCHING
  9. actionHandler.handleAction()   ← router principal
```

`sendSafe`/`sendWithTyping` envuelven `client.sendMessage` con timeout de 15s y
delay de "escribiendo…". El logger auto-redacta teléfonos
(`123***4567`, `bot/logger.js`).

## Sesiones

`bot/sessionManager.js`: `Map` en memoria (TTL 30 min, máx 500, evicción
LRU-ish) respaldado por la tabla `sesiones_bot` (durabilidad entre reinicios).
Cada sesión = `{ paso_actual, data }`. `sesiones_bot.version` (migración `0010`)
da optimistic locking. Al expirar una sesión con carrito, se persiste a
`carritos_abandonados`.

## Enrutamiento de flujos

`bot/actionHandler.handleAction` es el **único router**. Primero atajos globales
(reset a menú, "ver carrito", detección de devolución), luego despacha al módulo
que declara el `paso_actual` actual en su arreglo `STEPS`. La lista de despacho
es:

```js
_flowsActivos = [ ...(_motor ? [_motor] : []), ...FLOWS, ...giroFlows.flowsDeGiro(giro) ];
```

- **Motor de flujo** primero (solo si `motor_flujo_activo` ON y hay grafo): reclama solo los pasos de su grafo; lo demás cae al código. Con OFF, `_motor` es `null` → orden intacto.
- **FLOWS universales** (`bot/actionHandler.js`):

| Módulo | STEPS |
|---|---|
| `menuFlow.js` | MENU, SEARCHING, VIEW_PRODUCT, ADD_MORE, WIZARD |
| `cartFlow.js` | SHOW_CART, CONFIRM_ORDER, OFERTAS, CUPON, PAGO_METODO, PAGO_COMPROBANTE |
| `orderFlow.js` | ASK_CP, SPLIT_*, DELIVERY, PICKUP_CONFIRM |
| `addressFlow.js` | CONFIRM_DIR_GUARDADA, ASK_NOMBRE..ASK_REF |
| `asesorFlow.js` | ASESOR, LISTA_ESPERA, CSAT, DEVOLUCION |

- **Flujos por giro** (`giroFlows.flowsDeGiro(giro)`) al final: pueden añadir estados pero nunca ensombrecer el checkout core.

Un flujo que lanza excepción **resetea la sesión a MENU** en vez de tumbar el
bot (capturado por-flujo). Justo antes del fallback de reglas,
`llmHandler.handle()` tiene su turno con el texto no ruteado (OFF por defecto,
passthrough — ver [ARQUITECTURA.md](ARQUITECTURA.md#hook-llm)).

Al inicio de `handleAction` se llama `crmBot.avanzarEtapa(...,'contactado')`
(idempotente, no-op si `crm_pipeline_activo` OFF).

## Estados (enum `S`)

`bot/flows/_shared.js` (líneas ~31-71). Categorías:

- **Menú/búsqueda**: MENU, SEARCHING, VIEW_PRODUCT, ADD_MORE
- **Carrito**: SHOW_CART, CONFIRM_ORDER, OFERTAS, CUPON
- **Checkout/envío**: ASK_CP, SPLIT_DELIVERY, DELIVERY, PICKUP_CONFIRM, SPLIT_CONFIRM
- **Dirección**: CONFIRM_DIR_GUARDADA, ASK_NOMBRE, ASK_CALLE, ASK_COLONIA, ASK_CIUDAD, ASK_REF
- **Asesor/postventa**: ASESOR, LISTA_ESPERA, CSAT, DEVOLUCION, REFERIDOS
- **Pago**: PAGO_METODO, PAGO_COMPROBANTE
- **Citas** (giros de servicio): CITA_SERVICIO, CITA_FECHA, CITA_HORA, CITA_CONFIRMA, CITA_GESTION, CITA_REAG_FECHA, CITA_REAG_HORA
- **Variantes/mesas**: VARIANTE, MESA_ABRIR, MESA_CONSUMO

## Flujos por giro

`bot/flows/giroFlows.js`:

- `servicios/mantenimiento/barberia/tatuajes/estetica/unas/gimnasio` → `[citasFlow, citasGestionFlow]` (agendar/reagendar citas; requiere `citas_activo`).
- `restaurante` → `[mesaFlow]` (consumo en mesa por WhatsApp).

`menuFlow.js` delega a `citasFlow.iniciar()` / `mesaFlow.iniciar()` cuando el
cliente elige la opción del menú adaptativo. `flowsDeGiro` es tolerante a
`require` (un flujo roto devuelve `[]` en vez de tumbar el bot).

**Vocabulario y copy** por giro salen de `bot/flows/_giros.js` +
`bot/flows/_config.js` (`t()`, `vocab()`): 4 tonos (A formal / B casual /
C amigable-default / D ventas), parametrizados con `{negocio}`/`{item}`/
`{items}`/`{emoji}`. Julio Cepeda (`giro=jugueteria`) es byte-idéntico al texto
histórico. Ver [MODULOS.md](MODULOS.md#menú-adaptativo-por-giro).

## Motor de flujo visual

`bot/flows/motor/` — `interprete.js` (motor), `grafo.js`, `actions.js` (cada
acción → helper de `_shared.js`), `linter.js`, `seeder.js`, `plantillas/`.
Tablas `flujo_grafo`/`flujo_nodo`/`flujo_arista`. Editable desde Prime (React
Flow). **Default OFF**; con OFF el código de FLOWS manda. Ver
[ARQUITECTURA.md](ARQUITECTURA.md#motor-de-flujo-visual).

## Cola de salida

`cola_notificaciones` es la cola única de mensajes salientes, poleada cada 30s
por el bot, con rate-limit anti-baneo y fallback `@c.us`→`@lid` (persiste el JID
corregido). La alimentan el dashboard, `stockWatcher` (carritos abandonados,
recordatorios de pago/fiado, reactivación) y los recordatorios de citas 24h.

## Otros módulos del bot

- `bot/imageAnalyzer.js` — Google Vision (búsqueda por foto), gated por `vision_activo`.
- `bot/intentDetector.js` / `bot/filtroPalabras.js` — intención de compra y filtro de palabras.
- `bot/reconexionAutomatica.js` — reconexión (gated `reconexion_auto_activo`).
- `bot/handlers/` — `puntosHandler`/`puntosService` (lealtad), `referidosService`, `abandonoHandler`, `llmHandler`.
- `bot/validators.js` — Zod para bodies del dashboard y `validarMensajeWhatsApp` (rechaza grupos/broadcasts/status/echos).

## Discrepancias con CLAUDE.md

1. CLAUDE.md no menciona los flujos de **citas** ni **mesas** (giros de servicio/restaurante) ni sus estados `S`.
2. La lista de despacho ya incluye el **motor de flujo** al frente (`_motor`), ausente de CLAUDE.md.
3. El bot alimenta el **pipeline CRM** (`crmBot.avanzarEtapa`) al inicio de cada acción — no documentado en CLAUDE.md.
