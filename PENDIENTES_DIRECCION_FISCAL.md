# Pendientes — Dirección y Fiscal/RH

Backlog priorizado surgido de los comités multidisciplinarios (re-reviews v1.08).
No son bugs: son features de valor para dirección y de cumplimiento fiscal/laboral.
Los datos base ya se capturan salvo donde se indique "requiere schema".

---

## A. Dirección (reportes para decidir) — agente Harvard/LSE

| # | Pendiente | Qué responde | Datos / esfuerzo |
|---|-----------|--------------|------------------|
| A1 | ✅ **HECHO** — Punto de equilibrio | ¿Cuánto debo vender para no perder? | En el tablero (commit e29455c): ventas de equilibrio + holgura. |
| A2 | ✅ **HECHO** — Flujo de caja proyectado | ¿Tendré dinero aunque el P&L dé positivo? | Pestaña ERP "Flujo de caja" + `/api/erp/flujo-caja` (por cobrar fiado − por pagar, proyección 30/60/90d). commit e4041f0 |
| A3 | ✅ **HECHO** — Rentabilidad por cliente | ¿Quién es rentable y quién "tóxico"? | Pestaña ERP + `/api/erp/rentabilidad-clientes` (margen + adeudo de fiado). commit e29455c |
| A4 | ✅ **HECHO** — Rentabilidad por vendedor | ¿Vende con margen sano o deja fiado incobrable? | Pestaña ERP + `/api/erp/rentabilidad-vendedores` (margen, comisión, fiado sin cobrar). commit d158cbf |
| A5 | **Ciclo de conversión de efectivo + ratios de liquidez** | ¿Cuántos días entre pagar al proveedor y cobrar al cliente? | Días inventario + días CxC − días CxP. Razón corriente/ácida. ~1 día |

Notas:
- El **aging de CxC** del tablero ya existe; A3 es "aging + margen por cliente".
- La **cartera de fiado/morosidad** ya está (página Fiados, `/api/pos/fiados`).

---

## B. Fiscal / Nómina (cumplimiento SAT/IMSS/LFT) — agentes Legal y RH

| # | Pendiente | Riesgo si falta | Esfuerzo |
|---|-----------|-----------------|----------|
| B1 | **CFDI timbrado vía PAC** (nómina y facturación) | Gasto no deducible; multa por no timbrar. Hoy solo hay "comprobante con datos fiscales + folio", NO CFDI. | Alto (integrar PAC: Interfactura/Facturama/etc.) |
| B2 | **IMSS patronal** (~17–20% aparte de la cuota obrera 2.775%) | Pasivo patronal no reflejado; recargos retroactivos. | Medio |
| B3 | **Prima dominical (25%) y séptimo día** | Demanda laboral; auditoría IMSS. Hoy `nominaService` no los calcula. | Medio (requiere marcar días domingo/descanso) |
| B4 | **Incapacidades IMSS** | Antigüedad/finiquito mal calculados; subsidio no reflejado. | Medio (requiere schema: tabla incapacidades) |
| B5 | ✅ **HECHO** — Tipo de baja | Indemniza según causa (LFT). | Select renuncia/despido just./injust./jubilación + `tipo_baja`/`fecha_baja` (0041). commit 2f529f0 |
| B6 | ✅ **HECHO** — Config de régimen fiscal | Documenta el régimen y la congruencia del IVA base flujo de efectivo. | `/api/regimen-fiscal` + tarjeta Prime > General. commit d158cbf |
| B7 | **Contrato/términos del crédito (fiado)** — PARCIAL | Sin documento con plazo/términos, la deuda es difícil de cobrar judicialmente. | Ya hay `fiado_vence_en` (0039); falta la constancia imprimible con términos. |

Notas:
- Los **cálculos LFT que SÍ existen** (aguinaldo 15d, finiquito 90+20/año, vacaciones,
  prima vacacional) están **verificados correctos** por el comité; el disclaimer
  "aproximado, valida con tu contador" ya está en la UI.
- El **híbrido caja+devengado** del IVA (cuenta 208 "IVA trasladado no cobrado")
  es **correcto** para RESICO/personas físicas (IVA base flujo de efectivo, LIVA
  1-B). Documentar el régimen (B6) lo blinda ante auditoría.

---

## C. Marketing/CRO (reportes sobre datos ya capturados) — parcialmente hecho

Ya implementado: atribución por canal, embudos operativos (`/api/metricas/operacion`:
citas/mesas/link/recompra/crédito), cartera de fiado. Pendientes menores:
- Segmentación cliente → conversión/LTV (perfil edad/género/presupuesto ya capturado).
- Canal × tono del bot (mejor combinación de adquisición).
- Recuperación de carrito por motivo (precio/envío).

---

**Estado (actualizado):** HECHOS A1, A2, A3, A4, B5, B6. PENDIENTES:
A5 (ciclo de conversión de efectivo + ratios), B1 (CFDI/PAC — el más grande),
B2 (IMSS patronal), B3 (prima dominical/séptimo día), B4 (incapacidades),
B7 (constancia imprimible del crédito; ya existe `fiado_vence_en`).

_Generado del 2º comité multidisciplinario sobre v1.08._
