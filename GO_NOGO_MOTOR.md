# GO / NO-GO — Motor de flujo (Fase 0: fixture + golden snapshot)

> Fecha: 2026-07-12. Verificado contra código actual (post-Fase 5 + fixes). Cero cambios de código.
> Alcance: veredicto para **EMPEZAR Fase 0** (red de seguridad). No autoriza el intérprete (Fase 2+).

## Veredicto: **GO** ✅

Los 6 prerequisitos que el plan (`PLAN_IMPLEMENTACION_MOTOR.md` §0.bis/§Fase 0/§M.0-M.4) y el
diseño (`DISENO_MOTOR_FLUJO.md` §D/§G) asumen **siguen intactos**. Nada de Fase 5 (suscripciones,
citas) ni los fixes recientes rompió la frontera sellada de dinero ni el pipeline de filtros. Fase 0
es solo-lectura (fixture + golden), riesgo nulo. Se puede empezar hoy.

Única corrección **obligatoria** antes de fijar la migración del motor: el número subió. El plan
dice `0062`; el último aplicado real hoy es **`0063_documentos.sql`**, así que la migración del motor
será **`0064_flujo_motor.sql`** (Fase 1/2, no Fase 0). Ajustar §M.0.1 y §M.4 del plan al construir.

---

## Prerequisitos — checklist con evidencia

### 1. Frontera sellada de dinero — `insertarPedidoConCarrito` NO descuenta inventario ✅

- `_insertarPedidoConCarritoTx` (`bot/flows/_shared.js:776-814`) solo hace `INSERT INTO pedidos`
  (`:782`) + `INSERT INTO pedido_detalle` (`:795,800`). **Cero** escritura a `inventarios`/kardex:
  grep de `UPDATE inventarios|kardex|movimiento` en `_shared.js` → solo lecturas (`SELECT ... FROM
  inventarios`, boost de búsqueda), ninguna deducción.
- El descuento vive **solo** en el chokepoint `marcar-pagado`: `kardexService.movimiento({...tipo:'venta',
  delta: -it.cantidad...})` (`dashboard/routes/comunicacionPedidos.js:272`). Confirma la corrección de
  auditoría §D.1 y el histórico anti-doble-descuento (MEMORY.md).

**Fase 5 respeta la frontera** (grep de kardex/inventario en los cobros nuevos):
- **Suscripciones** (`dashboard/routes/suscripciones.js:85-102`): `_generarCargo` reusa
  `shared.insertarPedidoConCarrito(...,'suscripcion')` (`:94`) + `INSERT INTO links_pago ... 'generado'`
  (`:96`). No toca inventario; el cobro real cae en marcar-pagado. Comentario propio lo declara (`:5-6,83-84`).
- **Citas** (`dashboard/routes/citas.js:93`): inserta `links_pago 'pagado'` para un **servicio**
  (`tipo:'servicio' = sin stock`, comentario `:66`). Los servicios no descuentan stock por diseño. Grep de
  `inventario|stock` en `citas.js` → 0 escrituras. ✅

### 2. Pipeline de filtros pre-router (cfCheck/esFrustracion/quejaCheck → ASESOR) intacto y ANTES del router ✅

En `bot/index.js`, en orden y todos antes de `handleAction`:
- `cfCheck` (contenido) — `:908` (def `:336`)
- `esFrustracion` — `:924` (def `:307`)
- `quejaCheck` — `:1047` (def `:479`) + `registrarEscalada` (`:1053`)
- inyección intención de compra → SEARCHING — `:1098`
- **router** `actionHandler.handleAction` — `:1133` (y `:1098` para la búsqueda inyectada)

Coincide con §M.3 del plan: el intérprete sería la etapa 10, solo ve texto ya filtrado. ✅

### 3. `giroFlows.flowsDeGiro` + flag por-request como mecanismo de extensión ✅

- `bot/actionHandler.js:146`: `const _flowsActivos = [...FLOWS, ...giroFlows.flowsDeGiro(_giro)];`
  con `_giro` resuelto **por request** (`:145`, patrón que el motor extenderá con
  `...(motorActivo()?[motor]:[])`).
- `bot/flows/giroFlows.js:41-46`: `flowsDeGiro` es require-tolerante (`try/catch → []`), fail-closed
  como asume §D.3. `isp: _CITAS` (`:31`) — **el alias ISP existe** y apunta a citasFlow, tal como el
  plan asume (§R.A/§M.2 ISP = citas + reuso dirección). No hay giro `freelancer` registrado → coherente
  con el plan (freelancer es un delta futuro, no un flow shipped). ✅

### 4. Slot `data.viewing`, enum `S`, acciones selladas de `_shared.js` (M.1/M.2) ✅

- **`data.viewing`** es el slot del producto en curso: `menuFlow.js:428,502,557` (y 464/474/594/610/624/632).
  Confirma §M.0.3 (`viewing`, no `selectedProduct`). `agregar_carrito` usará `ctx.data.viewing`.
- **`ctx`** = `{ userId, session, message, client, raw, action, step, data, tel, isImage }`
  (`actionHandler.js:144`) — todos los campos que el motor usa presentes (§M.0.4). ✅
- **Enum `S`** (`_shared.js`): `SEARCHING:33`, `VIEW_PRODUCT:34`, `CITA_SERVICIO:60`, `CITA_FECHA:61`,
  `CITA_HORA:62`, `CITA_CONFIRMA:63` — existen. `WIZARD_Q1..3`, `ADD_MORE`, `REFERIDOS`, checkout — en STEPS
  de sus flows (`menuFlow.js:98`).
- **Estados que el plan dice que NO existen aún** (a crear en Fase 4): `CITA_ANTICIPO`, `CITA_AGENDADA`,
  `MESA_*`, `PROYECTO_MONTO` → grep en `_shared.js` = 0 matches. **Confirmado ausentes** (correcto, §M.2).
- **Firmas de acciones selladas** (todas presentes, `_shared.js`):
  `searchProducts(query, limit=3, telefono=null)` `:163` · `buscarCobertura(cp)` `:332` ·
  `agregarAlCarrito(carritoActual, producto)` `:387` · `partirCarrito(carrito, estadoCob)` `:493` ·
  `registrarMetodoPago(pedidos, nombreMetodo)` `:731` · `insertarLinkPago(pedidoRowid, monto, folio)` `:745` ·
  `grabarPedidoEnvio(data, telefono)` `:868`.
- **Nota de drift no bloqueante:** los números de línea del plan quedaron atrás (el plan cita
  `insertarPedidoConCarrito` en `:815`→real `:820`; `grabarPedidoEnvio` `:863`→`:868`; `registrarMetodoPago`
  `:731` sigue OK). Las **funciones y firmas coinciden**; solo actualizar líneas al escribir `actions.js`.
- **Eliminación de ISP / alias freelancer:** no afecta el plan. `isp` sigue vivo como alias de citas
  (`giroFlows.js:31`); no existe un giro `freelancer` (nunca existió como flow). Nada que el plan asuma se rompió.

### 5. Última migración aplicada (fija el número del motor) ✅ — **corrige el plan**

`ls migrations/ | sort | tail -1` → **`0063_documentos.sql`**.
El plan (§M.0.1/§M.4) dice `0062`; está **desactualizado** (Fase 5 agregó `0062_suscripciones.sql` y
`0063_documentos.sql`). La migración del motor será **`0064_flujo_motor.sql`** — re-verificar `tail -1` al
construirla (regla anti-drift). Esto es Fase 1/2, NO bloquea Fase 0.

### 6. `motor_flujo_activo` NO está en `DEFAULT_OFF` — hay que agregarlo ✅ (confirmado)

`bot/flows/modulosDefaults.js:16-59` (lista `DEFAULT_OFF`): **`motor_flujo_activo` NO aparece**.
Confirma §M.0.2. Debe **añadirse** en Fase 2 (con el flag OFF + `FLOWS` intacto, Julio Cepeda es
byte-idéntico). No bloquea Fase 0.

---

## Resumen

| # | Prerequisito | Estado | Evidencia |
|---|---|:---:|---|
| 1 | `insertarPedidoConCarrito` sin descuento de inventario; Fase 5 respeta la frontera | ✅ | `_shared.js:776-814`; `comunicacionPedidos.js:272`; `suscripciones.js:94-96`; `citas.js:66,93` |
| 2 | Pipeline filtros pre-router intacto y antes del router | ✅ | `index.js:908,924,1047,1133` |
| 3 | `giroFlows.flowsDeGiro` + flag por-request como mecanismo de extensión | ✅ | `actionHandler.js:145-146`; `giroFlows.js:31,41-46` |
| 4 | `data.viewing`, enum `S`, acciones selladas con firmas del plan | ✅ | `menuFlow.js:428,502`; `_shared.js:33,60-63,163,387,493,745,868` |
| 5 | Última migración (número del motor) | ✅ (corrige plan a **0064**) | `migrations/0063_documentos.sql` |
| 6 | `motor_flujo_activo` NO en `DEFAULT_OFF` (agregar en Fase 2) | ✅ | `modulosDefaults.js:16-59` |

**Un solo ajuste al plan** (documental, no bloqueante): migración `0062`→**`0064`** en §M.0.1/§M.4.

---

## Como es GO: primeros 3 archivos a crear + su test (según §M.4)

El primer archivo **NO es el intérprete** — es la red de seguridad. Fase 0 es solo-lectura.

1. **`tests/fixture_min.js`** (§0.3) — siembra un sqlite temporal en `os.tmpdir()` reusando
   `db/schema.sql` (fuente real, no re-tipear) + config JC por defecto (`giro=jugueteria`, tono C,
   `negocio_configurado=1`) + 1 sucursal + 3 productos con stock (incl. uno en 0 → rama lista de espera)
   + 1 servicio + cobertura `64000`. Idempotente. Exporta `crearFixture()` → devuelve `dbPath`.

2. **`tests/golden_snapshot.js`** (§0.4) — **este es el test del primer archivo y el oráculo de todo**.
   Llama `crearFixture()`, apunta `DB_PATH` a él, corre `actionHandler.handleAction` **contra la DB real
   del fixture** (no el mock de `test_bot.js`, que no tiene productos) por los recorridos #1-7 (§0.4:
   checkout pickup, lista de espera, wizard, checkout envío+dirección, asesor, referidos, y cita cuando
   `citas_activo=1`), y **graba `tests/golden/jc.json`**. En corridas futuras: mismo recorrido → mismo
   output byte a byte, o falla. Se añade a `package.json` `test` como `&& node tests/golden_snapshot.js`.

3. **`tests/golden/jc.json`** — el snapshot capturado (artefacto que genera #2 en su primera corrida).
   Se commitea; es la línea base de regresión byte-idéntica que protege toda fase posterior.

> El primer archivo de **código de producción** del motor (`bot/flows/motor/actions.js` + su contract
> test `tests/test_motor_actions.js`) es de **Fase 1**, y solo se toca **después** de que el golden esté
> verde. No es parte de este GO. Patrón de test: `node tests/xxx.js` + asserts + `better-sqlite3` en
> memoria (estilo `tests/test_citas.js`), sin framework nuevo.

**Número de migración del motor (Fase 1/2, no ahora):** `0064_flujo_motor.sql` — re-verificar
`ls migrations/ | sort | tail -1` al construirla.
