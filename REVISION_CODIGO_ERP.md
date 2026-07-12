# Revisión de código ERP — hallazgos reales

Revisión de ingeniería sobre los módulos ERP (`dashboard/routes/*` + `services/*`).
Foco: lógica de negocio incompleta / a medias / con bug — **no** estilo.
Evidencia con archivo:línea. Cero cambios de código aplicados.

**Índice de rutas:** `node scripts/rutas/inventario.js --check` →
`✓ Sin colisiones ni sombras de ruta (260 rutas en 22 módulos).` Sano.

Hallazgos ordenados por gravedad. Al final, lo que verifiqué que **sí** está bien.

---

## ALTO 1 — Costo promedio se pondera contra el stock de TODAS las sucursales, no la que recibe

**`services/costeoService.js:15`** (dentro de `registrarEntrada`)

```js
const stockPrevio = db.prepare('SELECT COALESCE(SUM(stock),0) s FROM inventarios WHERE id_producto=?').get(idProducto)?.s || 0;
```

`registrarEntrada` calcula el costo promedio móvil ponderando `costoPrevio` por
`stockPrevio`, pero `stockPrevio` es la **suma del stock del producto en todas
las sucursales**. En un negocio multitienda, recibir 10 pzas en la sucursal B
pondera el costo contra el inventario que ya había en A + B + C. El costo
promedio resultante (que es **global**, `productos.costo` es una sola columna)
queda sesgado hacia el costo viejo aunque la tienda que recibió estuviera
vacía. Con una sola sucursal es correcto; con varias, el costo unitario que
alimenta COGS (`asientoCostoVenta`, tablero de márgenes, valor de inventario)
queda mal.

Además el comentario de cabecera dice *"LLAMAR ANTES de aumentar el stock (usa
el stock previo para ponderar)"* y en `erpProveedores.js:143` (`ocRecibir`) se
respeta el orden (costeo antes del `UPDATE inventarios`), pero en
`compras.js:147-149` (`facturaXml`, carga de conceptos) se llama
`costeo.registrarEntrada(...)` y luego `kardexService.movimiento(...)` — ahí sí
está en orden. El problema no es el orden, es el `SUM(stock)` global.

**Fix mínimo:** `productos.costo` es un costo global de una columna única, así
que la ponderación correcta es contra el stock **global** — y eso es lo que hace.
El bug real es conceptual: si el negocio quiere costo promedio *correcto* debe
ponderar contra el mismo universo que representa `productos.costo` (global), lo
cual ya hace. **Reclasificar:** en realidad es consistente. Ver "sólido". → mover
la atención al hallazgo ALTO 2, que sí muerde.

> Nota de honestidad: al trazar el flujo completo, `productos.costo` es
> deliberadamente **un costo promedio global** (no por sucursal), y `SUM(stock)`
> global es la base correcta para esa cantidad. **No es bug.** Lo dejo anotado
> para que no se "arregle" rompiéndolo.

---

## ALTO 1 (real) — `asientoCostoVenta` lee el costo DESPUÉS de que una entrada intermedia pudo cambiar el promedio

**`services/contabilidadService.js:119-133`** + puntos de disparo
(`comunicacionPedidos.js:286`, `pos.js:241`, `citas.js` no aplica).

`asientoCostoVenta(idPedido)` calcula el COGS leyendo `productos.costo` **en el
momento del cobro**, no el costo vigente cuando se creó/entregó el pedido:

```js
SELECT COALESCE(SUM(d.cantidad * COALESCE(p.costo, 0)), 0) c
FROM pedido_detalle d JOIN productos p ON p.id = d.id_producto WHERE d.id_pedido = ?
```

Un pedido a crédito (fiado) se crea hoy con costo $10; entra mercancía nueva
que sube el promedio a $14; al cobrarse el fiado semanas después,
`asientoCostoVenta` (disparado en `marcar-pagado`) asienta COGS a $14, no al
costo real de la mercancía que salió. El margen del período queda distorsionado
y no cuadra contra el kardex (que sí movió las piezas al costo del momento de la
venta). Es el problema clásico de "costo del pedido" vs "costo actual del
producto".

**Fix mínimo:** congelar el costo unitario en `pedido_detalle` al insertar la
línea (columna `costo_unitario_snapshot`) y que `asientoCostoVenta` sume sobre
esa columna, no sobre `productos.costo`. Migración + un `SUM` distinto; sin
snapshot, todo COGS diferido en el tiempo es aproximado.

---

## ALTO 2 — Doble asiento de compra en `facturaXml` cuando la factura carga inventario

**`dashboard/routes/compras.js:117-124` y `:146-149`**

`facturaXml` (factura de proveedor por CFDI) hace **dos** cosas que ambas tocan
contabilidad de inventario:

1. `conta.asientoCompra(...)` con `cuentaCargo: '115'` (Inventario) — carga el
   valor total de la factura a la cuenta 115 (línea 118-124).
2. Si `d.cargar_conceptos && d.es_mercancia`, además llama
   `costeo.registrarEntrada(...)` por concepto (línea 147), que sube
   `productos.costo`, y `kardexService.movimiento(... tipo:'entrada')` (línea
   149) que sube el stock.

El asiento contable (paso 1) carga 115 por el total del CFDI. Pero el valor real
que entra al inventario físico (paso 2) es `SUM(concepto.cantidad *
valor_unitario)`, que puede **no coincidir** con el total del CFDI (descuentos a
nivel comprobante, conceptos no-mercancía mezclados, redondeos). El asiento dice
que entraron $X a inventario; el kardex dice que entraron $Y. No hay
reconciliación entre ambos. En `ocRecibir` esto sí está bien atado (el asiento
usa `montoRecibido` que es exactamente lo que entró al kardex,
`erpProveedores.js:161`), pero en `facturaXml` el asiento y la carga física se
calculan por caminos distintos.

**Fix mínimo:** cuando `cargar_conceptos && es_mercancia`, asentar 115 por la
**suma efectivamente cargada al kardex** (acumular `montoCargado` en el loop de
conceptos), no por `cfdi.total`. Lo que no sea mercancía va a 601/gasto por
separado.

---

## ALTO 3 — Reversa de asiento vuelve a validar cuadre pero NO valida período cerrado del asiento original

**`services/contabilidadService.js:200-217`** (`asientoReversa`)

`asientoReversa` genera la contrapartida invertida vía `registrarAsiento` **sin
`override`** y **sin `fecha`**, así que la reversa cae en la fecha de HOY. Dos
consecuencias:

1. Si el asiento original era de un mes ya **cerrado** (`periodo_cerrado`), la
   reversa se asienta en el mes abierto actual — correcto contablemente (no se
   toca el pasado), pero **descuadra la balanza del mes cerrado**: el original
   sigue ahí, la reversa está en otro mes. Para una cancelación de una venta de
   un período cerrado, el reporte del mes cerrado sigue mostrando la venta como
   válida.
2. `asientoReversa` no registra `sucursal`, así que la reversa de un asiento con
   sucursal cae como `sucursal NULL` → desaparece del libro mayor filtrado por
   tienda (`libroMayor` con `?sucursal=` excluye NULL, `contabilidadService.js:230`).
   El original resta de la tienda, la reversa no suma de vuelta → el P&L por
   tienda queda permanentemente inflado tras cualquier cancelación.

**Fix mínimo:** en `asientoReversa`, copiar `sucursal` (y `fecha` si se quiere
reversar en el mismo período con `override`) del asiento original —
`SELECT ... sucursal FROM asientos WHERE id=?` ya se tiene la fila.

---

## MEDIO 1 — Nómina: comisión sobre ventas cobradas se pierde si `con_impuestos=0`

**`services/nominaService.js:114-140`**

Todo el bloque de comisiones, séptimo día, prima dominical y horas-extra por-día
está **dentro de `if (fiscal)`** (`_fiscalActivo()` = flag global
`nomina_fiscal_activo`). Si el negocio NO activó el modo fiscal:

- `horasNormales = horasTot` (todas las horas al mismo precio),
- `comisiones = 0` **aunque el empleado tenga `comision_pct > 0`**,
- séptimo día y prima dominical = 0.

Un vendedor con comisión pactada no cobra su comisión salvo que el negocio
prenda el modo fiscal global — dos cosas que no tienen por qué ir juntas. La
comisión es un derecho laboral pactado, no un cálculo fiscal. El comentario de
la línea 136 (*"comisiones = % sobre lo COBRADO"*) promete algo que solo ocurre
en modo fiscal.

**Fix mínimo:** sacar el cálculo de `comisiones` (y séptimo día / prima
dominical, que también son LFT, no fiscales) fuera del `if (fiscal)`. Lo único
que debería quedar tras el gate fiscal es ISR/IMSS.

---

## MEDIO 2 — `timbrarREP` arma el complemento de pago con datos placeholder no verificados

**`services/pacService.js:194-223`**

El propio comentario lo admite (línea 191-193): *"el mapeo completo del payment
complement (parcialidad, saldo insoluto, documento relacionado) debe validarse
contra una factura PPD real antes de producción"*. El payload actual (línea
206-212) manda:

- `payment_form: '03'` **hardcodeado** (transferencia) ignorando
  `ped.metodo_pago`,
- `amount: ped.total`, `last_balance: ped.total` — asume pago **total** en una
  sola exhibición; una factura PPD que se pagó en parcialidades reportaría saldo
  insoluto incorrecto,
- `taxes: []` — sin impuestos trasladados en el REP, que el SAT sí exige en el
  complemento.

Está detrás de doble-gate (módulo + credenciales), así que un cliente sin PAC no
lo dispara — pero un cliente que **sí** configure Facturapi y timbre un REP
recibirá un complemento mal armado. No es inerte como el resto del andamiaje: si
las credenciales existen, llama al PAC de verdad.

**Fix mínimo:** derivar `payment_form` de `_formaPagoSAT(ped.metodo_pago)` (ya
existe la función, `pacService.js:75`), y bloquear con un error explícito
("REP con parcialidades requiere validación manual") hasta reconciliar
`amount`/`last_balance` contra los abonos reales, en vez de asumir pago total.

---

## MEDIO 3 — `contabilidad-electronica` (balanza) usa `mes + '-31'` como fin de mes

**`dashboard/routes/erpContabilidad.js:374-377`**

```js
const desde = mes + '-01';
const hasta = mes + '-31';
```

Para febrero (`2026-02-31`), abril, junio, etc. el `BETWEEN a.fecha <= '2026-02-31'`
funciona por comparación lexicográfica de strings (`'2026-02-28' <= '2026-02-31'`
es true), así que **no pierde filas** — pero es frágil: si algún asiento se
capturara con una fecha basura tipo `2026-02-30` entraría, y cualquier refactor
que convierta a fecha real rompería. Mismo patrón sano-por-accidente. El XML de
balanza va al SAT, así que conviene el fin de mes exacto.

**Fix mínimo:** `hasta = new Date(anio, m, 0).toISOString().slice(0,10)` (día 0
del mes siguiente = último día real del mes).

---

## MEDIO 4 — `flota/status`: campo `bot_estatus` es un placeholder que siempre devuelve `undefined`

**`dashboard/routes/flota.js:39`**

```js
bot_estatus: g('stockwatcher_modo') ? undefined : undefined, // placeholder — el estatus vivo del bot lo da pm2, no la BD
```

El ternario devuelve `undefined` en ambas ramas (se serializa como campo
ausente en el JSON). Es código muerto declarado como tal en el comentario. El
agregador de flota que consuma este endpoint nunca recibe `bot_estatus`; el dato
útil está en `ultimo_bot_estatus` (línea 40). No rompe nada pero es un campo
prometido que no existe — un integrador del panel de flota lo notaría.

**Fix mínimo:** borrar la línea 39 (ya existe `ultimo_bot_estatus`), o poblarla
desde `bot_status_log` como hace la línea de abajo.

---

## BAJO 1 — `pedidosPut` (cambio de estatus) no repone inventario al cancelar

**`dashboard/routes/comunicacionPedidos.js:191-218`**

Cambiar el estatus de un pedido a `'cancelado'` vía `PUT /api/pedidos/:id`
solo hace `UPDATE pedidos SET estatus='cancelado'` y avisa al cliente. **No**
revierte el cobro ni repone el inventario. El camino "correcto" para revertir es
`POST /api/pagos/:id/cancelar` (que sí llama `reversionService.revertirCobro`,
línea 318). Pero un operador que cambie el estatus a "cancelado" desde el
selector de estatus del pedido deja el stock descontado y el asiento de venta en
pie. Dos caminos para "cancelar" con efectos distintos; el más obvio (cambiar
estatus) es el que no limpia.

**Fix mínimo:** en `pedidosPut`, si `estatus === 'cancelado'` y el pedido tiene
un `links_pago` pagado, redirigir a / invocar `revertirCobro` en vez de solo
tocar la etiqueta — o bloquear la transición a 'cancelado' por esa ruta y
forzar el flujo de `pagos/:id/cancelar`.

---

## BAJO 2 — `asientoDevolucion` no modela el reembolso de dinero (comentario lo admite)

**`services/contabilidadService.js:164-176`**

`asientoDevolucion` solo repone inventario a costo (115 debe / 501 haber). El
comentario (línea 166-167) dice: *"El reembolso de dinero al cliente no está
modelado como flujo todavía → se registra con asiento manual si aplica."* Es un
faltante consciente: la devolución revierte el COGS pero **no** revierte el
ingreso ni la salida de caja del reembolso. En un negocio con devoluciones
frecuentes, ventas y caja quedan sobreestimadas hasta que alguien capture el
asiento manual — que nadie va a recordar hacer. Cliente lo nota en el cierre.

**Fix mínimo:** cuando la devolución sea con reembolso, encadenar un asiento
401 debe (reversa de ingreso) / 101|102 haber (salida de caja) además del de
inventario. Requiere saber el monto reembolsado (hoy `asientoDevolucion` solo
recibe cantidad, no monto).

---

# Sólido (verificado — no tocar)

- **`marcar-pagado` es atómico e idempotente** (`comunicacionPedidos.js:246-306`):
  el `UPDATE links_pago ... AND estatus!='pagado'` + descuento de kardex +
  `cobrado_por` van en una sola `db.transaction`; el 409 previo evita doble
  cobro; asientos/puntos/notifs quedan fuera de la transacción a propósito
  (idempotentes, no deben abortar el cobro). Bien pensado.

- **Idempotencia de asientos de venta/crédito/cobro**
  (`contabilidadService.js:82,97,110`): cada uno chequea
  `SELECT 1 FROM asientos WHERE referencia_tipo=? AND referencia_id=?` antes de
  insertar. Defensa correcta ante reintentos.

- **Cuadre de partida doble** (`contabilidadService.js:47-49`): todo asiento
  valida `|debe - haber| <= 0.01` y exige ≥2 partidas antes de la transacción.
  Ningún asiento desbalanceado entra.

- **`registrarAsiento` respeta período cerrado con override auditado**
  (`:38-41`) y todos los llamadores (gastos/factura/factura-xml) exigen
  `esAdminOMas` + dejan huella `configAudit` antes de pasar `override:true`.
  Consistente en `erpContabilidad.js`, `compras.js`.

- **`ocRecibir` (recepción parcial)** (`erpProveedores.js:116-166`): costeo,
  stock, `cantidad_recibida`, CxP y estatus parcial/recibida van en una
  transacción; el asiento de compra usa **exactamente** `montoRecibido` (lo que
  entró al kardex), sin el descuadre que sí tiene `facturaXml`.

- **POS `ventaPost`** (`pos.js:139-258`): antifraude de precio con PIN + rango
  [50%, 100%] del precio de lista; antisobreventa con PIN; límite de crédito
  validado contra saldo real; todo el cobro (pedido + link + kardex +
  `cobrado_por`) en una transacción. `insertarPedidoConCarrito` **no** descuenta
  stock (verificado, `_shared.js:815`), así que el kardex del POS no duplica
  descuento. Sólido.

- **`fiadoAbono` FIFO** (`pos.js:353-398`): liquida tickets completos viejo→nuevo,
  reusa `asientoCobroCredito` (idempotente por pedido) + puntos; el límite del
  modelo (parcial dentro de un ticket) está marcado con `ponytail:` y es una
  simplificación consciente, no un bug.

- **DIOT** (`erpContabilidad.js:301-332`): usa base/IVA **exactos del CFDI**
  cuando la CxP los tiene (columnas `base`/`iva` pobladas por `facturaXml`) y
  solo cae al cálculo plano al `iva_pct` para CxP capturadas a mano. La
  separación `base_real`/`monto_sin_base` es correcta.

- **Reversión de cobro** (`reversionService.js`, vía `pagos/:id/cancelar` y
  `pos venta/:id/cancelar`): centralizada en un solo servicio; ambos callers lo
  invocan en vez de duplicar la lógica.

- **Timbrado CFDI principal (`pacService.timbrar`)** está genuinamente armado
  (no inerte falso): doble-gate real, no duplica (`cfdi_uuid`), valida datos
  fiscales y conceptos, mapea forma de pago SAT. El único stub peligroso es el
  **REP** (MEDIO 2), no el timbrado normal.

- **RBAC / áreas** (`permisos.js`): jerarquía `rangoDe` limpia, auditor
  read-only por bypass global, `permite()` correcto. Separación de funciones
  aplicada en compras (aprobar exige gerente, pagar exige finanzas).
