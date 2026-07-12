# Arquitectura del bot data-driven — diseño ejecutable

> Objetivo: que el **flujo y las frases** del bot vivan en **datos por instancia**,
> no en código, editables visualmente (idea "tipo ComfyUI"), sin romper Julio Cepeda
> (byte-idéntico) ni los ~100 tests del pipeline. La pieza central es la **migración
> segura**. La sección F da la recomendación honesta de hasta dónde vale la pena llegar.

Fecha: 2026-07. Evidencia verificada en código (archivo:línea), no asumida.

---

## Resumen ejecutivo (léelo primero)

Hoy el sistema **ya tiene el 60% de "frases en datos" hecho**: `t(clave, vars)` prioriza
`configuracion.frase_<clave>` por instancia (`bot/flows/_config.js:186-190`) y hay un editor
en Prime (`dashboard/routes/primeConfig.js:166-188`). El problema real es que **solo ~12 de
las ~130 respuestas del bot pasan por `t()`**; el resto son *string literals inline* dentro de
los `handle()` de cada flow (58 en `menuFlow.js`, 26 en `cartFlow.js`, 27 en `orderFlow.js`…).
Y la **topología** (qué estado sigue a cuál) está incrustada en `if/switch` + `updateSession()`.

**Recomendación (sección F, resumida):** NO construyas un motor de grafo genérico reconectable
por el usuario. El ROI está en **dos entregables acotados**:

1. **Fase 1 — Frases 100% en datos** (todas las respuestas ruteadas por `t()`, un `frase_<clave>`
   por cada una). Esto resuelve el 90% del dolor real del dueño ("no tocar código para variar
   texto por tienda") con **riesgo bajo** y **cero cambio de topología**.
2. **Fase 2 — Mapa visual de solo-lectura** del grafo de estados (generado desde el enum `S`
   y las transiciones, o declarado en un JSON versionado-en-código). El dueño *ve* el flujo,
   *edita el texto de cada nodo*, pero **no reconecta aristas**.

El "motor ComfyUI completo" (aristas editables, topología en DB) se descarta por costo/riesgo
vs. beneficio: rompe checkout, invalida los tests, y **nadie de las tiendas white-label va a
recablear un flujo de venta** — quieren cambiar el texto y el orden del menú, y eso ya cabe en
datos sin un intérprete de grafo. Detalle y números por fase abajo.

---

## A. Diagnóstico — qué está en código que debería ser dato

### A.1 Frases: 12 en datos, ~118 inline

`FRASES` en `bot/flows/_config.js:76-155` tiene **12 claves** con presets de tono A/B/C/D:
`saludo_nuevo, saludo_recurrente, menu_opciones, buscar_inicio, wizard_q1, asesor_notificado,
agregado_pagar, disponibilidad_local, cancelado, error_generico, texto_libre, lista_espera_oferta,
gracias_cierre`. Estas **sí** son overridables por instancia vía `frase_<clave>` (`_config.js:186`).

Todo lo demás es texto **incrustado en el `return` de cada handler**. Conteo de `return`-con-literal
(aprox., verificado con grep):

| Flow | Líneas | `return` con string literal | Estados |
|---|---|---|---|
| `menuFlow.js` | 685 | ~58 | MENU, SEARCHING, WIZARD_Q1/Q2/Q3, VIEW_PRODUCT, ADD_MORE, REFERIDOS, VARIANTE |
| `cartFlow.js` | 422 | ~26 | SHOW_CART, CONFIRM_ORDER, OFERTAS, CUPON, PAGO_METODO |
| `orderFlow.js` | 488 | ~27 | ASK_CP, SPLIT_*, DELIVERY, PICKUP_CONFIRM |
| `addressFlow.js` | 168 | ~12 | ASK_NOMBRE..ASK_REF |
| `asesorFlow.js` | 322 | ~19 | ASESOR, LISTA_ESPERA, SUSTITUTO, CSAT, DEVOLUCION |
| `citasFlow.js` | 153 | ~11 | CITA_SERVICIO/FECHA/HORA/CONFIRMA |

Ejemplos concretos de texto que **debería ser dato** y hoy es código:

- Preguntas del wizard 2/3 y presupuesto: `menuFlow.js:379,383,386,393,398,405` — literales
  `"*Pregunta 2 de 3* — ¿Qué tipo de ${vocab().item}?..."`. Solo `wizard_q1` está en `FRASES`.
- Ficha de producto y sus opciones: `menuFlow.js:442-448, 519-521, 547-553`.
- Lista de espera / imagen no encontrada: `menuFlow.js:312-314, 363-369, 479-495` — mensajes
  largos hardcodeados con `\uXXXX`.
- Bienvenida devolución (dos copias distintas): `actionHandler.js:126-134` y `menuFlow.js:123-131`.
- Todo el flujo de citas: `citasFlow.js:70-72, 82-84, 114-116, 125, 145-146`.
- Toda la dirección: `addressFlow.js` pregunta calle/colonia/ciudad/ref con literales.

El patrón `t('clave') || 'fallback literal'` (ej. `menuFlow.js:110,118,361`) mantiene **dos
copias** del texto: la de datos y un fallback muerto (nunca se renderiza porque `t()` siempre
devuelve algo). Es deuda pura.

### A.2 Vocabulario: parcialmente en datos

`vocab()` (`_config.js:201`) inyecta `{item}/{items}/{emoji}` del giro. Se usa **30 veces** en
strings inline (`grep`: cartFlow 8, menuFlow 12, orderFlow 3, etc.). Bien resuelto, pero solo
cubre 3 variables; el resto del copy sigue hardcodeado alrededor.

### A.3 Transiciones (topología): 100% en código

No hay ninguna representación de datos del grafo. Cada transición es una línea imperativa:

- Router: `actionHandler.js:147-158` recorre `FLOWS` y despacha por `flow.STEPS.includes(step)`.
- Dentro de cada `handle()`, la transición es `sessionManager.updateSession(userId, S.SIGUIENTE, data)`
  seguida de `return <texto del nuevo nodo>`. Ej. `menuFlow.js:109` (MENU→SEARCHING),
  `:117` (MENU→WIZARD_Q1), `:609` (VIEW_PRODUCT→ASK_CP).
- Los "inputs" que disparan aristas son `if (action==='1')`, regex (`menuFlow.js:121,182`,
  `_INTENT_REGEX:295`), o `resolverOpcionMenu(action)` (`menuFlow.js:107`).

### A.4 Opciones de menú: **ya semi-data-driven** (importante)

El menú principal ya está desacoplado de posiciones fijas: `_shared.menuDeGiro/menuItemsActivos/
resolverOpcionMenu/menuOpcionesAdaptativo` (`_shared.js:1077-1154`) construyen el subconjunto y
orden de opciones por giro. Esto es el precedente arquitectónico correcto y **el patrón a
generalizar**: la lista de opciones de un nodo puede venir de datos.

### A.5 Validaciones de input: en código, mezcladas con negocio

`if (!m[action]) return 'Responde con 1, 2, 3 o 4.'` (`menuFlow.js:375,391,396,403,408`) mezcla
tres cosas: el *set válido* (dato), el *mapeo input→valor semántico* (dato) y el *mensaje de error*
(dato). Todo hoy es código.

### A.6 Persistencia de sesión — ya es genérica (a favor nuestro)

`sesiones_bot` guarda `{ paso_actual TEXT, data_json TEXT }` (`sessionManager.js:13-20`). El motor
no necesita cambiar el modelo de sesión: `paso_actual` ya es un string libre y `data` un blob JSON.
**Cualquier** máquina de estados data-driven encaja sin migrar esta tabla.

**Conclusión del diagnóstico:** lo que duele (texto por tienda) es **datos atrapados en código**.
La topología, aunque también está en código, **no es lo que las tiendas piden cambiar** — y es
exactamente el checkout que no debe ser reconectable (sección D).

---

## B. Modelo de datos del grafo

> Principio: **acciones de negocio = código; nodos, prompts, opciones y transiciones simples = datos.**
> Un nodo referencia una acción por *nombre*, no la contiene.

### B.1 Conceptos

- **Nodo** = un `paso_actual`. Tiene: `prompt` (clave de frase → `t()`), lista de `opciones`
  (label + input que la dispara), y opcionalmente una `accion` de negocio a ejecutar al entrar/salir.
- **Arista** = transición: `(nodo_origen, input) → nodo_destino`. El `input` es un matcher
  (`"1"`, `"regex:..."`, `"cualquiera"`, o `"resultado:ok|escalar"` para el retorno de una acción).
- **Slot** = variable que el flujo captura y persiste en `session.data` (ej. `cita_fecha`,
  `carrito`, `cp`). Ya existe como llaves de `data_json`; solo se documenta cuáles capta cada nodo.
- **Acción** = función de negocio en código, registrada en un `ACTIONS` map (buscar producto,
  agregar al carrito, `grabarPedido*`, cobrar). El nodo la llama por nombre; **su lógica NO es dato**.

### B.2 Tablas SQLite (por instancia — sin `tenant_id`, coherente con instancia-por-cliente)

```sql
-- Un grafo por instancia. Versionado para poder revertir.
CREATE TABLE flujo_grafo (
  id            INTEGER PRIMARY KEY,
  version       INTEGER NOT NULL DEFAULT 1,
  activo        INTEGER NOT NULL DEFAULT 0,   -- solo 1 activo a la vez
  creado_en     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE flujo_nodo (
  id_grafo      INTEGER NOT NULL REFERENCES flujo_grafo(id),
  paso          TEXT NOT NULL,                -- = paso_actual (ej. 'MENU', 'WIZARD_Q2')
  tipo          TEXT NOT NULL DEFAULT 'conversacion', -- 'conversacion' | 'sistema' (ver sección D)
  frase_clave   TEXT,                         -- clave para t(); el TEXTO vive en configuracion.frase_<clave>
  accion_entrada TEXT,                        -- nombre en ACTIONS (opcional), corre al llegar al nodo
  PRIMARY KEY (id_grafo, paso)
);

-- Opciones renderizadas del nodo (el "menú" del nodo). NULL opciones = nodo de texto libre.
CREATE TABLE flujo_opcion (
  id_grafo   INTEGER NOT NULL,
  paso       TEXT NOT NULL,
  orden      INTEGER NOT NULL,
  label      TEXT NOT NULL,                   -- lo que ve el cliente ("🔍 Buscar")
  input      TEXT NOT NULL,                   -- matcher: '1' | 'kw:buscar' | 'regex:...' 
  destino    TEXT NOT NULL,                   -- paso destino
  accion     TEXT,                            -- acción de negocio a correr en la transición
  PRIMARY KEY (id_grafo, paso, orden)
);

-- Fallback del nodo cuando ningún input matchea (ej. "Responde con 1, 2 o 3").
-- (o se deriva de frase_<paso>_invalido). Se guarda en flujo_nodo.frase_clave + sufijo.
```

Las **frases** NO se duplican aquí: siguen en `configuracion.frase_<clave>` (patrón existente,
`_config.js:186`), y `flujo_nodo.frase_clave` solo apunta. Así el editor de frases actual
(`primeConfig.js:166`) se reutiliza tal cual.

### B.3 Cómo un nodo referencia una acción de negocio

```js
// bot/flows/motor/actions.js — el ÚNICO puente datos→código de negocio.
// Cada acción es una función pura-ish (ctx) → { ok, data, resultado }. NADA de topología aquí.
const ACTIONS = {
  buscar_producto:   (ctx) => { const r = searchProducts(ctx.raw, 3, ctx.tel); return { resultado: r.results.length?'hay':'vacio', data:{ products:r.results } }; },
  agregar_carrito:   (ctx) => { const r = agregarAlCarrito(ctx.data.carrito||[], ctx.data.viewing); return { resultado: r.escalar?'escalar':(r.ok?'ok':'lleno'), data:{ carrito:r.carrito } }; },
  grabar_pedido:     (ctx) => grabarPedidoEnvio(ctx),   // ← código, intocable (sección D)
  // ...
};
```

El nodo declara `accion: 'buscar_producto'` y sus opciones ramifican por `input:'resultado:hay'`
vs `'resultado:vacio'`. **El intérprete nunca sabe qué hace la acción**, solo su nombre y su
`resultado`. Esto es la frontera dato/código.

---

## C. El motor (intérprete genérico)

Un solo módulo, ~120 líneas, que reemplaza el cuerpo de los `handle()` **de los flows de
conversación** (no los de sistema). Convive con el router actual detrás de un flag.

```js
// bot/flows/motor/interprete.js  (bosquejo)
async function handleNodo(ctx) {
  const grafo = cargarGrafoActivo();            // cache 60s, mismo patrón que _config
  const nodo  = grafo.nodos[ctx.step];
  if (!nodo) return undefined;                  // no es del motor → sigue el router viejo

  // 1. resolver la opción elegida contra los inputs del nodo
  const opt = nodo.opciones.find(o => matchInput(o.input, ctx.action, ctx.raw));
  if (!opt) return t(nodo.frase_clave + '_invalido') || t(nodo.frase_clave); // reprompt

  // 2. correr la acción de negocio (código), si la arista tiene una
  let res = { resultado: 'ok', data: {} };
  if (opt.accion) res = await ACTIONS[opt.accion](ctx);

  // 3. destino: fijo, o ramificado por res.resultado (opt.input 'resultado:xxx')
  const destino = resolverDestino(nodo, opt, res.resultado);

  // 4. persistir slots + avanzar estado (misma API de siempre)
  sessionManager.updateSession(ctx.userId, destino, { ...ctx.data, ...res.data });

  // 5. renderizar el prompt del NODO DESTINO con las frases de la tienda
  return t(grafo.nodos[destino].frase_clave, slotsToVars(ctx.data, res.data));
}
```

`matchInput` cubre los 3 casos que ya existen en código: dígito exacto, keyword
(`resolverOpcionMenu`-style), regex. `slotsToVars` mapea `session.data` → las `{vars}` que `t()`
inyecta (igual que hoy `t('agregado_pagar', {producto})`).

### Convivencia con el router actual (crítico para la migración)

`actionHandler.js:147` ya itera un array de flows y despacha por `STEPS.includes(step)`. El motor
se registra como **un flow más**, al FINAL del array, que declara `STEPS = <pasos del grafo activo>`:

```js
const FLOWS = [ menuFlow, cartFlow, orderFlow, addressFlow, asesorFlow,
  ...(motorActivo() ? [require('./motor/interprete')] : []) ];  // flag
```

Durante la migración, un paso puede estar **o** en un flow viejo **o** en el grafo, nunca en ambos
(el `break` en `actionHandler.js:157` garantiza que gana el primero que lo declare). Migras estado
por estado moviéndolo del flow viejo al grafo, con el flag encendido solo para los estados ya migrados.

---

## D. Frontera: nodos "de sistema" vs "de conversación"

**Regla dura:** la topología del checkout/dinero/inventario **NO es reconectable por el usuario.**
Solo su *texto* es editable.

### Nodos de SISTEMA (`flujo_nodo.tipo='sistema'`) — topología FIJA en código

Su secuencia y sus acciones viven en los flows de código actuales; el motor **no los interpreta**.
El editor solo deja tocar su `frase_clave`. Son:

- Todo `orderFlow.js`: `ASK_CP → SPLIT_* → DELIVERY/PICKUP_CONFIRM/SPLIT_CONFIRM`. Aquí vive
  `partirCarrito`, `validarStockMultiple`, cálculo de flete. Recablear esto = vender mal.
- `cartFlow.js`: `CONFIRM_ORDER`, `PAGO_METODO`, `PAGO_COMPROBANTE` → llaman `grabarPedido*`,
  `insertarPedidoConCarrito`, `registrarMetodoPago`, cobro.
- `addressFlow.js`: la captura de dirección alimenta el envío; el orden de campos es contractual
  con Estafeta/paquetería.

El motor **puede** ejecutar estos flows (siguen siendo un flow en `FLOWS`), pero **el editor visual
marca sus nodos como bloqueados**: aristas grises, no arrastrables; solo el campo "texto" es editable.

### Nodos de CONVERSACIÓN (`tipo='conversacion'`) — editables (texto + orden de opciones + destino simple)

- Menú y sus opciones (ya semi-data, A.4), búsqueda/`SEARCHING`, wizard, ficha de producto,
  ofertas, referidos, lista de espera, **citas completas**, saludos, texto libre, cancelación.
- Aquí el dueño *sí* puede: cambiar textos, reordenar opciones del menú, activar/desactivar una
  rama (ej. quitar el wizard en un giro), enrutar a `ASESOR`. Nada de esto toca dinero.

### Cómo el motor impide romper el flujo crítico

1. **Validación al guardar el grafo** (en el endpoint de guardado, no en runtime): un nodo de
   sistema no puede cambiar su `destino` ni sus `accion`; solo `frase_clave`. Se rechaza el POST.
2. **Grafo debe ser "cerrado":** todo `destino` referenciado existe, y toda rama de checkout
   desemboca en un nodo de sistema terminal (`gracias_cierre`). Un linter de grafo corre al guardar.
3. **Fail-closed en runtime:** si `cargarGrafoActivo()` falla o el nodo no existe, el motor
   devuelve `undefined` y cae al router viejo / menú (igual que `flowsDeGiro` es `require`-tolerante,
   `actionHandler.js:11,146`). Nunca se queda mudo ni cobra dos veces.

---

## E. Migración segura por fases

> Meta invariable de cada fase: `npm run test:bot` sigue **100/100**, y Julio Cepeda
> (`giro=jugueteria`, sin `frase_*` overrides) sale **byte-idéntico**. Cada fase es
> desplegable y reversible sola.

### Fase 0 — Red de seguridad (0.5 día, riesgo nulo)

- Test de "regresión de copy": snapshot de las respuestas de Julio Cepeda para los N estados
  clave (recorrido scripteado con el mock DB de `test_bot.js`). Cualquier fase que cambie un byte
  visible lo rompe. **Sin esto no empieces.**

### Fase 1 — Frases 100% en datos (2–3 días, riesgo BAJO) ← el 90% del valor

Extraer **todos** los literales inline a `FRASES` + `t()`. Mecánico y verificable:

1. Por cada `return '<texto>'` en los flows de conversación, crear una clave en `FRASES`
   (`_config.js`) con el texto **exacto actual** como preset (todos los tonos = el mismo texto
   por ahora; el tono se afina después). Reemplazar el `return` por `return t('clave', {vars})`.
2. Registrar la clave en el `DESCRIPCION` del editor (`primeConfig.js:157`) para que aparezca en Prime.
3. Borrar los fallbacks muertos `t()||'literal'` (A.1) una vez migrada la clave.

Empieza por **`citasFlow.js`** (11 returns, aislado, giro de servicio — el más simple y sin riesgo
de dinero) como piloto, luego `menuFlow`, `asesorFlow`, y deja `orderFlow`/`cartFlow` (dinero) al
final y solo su **texto** (no su lógica).

Resultado: cualquier tienda cambia **cualquier** frase desde Prime, sin tocar código. Topología
intacta. Esto es lo que el dueño realmente pidió.

Esfuerzo: ~130 claves a extraer, ~20-40 min por flow. Riesgo: bajo (cada extracción es un
reemplazo texto-por-texto verificado contra el snapshot de Fase 0).

### Fase 2 — Mapa visual de solo-lectura + editor de nodos (3–4 días, riesgo BAJO-MEDIO)

- Declarar el grafo **en código versionado** (un `grafo.json` o el enum `S` + un mapa de aristas
  derivado de los `updateSession` existentes). No en DB todavía.
- UI en Prime: render del DAG (una lib de grafos ligera o SVG a mano) que muestra cada nodo, su
  frase (editable, reusa el editor de Fase 1) y sus aristas (grises, no editables). Nodos de
  sistema marcados con candado.
- El dueño **ve** el flujo completo y edita el texto de cada nodo en contexto. **No reconecta nada.**

Riesgo medio solo por la UI; el runtime del bot **no cambia** en esta fase (sigue con los flows de
Fase 1). Cero riesgo de romper ventas.

### Fase 3 — Motor interpretado, SOLO nodos de conversación, detrás de flag (5–8 días, riesgo MEDIO)

*Opcional — solo si tras Fase 1+2 el dueño realmente necesita reordenar ramas por tienda.*

- Implementar `interprete.js` (sección C) y las tablas (B.2), poblando el grafo desde el `grafo.json`
  de Fase 2 (una sola instancia de verdad).
- Encender el flag **solo para citas y wizard** primero (ramas sin dinero, ya migradas a `t()`).
  Correr en paralelo: el estado está en el grafo XOR en el flow viejo (garantía del `break`).
- `orderFlow`/`cartFlow`/`addressFlow` **nunca** entran al intérprete: quedan como flows de sistema
  para siempre (sección D).

Riesgo medio: es código nuevo en el hot path. Mitigado por (a) fail-closed al router viejo,
(b) flag por-estado, (c) snapshot de Fase 0 corriendo en CI.

### Lo que NO se hace en ninguna fase

Aristas de checkout editables por el usuario, topología de dinero en DB, tono auto-generado por LLM
como fuente de verdad. Eso es la sección F.

---

## F. Riesgos y recomendación honesta (¿vale la pena el motor completo?)

### El costo real de un motor ComfyUI completo

- **Rompe el modelo de tests.** `test_bot.js` re-evalúa el pipeline y valida flujos concretos; un
  grafo editable en DB significa que "el flujo" ya no está en el código que los tests conocen — hay
  que testear el *intérprete* Y validar N grafos posibles. Los ~100 tests actuales dejan de proteger
  la conducta real.
- **Es una superficie de fallo nueva en el hot path de ventas.** Un grafo mal guardado por un usuario
  = ventas perdidas. La sección D lo mitiga, pero cada mitigación es código y complejidad que hoy
  no existe.
- **Nadie de las tiendas white-label va a recablear un flujo de venta.** El dueño de una carnicería
  o una barbería quiere: (1) cambiar el texto, (2) cambiar el orden/subset del menú, (3) prender/
  apagar módulos. **Las tres ya caben en datos sin un intérprete de grafo** — (1) es Fase 1, (2) ya
  existe (`menuDeGiro`, A.4), (3) ya existe (`moduloActivo`). Un editor de aristas drag-and-drop es
  una feature que suena bien en demo y no se usa en producción.
- **La topología del bot es genuinamente simple y estable.** ~25 estados, mayormente lineales. No es
  un dominio que se beneficie de un motor genérico; se beneficia de que su *texto* sea configurable.

### Recomendación

**Haz Fase 1 (frases 100% en datos) y Fase 2 (mapa visual de solo-lectura). Detente ahí.**

Eso entrega exactamente lo que el dueño articula ("no tocar código operativo para variar texto por
tienda") con riesgo bajo, sin invalidar los tests, y con Julio Cepeda byte-idéntico. El "mapa visual"
da la sensación ComfyUI (ves el grafo, editas cada nodo) sin el pasivo de un intérprete reconectable.

**Fase 3 (motor interpretado) solo si** aparece una necesidad concreta y repetida de reordenar ramas
*de conversación* por tienda que Fase 1+2 no cubra — y aún entonces, **jamás** sobre checkout/dinero.

El "punto intermedio de mejor ROI" es, textualmente: **frases 100% en datos + mapa visual de
solo-lectura**. Es el 90% del beneficio por el 30% del costo y el 10% del riesgo del motor completo.

---

### Apéndice — evidencia archivo:línea

- Router y despacho: `bot/actionHandler.js:18-24, 147-158`.
- Override de frase por instancia: `bot/flows/_config.js:186-190`; editor: `dashboard/routes/primeConfig.js:166-188`.
- 12 claves en datos: `bot/flows/_config.js:76-155`.
- Texto inline (ejemplos): `menuFlow.js:379-448, 519-553, 312-369`; `citasFlow.js:70-146`; `addressFlow.js` (todo).
- Fallbacks muertos `t()||'literal'`: `menuFlow.js:110,118,361`.
- Transiciones imperativas: `menuFlow.js:109,117,609` vía `sessionManager.updateSession`.
- Menú ya semi-data-driven: `_shared.js:1077-1154`.
- Vocab en 30 sitios inline: grep `vocab()` en `bot/flows/` (cartFlow 8, menuFlow 12, orderFlow 3, …).
- Sesión genérica (no requiere migración): `sessionManager.js:13-20`.
- Fail-closed precedente: `actionHandler.js:11,146` (`flowsDeGiro` require-tolerante).
