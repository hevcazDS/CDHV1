# Viabilidad: este ERP como VARIAS instancias en LAN/remoto + intercomunicación

Evaluación sobre código real (no memoria). Fecha: 2026-07-12. Rama `feat/ola2-tareas-poliza`.

**Resumen en una línea:** los 3 escenarios de *despliegue* (LAN, multi-instancia, remoto) son **viables hoy con configuración, casi cero código** — la arquitectura ya trae los interruptores. La **intercomunicación entre instancias no existe** y es el único trabajo real; la recomendación es un **hub de solo-lectura por pull** (status.json + agregador), no un bus bidireccional.

---

## A) Veredicto por escenario

### 1. Una instancia, varios usuarios en LAN (2–10 cajas/tablets) — 🟡 viable con config, un ajuste real

Lo que el prompt asumía "falta" **ya está**:

- **Bind configurable**: `server.listen(PORT, process.env.DASHBOARD_HOST || '127.0.0.1', ...)` — `dashboard/server.js:685`. Para LAN: `DASHBOARD_HOST=0.0.0.0`. Ya documentado en el comentario `:676-677`.
- **Cookie Secure conmutable**: `COOKIE_SECURE = process.env.DASHBOARD_COOKIE_SECURE === 'true'` (`server.js:85-86`), aplicada en `core.js:48`. En LAN por HTTP plano se deja en `false` (correcto — con `Secure` la cookie no viajaría sin TLS).
- **Rate-limit por IP**: `rateLimit()` `server.js:97-117`, con topes generosos para SPA (600 GET / 80 POST por min, `:632`). Aguanta varias cajas.
- **Lockout por usuario** independiente de IP (`server.js:129-155`): 5 intentos/15 min. Bien para caja compartida.
- **Sesiones firmadas HMAC** con secreto por instancia (`server.js:302-336`) — una cookie no se puede forjar ni migrar entre tiendas.

**Lo que SÍ falta / hay que tocar:**

- **CSP con `'unsafe-inline'`** en script-src (`server.js:386`). No rompe LAN, pero degrada la protección XSS. En LAN cerrada es tolerable; anótalo para remoto (§3).
- **CORS/Origin hardcodeado a `http://localhost:PORT`** (`server.js:394`, `:596`, `:621`). El `Access-Control-Allow-Origin` fijo a `localhost` es inofensivo para same-origin (las tablets cargan la SPA del mismo host:puerto, no hay cross-origin), pero **el guard anti-CSRF (`rejectCrossSiteForm`, `server.js:586-594`) solo valida content-type, NO valida `Origin`**. La defensa real contra CSRF es la cookie `SameSite=Lax` (`core.js:48`) — suficiente para navegador moderno, pero es la única capa. Aceptable; no bloqueante.

**SQLite WAL con 5–10 escritores concurrentes — 🟡 aguanta con matices.**
- WAL permite N lectores + **1 escritor a la vez**; los escritores se **serializan**, no corren en paralelo. `busy_timeout=5000` (`db_connection.js:64`) hace que un segundo escritor **espere hasta 5 s** en vez de fallar con `SQLITE_BUSY`.
- Para un ERP pyme (cajas registrando ventas, no un e-commerce de miles de tx/s) esto es **holgado**: cada venta es una transacción de milisegundos vía `better-sqlite3` (síncrono, rápido). 5–10 cajas humanas ≈ decenas de escrituras/min, no de escrituras/s. Colisión real de 5 s solo si dos cierres de caja / entradas de mercancía masivas coinciden al segundo.
- **Riesgo concreto**: el proceso es **síncrono monohilo** — una consulta pesada (reporte, corte, `entrada-mercancia` grande) bloquea el event-loop y con él a todas las cajas mientras dura. Mitigación en §C.

**Veredicto 1:** 🟡 — cero código nuevo, solo `.env` (`DASHBOARD_HOST=0.0.0.0`). Endurecer CSP y validar `Origin` si sales de la LAN.

---

### 2. Varias instancias en un servidor/LAN (N negocios) — 🟡 viable, pero el selector de instancias ESTORBA

- **Modelo instancia-por-proceso**: cada negocio = su carpeta + su `.db` + sus dos procesos pm2 + su `DASHBOARD_PORT`. Levantar N negocios = N pares de procesos en puertos distintos + un reverse proxy (Caddy) por subdominio. `TRUST_PROXY=1` ya está soportado (`server.js:100`) para leer la IP real detrás del proxy. **Esto funciona hoy.**

- **El selector de instancias (`instancias.js`) es para OTRA cosa y no debe usarse aquí.** Su diseño es "una sola instancia que *cambia* de qué tienda sirve reescribiendo `.instancia_activa` + `process.exit(0)` y dejando que pm2 la reviva" (`instancias.js:79-108`, `db_connection.js:11-32`). Es decir: **un proceso sirve UNA tienda a la vez**; cambiar de tienda **tumba el proceso ~4 s** y reinicia también el bot (`_reiniciarBotSiCorre`, `:24-36`). Rate-limitado a 1 cambio/min (`:85-87`).
  - Para "N negocios simultáneos" esto es exactamente lo **contrario** de lo que quieres: NO sirve dos tiendas a la vez, y usarlo para saltar entre tiendas del mismo servidor daría cortes de servicio.
  - **Es compatible en el sentido de que no estorba si lo ignoras**: para multi-instancia real, cada negocio corre su propio par de procesos con su `DB_PATH` fijo en su `.env` y **sin** `.instancia_activa`. El selector queda como lo que es: una demo/conmutador para un operador que revisa varias tiendas desde *una* instalación, no producción concurrente.

**Veredicto 2:** 🟡 — viable con N pares de procesos + Caddy (patrón estándar, boring). El selector de instancias es ortogonal: no lo uses como mecanismo de hosting concurrente. Único costo: `ecosystem.config.js` por negocio + un `Caddyfile` con un bloque por subdominio.

---

### 3. Acceso remoto (internet / VPN) — 🟡 viable tras endurecer 4 cosas

Antes de exponer a internet:

1. **TLS obligatorio** → Caddy delante (HTTPS automático Let's Encrypt), `DASHBOARD_HOST=127.0.0.1` (solo Caddy habla con el Node), `TRUST_PROXY=1`. Boring, cero código.
2. **`DASHBOARD_COOKIE_SECURE=true`** (`server.js:85`) — ya soportado, solo el flag.
3. **CSP sin `'unsafe-inline'`** (`server.js:386`). Requiere que la SPA no use scripts/estilos inline; Vite puede emitir hashes o nonces. **Esto sí es trabajo** (build + posible refactor de estilos inline). En VPN se puede diferir; expuesto a internet es recomendable.
4. **Validar header `Origin` en POST/PUT/DELETE** dentro de `rejectCrossSiteForm` (`server.js:586`) — hoy solo mira content-type. `SameSite=Lax` cubre el caso común, pero una capa de defensa-en-profundidad barata (comparar `req.headers.origin` contra el host esperado) cierra el hueco. ~10 líneas.

**VPN vs exponer directo para pyme — recomendación: VPN (Tailscale/WireGuard).**
- Para 2–10 empleados de una pyme, **Tailscale** es la respuesta correcta: cero puertos abiertos a internet, cero superficie de ataque pública, identidad por dispositivo, y el ERP sigue creyendo que está en "LAN" (`DASHBOARD_HOST` a la IP de tailscale, HTTP plano interno o TLS de tailscale). Elimina de un plumazo los puntos 3 y 4 como *bloqueantes* (siguen siendo buena higiene).
- Exponer directo con Caddy+HTTPS solo tiene sentido si necesitas acceso desde dispositivos que **no puedes** meter a la VPN (clientes externos, integraciones). Para uso interno pyme, no vale la superficie de ataque.

**Veredicto 3:** 🟡 — VPN (Tailscale) hace el escenario **✅ casi sin trabajo**. Exposición directa exige los 4 endurecimientos, de los cuales solo CSP es esfuerzo no trivial.

---

### 4. Intercomunicación entre instancias — ❌ no existe hoy / 🟡 viable con diseño mínimo

**Estado actual: no hay NINGÚN mecanismo instancia-a-instancia.** Grep confirma: ningún `http.request`/`fetch` saliente hacia otra instancia, ningún agregador de flota, ningún `status.json` publicado. La "campana agregadora" de los commits agrega *notificaciones dentro de una instancia*, no entre instancias. `cola_notificaciones` es un bus **intra-instancia** (bot ↔ dashboard sobre el mismo `.db`), no cruza el límite del proceso/BD.

Casos pedidos y mecanismo recomendado (todos respetan "boring tech"):

| Caso | Mecanismo recomendado | Esfuerzo | Riesgo | ¿Boring? |
|---|---|---|---|---|
| **Panel de flota Hevcaz (ver N clientes)** | **Pull agregador**: cada instancia publica `GET /api/flota/status` (token) con KPIs del día; un agregador central hace polling y los muestra. Solo-lectura. | **Bajo** | Bajo | ✅ Sí (HTTP+JSON, ya tienes el server) |
| **Consolidado multi-tienda del mismo dueño** | Igual: el "dueño" corre un agregador que pollea sus N instancias por el mismo `GET /api/flota/status`. Sin BD central. | **Bajo** | Bajo | ✅ |
| **Proveedor que ES otra instancia** | **REST con token**: instancia-A consulta `GET /api/catalogo-publico` de instancia-B; crear pedido = `POST /api/pedido-b2b` idempotente (Idempotency-Key). | **Medio** | Medio (auth, idempotencia) | ✅ |
| **Transferencia de inventario A↔B** | **REST con token + confirmación en dos pasos** sobre lo anterior: A descuenta reservando, B confirma recepción vía webhook/pull. NO sync automático de stock. | **Alto** | **Alto** (conflictos, doble descuento) | 🟡 posible pero es el más delicado |

**Mecanismos evaluados y descartados:**
- **Cola compartida (un `.db` compartido entre instancias)** — ❌. Rompe el modelo instancia-por-tenant, WAL sobre red (NFS/SMB) es notoriamente frágil y corrompe. No.
- **Webhooks bidireccionales full** — 🟡 innecesario para el 80% de casos; requiere que cada instancia sea alcanzable (retries, colas de reintento, verificación de firma). Solo para transferencia de inventario en tiempo real, que es el caso que menos vale la pena.
- **Hub central de solo-lectura** — ✅ es la recomendación (ver §B). Es un agregador *pull*, no una BD compartida ni un microservicio con estado.

**Veredicto 4:** ❌ hoy no existe → 🟡 viable. El 80% del valor (flota + consolidado) se logra con **pull agregador de solo-lectura**, esfuerzo bajo, reusando el HTTP server que ya tienes. El B2B/transferencia de stock es el 20% caro y arriesgado: diferir.

---

## B) Recomendación de intercomunicación + diseño mínimo viable

**Recomendación: hub agregador por PULL, solo-lectura. NO bus, NO BD central, NO webhooks (todavía).**

Por qué pull y no push: cada instancia pyme está detrás de NAT/CGNAT sin IP fija; que el hub las *alcance* es un lío operativo. Que cada instancia sea *alcanzada por pull desde el hub* solo requiere que el hub tenga IP estable (o esté en la misma VPN Tailscale, que resuelve el NAT gratis). En VPN, pull y push son equivalentes en dificultad → pull gana por ser stateless.

**Diseño mínimo, reusando lo existente:**

1. **En cada instancia — un endpoint nuevo de solo-lectura** (una ruta más en el patrón `construirModulo` que ya usan `instancias.js`/`etiquetas.js`):
   ```
   GET /api/flota/status
   Auth: header  X-Flota-Token: <token>   (comparado con timingSafeEqual contra
                                            configuracion.flota_token o env FLOTA_TOKEN)
   → { negocio, giro, ventas_hoy, pedidos_pendientes, stock_bajo, bot_online, ts }
   ```
   - Los datos ya se calculan: `GET /api/stats` (`routes/core.js`) ya tiene `ventas_hoy`/`pedidos_pagados_hoy`. Es un subconjunto, sin sesión, gateado por token dedicado. ~40 líneas.
   - El token vive en `.instancia_secret`-style (archivo local) o `configuracion`. Reusa el patrón HMAC/`timingSafeEqual` que ya está en `server.js:327`.

2. **El hub Hevcaz = una instancia más (o un script) que pollea** la lista de `{url, token}` de sus clientes cada 30–60 s y cachea el último `status`. UI: una página nueva tipo `Inicio` que lista tarjetas por cliente. Reusa React Query (ya polea `/api/bot/status`).

3. **Transporte**: sobre **Tailscale** entre hub e instancias → sin TLS público, sin puertos abiertos, sin CSP pública. El token es defensa-en-profundidad, no la única capa.

Esto respeta "boring": es HTTP+JSON+polling con el server nativo que ya tienes, sin Postgres, sin cola de mensajes, sin microservicios, sin K8s. El agregador es **stateless** (solo cachea en memoria el último pull); si se cae, al reiniciar re-pollea.

**Para el B2B/proveedor (fase posterior):** el MISMO endpoint pattern, pero `GET /api/catalogo-publico` (lectura) + `POST /api/pedido-b2b` con `Idempotency-Key` (escritura idempotente, valida token de socio, encola en `cola_notificaciones` de B). La transferencia de inventario A↔B se construye ENCIMA de esto con reserva+confirmación — pero solo si un cliente real lo pide (YAGNI hasta entonces).

---

## C) Riesgos y mitigación pyme

| Riesgo | Severidad | Mitigación pyme (boring) |
|---|---|---|
| **WAL: escritor lento bloquea el event-loop** (proceso síncrono monohilo) | Media | Reportes/cortes/exportes pesados ya tienden a ser puntuales. Mantén las transacciones cortas; si un reporte tarda, muévelo a un `worker_threads`/proceso forked (como ya hace `stockWatcher.worker.js`). No cambies de motor por esto. |
| **`SQLITE_BUSY` con 5–10 cajas** | Baja | `busy_timeout=5000` ya está. Si aparece bajo carga real, subir a 10 s. Solo pasar a Postgres si mides >20–30 escritores concurrentes sostenidos — **improbable en pyme; costo: reescribir toda la capa de datos + operar un servidor Postgres. No hacerlo especulativamente.** |
| **Corrupción de `.db` sobre red compartida** | Alta si ocurre | **Nunca** poner el `.db` en NFS/SMB/carpeta compartida. Un `.db` = una máquina. La intercomunicación es por HTTP, no por archivo compartido. Ya hay backup cifrado por instancia. |
| **Exposición a internet (cookie, CSP, CSRF)** | Media | Tailscale elimina la superficie. Si expones: `COOKIE_SECURE=true` + Caddy TLS + CSP sin unsafe-inline + validar `Origin`. |
| **Selector de instancias usado como hosting concurrente** | Media (auto-inflingido) | No usarlo para multi-negocio simultáneo. Cada negocio = su `.env` con `DB_PATH` fijo, sin `.instancia_activa`. |
| **Sync/conflictos en transferencia de inventario** | Alta | Diferir el caso. Cuando llegue: descuento reservado en A + confirmación explícita en B, idempotencia por `Idempotency-Key`, sin auto-sync de stock. Es la única pieza donde un microservicio de reconciliación *podría* justificarse — pero no antes de tener el caso de uso pagado. |

---

## D) Plan por fases (esfuerzo)

**Fase 0 — LAN interna (horas).** `DASHBOARD_HOST=0.0.0.0` en `.env`. Cajas/tablets entran por `http://<ip-lan>:3001`. Probar concurrencia real de cierres de caja. Sin código.

**Fase 1 — Multi-instancia en un servidor (0.5–1 día).** Un `ecosystem.config.js` + `.env` por negocio (puerto distinto), un `Caddyfile` con un bloque por subdominio, `TRUST_PROXY=1`. No tocar el selector de instancias. Sin código de app.

**Fase 2 — Acceso remoto seguro (0.5–2 días).**
- Ruta VPN: instalar Tailscale en servidor y dispositivos, `DASHBOARD_HOST` a la IP tailscale. **~horas, cero código.**
- Ruta expuesta: Caddy TLS + `COOKIE_SECURE=true` + validar `Origin` (~10 líneas, `server.js:586`) + CSP sin unsafe-inline (build/refactor, ~1 día). Solo si necesitas acceso externo real.

**Fase 3 — Hub de flota / consolidado (2–4 días).** `GET /api/flota/status` con token en cada instancia (~40 líneas, patrón `construirModulo`). Agregador que pollea + página React de tarjetas. Sobre Tailscale. Es el 80% del valor de "intercomunicación".

**Fase 4 (bajo demanda, NO especular) — B2B proveedor (1–2 semanas).** `GET /api/catalogo-publico` + `POST /api/pedido-b2b` idempotente, token de socio, encola en `cola_notificaciones`. Solo cuando exista un cliente real con el caso.

**Fase 5 (evitar salvo obligación) — transferencia de inventario A↔B en tiempo real.** Reserva+confirmación sobre Fase 4. Alto riesgo de conflictos. Es el único punto donde un componente central de reconciliación podría justificarse; **costo: semanas + operar un servicio con estado. No construir sin caso pagado.**

---

### Conclusión

- **Despliegue (LAN / multi-instancia / remoto): ✅ viable ya**, es configuración + Caddy/Tailscale, no reingeniería. Los interruptores (`DASHBOARD_HOST`, `COOKIE_SECURE`, `TRUST_PROXY`) ya están en el código.
- **Intercomunicación: ❌ inexistente hoy → 🟡 fácil para lo que importa.** Hub *pull* de solo-lectura sobre HTTP+token+Tailscale cubre flota y consolidado con esfuerzo bajo y sin traicionar el stack. B2B y transferencia de stock son caros/arriesgados: constrúyelos solo cuando alguien los pague.
- **No se recomienda Postgres/microservicios/K8s.** SQLite WAL aguanta la carga pyme; el modelo instancia-por-tenant *es* la simplicidad que hace todo esto barato. Cambiar de motor sería resolver un problema que no tienes.
