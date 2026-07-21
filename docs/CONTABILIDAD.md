# Contabilidad y fiscal (ERP)

> Funcional, no andamiaje. El motor de partida doble, el costeo, la nómina y el
> cierre de período están implementados y probados. **CFDI 4.0 con PAC real
> (Facturapi/Facturama)** está implementado como adaptador HTTP; queda
> "conectar credenciales" desde Prime.

## Índice
1. [Motor de partida doble](#motor-de-partida-doble)
2. [Catálogo de cuentas](#catálogo-de-cuentas)
3. [Tipos de asiento y el flujo del dinero](#tipos-de-asiento-y-el-flujo-del-dinero)
4. [IVA base-flujo (México)](#iva-base-flujo-méxico)
5. [Cierre de período y reversas](#cierre-de-período-y-reversas)
6. [CFDI 4.0 / PAC](#cfdi-40--pac)
7. [DIOT y contabilidad electrónica](#diot-y-contabilidad-electrónica)
8. [Nómina](#nómina)
9. [Cortes de caja](#cortes-de-caja)
10. [Costeo](#costeo)

---

## Motor de partida doble

`services/contabilidadService.js`. Los asientos se guardan en `asientos`
(cabecera: fecha, concepto, `referencia_tipo`, `referencia_id`, `sucursal`) +
`asientos_detalle` (`cuenta`, `debe`, `haber`). Reglas:

- Un asiento requiere **≥2 partidas** y debe **cuadrar** (debe = haber, ±1 centavo) o lanza error.
- Solo corre con `contabilidad_activo` ON (default **ON**). Con OFF, los asientos automáticos no-opean; el registro manual y las consultas siguen.
- Cada asiento auto es **idempotente** por `(referencia_tipo, referencia_id)`: no duplica si el chokepoint de pago se dispara dos veces.
- **Multitienda** (migración `0051`): el asiento se atribuye a la sucursal que originó el pedido (`pedido_detalle.sucursal_origen`; primera en un split) — centro de costos ligero, sin prorrateo.
- **Inmutable** (migración `0030`): triggers `BEFORE UPDATE/DELETE` sobre `asientos`/`asientos_detalle` lo impiden. Se corrige con asiento de reversa, no editando.

## Catálogo de cuentas

`plan_cuentas` (migración `0022`). Cuentas base que usa el motor:

| Cuenta | Nombre | Tipo |
|---|---|---|
| 101 | Caja (efectivo) | Activo |
| 102 | Bancos (no-efectivo) | Activo |
| 105 | Clientes por cobrar (fiado) | Activo |
| 115 | Inventario | Activo |
| 201 | Proveedores | Pasivo |
| 208 | IVA trasladado **no cobrado** (fiado) | Pasivo |
| 209 | IVA trasladado (cobrado / exigible) | Pasivo |
| 401 | Ventas | Ingreso |
| 501 | Costo de ventas | Costo |

`_cuentaCobro(metodoPago)`: efectivo → **101**, cualquier otro → **102**.

## Tipos de asiento y el flujo del dinero

**Chokepoint único:** `POST /api/pagos/:id/marcar-pagado`
(`dashboard/routes/comunicacionPedidos.js`). Es el punto por el que converge
**todo** cobro (WhatsApp, POS de mostrador, fiado). Al marcar pagado dispara,
en orden:

```
marcar-pagado
   ├─ kardexService.movimiento(venta, delta -cantidad)   ← descuenta stock
   ├─ [si fiado]  asientoCobroCredito()                   ← entra el dinero + IVA exigible
   │  [si contado] asientoVenta() + asientoCostoVenta()   ← ingreso + costo
   ├─ puntosService.otorgarPuntosPorCompra()              ← lealtad (si módulo ON)
   └─ referidosService.otorgarPuntosPorPrimeraCompra()    ← referido
```

`referencia_tipo` por asiento automático:

| `referencia_tipo` | Función | Partidas (con IVA%) |
|---|---|---|
| `venta` | `asientoVenta` | D 101/102 · H 401 (base) · H 209 (IVA) |
| `venta_credito` | `asientoVentaCredito` | D 105 · H 401 (base) · H 208 (IVA no cobrado) |
| `cobro_credito` | `asientoCobroCredito` | D 101/102 · H 105 · D 208 / H 209 (IVA se vuelve exigible) |
| `costo_venta` | `asientoCostoVenta` | D 501 · H 115 (costo congelado del pedido) |
| `compra` | `asientoCompra` / `asientoEntradaContado` | D 115 (+IVA acreditable) · H 201/101/102 |
| `gasto` | `asientoGasto` | D gasto (+IVA) · H 101/102 |
| `pago_cxp` | `asientoPagoCxP` | D 201 · H 101/102 |
| `devolucion` | `asientoDevolucion` | reversa de la venta |

## IVA base-flujo (México)

El IVA se **causa al cobrar**, no al facturar (base flujo, como exige el SAT):

- **Contado:** al cobrar, el IVA entra directo a **209** (trasladado exigible).
- **Fiado:** al **vender** se reconoce ingreso (D 105 / H 401) y el IVA va a **208** (trasladado *no cobrado*, aún no exigible). Al **cobrar** el IVA migra 208→209 (D 208 / H 209). El costo de venta se reconoce aparte al entregar.

La tasa es `configuracion.iva_pct` (0 = sin IVA; entonces todo el monto es base).
`base = monto / (1 + iva/100)`.

## Cierre de período y reversas

- **Cierre total** (idea SAP): `configuracion.periodo_cerrado = 'YYYY-MM'`. Un mes `<= periodo_cerrado` está cerrado; asentar ahí lanza error salvo `override` autorizado (gerente/prime, con huella de quién). API: `GET/PUT /api/erp/periodo-cierre`.
- **Reversas** (`asientoReversa`, `services/reversionService.js`): genera el asiento contrario (idempotente), no edita el original.

## CFDI 4.0 / PAC

- **Lectura** (`services/cfdiService.js`): parsea CFDI XML 3.3/4.0 (emisor, total, conceptos, UUID) para cargar facturas de proveedor sin captura manual. Blindado anti-DoS (tope 5MB, sin DOCTYPE/ENTITY → XXE/billion-laughs, tope 1000 conceptos → ReDoS).
- **Timbrado** (`services/pacService.js` + `pacProviders.js`): adaptadores HTTP a PAC reales, **sin SDK**. Modelo **key-only (Facturapi)**: el negocio sube su CSD una vez en el portal del PAC y obtiene `sk_live_...`; el sistema solo guarda la API key (cifrada at-rest con `pac_cifrado_activo`, default ON). También `facturama`. Endpoints (`erpContabilidad.js`, área `finanzas`): `POST /api/erp/timbrar/:id`, `GET /api/erp/cfdi/:tipo/:id`, `POST /api/erp/cfdi/:id/cancelar`, `POST /api/erp/cfdi/:id/rep` (complemento de pago). Config Prime: `GET/PUT /api/prime/pac`.
- Columnas: `pedidos.cfdi_uuid`/`cfdi_estatus` (`0043`), `pedidos.rep_uuid` (`0055`), `nominas.cfdi_uuid`/`cfdi_estatus` (`0053`).
- **Facturación "ligera"** (`facturacion_activo`, OFF): NO es CFDI timbrado — es un comprobante con datos fiscales (`pedidos.razon_social`/`rfc`) + referencia (folio) + leyenda. Distinto del timbrado real de arriba.

## DIOT y contabilidad electrónica

Reportes SAT sobre el libro mayor (`erpContabilidad.js`, área `finanzas`):

- `GET /api/erp/diot` — Declaración Informativa de Operaciones con Terceros (IVA acreditable por proveedor).
- `GET /api/erp/contabilidad-electronica` — catálogo/balanza/pólizas para el SAT.
- `GET /api/erp/impuestos` — cálculo de impuestos del período.
- `GET /api/erp/libro-mayor`, `/plan-cuentas`, `/asientos`, `/rastro` (auditoría), `/flujo-caja`, `/salud-financiera`, `/tablero`, `/unit-economics`, `/rentabilidad-clientes`, `/rentabilidad-vendedores`.
- **Conciliación bancaria** (`0060`): `movimientos_banco`, `POST /api/erp/conciliacion/importar`, `GET /api/erp/conciliacion`, `POST /api/erp/conciliacion/:id`.
- **Activos fijos** (`0081`): `activos_fijos`, alta/baja/depreciación (`/api/erp/activos*`, baja con PIN).
- **Baúl contable** (`baul_contable_activo`): archiva CFDIs por mes y exporta por lote (`/api/erp/baul`, `/baul/exportar`).

## Nómina

`services/nominaService.js` + `dashboard/routes/rrhh.js` (área `rrhh`). Módulos
`rrhh_activo` / `nomina_fiscal_activo` (ambos OFF). Tablas: `empleados`,
`horarios_empleado`, `nominas`, `nomina_extraordinaria`, `incapacidades_empleado`.

Nómina LFT completa: horas extra, comisiones (`empleados.comision_pct`),
aguinaldo, finiquito (por `tipo_baja`: renuncia/despido justificado/injustificado/
jubilación), séptimo día, prima dominical, IMSS patronal, vacaciones. Import de
horarios por Excel (`POST /api/rrhh/horarios/importar`). Timbrado de nómina CFDI
(`POST /api/rrhh/nomina/:id/timbrar`). **Pago con PIN** (aguinaldo/finiquito/
nómina).

## Cortes de caja

`cortes_caja` (migración `0018`, rehecha en `0023`; `sucursal` en `0049`).
`dashboard/routes/pos.js`: `POST /api/pos/venta` (venta de mostrador, canal
`mostrador`), `GET/POST /api/pos/corte` (gerente+). El corte suma pedidos
pagados (WhatsApp + mostrador) por `metodo_pago` para una fecha, calcula
esperado-vs-contado en efectivo y persiste el cierre. Módulo `pos_activo` (OFF).

## Costeo

- `productos.costo` (migración `0016`) = costo de adquisición; margen (`price - costo`) se muestra en el catálogo Prime.
- `pedido_detalle.costo_unitario` (migración `0061`): costo **congelado** al momento del pedido → `asientoCostoVenta` usa ese costo, no el actual (cae al costo del producto si es NULL en filas viejas).
- `services/costeoService.js` + `historial_costos` (`0022`): costeo promedio.
- Entrada de mercancía: `POST /api/prime/entrada-mercancia` suma a `inventarios`, opcionalmente actualiza `productos.costo` y registra `inventario_movimientos` (kardex, `tipo='entrada'`).

---

## Discrepancias con CLAUDE.md

1. CLAUDE.md no menciona **partida doble, `plan_cuentas`, ni el motor contable** — están completos.
2. CLAUDE.md pone CFDI como "Fase 2 / andamiaje inerte"; el código tiene **adaptadores PAC reales** (Facturapi/Facturama) con timbrado, cancelación y complemento de pago.
3. No menciona **DIOT, contabilidad electrónica SAT, conciliación bancaria ni activos fijos** — presentes.
4. No menciona **nómina LFT** (aguinaldo/finiquito/IMSS/séptimo día) — presente y con timbrado.
5. El IVA base-flujo (208 no cobrado → 209 exigible) es lógica fiscal MX real, ausente de CLAUDE.md.
