# Auditoría del proyecto — Fase JIUA 1, 2 y 3 + proceso "loop"

Estado: **Fase JIUA 1, 2 y 3 completadas e implementadas**. Este
documento es el cierre formal de las tres fases: qué se hizo, qué se confirmó
como sano (puntos positivos), y qué pendientes/oportunidades surgieron
durante la auditoría para alimentar la siguiente fase. La sección 5 cubre
el cierre de Fase JIUA 2, la sección 9 el cierre de Fase JIUA 3, y la
sección 11 formaliza **"loop"**: el proceso recurrente fix → escalar →
desplegar → re-auditar que generó las fases 2, 3 y ahora 4.

## 1. Implementado en Fase JIUA 1

### 1.1 Redacción de teléfonos en logs (`bot/logger.js`)
Antes solo se redactaba el teléfono cuando venía en `meta.userId`. Un número
suelto dentro del mensaje libre (`msg`), de otros campos de `meta`, o de un
`Error.stack`, se escribía sin filtrar tanto en consola como en
`bot/logs/bot.log`. Se agregó `_redactarTelefonos()` y se aplicó a `msg`,
`meta` (excepto `userId`, que ya tenía su propio formato) y a `stack` de
errores. Verificado con prueba en vivo: un teléfono suelto en texto libre
ahora sale como `521***7777`; códigos de caso (`CASO-20260619-001`) no se
ven afectados.

### 1.2 Señal de abandono sin carrito (`bot/sessionManager.js`)
La única señal de "abandono" existente requería que la sesión tuviera un
carrito no vacío al expirar (`carritos_abandonados`). Un cliente que buscó
un producto, obtuvo 0 resultados y se fue sin llegar a armar carrito era
invisible para cualquier métrica de abandono. Se agregó una rama nueva en el
ciclo de limpieza de sesiones: si al expirar la sesión no hay carrito pero
la última búsqueda registrada (`log_eventos`, `tipo_evento='busqueda'`) tuvo
`resultados=0`, se inserta un evento `busqueda_abandonada` (mismo
`log_eventos`, sin tocar esquema). Es idempotente (no duplica si el ciclo
corre dos veces sobre la misma búsqueda). Verificado con 4 escenarios sobre
una base de datos real desechable: sin carrito + 0 resultados → marca;
sin carrito + resultados>0 → no marca; con carrito → sigue el camino de
`carritos_abandonados` como antes; repetir el ciclo → no duplica.

### 1.3 Cobertura de pruebas para casos límite (`tests/test_bot.js`)
- Se documentaron 3 casos de error ortográfico real (no leetspeak) que
  `quejaCheck` **no** detecta hoy (`'no llgo mi pedido'`, `'es una estfa'`,
  `'kiero q me regresen mi dinero'`), como gap conocido en vez de asumir que
  ya está cubierto — alimenta la Fase JIUA 2/3 (NLP/fuzzy matching).
- Se agregó una suite nueva completa para `esFrustracion()` (0 pruebas antes
  pese a estar exportada): 8 casos que deben detectarse, 6 que no deben, y
  un caso explícito documentando que `'bueno'` solo dispara falso positivo
  (ver hallazgo 2.1 abajo).
- Resultado: de 95/95 a **113/113 pruebas pasando**, sin regresiones.

### 1.4 CI mínimo (`.github/workflows/test.yml`)
El repo no tenía ningún pipeline de CI. Se agregó un workflow mínimo que
corre `npm ci` + `npm run test:bot` en cada push/PR a cualquier rama.
Deliberadamente **no** incluye `test:db` ni los demás tests que requieren
una base de datos real sembrada (`test_full_bot.js`, `test_db_flujo.js`,
`tests/sql/*.sql`) — correrían en rojo de forma permanente en CI sin un
`Base de datos demo/jugueteria.db` real, que no existe en el checkout (está
en `.gitignore` a propósito). Esto es justo lo que ya documenta `CLAUDE.md`.

## 2. Puntos positivos revisados (no se tocaron, confirmados sanos)

1. **Cobertura de Zod en validadores** (`bot/validators.js`) — sigue
   cubriendo los POST del dashboard y `validarMensajeWhatsApp`; no hay rutas
   nuevas sin esquema. Sin cambios necesarios.
2. **Prepared statements en todo el acceso a SQLite** — confirmado que las
   consultas nuevas de este sprint (`sessionManager.js`) siguen el mismo
   patrón `db.prepare(...).run/get(...)`, sin concatenación de SQL.
3. **Esquema aditivo (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD
   COLUMN`)** — el cambio de 1.2 reutilizó una columna `TEXT` existente
   (`log_eventos.tipo_evento`) en vez de añadir esquema nuevo; cero riesgo
   de migración.
4. **Separación de roles `admin`/`prime` vía `requireSession`** — revisado,
   sigue siendo el único gate; no se encontraron rutas `/api/prime/*` sin
   el segundo `requireSession(req, res, ['prime'])`.
5. **`migraciones_pendientes/` como patrón "verificar → migrar"** — se
   confirmó (leyendo `README.md` + comentarios inline en `db/schema.sql`,
   p. ej. `-- migraciones_pendientes/0017`, `/0022`) que es un patrón
   deliberado y bien documentado, no una carencia de herramienta tipo
   Knex/Prisma. **Pendiente real**: casi todo el contenido de esa carpeta ya
   está reflejado en `db/schema.sql`, pero confirmar eso contra la base de
   datos de producción real y borrar la carpeta (como pide su propio
   README) requiere acceso a esa base, que no existe en este sandbox. Queda
   como acción manual para quien tenga esa base — no se puede cerrar desde
   aquí.
6. **Caché de configuración de 60s (`bot/flows/_config.js`)** — sigue
   siendo coherente con "sin reiniciar el bot". Se nota como tensión a
   futuro si Fase JIUA 2/3 agrega A/B testing de tono (la caché de 60s
   sería suficientemente rápida, pero el diseño de "una sola config activa"
   no soporta variantes simultáneas) — no requiere cambio de código hoy.
7. **Índices únicos que permiten NULL** — revisado, sigue siendo seguro
   para los casos actuales (p. ej. `codigo_referido` puede ser NULL antes
   del backfill perezoso sin violar unicidad). Sin cambios.
8. **Guardrail de "gratis" solo para envío** (`bot/flows/_config.js`) — se
   confirma vigente vía `t()`/tono. Riesgo a futuro si se introduce un LLM
   libre en vez de plantillas fijas (un modelo generativo podría usar
   "gratis" para precio de producto sin que este guardrail lo detecte) —
   queda anotado para cuando exista esa pieza, no aplica hoy porque el bot
   no genera texto libre.

## 3. Hallazgos / pendientes para Fase JIUA 2 (surgidos durante esta auditoría)

- **`'bueno'` y `'oye'` en `_FRUSTRATION_WORDS`** (`bot/index.js:127`) son
  muletillas neutras muy comunes en español mexicano y disparan
  `esFrustracion()` por sí solas como falso positivo real (confirmado con
  prueba: `'bueno, ¿tienen envíos?'` → `true`). No se removieron en Fase 1
  porque cambiar esa lista decide qué conversaciones se enrutan a un humano
  en producción — es una decisión de negocio, no solo de código. Acción
  para Fase JIUA 2: decidir si se quitan esas dos palabras de la lista o se
  exige combinarlas con otra señal.
- **Errores ortográficos reales no detectados por `quejaCheck`** (ver 1.3) —
  hoy solo se corrigen acentos/leetspeak, no typos genuinos. Requiere
  fuzzy-matching o normalización más agresiva; queda para Fase JIUA 2/3
  junto con el resto de mejoras de NLP.
- **Migración de `console.*` a `bot/logger.js` está lejos de completarse**:
  solo `bot/index.js` usa el logger estructurado; quedan **99 llamadas**
  `console.log/warn/error` repartidas en `bot/`, `services/` y
  `dashboard/` que no pasan por la redacción de teléfonos ni por niveles
  configurables. Es un cambio de alcance amplio (muchos archivos) — se
  descartó para Fase 1 por riesgo de tocar demasiados módulos a la vez;
  se propone para Fase JIUA 2 migrarlo módulo por módulo, empezando por
  `services/` (donde hay teléfonos de clientes en mensajes de error de
  email/SMTP) antes que `dashboard/`.
- **HTTPS / cookie `Secure`** (`dashboard/server.js`): el servidor escucha
  en `127.0.0.1` explícitamente (`server.listen(PORT, '127.0.0.1', ...)`),
  no expuesto a la red por defecto, y la cookie de sesión es
  `HttpOnly; SameSite=Lax` pero no `Secure`. Si el uso real es siempre
  "una máquina por tienda vía Electron" esto es bajo riesgo tal cual está;
  si en algún punto el dashboard se expone a más de una estación de trabajo
  en la misma red (LAN), se necesitaría TLS + `Secure` en la cookie. No se
  cambió en Fase 1 porque depende de cómo se despliega realmente cada
  tienda — queda como decisión a tomar antes de planear Fase JIUA 2 para
  este punto específico.

## 4. Cierre de los 3 hallazgos de Fase JIUA 1

Los tres pendientes que cerraba la sección 3 quedaron resueltos en Fase
JIUA 2 (detalle completo en la sección 5):

- `'bueno'`/`'oye'` — se decidió no quitarlos de `_FRUSTRATION_WORDS`, sino
  exigir que vengan acompañados de puntuación de urgencia repetida
  (`!!`, `??`, `¡¡`, `¿¿`) para contar como frustración. Conserva la señal
  útil sin el falso positivo de la muletilla neutra sola.
- Migración de `console.*` → `bot/logger.js` — completada en `bot/`,
  `services/` y `dashboard/` (las únicas 3 carpetas con procesos de
  producción de larga duración).
- HTTPS / cookie `Secure` — se resolvió con una bandera de entorno opcional
  (`DASHBOARD_COOKIE_SECURE`) en vez de forzar un cambio de protocolo; el
  default (`false`) preserva el comportamiento actual de "una máquina por
  tienda vía Electron en `127.0.0.1`".

## 5. Implementado en Fase JIUA 2

### 5.1 Frustración: `'bueno'`/`'oye'` ya no disparan solos (`bot/index.js`)
Antes cualquier mensaje con la palabra suelta `'bueno'` u `'oye'` se
marcaba como cliente frustrado (falso positivo confirmado en Fase 1). Se
separó esa lista en `_FRUSTRATION_WORDS` (dispara sola, sin cambios) y
`_FRUSTRATION_WORDS_WEAK` (`bot/index.js:137`), que solo cuenta si además
el texto tiene puntuación de urgencia repetida (`_URGENCIA_RE =
/[!?¡¿]{2,}/`, línea 138). `"bueno, ¿tienen envíos?"` ya no escala a un
asesor; `"oye!! llevo media hora esperando"` sigue escalando. Casos nuevos
agregados a `tests/test_bot.js` para ambos lados (detecta/ignora);
el test puntual que documentaba el hallazgo como pendiente se reemplazó
por estos casos reales — **116/116 pruebas pasan**.

### 5.2 Cookie de sesión `Secure` opt-in (`dashboard/server.js`, `.env.example`)
Se agregó `DASHBOARD_COOKIE_SECURE` (default `false`, preserva el
comportamiento actual sobre `127.0.0.1`/Electron). Si una tienda expone el
dashboard detrás de HTTPS real (reverse proxy o LAN con varias estaciones),
basta con `DASHBOARD_COOKIE_SECURE=true` en `.env` para que la cookie
`jc_session` exija TLS — sin tocar código.

### 5.3 `stock_minimo` — bug de esquema corregido antes de usarse (`db/schema.sql`, `services/stockWatcher.js`)
`checkStockMinimo()` ya leía `i.stock_minimo` en su consulta, pero la
columna nunca existió en `CREATE TABLE inventarios` — la alerta de stock
mínimo no tronaba (SQLite no se queja de una columna ausente hasta que la
consulta corre), pero tampoco disparaba nunca, ya que la query fallaría
silenciosamente atrapada en su propio `try/catch`. Se agregó la columna
(`INTEGER NOT NULL DEFAULT 0`) a `db/schema.sql`. Con default `0` la
alerta sigue sin disparar (mismo comportamiento observable que antes,
porque la condición es `stock_minimo > 0`), pero ya no depende de una
columna fantasma — queda pendiente de UI en el dashboard para que alguien
configure el umbral por producto/sucursal (anotado en la sección 7).

### 5.4 Migración `console.*` → `bot/logger.js` (alcance completo: `bot/`, `services/`, `dashboard/`)
Las únicas 3 carpetas con procesos de producción de larga duración (bot,
servicios en background, dashboard) quedaron 100% migradas a logging
estructurado con niveles y redacción automática de teléfonos. Migrado
archivo por archivo, verificando `grep` en cero antes de avanzar al
siguiente:
`bot/handlers/puntosHandler.js`, `bot/handlers/puntosService.js`,
`bot/handlers/referidosService.js`, `bot/actionHandler.js`,
`bot/flows/_shared.js`, `bot/flows/menuFlow.js`, `bot/sessionManager.js`,
`bot/validators.js`, `bot/imageAnalyzer.js`, `bot/filtroPalabras.js`,
`bot/index.js` (21 llamadas), `dashboard/server.js` (12 llamadas),
`services/emailService.js`, `services/stockService.js`,
`services/stockWatcher.js`, `services/stockWatcher.worker.js`.
Deliberadamente **fuera de alcance** (confirmado, no descuidado):
`scripts/*.js` (utilidades CLI manuales, su output a terminal es el
comportamiento esperado, no logging de un proceso de producción) y
`tests/*.js` (corredores de prueba con su propio formato de salida a
color). El `catch` de respaldo en `bot/flows/_shared.js` que usa
`console.*` si `require('../logger')` falla tampoco se tocó — es
justamente el plan B para cuando el logger no carga.

**Hallazgo de seguridad encontrado durante esta migración (no buscado,
descubierto al leer línea por línea):** en `bot/index.js`, la línea que
ofuscaba el teléfono antes de loguear cada mensaje entrante tenía la
regex `/(d{3})d+(d{4})/` — sin la barra invertida antes de cada `d`, por
lo que nunca hizo match contra dígitos reales (solo contra la letra
literal "d"). El resultado: **el teléfono completo sin ofuscar** se
imprimía con `console.log` en cada mensaje recibido desde que existe ese
código — y al ser `console.log` directo (no `bot/logger.js`), tampoco
pasaba por ninguna de las redacciones agregadas en Fase JIUA 1. Se
corrigió eliminando la regex rota y delegando en
`log.info(..., { userId })`, que ya aplica el formato de redacción
correcto (`_redactarTelefonos()` + el formato especial de `meta.userId`).
Exactamente el tipo de "punto roto de seguridad" que pide cubrir la
auditoría continua.

### 5.5 Bug de uso de la API del logger corregido en el mismo barrido (`services/stockWatcher.js`)
Al migrar `console.log('[stockWatcher] Reporte diario enviado a', _destConf)`
se detectó que la llamada original pasaba un string suelto como si fuera
el objeto `meta` de `log.info(msg, meta)` — `bot/logger.js` espera que
`meta` sea un `Error` o un objeto plano; con un string, `Object.entries()`
itera caracter por caracter y produce un JSON ilegible en el log (sin
fuga de datos porque `_destConf` aquí es solo `'whatsapp'`/`'email'`, no
un teléfono, pero igual era una llamada incorrecta a la API). Se corrigió
concatenando el valor directamente en el mensaje:
`log.info('Reporte diario enviado a ' + _destConf)`.

## 6. Verificación de Fase JIUA 2
- `node tests/test_bot.js` → **116/116 pruebas pasando (100%)**, sin
  regresiones sobre el 113/113 de cierre de Fase 1 (se sumaron 2 casos de
  frustración "débil + urgencia" y se quitó el test de hallazgo ya
  resuelto, neto +3).
- `node --check` limpio en los 14 archivos tocados (`bot/`, `dashboard/`,
  `services/`).
- `grep` repo-wide confirma cero `console.*` fuera del alcance documentado
  en 5.4.

## 7. Hallazgos nuevos para Fase JIUA 3 (surgidos en la re-auditoría de cierre de Fase 2)

- **El reporte automático diario (`services/stockWatcher.js` →
  `POST /api/reporte`) está roto desde que el dashboard migró de Basic
  Auth a sesiones con cookie.** `stockWatcher.js` todavía manda
  `Authorization: Basic ...` con `DASHBOARD_USER`/`DASHBOARD_PASS`, pero
  `requireSession()` (el único gate hoy) solo lee la cookie `jc_session` —
  nunca el header `Authorization`. Cada intento recibe `401 No autorizado`.
  Peor aún: la llamada no revisa la respuesta HTTP en absoluto
  (`_req.write(...); _req.end();` sin `.on('response', ...)`), así que el
  log siempre dice "Reporte diario enviado a..." aunque el envío real
  haya fallado — el fallo es invisible salvo leyendo los logs del
  dashboard. No se corrigió en este barrido porque la solución correcta
  no es trivial ni libre de riesgo de seguridad: o se diseña un mecanismo
  de autenticación interno proceso-a-proceso (ej. un secreto compartido
  vía env var, distinto de las credenciales de usuario) o se elimina el
  salto HTTP y se llama la lógica de reporte directamente — ambas opciones
  tocan el gate de autenticación o cruzan el límite entre los dos procesos
  documentado en `CLAUDE.md` ("Two independent processes, one SQLite DB"),
  así que se deja como decisión explícita de diseño para Fase JIUA 3 en
  vez de parchearlo apurado.
- **`stock_minimo` no tiene UI en el dashboard** (ver 5.3) — la columna y
  la lógica de alerta ya existen y funcionan, pero hoy nadie puede
  configurar el umbral por producto/sucursal salvo escribiendo SQL a
  mano. Candidato natural para Fase JIUA 3 junto con cualquier otro ajuste
  de inventario.
- **Errores ortográficos reales no detectados por `quejaCheck`** (heredado
  de Fase 1, sigue sin resolver — ver sección 3) — sigue pendiente de
  fuzzy-matching/NLP, fuera del alcance de Fase 2.
- **`migraciones_pendientes/`** (heredado de Fase 1) — sigue sin poder
  cerrarse desde este sandbox por falta de acceso a la base de datos de
  producción real.

## 8. Decisión de diseño tomada al arrancar Fase JIUA 3

De las dos opciones planteadas en la sección 7 para `POST /api/reporte`
(secreto compartido proceso-a-proceso vs. eliminar el salto HTTP), se
eligió **eliminar el salto HTTP**: se extrajo toda la lógica de
generación/envío del reporte a un módulo nuevo, `services/reporteService.js`
(`generarReporte()` + `enviarReporte(destino)`), con acceso directo a
`bot/db_connection.js` — el mismo acceso que `stockWatcher.js` ya tenía.
Se descartó la opción del secreto compartido porque habría significado
enseñarle a `requireSession()` un segundo camino de autenticación
(header interno) solo para un caller, ampliando la superficie de un gate
de seguridad usado por las 40+ rutas del dashboard. Eliminar el HTTP
también es la opción consistente con el principio ya documentado en
`CLAUDE.md` ("Two independent processes, one SQLite DB") y con el propio
comentario de cabecera de `stockWatcher.js` ("Solo escribe en
cola_notificaciones — NUNCA llama a WhatsApp directamente"): el bug no
era solo de autenticación, era una violación de esa frontera.

## 9. Implementado en Fase JIUA 3

### 9.1 `POST /api/reporte` — eliminado el salto HTTP roto (`services/reporteService.js` nuevo, `dashboard/server.js`, `services/stockWatcher.js`)
- `services/reporteService.js` (nuevo): `generarReporte()` contiene el
  texto exacto que antes vivía inline en el handler de `dashboard/server.js`
  (mismos emojis, mismas queries SQL); `enviarReporte(destino)` decide a
  qué cola encolar (`cola_notificaciones` para `'whatsapp'`, `cola_emails`
  para `'email'`, o solo regresa el texto para cualquier otro valor) y
  devuelve siempre un resultado explícito `{ ok, status, ... }` — a
  diferencia del código viejo, ahora el caller puede saber si falló
  (`ASESOR_WHATSAPP`/`EMAIL_PERSONAL` sin configurar) en vez de asumir
  éxito.
- `dashboard/server.js`: el handler de `POST /api/reporte` quedó en 5
  líneas, delegando en `reporteService.enviarReporte(destino)` — sigue
  siendo el botón manual del panel, sin cambios de contrato HTTP para el
  frontend.
- `services/stockWatcher.js`: el bloque de reporte automático diario ya
  no abre un `http.request` con `Authorization: Basic ...` hacia el
  dashboard — llama directo a `reporteService.enviarReporte(_destConf)`
  y ahora sí revisa el resultado (`if (_r.ok) log.info(...) else
  log.warn('Reporte diario no enviado: ' + _r.error)`), cerrando también
  el segundo bug de la sección 7 (antes "enviado" se logueaba sin
  importar si el envío real había fallado).
- **Bug nuevo encontrado y corregido al extraer la lógica**: el
  deduplicado de "ya se envió hoy" en `stockWatcher.js` solo consultaba
  `cola_notificaciones`, sin importar el `destino` configurado. Si
  `reporte_destino='email'`, el reporte se encola en `cola_emails`, así
  que esa consulta nunca encontraba nada y el reporte por email se
  habría reenviado en cada ciclo de `runAll()` (cada minuto dentro de la
  ventana configurada) en vez de una sola vez al día. Se corrigió para
  que el deduplicado consulte la tabla correcta según `_destConf`.
- **Segundo bug nuevo encontrado**: el INSERT a `cola_emails` (heredado
  del handler viejo de `dashboard/server.js`) usaba columnas
  `destinatario`/`cuerpo_html`, que no son las columnas reales que usa
  el resto del sistema — `services/emailService.js` (el único otro
  escritor/lector de esa tabla, usado para el email real de "nuevo
  pedido") usa `destinatarios` (JSON-stringified array) y `html_body`.
  Con las columnas viejas el INSERT habría fallado en tiempo de
  ejecución contra la base real (`SQLITE_ERROR: no such column`) la
  primera vez que alguien probara el reporte por email — nunca se había
  detectado porque no hay base sembrada en este sandbox para probarlo.
  Se corrigió `reporteService.js` para usar las columnas reales.
  Verificado con una base SQLite desechable creada con el esquema real
  de ambas tablas (`cola_notificaciones`, `cola_emails`): los dos
  destinos (`whatsapp`, `email`) encolan correctamente y el `JSON.parse`
  que hace `emailService.js` sobre `destinatarios` funciona con el
  formato que ahora escribe `reporteService.js`.

### 9.2 UI de `stock_minimo` por producto+sucursal (`bot/validators.js`, `dashboard/server.js`, `dashboard-ui/src/pages/Prime.jsx`)
Cierra el pendiente de la sección 7 (5.3 dejó la columna funcional pero
sin forma de configurarla salvo SQL a mano):
- `bot/validators.js`: `InventarioMinimoSchema` (`stock_minimo: entero ≥
  0`).
- `dashboard/server.js`: `GET /api/prime/inventarios` (búsqueda opcional
  por nombre de producto, `JOIN` con `productos`, límite 300) y
  `PUT /api/prime/inventarios/:id` (valida con Zod, confirma que el
  registro exista, escribe vía `actualizarCampos()` con el mismo
  allowlist `TABLAS_ACTUALIZABLES` que ya protege `sucursales`/
  `productos`) — ambas rutas exigen rol `prime`, igual que el resto de
  `/api/prime/*`.
- `dashboard-ui/src/pages/Prime.jsx`: tarjeta nueva "Stock mínimo por
  sucursal" con buscador y tabla editable (Producto / Sucursal / Stock /
  Stock mínimo con input + botón Guardar por fila), siguiendo el mismo
  patrón de las demás tarjetas de la página (`useState` + `cargarX()` +
  `try/catch` alrededor de `api.put`).
- Verificado: `node --check` en los 3 archivos de backend tocados y
  `npm run build` dentro de `dashboard-ui/` (935 módulos, sin errores
  nuevos).

## 10. Hallazgos escalados a Fase JIUA 4

Lo que sobró de la auditoría de cierre de Fase 2 (sección 7) y no se
resolvió en Fase 3 porque no era parte del despliegue principal ni
bloqueaba nada de lo anterior — se escala completo, sin perder contexto:

- **Errores ortográficos reales no detectados por `quejaCheck`**
  (heredado de Fase 1 → Fase 2 → ahora Fase 4 sin resolver). Sigue
  necesitando fuzzy-matching/normalización NLP más agresiva que la
  corrección de acentos/leetspeak actual; es una feature de tamaño
  considerable (no un fix puntual), por eso se sigue escalando en vez de
  intentarse a medias.
- **`migraciones_pendientes/`** (heredado de Fase 1 → Fase 2 → Fase 3 →
  ahora Fase 4). Confirmado de nuevo en este barrido: no existe ninguna
  base `.db` sembrada en este checkout (`*.db` está en `.gitignore`,
  tampoco hay `Base de datos demo/`), así que verificar el contenido de
  esa carpeta contra producción real sigue sin poder hacerse desde aquí.
  Queda como acción manual para quien tenga acceso a esa base.
- **(Nuevo en esta ronda) Posible bug de retry en `services/emailService.js`**:
  `reintentarPendientes()` lee `email.creado_en` (línea ~363) para
  calcular el backoff exponencial cuando `intentos > 0`, pero
  `db/schema.sql` declara la columna como `creada_en` (con "a"). Si el
  nombre real en producción coincide con `schema.sql`, `email.creado_en`
  sería siempre `undefined` → `new Date(undefined)` → fecha inválida →
  la condición de espera nunca se cumple → los reintentos con
  `intentos > 0` quedarían congelados para siempre (nunca se reintentan
  más allá del primer fallo). No se tocó en Fase 3 porque
  `reporteService.js` solo necesitaba escribir en `cola_emails`, no leer
  el camino de reintentos, y porque confirmar cuál de los dos nombres es
  el real otra vez requiere la base de producción (mismo bloqueador que
  `migraciones_pendientes/`). Se escala a Fase JIUA 4 con prioridad alta
  por ser un bug de confiabilidad de envío de correo, no solo una
  oportunidad de mejora.

## 11. El proceso "loop"

A partir de esta fase se nombra y formaliza el ciclo que ya venía
repitiéndose de fase a fase, para que cualquiera (humano o agente) que
continúe esta auditoría sepa exactamente qué pasos seguir sin tener que
releer todo el historial:

1. **Fix** — de los hallazgos pendientes de la fase anterior, resolver
   primero los que no compiten ni bloquean el despliegue principal de la
   fase actual (pueden tocarse en paralelo sin riesgo de conflicto).
2. **Escalar** — lo que sobra (por tamaño, por necesitar acceso que este
   sandbox no tiene, o por ser una decisión de negocio) se mueve íntegro
   a una fase nueva siguiente, sin perder el porqué de por qué quedó
   pendiente.
3. **Desplegar** — implementar el hallazgo de mayor impacto identificado
   al cierre de la fase anterior (el "siguiente paso" que cada cierre de
   fase deja marcado).
4. **Re-auditar** — al terminar el despliegue, repetir una pasada de
   auditoría enfocada en lo que se acaba de tocar (no una auditoría
   completa desde cero): buscar patrones hermanos del bug ya corregido,
   columnas/tablas que el código nuevo asume pero no verificó contra el
   esquema real, y cualquier punto roto de punta a punta que el cambio
   haya dejado expuesto. Los hallazgos de esta pasada alimentan el paso 2
   de la siguiente iteración del loop.
5. Repetir desde el paso 1 con la fase siguiente.

Este documento (`AUDITORIA_FASE_JIUA.md`) es el registro vivo del loop:
cada iteración agrega su sección de "Implementado en Fase JIUA N" y su
sección de "Hallazgos escalados a Fase JIUA N+1", en vez de reemplazar
las anteriores.

## 12. Verificación de Fase JIUA 3
- `node tests/test_bot.js` → **116/116 pruebas pasando (100%)**, sin
  regresiones (el cambio de Fase 3 no tocó el pipeline de mensajes, solo
  `dashboard/server.js`, `services/stockWatcher.js`,
  `services/reporteService.js` nuevo, `bot/validators.js` y
  `dashboard-ui/`).
- `node --check` limpio en los 4 archivos de backend tocados/creados.
- `npm run build` dentro de `dashboard-ui/` sin errores nuevos.
- Prueba funcional con una base SQLite desechable (esquema real de
  `pedidos`, `clientes`, `links_pago`, `cola_atencion`,
  `cola_notificaciones`, `cola_emails`): `reporteService.enviarReporte()`
  encola correctamente para ambos destinos (`whatsapp`, `email`) y el
  formato escrito en `cola_emails` es compatible con lo que
  `services/emailService.js` espera leer.
- `grep` repo-wide confirma que no quedan otras llamadas
  `http.request`/auto-llamadas entre `bot/`↔`dashboard/` (el patrón de
  arquitectura que causó el bug de la sección 7 era el único caso).

## 13. Siguiente paso (cierre de Fase JIUA 3, decisión que abrió Fase 4)

Listo para arrancar Fase JIUA 4 con el backlog de la sección 10. El
candidato de mayor impacto es el posible bug de retry en
`services/emailService.js` (`creado_en` vs `creada_en`) — si se confirma
contra producción, es un bug de confiabilidad real (correos que fallan
una vez nunca se vuelven a intentar). El resto de la sección 10 son
mejoras de alcance mayor (NLP) o bloqueadas por falta de acceso a la base
real, sin urgencia inmediata.

## 14. Implementado en Fase JIUA 4

### 14.1 Bug de retry confirmado y corregido sin necesitar la base de producción (`services/emailService.js`)
El hallazgo de la sección 10 quedó como "posible" porque confirmar el
nombre real de la columna parecía depender de la base de producción —
igual que `migraciones_pendientes/`. Al re-auditar se encontró una forma
de confirmarlo **sin esa base**: las otras dos tablas `cola_*`
(`cola_notificaciones`, `cola_atencion`) declaran su columna de creación
como `creada_en` en `db/schema.sql`, y el propio `dashboard/server.js`
las lee así de forma consistente en todas sus rutas (`/api/cola/*`,
`/api/cola_atencion`, etc. — confirmado por `grep` línea por línea). Eso
fija la convención del proyecto: las tablas "cola" (género femenino en
español: *la cola*) usan `creada_en`; las tablas "pedido"/"link" (género
masculino) usan `creado_en`. `cola_emails` es, por nombre y por su propia
declaración en `db/schema.sql` (línea 459), una tabla "cola" — por lo
tanto su columna real es `creada_en`, y la línea de `emailService.js`
que leía `email.creado_en` (masculino) era simplemente el typo, no una
ambigüedad real. Se corrigió:
```js
// antes
const ultimoIntento = new Date(email.actualizado_en || email.creado_en).getTime();
// después
const ultimoIntento = new Date(email.actualizado_en || email.creada_en).getTime();
```
**Nota de impacto real**: en el flujo normal, `actualizado_en` siempre se
escribe en la misma sentencia `UPDATE` que incrementa `intentos`
(`services/emailService.js` línea ~378: `UPDATE cola_emails SET
intentos=intentos+1, estatus='error', actualizado_en=datetime(...)`),
así que el operador `||` casi nunca llega a evaluar `email.creado_en` en
producción — el bug existía pero su ventana de impacto es angosta
(solo afectaría una fila si `actualizado_en` quedara `NULL` con
`intentos>0`, algo que el código actual no produce). Igual se corrige
ahora porque es la causa raíz documentada y queda como deuda muerta si no
se toca. Verificado con una base SQLite desechable que fuerza
exactamente ese escenario (`intentos=1`, `actualizado_en` con timestamp
de hace 10 minutos, sin depender de `creado_en`): antes del fix el
cálculo daba `NaN` (`Date(undefined)`); después da `10.00` minutos
exactos.
- Re-auditado el resto del repo buscando el mismo patrón de
  fallback-con-`||`-entre-columnas-de-fecha (`grep` de
  `|| ....*_en).getTime`) — `services/emailService.js:363` es la única
  ocurrencia; no hay bugs hermanos pendientes de este patrón.
- Re-auditadas también todas las demás referencias a `.creado_en` en
  `bot/`, `services/` y `dashboard/server.js`: todas apuntan a filas de
  `pedidos`/`links_pago` (masculino, columna correcta); ninguna otra
  mezcla el género de tabla.

## 15. Hallazgos escalados a Fase JIUA 5

Sin cambios respecto al backlog que ya traía Fase 4, porque ninguno de
los dos se resolvió en este barrido (no eran el objetivo principal ni se
volvieron desbloqueables):

- **Errores ortográficos reales no detectados por `quejaCheck`**
  (heredado de Fase 1 → 2 → 3 → 4 → ahora Fase 5). Sigue siendo una
  feature de NLP/fuzzy-matching de tamaño considerable, no un fix
  puntual.
- **`migraciones_pendientes/`** (heredado de Fase 1 → 2 → 3 → 4 → ahora
  Fase 5). Confirmado de nuevo: sigue sin existir una base `.db` sembrada
  en este checkout para verificar su contenido contra producción real.

No surgieron hallazgos nuevos durante la re-auditoría de cierre de Fase 4
más allá de los ya descritos en 14.1 (que se resolvieron en la misma
fase, no se escalan).

## 16. Verificación de Fase JIUA 4
- `node tests/test_bot.js` → **116/116 pruebas pasando (100%)**, sin
  regresiones (el cambio fue una sola línea en
  `services/emailService.js`, fuera del pipeline de mensajes).
- `node --check services/emailService.js` limpio.
- Prueba funcional dirigida con base SQLite desechable que reproduce el
  escenario exacto del bug (`intentos>0`, backoff con `actualizado_en`
  poblado) — confirma `10.00` minutos en vez de `NaN`.
- `grep` repo-wide confirma que el patrón de fallback con `||` entre dos
  columnas de fecha es único en el repo (sección 14.1) y que el resto de
  usos de `.creado_en` son correctos para sus tablas.

## 17. Siguiente paso

Listo para arrancar Fase JIUA 5 con el backlog de la sección 15: ambos
pendientes (`quejaCheck` NLP, `migraciones_pendientes/`) siguen siendo
trabajo de alcance mayor o bloqueado por acceso a producción, sin un
candidato de "mayor impacto" nuevo y acotado como hubo en las fases 3 y
4. La siguiente iteración del loop debería decidir si vale la pena
empezar `quejaCheck` (fuzzy-matching) en partes pequeñas y verificables
(p. ej. solo Levenshtein contra una lista corta de palabras clave de
queja, sin tocar el resto del detector) en vez de esperar a que alguien
desbloquee `migraciones_pendientes/` con acceso a la base real.

## 18. Cierre de `migraciones_pendientes/` (resuelto, no escalado)

El operador confirmó directamente (acceso a producción que este sandbox
nunca tuvo) que el contenido de `migraciones_pendientes/` ya está
aplicado en la base de datos real. Esto cierra el pendiente que venía
escalándose sin cambios desde la Fase 1 — no por desbloqueo desde este
checkout (como se especulaba en la sección 17), sino por confirmación
directa del operador, que es la fuente de verdad real para el estado de
producción.

Acción tomada: se borró la carpeta completa (31 archivos `.sql` +
`README.md`), cumpliendo el propio criterio de borrado que su README
declaraba ("Borra esta carpeta cuando ya no la necesites — es un andamio
de trabajo, no parte del código del proyecto"). Se actualizaron las tres
referencias cruzadas que quedaban: `CLAUDE.md` (sección que describía la
carpeta), `tests/sql/README.md` (comparación con el patrón regresivo de
`tests/sql/*.sql`, y la referencia puntual al backfill `0004` en el
hallazgo `01_reporte_revenue`). Los comentarios inline en `db/schema.sql`
(`-- migraciones_pendientes/00NN`) se dejaron tal cual: son breadcrumbs
históricos de qué migración introdujo cada columna, no punteros a un
recurso que deba seguir existiendo.

## 19. Implementado en Fase JIUA 5: fuzzy-matching acotado para `quejaCheck`

Ajustado respecto a la propuesta original (sección 15/comentario del
operador): no se trató como "el Ingeniero de IA evita que el bot
alucine" — `quejaCheck` es 100% basado en reglas, nunca generación de
texto (ver CLAUDE.md), así que no hay alucinación posible; lo que sí
aplica del comentario es la práctica real detrás de la sugerencia,
validar antes de producción, y eso se conservó.

**Qué se construyó** (`bot/index.js`): una distancia de Levenshtein
(`_lev`) sin dependencias externas, aplicada SOLO a palabras sueltas de
`_QUEJA_L1` (vía `QUEJA_FUZZY_BASE = QUEJA_L1_BASE.filter(p =>
!p.includes(' '))`) — las frases de 2+ palabras ("no funciona", "cobro
indebido", "no llegó") quedan deliberadamente fuera: el riesgo de falso
positivo combinatorio de fuzzy-matchear frases completas es mayor que el
typo puntual que resolvería. Tolerancia de distancia escalona con el
largo de la palabra (`_distanciaTolerada`: 0 para ≤4 letras, 1 para 5-7,
2 para 8+) para que palabras cortas no generen falsos positivos masivos.
Un hit fuzzy cuenta igual que uno exacto en `hits1Total`, así que sigue
sujeto a la regla anti-falso-positivo de siempre: una sola palabra (exacta
o fuzzy) no escala sin una segunda señal o "tono" (mayúsculas/exclamación).

**Validación contra el dataset de la sección 3** (los 3 casos ya
documentados como gap conocido en `tests/test_bot.js`): se corrieron tal
cual, sin asumir que el fuzzy-match los resolvería todos —
- `'no llgo mi pedido'` → sigue sin detectarse (correcto): "no llegó" es
  una frase de 2 palabras, fuera del alcance a propósito.
- `'es una estfa'` → sigue sin detectarse (correcto): "estfa"~"estafa"
  sí es un hit fuzzy, pero es la única señal del mensaje y sin tono — la
  misma regla que ya protegía contra una sola palabra exacta suelta
  (`'profeco'`, `'estafa'` por sí solas tampoco escalan, ver sección 3)
  sigue aplicando igual a una palabra fuzzy.
- `'kiero q me regresen mi dinero'` → sigue sin detectarse (correcto):
  jerga sin ninguna palabra de `QUEJA_FUZZY_BASE` cerca, ni exacta ni
  fuzzy.

Resultado honesto: **0 de los 3 casos del dataset original quedan
resueltos**, y eso es el comportamiento esperado, no una falla del
fuzzy-match — los 3 fueron elegidos originalmente para documentar gaps de
naturaleza distinta (2 son de frase, 1 es de jerga sin palabra clave
reconocible), no gaps de "palabra clave mal escrita en aislamiento". Lo
que el fuzzy-match sí resuelve es el caso real que motivó la feature:
una palabra clave mal escrita **combinada con una segunda señal real**
en el mismo mensaje — ej. `'es una estfa, totalmente un fraude'` ahora
se detecta (fuzzy "estfa"~"estafa" + exacta "fraude" = 2 hits), cuando
antes de Fase 5 contaba como 1 sola palabra exacta y no escalaba. Se
agregó esto como test nuevo (no se tocaron los 3 tests de gap conocido,
siguen documentando exactamente el mismo límite que documentaban antes,
con el comentario actualizado para explicar la razón real de cada uno).

`node tests/test_bot.js` → **117/117 pruebas pasando (100%)** (116
heredadas + 1 nueva).

## 20. Auditoría de expertos simulada (nueva etapa del loop)

Por instrucción del operador, el loop (sección 11: Fix → Escalar →
Desplegar → Re-auditar → Repeat) se extiende con un paso adicional entre
"Desplegar" y "Re-auditar": una **auditoría de expertos simulada**, que
difiere del re-auditar normal en alcance — no se limita a verificar el
cambio recién desplegado, sino que adopta deliberadamente varias
perspectivas de revisor (seguridad, confiabilidad/manejo de errores,
lógica de negocio) y aplica cada una contra el código reciente Y contra
patrones repetidos en el resto del repo, buscando específicamente la
clase de bug que un re-auditar normal (enfocado en el cambio del día) no
encuentra por construcción — como pasó con el bug de la sección 21.

**Loop actualizado**: Fix → Escalar → Desplegar → **Auditoría de
expertos simulada** → Re-auditar → Repeat.

### Hallazgos de esta pasada

1. **(Confirmado y corregido) `services/stockWatcher.js:580` — bug de
   confiabilidad, no solo de nomenclatura.** Perspectiva
   "confiabilidad/manejo de errores": el reporte diario automático por
   email usaba `date(creado_en)` contra `cola_emails` (debe ser
   `creada_en`, mismo patrón ya corregido en Fase 4 para
   `emailService.js`). La Fase 4 no lo detectó porque su re-auditoría
   solo grepeó accesos a propiedades de objeto JS (`.creado_en`), no
   nombres de columna dentro de strings SQL — un punto ciego real del
   método de re-auditoría anterior, no solo mala suerte. Impacto real
   verificado leyendo el código alrededor (no solo el grep): la consulta
   vive dentro de un `try { ... } catch(_) {}` (línea 595), así que el
   error de SQLite ("no such column: creado_en") se traga en silencio —
   esto no solo rompía el deduplicado, **impedía que el reporte
   automático por email se enviara alguna vez**, porque la excepción
   ocurre antes de llegar a `reporteService.enviarReporte()`. Corregido
   (`creado_en` → `creada_en`) y verificado con una base SQLite
   desechable reproduciendo el esquema real de `cola_emails`. El camino
   de WhatsApp (`cola_notificaciones`, ya `creada_en`) nunca tuvo este
   bug.
2. **(Hallazgo, no corregido — ver Fase 6) Patrón repetido de `catch(_)
   {}` totalmente silencioso.** Perspectiva "confiabilidad": el mismo
   patrón que ocultó el bug #1 (un `catch` vacío sin ningún `log.debug`)
   aparece en **19 archivos** del repo (`grep -rl
   "catch\s*(_)\s*{}"`): `stockWatcher.js`, `bot/index.js`,
   `emailService.js`, `dashboard/server.js`, `imageAnalyzer.js`,
   `sessionManager.js`, `menuFlow.js`, `_shared.js`, `actionHandler.js`,
   `referidosService.js`, `puntosService.js`, `puntosHandler.js`,
   `stockService.js`, `logger.js`, `asesorFlow.js`,
   `estafetaService.js`, `test_estres_bd.js`, `backup.js`,
   `cartFlow.js`. Muchos de estos catches son legítimamente "ignorar a
   propósito" (ej. una feature opcional que no debe romper el flujo si
   falla), pero el patrón no distingue eso de un typo de columna real —
   ambos se ven idénticos desde afuera (silencio total). No se tocó en
   esta fase porque es un cambio de alcance amplio (19 archivos) y de
   triage no trivial (hay que leer cada catch para decidir si vale la
   pena loguearlo); se documenta como candidato de Fase 6 en vez de
   tocarlo a medias.
3. **(Hallazgo, no corregido — ver Fase 6) Riesgo de falso positivo del
   fuzzy-match nuevo, sin telemetría para medirlo.** Perspectiva "lógica
   de negocio": `QUEJA_FUZZY_BASE` incluye palabras de 5 letras como
   `'falla'` (tolerancia 1), que en teoría podría fuzzy-matchear alguna
   palabra no relacionada de 5 letras a distancia 1 en un mensaje real de
   cliente (ej. nombres de producto, jerga). El diseño ya mitiga esto
   (un hit fuzzy solo no escala, necesita 2da señal o tono — sección 19),
   pero no hay ningún log/métrica que registre CUÁNDO un hit fue fuzzy
   (vs. exacto) en producción, así que si el supuesto de "es raro que
   pase Y cuando pasa hay 2da señal real" resulta falso, no habría forma
   de notarlo sin leer manualmente las escaladas a asesor. Se documenta
   como candidato de Fase 6: agregar un campo o log puntual que marque
   cuándo `hits1Fuzzy` contribuyó a una escalada, para poder medir
   precisión real contra quejas atendidas por un asesor humano.
4. **(Revisado, sin hallazgo) Seguridad de `scripts/instalarBaseDeDatos.js`
   y del fuzzy-match nuevo.** Perspectiva "seguridad": el ALTER TABLE de
   `verificarYCompletar()` interpola `tabla`/`nombre`/`tipo` en el SQL,
   pero los tres vienen de parsear el propio `db/schema.sql` del
   proyecto (un archivo del repo, no input de usuario/red), no de
   ningún dato externo — no es una superficie de inyección real. El
   fuzzy-match nuevo solo lee/compara strings, no construye SQL ni HTML
   con el resultado. Sin hallazgos nuevos de seguridad en este barrido.

## 21. Verificación de Fase JIUA 5
- `node tests/test_bot.js` → **117/117 pruebas pasando (100%)**.
- `node --check` limpio en `bot/index.js`, `services/stockWatcher.js`,
  `services/reporteService.js`.
- Prueba funcional dirigida con base SQLite desechable reproduciendo el
  esquema real de `cola_emails`, confirmando que la consulta de
  deduplicado corregida (`creada_en`) sí encuentra la fila esperada
  (antes del fix, la misma prueba con `creado_en` lanza
  `SqliteError: no such column: creado_en`).
- `grep` repo-wide confirma que no quedan otras ocurrencias de
  `creado_en` contra tablas `cola_*`/`carritos_abandonados` (todas usan
  ya `creada_en`).
- `git rm -r migraciones_pendientes/` + verificación de que las 3
  referencias cruzadas restantes (`CLAUDE.md`, `tests/sql/README.md`)
  quedaron actualizadas y sin punteros rotos a la carpeta borrada.

## 22. Hallazgos escalados a Fase JIUA 6

Generados por la auditoría de expertos simulada de la sección 20,
priorizados:

1. **Alta prioridad — instrumentar `catch(_) {}` silenciosos.** Triage de
   los 19 archivos listados en el hallazgo #2 de la sección 20: para
   cada catch vacío, decidir si el error que traga es (a) genuinamente
   esperable/opcional → dejarlo igual, o (b) podría ser un bug real
   (typo de columna, cambio de esquema, etc.) → agregar como mínimo
   `log.debug('contexto: ' + e.message)` sin cambiar el control de flujo
   (sigue sin romper el flujo principal, solo deja de ser invisible).
   Empezar por los catches que envuelven `db.prepare(...)`/`.run()`/
   `.get()` directamente (mayor probabilidad de ocultar un typo de SQL
   como el de la sección 20.1) antes que los que envuelven llamadas a
   servicios externos opcionales (email, Vision API).
2. **Media prioridad — telemetría de hits fuzzy en `quejaCheck`.** Del
   hallazgo #3 de la sección 20: agregar un campo (o un log puntual) que
   distinga cuándo una escalada a asesor incluyó al menos un hit fuzzy,
   para poder medir con datos reales de producción si la tasa de falsos
   positivos es aceptable, en vez de basarse solo en el razonamiento de
   diseño de la sección 19.
3. **Media prioridad — extender el fuzzy-match a frases cortas de 2
   palabras de alto valor.** `'no llegó'`/`'no llego'` (la frase que
   motivó el caso de prueba original `'no llgo mi pedido'`) sigue sin
   cobertura porque Fase 5 excluyó a propósito las frases multi-palabra.
   Si la telemetría del punto 2 muestra que vale la pena, evaluar un
   fuzzy-match position-aware específico para esta frase (no genérico
   para todas las frases L1/L2, que sí tiene el riesgo combinatorio ya
   documentado en la sección 19).
4. **Baja prioridad — revisar duplicados acento/no-acento en
   `QUEJA_L1_BASE`.** `'pesimo'`/`'pésimo'` y `'devolucion'`/
   `'devolución'` aparecen dos veces en la misma lista (una con acento,
   una sin) porque `_normQ` ya normaliza acentos — son redundantes, no
   incorrectos. No es un bug, pero limpiarlo simplificaría
   `QUEJA_FUZZY_BASE` (actualmente hereda la redundancia).

## 23. Siguiente paso

Listo para arrancar Fase JIUA 6 con el punto 1 de la sección 22 como
candidato de mayor impacto (mismo criterio que las fases 3 y 4: un bug de
confiabilidad real con alcance acotado y verificable), aunque su tamaño
(19 archivos a revisar uno por uno) sugiere que puede valer la pena
dividirlo en sub-fases en vez de intentarlo completo de una sola vez.

## 24. Fase JIUA 6 — plan de sub-fases

Los 19 archivos del hallazgo #1 (sección 22) se dividen en 5 subprocesos
por área de código, para revisarlos de poco a poco en vez de en un solo
lote:

1. **6.1 — Núcleo del pipeline del bot**: `bot/index.js`,
   `bot/sessionManager.js`, `bot/actionHandler.js`, `bot/logger.js`.
2. **6.2 — Flows**: `bot/flows/menuFlow.js`, `bot/flows/_shared.js`,
   `bot/flows/asesorFlow.js`, `bot/flows/cartFlow.js`.
3. **6.3 — Handlers de lealtad/referidos**:
   `bot/handlers/referidosService.js`, `bot/handlers/puntosService.js`,
   `bot/handlers/puntosHandler.js`.
4. **6.4 — Services**: `services/stockWatcher.js`,
   `services/emailService.js`, `services/stockService.js`,
   `services/estafetaService.js`.
5. **6.5 — Dashboard y resto**: `dashboard/server.js`,
   `bot/imageAnalyzer.js`, `scripts/backup.js`,
   `tests/test_estres_bd.js`.

## 25. Implementado en Fase JIUA 6.1

Triage de los `catch(_) {}` en los 4 archivos del subproceso 6.1, con el
mismo criterio de la sección 22: si el catch envuelve un `db.prepare()/
.run()/.get()` crudo sin loguear nada, agregar `log.debug('contexto: ' +
e.message)` sin tocar el control de flujo; si la función envuelta ya
loguea internamente su propio error, o el catch envuelve algo no-DB y
genuinamente opcional, dejarlo igual.

**Instrumentados (10 catches, todos envolvían `db.prepare(...)` directo
sin logging previo):**

- `bot/index.js` (6):
  - UPDATE de corrección de teléfono LID (callback de retry de
    notificaciones) → `log.debug('No se pudo corregir teléfono LID: ' +
    e.message)`.
  - UPDATE de auto-tag `blacklist` (bloqueo por filtro de contenido) →
    `log.debug('No se pudo etiquetar blacklist: ' + e.message)`.
  - UPDATE de auto-tag `queja` (detección de frustración) →
    `log.debug('No se pudo etiquetar queja: ' + e.message)`.
  - INSERT de evento `frustracion` en `log_eventos` (misma rama) →
    `log.debug('No se pudo registrar evento frustracion: ' +
    e.message)`.
  - SELECT de la bandera `vision_activo` en `configuracion` →
    `log.debug('No se pudo leer vision_activo: ' + e.message)`.
  - INSERT de evento `imagen` en `log_eventos` (resultado de Vision
    API) → `log.debug('No se pudo registrar evento imagen: ' +
    e.message)`.
- `bot/sessionManager.js` (3):
  - INSERT OR IGNORE en `carritos_abandonados` al expirar una sesión
    con carrito → `log.debug('No se pudo persistir carrito abandonado:
    ' + e.message, { uid })`.
  - INSERT de evento `busqueda_abandonada` en `log_eventos` (sesión sin
    carrito que expira tras una búsqueda con 0 resultados) →
    `log.debug('No se pudo registrar busqueda_abandonada: ' +
    e.message, { uid })`.
  - `JSON.parse(row.data_json)` en `getSession()` → `log.debug('data_json
    corrupto en sesiones_bot: ' + e.message, { userId })`.
- `bot/actionHandler.js` (1):
  - INSERT de evento `fallback` en `log_eventos` (ningún flow manejó el
    mensaje) → `log.debug('No se pudo registrar evento fallback: ' +
    e.message)`.

**Confirmados como seguros y dejados sin cambios** (la función envuelta
ya loguea su propio error internamente, instrumentar el catch externo
sería log duplicado):

- `bot/filtroPalabras.js` → `asegurarTabla()` ya hace
  `log.warn('No se pudo asegurar la tabla', e)`.
- `bot/flows/_shared.js` → `registrarEscalada()` ya hace
  `log.error('registrarEscalada error', e)`.
- `services/mensajeService.js` → `registrarMensaje()` documenta su
  silencio a propósito (`/* el hilo de conversación es contexto, no
  crítico */`).
- `bot/logger.js` — sus dos `catch(_) {}` (creación del directorio de
  logs y del `WriteStream`) son el bootstrap del logger mismo: no
  pueden auto-loguear su propio fallo (dependencia circular), y el
  `.on('error', () => { _stream = null; })` del stream ya degrada con
  gracia a solo-consola. Sin cambios.
- Otros catches no-DB en `bot/index.js` (`execSync` de detección de
  binario, escritura de archivo de imagen, `sendMessage` de fallback,
  simulación de "escribiendo...") y los call-sites que ya envuelven
  `registrarEscalada()`/`registrarMensaje()` con su propio catch
  externo — redundante con el logging interno, sin cambios.

**Verificación**: `node --check` limpio en los 3 archivos editados;
`node tests/test_bot.js` se mantiene en 117/117 (100%) sin
regresiones.

Pendiente: subprocesos 6.2 a 6.5, uno a la vez por instrucción
explícita del usuario.

## 26. Implementado en Fase JIUA 6.2

Mismo triage que 6.1, aplicado a los 4 archivos de flows:
`bot/flows/menuFlow.js`, `bot/flows/_shared.js`,
`bot/flows/asesorFlow.js`, `bot/flows/cartFlow.js`.

**Instrumentados (20 catches):**

- `bot/flows/menuFlow.js` (4): SELECT de historial de pedidos (rastreo
  desde el menú) → `log.debug('No se pudo cargar historial de
  pedidos: ' + e.message)`; UPDATE de preferencias del wizard
  (`edad_pref`/`genero_pref`/`tipo_pref`/`presupuesto_pref`) →
  `log.debug('No se pudo guardar preferencias del wizard: ' +
  e.message)`; INSERT de evento `producto_visto` →
  `log.debug('No se pudo registrar evento producto_visto: ' +
  e.message)`; llamada a `stockService.buscarSustitutos()` para
  "también te puede interesar" (sin logging interno propio) →
  `log.debug('No se pudo cargar productos relacionados: ' +
  e.message)`.
- `bot/flows/_shared.js` (9): INSERT de evento `busqueda` en
  `log_eventos`; las 4 ocurrencias idénticas de
  `UPDATE pedidos SET cp=?` repetidas en
  `grabarPedidoPickup`/`Envio`/`Split`/`PickupUnificado` (mismo riesgo
  de typo de columna que el bug de la sección 20.1, ahora con
  `log.debug('No se pudo guardar CP en pedido: ' + e.message)`);
  SELECT de cliente para el saludo personalizado en `menuPrincipal()`;
  el UPDATE dentro de `tagCliente()`; el UPDATE dentro de
  `quitarTag()`; y el INSERT de notificación WhatsApp al asesor dentro
  de `registrarEscalada()` (este último tiene su propio try/catch
  interno separado del catch externo que ya logueaba
  `registrarEscalada error` — sin instrumentar este punto específico,
  un fallo solo de la notificación WhatsApp quedaba invisible aunque
  el resto de la escalada sí se registrara bien).
- `bot/flows/asesorFlow.js` (5): INSERT en `lista_espera` genérica
  (sin producto específico); el catch de CSAT que envuelve el INSERT
  en `valoraciones` (aunque también envuelve `tagCliente`/
  `registrarEscalada`, que ya auto-loguean, el INSERT de la
  calificación misma no tenía ningún logging); INSERT en
  `devoluciones` (la misma tabla del bug real de la sección 20.1 —
  prioridad alta confirmada); INSERT en `cola_atencion` para
  devolución; INSERT en `cola_notificaciones` para notificar la
  devolución al asesor.
- `bot/flows/cartFlow.js` (2): el catch de imagen de oferta
  (`MessageMedia.fromUrl` + `client.sendMessage`) — no es DB, pero es
  el mismo patrón que `menuFlow.js` ya logueaba con
  `log.warn('Imagen no disponible', e)` en la ficha de producto
  normal; por consistencia se agregó `log.warn('Imagen de oferta no
  disponible', e)`; UPDATE de `usos_actual` en `promociones` al
  aplicar un cupón → `log.debug('No se pudo registrar uso de cupón: '
  + e.message)`.

**Confirmados como seguros y dejados sin cambios:**

- `bot/flows/_shared.js`, líneas 3/5/6/7 — `require()` de
  `whatsapp-web.js`, `puntosHandler` y `mensajeService` con fallback,
  y el bootstrap del propio `log` (`require('../logger')`). No son
  fallos de DB sino de carga de módulos opcionales, con fallback ya
  definido en la misma línea; el último además no puede auto-loguear
  su propio fallo de inicialización (mismo caso que el bootstrap de
  `bot/logger.js` en la sección 25).

**Verificación**: `node --check` limpio en los 4 archivos editados;
`node tests/test_bot.js` se mantiene en 117/117 (100%) sin
regresiones.

Pendiente: subprocesos 6.3 a 6.5, uno a la vez por instrucción
explícita del usuario.

## 27. Implementado en Fase JIUA 6.3

Triage de los 3 handlers de lealtad/referidos: `referidosService.js`,
`puntosService.js`, `puntosHandler.js`.

**Instrumentados (3 catches):**

- `bot/handlers/referidosService.js` — INSERT en `cola_notificaciones`
  para avisarle al referente que ganó puntos (`procesarReferidoSiAplica`)
  → `log.debug('No se pudo notificar puntos por referido: ' +
  e.message)`.
- `bot/handlers/puntosService.js` — INSERT en `cola_notificaciones`
  dentro del loop de `checkPuntosInactivos` (recordatorio de puntos sin
  usar) → `log.debug('No se pudo notificar puntos inactivos: ' +
  e.message)`.
- `bot/handlers/puntosHandler.js` — catch que envuelve la llamada a
  `referidosService.asegurarCodigoReferido()` al felicitar al cliente
  por su primer cupón. Esa función no tiene try/catch propio (sus
  `db.prepare()` internos pueden lanzar sin que nadie lo vea) →
  `log.debug('No se pudo asegurar código de referido: ' + e.message)`.

**Verificación**: `node --check` limpio en los 3 archivos; `node
tests/test_bot.js` se mantiene en 117/117 (100%) sin regresiones.

## 28. Implementado en Fase JIUA 6.4

Triage de los 4 services: `stockWatcher.js`, `emailService.js`,
`stockService.js`, `estafetaService.js`.

**Instrumentados (11 catches):**

- `services/stockWatcher.js` (9): SELECT de `lead_score` para calcular
  el descuento del cupón de carrito abandonado (usa 5% por defecto si
  falla) → `log.debug('No se pudo leer lead_score para descuento: ' +
  e.message)`; los 3 catches que envuelven llamadas a `_insertCola()`
  desde `checkOfertasPorVencer`/`checkSeguimiento48h`/
  `checkClientesDormidos` — `_insertCola` ya tiene su propio
  catch-con-fallback interno (reintenta sin la columna `campana`), pero
  si **ambos** intentos fallan (p. ej. tabla completa con problema) el
  error sigue subiendo sin loguear nada, así que estos 3 call-sites
  ahora lo capturan; el SELECT de deduplicación diaria de "alerta stock
  mínimo"; el catch que envuelve el `_insertCola` de esa misma alerta;
  el UPDATE de `lead_score` en `actualizarLeadScores`; el catch que
  envuelve la llamada a `puntosService.checkPuntosInactivos()` (esa
  función no tiene try/catch propio alrededor de su SELECT principal);
  y el bloque del reporte automático diario completo (varios
  `db.prepare()` de lectura de `configuracion`/dedup antes de llamar a
  `reporteService.enviarReporte()`, que sí loguea su propio resultado,
  pero las lecturas previas no).
- `services/emailService.js` (1): INSERT en `cola_emails` al encolar
  la notificación de un pedido nuevo, antes de intentar el envío SMTP
  real → `log.debug('No se pudo encolar email en cola_emails: ' +
  e.message)`.
- `services/estafetaService.js` (1): INSERT en `estatus_envio_log` al
  generar una guía simulada → `log.debug('No se pudo registrar log de
  estatus de envío: ' + e.message)`. Este archivo no tenía logger
  propio (a diferencia del resto de `services/`); se agregó `const log
  = require('../bot/logger')('estafetaService');` siguiendo el mismo
  patrón que `stockWatcher.js`/`emailService.js`.

**Confirmados como seguros y dejados sin cambios:**

- `services/stockService.js` — el único `catch (_) {}` envuelve
  `new Date(...).toLocaleDateString(...)` al formatear la fecha de
  llegada de una preventa; si falla, ya conserva el valor crudo
  (`fechaLlegada = prev.fecha_llegada_est`) como fallback explícito —
  no es DB, es formateo cosmético con su propio plan B ya en el código.
- `services/estafetaService.js`, línea 15 — `require('../bot/flows/
  _config')` con fallback a `{ moduloActivo: () => false }`. Carga de
  módulo opcional, no DB.

**Verificación**: `node --check` limpio en los 4 archivos (incluyendo
el nuevo `require` del logger en `estafetaService.js`); `node
tests/test_bot.js` se mantiene en 117/117 (100%) sin regresiones.

## 29. Implementado en Fase JIUA 6.5 (cierre de Fase JIUA 6)

Triage de los 4 archivos restantes del backlog: `dashboard/server.js`,
`bot/imageAnalyzer.js`, `scripts/backup.js`,
`tests/test_estres_bd.js`.

**Instrumentados (4 catches):**

- `dashboard/server.js` (1): `GET /api/puntos/config`, SELECT que lee
  el flag `puntos_activo` desde `configuracion` → `log.debug('No se
  pudo leer puntos_activo: ' + e.message)`.
- `bot/imageAnalyzer.js` (2): `_limpiarCache()`, el DELETE periódico de
  filas expiradas en `vision_cache` → `log.debug('No se pudo limpiar
  vision_cache: ' + e.message)`; `_cacheSet()`, el INSERT OR REPLACE
  que guarda el resultado de Vision en caché → `log.debug('No se pudo
  guardar en vision_cache: ' + e.message)`. Ninguno de los dos tenía
  logging propio pese a envolver escrituras directas a SQLite.
- `scripts/backup.js` (2): este archivo no usa `bot/logger` (es un
  script standalone con `console.log/warn/error` y prefijo
  `[backup]`), así que se siguió su convención nativa en vez de
  importar el logger del bot. `cargarRegistro()` → `console.warn('[backup]
  No se pudo leer registro:', e.message)` — se instrumenta a pesar de
  que ya tiene un fallback explícito (`return { enviados: [], ...}`),
  mismo criterio que el catch de `sessionManager.js` en 6.1: el
  fallback evita que el script truene, pero no evita que un bug real
  (JSON corrupto, permisos) quede invisible. Dentro de
  `comprimirImagenesNuevas()`, el catch del loop que lee cada imagen
  nueva con `fs.readFileSync(arch.path)` → `console.warn('[backup] No
  se pudo leer imagen ' + arch.nombre + ':', e.message)` — un backup
  incompleto de imágenes de clientes es un riesgo de negocio real
  (evidencia de pedidos/devoluciones) y antes fallaba en silencio.

**Confirmados como seguros y dejados sin cambios:**

- `dashboard/server.js`, `getDashboardHTML()` — el catch envuelve
  `fs.existsSync`/`fs.readFileSync` sobre `dashboard.html` (legacy, ya
  no es la ruta principal ahora que existe `dashboard-ui/dist`); si
  falla, la siguiente línea ya devuelve un HTML de error visible al
  usuario (`'<html>...Error: dashboard.html no encontrado...'`), así
  que no hay nada silencioso — el fallo es inmediatamente observable
  en el navegador.
- `bot/imageAnalyzer.js`, `_cacheGet()` — no es un catch vacío
  (`catch (_) { return null; }` tiene cuerpo), por lo que cae fuera
  del alcance literal de este backlog (solo `catch(_) {}` /
  `catch (_) {}` completamente vacíos); no se tocó.
- `tests/test_estres_bd.js`, `limpiarFixtures()` (11 catches) — todos
  envuelven `DELETE` de limpieza de fixtures de un test de estrés,
  bajo un comentario explícito en el propio código ("se ejecuta
  siempre, pase lo que pase"). Se trata como categoría "esperada":
  código de limpieza de pruebas, no de producción, diseñado a
  propósito para degradar con gracia entre tablas que pueden no
  existir o no tener filas. Instrumentar los 11 añadiría ruido a cada
  corrida normal de test sin beneficio real — excepción de
  "leniencia para archivos de test" aplicada por primera vez en esta
  sub-fase.

**Verificación**: `node --check` limpio en `dashboard/server.js`,
`bot/imageAnalyzer.js`, `scripts/backup.js`,
`tests/test_estres_bd.js` (sin cambios, solo confirmado); `node
tests/test_bot.js` se mantiene en 117/117 (100%) sin regresiones.

**Cierre de Fase JIUA 6**: las 5 sub-fases (6.1-6.5) cubrieron los 19
archivos del backlog de §22. Total instrumentado en toda la fase: 20
(6.1) + 20 (6.2) + 3 (6.3) + 11 (6.4) + 4 (6.5) = 58 catches vacíos
convertidos en catches con logging de contexto, sin alterar ningún
flujo de control. El resto de catches revisados y dejados sin cambios
quedó documentado caso por caso en cada sub-fase, con la razón
específica (fallback ya explícito y visible, función ya
auto-logueada, carga de módulo opcional, o limpieza de test
best-effort).

## 30. Auditoría de expertos simulada — comité multidisciplinario sobre el ecosistema completo

Por instrucción explícita del operador, esta pasada del loop (sección
11/20) cambia de alcance respecto a las anteriores: en vez de revisar
solo el cambio recién desplegado (Fase JIUA 6), tres perspectivas de
revisor — **seguridad**, **confiabilidad/manejo de errores**, **lógica
de negocio** — se aplican simultáneamente contra **todo el ecosistema
de soluciones** (bot + dashboard + services + scripts + tests), no
contra una sola feature. Cada perspectiva trabajó de forma
independiente, leyendo código real (no solo grep) y verificando contra
las secciones 1-29 de este documento qué ya estaba cerrado, para no
re-reportar hallazgos ya resueltos.

### Hallazgos — seguridad

1. **(Confirmado y corregido) Path traversal vía `mimetype` controlado
   por el remitente — `bot/index.js:687`.** La extensión del archivo
   de imagen guardado en `bot/imagenes_clientes/` se derivaba
   directamente de `media.mimetype.split('/')[1].split(';')[0]`, un
   campo del protocolo de WhatsApp que el remitente controla por
   completo (no hay whitelist de MIME en ningún punto del repo). En
   Windows (plataforma soportada, ver `start.bat`), `path.join` trata
   `\` como separador, así que un mimetype como
   `image/jpeg..\..\..\evil` permite escribir fuera del directorio
   esperado. Corregido con un mapa explícito de extensiones permitidas
   (`{'image/jpeg':'jpg','image/png':'png','image/webp':'webp',
   'image/gif':'gif'}`, default `'jpg'`) en vez de derivar del string
   crudo.
2. (Revisado, sin hallazgo) Inyección de cabeceras SMTP vía nombre de
   cliente en `emailService.js` — el `Subject` se codifica en base64
   antes de escribirse al socket SMTP, neutralizando CRLF injection;
   `To`/`From` nunca usan input de cliente. Se documenta el porqué es
   seguro para que un futuro refactor (ej. quitar el base64 del
   Subject "por legibilidad") no reabra el hueco sin querer.
3. (Revisado, sin hallazgo) Credenciales de Vision API, arquitectura
   de sesión/auth del dashboard (`requireSession`, scrypt+salt,
   lockout, traversal guard de `serveStatic`), rutas de gestión de
   usuarios Prime — todo confirmado sólido, sin cambios.

### Hallazgos — confiabilidad/manejo de errores

1. **(Confirmado y corregido) Un check que falla cancela todos los
   siguientes del mismo ciclo, para siempre — `services/
   stockWatcher.js:539-558` (`runAll`).** Los ~11 checks (lista de
   espera, alertas, preventas, CSAT, seguimiento, quejas, carritos
   abandonados, stock mínimo, clientes dormidos, lead score, eventos)
   compartían un único `try` externo; solo el bloque del reporte
   automático diario tenía su propio try/catch (por el fix de la
   sección 20.1). Es la misma forma de bug que el ya corregido en Fase
   5 (`creado_en`/`creada_en`), pero estructural en vez de un typo: un
   solo check roto deja de ejecutar — silenciosamente — todo lo que
   viene después, ciclo tras ciclo, porque el worker corre con el
   mismo código determinista cada hora. Corregido envolviendo cada
   check individualmente con un helper `_runCheck(fn, nombre)` que
   loguea (`log.warn`) y continúa en vez de abortar el resto.
2. **(Hallazgo, escalado a Fase 7) Ventana de crash entre acreditar
   puntos y emitir el cupón — `bot/handlers/puntosService.js:129-178`
   (`reclamarTicket`/`_emitirCupon`).** La transacción que acredita
   puntos y bloquea el ticket (`puntos_reclamados=1`) es separada de
   la emisión del cupón de 2000 puntos, que ocurre después, fuera de
   esa transacción. Si el proceso se cae entre ambos pasos, el cliente
   ya gastó su ticket (no se puede reclamar dos veces) pero no tiene
   cupón — y `checkPuntosInactivos()` solo envía un recordatorio, no
   repara el cupón faltante. No se corrige en esta pasada porque el
   fix correcto requiere decidir diseño (meter la emisión en la misma
   transacción vs. agregar un job de reconciliación en
   `stockWatcher.js`), no es un cambio mecánico de una línea.
3. **(Hallazgo, escalado a Fase 7) `cola_notificaciones` sin manejo de
   "dead letter" — `bot/index.js:416`.** Una fila que falla 3 veces
   (`intentos<3` deja de seleccionarse) queda parada en `estatus=
   'pendiente'` para siempre, visible solo como un contador pasivo en
   el dashboard (`/api/cola/reintentar` es manual). No hay alerta
   automática ni expiración. Candidato: que `stockWatcher` marque
   filas con `intentos>=3` y antigüedad > N horas como alerta real en
   `cola_atencion`, no solo un contador.
4. **(Hallazgo, escalado a Fase 7) Pedido sin guía generada no se
   marca de forma visible — `bot/flows/_shared.js:678-696` +
   `dashboard/server.js` (`/api/pedidos`, `LEFT JOIN
   guias_estafeta`).** `grabarPedidoEnvio` ya degrada con gracia
   (`guiaData=null` si falla la generación), así que no hay doble
   cobro ni pedido perdido, pero un pedido sin guía solo se nota si un
   humano escanea la tabla manualmente — no hay filtro ni entrada en
   `cola_atencion` para "pedido pagado sin guía después de X tiempo".

### Hallazgos — lógica de negocio

1. **(Confirmado y corregido) Cupón se puede "apilar" sin querer,
   quemando el anterior sin que nadie se beneficie — `bot/flows/
   cartFlow.js:169-171`.** Desde `CONFIRM_ORDER`, la opción "3. Tengo
   un cupón" siempre transicionaba a `S.CUPON` sin verificar si
   `data.idPromo` ya existía. Si el cliente aplicaba un segundo
   código, el primero quedaba con su `usos_actual` ya incrementado
   (consumido) pero sustituido en sesión sin que su descuento se
   hubiera cobrado — violando la regla de negocio "single use, not
   stackable" de forma silenciosa. Corregido: si `data.idPromo` ya
   existe, la opción 3 ahora responde que ya hay un cupón aplicado en
   vez de permitir uno nuevo.
2. **(Confirmado y corregido) Carrera en el canje de cupón — SELECT
   luego UPDATE sin guarda atómica — `bot/flows/cartFlow.js:290` y
   `dashboard/server.js:1389` (`/api/cupon/redimir`).** El flujo
   `SELECT ... WHERE usos_actual<usos_max` → `UPDATE usos_actual=
   usos_actual+1 WHERE id=?` no estaba en una transacción ni usaba un
   UPDATE con guarda — dos canjes simultáneos del mismo código de un
   solo uso (ej. WhatsApp + POS, o dos cajeros) podían pasar ambos el
   SELECT antes de que cualquiera corriera el UPDATE. Corregido en
   ambos call-sites con `UPDATE promociones SET usos_actual=
   usos_actual+1 WHERE id=? AND (usos_max=0 OR usos_actual<usos_max)`,
   chequeando `changes===0` para rechazar el canje si alguien más ya
   lo agotó entre el SELECT y el UPDATE.
3. **(Hallazgo, requiere confirmación de negocio — escalado a Fase 7)
   `calcularFechaEntrega` en `services/estafetaService.js` trata el
   sábado como día hábil.** El código solo excluye domingo
   (`getDay()===0`); un pedido de viernes después del corte de 2pm
   cotiza envío sábado y entrega martes, contando sábado como uno de
   los "2 días hábiles". El comentario del archivo dice "2 días
   hábiles" sin aclarar si Estafeta realmente opera sábados en este
   negocio. No se cambia el código sin confirmar la regla real con el
   negocio — un cambio a ciegas podría romper fechas que hoy son
   correctas si Estafeta sí trabaja sábados en San Luis Potosí.
4. **(Hallazgo, documentado sin acción — limitación de diseño "Fase
   1", no un bug) `services/stockService.js` no usa la ubicación real
   del cliente para rankear sucursales.** `buscarEnRedNacional`
   ordena solo por un mapa fijo `DIAS_ENTREGA` por sucursal, sin
   recibir el CP/estado del cliente; el costo de envío es un flat
   `$149` sin importar distancia real. Consistente con que la
   integración real de Estafeta (ruteo/costo dinámico) ya está
   marcada como "Fase 2" pendiente en el resto del proyecto — no se
   trata como bug nuevo.

## 31. Implementado a partir del comité multidisciplinario (sección 30)

**Corregidos en esta pasada (4 fixes mecánicos/contenidos, alta
confianza, bajo radio de impacto):**

- `bot/index.js` — whitelist de extensión de imagen en vez de derivar
  del `mimetype` crudo del remitente (hallazgo seguridad #1).
- `services/stockWatcher.js` — `runAll()` aísla cada check con
  `_runCheck()` para que uno roto no cancele el resto del ciclo
  (hallazgo confiabilidad #1).
- `bot/flows/cartFlow.js` — bloquea aplicar un segundo cupón si ya
  hay uno en sesión (hallazgo lógica de negocio #1); UPDATE atómico
  con guarda `usos_actual<usos_max` al registrar el uso (hallazgo
  lógica de negocio #2, mitad 1/2).
- `dashboard/server.js` — mismo UPDATE atómico con guarda en `/api/
  cupon/redimir` (hallazgo lógica de negocio #2, mitad 2/2).

**Verificación**: `node --check` limpio en los 4 archivos; `node
tests/test_bot.js` se mantiene en 117/117 (100%); `node tests/
test_marketing.js` (18/18) y `node tests/test_dashboard_control.js`
(14/14) — incluyendo el caso ya existente "NO permite redimir dos
veces un cupón de usos_max=1" — siguen pasando sin regresiones con el
nuevo UPDATE atómico.

## 32. Hallazgos escalados a Fase JIUA 7

1. Reconciliación de cupón de puntos faltante tras un crash entre
   acreditar puntos y emitir el cupón (`puntosService.js` — sección
   30, confiabilidad #2).
2. Manejo de "dead letter" / alerta real para `cola_notificaciones`
   con `intentos>=3` (sección 30, confiabilidad #3).
3. Marcar de forma visible (filtro o `cola_atencion`) un pedido pagado
   sin guía de envío generada después de cierto tiempo (sección 30,
   confiabilidad #4).
4. Confirmar con el negocio si Estafeta opera sábados en la zona de
   reparto real, y ajustar `calcularFechaEntrega` en consecuencia
   (sección 30, lógica de negocio #3) — requiere decisión humana, no
   solo código.
5. (Baja prioridad, sin acción inmediata) Ruteo de sucursal por
   ubicación real del cliente en `stockService.js`, ya documentado
   como limitación de "Fase 1" consistente con el resto del proyecto
   (sección 30, lógica de negocio #4).

## 33. Siguiente paso

Desplegar la sección 31 (push ya realizado en el commit
correspondiente) y mantener la sección 32 como backlog de Fase JIUA 7,
a iniciar cuando el operador lo indique — empezando idealmente por el
hallazgo #1 (reconciliación de cupón de puntos), que es el de mayor
impacto potencial en confianza del cliente (puntos gastados sin
recompensa), seguido de #2 y #3 (ambos mejoran visibilidad operativa
sin requerir decisiones de negocio externas). El hallazgo #4 queda
bloqueado hasta que el negocio confirme la regla real de operación de
Estafeta en sábado.

## 34. Feature: programa de referidos disparado por primera compra + días de entrega configurables

A petición del operador, se resolvieron tres puntos del backlog de la
sección 32 (#4 y la ambigüedad de puntos) más una corrección de
comportamiento del programa de referidos existente, en una sola
pasada — implementación, verificación y este registro.

**1. El mensaje de código de referido ahora solo lo dispara la
primera compra finalizada del cliente — nada más.**

Antes, `bot/handlers/referidosService.js#procesarReferidoSiAplica`
otorgaba los 100 puntos al referente y mandaba la notificación
inmediatamente al detectar el código `REF-XXXXXXXX` en el primer
mensaje del cliente nuevo (antes de cualquier compra). El operador
corrigió explícitamente esto: el código propio y los puntos al
referente deben otorgarse únicamente cuando el cliente referido
completa su primera compra finalizada — ni en el primer contacto, ni
al confirmar la entrega, ni en ningún otro punto.

- `procesarReferidoSiAplica` quedó reducido a **solo vincular**
  `clientes.referido_por_id` (sin tocar puntos ni notificaciones). Se
  llama sin cambios desde `bot/index.js#registrarContactoEntrante`
  (única vez que un cliente nuevo entra a la tabla `clientes`).
- Función nueva `otorgarPuntosPorPrimeraCompra(idCliente)`: único
  disparador real. Se cuelga del único hook point identificado en la
  sección 30/31 — `POST /api/pagos/:id/marcar-pagado`
  (`dashboard/server.js`), dentro del `if (ped && /pendiente/i.test(...))`
  que ya garantiza ejecución única por pedido (la guarda anti-doble-
  cobro existente sirve también de guarda de idempotencia para esto).
  Determina "primera compra finalizada" contando pedidos del cliente
  con `estatus IN ('confirmado','preparando','enviado','entregado')`
  — si el conteo es exactamente 1, es la primera; si es 0 o ≥2, no
  hace nada (cubre tanto compras posteriores como pedidos confirmados
  manualmente vía `PUT /api/pedidos/:id` antes de pasar por aquí).
  Si aplica: manda al comprador su propio código (vía
  `asegurarCodigoReferido`, ya existente) avisando el tope semanal de
  3; si el comprador llegó referido y el referente no ha llegado al
  tope semanal (`MAX_REFERIDOS_SEMANA=3`, sin cambios — se descartó la
  idea de tope mensual), acredita 100 puntos al referente e inserta la
  fila en `referidos` (que ahora se crea en el momento de la compra,
  no del contacto). La fila en `referidos` es también la guarda
  anti-doble-acreditación si esta función se llamara dos veces para
  el mismo cliente.

**2. Apagador de campaña en el dashboard ("matar la campaña sin tocar
código").**

Nueva clave `configuracion.referidos_activo` (default activo, igual
que el resto de módulos no críticos — falla abierto si la tabla no
existe). Función `referidosActivo()` gatea tanto
`procesarReferidoSiAplica` como `otorgarPuntosPorPrimeraCompra`: en
`'0'`, ninguna de las dos hace nada (ni vincula, ni manda mensajes, ni
otorga puntos). Reutiliza el patrón genérico ya existente — se agregó
`'referidos_activo'` al enum de `ModuloConfigSchema`
(`bot/validators.js`) y la clave al arreglo `MODULOS` de
`dashboard-ui/src/pages/Modulos.jsx`; el toggle ya funcionaba
genéricamente vía `POST /api/puntos/config` y la lectura de estado vía
`GET /api/modulo/:clave` — cero rutas nuevas en el backend para esto.

**3. Ambigüedad de puntos:** ya estaba resuelta — el keyword "mis
puntos" (`puntosHandler.js`, sección "Consultar saldo") ya permite a
cualquier cliente, identificado por su `userId`/teléfono, preguntar su
saldo en cualquier momento. No se necesitó código nuevo. Se removió el
bloque viejo en `puntosHandler.js` que invitaba a compartir el código
de referido al ganar el primer cupón de 10% — ese disparador quedó
obsoleto por el punto 1.

**4. Días de entrega de Estafeta configurables por Prime (cierra
hallazgo #4 de la sección 32, sin requerir confirmar si Estafeta
trabaja sábados):** en vez de bloquear el cambio hasta confirmar la
operación real de sábado, el operador decidió que Prime pueda ajustar
el número directamente (útil en fechas como navidad, donde los
pedidos se retrasan más sin que haya una regla fija que codificar).
`services/estafetaService.js#calcularFechaEntrega` ahora usa
`configuracion.estafeta_dias_entrega` (fallback 2, el valor
hardcodeado anterior) en vez de la constante `DIAS_ENTREGA` fija. La
lógica de excluir solo domingos (no sábados) se deja sin cambios —
confirmado correcto por el operador. Nuevo par
`GET`/`PUT /api/prime/estafeta-dias-entrega` (solo rol `prime`,
mismo patrón que `/api/prime/envio-default`), validado como entero
1-30; control nuevo en `dashboard-ui/src/pages/Prime.jsx`.

**Verificación:**
- `node --check` limpio en los 8 archivos tocados (`bot/handlers/
  referidosService.js`, `bot/handlers/puntosHandler.js`,
  `bot/validators.js`, `dashboard/server.js`,
  `services/estafetaService.js`, `bot/index.js` y los dos `.jsx`).
- `node tests/test_bot.js`: 117/117 sin cambios.
- `node tests/test_marketing.js` (18/18), `test_dashboard_control.js`
  (14/14), `test_lealtad.js` (10/10): sin regresiones.
- **Test nuevo** `tests/test_referidos.js` (19/19) — a diferencia de
  `test_lealtad.js`/`test_marketing.js` (que replican el SQL a mano),
  este intercepta `require('../db_connection')` con un
  `better-sqlite3` en memoria real (mismo patrón de `Module._load` que
  `test_bot.js`) y **requiere el módulo real**
  `bot/handlers/referidosService.js`, así que ejerce el código real,
  no una réplica. Cubre: vinculación sin otorgamiento en el primer
  contacto, no reasignación de un vínculo ya hecho, otorgamiento
  correcto en la primera compra (mensaje al comprador + tope semanal
  anunciado + puntos y notificación al referente), idempotencia ante
  una segunda compra del mismo cliente, comportamiento correcto al
  llegar al tope semanal (el comprador sigue recibiendo su código; el
  referente no se acredita), y el apagador `referidos_activo='0'`
  desactivando ambas funciones por completo.

**Siguiente paso del loop:** desplegar (push de esta pasada) y dejar
abierta para la siguiente auditoría la única deuda identificada en el
diseño — `otorgarPuntosPorPrimeraCompra` no tiene guarda propia contra
ser invocada dos veces para *la misma* transición pendiente→confirmado
(hoy depende enteramente de que su único llamador,
`/api/pagos/:id/marcar-pagado`, solo entre a ese bloque una vez por
pedido). Es de bajo riesgo porque ese llamador ya es la guarda
identificada y verificada en la sección 30/31, pero si en el futuro se
agrega un segundo camino hacia "primera compra confirmada" (por
ejemplo, confirmarla a mano vía `PUT /api/pedidos/:id` sin pasar por
el link de pago), habría que llamar a esta misma función desde ahí
también — el operador pidió explícitamente que, por ahora, nada más
dispare este flujo, así que se deja fuera de alcance a propósito.

## 35. Auditoría de expertos simulada — comité de 6 roles sobre el estado actual del proyecto completo

Por instrucción explícita del operador ("audita con el comite... todo el
proyecto para ver el estado actual"), esta pasada del loop usa un comité
distinto al de la sección 30: en vez de las 3 perspectivas de seguridad/
confiabilidad/lógica de negocio, se aplican **6 roles** —
**Arquitecto**, **Ingeniero de Datos**, **Ingeniero de IA**,
**Desarrollador**, **Diseñador Conversacional** y **Seguridad** — cada
uno trabajando de forma independiente sobre todo el ecosistema (bot +
dashboard + dashboard-ui + services + scripts + tests + desktop), leyendo
código real con cita `archivo:línea`, sin verificar contra hallazgos ya
cerrados de secciones anteriores (a diferencia de la sección 30, esta
pasada es un corte transversal de "estado actual", no un diff contra la
última feature). El objetivo es diagnóstico, no de corrección inmediata
— los hallazgos que requieren cambio de código se escalan al cierre de
la sección como candidatos de Fase JIUA 8, no se implementan en esta
pasada.

### Rol 1 — Arquitecto (estructura y escalabilidad)

1. **(Sin hallazgo, positivo) SQLite WAL + caché de configuración (60s)
   + jitter en el envío de cola (`bot/index.js:559`,
   `bot/flows/_config.js:16-17`) son decisiones deliberadas y
   documentadas, no deuda técnica accidental.** El polling de 30s sobre
   `cola_notificaciones` con jitter de 1.5-3s es anti-detección de
   WhatsApp, no ineficiencia.
2. **(Hallazgo, alta) `dashboard/server.js` (2065 líneas, 239 llamadas
   `db.prepare/.run/.get/.all`) no tiene capa de servicio — el SQL vive
   mezclado con el parseo HTTP en la misma función `handleAPI`.** Es la
   razón por la que los "contract tests" (`test_lealtad.js`,
   `test_marketing.js`, `test_dashboard_control.js`) tienen que
   *reimplementar* el SQL a mano en vez de importar una función pura
   testeable.
3. **(Hallazgo, alta) No hay gestión de migraciones versionada.**
   `db/schema.sql:1-11` lo declara explícitamente: nunca existió un
   schema consolidado, cada tabla se creó a mano contra producción.
   `migraciones_pendientes/` (el único mecanismo ad-hoc que existió)
   fue borrado tras aplicarse manualmente. No hay `umzug`/`knex` ni tabla
   `schema_migrations` — cualquier cambio de esquema futuro depende de
   que un humano recuerde aplicarlo a mano en producción.
4. **(Hallazgo, media) `bot/flows/_shared.js` (983 líneas) concentra 6
   responsabilidades de dominio distintas** (búsqueda de productos,
   wizard, matemática de carrito, cupones, partición de stock,
   persistencia de pedidos) en un solo módulo, a diferencia del router
   de flows (`STEPS` arrays bien delimitados por archivo), que sí escala
   bien.
5. **(Sin hallazgo, positivo) El fork de `stockWatcher` con fallback
   in-process y backoff exponencial real (10s→300s, `bot/index.js:
   516-531`) está mejor diseñado que muchas integraciones de
   `bull`/`agenda` mal configuradas** — el riesgo real no es el patrón
   de fork sino que el *contenido* de `stockWatcher.js` (611 líneas: 4
   automatizaciones de marketing + stock + waitlist + CSAT) siga
   creciendo dentro de un solo archivo.

Conclusión del Arquitecto: la arquitectura de un proceso bot + un
proceso dashboard sobre SQLite WAL está bien calibrada para el volumen
actual, con trade-offs explícitos y documentados. El riesgo real no es
de concurrencia sino de **mantenibilidad** — la ausencia de migraciones
versionadas y la falta de capa de servicio en `dashboard/server.js` ya
duelen hoy y se agravan con cualquier crecimiento del equipo o esquema,
antes de que SQLite mismo sea el cuello de botella.

### Rol 2 — Ingeniero de Datos (pipelines de captura para aprendizaje)

1. **(Sin hallazgo, positivo) La captura de intents fallidos ya existe y
   es más madura de lo esperado.** `bot/flows/_shared.js:181-187`
   registra cada búsqueda en `log_eventos(tipo_evento='busqueda',
   resultados=matches.length)` (conteo real, sin contar rellenos de
   stock); `bot/sessionManager.js:55-74` detecta y marca abandono
   silencioso post-búsqueda-sin-match. `db/schema.sql:408` incluso
   describe `log_eventos` en un comentario como "la base de datos de
   entrenamiento futura".
2. **(Hallazgo, media) La atribución búsqueda→venta usa `LIKE` difuso
   sobre teléfono en vez de `id_cliente`** —
   `services/stockWatcher.js:509-533`
   (`c.telefono LIKE '%' || ev.telefono || '%'`), lo que puede dar
   falsos positivos/negativos con números parcialmente repetidos. No es
   un dataset limpio con clave confiable.
3. **(Hallazgo, media-alta) Vision API no persiste el par
   (imagen, etiquetas) reutilizable para entrenar un modelo propio.**
   `bot/imageAnalyzer.js:50-58,86-91`: `vision_cache` guarda
   `labels_json`/`query_text` pero el hash se calcula sobre un *prefijo
   truncado* del base64 (línea 441) y no hay columna que vincule esa
   fila con el archivo real guardado en `bot/imagenes_clientes/` — son
   dos rutas de persistencia desconectadas.
4. **(Hallazgo, alta para el objetivo de negocio) El A/B de tonos
   (`bot/flows/_config.js`, 4 tonos) es un toggle ciego, sin
   instrumentación.** Cero columnas `tono` en `log_eventos`,
   `pedidos` o cualquier tabla transaccional — hoy es imposible
   responder "¿el tono D convierte más que el C?" con los datos
   capturados.
5. **(Hallazgo, baja-media) `metricas_bot` existe en el esquema
   (`db/schema.sql:521-527`) pero nunca se le escribe** (cero `INSERT
   INTO metricas_bot` en todo el repo) — es una tabla aspiracional, no
   usada; `/api/conversion` calcula todo on-the-fly con una aproximación
   gruesa (`pedidos/clientes_activos`).
6. **(Hallazgo, baja) No hay ningún proceso ETL/export hacia fuera del
   sistema transaccional** — `scripts/` solo tiene backup y batch de
   catálogo, ningún export a CSV/warehouse para análisis externo.

Conclusión del Ingeniero de Datos: la captura está más madura de lo que
sugería la hipótesis inicial — `log_eventos`/`valoraciones`/
`cola_atencion` ya son estructurados y consultables. El gap más grande es
doble: el A/B de tonos no se mide (toggle sin trazabilidad) y Vision API
descarta el contexto imagen-etiqueta necesario para un futuro clasificador
propio. Antes de cualquier pipeline de ML real, lo prioritario es atar
`tono` a cada interacción/venta y persistir el par (imagen, labels) de
forma reconstruible.

### Rol 3 — Ingeniero de IA (rendimiento del modelo, precisión, aprendizaje)

1. **(Hecho explícito por el propio código) No hay modelo entrenado en
   ningún punto del sistema.** `bot/intentDetector.js:4` lo declara:
   "hoy es 100% regex/listas, sin scoring real". El regex de intención de
   compra (`INTENT_RE`) está anclado al inicio de cadena — cualquier
   frase que no empiece con uno de los ~80 verbos listados no dispara,
   sin importar el contexto.
2. **(Hallazgo, media) Los pesos de `searchProducts`
   (`bot/flows/_shared.js:148-161`: nombre+10, seoDesc+5, tags+3, cat+2,
   umbral "buen match" ≥10) son constantes fijas sin respaldo
   estadístico** — nunca se midió cuál señal predice mejor una compra
   real.
3. **(Sin hallazgo, positivo con matiz) `quejaCheck` es la heurística
   más sofisticada del repo** (2+ hits L1, o 1+ hit L2, o 1 hit L1 + tono
   agresivo, fuzzy matching Levenshtein acotado a L1) **pero los propios
   tests documentan gaps conocidos sin resolver**
   (`tests/test_bot.js:307-317`: "no llgo mi pedido", "es una estfa" no
   se detectan hoy) — los falsos negativos están catalogados, no
   corregidos.
4. **(Hallazgo, baja) `esFrustracion` tiene una excepción ad-hoc de solo
   2 palabras ('bueno','oye') para evitar falsos positivos de muletillas
   mexicanas** (`bot/index.js:127-144`) — ajuste manual fino basado en
   intuición, no en datos reales.
5. **(Hallazgo, alta para el marco conceptual del rol) Cero feedback
   loop automatizado.** La única personalización dinámica
   (`_refrescarPersonalizadas()`, `bot/index.js:116-124`) permite a un
   rol prime agregar palabras vía dashboard sin redeploy, pero sigue
   siendo edición manual humana, no aprendizaje del sistema.
6. **(Hallazgo, alta, coincide con el Ingeniero de Datos) Tono A/B/C/D
   es selección manual sin medición de conversión** — mismo hallazgo
   que el rol de Datos, confirmado independientemente.
7. **(Sin hallazgo, positivo) Vision API tiene degradación correcta**
   (`MIN_CONFIDENCE=0.60` fijo, timeout 5s, mensajes de fallback claros)
   pero el umbral nunca se calibra contra resultados reales y el
   diccionario `LABEL_TRANSLATIONS` es estático mantenido a mano.
8. **(Sin hallazgo, positivo) Sí existen tests de precisión reales**
   (suites `queja`/`frustracion` en `test_bot.js` con casos
   DETECTAR/IGNORAR explícitos), el único punto del proyecto donde se
   mide precisión contra un dataset fijo — aunque ese dataset es estático
   y no se alimenta de casos reales de producción.

Conclusión del Ingeniero de IA: no existe aprendizaje constante en este
sistema en ningún sentido del término — cero modelos entrenados, cero
reentrenamiento, cero feedback loop automatizado. Es, literalmente,
heurísticas estáticas mantenidas a mano con buena disciplina de
ingeniería defensiva (fallbacks, fail-closed, tests de regresión), pero
sin ningún componente que se ajuste solo con el tiempo o con datos de uso
real.

### Rol 4 — Desarrollador (dashboard UI y conectividad API)

1. **(Hallazgo, media, deuda ya materializada) El patrón "if plano +
   substring" de `handleAPI` ya causó un bug de orden de rutas real.**
   El propio código documenta en `dashboard/server.js:1909-1910` que
   `/api/puntos/ranking` debe declararse **antes** del catch-all
   `p.startsWith('/api/puntos/')` (línea 1924), que de otro modo
   intercepta "ranking" como si fuera un teléfono. Cualquier ruta nueva
   bajo ese prefijo necesita el mismo cuidado manual, sin que nada en el
   archivo lo fuerce.
2. **(Hallazgo, baja) Naming inconsistente** — `POST /api/puntos/config`
   es en realidad el endpoint genérico para activar/desactivar
   *cualquier* módulo (confirmado por `Modulos.jsx:46`), no solo el de
   lealtad.
3. **(Hallazgo, baja) Manejo de errores HTTP consistente con
   excepciones de transporte** — 404/413/415/429 responden texto plano
   en vez del formato `{ok,error}` usado en el resto de rutas de
   negocio; el frontend nunca llega a esos casos en la práctica.
4. **(Sin hallazgo, verificado) `BotStatusWidget.jsx` hace cleanup
   correcto de sus `setInterval` y listeners** — sin fetch zombie tras
   desmontar.
5. **(Sin hallazgo, verificado) Los roles Prime están protegidos en el
   backend, no solo en la UI.** Las 24 rutas `/api/prime/*` pasan por
   `requireSession(req, res, ['prime'])` sin excepción
   (`dashboard/server.js:1492-1813`); `Layout.jsx:32` solo oculta el
   link del sidebar, que es UX, no el control de acceso real.
6. **(Sin hallazgo, baja) Sin duplicación de reglas de negocio
   frontend/backend** — el frontend confía en el 400 de Zod del backend
   y muestra `e.message`, no reimplementa validación.

Conclusión del Desarrollador: el dashboard es funcional y la separación
de responsabilidades (sesiones, roles, Zod) está bien pensada para el
tamaño actual del proyecto, pero `server.js` ya muestra fatiga de
escala — el bug de orden de rutas en `/api/puntos/*` es la prueba de que
el patrón "if plano + substring" no escala sin disciplina manual
constante. El frontend está más sano que el backend en este eje.

### Rol 5 — Diseñador Conversacional (calidad de interacción y conversión)

1. **(Hallazgo, alta, mayor impacto en conversión) El checkout por envío
   requiere más del doble de pasos que pickup.** Pickup: 4 mensajes del
   cliente (carrito→CP→elegir pickup→confirmar). Envío: 9 mensajes,
   porque `bot/flows/addressFlow.js:64-84` captura nombre, calle,
   colonia, ciudad y referencia en **5 mensajes secuenciales separados**,
   sin reutilizar la dirección de un cliente recurrente si ya existe en
   `clientes`/`direcciones_envio`.
2. **(Hallazgo, media) Diferenciación de tonos floja en mensajes de
   soporte/utilidad.** `bot/flows/_config.js:79-83` (wizard_q1): A y C
   son texto idéntico salvo el emoji — la diferenciación sí es real en
   mensajes de venta clave (`saludo_nuevo`, `agregado_pagar`) pero no en
   el wizard.
3. **(Sin hallazgo, positivo) Recuperación de carrito abandonado es una
   secuencia real de 3 touchpoints, no un solo mensaje** — 2h
   (pregunta), 24h (cupón dinámico 5/10/15% por lead_score, 48h de
   validez), 30 días (puntos inactivos).
4. **(Sin hallazgo, positivo) Escalación a humano es rápida** — queja se
   escala al segundo mensaje detectado, frustración en el primero; el
   cliente no tiene que "pelear" varios turnos con el bot.
5. **(Hallazgo, baja, intencional por segmento) Tono A es notablemente
   corporativo para WhatsApp mexicano** (`_config.js:110`:
   "Ha ocurrido un error en el sistema. Le pedimos escribir hola...") —
   válido para el segmento formal, pero no es el tono default (C lo es).
6. **(Sin hallazgo, verificado) La regla "gratis solo describe envío,
   nunca precio" se cumple sin excepciones** en los textos revisados de
   `orderFlow.js`, `addressFlow.js` y `_config.js`.

Conclusión del Diseñador Conversacional: la capa conversacional está bien
construida en los puntos de mayor impacto (recuperación de carrito
multi-touch, escalación rápida, regla "gratis" sin fugas), pero el
embudo de checkout por envío es objetivamente más largo de lo necesario
por capturar dirección campo-por-campo sin reutilizar datos de clientes
recurrentes — es la fricción con mayor probabilidad de perder ventas
reales hoy.

### Rol 6 — Seguridad (protección de datos y cumplimiento normativo)

1. **(Sin hallazgo, positivo) Redacción de teléfonos en logs es
   consistente** — `bot/logger.js:38-50` aplica regex tanto a
   `meta.userId` como a texto libre/`stack`, y los call sites de
   producción (`bot/index.js`, `bot/sessionManager.js`,
   `dashboard/server.js`) pasan el teléfono siempre vía `{userId}`. El
   único caso sin redactar encontrado es un `console.log` en
   `tests/test_estres_bd.js:244`, código de test, no de producción.
2. **(Sin hallazgo, positivo) Hashing de contraseñas correcto** —
   `scryptSync` con salt aleatorio de 16 bytes por usuario (3 puntos
   independientes de generación) y comparación a tiempo constante
   (`safeEqual`, `bot/validators.js:9-13`), sin logging de hash/salt en
   ningún punto.
3. **(Hallazgo, media) CSP con `'unsafe-inline'` en `script-src` y
   `style-src`** (`dashboard/server.js:255`) — anula buena parte de la
   mitigación XSS que CSP debería dar; CORS sí está bien acotado a
   origen fijo, no wildcard.
4. **(Hallazgo, alta, requiere decisión de negocio) Backup completo de
   la DB de clientes viaja por correo solo comprimido con gzip, sin
   cifrado de contenido.** `scripts/backup.js` (`comprimirArchivo`) usa
   `zlib.gzip` puro — no es cifrado. El adjunto base64 viaja protegido
   solo por la capa STARTTLS del transporte SMTP; si la cuenta de correo
   de destino o cualquier copia intermedia queda expuesta, el backup
   completo (teléfonos, nombres, direcciones) es legible sin password
   adicional. El correo de destino real del negocio queda además
   hardcodeado en un comentario del propio archivo
   (`scripts/backup.js:25-26`).
5. **(Hallazgo, alta, requiere decisión de negocio) Sin cifrado en
   reposo de la base de datos.** `bot/db_connection.js` abre SQLite
   estándar (WAL, busy_timeout, foreign_keys) sin `PRAGMA key`
   (SQLCipher) ni cifrado de columnas — teléfono, nombre y dirección se
   almacenan en claro, protegidos solo por permisos de filesystem.
6. **(Hallazgo, alta, vacío de cumplimiento LFPDPPP) No existe política
   de retención ni borrado/anonimización real de datos de clientes.**
   Los únicos `DELETE FROM clientes` encontrados
   (`bot/actionHandler.js:75-108`, `dashboard/server.js:1240-1267`) son
   mecanismos de **reset de beta-testing** gateados por
   `BETA_RESET_CODE`, no un derecho de borrado (ARCO) accesible a un
   cliente real ni una purga automática por antigüedad. Tampoco hay
   limpieza programada de `bot/imagenes_clientes/` por edad — el
   nombre de archivo además embebe el teléfono completo en texto plano
   (`bot/index.js:687-696`), una fuga de PII fuera del alcance de la
   redacción de logs.
7. **(Sin hallazgo, positivo) Rate limiting de login específico y
   correcto, además del genérico por IP** — lockout de 5 intentos/15min
   por username (`dashboard/server.js:72-97`), independiente del
   rate-limit general de 30 req/min que también cubre `/api/login` sin
   distinción.
8. **(Sin hallazgo, verificado) No se encontró `SELECT *` peligroso ni
   filtración de `password_hash`/`salt` en ninguna respuesta JSON** —
   `/api/clientes`, `/api/prime/usuarios` y el flujo de login usan
   columnas explícitas; los `SELECT *` encontrados (`/api/cola_atencion`,
   `/api/prime/sucursales`) no exponen credenciales.

Conclusión de Seguridad: la postura técnica (logging, hashing, rate
limiting, comparaciones a tiempo constante) está notablemente bien
ejecutada para el tamaño del proyecto. El riesgo de cumplimiento más
urgente es estructural, no de código: no existe cifrado en reposo ni en
el canal de backup, y no hay ningún mecanismo de retención/borrado o
derecho ARCO real para los datos de clientes que se acumulan
indefinidamente en SQLite plano y se transmiten sin cifrar por correo —
expone a la empresa a riesgo bajo LFPDPPP ante una brecha o una
solicitud real de cancelación de datos.

### Síntesis del comité y hallazgos que cruzan más de un rol

- **El A/B de tonos sin instrumentación** fue reportado de forma
  independiente tanto por Ingeniero de Datos como por Ingeniero de IA —
  es la coincidencia más fuerte del comité: hoy es imposible saber si
  algún tono convierte mejor, a pesar de que el mecanismo de 4 tonos
  existe desde hace varias fases.
- **Falta de capa de servicio** fue señalada tanto por Arquitecto (acceso
  a datos mezclado con HTTP) como por Desarrollador (router plano que ya
  causó un bug de orden de rutas) — son la misma raíz vista desde dos
  ángulos: `dashboard/server.js` necesita descomponerse antes de la
  siguiente tanda grande de endpoints.
- **Protección de datos personales (Seguridad) es el único rol con
  hallazgos de severidad alta que son puramente decisiones de negocio,
  no fixes técnicos triviales** — cifrado en reposo, cifrado de backup y
  política de retención/ARCO requieren que el negocio decida postura de
  cumplimiento antes de que el código cambie.
- **El friction de checkout por envío (Diseñador Conv.)** es, de los 6
  roles, el único hallazgo con impacto directo y medible en ventas hoy
  mismo (9 pasos vs 4), no un riesgo a futuro.

### Candidatos a Fase JIUA 8 (no implementados en esta pasada — diagnóstico únicamente)

Por instrucción del operador, esta pasada es de auditoría de estado
("ver el estado actual"), no de corrección. Los siguientes hallazgos
quedan registrados como candidatos a una futura Fase JIUA 8, en orden
de severidad reportada por el comité:

1. Instrumentar el tono activo en cada fila de interacción/pedido para
   poder medir conversión por tono A/B/C/D (Datos + IA).
2. Definir y aplicar una política de retención/borrado de datos de
   clientes (incluyendo imágenes) y cifrado de backup — decisión de
   negocio antes que cambio de código (Seguridad).
3. Reducir el embudo de envío reutilizando direcciones guardadas de
   clientes recurrentes en vez de recapturar 5 campos por mensaje
   separado (Diseñador Conv.).
4. Extraer una capa de servicio/router mínimo en `dashboard/server.js`
   antes de la siguiente tanda de endpoints (Arquitecto + Desarrollador).
5. Adoptar una herramienta de migraciones versionada para el esquema de
   SQLite en vez de aplicar cambios a mano contra producción
   (Arquitecto).

## 36. Fase JIUA 8 — auditoría de bugs concretos (modo debug, 4 agentes en paralelo) + módulo de toggle de emojis del dashboard

A petición explícita del operador ("entra en modo debug y analiza todo el
código lentamente... documenta todos los bugs que llegues a encontrar para
arreglarlos más adelante"), esta pasada es deliberadamente distinta a la
sección 35: en vez de un comité de arquitectura/estrategia, se lanzaron 4
agentes de exploración en paralelo, cada uno acotado a una porción del
repo (`bot/`, `dashboard/` backend, `dashboard-ui/` frontend,
`services/`+`scripts/`), con instrucción explícita de reportar **bugs
concretos y reproducibles** (lógica incorrecta, condiciones de carrera,
manejo de errores roto) y de **no** repetir hallazgos de arquitectura ya
cubiertos en las secciones 30/35. Cada hallazgo reportado por un agente
fue después releído línea por línea por el operador humano (este mismo
paso de "loop") antes de registrarse aquí — uno de los hallazgos
reportados (ver 36.3) no resistió esa verificación y se descarta
explícitamente en vez de archivarse en silencio.

### 36.1 Bugs confirmados (verificados leyendo el código real, no solo el reporte del agente)

1. **(Alta) `enHorario()` declarada dos veces en `bot/flows/_shared.js` —
   la segunda versión ignora la zona horaria de México y gana por
   hoisting.** Líneas 55-58 definen `enHorario()` restando 6h a
   `getUTCHours()` (conversión correcta a hora de México). Líneas 62-64
   **redeclaran la misma función** usando `new Date().getHours()` sin
   ninguna conversión — en JavaScript, la segunda `function enHorario()`
   sobrescribe a la primera sin error ni warning. Todo el código que
   llama a `enHorario()` (incluido `msgHorarioAsesor()` en la línea 66,
   que decide si un asesor "te contactará en los próximos 30 minutos" o
   hasta el siguiente horario) usa la hora **local del servidor**, no la
   de México. Si el servidor corre en cualquier zona horaria distinta a
   UTC-6 (un VPS en otra región, un contenedor con TZ=UTC), el bot le
   dice a clientes que un asesor "ya viene en camino" fuera del horario
   real 11am–8pm, o los hace esperar al día siguiente estando dentro de
   horario. Fix sugerido: borrar la segunda declaración (líneas 62-64).

2. **(Media) Carrera de cierre prematuro de hilo en `Notificaciones.jsx`
   al cambiar de cliente mientras se envía un mensaje individual.**
   `enviarIndividual()` (línea ~85) hace `await api.post('/api/notificar', ...)`
   y, ya resuelto, llama `api.get(`/api/clientes/${clienteSel.id}/mensajes`).then(setHilo)`
   — pero `clienteSel` es el valor capturado en el render donde se llamó
   a la función, no el cliente seleccionado *actual*. Si el usuario
   selecciona a otro cliente mientras el POST sigue en vuelo, el GET que
   llega después sigue siendo del cliente viejo, y `setHilo()` pinta ese
   hilo viejo encima de la conversación del cliente nuevo que ahora está
   seleccionado en pantalla. Repro: seleccionar cliente A → enviar
   mensaje → antes de que la respuesta llegue, seleccionar cliente B →
   el hilo mostrado puede ser el de A con la cabecera mostrando a B.

3. **(Media) `key={i}` (índice) en vez de `key={id}` en dos tablas —
   `ListaEspera.jsx:46` y `ColaEnvios.jsx:108,134`.** React usa la `key`
   para decidir qué nodo del DOM reutilizar entre renders; con índice en
   vez de id estable, si el backend reordena la lista entre refrescos
   (`cargarProgramados`/`cargarHistorial`/lista de espera por producto),
   React puede reusar el nodo de la fila 0 para mostrar los datos de otra
   fila, dejando inputs/estado local desincronizados de la fila visible.
   Nota: `ColaEnvios.jsx:86` sí usa `key={r.id}` correctamente en la
   tabla de pendientes — la inconsistencia es solo en programados/
   historial de ese archivo y en la única tabla de `ListaEspera.jsx`.

4. **(Media, alcance reducido respecto al reporte original) `scripts/backup.js#runBackupDB` no actualiza
   `.backup_registro.json` si `comprimirArchivo()` lanza una excepción
   antes de llegar a la línea 192.** El `catch` (línea 197) regresa
   `false` sin pasar por `cargarRegistro()`/`guardarRegistro()`. Importante
   matizar: los fallos de SMTP (timeout, socket error) **sí** se registran
   correctamente porque `enviarBackup()` resuelve `false` en vez de
   lanzar (línea 169-170) — solo una excepción real en la fase de
   compresión (ej. el archivo de la DB bloqueado o sin permisos de
   lectura) deja el registro sin actualizar. Como el timestamp
   `ultimo_backup_db` no se mueve hacia adelante en ese caso, la alerta de
   `checkBackupReciente()` (>36h sin éxito) sigue funcionando con el
   último éxito real — el bug es de **visibilidad** (no queda registro
   explícito de que se intentó y falló por esa causa puntual), no de
   silenciar la alerta por completo.

### 36.2 Reportados por los agentes, plausibles pero sin verificación línea-por-línea adicional del operador (revisar antes de actuar)

Estos quedan documentados tal como los reportaron los agentes — no se
descartan, pero tampoco se confirmaron con la misma rigurosidad que 36.1.
Antes de "arreglarlos más adelante", vale la pena releer el código una vez
más:

- `Notificaciones.jsx` (masivo): cambiar rápido entre tipos de audiencia
  lanza una nueva consulta sin cancelar la anterior — respuestas fuera de
  orden pueden dejar el contador de audiencia inconsistente.
- `Sustitutos.jsx#cargarSustitutos`: clics rápidos en productos distintos
  lanzan fetches en paralelo sin `AbortController`; gana el último en
  responder, no el último clicado.
- Varios componentes (`Prime.jsx`, `BotStatusWidget.jsx`) hacen `setState`
  tras un fetch sin comprobar si el componente sigue montado — el típico
  warning de React en consola, sin impacto funcional confirmado más allá
  de eso.
- `Clientes.jsx`: la búsqueda dispara una request por cada tecla, sin
  debounce — no es incorrecto, es ineficiente (ya lo nota como hallazgo
  de eficiencia, no de corrección).
- `dashboard/routes/atencionCliente.js` (~línea 44): si un pedido legacy
  tiene `id_cliente` NULL, la consulta de mensajes devuelve `[]` en vez de
  distinguir "sin cliente vinculado" de "sin mensajes" — confusión de UX,
  no pérdida de datos.

### 36.3 Hallazgo descartado tras verificación (documentado para no repetir la duda en el futuro)

El agente de `dashboard/` backend reportó un posible doble-otorgamiento de
puntos por primera compra si dos pagos del mismo cliente se confirman
"simultáneamente" (`otorgarPuntosPorPrimeraCompra`, llamada desde
`POST /api/pagos/:id/marcar-pagado` en `comunicacionPedidos.js:213`). Se
verificó leyendo ambas funciones completas: **todo el camino, desde que
`readBody()` invoca su callback hasta el `return json(...)` final, es
síncrono** (better-sqlite3 no usa promesas internamente; no hay ningún
`await` entre el `COUNT` de pedidos finalizados y la decisión de otorgar
puntos). Node solo puede interleavar ejecución en puntos `await`/callback
asíncrono — sin uno presente en esta ruta, dos requests "simultáneas" se
procesan estrictamente una después de la otra en el mismo hilo, nunca a
medias. La guarda de idempotencia (`nFinalizados !== 1`) sí hace su
trabajo. No se requiere ningún cambio aquí.

### 36.4 Módulo nuevo: toggle de emojis en el dashboard

A petición del operador, en preparación para una futura migración a un
template visual distinto (ver 36.5), se construyó un mecanismo para
apagar los emojis del dashboard sin tocar la lógica de negocio del bot
(los emojis en los mensajes de WhatsApp al cliente — plantillas de
`Notificaciones.jsx`, tonos de `_config.js` — quedan **fuera de alcance a
propósito**, ese es contenido que el cliente recibe, no "look" del panel).

- `dashboard-ui/src/context/EmojiContext.jsx` (nuevo): `EmojiProvider`
  (lee el estado al montar la app), `Emoji` (componente wrapper para JSX:
  `<Emoji>🤖</Emoji>`), `useEmoji()` (interpola un emoji suelto dentro de
  texto: `{emoji('📱')}Texto`), y `useTextoEmoji()` (quita cualquier
  emoji — no solo al inicio — de un string ya armado:
  `{txt('🤖 Estatus del bot')}`, vía una regex de rangos Unicode +
  colapso de espacios sobrantes).
- Persistencia: clave `emojis_dashboard_activo` en `configuracion`,
  reutilizando el mecanismo genérico ya existente
  (`GET /api/modulo/:clave`, `POST /api/puntos/config`,
  `ModuloConfigSchema` en `bot/validators.js`) — cero rutas nuevas en el
  backend. Control visible en la página Módulos (`dashboard-ui/src/pages/Modulos.jsx`),
  igual que el resto de toggles. Default: **activo** (no cambia el look
  actual hasta que se apague explícitamente).
- Aplicado en: `Layout.jsx` (los 17 iconos del sidebar, omnipresentes en
  toda la app), `BotStatusWidget.jsx`, `WhatsAppQR.jsx`, y el contenido
  visual (headers de tarjeta, botones con texto, badges de estatus,
  mensajes de éxito/error mostrados al operador) de **todas** las 20
  páginas de `dashboard-ui/src/pages/`.
- Deliberadamente **no** envuelto: botones que son solo un ícono sin
  texto (🔄 refrescar, ✏️ editar, ✕ quitar, 🎲 aleatorio — apagarlos
  dejaría el botón vacío e inutilizable), las plantillas de mensajes al
  cliente en `Notificaciones.jsx` (`PLANTILLAS_IND`/`PLANTILLAS_MAS`,
  contenido que se envía por WhatsApp, no parte del panel), las medallas
  de `Ranking.jsx` (con fallback explícito al número de posición cuando
  el toggle está apagado, para no perder el dato de ranking), y el
  preview del reporte de `Metricas.jsx` (contenido de negocio generado
  por el backend, no decoración de UI).
- Verificación: `npm run build:dashboard-ui` limpio tras cada tanda de
  archivos tocados (7 builds incrementales durante la sesión, todos sin
  error); `node --check` limpio en los archivos de backend tocados
  (`bot/validators.js`, `bot/flows/_config.js`, `dashboard/routes/primeConfig.js`
  para el módulo de reconexión de la sesión anterior, sin relación con
  esto); `npm run test:bot` 116/117 sin cambios respecto al checkout
  limpio (el único fallo es preexistente, no relacionado — ver nota en
  `CLAUDE.md`/sesión anterior sobre `DB_PATH` no disponible en esta
  máquina).

### 36.5 Cinco recomendaciones de templates/UI kits open source para la migración

Pedido explícito del operador: el panel actual (`dashboard-ui/src/styles.css`,
CSS escrito a mano, sin librería de UI) "se ve muy obsoleto". Cinco
opciones genuinamente open source, compatibles con el stack actual
(React + Vite), de más cercana al estilo actual (CSS propio + componentes
sueltos) a más integral (framework completo):

1. **Tabler** (tabler.io, MIT) — kit de UI para dashboards, muy completo
   en componentes y look moderno; existen bindings de React
   mantenidos por la comunidad. Migración incremental posible (reemplazar
   página por página).
2. **shadcn/ui** (ui.shadcn.com, MIT) + Tailwind — no es una librería que
   se instala sino componentes que se copian al proyecto (se mantiene la
   filosofía actual de "código propio, sin dependencia pesada de UI"),
   construido sobre Radix UI; look moderno tipo "Linear/Vercel".
3. **Mantine** (mantine.dev, MIT) — librería de componentes React con
   buen soporte de modo oscuro nativo (el panel actual ya usa paleta
   oscura), variables CSS personalizables similar al enfoque actual.
4. **Refine** (refine.dev, MIT) — framework headless para paneles
   admin/CRUD, se conecta a cualquier librería de UI (Ant Design, MUI,
   Chakra, Mantine); encaja bien porque la mayoría de páginas del panel
   son CRUD (sucursales, productos, usuarios, cupones).
5. **Ant Design Pro** (pro.ant.design, MIT) — framework React completo
   con layouts, ruteo y auth ya resueltos; el más "todo incluido" de la
   lista, mayor curva de adopción pero menos trabajo de andamiaje propio.

Ninguna de estas decisiones se implementó — son solo las recomendaciones
pedidas; la migración en sí queda pendiente de que el operador elija una.

### 36.6 Siguiente paso

Backlog para cuando el operador lo indique, en orden sugerido: (1) el fix
de `enHorario()` duplicada es de una línea y alto impacto — candidato
obvio para la próxima pasada; (2) decidir si vale la pena blindar
`enviarIndividual()` contra el cambio de cliente a medio envío (afecta
UX del operador del panel, no a clientes finales); (3) corregir las dos
`key={i}` señaladas; (4) el resto de 36.2 queda para revisión humana antes
de tocar código. La elección de template (36.5) y la extensión del
toggle de emojis a cualquier página nueva que se agregue quedan a
discreción del operador — la infraestructura (`EmojiContext`) ya soporta
ambas sin cambios adicionales.

