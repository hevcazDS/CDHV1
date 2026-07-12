# Análisis de brecha: bothHS 1.2 vs Odoo (Community/Enterprise) y Microsoft Dynamics 365 Business Central

Consultor ERP · 2026-07-12 · Verificado contra código real (Read/Grep), no contra CLAUDE.md.
Segmento objetivo: PYME mexicana de retail / servicios / restaurante, 1-5 sucursales, que vive de WhatsApp.

Convención de cobertura: ✅ completo (para el segmento) · 🟡 parcial · ❌ ausente.
Toda afirmación de cobertura lleva evidencia `archivo:línea`.

---

## A. TABLA DE COBERTURA POR MÓDULO FUNCIONAL

### Ventas / CRM
| | Detalle |
|---|---|
| **Odoo** | CRM con pipeline/etapas, cotizaciones→SO→factura, portal cliente, e-commerce, email marketing, lead scoring. |
| **Dynamics BC** | Sales quotes→orders→invoices, cotización con vigencia, gestión de oportunidades (vía Sales módulo), dimensiones. |
| **Este producto** | 🟡 **CRM conversacional por WhatsApp** — que ninguno de los dos trae nativo. Pedido end-to-end en el bot (`bot/actionHandler.js`, flujos `bot/flows/*`), cola de atención + chat en vivo (`atencionCliente.js`), lealtad/puntos (`puntosService.js`), referidos (`referidosService.js`), marketing con atribución de campaña (`marketing.js`), reactivación de dormidos/carritos (`stockWatcher.js`). Bitácora tipo "chatter" por pedido (`/api/pedidos/:id/historial`). **Falta**: cotización formal con vigencia (lo más cercano es "venta previa" POS), pipeline/etapas de oportunidad, ficha 360 de cliente. |
| **Veredicto** | Empata o gana en el canal WhatsApp (diferenciador real). Pierde en CRM estructurado B2B (pipeline, cotizaciones con vigencia). Para PYME retail/servicios que vende por chat, es suficiente y superior en UX. |

### Compras
| | Detalle |
|---|---|
| **Odoo** | Solicitud→RFQ→PO→recepción (con recepción parcial y 3-way match)→factura proveedor→pago. Reglas de reabasto. |
| **Dynamics BC** | Purchase quote→order→receipt→invoice con matching, vendor ledger, planificación de requisiciones. |
| **Este producto** | 🟡 OC con detalle y sucursal destino (`erpProveedores.js:67`), recepción que entra a inventario + kardex (`:117-145`), CxP generada y pagable (`cxpGet :153`, `cxpPagar :164`), reordenar OC (`:85-94`), **ingesta de CFDI XML del proveedor** para alta sin captura (`cfdiService.js` + `compras.js`). **Falta**: recepción **parcial** (hoy la recepción es total, `:145` marca `estatus='recibida'` de golpe), 3-way match formal (OC↔recepción↔factura), estado "en tránsito". |
| **Veredicto** | Cubre el ciclo PYME completo (solicitud→OC→recepción→CFDI→CxP). Brecha vs Odoo/BC = recepción parcial y matching — deseable con volumen, no bloqueante para PYME. |

### Inventario
| | Detalle |
|---|---|
| **Odoo** | Multi-almacén, valuación FIFO/promedio/estándar automática, movimientos, lotes/series, trazabilidad, reabasto, ajustes. |
| **Dynamics BC** | Item ledger inmutable, costeo promedio/FIFO/LIFO/estándar, ubicaciones, bins, transfer orders. |
| **Este producto** | ✅ **Kardex universal inmutable por triggers** (multitienda, migración 0030), costeo **promedio** con COGS por venta (`contabilidadService.js:119 asientoCostoVenta`), stock por sucursal (`inventarios`/`inventario_variantes`), traslados entre bodegas con PIN, conteo físico por UPC, ubicaciones, variantes talla×color por sucursal. Descuento automático al pagar (`comunicacionPedidos.js:260`), reversa en devolución. |
| **Veredicto** | **Empata con Odoo/BC en lo que la PYME usa.** Ausente vs ellos: lotes/series/caducidad, FIFO real, valuación estándar, transfer orders con tránsito. Para retail/abarrotes/ferretería MX el modelo promedio+kardex inmutable es correcto y auditable. |

### Contabilidad
| | Detalle |
|---|---|
| **Odoo** | Partida doble, plan de cuentas, asientos automáticos, mayor, balanza, estados financieros, **conciliación bancaria**, multi-moneda, cierre, localización MX (contabilidad electrónica). |
| **Dynamics BC** | G/L completo, dimensiones (centros de costo), conciliación, cierre de período, reporting financiero, deferrals. |
| **Este producto** | 🟡 Partida doble real: plan de cuentas, asientos automáticos desde el chokepoint de pago/compra/gasto/devolución (`contabilidadService.js:34-200`), libro mayor (`:222`), **cierre de período** con inmutabilidad forzada (`mesCerradoDe :21`, override forense en `configuracion_log`), tablero de dirección con P&L / balance / aging CxC / rotación inventario (`erpContabilidad.js`), flujo de caja, salud financiera, dimensión sucursal en asientos (migración 0051). **Ausente**: **conciliación bancaria** (grep: cero hits reales, solo docs), multi-moneda, contabilidad electrónica SAT (XML de pólizas/catálogo), centros de costo genéricos (solo sucursal). |
| **Veredicto** | Núcleo contable sólido y **auditable** (SQL a la vista, libros inmutables) — más de lo que trae Zoho Books base. Pierde vs Odoo MX / CONTPAQi en **conciliación bancaria** y **contabilidad electrónica SAT**, que el contador del cliente exigirá. |

### Facturación fiscal (CFDI)
| | Detalle |
|---|---|
| **Odoo (MX)** | Timbra CFDI 4.0 con PAC integrado, complemento de pago, cancelación, addendas. |
| **Dynamics BC (MX)** | Localización con timbrado vía PAC, e-invoicing. |
| **Este producto** | ❌ **NO timbra.** Emite "comprobante con datos fiscales" (RFC/razón social + folio como referencia + leyenda "no es factura fiscal timbrada", `lib/factura.js`). **Lee** CFDI de proveedores (`cfdiService.js`, XXE/DoS-hardened `:21-23`). El **andamiaje de timbrado existe e inerte**: `pacService.js` con doble-gate (módulo `facturacion_activo` + credenciales PAC), `timbrar()` devuelve `{ok:false, pendiente:true}` (`:70-76`), columnas `cfdi_uuid`/`cfdi_estatus` previstas, credenciales cifradas at-rest (`:23-31`), reporte de "facturación pendiente" exportable a PAC externo. |
| **Veredicto** | **La brecha #1 para vender en México.** Sin timbrado real está fuera de la conversación en cualquier negocio que facture. Pero es *conectar el PAC, no construir* — ver sección C. |

### Nómina / RRHH
| | Detalle |
|---|---|
| **Odoo** | Nómina con localización MX (IMSS/ISR/subsidio, recibos CFDI de nómina timbrados), contratos, ausencias, reclutamiento. |
| **Dynamics BC** | No trae nómina nativa (se integra con terceros); sí RRHH básico. |
| **Este producto** | 🟡 **Nómina MX aproximada real**: ISR tarifa mensual SAT Art. 96 (`nominaService.js:22 TARIFA_ISR_MENSUAL`), IMSS obrero/patronal (`:28-29`), horas extra al doble, comisiones por empleado (`:143`), aguinaldo/vacaciones/prima vacacional/finiquito LFT (`:54-90`), séptimo día, incapacidades IMSS (`:124`). Genera asiento al pagar. Expediente con antigüedad/CURP/departamento (módulo `nomina_fiscal_activo`). **Ausente**: recibo CFDI de nómina timbrado, subsidio al empleo exacto, cálculo anual/finiquito con validación fiscal certificada (disclaimer "aproximado, valida con contador" persiste). |
| **Veredicto** | Sorprendentemente completa como **borrador de nómina** — más que BC nativo. No sustituye a un despacho ni timbra recibos. Vendible como "pre-nómina", no como nómina fiscal certificada. |

### Manufactura
| | Detalle |
|---|---|
| **Odoo** | MRP completo: BOM, órdenes de producción, work centers, planificación, subcontratación. |
| **Dynamics BC** | Manufacturing: BOM, routings, capacity, MRP. |
| **Este producto** | ❌ Ausente por diseño. Ningún giro objetivo (retail/servicios/restaurante) lo pide. Decisión registrada ("NO CPQ/MRP/manufactura", AUDITORIA_Y_PLAN.md). |
| **Veredicto** | No es brecha: fuera del segmento. Un cliente que necesite MRP no es el cliente de este producto. |

### Proyectos
| | Detalle |
|---|---|
| **Odoo** | Project con tareas, timesheets, facturación por proyecto, gastos imputables. |
| **Dynamics BC** | Jobs: tareas, planning lines, WIP, facturación por proyecto. |
| **Este producto** | ❌ No hay módulo de proyectos. Existe un módulo **Tareas/recordatorios** (`tareas.js`, rama actual) pero es gestión operativa interna, no gestión/facturación de proyectos. |
| **Veredicto** | Ausente. No es brecha para retail/restaurante; sí lo sería para "servicios profesionales" facturables por proyecto (no es el foco). |

### Punto de venta
| | Detalle |
|---|---|
| **Odoo** | POS con multi-caja, sesiones/cierre, offline, hardware, restaurante (mesas), fidelización. |
| **Dynamics BC** | No trae POS nativo (LS Central es tercero). |
| **Este producto** | ✅ **POS multi-caja con corte** (`pos.js`, `cortes_caja`): corte por usuario/día, escáner, decimal/granel, PIN en cancelar/precio, reimprimir ticket, complemento sugerido (`/api/pos/sugeridos`), validación de sobreventa, puntos, sucursal de sesión (migración 0049). **Mesas de restaurante** (`mesas.js`): abrir mesa, comanda a cocina, cobrar reusando el POS. Venta genera asiento + descuenta kardex. |
| **Veredicto** | **Gana a BC (que no trae POS) y empata con Odoo/Square/Loyverse** en lo esencial PYME. Ausente: offline puro, propinas/split de cuenta avanzado, hardware certificado. |

### Reportería / BI
| | Detalle |
|---|---|
| **Odoo** | Vistas pivote/gráfica en cada modelo, dashboards configurables, Studio, informes QWeb. |
| **Dynamics BC** | Power BI embebido, account schedules, analysis views, dimensiones. |
| **Este producto** | 🟡 Tablero de dirección (P&L, balance, aging, rotación), ventas por producto, corte por método, KPIs de Inicio (`core.js /api/stats`), gráficas con recharts (sparklines, dona corte, aging, proyección caja). Rastro de documento navegable (`erpContabilidad.js:49 rastro`). **Ausente**: reportería **configurable** por el usuario (los reportes son fijos en código), export a Power BI, cubos/pivote ad-hoc, **consolidado multi-tienda** (el modelo instancia-por-tienda lo impide sin herramienta extra). |
| **Veredicto** | Buen tablero fijo para el dueño; no es una plataforma de BI. Odoo/BC ganan en flexibilidad de reporte. Para PYME que solo quiere "¿cuánto vendí y cuánto gané?", alcanza. |

### Multi-moneda / multi-país
| | Detalle |
|---|---|
| **Odoo** | Multi-moneda con revaluación, multi-compañía, localizaciones fiscales por país. |
| **Dynamics BC** | Multi-moneda nativo, multi-entity management, localizaciones. |
| **Este producto** | ❌ **MXN fijo** (config `moneda` existe pero no se aplica; "MXN" hardcodeado en ~50 textos de flujo, IVA se guarda pero no se aplica al precio — `_shared.js`; CP validado a 5 dígitos MX). Multi-sucursal sí (dentro de 1 BD); multi-compañía = instancias separadas sin consolidado. |
| **Veredicto** | Ausente y **correcto para el segmento** (PYME MX en MXN). No invertir hasta tener cliente fuera de MX. Sí es brecha dura si el pitch promete "3 tiendas consolidadas" (no hay P&L consolidado). |

---

## B. BRECHAS CRÍTICAS PARA VENDER EN MÉXICO (ordenadas por "cuánto duele en una venta real")

1. **🔴 Timbrado CFDI 4.0 con PAC — EL gran faltante.** En cuanto el prospecto factura (casi todos los B2B y buena parte del B2C formal), esto es un no-go binario. El andamiaje está listo (`services/pacService.js`, doble-gate, credenciales cifradas, columnas previstas) — falta la llamada al SDK del PAC (Facturama/Finkok/SW). **Duele en la primera reunión.** Sin esto compites solo con negocios informales o con quien acepta "comprobante + timbrado por fuera".

2. **🔴 Complemento de pago (CFDI de pagos, PPD).** Dependiente del #1 pero regulatoriamente obligatorio para ventas a crédito/PPD. Hoy inexistente (grep: cero). Si vendes a crédito y facturas PPD, el SAT lo exige. Duele en el segundo mes de un cliente que factura a crédito.

3. **🟠 Contabilidad electrónica SAT (catálogo de cuentas + balanza + pólizas en XML).** El contador del cliente la pide mensual. Hoy la contabilidad es sólida internamente pero **no exporta nada al formato SAT**. Sin esto, el contador sigue usando CONTPAQi/Aspel en paralelo → el ERP queda como "operativo", no "contable". Duele cuando el contador evalúa.

4. **🟠 Conciliación bancaria.** No existe (ni `movimientos_bancos` ni matching). Para el flujo de caja que ya se muestra (`FlujoCajaTab`) es el siguiente paso natural; import de CSV/estado de cuenta + match manual basta para PYME. Duele al cierre de cada mes cuando no cuadra caja contra banco.

5. **🟠 DIOT (Declaración Informativa de Operaciones con Terceros).** Mensual, la pide el SAT a quien deduce IVA de proveedores. Los datos **ya existen** (CxP + CFDI de proveedores parseados) — es un reporte, no captura nueva. Duele cada 17 del mes al contador.

6. **🟢 Multi-moneda.** Solo duele si el cliente importa/exporta o factura en USD. Fuera del segmento base; no invertir por especulación.

---

## C. FUNCIONES A MEDIAS QUE SE COMPLETAN CON POCO ESFUERZO

Todas verificadas: el andamiaje existe, fail-closed, doble-gate. Es "rellenar", no "construir".

| Función | Qué existe | Qué falta exactamente | Esfuerzo |
|---|---|---|---|
| **Timbrado CFDI 4.0** | `pacService.js`: doble-gate, `timbrar()` inerte (`:70`), credenciales cifradas at-rest (`:23-31`), UI de credenciales prevista, `estaConfigurado()` valida cer/key/rfc/usuario, columnas `cfdi_uuid`/`cfdi_estatus`. | En `timbrar()`: armar el XML CFDI 4.0 (emisor+CSD, receptor del pedido, conceptos desde `pedido_detalle`, IVA), llamar al SDK del PAC según `pac_proveedor`, guardar UUID y adjuntar PDF/XML al correo. | **Medio** (1-2 sem por PAC; el 80% es el mapeo de conceptos y el SDK). Requiere contrato PAC del cliente (~$1-2/timbre). |
| **Pasarela de pago real** | `pagoLinkService.js`: `_gateway()` stub (`:24-30`), fallback a link estático del negocio (`:42`), toggle `pago_link_activo`. El cobro real ya converge en `marcar-pagado`. | Implementar la llamada real a la API (Stripe/MP/Conekta/Clip) en `_gateway()` con `{monto,folio,referencia}`; opcional: webhook que marque `marcar-pagado` automático. | **Bajo-medio** (días por gateway). Requiere cuenta del cliente. |
| **Estafeta real** | `estafetaService.js`: guía simulada, `_callEstafetaAPI()` stub previsto (Phase 2). | Conectar API real de Estafeta; parametrizar remitente (hoy "Julio Cepeda"/CP 78000 hardcodeado, `:35-41`) y URL de rastreo (`:110`). | **Medio**. Requiere cuenta Estafeta. Bloqueante para white-label: el remitente hardcodeado debe ir a `configuracion` **ya** (Bajo). |
| **LLM conversacional** | `llmHandler.js`: hook único antes del fallback, doble-gate (`llm_activo` + API key), `handle()` passthrough (`:55`), dataset etiquetado por mensaje (migración 0019), export a correo. | `npm i @anthropic-ai/sdk`, implementar el loop tool-use (cada tool → helper de `_shared.js`: buscar/agregar/crear pedido/escalar). Modelo `claude-opus-4-8` + `claude-haiku-4-5` para intención. | **Medio**. El andamiaje y el dataset ya existen; es enchufar el SDK y definir ~4 tools. |
| **DIOT** | CxP + CFDI de proveedores parseados (RFC emisor, IVA, montos) ya en BD. | Un reporte que agrupe por RFC de proveedor + tipo de operación y exporte el TXT/formato DIOT. Sin captura nueva. | **Bajo** (es una query + formateo). |
| **Panel de flota multi-cliente** | Modelo instancia-por-cliente, `configuracion.schema_version` propuesto, `/api/bot/status`. | `status.json` por instancia + panel central del proveedor (Hevcaz) con versión/bot-online/último-backup/HS-errores. Documentado como "cuando haya 3+ clientes". | **Medio**. No urgente hasta 3+ clientes. |

---

## D. FUNCIONES ADAPTABLES / RECOMBINABLES (alto ROI, sin construir de cero)

1. **Valuación de inventario tipo Odoo — ya está.** El kardex inmutable + costeo promedio (`contabilidadService.js:119`) ya produce COGS por venta y rotación. Falta solo *exponerlo* como "reporte de valuación de inventario" (SUM stock × costo promedio por fecha) — una query sobre datos que ya existen. Odoo lo cobra como feature Enterprise.

2. **CRM conversacional que Dynamics cobra caro — ya está.** Bot WhatsApp + citas (`citas.js`) + cola de atención + chat en vivo + lealtad + referidos = un CRM de canal que BC no trae nativo. Recombinar en una "ficha 360 de cliente" (pedidos + citas + puntos + conversación) es agregar una vista, no un módulo.

3. **CxC + recordatorios = cobranza recurrente (mensualidades ISP/suscripciones).** `cuentas_por_cobrar` con vencimiento + `cola_notificaciones` ya existen. Combinados dan cobro recurrente para ISP/gimnasios/suscripciones sin construir un módulo de billing — ya documentado como sinergia con el vertical cambaceo ISP.

4. **Citas + producto-servicio = agenda facturable.** El módulo de citas abre barbería/estética/servicios; ligarlo a `productos.tipo='servicio'` (sin stock) da "orden de servicio" agendable y cobrable. Un solo módulo cubre 6 giros.

5. **Ingesta CFDI proveedor → DIOT + contabilidad electrónica.** `cfdiService.js` ya extrae RFC/IVA/conceptos. Esos mismos datos alimentan (a) DIOT y (b) la balanza en XML SAT. Un parser, tres entregables fiscales.

6. **Rastro de documento (`erpContabilidad.js:49`) = auditoría tipo SAP.** Folio → pedido/pagos/kardex/asientos/devoluciones ya navegable. Recombinarlo como "expediente exportable por pedido" (PDF) da un comprobante de auditoría que impresiona en due-diligence, gratis.

7. **Corte de caja + asientos = arqueo contable automático.** El corte (`cortes_caja`) y los asientos ya cuadran contra la venta. Exponer "corte vs mayor" es el 80% de una conciliación de caja — reusa ambos.

8. **Dataset etiquetado (migración 0019) = búsqueda semántica futura sin costo hundido.** Los mensajes con `paso_actual`/`intencion` ya se registran. El mismo dataset que alimenta el LLM alimenta una búsqueda semántica de catálogo — un embedding sobre datos que ya se capturan.

---

## E. POSICIONAMIENTO HONESTO

**¿Contra qué compite HOY?**
Compite contra **Odoo Community + localización MX** y **Zoho Books / Square / Loyverse**, en el segmento **PYME MX de 1-5 sucursales que opera por WhatsApp**. NO compite contra Dynamics BC (otra liga de precio/complejidad, empresas medianas-grandes) ni contra Odoo Enterprise MX / CONTPAQi / Aspel en negocios que **facturan en serio** — ahí, sin timbrado, está fuera.

**Dónde gana:**
- **Canal WhatsApp nativo**: bot de ventas + POS + lealtad + citas integrados. Ninguno de los competidores lo trae; es el diferenciador que justifica la venta.
- **Costo e implementación**: instancia-por-cliente, "en días vs meses". Un Odoo MX requiere partner/consultoría de semanas; este arranca con un wizard de onboarding.
- **Auditabilidad**: SQL a la vista, libros inmutables por triggers — más transparente que el ORM de Odoo para un contador desconfiado.
- **POS + restaurante + servicios en un solo producto white-label multi-giro.**

**Dónde pierde (sin pena solo si lo dices):**
- Cualquier negocio que **factura** → sin CFDI timbrado, no entra.
- Cliente con **3 tiendas que quiere consolidado** → el modelo instancia-por-tienda no da P&L consolidado.
- Negocio cuyo **contador** manda → sin contabilidad electrónica/DIOT, seguirá con su sistema en paralelo.

**Las 5 cosas a cerrar para ser "vendible sin pena" contra un Odoo en PYME MX:**
1. **Conectar el PAC** (CFDI 4.0 timbrado). Sin esto no hay conversación con quien factura. Andamiaje listo.
2. **Complemento de pago + reporte DIOT + balanza/pólizas SAT**. El paquete que hace que el contador acepte el sistema en vez de correrlo en paralelo. Los datos ya existen.
3. **Conciliación bancaria** (import CSV + match manual). Cierra el ciclo del flujo de caja que ya se muestra.
4. **Parametrizar lo hardcodeado de white-label** (remitente Estafeta, URL rastreo, horario, "MXN"/IVA en flujos) — barato y hoy delata que es "el sistema de Julio Cepeda".
5. **Consolidado multi-tienda o copy honesto en el switcher** — decidir si "3 tiendas" es un pitch soportado (requiere consolidación) o se vende explícitamente como negocios separados.

**Lo que NO hay que fingir:** este no es "un Odoo completo". Es **"Square/Loyverse + bot WhatsApp + contabilidad ligera auditable + pre-nómina MX"**. Esa frase vende mejor que fingir paridad — y con los puntos 1-2 cerrados, gana la PYME MX chica por canal y por costo de implementación, que es donde Odoo pierde siempre.
