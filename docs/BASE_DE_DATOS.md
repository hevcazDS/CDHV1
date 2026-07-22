# Base de datos

SQLite (better-sqlite3, WAL). **Fuente de verdad del esquema: `migrations/*.sql`**
(87 migraciones), no `db/schema.sql` (drifteado respecto a producción). Este
documento inventaría las tablas por dominio; para la definición exacta de una
columna, ver la migración citada o `PRAGMA table_info(...)` contra una `.db`
real.

Tablas **base** (preexistentes al versionado de migraciones): `productos`,
`inventarios`, `clientes`, `pedidos`, `pedido_detalle`, `conversaciones`,
`mensajes`, `sesiones_bot`, `sucursales`, `categorias`, `configuracion`,
`log_eventos`, `cola_notificaciones`, `cola_emails`, `links_pago`,
`guias_estafeta`, `promociones`, `devoluciones`, `carritos_abandonados`,
`cola_atencion`, `lista_espera`, `preventas`, `puntos_entrega`,
`productos_similares`, `regalos_lealtad`, `metodos_pago`.

## Operación / ventas

| Tabla | Origen | Claves |
|---|---|---|
| `pedidos` | base + `0001,0011,0013,0014,0015,0023,0028,0036,0039,0043,0055,0061` | folio, cliente, estatus, `metodo_pago`, `metodo_entrega`, `razon_social`/`rfc`, `cfdi_uuid`, `a_credito`/`fiado_vence_en`, `cobrado_por`, `tono_bot` |
| `pedido_detalle` | base + `0027,0061` | `id_variante`/`variante`, `costo_unitario`, `sucursal_origen` |
| `links_pago` | base | estatus, monto, `pagado_en`, `fecha_expiracion` |
| `metodos_pago` | `0014` | efectivo/transferencia/tarjeta/paypal/mercadopago/oxxo; `activo`, `requiere_link`, `configuracion` (JSON) |
| `repartidores` | `0015` | catálogo (nombre/teléfono); el reparto va en el pedido |
| `cortes_caja` | `0018,0023,0049` | corte por fecha/sucursal, esperado vs contado |
| `devoluciones` | base + `0047` idx | id_pedido, id_producto, estatus |
| `guias_estafeta` | base | tracking, fecha_envio_est |
| `mesas` / `mesa_items` | `0034,0050,0054,0072` | restaurante: estatus, `sucursal`, `propina`, item `listo` (cocina) |
| `citas` | `0026,0057,0065,0069` | fecha/hora, teléfono, `id_servicio`/`id_pedido`, `anticipo`/`saldo_pendiente`, `id_empleado` |
| `ordenes_servicio` | `0073` | estatus (talleres/servicios) |
| `suscripciones` | `0062` | estatus, `proximo_cobro` (cobro recurrente/MRR) |
| `asistencias` | `0083` | check-in por fecha, `id_cliente` (gimnasio/clases) |
| `tareas` | `0048` | recordatorios internos, estatus/fecha |
| `zonas_cobertura` | `0029` | cobertura por zona (giro ISP legacy) |

## Catálogo / inventario / almacén

| Tabla | Origen | Claves |
|---|---|---|
| `productos` | base + `0006,0016,0023,0068,0071,0079` | `costo`, `tipo` (fisico/…), `unidad_medida`, `unidad_compra`/`factor_compra`, `video_url`/`modelo_3d_url` |
| `inventarios` | base + `0046` idx | stock vivo por producto/sucursal (PK real `id_inventory`) |
| `inventario_movimientos` | `0006,0024,0030,0070` | **kardex inmutable**; `lote`/`caducidad` (merma) |
| `producto_variantes` / `inventario_variantes` | `0027` | variantes (talla/color), UPC |
| `producto_insumos` | `0072` | recetas de cocina (BOM de platillos) |
| `ubicaciones_inventario` | `0023` | ubicación física en almacén |
| `activos_fijos` | `0081` | activo, estatus, depreciación |

## Contabilidad / finanzas

| Tabla | Origen | Claves |
|---|---|---|
| `plan_cuentas` | `0022` | catálogo de cuentas |
| `asientos` | `0022,0051` | fecha, concepto, `referencia_tipo`/`referencia_id`, `sucursal`; **inmutable** |
| `asientos_detalle` | `0022` | cuenta, debe, haber; **inmutable** |
| `proveedores` | `0022` | catálogo |
| `ordenes_compra` / `_detalle` | `0022,0040,0050,0056` | `fecha_llegada_est`, `sucursal_destino`, `cantidad_recibida` (recepción parcial) |
| `cuentas_pagar` | `0022,0058` | CxP; `base`/`iva` exactos del CFDI |
| `solicitudes_compra` | `0023` | requisiciones |
| `historial_costos` | `0022` | costeo promedio |
| `movimientos_banco` | `0060` | conciliación bancaria (fecha, lote) |
| `configuracion_log` | `0031` | bitácora forense de config + autorizaciones PIN |

## RRHH / nómina

| Tabla | Origen | Claves |
|---|---|---|
| `empleados` | `0023,0033,0041,0064` | comisión, método pago, `tipo_baja`/`fecha_baja`, datos de contrato (nacimiento, domicilio, horario, día descanso) |
| `horarios_empleado` | `0023` | horario por fecha |
| `nominas` | `0023,0033,0042,0044,0053,0087` | horas extra, comisiones, prima dominical, IMSS patronal, séptimo día, CFDI, `pagada_por` (usuario que autorizó el pago) |
| `nomina_extraordinaria` | `0038` | pagos extraordinarios |
| `incapacidades_empleado` | `0044` | incapacidades por rango de fechas |

## CRM / marketing

| Tabla | Origen | Claves |
|---|---|---|
| `clientes` | base + `0012,0020,0039,0074` | `descuento_referido_usado`, `marketing_opt_out`, `limite_credito`, `etapa` (pipeline) |
| `crm_etapas` | `0074` | historial de etapas por cliente |
| `crm_notas` | `0074` | notas por cliente |
| `crm_tareas` | `0075` | tareas CRM (vence_en, estatus) |
| `crm_segmentos` | `0075` | segmentos guardados |
| `crm_campanas` / `_pasos` / `_inscritos` | `0076,0077` | campañas multi-paso, inscripción |
| `chats_iniciados` | `0021` | métrica de chats iniciados por fecha |
| `cotizaciones_bot` | `0078` | cotizaciones armadas por el bot |

## Bot / flujo / mensajería

| Tabla | Origen | Claves |
|---|---|---|
| `mensajes` | base + `0019,0077` idx | `paso_actual`, `intencion` (dataset LLM) |
| `sesiones_bot` | base + `0010` | `version` (optimistic lock) |
| `flujo_grafo` / `flujo_nodo` / `flujo_arista` | `0065,0066,0067` | motor de flujo visual; nodo con `render`, `pos_x`/`pos_y` |
| `plantillas_documento` / `documentos` | `0063` | cotizaciones/pagarés/contratos |
| `canales_internos` / `canal_miembros` / `mensajes_internos` | `0080` | mensajería interna del equipo |
| `correos` | `0084` | correo (bandeja/enviados), `direccion` |
| `repartos` | `0059` | reparto de propinas/comisiones |
| `vision_revisiones` | `0003` | cola de revisión de Vision API |
| `logs_error` / `log_eventos` | `0004,0001,0046` | errores y eventos (con `tono_bot`) |

## Índices y triggers destacados

- **Ledgers inmutables** (`0030`): triggers `no_update`/`no_delete` sobre `asientos`, `asientos_detalle`, `inventario_movimientos`.
- **Auto-tono** (`0001`): triggers que rellenan `pedidos.tono_bot`/`log_eventos.tono_bot` desde `configuracion.tono_bot` en cada INSERT.
- Decenas de índices de rendimiento para polling/reportes (`0002,0032,0035,0037,0045,0046,0077`, etc.).

## Notas de drift conocido (memoria del proyecto)

- `inventarios`: la PK real en producción es **`id_inventory`**, no `id` (ya corregido en el dashboard).
- `cola_emails`: en producción tiene columnas duplicadas ad-hoc (`html_body`/`cuerpo_html`, `creado_en`/`creada_en`) que nunca se reconciliaron en `db/schema.sql`.
- No confíes en `db/schema.sql` como esquema literal sin verificar con `PRAGMA table_info(...)`.

## Discrepancias con CLAUDE.md

1. CLAUDE.md lista ~15-26 tablas críticas; el esquema real tiene **~125 tablas**
   (`grep -c "CREATE TABLE" db/schema.sql`) en 87 migraciones.
2. Dominios completos ausentes de CLAUDE.md: contabilidad (`plan_cuentas`/`asientos`), RRHH (`empleados`/`nominas`), CRM (`crm_*`), motor de flujo (`flujo_*`), mensajería (`canales_internos`), correo (`correos`), activos fijos, conciliación.
