# Revisión de seguridad V2 — bothHS 1.2 (Fase 5 + estado actual)

Fecha: 2026-07-12 · Auditor: revisión defensiva autorizada del propio producto
Modelo de amenaza (igual que V1): panel de PYME en LAN/VPN (Electron sobre `127.0.0.1`, o Docker/Ubuntu tras reverse proxy). **No es un servicio en internet abierto.** Severidades calibradas a ese modelo.

Alcance de esta pasada: superficie **nueva de Fase 5** (`_construirModulo`, suscripciones, documentos, baúl contable, conciliación, pasarela demo/real, fiado/abono, cancelar-venta, zip nativo, flota) + verificación de que los hallazgos de `REVISION_SEGURIDAD.md` (V1) siguen resueltos. **No repito** lo de V1 ni la brecha UI de `BRECHA_SEGURIDAD_PRIME.md` (backend ya bloquea).

## Estado de los hallazgos de V1 (verificado)

| V1 | Estado hoy | Evidencia |
|---|---|---|
| M1 — XSS constancia Fiados | **RESUELTO** | `Fiados.jsx:28` define `esc()` y lo aplica a nombre/teléfono/monto (L33-44). |
| M2 — PIN sin lockout | **RESUELTO** | `autorizacion.js:37-73` lockout por usuario (5 fallos, backoff 30s→5min, poda horaria). |
| H1, M3, M4, B1-B3 | fuera de alcance de esta pasada (superficie no-Fase-5); ver V1. | — |

---

## Hallazgos nuevos (ordenados por severidad)

### MEDIO

#### N1 — Inyección en header `Content-Disposition` vía parámetro `mes` (3 descargas fiscales)
`mes` llega crudo de la query y sólo se `.slice(0,7)` — **sin validar formato** — antes de interpolarse en el nombre de archivo del header de descarga:
- `dashboard/routes/erpContabilidad.js:353` → `filename="DIOT_${mes}.txt"` (`mes` de L330, sin regex)
- `dashboard/routes/erpContabilidad.js:415` → `filename="${tipo}_${mes}.xml"` (`mes` de L384, sin regex)
- `dashboard/routes/erpContabilidad.js:306` → `filename="${r.nombre}"`, donde `r.nombre = 'CFDI_'+m+'.zip'` y `m = String(mes).slice(0,7)` (`baulContable.js:52,67`), `mes` de L303 sin regex.

**Vector:** una sesión con área `finanzas` (contabilidad/gerente/prime) pide `?mes=a"x2025` → el header queda `Content-Disposition: attachment; filename="DIOT_a"x2025.txt"`, rompiendo el entrecomillado del header. Con `?mes=%0d%0a...` (CRLF, caben en 7 chars) se intentaría *response splitting*; Node moderno lanza `ERR_INVALID_CHAR` en `writeHead` y lo convierte en 500 (auto-DoS de esa request, no split real), pero el `"`/espacio/`;` **sí** pasan y manipulan el header. Comparar con `baulContable._slug` (L13), que sí sanea a `[A-Za-z0-9_-]` los nombres *dentro* del zip — el saneo existe pero no se aplicó al nombre del header.

**Explotabilidad (LAN):** baja-media (exige sesión finanzas; el impacto real es manipulación de header, no XSS ni RCE). Se sube a MEDIO por ser 3 rutas y la corrección trivial.

**Fix mínimo:** validar `mes` como `YYYY-MM` en las tres, reusar el mismo patrón que ya usa `conciliacionImportar` (`erpContabilidad.js:634`, `/^\d{4}-\d{2}-\d{2}$/`):
```js
const mes = /^\d{4}-\d{2}$/.test(sp.get('mes')||'') ? sp.get('mes') : new Date().toISOString().slice(0,7);
```
(en `baulContable.js` aplicar el mismo guard sobre `m` antes de armar `nombre`).

---

### BAJO

#### N2 — `plantillaPost` deja a un gerente editar la plantilla de CUALQUIER sucursal
`dashboard/routes/documentos.js:85` — el UPDATE de plantilla propia guarda sólo con `WHERE id=? AND sucursal IS NOT NULL`, **sin** `AND sucursal=?`. La ruta es `roles:['gerente']` (L154), así que cualquier gerente/prime puede sobreescribir el cuerpo de la plantilla de otra sucursal (los pagarés/contratos que esa sucursal imprime).
**Explotabilidad:** baja — gerente es rol de confianza organizacional; no cruza frontera de privilegio, sólo aislamiento entre sucursales. No hay XSS: el cuerpo se imprime con `esc()` (`Documentos.jsx:34-36`).
**Fix (endurecer):** añadir `AND (sucursal = ? OR sucursal IS NULL=0)` con la sucursal de la sesión, o bloquear edición si `pl.sucursal !== sucursalDeSesion`. No urgente.

#### N3 — `documentoPost` puede referenciar la plantilla privada de otra sucursal
`dashboard/routes/documentos.js:116` selecciona la plantilla por `id_plantilla` sin filtrar por sucursal (a diferencia del GET L71-73 que sí lista sólo NULL + la propia). Un rol con área `operacion` en la sucursal A puede emitir un documento usando el cuerpo de una plantilla privada de la sucursal B si adivina/enumera su `id`.
**Explotabilidad:** muy baja — las plantillas no son secretas (son formatos de pagaré/contrato), y el `id` es un entero enumerable pero sin valor sensible. Fuga de aislamiento, no de datos sensibles.
**Fix (endurecer):** en L116 filtrar `WHERE id=? AND (sucursal IS NULL OR sucursal=?)`.

---

## Sólido (verificado seguro)

- **`_construirModulo` — gate por dato, auditable en un punto** (`dashboard/routes/_construirModulo.js:73-105`): `roles` → `requireSession(roles)` (rango mínimo); `area`/`areas` → `requireSession` + `permite(rol, area)`; `pin:true` → el tronco lee el body, valida `exigirAutorizacion` **y** deja bitácora forzada (`_auditarPin`) *antes* del handler, y blinda el callback async de `readBody` con su propio try/catch (comentario L96-100, correcto: ese path escapa al try/catch síncrono de `server.js`). Barrido: **todas** las rutas nuevas declaran `area`/`roles`/`pin` salvo `flota` (por diseño). `cancelar-venta` usa `pin:true` (`pos.js:438`). Sin ruta huérfana.
- **Secretos at-rest (pasarela/PAC)** (`gatewayService.js:24-32`, `pacService.js:23-31`): AES-256-GCM (`cryptoBackup.js:31-44`, IV+tag+cipher, `d.final()` valida el tag) con clave derivada del `.instancia_secret` (32 bytes aleatorios, `mode:0o600`). El GET **nunca** devuelve la key: `primeConfig.js:379` (`tiene_api_key: !!...`) y `:329-334` (`tiene_password`/`tiene_csd_*` sólo booleanos). Escritura de secretos: `prime`-only (`primeConfig.js:541-544`). Ninguna key aparece en logs (los `logCambio` registran proveedor/ambiente, no la key: `primeConfig.js:398`). Cifrado **fail-closed y tolerante** (prefijo `enc:`, convive claro/cifrado).
- **Zip nativo** (`zipService.js`): modo STORE, sólo empaqueta buffers ya en memoria; los nombres de entrada vienen de `baulContable._slug` → `[A-Za-z0-9_-]` (`baulContable.js:13,58,63`). No hay zip-slip (no se extrae nada) ni nombres controlables por el cliente.
- **Baúl → escritura a disco** (`baulContable.js:24-30,62`): la ruta se arma con `_dirMes(mes.slice(0,7))` (bajo `contabilidad/cfdi/`) + `_slug(folio)_ _slug(uuid).xml` — folio/uuid saneados a `[A-Za-z0-9_-]`. Sin path traversal en el nombre. (El único crudo es el nombre del *header* de descarga → N1.)
- **SQL 100% parametrizado** en la superficie nueva: suscripciones, documentos, conciliación (`conciliacionImportar` valida `fecha` con regex y castea montos, L633-634), fiado/abono. Los `match_tipo` usan whitelist (`erpContabilidad.js:686`). Sin concatenación de input.
- **Flota (máquina-a-máquina)** (`flota.js:21-29`): 404 si no hay token configurado (apagado por defecto), token dedicado (`configuracion.flota_token`/`FLOTA_TOKEN`), comparado con `timingSafeEqual` **precedido de check de longitud** (evita el throw de `timingSafeEqual` con buffers de distinto tamaño). Solo-lectura, sin PII de clientes. Registrado como ruta pública en `server.js:656` correctamente (sólo GET, sólo esa ruta).
- **CSRF/headers**: `rejectCrossSiteForm` (`server.js:589-597`) rechaza cualquier `Content-Type` no-`application/json` en POST/PUT/DELETE — un `<form>` cross-site no puede fijarlo; combinado con CORS de origen fijo (`server.js:599,624`, sin `*`) y `SameSite=Lax`, cobertura razonable para el modelo LAN.
- **PIN lockout** (`autorizacion.js`): resuelto (ver tabla V1).
- **Impresibles (XSS)**: los tres builders de HTML escapan input del cliente antes de interpolar — `Fiados.jsx:28`, `Documentos.jsx` (usa `esc` en `<title>`/`<body>` L34-36), `reporteImprimible.js:8` (`esc` en th/td/totales/título). El `esc` de reportes/Documentos escapa `& < >` (suficiente: todas las interpolaciones son contexto de texto, no de atributo con comillas). No hay `innerHTML`/`dangerouslySetInnerHTML` en toda la SPA.
- **Modo demo pasarela**: `pago_demo` lo fija sólo `prime` (`primeConfig.js:544`); `linkDemo` (`gatewayService.js:45-47`) devuelve una URL plausible sin llamar red ni cobrar; la confirmación real sigue pasando por el único chokepoint `marcar-pagado`. Sin abuso más allá de ingeniería social que ya exige acceso al panel.
- **DoS**: `capBodySize` 1 MB (`server.js:571`), rate-limit por IP 80 POST/600 GET por minuto (`server.js:635`), conciliación castea/valida cada movimiento. `numeroALetras`/`render` de documentos operan sobre input acotado.

---

## Prioridad de acción

**Arreglar (trivial):**
1. N1 — validar `mes` como `YYYY-MM` en las 3 descargas fiscales (`erpContabilidad.js:330,384` + `baulContable.js`). Una línea cada una.

**Endurecer (aislamiento entre sucursales, no cruza privilegio):**
2. N2 / N3 — filtrar plantillas de documento por sucursal de la sesión (`documentos.js:85,116`).

Superficie de Fase 5, en conjunto: **sólida**. El tronco `_construirModulo` centraliza el gate/PIN/auditoría de forma auditable y ninguna ruta nueva quedó sin candado. Los secretos de pasarela/PAC están bien cifrados y no se filtran. El único hallazgo con corrección obligatoria (N1) es de bajo impacto real por el guard CRLF de Node y el gate `finanzas`.
