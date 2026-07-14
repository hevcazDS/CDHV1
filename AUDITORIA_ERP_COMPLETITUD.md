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
