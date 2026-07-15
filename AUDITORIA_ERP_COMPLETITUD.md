# Auditoría de completitud y fragilidad del ERP (2026-07-13)

> Auditado por evidencia (rutas reales, schema, runtime), no por sensación.
> **Veredicto:** el núcleo transaccional-contable NO está endeble — está completo
> para pyme MX. Lo incompleto son las **herramientas específicas de giro**: el
> onboarding ofrece 13 giros pero 4 no pueden operar su negocio real. El modelo
> de venta asume "pieza entera de catálogo" (juguetería) y eso deja cojos a los
> giros de mostrador.

## Lo que SÍ está sólido (verificado)

| Pilar | Evidencia |
|---|---|
| Contabilidad | Asientos, libro mayor, P&L/balance/aging de cartera, punto de equilibrio, DIOT, conciliación bancaria, cierre de período, flujo de caja, CFDI (andamiaje+baúl), rastro de auditoría — 28 endpoints en `erpContabilidad.js` |
| Almacén | Kardex, conteos cíclicos, traslados/salidas con PIN, ubicaciones (`almacen.js`) |
| Compras | Solicitudes con aprobación gerente, factura XML/manual, entrada mercancía, CxP con IVA (`compras.js`) |
| RRHH | Nómina, aguinaldo, finiquito, incapacidades, horarios — pagos con PIN (`rrhh.js`) |
| POS | Código de barras/SKU/variantes (`pos.js:110-119`), corte de caja, fiado con vencimiento |
| Seguridad | Roles jerárquicos + áreas + PIN + bitácora; golden byte-idéntico protege al bot |

## 🔴 Brechas por giro

### B1. No existe venta por peso/granel/decimales — CRÍTICA TRANSVERSAL
- `cantidad` es `INTEGER` en todo el esquema (pedido_detalle:430, mesa_items:647,
  inventarios); no hay `unidad_medida` ni granel (grep: CERO resultados de
  granel/por_peso/unidad_medida en pos.js/_shared.js/schema.sql).
- Consecuencia: una carnicería NO PUEDE vender 1.5 kg (su negocio entero),
  abarrotes no vende granel, ferretería no vende por metro. El onboarding OFRECE
  esos giros → promesa incumplida.

### B2. Barbería/estética: citas sin empleado
- `citas` no tiene `id_empleado` (verificado schema + citas.js) — agenda por
  capacidad global (`citas_capacidad`), no por barbero. Dos barberos = imposible.
- Comisiones = % único global (`configuracion.comision_pct`, primeConfig.js:96)
  sobre ventas, no por servicio/empleado.

### B3. Restaurante: inventario de ficción
- Sin recetas/insumos (BOM: cero hits en schema/rutas) — vender un platillo
  descuenta "el platillo", no ingredientes.
- Sin vista de cocina (KDS): `mesa_items.enviado_cocina` se marca pero no hay
  pantalla que lo consuma. Modificadores = comentario libre.

### B4. Abarrotes/carnicería: sin caducidades ni mermas
- Sin lotes/caducidad de producto (solo `lote` bancario, schema:594).
- Sin módulo de merma tipificada (salida de almacén con PIN puede fingirlo pero
  sin motivo tipificado ni reporte de costo de merma).

### B5. Ferretería: sin conversión de unidades
- Compras caja de 100 ↔ vendes pieza: no existe. Variantes solo talla/color.

## 🟠 Endeblez real

1. **Backup solo respalda la BD ACTIVA** — `scripts/backup.js:22-33` sigue el
   puntero de instancia; las instancias NO activas (barberia.db/restaurante.db)
   quedan SIN respaldo nunca. Pérdida de datos esperando ocurrir. **URGENTE, chico.**
2. Motor/editor: C1–C3 documentados en `MOTOR_EDITOR_PENDIENTES.md`.
3. Errores de asientos tragados con log.debug (hallazgo previo pendiente).
4. CFDI sin PAC / pago real stub — conocidos y a propósito (fallan alto).
5. Suites que exigen BD real no corren en checkout limpio — documentado/aceptado.

## Plan de acción priorizado

| # | Qué | Desbloquea | Tamaño |
|---|---|---|---|
| P1 | Venta por peso/granel: migración cantidad→REAL + productos.unidad_medida (pza/kg/m/lt) + POS decimal + báscula manual | carnicería, abarrotes, ferretería | M |
| P2 | Citas por empleado (citas.id_empleado + agenda por persona) + comisión por servicio/empleado | barbería, estética, uñas, tatuajes | M |
| P3 | Recetas/insumos (BOM lean: platillo→ingredientes, descuento al cobrar) + vista cocina simple | restaurante | M-G |
| P4 | Mermas tipificadas (caducidad/daño/robo + reporte de costo) + caducidad/lote lean | abarrotes, carnicería, restaurante | S-M |
| P5 | **Backup multi-instancia** (loop instancias/*.db) | todas | **S — urgente** |
| P6 | Conversión de unidades compra↔venta | ferretería | S |

Orden sugerido: P5 (riesgo/esfuerzo) → P1 (más completitud de cara a giros
prometidos) → P2 → P4 → P6 → P3.

### Reglas al implementar (recordatorio)
- cantidad→REAL toca el chokepoint de dinero (marcar-pagado descuenta stock):
  migración con cuidado, tests de contrato, golden/paridad verdes.
- Toda migración: `migrations/NNNN_*.sql` + espejo `db/schema.sql` + `--all`.


---

# RONDA 2 (2026-07-14, post P1-P6): re-auditoría por giro

**Veredicto:** ningún giro tiene brecha ESENCIAL — P1-P6 cerraron el núcleo.
Lo que queda son fricciones de preset/UX. Estado: juguetería/restaurante/
servicios/mantenimiento ✅; carnicería/abarrotes/ferretería/retail/citas-giros ⚠️
(fricciones); freelancer era ❌ por presets → arreglado.

## Hecho en esta ronda (S, 1 línea c/u en MODULOS_POR_GIRO)
- ferretería + documentos_activo (cotizaciones desde el día 1).
- servicios + documentos_activo (contratos).
- freelancer: preset PROPIO (citas + documentos + suscripcion_activo → retainer).

## Backlog documentado (M — hacer cuando se venda a esos giros)
1. **Form de producto por giro** (`productoCampos.jsx`): carnicería/abarrotes/
   ferretería ven los campos de juguetería (edad/género/tipo_juguete,
   inaplicables). Preset de campos visibles por giro; para granel, unidad_medida
   protagonista. Fricción diaria, no bloquea venta.
2. **Órdenes de servicio/trabajo** (mantenimiento/servicios/ferretería-taller):
   tabla ordenes_servicio (id_cita?, id_cliente, descripcion, estatus, fechas,
   fotos_json) + CRUD + página. Sin esto no hay evidencia de trabajo hecho —
   riesgo moderado para mantenimiento.
3. **Anticipo de cita configurable por % desde el dashboard** (tatuajes/estética/
   uñas/barbería): la maquinaria sellada existe (motor cobrar_anticipo + columnas
   0065); falta la config visual (% por giro/instancia) y/o la plantilla
   barberia-anticipo del motor. Mitiga no-shows con seña.
4. **Variantes talla×color en el BOT** (retail/ropa): el POS ya las vende; el bot
   vende el producto padre sin elegir talla — menor, el flujo VARIANTE existe
   solo en POS-dashboard.
