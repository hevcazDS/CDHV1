# Auditoría de herramientas por rol de usuario (v2)

ERP multitienda white-label (bot WhatsApp + dashboard), instancia por cliente. Auditado: `dashboard/permisos.js`, `dashboard-ui/src/lib/{roles,permisos}.js`, `_construirModulo.js`, índice canónico (`node scripts/rutas/inventario.js`, 250 rutas / 22 módulos), `Layout.jsx`, `App.jsx` y páginas.

Mapa rol→áreas (fuente única, `dashboard/permisos.js:16-24`):

| Rol (rango) | Áreas |
|---|---|
| cajero (1) | `pos` |
| operador / usuario legacy (1) | `pos`, `operacion` |
| almacen (1) | `almacen` |
| almacen_lectura | (solo lectura de almacén vía `areas:['almacen','almacen_lectura']`) |
| compras (1) | `compras`, `almacen_lectura` |
| rh (1) | `rrhh` |
| contabilidad (1) | `finanzas`, `rrhh`, `cortes` |
| auditor (1) | TODAS en solo-GET (`permisos.js:37`, enforce único `server.js:661`) |
| gerente (2) | todas |
| prime (3) | todas + usuarios + integraciones/instancias |

---

## Tabla por rol: operación esperada vs herramienta

### cajero (`pos`)
| Operación diaria | ¿Tiene? | Evidencia |
|---|---|---|
| Vender en mostrador | sí | `Layout.jsx:38` (Mostrador, area pos); `pos.js:320` |
| Cerrar su corte de caja | sí | `pos.js:322` `pos||cortes||finanzas`; corte en Mostrador |
| Ver su comisión | sí | `/api/comisiones/mio` global + `VistaOperador.jsx:17` |
| Registrar venta a fiado | sí | `Mostrador.jsx:224-254` (`config.credito`) |
| Ver cartera de fiado | sí | `Layout.jsx:43` Fiados `areas:['pos','finanzas']` |
| **Cobrar/liquidar un fiado** | **MAL-GATED** | endpoint `marcar-pagado` permite `pos` (`comunicacionPedidos.js:448`), pero la única UI está en Pedidos, cuyo link exige `operacion` (`Layout.jsx:41`) → cajero no la alcanza. Mostrador y Fiados lo mandan "a Pedidos" (`Mostrador.jsx:227`, `Fiados.jsx:59`) |
| Atender mesas (restaurante) | sí | `Layout.jsx:39`, `mesas.js:167` `pos||operacion` |

### operador (`pos`,`operacion`)
| Operación | ¿Tiene? | Evidencia |
|---|---|---|
| Pedidos / marcar pagado / devoluciones | sí | `Layout.jsx:41-42`; `comunicacionPedidos.js:448` |
| Cola atención / chat / clientes / ranking | sí | `Layout.jsx:50-53` (area operacion) |
| Citas (servicios/barbería) + cobrar | sí | `citas.js:110-113` |
| Repartidor propio (en camino/entregado) | sí | `comunicacionPedidos.js:443-445` |

### almacen / almacen_lectura
| Operación | ¿Tiene? | Evidencia |
|---|---|---|
| Inventario, kardex, conteo, traslado, salida, ubicación | sí | `almacen.js:190-198` |
| Recibir orden de compra | sí | `erpProveedores.js:204` `POST .../recibir` = `almacen` |
| Entrada de mercancía | sí | `primeCatalogo.js:400` `almacen` |
| almacen_lectura escribe | no (correcto, es solo lectura) | conteo/salida = `almacen` a secas |

### compras (`compras`,`almacen_lectura`)
| Operación | ¿Tiene? | Evidencia |
|---|---|---|
| Proveedores, OC (crear/reordenar/cancelar), CxP, solicitudes, factura proveedor | sí | `erpProveedores.js:198-205`, `compras.js:194-198` |
| Ver inventario para decidir compra | sí | `almacen_lectura` en OC y almacén |

### rh (`rrhh`)
| Operación | ¿Tiene? | Evidencia |
|---|---|---|
| Empleados, cálculo/pago/timbrado de nómina | sí | `rrhh.js:243-259` (pago con PIN :253) |

### contabilidad (`finanzas`,`rrhh`,`cortes`)
| Operación | ¿Tiene? | Evidencia |
|---|---|---|
| Plan de cuentas, asientos, libro mayor, CFDI, DIOT, contab. electrónica, impuestos, flujo, gastos | sí | `erpContabilidad.js:559-581` |
| Cortes de caja (reporte) | sí | `pos.js:322-324` incluye `cortes`/`finanzas` |
| CxP / OC (lectura) | sí | `erpProveedores.js:200,205` incluye `finanzas` |

### auditor
| Operación | ¿Tiene? | Evidencia |
|---|---|---|
| Leer todo, escribir nada | sí | `permisos.js:37`; write bloqueado en un punto único `server.js:661`; UI oculta Módulos/Prime/Beta `Layout.jsx:124-125` |

### gerente / prime
Pasan todas las áreas (`permisos.js:31,37`). prime suma usuarios gerente/prime, instancias, integraciones (`server.js:368-370`). Sin huecos de alcance.

---

## HUECOS CONFIRMADOS (por gravedad)

### ALTO — 1. Cajero no puede cobrar/liquidar un fiado que él mismo creó
- **Qué falta:** el cajero (`pos`) crea la venta a crédito en Mostrador, pero la liquidación solo existe como acción en **Pedidos**, cuyo link de menú exige `operacion` (`Layout.jsx:41`). El propio texto del sistema lo manda a un lugar que no ve: `Mostrador.jsx:227` "Cóbralo luego desde Pedidos" y `Fiados.jsx:59` "Para cobrar, marca el pago en Pedidos".
- **Evidencia de que el endpoint SÍ lo permitiría:** `POST /api/pagos/*/marcar-pagado` está gateado `pos||operacion||finanzas` (`comunicacionPedidos.js:448`) — la intención era que pos cobrara; la UI se quedó atrás.
- **Rol/giro:** cajero en cualquier giro con fiado (abarrotes/carnicería/ferretería).
- **Fix mínimo:** añadir botón "Liquidar" en `Fiados.jsx` (que el cajero SÍ ve) llamando a `marcar-pagado`; o cambiar el link de Pedidos a `areas:['operacion','pos']`. Cero backend nuevo.

### ALTO — 2. No existe abono / pago parcial de fiado
- **Qué falta:** el modelo de cobro es todo-o-nada (`marcar-pagado` liquida el pedido completo). No hay ruta ni pantalla de **abono parcial**, pese a que el sistema lo promete: el mensaje de límite excedido dice literalmente "Regístrale un abono" (`pos.js:154`).
- **Grep negativo:** `abono|pago_parcial|liquidar` en `dashboard/` solo aparece como texto en ese error (`pos.js:154`) — no hay endpoint. No hay ruta `abono` en el índice canónico.
- **Rol/giro:** cajero/operador en giros de fiado; un cliente que paga "de a poco" (uso normal de abarrotes) queda bloqueado al tope sin forma de bajarlo salvo liquidar todo.
- **Fix mínimo:** `POST /api/pos/fiados/:idCliente/abono {monto}` que inserta un `links_pago` pagado parcial contra el pedido más viejo a crédito; botón "Abonar" en Fiados. Reusa el chokepoint de saldo que ya calcula `pos.js:152`.

### MEDIO — 3. Propina de mesa sin pantalla de reparto ni atribución por mesero
- **Qué falta:** la propina se cobra y se guarda en la mesa "para el reparto a meseros" (`mesas.js:126-127,142`), pero (a) no hay rol MESERO ni `id_mesero` en la mesa/pedido (`mesas.js` agrupa por local/sucursal, no por persona — grep de `mesero` solo halla comentarios) y (b) no hay pantalla/ruta de reparto (grep `reparto|repartir` = 0 handlers).
- **Rol/giro:** restaurante. La propina se acumula pero nadie puede repartirla ni saber a quién le tocó.
- **Fix mínimo (lean):** reporte "propinas del día por local/turno" reusando `mesas.propina` (una consulta + tab en corte). El reparto persona-a-persona real necesitaría `id_mesero` en la venta — dejarlo fuera hasta que un cliente restaurante lo pida.

### BAJO — 4. Rol MESERO / COMISIONISTA no existen como tales (pero están cubiertos por operador+cobrado_por)
- **Qué falta como rol nominal:** no hay `mesero` ni `comisionista` en `RANGO_ROL` (`permisos.js:8-13`).
- **Por qué es BAJO:** funcionalmente cubierto — un `operador`/`cajero` opera mesas (`mesas.js:167` `pos||operacion`) y la comisión se atribuye por quién cobra (`cobrado_por`, `primeConfig.js:98,117`) con auto-vista `/api/comisiones/mio`. Solo falta la etiqueta y la atribución fina por mesero (ver hueco 3).
- **Fix:** ninguno urgente; si se quiere la etiqueta, agregar `mesero: 1` a los dos espejos con áreas `['pos','operacion']`.

---

## FALSOS HUECOS (ya resueltos — no reabrir)

- **Comisiones / rol comisionista:** SÍ existe. Config y reporte `gerente` (`primeConfig.js:489-491`), auto-vista para cualquier sesión `/api/comisiones/mio` (`primeConfig.js:490,104-118`), y tarjeta en el home del operador (`VistaOperador.jsx:17,30-33`). La atribución es por `cobrado_por`.
- **Propina (captura):** SÍ se captura y suma al total (`mesas.js:128,136,142`, migración `0054_mesa_propina.sql`, UI `Mesas.jsx`). Lo que falta es el reparto (hueco 3), no la captura.
- **Almacén ↔ recepción de OC:** ya arreglado — `POST /api/erp/ordenes-compra/*/recibir` = `almacen` (`erpProveedores.js:204`) y `almacen` ve `/almacen` (`Layout.jsx:60`). Sin mis-gate.
- **Auditor escribiendo:** imposible; bloqueado en punto único (`server.js:661`) y con techo a gerente (`server.js:370`).
- **Citas→cobro (servicios/barbería):** completo, `POST /api/citas/*/cobrar` `pos||operacion` (`citas.js:113`) genera pedido + asiento + puntos (`citas.js:100-103`).
- **Contabilidad sin cortes:** falso, `contabilidad` incluye `cortes` (`permisos.js:22`) y el reporte los permite (`pos.js:322`).

---

## Veredicto

Casi todos los roles pueden operar su día completo: almacén, compras, RH, contabilidad, operador, gerente, prime y auditor están completos y bien gateados. Los giros de citas (servicios/barbería) y restaurante (mesas/propina/captura) funcionan.

**Lo único bloqueante en la práctica** es de giro **fiado (abarrotes/carnicería/ferretería)** y recae en el **cajero**: crea la venta a crédito pero **no puede cobrarla** (hueco 1, UI mal-gated) y **no puede abonar parcialmente** (hueco 2, endpoint inexistente pese a que el propio sistema lo promete). Ambos son fixes baratos (un botón en Fiados + una ruta de abono que reusa el saldo ya calculado). El resto (propina-reparto, rol mesero nominal) es medio/bajo y no impide operar.
