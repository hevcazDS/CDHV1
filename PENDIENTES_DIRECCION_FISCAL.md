# Pendientes — Dirección y Fiscal/RH

Backlog priorizado surgido de los comités multidisciplinarios (re-reviews v1.08).
No son bugs: son features de valor para dirección y de cumplimiento fiscal/laboral.
Los datos base ya se capturan salvo donde se indique "requiere schema".

---

## A. Dirección (reportes para decidir) — agente Harvard/LSE

| # | Pendiente | Qué responde | Datos / esfuerzo |
|---|-----------|--------------|------------------|
| A1 | **Punto de equilibrio** | ¿Cuánto debo vender al mes para no perder? | Clasificar gastos fijos vs variables (601). `Q = gastos_fijos / margen_contribución`. ~1 día |
| A2 | **Flujo de caja proyectado (30/60/90d)** | ¿Tendré dinero para renta/nómina aunque el P&L dé positivo? | Entradas: `links_pago` por cobrar + fiado `fiado_vence_en`. Salidas: `cuentas_pagar.vence_en` + nómina. ~2 días |
| A3 | **Rentabilidad por cliente** | ¿Quién es rentable y quién es "tóxico" (mucho volumen, bajo margen o moroso)? | JOIN `pedidos`+`links_pago`+margen − devoluciones. Identifica el 20% que da el 80%. ~1 día |
| A4 | **Rentabilidad por vendedor** (más allá de comisión) | ¿Vende con margen sano o deja devoluciones/fiado incobrable? | `cobrado_por` × margen − devoluciones − fiado no cobrado. ~1 día |
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
| B5 | **Tipo de baja** (renuncia / despido justificado / injustificado / cese / jubilación) | Indemnización mal pagada (de más o de menos). Hoy solo hay flag `despido_injustificado`. | Bajo (campo `tipo_baja` + fecha_baja en empleados) |
| B6 | **Config de régimen fiscal** (RESICO / general / PF) + congruencia | El sistema calcula sin saber el régimen; asientos podrían no ser congruentes ante el SAT. | Bajo (config `regimen_fiscal` en Prime > General) |
| B7 | **Contrato/términos del crédito (fiado)** | Sin documento con plazo/términos, la deuda es difícil de cobrar judicialmente. | Bajo (constancia con `fiado_vence_en` + términos) |

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

_Generado del 2º comité multidisciplinario sobre v1.08. Prioridad sugerida:
B5/B6/B7 (baratos, reducen riesgo legal) → A1/A3 (decisiones de dirección) →
B2/B3 (nómina fiscal) → A2 (flujo de caja) → B1 (CFDI/PAC, el más grande)._
