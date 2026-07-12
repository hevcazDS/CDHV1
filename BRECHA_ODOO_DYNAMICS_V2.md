# Brecha vs Odoo / Dynamics 365 BC — V2 (re-evaluación)

Consultor ERP · 2026-07-12 · Verificado contra el CÓDIGO ACTUAL (Read/Grep), no contra docs.
Segmento: PYME mexicana retail / servicios / restaurante, 1-5 sucursales, que vive de WhatsApp.
Continúa `BRECHA_ODOO_DYNAMICS.md` + `PLAN_INTEGRACION_BRECHA.md`. **Cero cambios de código.**

**TL;DR honesto:** casi toda la brecha *aplicable al segmento* ya se cerró. Las 5 brechas
"duras" que la V1 marcó como no-go (timbrado CFDI, complemento de pago, DIOT, contabilidad
electrónica SAT, conciliación bancaria) están **HECHAS**. Lo que queda es afinamiento fiscal
(mapeo agrupador SAT), robustez (webhooks, más PACs/gateways) y recombinaciones de bajo
esfuerzo — no módulos nuevos. Ya no hay ningún faltante que saque al producto de una venta
PYME MX. Lo que resta descartar (MRP, multi-moneda, consolidado) sigue fuera del segmento.

---

## 1. Tabla de brecha: ítem | estado | evidencia

| # | Ítem de brecha (V1) | Estado | Evidencia archivo:línea |
|---|---|---|---|
| 1 | **Timbrado CFDI 4.0 con PAC** (era la brecha #1, no-go binario) | ✅ HECHO | `services/pacProviders.js:52` `facturapi.timbrarFactura` POST `/v2/invoices` real; `services/pacService.js:110-135` `timbrar()` doble-gate + guarda UUID; envío al cliente `pacService.js:127,248` |
| 2 | **Complemento de pago (REP / PPD)** | ✅ HECHO | `pacProviders.js:87` `timbrarPago` (`type:'payment'`); `pacService.js:195-215` `timbrarREP`; disparo vía ruta `erpContabilidad.js:404` |
| 3 | **Cancelación de CFDI** | ✅ HECHO | `pacProviders.js:69-84` `cancelar`/`_delete` con motivo SAT; `pacService.js:226` `cancelarCFDI` |
| 4 | **Envío del CFDI (PDF/XML) al cliente** | ✅ HECHO | `pacProviders.js:94-104` `descargar` pdf/xml; `pacService.js:248` `enviarComprobante` (WhatsApp/correo) |
| 5 | **DIOT** (informativa de terceros) | ✅ HECHO | `erpContabilidad.js:301` `diot()` agrupa IVA por RFC proveedor, exporta TXT SAT (`:327`); ruta `:689` |
| 6 | **Contabilidad electrónica SAT (catálogo + balanza XML)** | ✅ HECHO (borrador) | `erpContabilidad.js:354` `contabilidadElectronica`; catálogo `:364`, balanza `:373`; namespaces SAT 1.3 `:371,386`; mapeo agrupador `:338-351` |
| 7 | **Conciliación bancaria** (import + match) | ✅ HECHO | migración `0060_conciliacion_banco.sql`; `erpContabilidad.js:601` importar, `:629` listar, `:649` conciliar manual; UI `ConciliacionTab.jsx` |
| 8 | **Pasarela de pago real** (era stub `_gateway`) | ✅ HECHO | `services/gatewayService.js` (key-only + modo demo); `gatewayProviders.js:34` Stripe Checkout, `:57` Mercado Pago Preference reales |
| 9 | **Nómina fiscal (recibo CFDI timbrado)** | ✅ HECHO | migración `0053_nomina_cfdi.sql`; `pacProviders.js:60` `timbrarNomina`; `pacService.js:137` `timbrarNomina`, `:260` `descargarNominaCFDI` |
| 10 | **OC: recepción PARCIAL** (era total de golpe) | ✅ HECHO | migración `0056_oc_recepcion_parcial.sql`; `erpProveedores.js:112-163` recibe por líneas, `cantidad_recibida`, estatus `parcial`/`recibida` |
| 11 | **Fiado / CxC con abono + límite de crédito** | ✅ HECHO | `pos.js:148,192-206` venta a crédito con `limite_credito` y control de saldo; `pos.js:326` cartera `fiadosGet`; abonos "viejo→nuevo" `pos.js:350` |
| 12 | **POS + corte de caja** (BC no trae POS) | ✅ HECHO | `pos.js`, `cortes_caja`, mesas restaurante `mesas.js` (ya en V1, confirmado) |
| 13 | **Kardex inmutable + costeo promedio + COGS** | ✅ HECHO | `contabilidadService.js:119` `asientoCostoVenta` (ya en V1, confirmado) |
| 14 | **Valuación de inventario a fecha (reporte)** | ✅ HECHO | `erpContabilidad.js:155` `SUM(stock*costo)` por sucursal en el tablero de dirección |
| 15 | **CFDI proveedor → alta sin captura** | ✅ HECHO | `cfdiService.js` (XXE-hardened); `compras.js` (ya en V1, confirmado) |
| 16 | **3-way match formal (OC↔recepción↔factura)** | 🟡 PARCIAL | recepción parcial existe (`erpProveedores.js:112`) pero no hay conciliación de 3 vías con la factura del proveedor; hoy es OC↔recepción |
| 17 | **Mapeo código agrupador SAT completo** | 🟡 PARCIAL | `erpContabilidad.js:338` `_COD_AGRUPADOR` tabla base + `:344` fallback genérico por naturaleza; el XML sale con nota "valida con tu contador" (`:396`). Funciona, pero cuentas sin mapeo usan código genérico |
| 18 | **Webhook de pago auto-conciliado** | ❌ FALTA | `gatewayService.js` genera el link; el pago sigue confirmándose a mano en `marcar-pagado`. No hay endpoint webhook que marque pagado automático (grep: cero) |
| 19 | **Más PACs / gateways** | 🟡 PARCIAL | Facturapi completo; Facturama con gancho pero mapeo pendiente (`pacProviders.js:110-121`). Gateways: solo Stripe + MP (`gatewayProviders.js:71`) |
| 20 | **Multi-moneda** | ❌ FALTA (por diseño) | grep negativo `tipo_cambio`/`multi.moneda` en flujos; MXN fijo. **Correcto para el segmento** |
| 21 | **Lotes / series / caducidad, FIFO real** | ❌ FALTA (por diseño) | grep negativo (`lote`/`serie`/`caducidad` solo aparecen como "batch query" o folios, no trazabilidad). Costeo promedio es correcto para retail MX |
| 22 | **Consolidado multi-tienda (P&L)** | ❌ FALTA (por diseño) | modelo instancia-por-tienda; sin herramienta central. Ver descarte §3 |
| 23 | **MRP / manufactura / proyectos** | ❌ FALTA (por diseño) | fuera del segmento, decisión registrada (AUDITORIA_Y_PLAN.md) |

**Resultado:** de las 6 brechas críticas "para vender en México" de la V1, **las 6 están cerradas**
(timbrado, complemento de pago, DIOT, contabilidad electrónica, conciliación bancaria; la
multi-moneda era el #6 y sigue fuera por diseño). El posicionamiento V1 "sin CFDI está fuera de
la conversación" **ya no aplica**.

---

## 2. Lo que REALISTA queda (ordenado por ROI)

Todo es afinamiento/robustez sobre lo ya construido. Nada es un módulo nuevo.

| ROI | Ítem | Qué falta exactamente | Esfuerzo |
|---|---|---|---|
| 🥇 Alto | **Completar el mapeo agrupador SAT** (#17) | Ampliar `_COD_AGRUPADOR` (`erpContabilidad.js:338`) para cubrir el catálogo estándar de cuentas del negocio, para que la balanza salga sin "genérico por naturaleza". Es data, no lógica. Lo pide el contador el 1er cierre. | **Bajo** (1-2 días, tabla de mapeo) |
| 🥈 Alto | **Webhook de pago → marcar-pagado auto** (#18) | Endpoint que reciba el webhook de Stripe/MP, verifique la firma y llame al chokepoint `marcar-pagado`. Quita el paso manual y cierra el ciclo cobro→pagado→(REP). El resto ya converge ahí. | **Medio** (2-3 días/gateway) |
| 🥉 Medio | **3-way match OC↔recepción↔factura** (#16) | Ligar el CFDI del proveedor (ya parseado por `cfdiService.js`) contra la OC recibida y marcar discrepancias. Datos ya existen. Deseable con volumen de compras, no bloqueante. | **Medio** (3-4 días) |
| Medio | **Segundo gateway/PAC por demanda** (#19) | Completar el mapeo Facturama (`pacProviders.js:110`) o un 3er gateway (Conekta/Clip) solo cuando un cliente lo contrate. La firma ya está estandarizada. | **Bajo-medio** (por proveedor, bajo demanda) |
| Bajo | **Ficha 360 de cliente / pipeline CRM** | Recombinar pedidos+citas+puntos+conversación en una vista (los datos ya existen). Etapas lead→cliente sobre `conversaciones`. Es una vista, no un módulo. | **Medio** (por demanda) |
| Bajo | **Cobranza recurrente (ISP/suscripciones)** | `cuentas_por_cobrar` + `cola_notificaciones` ya existen; falta la regla de recurrencia. Abre el vertical suscripciones. | **Medio** (por demanda) |

**Recomendación de orden:** (1) mapeo agrupador SAT y (2) webhook de pago son los dos que
"terminan de pulir" lo fiscal y el cobro sin construir nada — hazlos primero. El resto es por
demanda de cliente, no especulativo.

---

## 3. Lo que se DESCARTA explícitamente (fuera del segmento PYME MX)

No perseguir. Odoo/BC los traen pero la PYME MX de retail/servicios/restaurante no los usa, y
cada uno rompería la filosofía boring-tech/instancia-por-cliente sin retorno de venta:

- **Multi-moneda** (#20) — solo importa si el cliente factura/compra en USD. `configuracion.moneda`
  existe; NO aplicarla hasta tener un cliente real fuera de MXN. Invertir antes = especulación.
- **Lotes / series / caducidad / FIFO real / valuación estándar** (#21) — el costeo promedio + kardex
  inmutable es correcto y auditable para retail/abarrotes/ferretería MX. Lotes/caducidad solo los
  pide farmacia/alimentos regulados, que no es el foco. FIFO real es sobre-ingeniería aquí.
- **Consolidación contable multi-empresa / P&L consolidado multi-tienda** (#22) — el modelo
  instancia-por-tienda lo impide sin una herramienta central. Si el pitch promete "3 tiendas
  consolidadas", venderlo explícitamente como **negocios separados** o construir un panel de flota
  del proveedor (Hevcaz) — NO un tenant_id compartido. No cambiar la arquitectura por esto.
- **MRP / manufactura / BOM / work centers** (#23) — ningún giro objetivo lo pide. Cliente que
  necesita MRP no es el cliente de este producto.
- **Proyectos / timesheets / facturación por proyecto** — nicho de servicios profesionales
  facturables por proyecto, distinto del retail/servicios de mostrador que es el foco.
- **Reportería configurable por el usuario / Power BI / cubos pivote** — los reportes fijos en código
  (tablero de dirección, DIOT, balanza) cubren "¿cuánto vendí y cuánto gané?". Un motor de reportes
  ad-hoc es plataforma-BI, otra liga de producto.

---

## 4. Posicionamiento actualizado (honesto)

La frase de venta de la V1 era *"Square/Loyverse + bot WhatsApp + contabilidad ligera + pre-nómina,
pero sin CFDI está fuera si facturan"*. **Esa condición ya no existe.**

Hoy es: **"POS + bot WhatsApp + CFDI 4.0 timbrado real (key-only) + contabilidad electrónica SAT +
DIOT + conciliación bancaria + pre-nómina timbrable, todo auditable, instancia-por-cliente."**

- **Gana** en: canal WhatsApp nativo (ningún competidor lo trae), costo/implementación en días,
  auditabilidad (SQL a la vista, libros inmutables), POS+restaurante+servicios white-label, y ahora
  **el paquete fiscal MX completo** que hacía que el contador corriera CONTPAQi en paralelo.
- **Ya NO pierde** contra Odoo MX en el negocio que factura (el no-go de la V1 está cerrado).
- **Sigue perdiendo** solo donde es correcto perder: cliente que quiere consolidado multi-empresa,
  MRP, o factura en USD — todos fuera del segmento.

**Veredicto:** ya está casi todo lo aplicable. Lo honesto es decirlo: quedan dos pulidos de bajo
esfuerzo (mapeo agrupador SAT + webhook de pago) y recombinaciones por demanda. No hay una brecha
que justifique construir un módulo nuevo para el segmento PYME MX objetivo.
