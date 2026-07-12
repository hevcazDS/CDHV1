# Revisión de arquitectura — bothHS 1.2

Revisión contra código real (no solo CLAUDE.md), 2026-07-12. Alcance: procesos/datos, modelo de instancias, migraciones, registro de rutas, bridge WhatsApp, frontend.

## Veredicto ejecutivo

**La arquitectura sí aguanta el negocio que quiere ser** — pyme-tool instancia-por-cliente, volúmenes de decenas de ventas/día por tienda, "boring tech" deliberado. SQLite WAL + 2 procesos + better-sqlite3 síncrono es la elección correcta a esta escala: dentro de cada proceso no hay interleaving (el driver es síncrono), y entre procesos WAL + busy_timeout 5s serializa sin corromper. El registro declarativo de rutas (`_construirModulo`) es un patrón sano, no deuda. Los riesgos reales no son de stack sino **operativos y de atomicidad**: el chokepoint de cobro corre sin transacción, los respaldos no cubren las instancias, y la equivalencia fresh-vs-migrada depende de disciplina manual sin verificación automática. Todos tienen fix proporcional (horas, no semanas). Nada aquí pide reescritura ni infraestructura nueva.

Sobre el doble modelo (eje 2): es coherente **mientras `instancias/` siga siendo un switcher de una-tienda-activa-a-la-vez** (demo/multitienda local). Para 10–50 clientes el modelo real sigue siendo carpeta clonada + número WhatsApp propio por cliente (correcto dado whatsapp-web.js), y ahí el cuello no es SQLite: es **despliegue/migración/respaldo × N bases con versiones divergentes** — hallazgos 2, 6 y 7.

---

## Hallazgos

### CRÍTICO

**1. `marcar-pagado` — el chokepoint de cobro corre SIN transacción**
`dashboard/routes/comunicacionPedidos.js:244-292`. El flujo es: `UPDATE links_pago→pagado` (l.255) → kardex por item (l.260-263, `kardexService.movimiento` tampoco abre transacción propia) → `UPDATE pedidos` (l.264, 279) → notificación → puntos/referidos. Todo statements sueltos en auto-commit. Un crash/excepción a la mitad deja **pago registrado sin inventario descontado ni pedido confirmado** — y como es idempotente por `links_pago.estatus` (l.254 devuelve 409), el reintento del operador ya no repara nada: queda inconsistente para siempre.
El contraste es que `pos.js:165` y `mesas.js:130` **sí** envuelven su equivalente en `db.transaction`.
**Fix:** envolver l.255–279 en `db.transaction(() => {...})()` con el mismo patrón que ya usa `pos.js` (puntos/notificaciones pueden quedar fuera: son idempotentes por `puntos_acreditados` y por cola). Diff de ~10 líneas.

**2. Los respaldos ignoran `instancias/*.db` y el puntero de instancia activa**
`scripts/backup.js:18` resuelve `DB_PATH` directo del env y `:248` respalda solo ese archivo. Pero `bot/db_connection.js:17-32` redirige TODOS los procesos a `instancias/<tienda>.db` cuando existe `dashboard/.instancia_activa`. Resultado: con una instancia abierta (hoy mismo: `instancias/barberia.db` tiene `-wal`/`-shm` activos), **la base en producción nunca se respalda** — se respalda la principal dormida — y `checkBackupReciente` del stockWatcher reporta "backup reciente OK" dando falsa confianza.
**Fix:** en `backup.js`, replicar el selector de puntero de `db_connection.js` (son 10 líneas, o exportar la ruta resuelta desde `db_connection` y requerirla) y además iterar `instancias/*.db` — con SQLite un backup extra es un `VACUUM INTO`/copia gzip por archivo.

**3. Split-brain de instancias: el cierre del hueco es best-effort del lado equivocado**
`dashboard/routes/instancias.js:24-36`: al cambiar de tienda, el restart del bot es fire-and-forget — si `pm2 jlist` falla o el `restart` falla, solo `log.warn` y **el bot sigue vendiendo contra la BD de la tienda anterior** mientras el dashboard ya opera la nueva (el propio comentario l.19-22 lo reconoce). En Windows con `pm2.cmd` vía `cmd.exe` (l.26) la probabilidad de fallo silencioso no es teórica.
**Fix (del lado del bot, que es quien tiene el estado):** en `bot/index.js`, un `setInterval` de 60s que relea el puntero y compare contra la ruta que abrió al arrancar; si difieren → `log.warn` + `process.exit(0)` limpio (pm2 lo relevanta con la BD correcta). ~8 líneas, cierra el hueco sin importar si el restart remoto llegó.

### IMPORTANTE

**4. Asientos contables fuera de la transacción y tragados con `log.debug`**
`comunicacionPedidos.js:268-277`, `pos.js:194-199`, `mesas.js:150-156`: si `asientoVenta`/`asientoCostoVenta` truena, la venta queda cobrada y el error muere en `log.debug` — **el mayor descuadra en silencio** y nadie lo ve hasta el corte/conciliación. Nota: el comentario de `mesas.js:150-151` ("better-sqlite3 no anida") es incorrecto — `db.transaction` anida vía savepoints; la razón para sacarlos ya no aplica.
**Fix proporcional:** no meterlos a la tx (un bug contable no debe bloquear cobros); en el `catch`, insertar `log_eventos tipo='asiento_fallido'` con el id_pedido y sumar un card condicional en Inicio (mismo patrón que el card de emails-error). Así el descuadre es visible y reparable con `scripts/backfill_contable.js`, que ya existe.

**5. Equivalencia fresh-vs-migrada: cero verificación automática**
El baseline sella todas las migraciones en BD nueva (`scripts/instalarBaseDeDatos.js:97-110`), así que una BD fresca **jamás ejecuta** `migrations/*.sql` — la equivalencia depende 100% del espejo manual a `db/schema.sql` (`scripts/migrate.js:7-10` lo pide en un comentario). Ese mecanismo ya falló antes (drift documentado: `cola_emails.html_body`/`cuerpo_html`). Con 52 migraciones y 5 en el último bloque (0048–0052), es cuestión de tiempo que una columna llegue a producción por migración y no a `schema.sql` — y el clon nuevo truena con "no such column" semanas después.
**Fix:** `scripts/checkSchemaDrift.js` (~60 líneas): crea BD temporal con `schema.sql`, y contra la BD real (o una migrada) diffea `sqlite_master` + `PRAGMA table_info` por tabla; exit≠0 si difieren. Colgarlo de `npm test`. No necesita CI: correr en el pre-deploy manual basta.

**6. `migrate.js` aplica cada migración sin transacción**
`scripts/migrate.js:96-116`: statements en auto-commit; si el statement 4 de 7 truena, la BD queda a medias y la migración **no** se registra → el re-run re-ejecuta los 3 primeros. Los `ERRORES_TOLERADOS` (l.58) cubren DDL repetido, pero un `UPDATE` de backfill no-idempotente se aplicaría dos veces. Riesgo secundario: `splitStatements` (l.33-53) cuenta el `END` de un `CASE...END` como cierre de `BEGIN` de trigger → partiría un trigger a la mitad.
**Fix:** envolver el loop de statements + el `INSERT INTO schema_migrations` de cada archivo en `db.exec('BEGIN')`/`COMMIT` con `ROLLBACK` en error (los tolerados siguen igual dentro). Para el splitter: basta la regla "migración con trigger que use CASE = un solo statement en el archivo", documentada en el header.

**7. Operación × N bases: `migrate.js` solo migra la del `.env`**
`scripts/migrate.js:21` lee únicamente `process.env.DB_PATH` — ni el puntero de instancia ni `instancias/*.db`. Tras cada deploy, las instancias quedan en **versiones de esquema divergentes** (la barbería sin 0049–0052, etc.), y el fallback silencioso de `mensajeService`-style INSERTs enmascara el atraso hasta que algo truena. Con 10–50 clientes clonados en carpetas, se suma que no hay forma de saber qué versión de app corre cada uno.
**Fix:** (a) `node scripts/migrate.js --todas` que itere `[DB_PATH resuelto, ...instancias/*.db]`; (b) al final de una corrida exitosa, escribir `configuracion.schema_version = <última migración>` y mostrarla en `/api/bot/status` — un vistazo al panel dice si la tienda está al día.

**8. Contención bot↔dashboard: acotada, pero el driver síncrono congela el event loop**
`bot/db_connection.js:64` — `busy_timeout=5000` con better-sqlite3 significa que una escritura del dashboard que tope con lock **bloquea el hilo JS hasta 5s** (y viceversa: una migración/`VACUUM`/export largo en el dashboard puede congelar el procesamiento de mensajes del bot esos 5s). A volúmenes pyme con WAL (lectores nunca bloquean) esto es raro y no corrompe nada — no es urgente.
**Fix mínimo:** los trabajos pesados que ya existen (export dataset gzip, `demoMetricas`, backup) deben usar conexión propia readonly o correr fuera de horario; no agregar nada más hasta observarlo en logs (un wrapper que loguee `db.prepare` >1s sería el primer paso si aparece).

### DESEABLE

**9. `_construirModulo`: patrón sano — le falta body/validación centralizados**
`dashboard/routes/_construirModulo.js` + `scripts/rutas/inventario.js` es de lo mejor del repo: gate explícito por ruta, PIN en el tronco, índice canónico derivado del código con `--check`. Deuda pendiente: cada handler repite `readBody + JSON.parse + try/catch` a mano, y el propio archivo documenta (l.96-103) que los callbacks async de `readBody` escapan el try/catch de `server.js` — hoy solo el path `pin:true` está blindado; un handler no-pin que olvide su try/catch tumba el proceso.
**Fix:** extender el def de ruta con `body:true` y `schema:` opcional (zod ya está instalado): el tronco hace readBody+parse+validate+catch y pasa `body` al handler, igual que ya hace para `pin`. Migración gradual, handler por handler.

**10. Bridge WhatsApp: el plan B ya está a medias construido — protegerlo**
`whatsapp-web.js ^1.25.0` (package.json) es no-oficial: riesgo permanente de ban y de breaking change en un minor. Lo bueno: `cola_notificaciones` ya es el bus de salida (todo envío programático pasa por ahí), el procesador (`bot/index.js:574`) hace jitter anti-ban y regla de "nunca contactar primero" — el **único consumidor a reemplazar** para migrar a WhatsApp Cloud API es esa función + `sendSafe`; lo caro sería el inbound (pipeline de `index.js`), que igual quedaría detrás de un adapter de eventos.
**Fix hoy:** (a) fijar versión exacta (`1.25.0`, sin `^`) — un `npm ci` en deploy no debe poder traer un minor roto de una lib no-oficial; (b) detalle real del procesador: el `UPDATE estatus='enviado'` corre *después* del send (l.609-611) — un crash entre ambos re-envía el mensaje al cliente al reiniciar; marcar `intentos=intentos+1` **antes** de enviar lo vuelve at-most-once, que para notificaciones comerciales es el lado correcto.

**11. `localStorage` sin namespace por tienda: duele exactamente al cambiar de instancia**
`Mostrador.jsx:35,121` (`pos-ultimo-ticket`), `Layout.jsx:131` (`nombre-negocio`), `Pedidos.jsx:23` (filtros), `erp-tab`, `modulos-sidebar`. localStorage es por-origen, no por-BD: tras cambiar de tienda, "Reimprimir" **imprime el ticket de la tienda anterior** (dato de negocio cruzado, no solo cosmético) y la marca/menú arrancan con los de la otra. Las claves de preferencia (tema, fuente, colapsado) están bien globales.
**Fix:** un `lib/storage.js` de 15 líneas que prefije la clave con la instancia activa (exponer `clave` en `/api/me` o `/api/onboarding/estado`, ya hay dónde), y migrar solo las claves de datos de negocio: `pos-ultimo-ticket`, `nombre-negocio`, filtros. Las demás se quedan como están.

**12. `verificar-y-completar` degrada constraints en silencio**
`scripts/instalarBaseDeDatos.js:42-49` + `:188-197`: una columna "repuesta" por ALTER se agrega deliberadamente sin NOT NULL/DEFAULT/CHECK (limitación de SQLite, el comentario lo admite). Correcto como rescate — pero no queda **registro** de qué columnas viven degradadas en qué instancia, y esas son exactamente las que luego violan supuestos del código (el incidente `usuarios.nombre NOT NULL` fue de esta familia).
**Fix:** al agregar cada columna, insertar una fila en `configuracion_log` (`clave='schema:columna_degradada'`, valor `tabla.columna`) — la bitácora forense ya existe y el hallazgo 5 (`checkSchemaDrift`) las reportaría como diferencia conocida en vez de ruido.

---

## Lo que NO hay que hacer

- No mover a Postgres ni a multi-tenant con `tenant_id`: el modelo instancia-por-cliente es la decisión correcta mientras el bridge sea whatsapp-web.js (un Chromium/número por cliente de todos modos).
- No introducir framework HTTP ni ORM: el dispatch declarativo + better-sqlite3 preparado es más auditable que cualquiera de los dos a este tamaño.
- No construir el adapter Cloud API todavía: solo dejar la frontera limpia (hallazgo 10) y la versión congelada.
