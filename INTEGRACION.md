# Guía de integración — ciclo fiscal (CFDI), LAN multiusuario y flota

Estado de lo construido esta sesión y **cómo se opera**. Todo aditivo, inerte
hasta configurarse, JC byte-idéntico.

---

## 1) Ciclo fiscal CFDI 4.0 (PAC key-only — Facturapi)

### Modelo
El negocio sube su **CSD una sola vez en el portal de Facturapi** (facturapi.io)
y obtiene un API key `sk_live_...`. En el ERP **solo se pega la key** (Prime →
General → PAC). El producto **nunca toca certificados**. Doble-gate: módulo
`facturacion_activo` ON **y** key configurada.

### Flujo end-to-end (todo ya conectado)
| Acción | Ruta / servicio | Estado |
|---|---|---|
| Timbrar factura / venta mostrador | `POST /api/erp/timbrar/:id` → `pacService.timbrar` → `pacProviders.facturapi.timbrarFactura` | ✅ conectado; guarda `pedidos.cfdi_uuid` |
| Aviso al cliente al timbrar | `pacService.enviarComprobante` → `cola_notificaciones` (WhatsApp) | ✅ best-effort |
| Descargar PDF/XML | `GET /api/erp/cfdi/:id/pdf|xml` | ✅ stream desde el PAC |
| Cancelar CFDI | `POST /api/erp/cfdi/:id/cancelar` (motivo SAT, def `02`) | ✅ conectado |
| Complemento de pago (REP) | `POST /api/erp/cfdi/:id/rep` (factura PPD pagada) | 🟡 conectado; **validar el payload contra una factura PPD real** antes de producción (parcialidad/saldo insoluto) |
| Timbrar recibo de nómina | `POST /api/rrhh/nomina/:id/timbrar` → `pacService.timbrarNomina` | ✅ conectado; requiere RFC/CURP/NSS del empleado + registro patronal |
| UI | `pages/erp/FacturacionTab.jsx`: por fila → Timbrar / PDF / XML / Cancelar (aparecen según estatus y si el PAC está activo) | ✅ |

### Lo que falta validar (necesita una key real de sandbox)
- El **payload REP** (complemento de pago): related_documents/parcialidad/
  saldo_insoluto están armados al mínimo — confirmar contra una PPD real.
- **Facturama** como proveedor alterno: el adaptador existe (Basic auth) pero el
  mapeo de payload de su API difiere; se completa si un cliente lo pide.
- **Adjuntar el PDF/XML por correo**: hoy se avisa por WhatsApp y se descarga del
  panel; el correo con adjunto reusaría el SMTP hand-rolled de `backup.js` (follow-up).

### Claves de configuración (Prime → General → PAC)
`pac_proveedor` (`facturapi`), `pac_api_key` (cifrada), `pac_ambiente`
(sandbox/produccion), `pac_uso_cfdi` (G03), `pac_regimen_receptor` (616),
`pac_cp_receptor`, `pac_clave_prod_sat` (01010101), `pac_clave_unidad` (H87),
`pac_registro_patronal` (para nómina).

---

## 2) LAN multiusuario (Fase D0) — cómo desplegar

**Ya es viable con config, no hay que construir nada.** Para que varias cajas/
tablets de la MISMA tienda entren a la MISMA instancia:

1. En el `.env`: `DASHBOARD_HOST=0.0.0.0` (hoy default localhost) — el dashboard
   escucha en toda la red local.
2. Las cajas entran a `http://<IP-del-servidor>:3001`.
3. Si es solo LAN por HTTP, dejar `DASHBOARD_COOKIE_SECURE=0` (default). Si se
   pone un proxy HTTPS, `=1` + `TRUST_PROXY=1`.
4. Rate-limit por IP y lockout por usuario ya están activos.

**Concurrencia**: SQLite WAL serializa 1 escritor a la vez con `busy_timeout=5s`
— holgado para 5-10 cajas. Riesgo: el proceso es síncrono monohilo, un reporte
pesado bloquea a todas; mitigación futura = forkear los reportes como
`stockWatcher.worker.js`.

---

## 3) Panel de flota / consolidado (Fase D3) — cómo funciona

**Construido**: cada instancia expone `GET /api/flota/status` (máquina-a-máquina,
`dashboard/routes/flota.js`), protegido por un **token propio** (no la sesión del
dashboard). **Apagado por defecto**: sin token da 404 — una instancia no publica
su pulso hasta que el proveedor le pone token.

### Activar en una instancia
Poner `configuracion.flota_token` (o env `FLOTA_TOKEN`) con un token secreto.

### Consumir (agregador central — a construir del lado Hevcaz)
Un script/panel del proveedor pollea cada instancia:
```
GET https://<instancia>/api/flota/status
Header: X-Flota-Token: <token de esa instancia>
```
Devuelve (solo pulso, cero datos de clientes): `negocio`, `giro`, `version`,
`ventas_hoy`, `pedidos_hoy`, `ultimo_bot_estatus`, `cola_atencion`,
`emails_error`, `pagos_por_cobrar`, `ts`.

Con eso el agregador arma: **panel de flota** (N clientes: versión, online,
ventas, errores) y **consolidado multi-tienda** del mismo dueño (sumar
`ventas_hoy` de sus instancias). Respeta instancia-por-tenant: es PULL de
solo-lectura, sin escritura cruzada.

### Lo que se difiere (caro/riesgoso vs valor hoy)
Transferencia de inventario A↔B y "proveedor que es otra instancia" (B2B):
requieren escritura cruzada, resolución de conflictos y auth mutua. No ahora.

### Al exponer a internet (endurecer antes)
- `DASHBOARD_COOKIE_SECURE=1` + `TRUST_PROXY=1` + HTTPS (Caddy auto-TLS).
- Quitar `'unsafe-inline'` del CSP (`server.js` SECURITY_HEADERS) — OJO: rompe el
  `<script>print()</script>` de la constancia de Fiados; migrar ese inline primero.
- Validar `Origin` en `rejectCrossSiteForm` (`server.js:586`, hoy solo valida
  content-type) — ~10 líneas.
- Recomendado para pyme: **Tailscale/WireGuard** (VPN) en vez de abrir el puerto.

---

## 4) Editor visual del bot tipo ComfyUI (evaluado, NO construido)
Ver `FACTIBILIDAD_EDITOR_BOT_VISUAL.md`. Resumen: 🟡 factible como **"mapa del
bot"** (visualizar el flujo como grafo + editar frases por nodo), NO como editor
de flujo (el flujo vive en código; reconectar aristas rompería ventas). La
persistencia de frase-por-instancia (`configuracion.frase_<clave>` + `t()`) YA
existe → backend nuevo ≈ 0. Grafo a mano (SVG/CSS ~150 líneas), NO react-flow.
Trampa: solo 12 de ~40 estados tienen frase editable hoy; ampliar cobertura toca
los flows. MVP ~2 días. Pendiente de tu OK.
