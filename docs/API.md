# API del dashboard

`dashboard/server.js` (http nativo). **~343 rutas en 31 módulos**
(`dashboard/routes/*.js`). Cada módulo declara sus rutas como datos en un
arreglo `RUTAS` y las envuelve con `_construirModulo.js`. Regenerar el
inventario en vivo:

```
node scripts/rutas/inventario.js          # índice legible
node scripts/rutas/inventario.js --json    # JSON
node scripts/rutas/inventario.js --check    # exit≠0 si hay colisión de rutas
```

## Modelo de autorización

- **Gate global**: `server.js` exige `requireSession` (cualquier sesión) para todo `/api/*` salvo la whitelist pública.
- **Whitelist pública** (sin sesión): `POST /api/login`, `POST /api/logout`, `GET /api/me`, `GET /api/onboarding/estado`, `POST /api/onboarding`, `GET /api/flota/status`.
- **Gate por ruta** (adicional): `area`/`areas` (especialistas — `permite(rol,area)`; basta una) o `roles` (rango mínimo: `['gerente']` deja pasar gerente+prime, `['prime']` solo prime).
- **🔐 PIN**: rutas `pin:true` — el tronco valida el PIN de autorización (gerente+ sin PIN) y deja bitácora antes del handler.
- `·global` abajo = solo el gate global (cualquier sesión logueada, sin área).

Leyenda de la columna Gate: nombre de área, `gerente`/`prime` (rango mínimo),
`·global`, `🌐público`, `🔐PIN`.

---

## Autenticación y núcleo (`core.js`)

| Método | Path | Gate | Qué hace |
|---|---|---|---|
| POST | /api/login | 🌐público | Login, emite cookie `jc_session` |
| POST | /api/logout | 🌐público | Cierra sesión |
| GET | /api/me | 🌐público | Usuario actual |
| GET | /api/stats | ·global | KPIs del Inicio (ventas hoy, pedidos pagados hoy…) |
| GET | /api/pedidos · /api/guias · /api/buscar | ·global | Listados base |
| GET | /api/clientes | operacion | Clientes |
| GET | /api/bot/status · /status-history | operacion | Estado del bot (PM2) + timeline |
| POST | /api/bot/start · /stop · /restart · /bridge/restart | operacion | Control del proceso bot |
| GET | /api/bot/qr | operacion | QR de vinculación WhatsApp |

## Pedidos, pagos y comunicación (`comunicacionPedidos.js`)

| Método | Path | Gate | Qué hace |
|---|---|---|---|
| POST | **/api/pagos/:id/marcar-pagado** | pos·operacion·finanzas | **Chokepoint de cobro**: kardex + asientos + puntos + referidos |
| POST | /api/pagos/:id/enviar-link · /regenerar | pos·operacion | Link de pago |
| POST | /api/pagos/:id/cancelar | pos·operacion·finanzas 🔐PIN | Cancela cobro (espejo inverso de marcar-pagado) |
| POST | /api/notificar | operacion | Notificación individual |
| GET/POST | /api/masivo/preview · /api/masivo | gerente | Envío masivo |
| PUT | /api/pedidos/:id | operacion | Editar pedido |
| GET | /api/pedidos/:id/ticket · /historial | ·global | Ticket / historial |
| POST | /api/pedidos/:id/repartidor | operacion | Asignar / en camino / entregado |
| GET/POST | /api/repartidores | operacion / gerente | Catálogo de repartidores |
| GET | /api/devoluciones · PUT /:id | ·global / operacion | Devoluciones |
| GET | /api/pos/buscar-producto · POST /api/pos/venta-previa | ·global / operacion | POS "venta previa" |

## POS y cortes (`pos.js`)

`GET /api/pos/config · /productos`, `POST /api/pos/venta` — cualquier sesión
(cajero+). `GET/POST /api/pos/corte` — **gerente+** (es un reporte).

## Atención al cliente y métricas (`atencionCliente.js`)

Cola de atención (`/api/cola_atencion`), mensajes de cliente/pedido,
reanudar bot, lista de espera, preventas, búsquedas. **Métricas** (gerente):
`/api/metricas/campanas · canales · operacion · salud-bot · segmentacion ·
embudos-abandono · abandono-motivos`, `/api/gerente/reportes`.

## Catálogo, cola y sustitutos (`catalogoCola.js`)

Cola de envíos (`/api/cola*`), `/api/productos/buscar`, preventas
(`PUT /api/preventas/:id`), `/api/notificar-lista/:id` (gerente), sustitutos
(`/api/sustitutos*` — GET global, POST/DELETE gerente).

## Marketing (`marketing.js`)

Categorías/marcas/ofertas/promociones/cupones/conversión/métricas. Lecturas
`·global`; `POST/PUT /api/promociones*` y `POST /api/reporte` → gerente;
`POST /api/cupon/redimir` → pos·operacion; `POST /api/beta/limpiar` → prime.

## CRM (`crm.js`)

Pipeline (`GET /api/crm/pipeline`), etapa/notas/timeline/tareas de cliente
(operacion), campañas y segmentos (`/api/crm/campanas*`, `/segmentos*` →
gerente).

## ERP / Contabilidad (`erpContabilidad.js`) — todo área `finanzas`

Plan de cuentas, asientos, libro mayor, rastro, facturación pendiente,
tablero, unit-economics, gasto de marketing, activos fijos (+depreciar, baja
con PIN), cierre de período, rentabilidad clientes/vendedores, **timbrar**
(`POST /api/erp/timbrar/:id`), CFDI (descarga/cancelar/REP), flujo de caja,
salud financiera, gastos, impuestos, **DIOT**, **contabilidad electrónica**,
conciliación (importar/listar/conciliar), baúl contable (+exportar). Ver
[CONTABILIDAD.md](CONTABILIDAD.md).

## Compras y proveedores (`erpProveedores.js`, `compras.js`)

Proveedores/OC (`compras`/`finanzas`/`almacen`), recibir OC (`almacen`), CxP
(`finanzas`), pagar CxP (`finanzas`), reordenar/cancelar (`compras`).
Solicitudes de compra y carga de factura/factura-XML (`compras`/`finanzas`);
aprobar solicitud → gerente.

## Almacén (`almacen.js`) — área `almacen` / `almacen_lectura`

Inventario, kardex, calendario, caducidades, plantilla de conteo, conteo (+
aplicar), **salida y traslado (🔐PIN)**, ubicación, mermas.

## RRHH / nómina (`rrhh.js`) — área `rrhh`

Empleados (alta 🔐PIN — fija el `salario_diario` inicial, mismo gate que
editarlo), horarios (+importar Excel), incapacidades, cálculo/pago de nómina
(🔐PIN, deja rastro de auditoría con usuario+monto), timbrado de nómina,
aguinaldo (pago 🔐PIN), finiquito (pago 🔐PIN).

## Servicios / mesas / citas / suscripciones / documentos

| Módulo | Rutas | Gate |
|---|---|---|
| `mesas.js` | mesas, cocina, item/listo, cerrar, sugeridos | pos·operacion |
| `citas.js` | citas, empleados, cobrar, anticipo-config, comisiones | operacion / gerente / pos |
| `suscripciones.js` | listar/crear/actualizar/cobrar/generar-cobros | operacion |
| `documentos.js` | documentos + plantillas | operacion / gerente (crear plantilla) |
| `ordenesServicio.js` | órdenes de servicio | operacion |
| `asistencias.js` | check-in | operacion |
| `tareas.js` | tareas + pendientes-count | usuario |

## Correo y mensajería

| Módulo | Rutas | Gate |
|---|---|---|
| `correo.js` | config, enviados, bandeja, sincronizar, leído, adjunto, enviar | gerente |
| `mensajeria.js` | canales, no-leídos, directo, grupo, mensajes | ·global (equipo interno) |

## Configuración Prime (`primeConfig.js`, `primeCatalogo.js`, `primeUsuariosPuntos.js`, `motorFlujo.js`, `seguridadOperativa.js`, `instancias.js`)

- **primeConfig**: tono, frases, negocio, régimen fiscal, zona horaria, zonas de cobertura, PAC, pasarela, tope-descuento, envío default, Estafeta días de entrega, sucursal de facturación default, exportar-LLM, módulos (`GET /api/modulos`, `/api/modulo/:clave`), soporte. Mayoría **prime**; lecturas de config `·global`; `POST /api/tono` gerente.
- **primeCatalogo** (gerente+): alta/edición de productos y categorías, entrada de mercancía (`POST /api/prime/entrada-mercancia`, actualiza costo + kardex).
- **primeUsuariosPuntos**: usuarios (crear/editar gerente, borrar prime), puntos (config gerente, ranking/consulta global).
- **motorFlujo** (prime): motor, versiones, revertir, simular, plantillas, acciones, activar, `PUT /grafo`.
- **seguridadOperativa** (prime): PIN de autorización, backup cifrado (+armar), reset-instancia, respaldo/restaurar BD, purgar sesión WhatsApp.
- **instancias** (prime): `GET /api/instancias`, `POST /api/instancias/abrir` (multi-instancia).

## Onboarding y flota

- `negocioOnboarding.js`: `GET /api/onboarding/estado`, `POST /api/onboarding` (**públicas**, se auto-bloquean tras `negocio_configurado=1`), `GET /api/soporte`.
- `flota.js`: `GET /api/flota/status` (**pública**, hub máquina-a-máquina con token propio).

## Etiquetas e imágenes (`etiquetas.js`)

Etiquetas de clientes, imágenes de clientes/productos, logs de error — lecturas
`·global`, `PUT /api/etiquetas/:id` operacion.

---

## Rutas `·global` candidatas a revisar rol

El propio inventario marca ~50 rutas con solo gate global (cualquier sesión) —
en su mayoría **lecturas** (stats, pedidos, guías, ofertas, ranking, tickets).
No es un bug per se (requieren sesión válida), pero es la lista a auditar si se
quiere endurecer por área. Correr `node scripts/rutas/inventario.js` la imprime.

## Discrepancias con CLAUDE.md

1. CLAUDE.md dice "40+ rutas en un `handleAPI`"; son **~336 en 30 módulos** con tronco declarativo.
2. CLAUDE.md no documenta las áreas especialistas (`permite(rol,area)`) como mecanismo de gate — es el real, no solo `requireSession`.
3. Rutas de puntos "eliminadas" según CLAUDE.md (`/api/puntos/ticket|usados|preparar`) confirmadas ausentes; pero existen `/api/puntos/config|ranking|:tel` (correcto).
