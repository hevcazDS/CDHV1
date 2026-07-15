# Motor de flujo — fallas encontradas y plan de acción del editor visual

> **✅ CERRADO (2026-07-15, commit `dbb6880`):** C1, C2, C3, M1, M2, M3, M4 y las
> 4 medias están implementados y pinneados en `tests/test_motor_c1c2c3.js`
> (11/11, `npm run test:lienzo`, encadenado en `npm test`). Golden + paridad JC
> byte-idéntica verdes. Quedan solo los MENORES (pieza inicial ⭐ desde el
> editor, simulador de conversación, borrar PUT /nodo redundante, useMemo→useEffect).

> **Contexto de sesión (2026-07-13):** auditoría de la cadena completa del motor
> (editor MotorCanvas → `PUT /api/prime/motor/grafo` → `grafo.js` → `interprete.js`
> → runtime) trazando qué pasa con flujos creados por un usuario real en el lienzo.
> Los problemas C1/C2/M1 fueron **verificados en runtime real** (no especulación):
> se sembró un grafo con nodo custom + aristas y se ejecutó el intérprete.
>
> Estado del motor al momento: Fases 0–6 hechas y committeadas (golden + paridad
> byte-idéntica de JC verdes, bot 117/117). Editor visual (React Flow) montado en
> Prime → "Motor de flujo" con lenguaje llano y candados §D en servidor.
> Rama: `feat/ola2-tareas-poliza`. Último commit relevante: `f24fe31` (ux motor).

---

## 🔴 CRÍTICAS — un flujo creado hoy en el editor NO funciona o rompe cosas

### C1. Los cables que salen de piezas del "flujo base" (delegadas) están MUERTOS
- **Prueba real:** se dibujó `MENU --kw:promo--> PROMO_X`, se guardó, y al escribir
  "promo" el bot respondió con la rama de ofertas de `menuFlow` — el cable nunca disparó.
- **Causa:** `bot/flows/motor/interprete.js` → `handle()`: si `nodo.params.delegar`,
  hace `return dispatchSistema(ctx.step, ctx)` **antes** de mirar las aristas del grafo.
- **Fix:** en nodos delegados, evaluar PRIMERO las aristas custom del grafo
  (`aristas.find(matchInput)`); solo si ninguna matchea, delegar al código.
  Cuidado: una arista `*` en un nodo delegado se tragaría todo el flujo base —
  el linter debería advertir/prohibir `*` en nodos delegados.
- **Test:** runtime — sembrar grafo con arista custom desde MENU y verificar que
  dispara; y que los inputs normales ("1".."5") siguen cayendo a menuFlow byte-idéntico
  (¡la paridad del golden debe seguir verde!).

### C2. Llegar a una pieza delegada por un cable → mensaje VACÍO
- **Prueba real:** `PROMO_X --*--> MENU` devolvió `""` al cliente (bot mudo).
- **Causa:** `interprete.js` paso 8: el destino delegado se renderiza con
  `t(frase_clave)` y los delegados tienen `frase_clave=null` → `t(null)===''`.
- **Fix:** si `nodoDestino.params.delegar` → tratarlo como sistema: actualizar
  sesión y `dispatchSistema(destino, ctx)` (que corra su código real, ej. mostrar
  el menú). Simétrico al handoff §C.3.

### C3. Se puede crear una pieza llamada ASESOR / SHOW_CART y SECUESTRAR checkout/relevo
- **Causa:** `dashboard/routes/motorFlujo.js` → `grafoPut` no valida colisiones de
  `paso` con estados sellados. El motor va PRIMERO en el router
  (`actionHandler.js`), así que un nodo conversación llamado `SHOW_CART`
  sombrearía a `cartFlow` (carrito roto) y `ASESOR` rompería el silencio sellado.
- Viola la regla dura del diseño (`DISENO_MOTOR_FLUJO.md` §G.2: STEPS del
  intérprete NUNCA incluye ASESOR/LISTA_ESPERA/CSAT/DEVOLUCION).
- **Fix:** lista negra en `grafoPut` (y en el linter): un nodo NUEVO no puede
  llamarse como estado sellado. Lista (del enum S en `_shared.js`):
  `SHOW_CART, CONFIRM_ORDER, ASK_CP, SPLIT_DELIVERY, SPLIT_CONFIRM, DELIVERY,
  PICKUP_CONFIRM, CONFIRM_DIR_GUARDADA, ASK_NOMBRE, ASK_CALLE, ASK_COLONIA,
  ASK_CIUDAD, ASK_REF, PAGO_METODO, PAGO_COMPROBANTE, ASESOR, LISTA_ESPERA,
  CSAT, DEVOLUCION, OFERTAS, CUPON, VARIANTE, ADD_MORE(?)`. Los que ya existen
  en el grafo como sistema/delegados quedan (protegidos por el candado actual);
  lo prohibido es CREARLOS como conversación no-delegada.
- **Test:** grafoPut con nodo `paso:'ASESOR', tipo:'conversacion'` → 400.

## 🟠 MAYORES — el flujo "funciona" pero el autor queda cojo

### M1. No hay forma de escribir EL TEXTO de una pieza nueva desde la UI
- **Verificado:** `t('promo_x')` devuelve `''` salvo que exista
  `configuracion.frase_promo_x` (eso SÍ funciona — el mecanismo existe). Pero el
  tab "Editor del bot" (`BotEditorTab` + `GET /api/prime/frases`, en
  `primeConfig.js:frasesGet`) solo lista `Object.keys(conf.FRASES)` (catálogo
  fijo) — nunca muestra claves nuevas. Resultado: pieza nueva = bot mudo.
- **Fix:** en el panel del lienzo (MotorCanvas), un Textarea "Texto que responde
  el bot" que lea/escriba `configuracion.frase_<clave>` directamente (endpoint
  `PUT /api/prime/frases` ya existe y es genérico — verificar que acepta claves
  fuera del catálogo; si no, ampliarlo). Autogenerar la clave desde el nombre del
  paso (`PROMO_X` → `frase_motor_promo_x`).

### M2. No hay paleta de acciones (el corazón del gap vs ComfyUI)
- Las acciones que hacen que un nodo HAGA algo (`ACTIONS` en
  `bot/flows/motor/actions.js`: buscar_producto, agregar_carrito, aplicar_cupon,
  cargar_dias_cita, crear_cita, cobrar_anticipo, grabar_pedido_*, escalar,
  render_menu) NO se pueden asignar desde el editor — ni `accion` en cables ni
  `accion_entrada` en nodos. Solo se pueden crear piezas de texto estático.
- **Fix:** catálogo de acciones con metadata humana (nombre, descripción, qué
  produce, params permitidos, si es sellada) exportado del backend
  (`GET /api/prime/motor/acciones`), y en la UI: selector de acción en el panel
  del nodo (accion_entrada) y en el modal del cable (accion). Las selladas se
  marcan y sus params se limitan a la whitelist (§D: porcentaje, frase_clave,
  metodo_entrega_default).

### M3. Las piezas no explican qué son (la queja "seco vs ComfyUI")
- Un nodo dice `SEARCHING` y ya. Falta: descripción humana en el nodo y en el
  panel ("Aquí el cliente busca un producto. Sale con resultados o a lista de
  espera"), y qué salidas/condiciones tiene cada pieza base.
- **Fix:** registro estático `DESCRIPCIONES_PASO` (paso → {titulo, descripcion,
  salidas}) en un módulo compartido o en el propio motorFlujo.js; mostrarlo como
  subtítulo del nodo + tooltip + panel.

### M4. No hay revertir versiones, y "Cambiar a este diseño" pisa sin confirmar
- `grafoPut` guarda versión nueva y la anterior queda inactiva "para revertir",
  pero NO existe endpoint ni UI de revert. `activarPost` (cambiar de plantilla)
  reemplaza el grafo activo sin confirmación → ediciones custom quedan en una
  versión huérfana irrecuperable desde la UI.
- **Fix:** `GET /api/prime/motor/versiones` (lista id/version/giro_base/creado_en)
  + `POST /api/prime/motor/revertir { id }` (activo=1 a esa versión, lint-check).
  UI: confirmación antes de "Cambiar a este diseño" + dropdown "Versiones" con
  restaurar.

## 🟡 MEDIAS

1. **Orden de cables importa y nadie lo dice:** matching por orden de guardado
   (`aristas.find` en orden). Si el `*` se dibuja antes que "opción 1", el
   comodín se traga todo. Fix: al guardar, ordenar aristas poniendo `*` al final
   (server-side, determinista); opcional: warning del linter.
2. **Escalada por 3 reintentos manda mensaje VACÍO:** `interprete.js` paso 2:
   `t('escalar_asesor') || t('msg_asesor')` — ambas claves NO existen en FRASES →
   `''`. Fix: fallback literal ("Te comunico con un asesor 👤...") o añadir la
   frase al catálogo.
3. **Callejones sin salida permitidos:** pieza sin cables de salida pasa el
   linter; el cliente re-lee el texto 3 veces y cae a asesor. Implementar §D.2 #6
   (toda rama llega a terminal) o al menos warning.
4. **Nada avisa que el motor está OFF al guardar:** guardas y el bot no cambia
   (flag `motor_flujo_activo` en Módulos). Fix: toggle del motor ahí mismo en el
   tab (PUT al flag, prime-only) o aviso post-guardado "el motor está apagado".

## 🟢 MENORES

- No se puede marcar/cambiar la pieza inicial (⭐) desde el editor.
- Falta un "simulador de conversación" en el tab para probar el flujo sin
  WhatsApp (equivalente al Queue/preview de ComfyUI). Idea: endpoint prime-only
  que corra `interprete.handle` contra una sesión sintética en la BD real
  (sin client) y un chat fake en la UI.
- `PUT /api/prime/motor/nodo` quedó redundante con `PUT /grafo` (borrar cuando
  la UI ya no lo use — hoy ya no lo usa).
- `ModalCondicion` usa `useMemo` para side-effects de sincronización (funciona,
  pero frágil — cambiar a useEffect).

---

## PLAN DE ACCIÓN (orden acordado con el dueño)

1. **C1 + C2** — aristas custom de nodos delegados se evalúan ANTES de delegar;
   llegar a un delegado despacha su código. Tests runtime + **paridad/golden
   deben seguir verdes** (JC byte-idéntico es la condición de mérito).
2. **C3** — lista negra de pasos sellados en `grafoPut` + linter. Test 400.
3. **M1** — texto de la pieza editable en el panel del lienzo (frase_<clave> en
   configuracion; revisar/ampliar PUT /api/prime/frases).
4. **M2 + M3** — catálogo de acciones con descripciones (endpoint + paleta UI) y
   descripciones humanas en piezas base.
5. **Medias** — orden de cables server-side, frase de escalada, aviso/toggle de
   motor OFF, callejones sin salida (warning).
6. **M4 + simulador** — versiones/revert + chat de prueba en el tab.

### Reglas que NO se negocian al implementar (recordatorio)
- Julio Cepeda byte-idéntico: `npm run test:golden` y `npm run test:paridad`
  verdes en cada paso. El golden es el ancla (tests/golden/jc.json).
- La frontera sellada §D vive en el SERVIDOR (el lienzo solo la refleja).
- Dinero/inventario: nada del editor toca `marcar-pagado` ni descuenta stock.
- Comunicados masivos: FUERA del motor, supervisión humana, tiempos escalonados
  INMUTABLES (§G.7) — ningún nodo/acción del editor puede enviar masivos.
- Migraciones: `migrations/NNNN_*.sql` + espejo en `db/schema.sql` + `--all`
  (3 instancias: principal/.env + instancias/barberia.db + instancias/restaurante.db).
- Suite del motor: `npm test` ya encadena golden/motor/interprete/render/paridad/
  barberia/anticipo/fase5/suscripcion/mesa/editor — todo debe seguir verde.

### Archivos clave
- `bot/flows/motor/interprete.js` — loop del intérprete (C1/C2 se arreglan aquí).
- `bot/flows/motor/actions.js` — registro ACTIONS (M2 lo expone).
- `bot/flows/motor/linter.js` — validación (C3/medias amplían aquí).
- `bot/flows/motor/grafo.js` / `seeder.js` / `plantillas/*.json` (versionadas en
  git — ojo: .gitignore tiene `*.json` con excepción `!bot/flows/motor/plantillas/*.json`).
- `dashboard/routes/motorFlujo.js` — GET/PUT grafo, activar, plantillas (+_test).
- `dashboard-ui/src/pages/prime/MotorCanvas.jsx` / `MotorTab.jsx` — lienzo/tab.
- `tests/test_motor_editor.js` (5/5) y resto de suite `tests/test_motor_*.js`.
