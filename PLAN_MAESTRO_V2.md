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

## Ola 3 — huecos operativos de los agentes (baratos, alto uso diario) · ~3-4 días
6. **Solicitud→OC automática** al aprobar (compras) — hoy recaptura manual.
7. **Recepción parcial de OC** — `cantidad_recibida` + estado `parcial`; cerrar solo al recibir todo.
8. **Cajero cobra fiado** — botón "abono" en Fiados (endpoint marcar-pagado ya acepta `pos`) o dar `pos` al link Pedidos. Decidir si se quiere romper la separación de funciones.
9. **División de cuenta** en mesas — cerrar subconjunto de mesa_items en varios pagos.

## Ola 4 — flujo de efectivo · ~4-5 días
10. **Conciliación bancaria** — importar estado de cuenta (CSV/OFX), casar contra `links_pago`/`cuentas_pagar`. El vacío de responsabilidad #1 (nadie lo cubre). Tras la pasarela.
11. **Pasarela de pago real** — conectar 1 gateway (Clip/MercadoPago) key-only, mismo patrón del PAC. El stub `pagoLinkService` ya existe.

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
13. **Planes recurrentes** (ISP) — facturación mensual recurrente; hoy todo es contado.
14. **Órdenes de trabajo** (servicios/mantenimiento) — equipo/falla/refacciones/horas/estatus.
15. **Anticipo en citas** (tatuajes) — reusar la mecánica de apartado de preventas.
16. **Estatus de cocina / KDS** (restaurante con volumen) — `enviado_cocina` binario → enum preparando/listo/servido.

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
