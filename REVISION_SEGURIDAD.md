# Revisión de seguridad — bothHS 1.2 (ERP white-label)

Fecha: 2026-07-12 · Auditor: revisión defensiva autorizada del propio producto
Contexto de riesgo: panel de PYME en LAN/VPN (Electron sobre `127.0.0.1`, o Docker/Ubuntu detrás de reverse proxy). **No es un servicio en internet abierto.** Las severidades están calibradas a ese modelo de amenaza.

---

## Resumen ejecutivo — calificación por superficie

| Superficie | Nota | Comentario |
|---|---|---|
| Autenticación (login, scrypt, sesiones) | **B+** | Sesiones firmadas con HMAC de secreto local, lockout por usuario, rotación al re-login. Buen diseño. Falla: la advertencia de contraseña por defecto nunca dispara. |
| Cookies / headers HTTP | **B** | HttpOnly+SameSite=Lax+firma. `Secure` es opt-in y correcto para localhost; riesgo solo al exponer por HTTP plano. CSP con `unsafe-inline` innecesario en `script-src`. |
| Rate limiting / fuerza bruta | **B** | Login con doble candado (IP + username). **El PIN de autorización no tiene ningún límite de intentos.** |
| RBAC / auditor / PIN | **A-** | Jerarquía por rango, punto único de escritura bloqueado para auditor, techo de auditor bien pensado. Sólido. |
| Entradas (CFDI/XML, SQL, path) | **A-** | Guardas XXE/DoS presentes en CFDI. SQL 100% parametrizado incl. `IN(...)` dinámicos. Path traversal cerrado con whitelist regex + `startsWith`. |
| PII (logs, correos, dataset) | **A** | Redacción de teléfono centralizada y aplicada; asunto de correo sin nombre; dataset enmascarado. |
| Bot (rate/filtro/validación) | **B+** | Pipeline por capas correcto; validación rechaza grupos/broadcast/status/propios. |
| Frontend (XSS) | **B-** | React escapa por defecto en todos lados **menos** un `document.write` con datos del cliente sin escapar (Fiados). |

---

## Hallazgos (ordenados por severidad)

### ALTO

#### H1 — La advertencia de "contraseña por defecto" nunca se emite (default débil silencioso)
`dashboard/server.js:78` fija el default `DASH_PASS = 'cambiar_esto'` y siembra con él un usuario real `gerente` (`server.js:235`). Pero el chequeo que debería avisar en `bot/validators.js:26` compara contra **otra** cadena:
```js
if (!process.env.DASHBOARD_PASS || process.env.DASHBOARD_PASS === 'cambiar_esto_urgente')
```
`'cambiar_esto' !== 'cambiar_esto_urgente'` ⇒ **la advertencia jamás dispara** aunque el operador deje el default. Una instancia clonada sin tocar `.env` queda con `gerente / cambiar_esto` operativo y sin ningún aviso.
**Explotabilidad (LAN):** alta si el panel es alcanzable por otra máquina de la red y no se cambió la contraseña. Es la puerta grande.
**Fix (arreglar YA):** unificar la constante y avisar de verdad (o abortar). En `validators.js`:
```js
if (!process.env.DASHBOARD_PASS || /^cambiar_esto/.test(process.env.DASHBOARD_PASS))
    log.warn('⚠️  DASHBOARD_PASS usa valor por defecto inseguro — cámbialo antes de exponer el panel');
```
Idealmente, además, no sembrar el usuario semilla si la contraseña es el default (forzar onboarding).

---

### MEDIO

#### M1 — XSS almacenado en la "Constancia de adeudo" (Fiados)
`dashboard-ui/src/pages/Fiados.jsx:26-40` construye HTML con `window.open(...).document.write(...)` interpolando **datos del cliente sin escapar**:
```js
w.document.write(`... <strong>${f.nombre || '—'}</strong> ... <span>${f.telefono || '—'}</span> ...`);
```
`clientes.nombre` lo teclea el propio cliente por WhatsApp (flujo `ASK_NOMBRE`) y se guarda tal cual. Un cliente que ponga como nombre `<img src=x onerror=fetch('/api/...')>` logra que el script corra en la ventana de impresión del **operador**, mismo origen que el panel, con su cookie de sesión ⇒ acciones autenticadas / robo de sesión.
Es el **único** punto del frontend que no usa el escape automático de React (verificado: `Mostrador.jsx` y el resto renderizan con JSX escapado).
**Explotabilidad (LAN):** media — requiere que un operador imprima la constancia de un cliente malicioso, pero el atacante controla el input sin autenticarse (solo manda mensajes al bot).
**Fix:** escapar antes de interpolar, o construir el documento con nodos DOM en vez de `document.write`. Mínimo:
```js
const esc = s => String(s ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// ...usar ${esc(f.nombre)}, ${esc(f.telefono)}, ${esc(f.proximo_vence)}
```

#### M2 — El PIN de autorización no tiene límite de intentos (fuerza bruta)
`dashboard/autorizacion.js:25` (`validarPin`) compara con `timingSafeEqual` (bien) pero **no hay contador de intentos, ni bloqueo, ni backoff**. El PIN admite 4-12 caracteres (`setPin`, línea 13) y en la práctica los operadores usan 4 dígitos numéricos = 10 000 combinaciones. `exigirAutorizacion` se invoca por operación sensible (cancelar venta, salida de inventario, cambio de salario) sin ningún throttle.
A diferencia del login —que sí tiene doble candado (`server.js:129-155`)— aquí un rol especialista autenticado (cajero/almacén) puede probar PINs a la velocidad del rate-limit global de API (80 POST/min/IP), agotando 4 dígitos en horas.
**Explotabilidad (LAN):** media — exige una sesión válida de rol bajo; el escalamiento es de "cajero" a "puede autorizar operaciones de gerente".
**Fix:** reusar el mismo patrón de lockout del login, indexado por usuario. Bloquear 15 min tras 5 fallos en `exigirAutorizacion`/`validarPin`. Diff pequeño; el andamiaje ya existe en `server.js` (`_loginAttempts`), extraerlo a un helper compartido.

#### M3 — CSP permite `'unsafe-inline'` en `script-src` sin necesitarlo
`dashboard/server.js:386`:
```
"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
```
El build real (`dashboard-ui/dist/index.html`) **no tiene ningún `<script>` inline** — solo `<script type=module src=...>`. El `'unsafe-inline'` de `script-src` no lo exige nada hoy y anula buena parte de la protección anti-XSS de la CSP (relevante justo para M1). `style-src 'unsafe-inline'` sí es necesario: Mantine inyecta estilos inline en runtime.
**Fix (endurecer):** quitar `'unsafe-inline'` de `script-src` únicamente:
```
"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
```
Verificar en un build que la consola no reporte violaciones de CSP antes de fijarlo.

#### M4 — Cookie de sesión sin `Secure` viaja en claro si se expone por HTTP LAN
`dashboard/server.js:85` — `COOKIE_SECURE` es opt-in (`DASHBOARD_COOKIE_SECURE=true`). Es correcto para el caso Electron/`127.0.0.1`. Pero `server.js:685` permite `DASHBOARD_HOST=0.0.0.0` (documentado para Docker) y si ese despliegue queda detrás de un proxy **sin** TLS o accesible por LAN en HTTP plano, la cookie de sesión (equivalente a la contraseña) viaja sin cifrar y es interceptable en la red local.
**Explotabilidad:** baja hoy (localhost), media al momento de exponer a LAN/VPN sin HTTPS.
**Fix (endurecer al exponer):** cuando `DASHBOARD_HOST` no sea loopback, forzar `Secure` salvo override explícito, o ligarlo a `TRUST_PROXY=1`:
```js
const COOKIE_SECURE = process.env.DASHBOARD_COOKIE_SECURE === 'true'
    || (process.env.TRUST_PROXY === '1' && process.env.DASHBOARD_COOKIE_SECURE !== 'false');
```
Documentar que exponer el panel sin HTTPS no está soportado.

---

### BAJO

#### B1 — Parámetros scrypt por defecto para hash de contraseñas
`dashboard/server.js:215` y `autorizacion.js:15/30` usan `crypto.scryptSync(pass, salt, N)` con los **parámetros por defecto** (cost N=16384). Es aceptable, pero por debajo de la recomendación OWASP actual (N≥2^17). Salt de 16 bytes por usuario: correcto. No es urgente en modelo LAN.
**Fix (endurecer):** subir el costo cuando se agregue gestión de usuarios: `scryptSync(pass, salt, 64, { N: 2**16, r: 8, p: 1, maxmem: 128*1024*1024 })`. Requiere versionar el hash para migración progresiva.

#### B2 — Firma de token truncada a 96 bits
`dashboard/server.js:303` — `_firmar` corta el HMAC-SHA256 a 24 hex (96 bits). El token base ya son 32 bytes aleatorios (`server.js:313`) y la firma solo evita inyección/migración de filas de sesión, así que 96 bits es suficiente en la práctica. Se anota por completitud; no requiere acción.

#### B3 — `Access-Control-Allow-Origin` fijo a `http://localhost:PORT`
`dashboard/server.js:394` fija el origen a `localhost`. Correcto y restrictivo para el uso previsto. Nota operativa: al exponer por LAN/dominio, ese origen fijo romperá el acceso desde otra máquina (funcional, no de seguridad) — se resolverá con el reverse proxy same-origin, no ampliando CORS a `*`.

---

## Verificado y correcto (no requiere acción)

- **CFDI/XML (`services/cfdiService.js:19-32`):** guardas anti-XXE (`<!DOCTYPE|<!ENTITY` rechazado), tope 5 MB, tope 1000 conceptos anti-ReDoS. Parseo por regex de atributos, sin motor XML externo. Sólido.
- **SQL:** todos los `IN (...)` dinámicos (`mesas.js:29`, `tareas.js:22/34`) usan placeholders `?` generados por `.map(()=>'?')`; los `UPDATE`/`SELECT` con interpolación de tabla/columna (`server.js:466`, `primeCatalogo.js:277`) usan **whitelists** (`TABLAS_ACTUALIZABLES`, `pkInventarios()`). No hay concatenación de input de usuario en SQL.
- **Path traversal:** `etiquetas.js:85-87` (imágenes) valida contra `_RE_ARCHIVO` + `startsWith(IMG_DIR)`; `instancias.js:92` exige `path.basename(clave)`; `serveStatic` (`server.js:731`) valida `startsWith(DIST_DIR)`. Restauración de BD (`seguridadOperativa.js`) valida cabecera SQLite + `integrity_check` + revalida contraseña de prime. Cerrado.
- **RBAC auditor:** techo de solo-lectura en punto único (`server.js:657`) + ceiling GET hasta `gerente` (`server.js:370`). Bien diseñado, sin bypass evidente.
- **PII:** `bot/logger.js:46-58` redacta teléfonos en `msg`, `meta` y stacktraces; `emailService.js:317` mantiene el nombre fuera del asunto; `datasetExport.js:40` enmascara `521***1234`. Consistente.
- **CSRF:** `SameSite=Lax` + rechazo de `Content-Type` no-JSON (`server.js:586`) + CORS de origen fijo. Cobertura razonable para el modelo.

---

## Prioridad de acción

**Arreglar YA (cambios triviales, alto impacto):**
1. H1 — corregir la constante de advertencia de contraseña default (o abortar arranque con default).
2. M1 — escapar datos del cliente en `Fiados.jsx` (XSS almacenado real).
3. M2 — lockout de intentos en el PIN de autorización.

**Endurecer al exponer a internet/LAN (no urgente en Electron/localhost):**
4. M3 — quitar `'unsafe-inline'` de `script-src`.
5. M4 — forzar cookie `Secure` cuando `DASHBOARD_HOST` no sea loopback.
6. B1 — subir el costo de scrypt con esquema de hash versionado.
