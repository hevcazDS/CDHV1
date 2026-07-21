# Catálogo de módulos toggleables

Cada módulo es una capacidad encendible por instancia, guardada como fila
`configuracion.<clave>`. Fuentes: `bot/flows/modulosDefaults.js` (defaults +
dependencias + qué enciende cada giro), `dashboard-ui/src/pages/Modulos.jsx`
(títulos/descripciones que ve el gerente) y las rutas que los consumen.

**Regla de default:** una clave listada en `DEFAULT_OFF` arranca **apagada**;
cualquier otra clave `*_activo` arranca **encendida**.

**Rol administrador:** el toggle se administra desde la página **Módulos**
(`rolRequerido: gerente`). Algunos módulos son de configuración **prime** (motor
de flujo, PAC, pasarela) — ver columna.

## Tabla exhaustiva

| Clave | Qué hace | Default | Administra |
|---|---|---|---|
| `puntos_activo` | Puntos de lealtad automáticos por compra/referido | **OFF** | gerente |
| `ofertas_activo` | Bot muestra ofertas activas | ON | gerente |
| `upselling_activo` | Sugerencias de productos complementarios en carrito | ON | gerente |
| `lista_espera_activo` | Notifica cuando llega stock esperado | ON | gerente |
| `carritos_activo` | Mensaje de carrito abandonado (2h después) | ON | gerente |
| `vision_activo` | Búsqueda por imagen (Google Vision) | ON | gerente |
| `referidos_activo` | Código de referido + puntos en primera compra | ON | gerente |
| `inventario_activo` | Descuenta stock con kardex en cada venta (bot/POS/mesas) | ON | gerente |
| `contabilidad_activo` | Asientos automáticos de venta/compra/pago (partida doble) | **ON** | prime (en Módulos) |
| `crm_pipeline_activo` | El bot mueve la etapa CRM del cliente durante el chat | ON | gerente |
| `entrega_pickup_activo` | Bot ofrece recoger en sucursal | ON | gerente |
| `entrega_paqueteria_activo` | Bot ofrece envío por paquetería (Estafeta) | ON | gerente |
| `entrega_repartidor_activo` | Entrega local con repartidor propio ("va en camino") | **OFF** | gerente |
| `pago_multimetodo_activo` | Bot ofrece efectivo/transferencia/link (no solo link) | **OFF** | gerente |
| `pos_activo` | Punto de venta de mostrador + corte de caja | **OFF** | gerente |
| `mesas_activo` | Mesas de restaurante: abrir, items, cocina, cobrar | **OFF** | gerente |
| `citas_activo` | Agenda de citas por fecha/hora (giros de servicio) + recordatorio 24h | **OFF** | gerente |
| `facturacion_activo` | Comprobante con datos fiscales + referencia. **DEPENDE_DE:** `contabilidad_activo` | **OFF** | gerente |
| `pago_real_activo` | Cobro por pasarela real (andamiaje) | **OFF** | prime |
| `estafeta_real_activo` | API real de Estafeta (andamiaje, "Fase 2") | **OFF** | prime |
| `reconexion_auto_activo` | Reconexión automática del bot | **OFF** | gerente |
| `pago_link_activo` | Enviar link de pago por WhatsApp/POS | **OFF** | gerente |
| `recordatorio_pago_activo` | Recordatorio de link por vencer (~12h antes, una vez) | **OFF** | gerente |
| `recompra_activo` | Reordenar a proveedores desde historial + recordatorio de recompra al cliente | **OFF** | gerente |
| `ventas_credito_activo` | Ventas a crédito (fiado): CxC, ingreso al vender, IVA al cobrar. **Requiere** Contabilidad | **OFF** | gerente |
| `recordatorio_fiado_activo` | Recordatorio de fiado vencido (una vez). Requiere Ventas a crédito | **OFF** | gerente |
| `propina_activo` | Sugerir propina en el ticket (NO es ingreso gravado) | **OFF** | gerente |
| `reparto_activo` | Reparto de propinas/comisiones entre personal (pestaña POS) | **OFF** | gerente |
| `suscripcion_activo` | Cobro recurrente mensual (servicios) + proyección MRR | **OFF** | gerente |
| `documentos_activo` | Cotizaciones/pagarés/contratos con plantillas, imprimibles | **OFF** | gerente |
| `baul_contable_activo` | Archiva CFDIs del PAC por mes + export por lote (.zip) | **OFF** | gerente |
| `nomina_fiscal_activo` | Nómina LFT completa (extras, comisiones, aguinaldo, finiquito) | **OFF** | gerente/RH |
| `rrhh_activo` | Empleados, horarios por Excel, nómina MX | **OFF** | gerente/RH |
| `cotizacion_activo` | Bot arma cotización del carrito (informativa). Pieza del motor de flujo | **OFF** | gerente |
| `tiempo_entrega_activo` | Bot calcula ETA de envío. Pieza del motor de flujo | **OFF** | gerente |
| `motor_flujo_activo` | Comportamiento del bot por grafo editable (React Flow) | **OFF** | prime |
| `correo_activo` | Redactar/enviar correos con adjuntos vía Gmail (clave de app) | **OFF** | gerente |
| `media_avanzada_activo` | Liga de video + modelo/render 3D en el producto | **OFF** | gerente |
| `emojis_dashboard_activo` | Muestra/oculta emojis en el panel (look minimalista) | **OFF** | gerente |
| `llm_activo` | Hook LLM (inerte: `handle()` devuelve `null` hoy). Doble gate + key | **OFF** | prime |

> Cualquier otra clave `*_activo` no listada en `DEFAULT_OFF` (p.ej. las de
> entrega pickup/paquetería, ofertas, upselling) arranca **ON**.

## Dependencias (`DEPENDE_DE`)

| Módulo | Requiere |
|---|---|
| `facturacion_activo` | `contabilidad_activo` |

Activar una clave exige sus dependencias activas; apagar una dependencia con
dependientes activos se bloquea (lo valida el toggle del dashboard).

## Módulos que enciende cada giro (`MODULOS_POR_GIRO`)

Se aplican **una sola vez** al terminar el onboarding, solo en instancias
nuevas (Julio Cepeda nunca pasa por aquí). El dueño puede apagarlos después.

| Giro | Enciende |
|---|---|
| jugueteria / retail | `pos_activo` |
| abarrotes / carniceria | `pos_activo`, `ventas_credito_activo` |
| ferreteria | `pos_activo`, `ventas_credito_activo`, `documentos_activo` |
| restaurante | `pos_activo`, `mesas_activo`, `entrega_repartidor_activo`, `propina_activo`, `reparto_activo` |
| servicios | `citas_activo`, `documentos_activo` |
| freelancer | `citas_activo`, `documentos_activo`, `suscripcion_activo` |
| mantenimiento | `citas_activo` |
| barberia / tatuajes / estetica / unas | `citas_activo`, `pos_activo` |
| gimnasio | `citas_activo`, `suscripcion_activo`, `pos_activo` |
| custom | — (vacío) |

## Menú adaptativo por giro

`bot/flows/_giros.js` define qué opciones del menú del bot ve el cliente
(subconjunto de las 5 canónicas `buscar/wizard/rastrear/asesor/referidos`):

- **jugueteria, restaurante**: las 5 (texto desde FRASES; Julio Cepeda byte-idéntico).
- **retail, abarrotes, carniceria, ferreteria, custom**: sin `wizard` (el "ayúdame a elegir" es un cuestionario de regalo solo útil para juguetería).
- **servicios, mantenimiento, barberia, tatuajes, estetica, unas, gimnasio**: además ofrecen "agendar cita" (solo si `citas_activo` está ON).

## Notas

- La **contabilidad** arranca ON a propósito: antes arrancaba OFF y era la causa de que el tablero mostrara $0 sobre un negocio con ventas reales (los asientos no-opean con el módulo off).
- El **PIN de autorización** (no es un módulo toggle) protege operaciones sensibles (salida/traslado de almacén, pago de nómina/aguinaldo/finiquito, baja de activo). Ver [ARQUITECTURA.md](ARQUITECTURA.md#tronco-de-rutas-del-dashboard).
