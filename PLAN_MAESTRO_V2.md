# PLAN MAESTRO v2 — pendientes consolidados (2026-07-12)

Une tres fuentes: brecha vs Odoo/Dynamics (`BRECHA_ODOO_DYNAMICS.md`),
verificación rol×ramo de los 5 agentes (`VERIFICACION_ROL_RAMO.md`) y la
viabilidad multi-ERP (`VIABILIDAD_MULTI_ERP.md`, ver §D). Filosofía: boring-tech,
aditivo/toggleable, JC byte-idéntico, white-label intacto.

## ✅ YA HECHO esta sesión (en main)
- **Timbrado CFDI 4.0 key-only** (factura + venta mostrador + nómina) con Facturapi + descarga PDF/XML.
- **UI convergencia**: delta "vs ayer" en KPIs + badges de pendientes en sidebar.
- **Gráficas**: cascada P&L, comparativo, aging, dona corte, sparklines, rankings, composición.
- **4 fixes rol×ramo**: puente cita→servicio, cantidad por bot configurable, descarga CFDI, propina en mesa.
- **Presets por giro**: fiado en abarrotes/carnicería/ferretería, repartidor en restaurante, POS en tatuajes.

## ✅ Ola 1 — ciclo fiscal MX — HECHA (2026-07-12)
1. ✅ Complemento de pago (REP) — `POST /api/erp/cfdi/:id/rep` (manual, factura PPD). Payload a validar vs PPD real.
2. ✅ Cancelación de CFDI — `POST /api/erp/cfdi/:id/cancelar` + botón en FacturacionTab.
3. ✅ Aviso al cliente al timbrar (WhatsApp) + descarga PDF/XML. (Correo con adjunto = follow-up con el SMTP de backup.js.)

## ✅ Ola 2 — reportería fiscal — HECHA (2026-07-12)
4. ✅ **DIOT** — `GET /api/erp/diot?mes=&formato=txt`: agrupa CxP por proveedor, deriva base+IVA, exporta TXT del SAT. Borrador que el contador valida.
5. ✅ **Contabilidad electrónica SAT** — `GET /api/erp/contabilidad-electronica?tipo=catalogo|balanza`: XML catálogo (con código agrupador base) + balanza mensual desde `plan_cuentas`/`libroMayor`. UI en Gastos e impuestos → Reportes SAT. Borrador; el código agrupador SAT se amplía con el contador.

## Ola 3 — huecos operativos de los agentes (baratos, alto uso diario)
6. ✅ **Solicitud→OC automática** — HECHA: al aprobar se elige proveedor y se crea la OC (costo de productos.costo). UI con prompt de proveedor en Compras.jsx.
7. ✅ **Recepción parcial de OC** — HECHA (migración 0056): recibir por líneas, CxP+inventario por lo recibido, OC `parcial` hasta completar. Contract test 8/8.
8. ✅ **Cableado UI del backend fiscal** (hallazgo de los 2 reviews — backend listo, sin botón): **REP** en FacturacionTab, **timbrar recibo de nómina + PDF/XML** en Rrhh.jsx (+ ruta descarga nómina).
9. **Cajero cobra fiado** / **división de cuenta** — PENDIENTES (diseño abierto).

## Huecos de los reviews rol×ramo (2026-07-12)
- ✅ **Cita→cobro** — HECHO (migración 0057 `citas.servicio_precio/id_servicio/id_pedido`): citasFlow persiste el precio; `POST /api/citas/:id/cobrar` arma la venta reusando el POS (servicio sin stock) + asiento + puntos; botón "Cobrar" en Citas.jsx (pide precio y método) con badge "cobrada". Cierra el círculo agendar→cobrar de barbería/estética/uñas. **Es la Fase 1 del piloto del motor de flujo** (giro cita completo end-to-end).
- ✅ **Almacén ya alcanza la recepción de OC** — HECHO: `ComprasTab` acepta `soloRecepcion` (oculta el alta de OC) y se monta como pestaña "Recepción de OC" en la página Almacén. Misma lógica/endpoint (`ocRecibir` área almacen), sin duplicar.
- ✅ **Catálogo agrupador SAT transparente** — HECHO: las 14 cuentas del plan YA estaban mapeadas; el fallback ahora es un código VÁLIDO por naturaleza (activo→100, pasivo→200…) en vez de un `codigo+.01` inválido, y el endpoint reporta `sin_mapear` en la nota para que el contador afine solo lo custom. (No se fabrican códigos Anexo 24 — eso lo valida el contador.)
- ✅ **DIOT usa IVA real del CFDI** — HECHO (migración 0058 `cuentas_pagar.base`/`iva`): la importación XML guarda base/IVA exactos del CFDI; la DIOT los prefiere por proveedor y solo deriva plano las CxP capturadas a mano sin CFDI. Self-check de la mezcla real+plano PASS.
- ✅ **Cajero cobra fiado / abono parcial** — HECHO (auditoría de herramientas por rol, huecos ALTO 1 y 2): `POST /api/pos/fiados/:id_cliente/abono` (área pos) liquida tickets completos FIFO viejo→nuevo hasta donde alcance el monto (vacío = liquidar todo), reusando el camino de cobro a crédito (asientoCobroCredito + puntos + confirmar + avisar). Botón **Cobrar** en Fiados.jsx visible para cajero/operador. Self-check FIFO PASS. Parcial DENTRO de un mismo ticket = upgrade aparte (necesita `pedidos.abonado` + asiento por abono; asientoCobroCredito es idempotente por pedido a propósito).
- ✅ **Propina + reparto** — HECHO (según criterio del dueño: en MX la propina NO es costo/ingreso gravado, ya se cobraba aparte de `asientoVenta`). Dos módulos opt-in default OFF: `propina_activo` (mensaje **personalizable** sugerido en el ticket + 10%/15%, editable por gerente en Módulos; hay lugares sin propina) y `reparto_activo` (pestaña de reparto en el POS: bolsa de propinas cobradas vs repartido + registro empleado→monto, para restaurantes y/o materiales). Migración 0059 `repartos`. Endpoints `/api/pos/reparto` (GET pos/cortes/finanzas, POST pos) y `/api/pos/propina-mensaje`. Restaurante los enciende en onboarding. Rol mesero/comisionista siguen cubiertos por `operador`+`cobrado_por`/comisiones (no se crean nominalmente).
- ✅ **PPD vs PUE distinguido** en FacturacionTab — HECHO: `facturacion-pendiente` deriva `metodo_sat` de `a_credito` (fiado=PPD, contado=PUE); la columna "Pago" lo muestra y el botón **REP solo aparece en PPD sin `rep_uuid`** (badge "REP ✓" cuando ya se timbró).

## Ola 4 — flujo de efectivo · ~4-5 días
10. ✅ **Conciliación bancaria** — HECHA (migración 0060 `movimientos_banco`): sube el estado de cuenta (CSV parseado en el cliente — monto único o cargo/abono, fechas dd/mm/yyyy), auto-casa cada línea contra cobros (`links_pago` pagados, ingresos) y pagos (`cuentas_pagar` pagadas, egresos) por monto exacto + fecha ±3 días, y deja ver lo que NO cuadra. Conciliar/desconciliar manual. Tab en Finanzas. Self-check del auto-match PASS. `/api/erp/conciliacion[/importar|/:id]` área finanzas.
11. ✅ **Pasarela de pago real (key-only) + modo demo** — HECHA: `gatewayProviders.js` (Stripe Checkout Session + Mercado Pago Preference, key-only, https nativo) + `gatewayService.js` (doble-gate, key cifrada como el PAC, `crearLink` async). `pagoLinkService` reescrito: sync (demo/estático, bot) + `generarLinkAsync` (gateway real, panel). `enviar-link` async usa el gateway real. **Modo demo** (`pago_demo`): simula el link con la referencia real y lo envía normal (cola_notificaciones) sin cobrar — para presentarle el sistema al cliente. Config prime `/api/prime/pasarela` + UI en Prime > General (tarjeta Pasarela con toggle demo). Self-check PASS. Proveedores key-only investigados: Stripe (secret key), Mercado Pago (access token), Clip/Conekta (encajan igual, se agregan por demanda).

**→ Ola 4 COMPLETA.**

## Bot data-driven (frases fuera del código) — ver ARQUITECTURA_BOT_DATADRIVEN.md
El dueño tiene razón: en multitienda las frases NO deben vivir en código. Pero el
motor ComfyUI completo (flujo interpretado) es over-engineering (rompe ~100 tests,
mete superficie de fallo en el hot path de ventas, y ninguna tienda recablea su
flujo de venta). La ruta de mejor ROI:
- **Fase 1 — frases 100% en datos (2-3 días, riesgo bajo)**: mover TODOS los
  literales inline (58 en menuFlow, 26 cartFlow, 27 orderFlow) a `t()`. La tubería
  `configuracion.frase_<clave>` por instancia YA existe; hoy solo ~12 de ~130
  respuestas pasan por ella. Esto resuelve el 90% del dolor multitienda. Piloto:
  citasFlow (aislado, sin dinero) → los de dinero al final, tocando solo su texto.
- **Fase 2 — mapa visual solo-lectura (3-4 días)**: la sensación ComfyUI (ves el
  grafo, editas texto por nodo) sin aristas reconectables.
- **Fase 3 — motor interpretado completo: DESCARTADO** salvo necesidad concreta.

## Ola 5 — módulos por segmento (proyectos aparte, por demanda de cliente)
12. **Recetas/insumos** (restaurante) — descontar ingredientes al vender un platillo; sin esto el costeo de comida es ficticio. Es lo que separa "POS con mesas" de "sistema de restaurante".
13. ~~**Planes recurrentes** (ISP)~~ → **absorbido por F5.1** (suscripción mensual en `servicios`; ISP se elimina como giro).
14. **Órdenes de trabajo** (servicios/mantenimiento) — equipo/falla/refacciones/horas/estatus.
15. **Anticipo en citas** (tatuajes) — reusar la mecánica de apartado de preventas.
16. **Estatus de cocina / KDS** (restaurante con volumen) — `enviado_cocina` binario → enum preparando/listo/servido.

## FASE 5 — pendientes del dueño (2026-07-12) · ✅ COMPLETA
> F5.0 (ISP fuera + freelancer→servicios), F5.1 (suscripciones/MRR), F5.2 (documentos:
> cotizaciones/pagarés/contratos con plantillas por sucursal), F5.3 (reportes imprimibles:
> libro mayor/diario/OC/corte de caja/kardex vía helper `reporteImprimible`), F5.4 (baúl
> contable: archivero de CFDIs + export .zip nativo). Todo verificado y en main. Detalle abajo.

Nuevos requerimientos + limpieza de giros. Filosofía intacta: aditivo/toggleable, JC byte-idéntico,
boring-tech, instancia-por-cliente. Orden sugerido: F5.0 (limpieza, rápido) → F5.1 (suscripción, alto
valor comercial) → F5.4 (baúl, cierra el ciclo fiscal) → F5.2 (documentos) → F5.3 (reportes imprimibles).

- **F5.0 — Limpieza de giros (rápido):**
  - **Quitar ISP** del onboarding/giros (`_giros.js`, `modulosDefaults.js`): hoy se comporta como
    barbería y NO factura recurrente → vendía una capacidad inexistente. Se elimina como giro.
  - **freelancer = servicios**: NO es giro propio; se aliasa a `servicios` (mismo vocab/flujo). Si se
    selecciona, opera como servicios.

- **F5.1 — Suscripción mensual toggleable en `servicios` (alto valor):** módulo `suscripcion_activo`
  (default OFF). Captura cliente + datos de referencia + monto + periodicidad (mensual) y genera el
  **cobro recurrente**. CLAVE: la suscripción debe **proyectarse a ventas con números** (MRR / ingreso
  recurrente esperado del mes) para poder proyectar. Reusa `links_pago`/`marcar-pagado` y el flujo de
  cobro sellado; cubre también lo que el ISP habría necesitado (recurrencia), ahora como opción de
  servicios, no un giro aparte. Nueva tabla `suscripciones` (cliente, monto, periodicidad, día de corte,
  estatus activa/suspendida, próximo_cobro). El stockWatcher (o un tick) genera el cobro del mes.

- **F5.2 — Documentos: cotizaciones / pagarés / contratos (clientes, personal y/o proveedores):**
  generador de documentos con **plantillas estándar + plantilla propia por sucursal** (la sucursal sube
  la suya). Tipos: **cotización** (→ convertible a pedido), **pagaré** (ligado al fiado/CxC), **contrato**
  (personal = empleados; proveedores). Tabla `documentos` (tipo, plantilla, contraparte, montos, estatus,
  pdf/render) + `plantillas_documento` (por sucursal/estándar). Salida imprimible (PDF/print), como la
  constancia de fiado que ya existe.

- **F5.3 — Reportes imprimibles/exportables:** capa de impresión/PDF sobre datos que YA existen —
  cortes de caja, libros contables (diario/mayor/balanza), órdenes de compra, entradas de mercancía,
  transferencias entre sucursales, etc. No es lógica nueva: es render imprimible + export (CSV/PDF) de
  reportes existentes, con encabezado del negocio/sucursal.

- **F5.4 — Baúl de contabilidad (repositorio de CFDIs):** donde caen las facturas que devuelve el PAC.
  Guarda y **organiza en carpetas locales** los CFDI (XML + PDF) emitidos/recibidos (por mes/tipo/RFC), y
  permite **exportar por lote** (zip) para el contador. Reusa el patrón de `scripts/backup.js` (SMTP con
  adjunto) y el `datasetExport` (gzip). Es el "archivero fiscal" que el contador pide: todo el mes en una
  carpeta/zip. Se alimenta de lo que `pacService` ya timbra/descarga (PDF/XML).

## Recombinaciones de alto ROI (reusar lo que ya existe)
- **Valuación de inventario** (kardex+costeo ya calculan el valor) → reporte "valor a fecha X por sucursal". Barato.
- **CRM conversacional** (bot+citas+historial) → pipeline de etapas lead→cliente sobre `conversaciones`. Medio.
- **Panel de flota Hevcaz** (multi-cliente) — ver §D viabilidad + cuando haya 3+ clientes.

## §D — Multi-ERP en red (LAN/remoto) + intercomunicación
Del agente de viabilidad (`VIABILIDAD_MULTI_ERP.md`, verificado en código). Titular:
**los 3 escenarios de despliegue ya son viables casi sin código — es configuración,
no reingeniería. La intercomunicación no existe pero es barata para lo que importa.
NO se justifica Postgres/microservicios/K8s.**

Ya existe (no había que construirlo): `DASHBOARD_HOST` conmutable (server.js:685 → LAN
con 0.0.0.0), `DASHBOARD_COOKIE_SECURE` (:85), `TRUST_PROXY` (:100), rate-limit por IP
(:97), lockout por usuario (:129), sesiones firmadas HMAC con secreto por instancia.

- **Fase D0 — 1 instancia, varios usuarios LAN (horas)**: `DASHBOARD_HOST=0.0.0.0`, las
  cajas entran por IP LAN. WAL aguanta 5-10 cajas (1 escritor serializado + busy_timeout
  5s). ✅ viable hoy.
- **Fase D1 — varias instancias en 1 servidor (½ día)**: N pares de procesos pm2, cada
  uno `DB_PATH` FIJO y **sin** `.instancia_activa`, puertos distintos + reverse proxy
  (nginx/Caddy). OJO: el selector de instancias actual (exit+restart, un proceso = una
  tienda) es para navegar demos en 1 equipo, **no** para hosting concurrente — para N
  negocios simultáneos NO se usa el puntero.
- **Fase D2 — remoto seguro (1 día)**: antes de exponer a internet — `DASHBOARD_COOKIE_SECURE=1`,
  `TRUST_PROXY=1`, HTTPS (Caddy auto-TLS), quitar `'unsafe-inline'` del CSP (server.js:386),
  y **validar `Origin` en el guard anti-CSRF** (`rejectCrossSiteForm` server.js:586 hoy solo
  valida content-type, ~10 líneas). Recomendado para pyme: **Tailscale/WireGuard** (VPN,
  resuelve NAT gratis) en vez de exponer el puerto directo.
- **Fase D3 — intercomunicación / panel de flota (2-4 días)**: hoy no hay NADA saliente
  (cero http.request; cola_notificaciones es bus intra-.db). Recomendación: **hub PULL de
  solo-lectura** — cada instancia expone `GET /api/flota/status` con token (~40 líneas,
  patrón `construirModulo`) publicando versión/ventas-hoy/bot-online/último-backup/errores;
  un agregador central pollea. Cubre **panel de flota Hevcaz + consolidado multi-tienda del
  mismo dueño (80% del valor)** sin romper instancia-por-tenant. Transferencia de stock A↔B
  y "proveedor que es otra instancia" (B2B): **diferir** — requieren escritura cruzada,
  conflictos y auth mutua; caro y arriesgado para el valor que dan hoy.

Riesgo transversal: el proceso es **síncrono monohilo** → un reporte pesado bloquea a todas
las cajas. Mitigación: forkear los reportes pesados como ya hace `stockWatcher.worker.js`.

## Lo que NO se hace (fuera del segmento)
Manufactura/MRP, proyectos/timesheets, consolidación multi-empresa contable,
multi-moneda (salvo cliente que lo pida). Microservicios/Postgres/K8s: no, la
arquitectura boring-tech aguanta el negocio objetivo.

## Orden recomendado
Ola 1 (ciclo fiscal) → Ola 3 items 6-8 (baratos, alto uso) → Ola 2 (DIOT primero)
→ §D fase LAN multiusuario → Ola 4 → resto por demanda.
