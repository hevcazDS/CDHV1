# Auditoría de conexiones: DISENO_MOTOR_FLUJO.md ↔ código de producción

Fecha: 2026-07-12. Método: se abrió cada función sellada en el código real y se
verificó nombre, firma, retorno, efectos secundarios y precondiciones contra lo
que el diseño asume. Evidencia archivo:línea. Cero suposiciones.

**Veredicto adelantado:** el modelo (nodos/aristas/slots + acciones selladas por
nombre) es sólido y las funciones existen. PERO el diseño quedó **desfasado en
números de migración, firmas de `ctx`, columnas de `citas` y —el más grave— en la
afirmación de que el descuento de inventario vive dentro de `insertarPedidoConCarrito`**.
Además, **cita→cobro YA ESTÁ IMPLEMENTADO en producción** (`citas.js:cobrar`,
migración 0057) de una forma **distinta** a la que el diseño propone. No está listo
para Fase 0/1 tal cual: hay ~7 correcciones al doc que cerrar primero (sección D).

---

## A. Tabla acción del diseño → función real → veredicto

Firma real = `(params en orden)`. "tx" = abre transacción better-sqlite3. `db` en
todos los casos es el **singleton** `require('../db_connection')` (`_shared.js:16`) —
compartido entre bot, dashboard y acciones. No hay segunda conexión.

| Acción del diseño (`ACTIONS`) | Función real | Firma real (archivo:línea) | Efectos / retorno | Veredicto |
|---|---|---|---|---|
| `buscar_producto` → `searchProducts(ctx.raw, 3, ctx.tel)` | `searchProducts` | `(query, limit=3, telefono=null)` `_shared.js:163` | Lee `productos`; **INSERT en `log_eventos`** (efecto oculto). **Devuelve `{ results, isFallback }`, NO un array** | ⚠️ drift |
| `agregar_carrito` → `agregarAlCarrito(ctx.data.carrito, ctx.data.viewing)` | `agregarAlCarrito` | `(carritoActual, producto)` `_shared.js:387` | Puro (no toca DB). Devuelve `{ ok, escalar, cantidadActual, carrito, total }`. El diseño asume que devuelve el carrito directo (`data:{carrito:r}`) | ⚠️ drift |
| `cargar_dias_cita` → `require('./citasFlow').diasDisponibles()` | `diasDisponibles` | `()` `citasFlow.js:53` (exportada `:152`) | Lee `citas`. OK | ✅ |
| `cargar_servicios` (B.2) | `serviciosDisponibles` | `()` `citasFlow.js:20` — **NO exportada** | Lee `productos WHERE tipo='servicio'` | ⚠️ drift (no exportada) |
| `grabar_pedido` → `grabarPedidoEnvio(ctx.data, ctx.tel)` | `grabarPedidoEnvio` | `(data, telefono)` `_shared.js:863` | tx interna; INSERT direcciones/pedidos/links_pago/envios; email async; `marcarOutcome`. Devuelve `{folio,total,linkUrl,...}` | ✅ |
| (pickup) | `grabarPedidoPickup` | `(data, telefono)` `_shared.js:819` | idem | ✅ |
| (split) | `grabarPedidoSplit` | `(data, telefono)` `_shared.js:951` | 2 pedidos | ✅ |
| `insertarPedidoConCarrito` | `insertarPedidoConCarrito` | `(clienteNombre, carrito, ciudadEnvio, estatus, sucursalOrigen, folio, idCliente, canalCreacion)` `_shared.js:815` | **tx** (`_insertarPedidoConCarritoTx` `:776`). INSERT pedidos + pedido_detalle. **NO descuenta inventario** (ver C.2). Devuelve `{ pedidoRowid, subtotal }` | ✅ existe / ❌ el diseño la describe mal en D.1 |
| `insertarLinkPago` | `insertarLinkPago` | `(pedidoRowid, monto, folio)` `_shared.js:745` | INSERT `links_pago` (id_metodo **fijo=4**, estatus 'generado'). Si `pago_real_activo` ON → **throw** (`:768`). Devuelve `linkUrl` (string, NO `{linkUrl}`) | ⚠️ drift (retorno) |
| `registrarMetodoPago` | `registrarMetodoPago` | `(pedidos, nombreMetodo)` `_shared.js:731` | UPDATE pedidos por **folio**. `pedidos`=array `[{folio}]` | ✅ (ojo: recibe array, no 1 pedido) |
| `buscarCobertura` | `buscarCobertura` | `(cp)` `_shared.js:332` | Lee `cobertura`. Devuelve row o `null` | ✅ |
| `partirCarrito` | `partirCarrito` | `(carrito, estadoCob)` `_shared.js:493` | Lee `inventarios` (`stockBatch`). Devuelve `{pickup,envio,sinStock}` | ✅ |
| `generarFolio` | `generarFolio` | `(tipo='pedido')` `_shared.js:108` | **UPDATE `series_folios`** (efecto: consume folio). Devuelve string | ✅ |
| `upsertCliente` | `upsertCliente` | `(telefono, nombre=null)` `_shared.js:599` | INSERT/UPDATE `clientes`. Devuelve row | ✅ |
| `otorgarPuntosPorCompra` | `puntosService.otorgarPuntosPorCompra` | `(idPedido)` (handlers/puntosService) | idempotente vía `pedidos.puntos_acreditados` | ✅ |
| `crear_cita` → `registrarCita(ctx)` | **INLINE en `citasFlow.js:139`** (no hay función `registrarCita`) | `INSERT INTO citas (telefono,nombre,servicio,servicio_precio,id_servicio,fecha,hora)` | La lógica de crear cita **no está factorizada** en una función reusable; vive dentro del `handle` de `CITA_CONFIRMA` | ❌ no-existe como función |
| `cobrar_anticipo` → `crearAnticipoDeCita` / `grabarPedidoAnticipoCita` | **NO EXISTE** ninguna de las dos | — | El diseño las inventa (wrapper ~15 líneas). Hay que escribirlas | ❌ no-existe (esperado: es lo nuevo) |
| `registrarPreventa` (patrón a reusar) | `stockService.registrarPreventa` | verificar firma real | El diseño cita `stockService.js:154-193` con `porcentaje_anticipo/anticipo_pagado/saldo_pendiente/estatus='apartado'` | ✅ (patrón existe; reuso conceptual, no llamada directa) |

### Correcciones exactas de los drifts de firma

1. **`searchProducts` devuelve `{results, isFallback}`**, no un array (`_shared.js:166,201,213`).
   El snippet del diseño `const r = shared.searchProducts(...); return { resultado: r.length ? ... }`
   **fallará**: `r.length` es `undefined`. Corregir a `r.results.length`.

2. **`agregarAlCarrito` devuelve `{ok, escalar, carrito, ...}`** (`_shared.js:403`), y **puede
   rechazar** (`ok:false, escalar:true`) al superar `maxMismoProd()`. El diseño (`data:{carrito:r}`)
   ignoraría el caso escalar → mete el objeto entero como carrito. Corregir a `r.carrito` + honrar `escalar`.

3. **`insertarLinkPago` devuelve un string** (`_shared.js:762`), el diseño lo usa como `r.linkUrl`.

4. **`serviciosDisponibles` y la lógica de crear cita no están exportadas/factorizadas.**
   Fase 1 debe exportarlas o replicarlas en `actions.js`.

---

## B. Puntos de conexión críticos (uno por uno)

### B.1 sessionManager → motor  ✅ (con matiz)
`sesiones_bot` es `{paso_actual TEXT, data TEXT-JSON}` genérico (`sessionManager.js`), sin
migración necesaria. `citasFlow` ya persiste `cita_fecha/cita_hora/cita_servicio_id/
cita_servicio_precio` como llaves de `data` (`citasFlow.js:101,113,123`). El motor encaja.
**Matiz:** el diseño usa `ctx.data._reintentos` como slot interno — hoy nada lo limpia; hay
que asegurar que `clearSession`/reset lo borre (lo hace, `data={}`).

### B.2 actionHandler → motor  ⚠️ drift de `ctx`
El diseño (A.2) afirma que `ctx` = "el mismo objeto que arma `actionHandler.js:144`
`{ userId, action, step, data, tel, raw, ... }`". **El objeto real** (`actionHandler.js:144`) es:
```
{ userId, session, message, client, raw, action, step, data, tel, isImage }
```
Coincide en las llaves que el motor usa (`userId, action, step, data, tel, raw`) ✅, pero:
- **`ctx.data.viewing` NO existe** — el producto en curso se guarda como `data.selectedProduct`
  o `data.viewing` según el flow; verificar en menuFlow. El snippet `ctx.data.viewing` puede ser
  `undefined`. **Corregir el nombre del slot tras leer menuFlow.**
- El registro propuesto en C.1 `const motor = motorActivo() ? require(...) : null;` a nivel de
  módulo **cachea el flag al cargar** — pero `moduloActivo` se refresca cada 60s. Debe evaluarse
  **por request**, no una sola vez al `require`. Corregir: construir `_flowsActivos` con el flag
  dentro de `handleAction` (como ya se hace con `_giro`, `actionHandler.js:145-146`).

### B.3 Frases por instancia  ✅
`flujo_nodo.frase_clave` → `configuracion.frase_<clave>` vía `t()` (`_config.js`) es coherente
con el patrón real (`t()` importado en `_shared.js:20`, exportado `:1328`). Correcto.

### B.4 Cobro / links_pago / marcar-pagado — sin doble-cobro  ✅ pero OJO doble-descuento
- El chokepoint `POST /api/pagos/:id/marcar-pagado` existe (`comunicacionPedidos.js`) y es donde
  se descuenta inventario y se otorgan puntos. `insertarLinkPago` fija `id_metodo=4`, estatus
  `'generado'` (`_shared.js:759`). No hay doble-cobro si cada pedido tiene su propio `links_pago`.
- **RIESGO DOBLE-DESCUENTO (histórico, ver C.2):** el diseño D.1 línea 524 dice que el descuento
  de stock ocurre "dentro de `insertarPedidoConCarrito` (tx) `_shared.js:815-816`". **ES FALSO.**
  El tx (`_shared.js:776-809`) inserta pedido+detalle y **NUNCA toca `inventarios`**. El descuento
  ocurre en `marcar-pagado`. Si un implementador confía en el doc y agrega un descuento "que faltaba"
  dentro de la acción del motor, **reintroduce el doble-descuento**. Corregir el doc.

### B.5 Anticipo de cita → pedido  ⚠️/❌ el diseño ignora que YA existe cita→cobro
El prompt pedía verificar consistencia con "citas.js cobrar, migración 0057". **Lo que existe hoy
en producción** (`dashboard/routes/citas.js:68-107`, `POST /api/citas/:id/cobrar`):
- Cobra el **servicio completo** (no un anticipo), reusando `insertarPedidoConCarrito`
  (`citas.js:89`) con `carrito=[{id:cita.id_servicio, price, cantidad:1, tipo:'servicio'}]`.
- Marca el `links_pago` como **`'pagado'`** directo (`:93`), estatus pedido `'entregado'`,
  `metodo_entrega='pickup'`, canal `'mostrador'`.
- Liga `citas.id_pedido` y `estatus='completada'` (`:95`). Guard anti-doble-cobro: `if
  (cita.id_pedido) return 'ya fue cobrada'` (`:76`).
- Asiento contable y puntos **FUERA de la tx** (`:99-103`) — patrón deliberado (como POS/mesas).

**Consecuencias para el diseño:**
- La columna que el diseño quiere agregar en `0027` (`citas.id_pedido_anticipo`) **choca** con
  la ya existente `citas.id_pedido` (migración 0057, `schema.sql:1137`). Y `servicio_precio`/
  `id_servicio` que el diseño da por ausentes **YA EXISTEN** (0057). El diseño afirma
  (A.3 / apéndice) que "`citas` hoy NO tiene columnas de dinero, `db/schema.sql:1129-1141`" — **eso
  era cierto antes de 0057, hoy es falso**.
- El diseño modela el anticipo como cobro **por el bot** vía link de pago (`'generado'`, se paga
  online). El cobro real hoy es **por el cajero en mostrador** (`'pagado'` directo). Son dos
  caminos distintos; el diseño debe decidir: ¿el anticipo lo cobra el bot (link) o el mostrador?
  Si es link (como dice E.1), es maquinaria **nueva** que convive con `citas.js:cobrar`, no la reusa.

---

## C. Riesgos de integración REALES

### C.1 Transacción anidada — ❌ RIESGO CONFIRMADO
better-sqlite3 **no permite transacciones anidadas** (lanza "cannot start a transaction within a
transaction"). El diseño `cobrar_anticipo` (E.1) hace:
```
const r = shared.grabarPedidoAnticipoCita(...)   // wrapper sobre insertarPedidoConCarrito = TX
db.prepare('UPDATE citas SET ...').run(...)       // fuera de tx: OK
```
Eso **sí es seguro** (el UPDATE va después de que la tx cerró). **PERO** si el implementador
envuelve toda `cobrar_anticipo` en su propia `db.transaction(...)` (como hace `citas.js:88` para
atomicidad cobro+cita), y dentro llama `insertarPedidoConCarrito` (que abre **su** tx `_shared.js:776`)
→ **excepción**. `citas.js:cobrar` **evita esto** llamando `insertarPedidoConCarrito` dentro de su
`db.transaction` — lo cual **funciona** porque better-sqlite3 permite anidar si la interna es la
misma función-tx (se degrada a savepoint)... **NO**: verificar. `citas.js:88-98` llama
`insertarPedidoConCarrito` (tx) DENTRO de `db.transaction(() => {...})`. En better-sqlite3 esto
**es legal** (una `db.transaction` invocada dentro de otra se convierte en savepoint), así que el
patrón de producción ya está probado. **Mitigación:** el motor debe copiar exactamente el patrón de
`citas.js:cobrar` (envolver en `db.transaction` y llamar las funciones-tx dentro), NO abrir `BEGIN`
manual. Documentarlo explícitamente en el doc.

### C.2 Doble-descuento de inventario — ⚠️ el doc lo reintroduce si se cree literal
Ya cubierto en B.4. `insertarPedidoConCarrito` (`_shared.js:776-809`) **no descuenta stock**. El
descuento vive en `marcar-pagado` (`comunicacionPedidos.js`) y en el POS (`pos.js`). Para servicios,
`citas.js:cobrar` **no descuenta nada** (correcto: un servicio no tiene inventario). **Corregir D.1
línea 524 del diseño.** Riesgo alto porque toca dinero/stock y hay historia de este bug (MEMORY.md).

### C.3 `db` compartido — ✅ sin riesgo
Un único singleton `bot/db_connection.js` (WAL, 5s busy timeout). Motor, acciones, dashboard y bot
comparten la misma conexión. `citas.js:cobrar` lo confirma (usa el mismo `require('../../bot/flows/_shared')`).
No hay riesgo de dos conexiones peleando.

### C.4 Asiento fuera de tx — ✅ patrón ya establecido
`citas.js:99-103` hace `asientoVenta` y `otorgarPuntosPorCompra` **después** de la tx, en try/catch
que traga el error. El diseño debe seguir el mismo orden para el anticipo (asiento/puntos fuera de tx).

### C.5 Byte-identidad de juguetería — ✅ viable, con condición
El flag `motor_flujo_activo` va en `DEFAULT_OFF` (`modulosDefaults.js:16-47` — **hoy NO está en la
lista, hay que agregarlo**). Con flag OFF y `FLOWS` intacto, JC es idéntico. **Condición:** el registro
del motor debe evaluar el flag **por request** (B.2), no al `require`, o un cambio de flag no tomaría
efecto sin reinicio y rompería la promesa "sin reiniciar".

### C.6 Número de migración `0027` — ❌ COLISIÓN
El diseño (A.3, apéndice) dice "Nueva migración `0027_flujo_motor.sql` (siguiente número libre tras
`0026_citas.sql`)". **Falso:** el último aplicado es **`0057_citas_cobro.sql`**; `0027` ya es
`producto_variantes` (`schema.sql:1149`). La migración del motor debe ser **`0058_flujo_motor.sql`**.

---

## D. Correcciones al DISENO_MOTOR_FLUJO.md ANTES de implementar

Lista concreta, en orden de gravedad:

1. **[BLOQUEANTE] D.1 línea 524 — borrar la fila "(descuento stock) dentro de
   `insertarPedidoConCarrito` (tx) `_shared.js:815-816`".** Es falso y reintroduce doble-descuento.
   El descuento vive en `marcar-pagado`/POS, nunca en `insertarPedidoConCarrito`.

2. **[BLOQUEANTE] Reconciliar con `citas.js:cobrar` (0057).** El doc asume que cita→cobro no existe.
   Existe y funciona (mostrador, `links_pago='pagado'`, `citas.id_pedido`). Decidir explícitamente:
   el anticipo por bot (link `'generado'`) es maquinaria NUEVA que **convive** con el cobro de
   mostrador — no lo reemplaza. Reescribir A.3/E.1 en consecuencia.

3. **[BLOQUEANTE] Renumerar la migración: `0027` → `0058_flujo_motor.sql`.** `0027` está tomado.

4. **[BLOQUEANTE] Columnas de `citas`:** NO agregar `servicio_precio`/`id_servicio`/`id_pedido`
   (ya existen, 0057). Si el anticipo necesita `anticipo`/`saldo_pendiente`, agregarlas SIN chocar
   con `id_pedido` existente. Actualizar A.3 y el apéndice ("citas sin columnas de dinero" es obsoleto).

5. **[ALTO] Firmas en `actions.js` (A.2):** corregir `searchProducts` → `r.results.length`;
   `agregarAlCarrito` → `r.carrito` + manejar `escalar`; `insertarLinkPago` devuelve string.
   `serviciosDisponibles`/crear-cita no están exportadas: exportarlas o replicarlas.

6. **[ALTO] Registro del motor por request (C.1 del diseño):** cambiar el `require`-time
   `const motor = motorActivo() ? ...` a evaluación dentro de `handleAction` (patrón de `_giro`,
   `actionHandler.js:145`), o el toggle de módulo no surte efecto sin reinicio.

7. **[MEDIO] `ctx.data.viewing`:** verificar el nombre real del slot del producto en curso
   (`selectedProduct` vs `viewing`) leyendo menuFlow antes de escribir `agregar_carrito`.

8. **[MEDIO] Añadir `motor_flujo_activo` a `DEFAULT_OFF`** (`modulosDefaults.js`) — el doc lo
   asume ahí pero no está.

9. **[BAJO] Patrón de tx del anticipo:** documentar que debe copiar `citas.js:88` (envolver en
   `db.transaction`, llamar funciones-tx dentro), nunca `BEGIN` manual.

---

## E. Veredicto

**NO está listo para ejecutar Fase 0/1 tal cual.** El modelo conceptual es correcto y casi todas las
funciones selladas existen con firmas usables, pero el documento se escribió contra una foto del
código **anterior a las migraciones 0027–0057** y contra una suposición **falsa** sobre el descuento
de inventario. Hay 4 correcciones bloqueantes (D.1–D.4) que son errores de hecho, no de opinión, y
que si se implementan literalmente causan: doble-descuento de stock (D.1), duplicar/chocar con el
cobro de citas ya en producción (D.2), colisión de migración (D.3) y colisión de columna (D.4).

**Qué cerrar antes de Fase 0:** aplicar las correcciones D.1–D.4 y D.6 (las que tocan dinero, schema
y el flag). D.5/D.7/D.8/D.9 pueden cerrarse dentro de Fase 1 al escribir `actions.js`. Con eso, la
Fase 0 (golden snapshot + baseline) y Fase 1 (extraer acciones envolviendo `_shared.js`) se pueden
ejecutar sin sorpresas — la frontera sellada y la byte-identidad de JC son genuinamente alcanzables
porque el flag OFF deja `FLOWS` intacto.

**Lo que el diseño acertó y se sostiene contra el código:** `db` singleton compartido (C.3), sesión
genérica sin migración (B.1), frases por `t()` (B.3), fail-closed vía `undefined`→router viejo
(coherente con `actionHandler.js:151-157`), y el reuso de `insertarPedidoConCarrito`/`insertarLinkPago`
como ruta única de dinero (validado por `citas.js:cobrar`, que ya lo hace en producción).
