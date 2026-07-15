# Estrés al punto de quiebre — Editor de flujos + Bot semiautónomo por giro

> **Fecha:** 2026-07-15 · **Punto de restauración:** `restauracion/2026-07-15/`
> (3 BDs `integrity_check=ok`) + tag git `pre-estres-editor` (main `d47c8c9`).
> Tras las pruebas: BD viva de JC **íntegra** (`integrity_check=ok`), grafo activo
> intacto (id=1, v1, jugueteria). Suite completa verde, golden + paridad byte-idénticas.
>
> **Principio rector (dueño):** el bot semiautónomo de WhatsApp es lo importante
> para el cliente y la operación; el CRM/editor lo APOYAN, no lo sustituyen.

## Método
- **Agente 1 — punto de quiebre del editor** (scripts en `stress-editor/`): martilló
  `PUT /grafo`, `activar`, `revertir`, `simular` como prime.
- **Agente 2 — clientes tercos por giro** (harness `stress-bot/run.js`): corrió el
  pipeline real del bot (`actionHandler.handleAction`) contra COPIAS sandbox de las
  3 BDs, actuando como 7 personas tercas × giro (10–30 turnos c/u).

## Resultados

### Editor de flujos — AGUANTÓ, frontera sólida
- **Bloqueos: 34/34 correctos.** Todo intento imposible → 4xx limpio, **cero 500,
  cero corrupción**: piezas selladas usurpadas (ASESOR/SHOW_CART/CONFIRM_ORDER/
  PAGO_METODO/ASK_CP/DEVOLUCION), borrar/des-delegar/mutar selladas, `*` desde
  delegado, anticipo sin %, colgantes, huérfanos, sin inicial, acciones inventadas,
  duplicados, nombres inválidos (SQLi/unicode/5000 chars), body malformado.
- **Punto de quiebre:** no hay quiebre por lint ni BD — latencia lineal (~27 µs/nodo,
  5000 piezas guardan en 133 ms). El único techo es el cap de body de 1 MB
  (`dashboard/server.js:589`) → ~5100 piezas devuelve **413** limpio.
- **Concurrencia íntegra:** 10 PUT simultáneos → 10 versiones/ids únicos, exactamente
  1 activo, sin duplicados (better-sqlite3 serializa).

### Bot semiautónomo vs. tercos — SÓLIDO, un hueco real (corregido)
- jugueteria/barberia/restaurante: cero respuestas vacías, cero `ERROR:`, sesión
  siempre en paso válido, **cero pedidos/citas/mesas fantasma**. Datos basura
  (CP `00000`, nombre 500 chars, cantidad `-5`/`999`/`muchos`, `DROP TABLE`,
  solo-emojis) → rechazados sin crash. Fechas imposibles son inexpresables (listas
  numeradas, no texto libre).
- **BUG real (el peor modo de falla de un bot semiautónomo):** el cliente pedía
  "quiero hablar con una persona" y recibía **resultados de búsqueda** — nunca
  escalaba. Idéntico en los 3 giros (flow compartido `menuFlow.js`).

## Bugs corregidos (este ciclo)
1. **[CRÍTICO] Solicitud de humano en texto libre no escalaba** — `bot/flows/menuFlow.js`.
   El texto libre en MENÚ iba directo a búsqueda de producto sin detectar "hablar con
   una persona/asesor/humano" ni "no me entiendes". **Fix:** guard de solicitud-de-humano
   ANTES de la búsqueda → `S.ASESOR` + `registrarEscalada` (mismo comportamiento que la
   opción "asesor"). En el flow compartido → arregla los 3 giros. Test: `test_bot_terco.js`.
2. **[COSMÉTICO] Emoji de juguete filtrado a otros giros** — 🧸 hardcodeado en
   `asesorFlow.js:81`, `cartFlow.js:214`, `menuFlow.js:534`. **Fix:** → `vocab().emoji`
   (byte-idéntico para JC porque su vocab.emoji ES 🧸; arregla barbería/restaurante/etc.).
3. **[MEDIA] `version=1` hardcodeada en el seeder** — `bot/flows/motor/seeder.js:42`.
   Activar una plantilla no generaba versión monótona → historial/revertir incoherentes.
   **Fix:** `MAX(version)+1` (comparte espacio de versiones con el editor).

## Decisión de diseño (no todo hallazgo se implementa)
- **Contador "3 sinsentidos → ofrecer humano"** (sugerido por el agente): se evaluó y
  **se descartó por ahora**. Con catálogo real, cualquier texto raro devuelve
  sugerencias de fallback y el flujo ya de-escala con gracia (sugerencias →
  lista de espera con opciones "avísame / algo similar / menú"): no es un loop mudo.
  Un contador ahí sería código muerto en la práctica y tocaría el flujo más caliente.
  **Reconsiderar sólo si la telemetría (`log_eventos` tipo 'fallback') muestra tercos
  atorados de verdad.**

## Plan de mejora (priorizado, siempre a favor del bot)
1. **[HECHO]** Escalar cuando el cliente pide un humano en texto libre.
2. **[HECHO]** Emoji por giro (sin leak de 🧸) y versionado monótono del seeder.
3. **[HECHO]** Endurecimiento del editor: `GET /versiones` garantiza que la versión
   activa siempre aparezca en la lista (+ `activo_id`) aunque sea vieja; cota de
   longitud al nombre de paso (≤40); tope explícito de piezas (≤400) y cables (≤2000).
4. **[pendiente, telemetría primero]** Medir con `log_eventos 'fallback'` si hay tercos
   que dan vueltas; si los hay, contador de sinsentidos consecutivos → oferta de humano
   a nivel de las 3 búsquedas (MENU/SEARCHING/VIEW_PRODUCT), no solo el callejón raro.
5. **[pendiente, UX]** Los 3 giros usan lista numerada para fecha/hora/mesa (a prueba de
   tercos); parseo por texto libre sería mejora de comodidad, no de robustez.
