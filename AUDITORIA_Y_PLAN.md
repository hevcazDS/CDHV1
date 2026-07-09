# PLAN MAESTRO — checklist vivo (actualizado 2026-07-09)

Única fuente del rumbo. Al terminar algo: palomearlo aquí con fecha.
Lo de abajo (plan histórico) queda como referencia — NO seguirlo directo.

## ✅ Construido y verificado (no reabrir)

- [x] ERP: plan de cuentas, asientos automáticos, balanza, proveedores/OC/CxP, costeo promedio
- [x] Gastos del contador + reporte de impuestos (IVA trasladado vs acreditable) + lector CFDI XML
- [x] POS multi-caja: corte único por usuario/día, escáner, decimal (granel), PIN en cancelar/precio, reimprimir ticket
- [x] RBAC 10 roles + auditor solo-lectura (candado global GET) + PIN de autorización operativa
- [x] Kardex universal inmutable (triggers 0030) + conteo por UPC con plantilla + ubicaciones + traslados
- [x] RRHH/nómina MX (ISR/IMSS aprox) con PIN antifraude en pagar/salario
- [x] Citas con recordatorio 24h (barbería/tatuajes/estética/uñas/mantenimiento/servicios/ISP)
- [x] Variantes talla×color con stock POR SUCURSAL (bot pregunta talla; POS escanea variante)
- [x] ISP: zonas de cobertura por CP + comisiones por vendedor
- [x] Editor de frases del bot por instancia (Prime) + multimodal con respuesta por tipo
- [x] Sesiones firmadas con secreto de instancia (no migrables) + catálogo de errores HS-xxx (ERRORES.md)
- [x] Bot bajo demanda: QR modal auto-cierre, regla anti-zombie HS-502 (intento único), reinicio de bridge, purga de sesión WhatsApp (HS-503)
- [x] Inicios por rol + herramientas por rol (exports CSV, cancelar OC, reactivar empleado)
- [x] 2026-07-09 — Benchmarks ERP adoptados: cierre de período contable (SAP), dependencias entre módulos (Odoo), versión visible en panel, inmutabilidad de libros por triggers (SAP)

## 🔜 EN COLA (orden acordado)

- [ ] **Panel de flota Hevcaz** (idea NetSuite): status.json por instancia (versión, bot online, último backup, HS-errores) + panel central del proveedor — *cuando haya 3+ clientes*
- [x] 2026-07-09 — **Cadena de documento navegable** (SAP): ERP > Rastro de documento — folio → pedido/pagos/kardex/asientos/devoluciones (sin cambio de schema: el folio ya ligaba todo)
- [x] 2026-07-09 — **Filtros que se recuerdan** (NetSuite, versión lean): Pedidos gana filtro por estatus + búsqueda folio/cliente, persistidos por usuario (localStorage); filtros con nombre múltiple solo si un cliente lo pide
- [x] 2026-07-09 — **Bitácora por pedido** (Odoo chatter): botón Historial en Pedidos — línea de tiempo creación/pagos/kardex/repartidor/devoluciones/cancelación (GET /api/pedidos/:id/historial, área operación)
- [x] 2026-07-09 — Comprobante de transferencia por FOTO (S.PAGO_COMPROBANTE): el bot pide la foto al elegir transferencia, la liga al folio y escala a Cola de atención para validar
- [x] 2026-07-09 — Circuito completo de devolución con decisión del ASESOR: la foto se REENVÍA al WhatsApp del asesor al instante (evidencia y comprobante de transferencia), queda ligada como evidencia_url visible en el panel ("Ver foto"), el asesor decide aprobar/rechazar/resolver (con PIN para roles operativos), queda registrado QUIÉN decidió y el cliente recibe el veredicto por WhatsApp
- [x] 2026-07-09 — Guiones de venta: aplicados V1 (urgencia honesta en carrito 2h), V2 (fuera promesas medibles), V3 (ETA concreto al escalar), V4 (sin ofertas -> sugiere el más vendido), V5 (empatía en devolución), V9 (cupón "no acumulable"), V10 (dormidos con gancho), V12 (alerta interna sobria). V6 ya vigilado (gratis solo envío); V7/V8/V11 descartados: bajo valor vs riesgo de romper copy probado
- [x] 2026-07-09 — Datos demo POR MÓDULO (Odoo): demoMetricas aplicar|revertir [citas|rrhh|gastos] — citas próximas 5 días, 2 empleados+14d horarios, 3 gastos (que se ANULAN con asiento inverso, respetando la inmutabilidad de libros). Probado ida y vuelta

## 🆕 v1.01 — Cola del comité de 16 auditorías (2026-07-09)

Hallazgos verificados contra el código (falsos positivos ya descartados:
`pago_real_activo` NO está en el UI). Orden acordado con el dueño: primero
bloque ① (bugs/controles), luego ⑦ (tablero financiero).

### ① Bugs y controles de integridad — REALES, arreglar ya
- [x] 2026-07-09 (v1.01) — **Sobreventa en POS**: `pos.js` descuenta sin validar que el stock alcance (kardex hace MAX(0,…) y lo enmascara). Validar stock ≥ cantidad antes de cobrar. (Cajero)
- [x] 2026-07-09 (v1.01) — **Asientos opcionales** (Oxford D2): con `contabilidad_activo` OFF la venta cobra y mueve inventario pero NO asienta. Bloquear apagar el módulo con período abierto / o asiento obligatorio en el chokepoint de pago
- [x] 2026-07-09 (v1.01) — **CFDI XXE/DoS**: el parser no rechaza `<!DOCTYPE` ni topa tamaño/conceptos. Añadir guardas (Seguridad)
- [x] 2026-07-09 (v1.01) — **Bitácora de `configuracion`** (Oxford D1/D5): registrar quién/valor-anterior en cambios críticos (periodo_cerrado, iva_pct, mantenimiento_bd, módulos). Hoy el bypass de inmutabilidad no deja rastro
- [ ] **Cierre de período laxo** (Oxford D6): el cierre bloquea asientos pero NO inserciones de kardex con fecha en mes cerrado
- [x] 2026-07-09 (v1.01) — **PII en `cola_emails`** (Seguridad): nombre/dirección en claro en asunto/cuerpo. Redactar el asunto

### ⑦ Tablero financiero de dirección — HECHO 2026-07-09 (v1.01)
ERP > Tablero de dirección (GET /api/erp/tablero, área finanzas; auditor lee). Todo desde datos existentes, probado contra la BD real (aging $28,960 y ticket $1,313/54 pedidos reales):
- [x] Estado de Resultados (P&L): Ventas − COGS − Gastos = Utilidad $/% (asientos 401/501/601)
- [x] Balance general básico (activo/pasivo/capital + utilidad acumulada, con check de cuadre)
- [x] Antigüedad de CxC (aging 0-30/31-60/61-90/90+) desde links_pago no pagados
- [x] Rotación de inventario / días de inventario / rotación anual desde inventarios×costo + COGS
- [x] Margen por categoría (ventas pagadas del período) y ticket promedio vs período anterior

### ② Mejoras de valor (medio) — v1.02 2026-07-09
- [x] `alert/confirm/prompt` nativos → toasts + confirm propios (lib/ui.jsx, SIN dep nueva; UiHost en App). apiError y Modulos migrados; el resto de páginas migra gradualmente
- [x] Índices SQL (migración 0032: folio/cliente/nombre/brand/links_pago) + batch `GET /api/modulos` (Modulos.jsx pasó de 17 requests en serie a 1)
- [x] Quick-wins de copy: emoji por giro (fuera 🧸 hardcodeado en _shared/asesorFlow), leyenda CFDI clara ("no es factura fiscal timbrada"), disclaimer nómina "aproximada" en confirm antes de pagar, ETA de asesor honesto
- [x] Guía Estafeta: el bot avisa "(número de referencia)" cuando la guía es simulada
- [ ] PENDIENTE: Marketing link wa.me + códigos de campaña (atribución) — Marketing
- [ ] PENDIENTE: Eventos de embudo intermedios — CRO
- [ ] PENDIENTE: disclaimer de Hevcaz (deslinde fiscal) en el widget de soporte — Legal

### ③ Fricción de venta/POS (medio) — v1.02 2026-07-09
- [x] Complemento sugerido en POS (GET /api/pos/sugeridos; tira "suele llevarse también" en Mostrador) — Ventas + CRO
- [ ] PENDIENTE (toca el checkout del bot, pase cuidadoso aparte): upsell siempre visible, auto-usar dirección guardada del recurrente, mostrar total antes del CP — Ventas

### ④ Anotado — grande o depende de terceros (NO ahora)
- [ ] Nómina MX completa (aguinaldo/prima vacacional/finiquito/séptimo día/expediente con antigüedad) — comité coincide: úsala como BORRADOR + PAC externo (ya documentado). Legalmente arriesgado omitir en finiquito → disclaimer en UI mitiga por ahora — RH+Legal
- [ ] Dashboard del vendedor / cartera de clientes asignados / alertas en tiempo real — Vendedor
- [ ] Monitor de baneo WhatsApp (tasa sin_entregar, reconexiones) + roadmap a WhatsApp Business API — Ecommerce (riesgo #1 de producción)
- [ ] Cifrado de backups en reposo, CSP sin unsafe-inline, cookie Secure por defecto en prod — Seguridad
- [ ] Recompra programada (consumibles), NPS→Google Reviews tras CSAT 5 — Marketing
- [ ] LLM real (hook ya listo), búsqueda semántica — Ecommerce
- [ ] Proceso ARCO formal + retención/purga de conversaciones (24m sin pedido) — Legal

## ⏸️ EN PAUSA / BLOQUEADOS (no tocar sin decisión del dueño)

- [ ] **Hotel** (habitaciones + calendario de ocupación) — PAUSADO por el dueño 2026-07-08
- [ ] **Pasarela de pago real** (Stripe/MercadoPago/OXXO) — bloqueado: requiere cuentas del cliente
- [ ] **CFDI timbrado con PAC** (Facturama/SW) — bloqueado: requiere contrato PAC del cliente
- [ ] **Conciliación bancaria** — tiene sentido después de la pasarela

## 🚫 Decisiones de arquitectura — NO adoptar del benchmark (SAP/NetSuite/Odoo)

Registradas para no re-discutirlas cada auditoría:

- **NO multi-tenant compartido** (NetSuite): instancia-por-cliente es correcta
  para whatsapp-web.js (cada tenant = su Chromium/número) y aísla datos/fallas.
- **NO ORM ni capas de abstracción** (Odoo/SAP): better-sqlite3 con SQL a la
  vista es ventaja de auditabilidad a este tamaño.
- **NO motor de workflows configurable** (SAP): las aprobaciones necesarias
  (solicitudes de compra, PIN) ya existen explícitas; un motor genérico es
  sobre-diseño.
- **NO scripting embebido tipo SuiteScript** (NetSuite): nuestros puntos de
  extensión (giroFlows, editor de frases, hueco LLM) ya cubren lo mismo con
  mantenimiento acotado.
- **NO CPQ/MRP/manufactura/WMS con olas de picking**: ningún giro objetivo lo pide.
- **El usuario "repartidor" NO existe** (decisión del dueño): el repartidor es
  DATO del pedido (nombre/teléfono), sin cuenta, sin app, sin GPS — el aviso
  "va en camino" lo manda el WhatsApp del negocio.

## 🔁 Recurrentes antes de cada deploy

- [ ] `node scripts/demoMetricas.js revertir` (si se sembró demo)
- [ ] Borrar usuarios de prueba (caja1, auditor1, alm1)
- [ ] `TRUST_PROXY=1` + SOPORTE_HEVCAZ_* en el .env del servidor
- [ ] El secreto `dashboard/.instancia_secret` NUNCA se copia entre servidores



# Auditoría consolidada y plan por fases

Fecha: 2026-07-08 · Fuentes: 4 auditores (ERP, bugs, multi-negocio, ventas/psicología)
+ comité previo (QA/seguridad/producto). Los hallazgos ya corregidos NO aparecen
aquí (ver historial de git); esto es lo PENDIENTE, verificado contra el código.

---

## A. HALLAZGOS

### A1. Completitud como ERP (veredicto: sistema de ventas+operación, NO ERP aún)

| Requisito | Estado | Detalle | Esfuerzo |
|---|---|---|---|
| Inventario multi-sucursal con movimientos | ✅ | `inventarios` + `inventario_movimientos`, venta descuenta automático | — |
| Pedidos + devoluciones (reversa inventario) | ✅ | `pedidos`/`pedido_detalle`/`devoluciones` | — |
| Catálogo productos con costo y precio | ✅ | `productos.costo` (migración 0016) + margen en Prime | — |
| Corte de caja | ✅ | `cortes_caja`: esperado vs contado por método | — |
| Datos fiscales en venta (RFC/razón social) | ✅ | Comprobante con leyenda; NO es CFDI timbrado | — |
| Cuentas por cobrar con vencimientos | 🟡 | Solo estatus pagado/pendiente; sin envejecimiento de cartera | Mediano |
| Listas de precios por cliente/grupo | 🟡 | Promociones por producto/categoría, no por cliente | Chico |
| Impuestos | 🟡 | `iva_pct` se guarda pero NUNCA se aplica al precio; sin ISR/retenciones | Mediano |
| Cotizaciones formales (vigencia) | 🟡 | Venta previa POS es lo más cercano | Chico |
| **Plan de cuentas + asientos automáticos + libro mayor** | ❌ | No existe nada contable; colgar del chokepoint `marcar-pagado` | Grande |
| **Catálogo de proveedores + cuentas por pagar + órdenes de compra** | ❌ | Proveedor es texto libre en entrada-mercancía | Mediano |
| **Costeo PROMEDIO/FIFO con historial** | ❌ | `costo` se sobreescribe global; sin COGS por venta | Mediano |
| Conciliación bancaria | ❌ | Sin `movimientos_bancos` ni matching | Grande |
| CFDI timbrado (PAC) | ❌ | Regulatorio MX; integración Facturama/SW (~$1-2/timbre) | Grande |

**Top 3 para el salto a ERP**: asientos automáticos, proveedores+CxP, costeo promedio.

### A2. Multi-negocio (veredicto: listo para retail México; citas y multi-país no)

**Bloqueadores reales:**

| # | Hallazgo | Dónde | Esfuerzo |
|---|---|---|---|
| M1 | Remitente Estafeta hardcodeado "Julio Cepeda Jugueterías" + CP 78000 | `services/estafetaService.js:35-41` | Chico (a `configuracion`) |
| M2 | URL de rastreo hardcodeada `julio-cepeda-bot.local` | `estafetaService.js:110` | Chico |
| M3 | Sin flujo de CITAS — barbería/estética/uñas/tatuajes prometen "pide cita" sin flujo | `giroFlows.js` (hueco listo) | Grande (1-2 sem) |
| M4 | Checkout asume producto con inventario; no hay tipo "servicio" sin stock | `menuFlow/cartFlow/_shared` | Mediano |
| M5 | IVA configurado pero no aplicado en precios | `_shared.js` totales | Mediano |
| M6 | "MXN" fijo en ~50 textos de flujos (ignora `configuracion.moneda`) | flows varios | Mediano |
| M7 | CP validado a 5 dígitos exactos (México) | `orderFlow.js:72` | Mediano (solo si sale de MX) |
| M8 | `DIAS_ENTREGA` mapeado a sucursales mexicanas fijas | `stockService.js:8-20` | Mediano |
| M9 | Horario de atención "11am-8pm" hardcodeado | `_shared.js` | Chico (a `configuracion`) |
| M10 | Seed de sucursales mexicanas heredado en clon nuevo | `migrations/0005` | Chico (borrar en Prime) |
| M11 | Solo Estafeta como paquetería (FedEx/DHL no) | `estafetaService.js` | Grande (fase 2 real) |
| M12 | Pago con gateway real stubbed (links manuales) | `_shared.js` | Grande |

**Diagnóstico por giro HOY**: juguetería/retail/abarrotes/ferretería/carnicería MX ✅ ·
restaurante ✅ (menú como catálogo) · barbería/servicios/estética/tatuajes ❌ (necesitan M3+M4) ·
fuera de México ❌ (M5-M8).

### A3. Bugs pendientes (verificados; los falsos positivos del auditor ya descartados)

| # | Bug | Dónde | Gravedad |
|---|---|---|---|
| B1 | Cancelar venta POS no revierte los puntos ya otorgados | `pos.js` cancelar | Alta |
| B2 | Cancelar un pago ya marcado-pagado no revierte inventario ni puntos | `comunicacionPedidos.js` cancelar | Alta |
| B3 | JOIN `c.id=p.id_cliente OR c.nombre=p.cliente` puede tomar cliente equivocado con nombres duplicados | `comunicacionPedidos.js:179` (y marcar-pagado) | Media |
| B4 | `sucursal_origen` null en cancelación POS cae a `WHERE sucursal=NULL` (no repone) | `pos.js` cancelar | Media |
| B5 | Tasa de conversión mezcla string/number (`.toFixed` vs 0) | `marketing.js:155` | Baja |

Descartados como falsos: `MAX(0,stock-?)` (SQLite sí tiene max escalar — 2 veces reportado),
`date('now','localtime',?)` con parámetro (funciona), require() en fallback (cache de Node).

### A4. Ventas y psicología (12 hallazgos con texto propuesto — resumen priorizado)

| # | Hallazgo | Mensaje | Impacto |
|---|---|---|---|
| V1 | Carrito 2h sin incentivo (el de 24h sí da cupón → cliente aprende a esperar) | `stockWatcher.js:217` | Alto |
| V2 | Promesas medibles que fallan ("30 segundos", "en segundos") | `menuFlow/cartFlow` | Alto |
| V3 | Escalada a asesor sin ETA concreto ("te contactará el equipo") | `asesorFlow/menuFlow` | Alto |
| V4 | "No hay ofertas" sin alternativa (mostrar el más vendido = prueba social) | `menuFlow.js:176` | Alto |
| V5 | Devoluciones sin validación emocional antes de resolver | `asesorFlow.js:152` | Alto |
| V6 | "¡GRATIS!" vs "sin costo" inconsistente entre tonos (gratis solo para envío) | `_config.js` | Medio |
| V7 | Prueba social ("18 personas esperando") escondida al final del mensaje | `menuFlow.js:341` | Medio |
| V8 | Mensajes largos con decisión sobrecargada en puntos críticos | `_config.js` | Medio |
| V9 | Cupón 24h no aclara "no acumulable" → error en checkout | `stockWatcher.js:287` | Medio |
| V10 | Clientes dormidos: copy genérico sin gancho específico | `stockWatcher.js:487` | Medio |
| V11 | Rastreo de pedido con tono seco (sin celebrar el hallazgo) | `asesorFlow.js:75` | Bajo |
| V12 | Alerta interna de quejas "🚨 URGENTE" gritona (parece spam al asesor) | `stockWatcher.js:441` | Bajo |

Los textos de reemplazo completos están en el reporte del auditor (sesión 2026-07-08);
se aplican en Fase 3 tal cual, ajustando `{negocio}`/vocab por giro.

---

## B. SECTOR CAMBACEO — venta puerta a puerta de internet/cable (ISP)

### Cómo opera el sector
Vendedores de campo (cambaceantes) tocan puertas ofreciendo planes de internet/TV;
levantan prospecto con domicilio, verifican cobertura, agendan instalación con
técnico, el cliente paga mensualidad recurrente, y el vendedor cobra comisión
por instalación completada.

### Qué YA cumple el sistema (≈40%)

| Necesidad del cambaceo | Cubierto por |
|---|---|
| Canal de contacto del prospecto (QR/link → chat del bot) | Bot WhatsApp completo |
| Catálogo de planes con precio | `productos` (como servicio, ver M4) |
| Escalada a humano para cerrar/negociar | Cola de atención + chat en vivo |
| Fotos de documentos (INE, comprobante domicilio) | `imagenes_clientes` + WebP + backup |
| Roles para vendedores de campo | rol `usuario` (cajero) del RBAC |
| Atribución parcial (código de referido de 5 chars) | `referidosService` |
| Recordatorios/mensajes programados | `cola_notificaciones` + campañas |
| Verificación por CP | `buscarCobertura` (hoy orientado a envío) |

### Qué FALTA para cumplir (se construye en Fases 4-5)

| Necesidad | Qué construir | Reutiliza |
|---|---|---|
| Producto tipo SERVICIO (plan sin stock, precio mensual) | `productos.tipo='servicio'` + `precio_mensual` — checkout salta inventario/envío | M4 |
| Agendar instalación (fecha/hora/técnico, estados programada→instalada→rechazada) | `citasFlow` + tabla `citas` — EL MISMO módulo que barbería | M3 |
| Cobertura por zona (¿llega la red a este CP/colonia?) | tabla `zonas_cobertura` + check en el flujo (reusa `buscarCobertura`) | M7 |
| Mensualidades / cobro recurrente | `cuentas_por_cobrar` con vencimiento + recordatorio mensual vía cola | Pilar ERP CxC |
| Atribución y comisiones por vendedor | `pedidos.id_vendedor` + link/QR único por vendedor + reporte de comisiones | referidos |
| Contrato/orden de servicio imprimible | plantilla como el ticket POS con datos del plan | factura.js |

**Sinergia clave**: `citasFlow` abre barbería/estética/servicios **Y** cambaceo ISP;
`cuentas_por_cobrar` sirve al ERP (Pilar 1) **Y** a las mensualidades ISP. Nada se
construye dos veces.

---

## C. PLAN POR FASES

> Regla: cada fase se cierra con tests verdes + captura/verificación + commit.
> Ninguna fase rompe la paridad de Julio Cepeda (flags apagados por default).

### FASE 1 — Correcciones críticas pre-despliegue · **~1 día**
- B1+B2: función única `revertirCobro(idPedido)` (repone inventario si aplicaba,
  resta puntos si `puntos_acreditados=1`) llamada desde las 2 cancelaciones.
- B3: JOIN por `id_cliente` con fallback explícito. B4: fail-fast sin sucursal. B5: tipo consistente.
- M1+M2+M9: remitente/URL de rastreo/horario a `configuracion` (editable en Prime).
- Revertir datos demo. **Criterio de cierre**: tests verdes + cancelaciones probadas ida y vuelta.

### FASE 2 — Despliegue Julio Cepeda a producción · **~½ día + monitoreo**
- Seguir `DESPLIEGUE.md` (BD con checkpoint WAL, Caddy, QR, checklist post-deploy).
- Cron de backup + primera semana de observación de logs/fallbacks.
- **Criterio**: venta real completa por WhatsApp en producción.

### FASE 3 — Guiones de venta (V1-V12) · **~1 día**
- Aplicar los 12 textos del auditor (por `t()`/vocab, respetando giros y la regla "gratis").
- **Criterio**: `test:bot` verde + lectura completa de los 4 tonos sin regresiones.

### FASE 4 — Módulo de CITAS + productos tipo SERVICIO · **1-2 semanas**
- `bot/flows/citasFlow.js` (S.CITA_FECHA/S.CITA_HORA), tabla `citas` (migración),
  horarios por sucursal, recordatorio 24h antes, gestión en dashboard (agenda del día).
- `productos.tipo='servicio'`: sin stock, sin envío, checkout directo a agendar/pagar.
- Registrar en `GIRO_FLOWS` para barberia/estetica/unas/tatuajes/servicios/mantenimiento.
- **Abre**: todos los giros de servicios. **Criterio**: cita agendada+recordada end-to-end en instancia de prueba con giro barbería.

### FASE 5 — Vertical CAMBACEO ISP/cable · **1-2 semanas** (después de F4)
- Giro nuevo `isp` en `_giros.js` (vocab: plan/planes/📡) + preset de menú.
- Planes como productos-servicio con `precio_mensual`; flujo: cobertura (CP/colonia
  vs `zonas_cobertura`) → elegir plan → datos+documentos → **cita de instalación** (F4).
- `pedidos.id_vendedor` + link `wa.me` con código por vendedor → atribución automática
  y reporte de comisiones por instalación completada.
- `cuentas_por_cobrar` (vencimiento mensual) + recordatorio de pago vía cola.
- **Criterio**: alta de prospecto → instalación agendada → primera mensualidad cobrada y segunda recordada, en instancia demo ISP.

### FASE 6 — ERP financiero · **3-4 semanas** (vendible como upgrade)
- 6a: `proveedores` + `ordenes_compra` + recepción liga entrada-mercancía + `cuentas_por_pagar`.
- 6b: `plan_cuentas` + asientos automáticos desde `marcar-pagado`/entrada-mercancía/corte + libro mayor consultable.
- 6c: costeo PROMEDIO (`historial_costos`) → COGS y margen real por venta.
- 6d (opcional por cliente): CFDI timbrado vía PAC; conciliación bancaria.
- **Criterio**: cada venta/compra genera su asiento sin intervención; balanza cuadra contra corte.

### FASE 7 — Internacionalización · **solo si llega cliente fuera de MX**
- M5 (IVA aplicado), M6 (moneda por configuración), M7 (CP por país), M8 (matriz
  de entrega configurable), paquetería local (M11). No invertir antes de tener el cliente.

### Paralelo permanente
- Backlog de gateway de pago real (M12) cuando un cliente lo exija.
- `DOCUMENTACION_TECNICA.md` se actualiza al cierre de cada fase.
