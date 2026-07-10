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
| A5 | ✅ **HECHO** — Ciclo de conversión + ratios | ¿Cuántos días entre pagar y cobrar? ¿Liquidez? | Tarjeta "Salud financiera" (Flujo de caja) + `/api/erp/salud-financiera` (CCC, razón corriente, prueba ácida). commit 28c8d1e |

Notas:
- El **aging de CxC** del tablero ya existe; A3 es "aging + margen por cliente".
- La **cartera de fiado/morosidad** ya está (página Fiados, `/api/pos/fiados`).

---

## B. Fiscal / Nómina (cumplimiento SAT/IMSS/LFT) — agentes Legal y RH

| # | Pendiente | Riesgo si falta | Esfuerzo |
|---|-----------|-----------------|----------|
| B1 | ⚠️ **ANDAMIADO** — CFDI timbrado vía PAC | Gasto no deducible; multa por no timbrar. | Credenciales configurables desde Prime > General (`/api/prime/pac`), `services/pacService.js` (hook inerte), `POST /api/erp/timbrar/:id` (wiring), `pedidos.cfdi_uuid` (0043). commit 9c0cf20. **Falta:** conectar el API del proveedor (Facturama/Finkok/…) en `pacService.timbrar()`. |
| B2 | ✅ **HECHO** — IMSS patronal | Refleja el costo patronal. | ~17.5% (config `imss_patronal_pct`), columna en nómina. commit 26d3f37 |
| B3 | ✅ **HECHO** — Prima dominical + séptimo día | Demanda laboral; auditoría IMSS. | Prima dominical 25% (26d3f37) + séptimo día por semana Lun-Dom de 6+ días (055d23b). |
| B4 | ✅ **HECHO** — Incapacidades IMSS | Días no pagados como salario normal (subsidio IMSS). | Tabla + endpoints + UI en RRHH; la nómina fiscal excluye esos días. commit 055d23b |
| B5 | ✅ **HECHO** — Tipo de baja | Indemniza según causa (LFT). | Select renuncia/despido just./injust./jubilación + `tipo_baja`/`fecha_baja` (0041). commit 2f529f0 |
| B6 | ✅ **HECHO** — Config de régimen fiscal | Documenta el régimen y la congruencia del IVA base flujo de efectivo. | `/api/regimen-fiscal` + tarjeta Prime > General. commit d158cbf |
| B7 | ✅ **HECHO** — Constancia de crédito | Documento de reconocimiento de adeudo. | Botón "Constancia" imprimible por cliente en la página Fiados. commit 9c0cf20 |

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

**Estado (actualizado):** HECHOS A1–A5 (dirección completa) y B2–B7 (fiscal/RH).
El **único pendiente real** es conectar el API del proveedor PAC en
`pacService.timbrar()` (B1) — el resto del timbrado ya está andamiado
(credenciales cifrables desde Prime, wiring, columnas CFDI). Requiere
credenciales/contrato con el PAC, es trabajo de integración externa.

_Generado del 2º comité multidisciplinario sobre v1.08._
