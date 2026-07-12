# Verificación rol × ramo — ¿opera al 100%? (2026-07-12)

5 agentes auditaron el código real (rol de venta, back-office, ramos de producto,
ramos de servicio, restaurante). Veredicto global: **la arquitectura de roles y
permisos es sólida; los huecos son de cobertura funcional por giro, no de
seguridad.** Abajo, hallazgos con severidad y estado.

## ✅ APLICADO ya (preset de módulos por giro — `modulosDefaults.js`)
- abarrotes/carnicería/ferretería → +`ventas_credito_activo` (fían de rutina).
- restaurante → +`entrega_repartidor_activo` (casi siempre da domicilio).
- tatuajes → +`pos_activo` (antes no podía cobrar en mostrador de fábrica).

## ROLES — veredicto
| Rol | Estado | Hueco |
|---|---|---|
| Cajero | 🟡 | Registra fiado pero no tiene pantalla para COBRARLO después (marcar-pagado vive en Pedidos, sidebar `operacion`; Fiados es solo lectura). El endpoint ya acepta `pos`. **Es separación de funciones aceptable** (cobra operador/gerente); si se quiere que el cajero cobre: botón "abono" en Fiados o dar `pos` al link Pedidos. |
| Operador | ✅ | Ninguno. Cola/chat/confirmar/historial/devoluciones accesibles. |
| Mesero (=cajero/operador en restaurante) | ✅ | Opera completo. Opcionales: dividir cuenta, ticket de cocina impreso. |
| Almacén | ✅/🟡 | Todo salvo **recepción parcial de OC** (recibe completa y de golpe). |
| Compras | ✅/🟡 | (1) aprobar solicitud NO genera la OC (recaptura manual); (2) recepción parcial. CFDI ingest muy completo. |
| Contabilidad | ✅/🟡 | **Sin conciliación bancaria** (❌, nadie la cubre). Timbrado ya conectado (esta sesión) pero **falta descarga de XML/PDF** del CFDI. |
| RH | ✅/🟡 | Nómina completa + timbrado de recibo conectado; **falta descargar el XML/PDF** del recibo timbrado. |
| Gerente / Prime / Auditor | ✅ | Sin huecos. Auditor lectura-total bien resuelto (gate global mata todo método ≠ GET). |

## RAMOS — veredicto
| Ramo | Estado | Hueco crítico |
|---|---|---|
| Juguetería/retail | ✅ | Ninguno bloqueante. |
| Abarrotes | 🟡 | Bot: tope de 2 unidades/mismo producto (`_shared.js MAX_MISMO_PROD`) impide "mándame 6 cocas". POS bien. |
| Carnicería | 🟡 | Granel ya opera (price = precio/kg + cantidad decimal en POS); falta báscula (captura manual, operable). Bot: mismo tope de unidades. |
| Ferretería | 🟡 | Variantes = medidas OK, fiado OK (ya en preset). Bot: mismo tope. Etiqueta "talla/color" cosmética. |
| Barbería/Estética/Uñas | 🟡 | **La cita no lleva el servicio ni el precio** (`citasFlow` nunca setea `cita_servicio`) → el cajero recaptura; sin puente cita→ticket. Sin recurso/staff (quién atiende) ni duración por servicio. |
| Tatuajes | 🟡 | POS ya en preset (fix aplicado). Falta **anticipo/depósito atado a la cita** (hoy el apartado es solo para preventa de producto). |
| Servicios / Mantenimiento | 🟡 | Solo agenda; **sin orden de trabajo** (equipo/falla/refacciones/horas). |
| ISP | ❌ | **Sin planes recurrentes** (factura mensualidad — el sistema es 100% venta de contado). Comisiones de vendedor sí existen. Cobertura por CP funciona (`zonas_cobertura`, fail-open si falta). |
| Restaurante | 🟡 | Salón completo (mesa→comanda→cobro→multitienda). Falta: **propina** (🔴), **división de cuenta** (🔴), estatus de cocina/KDS, **recetas/insumos** (🔴 el costeo del platillo es ficticio sin descontar ingredientes). |

## RECOMENDACIONES priorizadas (no aplicadas — requieren tu OK)
### Baratas / alto impacto
1. **Puente cita→cobro con servicio elegido** — desbloquea barbería/estética/uñas de golpe: paso en `citasFlow` que lea `productos WHERE tipo='servicio'` y pase el servicio+precio al POS.
2. **Cantidad por bot** — parametrizar `MAX_MISMO_PROD` por giro + capturar cantidad/decimal (abarrotes/carnicería/ferretería).
3. **Descarga XML/PDF del CFDI** — Facturapi ya devuelve PDF/XML; agregar `GET /api/erp/cfdi/:id` que lo baje y adjuntar al correo. Cierra el ciclo fiscal (facturas y nómina).
4. **Propina en restaurante** — columna `propina` + input en cobrar-mesa.

### Medianas
5. **Solicitud→OC automática** al aprobar (compras).
6. **Recepción parcial de OC** (`cantidad_recibida` + estado `parcial`).
7. **División de cuenta** en mesas.
8. **Anticipo en citas** (tatuajes) reusando la mecánica de apartado.

### Grandes (proyecto aparte, por segmento)
9. **Conciliación bancaria** (contabilidad) — ver PLAN_INTEGRACION_BRECHA Ola 3.
10. **Planes recurrentes** (ISP) — facturación mensual recurrente.
11. **Recetas/insumos** (restaurante) — descuento de ingredientes y costeo real del platillo.
12. **Órdenes de trabajo** (servicios/mantenimiento).

## Nota de honestidad
Nadie inventó carencias: se verificó en código. El POS y los roles cubren bien el
día a día; el eslabón débil es (a) el **canal bot** atado a lógica de juguetería
(tope de unidades, cita sin servicio) y (b) **módulos ausentes por segmento**
(recurrente ISP, recetas restaurante, órdenes de trabajo) que hoy se cubren como
"solo agenda / solo contado".
