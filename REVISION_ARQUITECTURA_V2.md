# Revisión de arquitectura V2 — bothHS 1.2

Segunda revisión contra código real (no solo CLAUDE.md), 2026-07-12. Sucede a `REVISION_ARQUITECTURA.md`.
Alcance: estado **actual** tras Fase 5 (suscripciones, documentos, baúl contable, conciliación bancaria,
pasarela key-only) y con el motor de flujo aún en diseño (`PLAN_IMPLEMENTACION_MOTOR.md`, no construido).

## Qué cambió desde la V1 (verificado, no repetido)

La V1 tenía 3 CRÍTICOS. **Los 3 están resueltos en código**:

- **V1-H1 (marcar-pagado sin transacción) → RESUELTO.** `comunicacionPedidos.js:265-275` ahora envuelve
  `UPDATE links_pago` + kardex por item + `UPDATE pedidos.cobrado_por` en `db.transaction(() => {...})()`.
  Asientos/puntos/notifs quedan fuera a propósito (idempotentes). Exactamente el fix que la V1 pedía.
- **V1-H2 (backup ignora instancias) → RESUELTO parcial.** `scripts/backup.js:21-32` resuelve el puntero
  `dashboard/.instancia_activa` igual que `db_connection.js` y respalda la tienda activa. Queda pendiente
  el iterar **todas** `instancias/*.db` (ver M2 abajo) — pero el peor caso (respaldar la dormida) ya no ocurre.
- **V1-H3 (split-brain de instancias) → RESUELTO.** `bot/index.js:187-199` añade el `setInterval` de 60s que
  relee el puntero y hace `process.exit(0)` limpio si cambió — el guard del lado del bot que la V1 recomendó.

Siguen abiertos de la V1: **H4** (asientos tragados con `log.debug`), **H6** (migrate sin transacción),
**H7** (migrate solo migra la BD del `.env`), **H9** (boilerplate de body). Se re-priorizan abajo con el peso
que Fase 5 les añadió.

## Veredicto ejecutivo

**La arquitectura boring-tech sigue siendo la correcta para el segmento** — pyme instancia-por-cliente,
decenas de ventas/día. No hay hallazgo que pida framework, ORM, Postgres ni cambio de stack. Lo notable de
Fase 5 es la **disciplina**: los 3 caminos de cobro nuevos (`suscripciones.js:_generarCargo`,
`citas.js:cobrar`, y el reuso de `marcar-pagado`) **no inventan cobro** — todos generan `pedido +
links_pago` y convergen en el chokepoint, y todos envuelven su escritura en `db.transaction`. La frontera
sellada de dinero/inventario **aguantó** la expansión. Los riesgos vivos son los mismos de siempre —
**operación × N bases** (migración/respaldo/versión divergente) y **visibilidad del descuadre contable** — más
una deuda nueva de bajo grado que Fase 5 multiplicó (el boilerplate de body). Todos con fix proporcional (horas).

---

## Hallazgos (ordenados por impacto)

### ALTO

**1. Los asientos contables siguen fuera de la transacción y muertos en `log.debug` — y Fase 5 lo repite**
`comunicacionPedidos.js:279-288` (venta), `citas.js:99-102` (cita cobrada), `suscripciones.js` (vía marcar-pagado).
Cuando `asientoVenta`/`asientoCostoVenta` truena, la venta queda cobrada y el error muere en `log.debug`
(`comunicacionPedidos.js:288`) o en un `catch (_) {}` vacío (`citas.js:102`). **El mayor descuadra en silencio.**
Esto era V1-H4; Fase 5 añadió `citas.js:cobrar` y `suscripciones` que asientan igual (fuera de tx, tragado),
así que la superficie del problema creció, no se cerró. Con baúl contable + conciliación bancaria ahora
**dependiendo** de que el mayor esté cuadrado, un asiento perdido ya no es cosmético: rompe la conciliación.
**Fix (proporcional, no meter a la tx):** en cada `catch`, `INSERT INTO log_eventos (tipo_evento, valor)
VALUES ('asiento_fallido', <id_pedido>)` y un card condicional en `Inicio.jsx` (mismo patrón que el card de
emails-error). El descuadre se vuelve visible y reparable con `scripts/backfill_contable.js` (ya existe).
Reemplazar los `catch (_) {}` vacíos de `citas.js:102` y `citas.js:99` por el log — un `catch` vacío en un
camino de dinero es exactamente lo que no debe existir.

**2. `migrate.js` migra solo la BD del `.env` — con N instancias, esquemas divergentes garantizados**
`scripts/migrate.js:21` lee únicamente `process.env.DB_PATH`; no conoce el puntero de instancia ni
`instancias/*.db`. Tras un deploy con `node scripts/migrate.js`, la tienda del `.env` queda en 0063 y
`instancias/barberia.db` se queda atrás. Fase 5 agravó esto: `suscripciones`/`documentos`/`movimientos_banco`
son **tablas nuevas** (0062/0063/0060); una instancia sin migrar entra a `suscripciones.js:30`
(`SELECT * FROM suscripciones`) y truena con "no such table" — no hay fallback tolerante ahí (a diferencia
de `mensajeService`). Era V1-H7; sigue idéntico. **Fix:** `node scripts/migrate.js --todas` que itere
`[DB_PATH resuelto, ...glob('instancias/*.db')]`, y escribir `configuracion.schema_version = <última>` al
terminar, mostrado en `/api/bot/status`. ~20 líneas, cierra el agujero operativo más caro del modelo.

**3. Equivalencia fresh-vs-migrada: cero verificación automática (el espejo se cumplió, pero por disciplina)**
Verifiqué el espejo de Fase 5: `suscripciones`/`documentos`/`plantillas_documento`/`movimientos_banco`/
`repartos`/`costo_unitario` **sí** están en `db/schema.sql` (líneas 536, 545, 564, 585, 602, 436). Bien —
pero eso es 6 de 6 por disciplina manual, sin red. El baseline sella todas las migraciones en BD nueva
(`instalarBaseDeDatos.js`), así que una BD fresca **jamás ejecuta** `migrations/*.sql`: la única defensa es
que alguien copie cada `CREATE TABLE` a `schema.sql`. Con 63 migraciones y un ritmo de ~5 por bloque, la
próxima omisión es cuestión de tiempo (ya pasó: `cola_emails.html_body`/`cuerpo_html`). Era V1-H5, sigue
abierto. **Fix:** `scripts/checkSchemaDrift.js` (~60 líneas): crea BD temporal con `schema.sql`, diffea
`sqlite_master` + `PRAGMA table_info` contra una BD migrada, exit≠0 si difieren. Colgarlo de `npm test`.
Este mismo script es **prerequisito del motor de flujo** (§Motor abajo), así que su ROI se duplica.

### MEDIO

**4. `migrate.js` aplica cada archivo sin transacción — backfill no-idempotente = doble aplicación**
`scripts/migrate.js:100-114`: statements en auto-commit; el `INSERT INTO schema_migrations` va **después** del
loop (l.114). Si el statement 4 de 7 truena por algo no tolerado, la migración no se registra → el re-run
re-ejecuta los 3 primeros. Los `ERRORES_TOLERADOS` cubren DDL repetido, pero un `UPDATE` de backfill (ej. el
patrón que CLAUDE.md exige para NOT NULL nuevos) se aplicaría dos veces. Era V1-H6. Hoy las migraciones
0058-0063 son puro DDL idempotente (ALTER nullable / CREATE IF NOT EXISTS), así que el riesgo es **latente,
no activo** — pero se activa en cuanto una migración traiga un backfill. **Fix:** envolver el loop de cada
archivo + su `INSERT INTO schema_migrations` en `BEGIN`/`COMMIT` con `ROLLBACK` en error no tolerado.

**5. Boilerplate de `readBody + JSON.parse + try/catch` — 105 repeticiones en 23 rutas**
Grep confirma `return readBody(req, body => { try { JSON.parse ... } catch ... })` **105 veces**
(`primeConfig.js` 18, `primeCatalogo.js` 10, `comunicacionPedidos.js` 8, cada archivo de Fase 5 2-3). Era
V1-H9; Fase 5 le sumó ~10 más. No es un crash-risk hoy (cada handler envuelve su propio try/catch, y el único
punto async que escapa el try/catch de `server.js` — el path `pin:true` — ya está blindado en
`_construirModulo.js:96-103`). Es **deuda de consistencia**: validación ad-hoc (cada ruta re-valida montos,
teléfonos, fechas a mano), y un handler nuevo que olvide su try/catch dentro del callback de `readBody`
**sí** tumbaría el proceso porque corre async. **Fix (gradual, alto ROI):** extender el def de ruta con
`body:true` + `schema:` opcional (zod ya está instalado y ya valida `marcar-pagado`): el tronco hace
readBody+parse+validate+catch y pasa `body` al handler, como ya hace para `pin`. Migrar ruta por ruta; las
nuevas nacen sin el boilerplate. Es el refactor de **mayor ROI** del repo ahora mismo (borra ~300 líneas
duplicadas y cierra la clase de bug "callback async sin try/catch").

**6. `suscripciones.generarCobros` corre en botón manual sin idempotencia por período**
`suscripciones.js:117-125`: itera las activas vencidas y llama `_generarCargo` por cada una, que avanza
`proximo_cobro += 1 mes` dentro de su tx. Correcto para un click. Pero el comentario (`:116`) anticipa
"un tick de stockWatcher puede llamar la misma lógica". Si eso se conecta, **dos ticks el mismo día** (o un
click + un tick) generan **dos cargos** del mismo período: la única guarda es `proximo_cobro <= hoy`, y el
primer cargo ya lo movió al mes siguiente — así que en la práctica el segundo no dispara *el mismo día*, pero
un reintento tras crash a media tx (antes del `UPDATE proximo_cobro`) sí re-cobraría. **Fix barato:** antes de
insertar, `SELECT 1 FROM pedidos WHERE canal_creacion='suscripcion' AND ... AND date(creado_en)=date('now')`
por suscripción, o una columna `ultimo_cobro_periodo` (YYYY-MM) con guard. No urgente hasta que el tick exista;
anotarlo **antes** de conectar stockWatcher.

### BAJO

**7. `localStorage` sin namespace por tienda — cruza datos al cambiar de instancia**
Sin cambios desde V1 (era V1-H11). `Mostrador.jsx` (`pos-ultimo-ticket`), `Layout.jsx` (`nombre-negocio`),
filtros de `Pedidos.jsx`. localStorage es por-origen, no por-BD: tras cambiar de tienda, "Reimprimir" imprime
el ticket de la tienda anterior. Bajo porque el switcher de instancias es demo/una-a-la-vez, pero es dato de
negocio cruzado. **Fix:** `lib/storage.js` de 15 líneas que prefije con la instancia activa; migrar solo las 3
claves de datos de negocio. Las de preferencia (tema/fuente) se quedan globales.

**8. Fase 0 del motor (fixture + golden) no existe — el master no tiene oráculo**
`tests/fixture_min.js` y `tests/golden_snapshot.js` (especificados en `PLAN_IMPLEMENTACION_MOTOR.md §0`) **no
están creados** (glob vacío). Hoy no bloquea nada porque el motor no se ha tocado. Pero el plan es explícito:
"ninguna fase del motor mergea sin el golden verde", y Fase 1 (frases→datos) es un refactor byte-idéntico
**sin oráculo que lo verifique**. Riesgo: bajo hoy, **bloqueante el día que se toque una frase**. Es barato
(~1.5 día, solo lee) y reusa `db/schema.sql`. Construirlo **antes** de la primera frase migrada, no después.

---

## Sobre el motor de flujo (preparación arquitectónica)

**La arquitectura actual lo soporta sin romperse, y el plan lo respeta.** Verificado contra el código:

- El pipeline de filtros/ASESOR está **intacto y sellado como el plan asume**: `cfCheck` (`index.js:908`),
  `esFrustracion` (`:924`), `quejaCheck` (`:1047`) corren **antes** del router; `handleAction` (`:1133`) es la
  única etapa donde correría el motor. Un intérprete que se registre dentro de `handleAction` (patrón `_giro`,
  `actionHandler.js`) nunca ve texto de grosería/queja — hereda los filtros gratis, como M.3 del plan describe.
- La frontera de dinero está donde el plan la necesita: `insertarPedidoConCarrito` (`_shared.js:776`) **no
  toca inventario** (verificado: inserta pedido+detalle con `costo_unitario` congelado, nada de kardex), y el
  descuento de stock vive solo en `marcar-pagado`. El motor puede invocar `grabar_pedido` como caja negra
  sellada sin riesgo de doble-descuento.
- El plan es honesto y correcto en su veredicto **compilar-y-congelar** (no interpretar-en-vivo, no codegen a
  JS). La única deuda que el motor **hereda** y debe resolver primero es el hallazgo 3 (`checkSchemaDrift`) y
  el 8 (fixture+golden) — sin ellos, Fase 1 refactoriza a ciegas.

No hay nada en la arquitectura actual que impida el motor. Lo que falta es la **red de seguridad** (8) y la
**verificación de espejo** (3), ambos prerequisitos que el propio plan reconoce.

---

## Sólido (no tocar)

- **La frontera sellada de dinero/inventario aguantó Fase 5.** Los 3 cobros nuevos (suscripción, cita, y el
  chokepoint) reusan `pedido + links_pago 'generado'` y convergen en `marcar-pagado`; todos envuelven su
  escritura en `db.transaction`. `insertarPedidoConCarrito` sigue sin descontar stock. Esto es lo más difícil
  de mantener en un ERP que crece y **está bien mantenido** — el patrón "el cobro real es una caja negra que
  todo camino invoca" se respetó en cada feature nueva.
- **El registro declarativo de rutas (`_construirModulo`) escaló bien.** 25 archivos de ruta, gate explícito
  por área/rol, PIN en el tronco, el único punto async peligroso (`pin:true`) blindado. Es de lo mejor del
  repo; no reescribir, solo extenderlo con `body:true` (hallazgo 5).
- **Las migraciones 0058-0063 siguen la regla anti-drift al pie.** Todas nullable o NOT NULL-con-DEFAULT
  (verificado archivo por archivo); espejo en `schema.sql` presente. El `costo_unitario` congelado (0061) es
  una corrección contable genuina y bien razonada. La disciplina que la V1 pedía **se está cumpliendo**.
- **La pasarela key-only (`gatewayService.js`) es un modelo de fail-closed.** Doble-gate (módulo + credenciales
  o demo), secreto cifrado at-rest con secreto de instancia, modo demo que no llama a nadie, y **nunca marca
  nada pagado** — el pago real sigue confirmándose a mano en el chokepoint. Exactamente cómo debe entrar una
  integración externa a este sistema.
- **La conciliación bancaria (0060 + `erpContabilidad.js:627`) es read-and-match, no mueve dinero.** Importa
  líneas del banco y las casa contra cobros/pagos ya registrados; su import está en `db.transaction`
  (`:641-648`). No toca la frontera sellada. Bien acotado.
- **El stack boring-tech sigue siendo la decisión correcta.** SQLite WAL + 2 procesos + better-sqlite3
  síncrono + native http es adecuado y auditable para el segmento. No mover a Postgres, no meter framework
  HTTP ni ORM, no construir el adapter Cloud API todavía. Nada aquí pide reescritura.

---

## Prioridad de ejecución (ROI, sin sobre-ingeniería)

1. **Hallazgo 5 (body:true en el tronco)** — mayor ROI: borra ~300 líneas, cierra la clase de bug del callback
   async, y toda ruta nueva (incluido el motor) nace limpia. Gradual, reversible.
2. **Hallazgo 1 (asiento_fallido visible)** — el descuadre contable silencioso ahora rompe conciliación; hacerlo
   visible es ~15 líneas y usa infra que ya existe (`log_eventos` + card de Inicio + `backfill_contable.js`).
3. **Hallazgo 2 (`migrate --todas`) + 3 (`checkSchemaDrift`)** — el par que cierra el riesgo operativo del
   modelo N-instancias y desbloquea el motor. ~80 líneas juntos.
4. El resto (4, 6, 7, 8) cuando se toque el camino que los activa. Ninguno es urgente hoy.
