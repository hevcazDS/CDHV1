# Plan de implementación — Motor de flujo configurable

> Fecha: 2026-07-12. Evidencia verificada en código (archivo:línea). Cero suposiciones.
> Este plan sustituye/aterriza los 4 docs previos (`DISENO_MOTOR_FLUJO.md`,
> `ARQUITECTURA_BOT_DATADRIVEN.md`, `FACTIBILIDAD_EDITOR_BOT_VISUAL.md`) con lo que
> **sí se puede construir sin romper producción**, resolviendo los dos bloqueos reales:
> el conteo real de literales inline y la ausencia de una BD sembrada para el golden snapshot.

---

## 0. Veredicto (léelo primero)

**Fase 1 (frases→datos) SÍ. Intérprete de grafo: NO todavía — y probablemente nunca completo.**

Argumento con evidencia, no opinión:

1. **El problema del dueño ("las frases no viven en código") lo resuelve Fase 1 sola.** Hoy
   solo 12 claves pasan por `t()` (`_config.js:76-155`); el resto es texto inline. Sacar ese
   texto a `t()`/`configuracion.frase_<clave>` es **mecánico, byte-verificable y sin tocar
   topología**. Reusa la tubería que YA existe (`_config.js:186-197` prioriza el override por
   instancia; editor `primeConfig.js` + `PUT /api/prime/frases`). Cero tablas nuevas, cero flag,
   cero riesgo en el hot path.

2. **El caso "variar el flujo por giro" que motiva el intérprete YA está resuelto por otra vía
   más barata que corre en producción.** `giroFlows.flowsDeGiro(giro)` (`actionHandler.js:146`)
   ya mergea flows por giro; `citasFlow.js` ya es un flow entero registrado por giro; el menú ya
   es adaptativo por giro (`_shared.menuDeGiro`); los módulos por giro ya se encienden en
   onboarding (`modulosDefaults.js:MODULOS_POR_GIRO`). La diferencia real
   "barbería-con-anticipo vs sin-anticipo" es **un módulo (`citas_anticipo_activo`) + un nodo de
   cobro**, no un grafo reconectable. Se resuelve con el patrón que ya existe (un flow + un
   `moduloActivo()`), no con un intérprete.

3. **El intérprete tiene un costo que los docs previos subestiman: rompe el modelo de tests.**
   `test_bot.js` corre con un **mock DB de 25 líneas** (`test_bot.js:30-60`) que solo entiende
   `sesiones_bot`. Un grafo en tablas (`flujo_grafo/nodo/arista`) exige que ese mock sepa
   servirlas, o los 100 tests dejan de proteger la conducta real (pasarían por vacuidad: sin
   grafo → `undefined` → router viejo). Cada tabla del motor es superficie de test nueva en el
   camino de ventas.

**Conclusión:** construir **Fase 0 (red de seguridad) + Fase 1 (frases→datos)**. Detenerse ahí y
entregar el **mapa visual de solo-lectura** (`FACTIBILIDAD_EDITOR_BOT_VISUAL.md` §E, MVP) que se
alimenta de las claves ya migradas. El intérprete de grafo (Fase 2+) queda documentado abajo como
**condicional**: solo si aparece una necesidad concreta y repetida que Fase 1 + `giroFlows` +
módulos no cubran — y aún entonces, jamás sobre checkout/dinero. No se construye especulativamente
(YAGNI).

---

## 0.bis — Aclaración del dueño (2026-07-12): **compilar-y-congelar, NO interpretar en vivo**

El dueño precisó el modelo, y **cambia el veredicto** de arriba. La idea NO es un intérprete que
re-arma y re-evalúa el grafo en cada mensaje (eso es lo que el análisis previo rechazó, con razón).
La idea es un editor tipo **ComfyUI de AUTORÍA**: conectas los módulos (acciones) visualmente = armas
un *workflow*; al **guardar**, ese grafo visual **se compila UNA vez y se congela** en la lógica
operativa del bot; el bot corre lo congelado. El editor **no está en el camino de runtime**.

### Mis comentarios (lo que entendí + la ingeniería honesta)

1. **Entendí bien, y sí resuelve la objeción principal.** El rechazo previo asumía re-interpretar en
   el hot path de ventas. Tu modelo mueve todo el trabajo pesado (validación, linter, cableado,
   chequeo de nodos sellados) al **momento de guardar**, no al de cada mensaje. Eso es exactamente
   *"no que se estén ejecutando en tiempo real cada workflow"*: el workflow se **arma/valida una vez**
   (al guardar) y en runtime solo se **recorre** lo ya congelado.

2. **"Compilar" tiene dos sabores — uno es correcto, el otro peligroso:**
   - ✅ **(a) Compilar a DATOS congelados**: el grafo del editor → un artefacto JSON **validado +
     versionado** (una tabla de estados/transiciones), que un **ejecutor diminuto (~100-150 líneas)**
     recorre. El ejecutor sigue leyendo datos por mensaje, pero **no re-arma ni re-valida** nada. Es
     "compile-and-freeze", barato, snapshotable (golden test) y seguro. **Este es el camino.**
   - ❌ **(b) Compilar a CÓDIGO JS generado** (`flows/generado_X.js` que el bot hace `require`/`eval`):
     **NO.** Superficie de inyección/eval, imposible de revisar en un PR, indebuggeable a las 3am,
     rompe el boring-tech. Aunque técnicamente es "compilar", el costo/riesgo no vale la pena.

3. **Esto SÍ mejora el veredicto: intérprete-como-compile-and-freeze = VIABLE** (no el intérprete-en-vivo).
   La diferencia clave que lo hace factible: el **linter vive en el guardado** (rechaza un workflow que
   "venda gratis" o toque un nodo de dinero, §D.2 del diseño), y el **artefacto congelado se testea con
   el golden snapshot** igual que código. Ya no "pasa por vacuidad": compilas el workflow de JC, lo
   congelas, y el golden exige byte-identidad sobre ESE compilado.

4. **La frontera sellada NO cambia — y es lo que hace que "se pueda hacer" sin miedo.** Aunque compiles,
   los nodos de **dinero/checkout/inventario/ASESOR** (grabar pedido, `marcar-pagado`, descuento de
   stock, relevo humano — ver §G.5/G.6 del diseño) se muestran en el editor como **bloques BLOQUEADOS**:
   editas su texto y algún param (ej. % de anticipo), **no su cableado**. El compilador **rechaza guardar**
   un workflow que los reconecte. Lo que el editor deja rearmar es el **embudo conversacional** hasta el
   cobro (menú→buscar→ver→carrito, agendar, preguntas del wizard); el **cobro es una caja negra sellada**
   que el grafo *invoca* pero no redefine.

5. **Cubre los 4 casos del dueño sin tocar dinero:** barbería con/sin anticipo = un nodo de anticipo
   **opcional** antes del bloque de cobro sellado; ISP = agendar a domicilio (nodo de dirección +
   `citasFlow`); restaurante = menú + entrega (ya hay mesas/repartidor); freelancer = proyecto/suscripción
   (nodo de cobro con monto/plazo). Todos son **recableados del embudo**, no del checkout.

### Veredicto revisado

- **Fase 0 + Fase 1 (frases→datos): sin cambio, es el prerequisito real** (sin frases en datos el editor
  mostraría nodos vacíos; es el 80% del valor y el 20% del riesgo).
- **Fase 2 (el compilador) AHORA SÍ entra al plan** — no como "intérprete en vivo" sino como
  **compilar-y-congelar**: `compilador.js` toma el grafo del editor, corre el linter, y escribe una
  **tabla de transiciones versionada** (`flujo_compilado`, un blob JSON por versión). El bot carga la
  versión ACTIVA una sola vez (cache, como `_config.js` cachea 60s) y un **walker chico** la recorre.
  Flag por-request, fail-closed al `FLOWS` viejo, nodos de dinero jamás compilados desde el editor
  (vienen de un preset sellado en git).
- **Fase 3 (editor visual ComfyUI):** produce el grafo que la Fase 2 compila. Empieza por
  **editar-texto-y-params de nodos** (cubre barbería 30%↔50% sin reconectar); reconectar aristas de
  conversación es incremental.

Lo único que sigo desaconsejando con firmeza: **codegen a JS** (sabor 2b) y **reconectar nodos de dinero**.
Todo lo demás de tu modelo es construible y lo dejo reflejado en las fases de abajo.

---

## Fase 0 — Red de seguridad (fixture + golden). SIN esto no se empieza.

### 0.1 El bloqueo real

El golden snapshot (capturar las respuestas de Julio Cepeda para comparar antes/después) necesita
una BD, y **este checkout no tiene ninguna** (`*.db` gitignored, `Base de datos demo/` no existe).
El mock de `test_bot.js` (`test_bot.js:30-60`) solo simula `sesiones_bot` — no tiene productos,
inventario ni `configuracion`, así que **no puede** producir las respuestas reales de búsqueda /
carrito / checkout. Hay que sembrar un sqlite temporal mínimo.

### 0.2 Qué necesita el fixture (derivado de lo que leen las funciones reales)

- `productos` — `searchProducts` (`_shared.js:163`) lee name/seo_description/tags/categoría;
  `serviciosDisponibles` (`citasFlow.js:20`) lee `WHERE tipo='servicio' AND activo=1`.
- `inventarios` — `searchProducts` boostea por stock vivo (`_STOCK_VIVO_SQL`, `_shared.js:121`);
  `partirCarrito` (`_shared.js:493`) lee stock por sucursal.
- `configuracion` — `giro=jugueteria`, `nombre_negocio`, `tono_bot` (default C), los toggles de
  módulos. Sin filas → `t()` cae a defaults, que ya son los de JC (`_config.js:163-167`).
- `clientes`, `cobertura`, `citas`, `series_folios` — para el checkout y las citas.
- El esqueleto de tablas: reusar `db/schema.sql` tal cual (no re-tipear el schema — el CLAUDE.md
  advierte que el hand-typed drifta).

### 0.3 Esqueleto del script (NO ejecutable aún — solo especifica la forma)

```js
// tests/fixture_min.js  — siembra un sqlite temporal mínimo para el golden.
// Reusa db/schema.sql (fuente real) en vez de re-tipear columnas. Idempotente.
'use strict';
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

function crearFixture() {
  const dbPath = path.join(os.tmpdir(), 'jc_fixture_' + Date.now() + '.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // 1) Estructura: aplicar el schema real (NO re-tipear a mano).
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

  // 2) Config mínima = Julio Cepeda por defecto (giro juguetería, tono C).
  const cfg = db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)');
  cfg.run('giro', 'jugueteria');
  cfg.run('nombre_negocio', 'Julio Cepeda Jugueterías');
  cfg.run('nombre_negocio_corto', 'Julio Cepeda');
  cfg.run('tono_bot', 'C');
  cfg.run('negocio_configurado', '1');

  // 3) Sucursal + un puñado de productos con stock (búsqueda, carrito, split).
  //    Nombres/categorías conocidos para poder scriptar la búsqueda ("lego").
  const suc = db.prepare("INSERT INTO sucursales (nombre, ciudad) VALUES ('Matriz','Monterrey')").run().lastInsertRowid;
  const prod = db.prepare("INSERT INTO productos (name, seo_description, tags, price, activo, tipo) VALUES (?,?,?,?,1,'fisico')");
  const inv  = db.prepare("INSERT INTO inventarios (id_producto, id_sucursal, cantidad) VALUES (?,?,?)");
  for (const [name, tags, precio, stock] of [
    ['Lego City Policía', 'lego construccion', 599, 8],
    ['Muñeca Barbie',     'barbie muñeca',     349, 4],
    ['Balón de fútbol',   'balon deporte',     199, 0],   // 0 stock → rama lista de espera
  ]) {
    const id = prod.run(name, name, tags, precio).lastInsertRowid;
    inv.run(id, suc, stock);
  }
  // 3b) Un servicio (para el golden de citas cuando citas_activo se prueba aparte).
  db.prepare("INSERT INTO productos (name, price, activo, tipo) VALUES ('Corte de cabello', 150, 1, 'servicio')").run();

  // 4) Cobertura de un CP conocido (checkout envío).
  db.prepare("INSERT INTO cobertura (cp, ciudad, estado) VALUES ('64000','Monterrey','NL')").run();

  db.close();
  return dbPath;                 // el runner lo pone en process.env.DB_PATH
}
module.exports = { crearFixture };
```

### 0.4 El golden runner (secuencia de inputs que cubre las ramas de riesgo)

Un script `tests/golden_snapshot.js` que: (1) llama `crearFixture()`, apunta `DB_PATH` a él,
(2) carga `actionHandler.handleAction` **contra la DB real del fixture** (no el mock — el mock no
tiene productos), (3) reproduce recorridos scripteados y **guarda cada respuesta en
`tests/golden/jc.json`**. Comparación: en cada corrida futura, mismo recorrido → mismo output byte
a byte, o falla. Recorridos mínimos (cubren toda rama con texto):

| # | Recorrido | Ramas / estados que fija |
|---|---|---|
| 1 | `hola` → `1` → `lego` → (ver ficha) → `agregar` → `64000` → `1` (pickup) → confirmar | MENU→SEARCHING→VIEW_PRODUCT→ADD→ASK_CP→PICKUP_CONFIRM (checkout pickup) |
| 2 | `hola` → `1` → `balón` → (0 stock) | SEARCHING→lista de espera / oferta (`lista_espera_oferta`) |
| 3 | `hola` → `2` → wizard Q1/Q2/Q3 | WIZARD_Q1..Q3 (las preguntas inline de `menuFlow`) |
| 4 | `hola` → `1` → `lego` → `agregar` → `64000` → `2` (envío) → dirección completa → confirmar | ASK_CP→DELIVERY→ASK_NOMBRE..ASK_REF→CONFIRM_ORDER (checkout envío + dirección) |
| 5 | `hola` → `4` (asesor) | ASESOR (`asesor_notificado`) |
| 6 | `hola` → `5` (referidos) | REFERIDOS |
| 7 | *(giro barbería, `citas_activo=1`)* `hola` → `agendar` → servicio → día → hora → `1` | CITA_SERVICIO..CITA_CONFIRMA |

Esfuerzo: ~1 día. Riesgo: nulo (solo lee). **Este golden es la condición de mérito de toda fase
posterior**: si cambia un byte de JC sin quererlo, revienta.

> Nota sobre `test_bot.js`: sus 100 tests se quedan **tal cual** (siguen con el mock de sesiones).
> El golden es un runner **aparte** que sí necesita la DB del fixture. No se mezclan: `test:bot`
> prueba el pipeline (rate limit, filtro, quejas); el golden prueba el **copy** de las respuestas.

---

## Fase 1 — Frases → datos (el 90% del valor, riesgo bajo)

### 1.1 Conteo REAL de literales inline (grep verificado 2026-07-12)

`grep -cE "return\s+['\`]"` por flow (returns cuyo cuerpo abre con string literal o template):

| Flow | Líneas | `return` con literal | Estados (conversación) |
|---|---:|---:|---|
| `menuFlow.js`   | 685 | **45** | MENU, SEARCHING, WIZARD_Q1..3, VIEW_PRODUCT, ADD_MORE, REFERIDOS, VARIANTE |
| `cartFlow.js`   | 422 | **20** | SHOW_CART, CONFIRM_ORDER, OFERTAS, CUPON, PAGO_METODO |
| `orderFlow.js`  | 488 | **14** | ASK_CP, SPLIT_*, DELIVERY, PICKUP_CONFIRM |
| `addressFlow.js`| 168 | **10** | ASK_NOMBRE..ASK_REF |
| `asesorFlow.js` | 322 | **11** | ASESOR, LISTA_ESPERA, SUSTITUTO, CSAT, DEVOLUCION |
| `citasFlow.js`  | 152 | **11** | CITA_SERVICIO/FECHA/HORA/CONFIRMA |
| **Total** | | **~111** | |

Más ~5 en `actionHandler.js` (bienvenida devolución, `:126-134`). **~116 literales**, de los
cuales las 12 claves de `FRASES` ya cubren los estados-cabecera. El grueso editable nuevo son
**~90-100 claves** (algunos returns comparten frase o son variantes de una misma; el número exacto
sale al migrar). No son 130 como estimaba el doc viejo — son ~100 tras descontar los que ya pasan
por `t()` y los reprompts triviales.

### 1.2 El patrón EXACTO (byte-idéntico, verificado contra el golden)

Por cada `return '<texto>'` en un flow de **conversación**:

1. **Crear la clave en `FRASES`** (`_config.js`) con el texto actual **exacto** como preset en los
   4 tonos (A=B=C=D = el mismo texto por ahora; el tono se afina después, no en esta fase). Ejemplo
   real con `citasFlow.js:99`:

   ```js
   // _config.js FRASES — texto exacto de citasFlow.js:99, sin cambiar un byte.
   cita_servicio_invalido: {
     A: 'Elige el número de uno de los servicios de la lista, o escribe *menu* para regresar.',
     B: 'Elige el número de uno de los servicios de la lista, o escribe *menu* para regresar.',
     C: 'Elige el número de uno de los servicios de la lista, o escribe *menu* para regresar.',
     D: 'Elige el número de uno de los servicios de la lista, o escribe *menu* para regresar.',
   },
   ```

2. **Reemplazar el `return` por `t('clave', {vars})`.** Las variables interpoladas (`${dias[i].label}`,
   `${slots[j]}`) pasan como `vars`; en la frase se escriben como `{label}`/`{hora}` (patrón ya usado:
   `t('agregado_pagar', {producto})`). Ejemplo con `citasFlow.js:114`:

   ```js
   // ANTES: return `🕐 Perfecto, *${dias[i].label}*. ¿A qué hora?\n\n` + slots.map(...)...
   // DESPUÉS:
   return t('cita_pedir_hora', { label: dias[i].label }) + '\n\n' +
          slots.map((h, j) => `${j + 1}️⃣  ${h}`).join('\n') +
          '\n\n' + t('cita_pedir_hora_pie');
   ```
   Las listas dinámicas (map de servicios/horas) **NO** se meten a `t()` — son datos, no copy.
   Solo el envoltorio de texto se externaliza. La frase queda `'🕐 Perfecto, *{label}*. ¿A qué hora?'`.

3. **`t()` con giro sin override devuelve el preset base = el texto de hoy.** Como JC no tiene
   `frase_<clave>` en `configuracion` y su tono es C, `t()` devuelve exactamente el string que
   estaba inline (`_config.js:188-190`). **Por eso es byte-idéntico** — y el golden de Fase 0 lo
   demuestra en cada commit.

4. **Registrar la clave** en el `DESCRIPCION` del editor (`primeConfig.js`) para que aparezca
   editable en Prime.

5. **Borrar los fallbacks muertos** `t('x') || 'literal'` (`menuFlow.js:110,118,361`) una vez la
   clave existe — `t()` siempre devuelve valor, el `|| 'literal'` es deuda.

### 1.3 Orden de ataque (cada uno desplegable/reversible solo, con el golden verde)

1. **`citasFlow.js` (11 literales)** — piloto. Aislado, giro de servicio, cero dinero, el más
   simple. Valida el patrón end-to-end (incluido el golden de citas, recorrido #7).
2. **`asesorFlow.js` (11)** y **`addressFlow.js` (10)** — chicos, sin math de dinero.
3. **`menuFlow.js` (45)** — el grande, pero todo conversación (búsqueda/wizard/ficha).
4. **`cartFlow.js` (20)** y **`orderFlow.js` (14)** — al final y **solo su texto**. Su lógica
   (`grabarPedido*`, `partirCarrito`, flete) NO se toca; se externaliza el copy alrededor.

Cada flow es un commit independiente: si el golden de sus recorridos pasa, se mergea; si no, se
revierte solo ese flow. `test:bot` sigue 100/100 porque el pipeline no cambia (solo el origen del
string).

### 1.4 Riesgos de Fase 1 y mitigación

| Riesgo | Mitigación |
|---|---|
| Cambiar un `\n` o un emoji al copiar | El golden byte-idéntico lo cataliza en el acto. Copiar por corte/pega, no re-tipear. |
| Frase con interpolación compleja (map de opciones) | No externalizar la lista, solo el envoltorio (§1.2 paso 2). |
| Una clave duplicada pisa otra | Prefijo por flow (`cita_`, `dir_`, `cart_`); revisar colisión al agregar. |
| Romper un fallback `\|\| 'x'` al borrarlo | Borrar solo **después** de confirmar que la clave existe y el golden pasa. |

Riesgo global: **bajo**. Es reemplazo texto-por-texto con un oráculo (golden) que falla ante
cualquier desviación visible.

---

## Fase 1.5 — Mapa visual de solo-lectura (opcional, alto ROI, riesgo bajo)

Una vez las frases están en datos, el "mapa tipo ComfyUI" es casi gratis y da la sensación visual
que el dueño quiere **sin** intérprete (detalle en `FACTIBILIDAD_EDITOR_BOT_VISUAL.md` §D-F):

- `bot/flows/_grafo.js` estático: nodos derivados de los `STEPS` + aristas **decorativas** a mano
  (el bot nunca las lee) + `frases[]` por nodo. ~0.5 día.
- Pestaña Prime `GrafoBotTab.jsx`: layout en columnas por módulo, `<svg>` para líneas, cada nodo
  embebe el editor de frase que ya existe (`PUT /api/prime/frases`). **Sin backend nuevo.** ~2 días.
- Topología **explícitamente read-only**; solo el texto es editable. No react-flow (contradice el
  code-splitting; ~40 nodos no lo justifican).

Esto entrega "ver el flujo + editar frases por tienda" — que es literalmente lo que el dueño
articula — con riesgo bajo y cero código en el hot path.

---

## Fase 2+ — Intérprete de grafo: CONDICIONAL, no ahora

**No se construye especulativamente.** Se construye **solo si** tras Fase 1 aparece una necesidad
concreta y repetida de **reordenar ramas de conversación por tienda** que ni Fase 1, ni
`giroFlows`, ni los módulos cubran. Hoy no existe esa evidencia: los 4 casos del dueño se cubren
sin intérprete:

| Caso del dueño | Cómo se cubre HOY sin intérprete |
|---|---|
| Barbería con/sin anticipo | `citasFlow` (ya existe) + módulo `citas_anticipo_activo` (nuevo, 1 flag) + 1 nodo de cobro que reusa `insertarLinkPago`. Es un `if (moduloActivo(...))`, no un grafo. |
| ISP cita a domicilio | `citasFlow` + reuso de `addressFlow`/`buscarCobertura` (ambos existen). Composición, cero nodo nuevo. |
| Restaurante menú + entrega | `menuFlow`/`cartFlow` con `vocab()` + `entrega_repartidor_activo` (ya se enciende por giro, `MODULOS_POR_GIRO`). Mesa = flow nuevo `MESA_*` (módulo `mesas_activo` ya reservado), análogo a `citasFlow`. |
| Freelancer proyecto/suscripción | Proyecto = carrito de 1 línea de monto libre (reusa `insertarPedidoConCarrito`). Suscripción recurrente = **lo único genuinamente nuevo** (tabla + job en `stockWatcher`), y **no necesita intérprete** — es un job, no topología. |

Ninguno requiere un grafo interpretado. Requieren **1-2 flows nuevos + flags**, que es el patrón
que ya corre en producción con menos riesgo.

**Si aun así se decide construir el intérprete**, el subconjunto MÍNIMO viable (del
`DISENO_MOTOR_FLUJO.md`, ya auditado y corregido) es:

1. **Solo nodos `tipo='conversacion'`.** Checkout/dinero/dirección quedan como flows de código
   sellados (`tipo='sistema'`), el intérprete los **invoca** y nunca los interpreta
   (`DISENO §D`). Los nodos de dinero (lazo G.5/G.6) jamás se interpretan.
2. **Convivencia por flag POR REQUEST** (no al `require` — corrección de auditoría): dentro de
   `handleAction`, `const _flowsActivos = [...FLOWS, ...(motorActivo()?[motor]:[]), ...flowsDeGiro]`
   (patrón de `_giro`, `actionHandler.js:145-146`). Flag `motor_flujo_activo` **en `DEFAULT_OFF`**
   (hoy no está — `modulosDefaults.js`). OFF → JC byte-idéntico.
3. **Fail-closed:** grafo ausente/inválido o acción que lanza → `undefined` → router viejo
   (coherente con `actionHandler.js:151-157`). El bot nunca queda mudo ni cobra a medias.
4. **Migración = la siguiente libre al construir** (regla anti-drift: NO fijar un número en el diseño).
   Al 2026-07-12 el último aplicado es `0060_conciliacion_banco.sql`, así que el motor sería **≥0061** —
   verifica `ls migrations/ | tail -1` antes de crearla. Espejada en `db/schema.sql`.
5. **Prerequisito de test:** extender el mock DB de `test_bot.js` para servir `flujo_*`, o los 100
   tests dejan de proteger la conducta con el flag ON. Esto es trabajo real, no gratis.

Números y detalle completo del intérprete en `DISENO_MOTOR_FLUJO.md` (secciones A-G, ya auditado
en `AUDITORIA_CONEXIONES_BOT.md`). **Este plan recomienda no ejecutar esas fases hasta tener la
necesidad demostrada.**

---

## Resumen de decisión

| Fase | Construir | Esfuerzo | Riesgo | Mantiene `test:bot` verde + JC byte-idéntico |
|---|---|---:|---|---|
| **0. Fixture + golden** | **SÍ** | ~1-1.5 d | nulo (solo lee) | Es el oráculo que lo garantiza |
| **1. Frases → datos** | **SÍ** | ~3-4 d | bajo | Golden byte a byte; pipeline intacto |
| **1.5. Mapa read-only** | **SÍ (opc, alto ROI)** | ~2.5 d | bajo | No toca runtime del bot |
| **2+. Intérprete** | **NO ahora** (condicional) | ~24 d | medio-alto | Rompe el modelo de tests hasta extender el mock |

**Lo honesto:** Fase 0 + 1 (+1.5) entregan exactamente lo que el dueño pidió — frases fuera del
código, editables por tienda, con un mapa para verlas — por ~30% del costo y ~10% del riesgo del
intérprete. El intérprete es una apuesta a una necesidad que hoy no está demostrada y que los
mecanismos existentes (`giroFlows` + módulos + flows nuevos puntuales) ya cubren. No se construye
por adelantado.
```

---

## Master juguetería + complementarios (dirección del dueño 2026-07-12)

> **Esta sección MANDA sobre el "veredicto condicional" de arriba.** El dueño ya decidió el
> modelo y no se contradice: (1) la **juguetería es el MASTER** — la plantilla base COMPLETA y
> canónica, ya en código; (2) citas/mesa/suscripción/proyecto son **módulos COMPLEMENTARIOS**
> que se enchufan como **DELTAS** sobre el master, no flujos paralelos; (3) ejecución =
> **compilar-y-congelar** (0.bis), nunca interpretar-en-vivo ni codegen a JS; (4) groserías/quejas/
> frustración/**ASESOR** son **filtros de plataforma** del pipeline pre-router de `bot/index.js`
> que el master **hereda sellados** — el grafo declara *cuándo* escalar, jamás *cómo*.
>
> Lo de abajo aterriza esos 4 puntos a nivel archivo:línea para que un dev empiece sin reinventar.
> **Cero cambios de producción los propone este plan** — es la especificación de construcción.

### M.0 — Fijaciones anti-drift (verificadas contra el repo 2026-07-12)

Antes de nada, cuatro hechos que corrigen números obsoletos en `DISENO_MOTOR_FLUJO.md`:

1. **Última migración aplicada = `0060_conciliacion_banco.sql`** (`ls migrations/ | sort | tail -1`).
   Por tanto la migración del motor es **`0061_flujo_motor.sql`** — verifica `tail -1` de nuevo al
   construir (la regla anti-drift es "el siguiente libre AL construir", no un número pineado). El
   encabezado y §A.3/§H de `DISENO_MOTOR_FLUJO.md` todavía dicen `0058`/`≥0059`: **están obsoletos**,
   léase `0061`. `PLAN` §Fase 2+ punto 4 ya dice `≥0061` — correcto.
2. **`motor_flujo_activo` NO está en `DEFAULT_OFF`** (`modulosDefaults.js:16-53`, confirmado). Hay que
   **añadirlo** en Fase 2. Con el flag OFF + `FLOWS` intacto, JC es byte-idéntico.
3. **El slot del producto en curso es `data.viewing`** (`menuFlow.js:428,502,557`), no `selectedProduct`.
   Cierra el punto D.7 "verificar" de la auditoría: la acción `agregar_carrito` usa `ctx.data.viewing`.
4. **`ctx` real = `{ userId, session, message, client, raw, action, step, data, tel, isImage }`**
   (`actionHandler.js:144`). El motor usa `userId/action/step/data/tel/raw` — todas presentes.

### M.1 — El MASTER (juguetería) como plantilla, nodo por nodo

El master **no se escribe: se EXTRAE** del flujo actual y se congela en `plantillas/jugueteria.json`.
Estos son sus nodos reales (enum `S`, `_shared.js:31-66`), con la acción sellada que invoca y el
archivo:línea de donde sale cada uno. La columna **tipo** es lo que el compilador marca bloqueado.

| Nodo (`paso`) | tipo | frase_clave (Fase 1) | accion_entrada / accion de arista → función sellada | Evidencia |
|---|---|---|---|---|
| `MENU` | conversacion | `menu_opciones` (ya en `t()`) | — (enruta por `resolverOpcionMenu`) | `menuFlow.js`; `_shared.resolverOpcionMenu` |
| `SEARCHING` | conversacion | `buscar_*` | `buscar_producto` → `searchProducts(raw,3,tel)` **`{results,isFallback}`** | `menuFlow.js:452-474`; `_shared.js:163` |
| `VIEW_PRODUCT` | conversacion | `ficha_*` | (render de `data.viewing`) | `menuFlow.js:428,502` |
| `WIZARD_Q1..Q3` | conversacion | `wizard_q*` | `wizardSearch` — **solo juguetería** (se APAGA en otros giros) | `_shared.js:36-38` |
| `ADD_MORE` | conversacion | `add_more_*` | — | `menuFlow.js` |
| `SHOW_CART` | **sistema** | `carrito_*` | `agregar_carrito` → `agregarAlCarrito(data.carrito, data.viewing)` **`{ok,escalar,carrito}`** | `cartFlow.js`; `_shared.js:387` |
| `OFERTAS` / `CUPON` | **sistema** | `oferta_*`/`cupon_*` | aplicar cupón (math sellada) | `cartFlow.js` |
| `ASK_CP` | **sistema** | `pedir_cp_*` | `buscar_cobertura` → `buscarCobertura(cp)` (row\|null) | `orderFlow.js`; `_shared.js:332` |
| `SPLIT_DELIVERY`/`SPLIT_CONFIRM` | **sistema** | `split_*` | `partir_carrito` → `partirCarrito(carrito, estadoCob)` | `_shared.js:493` |
| `DELIVERY`/`PICKUP_CONFIRM` | **sistema** | `entrega_*`/`pickup_*` | `grabarPedidoEnvio/Pickup/Split` | `orderFlow.js`; `_shared.js:863,819,951` |
| `ASK_NOMBRE..ASK_REF` (+`CONFIRM_DIR_GUARDADA`) | **sistema** | `dir_*` | captura de dirección — **orden FIJO (contractual Estafeta)** | `addressFlow.js` |
| `CONFIRM_ORDER` | **sistema SELLADO** | `confirmar_*` | `grabar_pedido` + `insertarLinkPago('generado')` — **para ahí, NO descuenta stock** | `_shared.js:863,745` |
| `PAGO_METODO` | **sistema** | `pago_*` | `registrarMetodoPago(pedidos[], metodo)` (por folio) | `_shared.js:731` |
| `PAGO_COMPROBANTE` | **sistema** | `comprobante_*` | (subida de comprobante) | `_shared.js:65` |
| `REFERIDOS` | conversacion | `referidos_*` | `referidosService` (código + submenú) | `asesorFlow.js` |

**Nodos de plataforma que el master hereda pero el grafo NO posee** (§M.3): `ASESOR`, `LISTA_ESPERA`,
`CSAT`, `DEVOLUCION` (`asesorFlow.STEPS`, `asesorFlow.js:62`). Son `tipo='sistema'` y **jamás** entran a
`STEPS` del intérprete.

**Regla de extracción (Fase 3 del intérprete):** `jugueteria.json` se genera copiando este mapa 1:1.
Los nodos `conversacion` son los únicos que el motor *interpreta*; los `sistema` se **invocan** vía
`dispatchSistema` (§C.3 del diseño). El golden de Fase 0 (recorridos #1-6 de §0.4) es el oráculo:
compilas `jugueteria.json`, lo congelas, y el golden exige byte-identidad sobre ESE compilado. Solo
entonces se enciende `motor_flujo_activo` para `jugueteria`.

### M.2 — Un módulo complementario = un DELTA sobre el master (sin tocar checkout ni filtros)

Un complementario **no es un JSON de flujo completo**: es un **parche declarativo** sobre
`jugueteria.json`. Formato propuesto (archivo `plantillas/deltas/<giro>.json`, aplicado por el seeder
tras cargar el master):

```json
{
  "base": "jugueteria",
  "apaga":     ["WIZARD_Q1","WIZARD_Q2","WIZARD_Q3","ASK_CP","SPLIT_DELIVERY","SPLIT_CONFIRM","DELIVERY"],
  "reetiqueta":[ { "paso":"MENU", "arista":"kw:buscar", "label":"💈 Agendar", "input":"kw:cita", "destino":"CITA_SERVICIO" } ],
  "agrega_nodos": [
    { "paso":"CITA_SERVICIO", "tipo":"conversacion", "frase_clave":"cita_servicio", "accion_entrada":"cargar_servicios" },
    { "paso":"CITA_FECHA",    "tipo":"conversacion", "frase_clave":"cita_fecha",    "accion_entrada":"cargar_dias_cita" },
    { "paso":"CITA_HORA",     "tipo":"conversacion", "frase_clave":"cita_hora",     "accion_entrada":"cargar_horas_cita" },
    { "paso":"CITA_CONFIRMA", "tipo":"conversacion", "frase_clave":"cita_resumen" },
    { "paso":"CITA_ANTICIPO", "tipo":"sistema",      "frase_clave":"cita_anticipo", "accion_entrada":"cobrar_anticipo", "params_json":{"porcentaje":30} }
  ],
  "agrega_aristas": [
    { "paso":"CITA_CONFIRMA", "input":"1", "accion":"crear_cita", "destino":"CITA_ANTICIPO" },
    { "paso":"CITA_ANTICIPO", "input":"resultado:cobrar", "destino":"CITA_AGENDADA" },
    { "paso":"CITA_AGENDADA", "input":"kw:si", "destino":"SEARCHING" },
    { "paso":"CITA_AGENDADA", "input":"*",     "destino":"MENU" }
  ]
}
```

**Por qué esto respeta la dirección del dueño:**

- **No toca el checkout sellado.** `apaga`/`reetiqueta`/`agrega_*` solo pueden operar sobre nodos
  `conversacion` **o** re-enrutar HACIA un nodo `sistema` existente; **nunca** cambian el `destino`/
  `accion` interno de un nodo `sistema`. El linter (§D.2.5 del diseño) lo rechaza comparando contra
  `flujo_nodo_sistema_ref` (los nodos sistema canónicos versionados en git). `CITA_AGENDADA --kw:si-->
  SEARCHING` reusa el **mismo** carrito/checkout del master: cero duplicación (§R.C "agenda+compra sale gratis").
- **No toca los filtros.** Un delta no puede declarar nodos que detecten groserías/quejas — esos
  viven en `index.js` (§M.3), fuera del grafo. El delta solo declara aristas `accion:'escalar'`
  (cuándo), no la mecánica.
- **Los 4 casos del dueño como deltas** (ninguno agrega checkout nuevo; todo "reusa tal cual" del master):

  | Complementario | Delta sobre master |
  |---|---|
  | **citas-anticipo** (barbería/estética/uñas/tatuajes) | apaga `WIZARD`/`ASK_CP`/`SPLIT`/`DELIVERY`; agrega `CITA_*` (**ya en código**, `citasFlow.js:15`) + `CITA_ANTICIPO` (nuevo, params `porcentaje`). Sin anticipo = el mismo delta **sin** el nodo `CITA_ANTICIPO` (la arista `"1"` va directo a `CITA_AGENDADA`). |
  | **ISP-domicilio** | delta de citas **+** re-enruta `CITA_HORA --*--> ASK_CP` para reusar `ASK_CP`→`addressFlow` del master (cobertura+dirección de instalación). **Cero nodo propio** — composición de piezas selladas ya existentes. |
  | **restaurante-mesa** | apaga `WIZARD`/`SPLIT`; enciende entrega repartidor (módulo, no arista); agrega `MESA_*` (picker análogo a `CITA_SERVICIO`; módulo `mesas_activo` ya reservado, `modulosDefaults.js:28` — **flow no construido aún**). Catálogo "menú" = mismo `productos` con `vocab()`. |
  | **freelancer-suscripción** | reduce a `CONFIRM_ORDER→PAGO_METODO`; agrega `PROYECTO_MONTO` (1 línea de monto libre → `insertarPedidoConCarrito`). La **suscripción recurrente es lo ÚNICO genuinamente nuevo** (tabla `suscripciones` + job en `stockWatcher`, §R.D) y **no es topología**: es un job que re-empuja a `cola_notificaciones`, fuera del grafo. |

- **Estados nuevos que el enum `S` aún NO tiene** (a agregar en la migración/código al construir el
  delta, no ahora): `CITA_ANTICIPO`, `CITA_AGENDADA`, `MESA_*`, `PROYECTO_MONTO`. Los `CITA_SERVICIO/
  FECHA/HORA/CONFIRMA` **ya existen** (`_shared.js:60-63`). No inventar acciones: `cobrar_anticipo`/
  `crear_cita`/`cargar_servicios`/`cargar_horas_cita` **no existen aún** y hay que escribirlas como
  wrappers finos (auditoría §A filas ❌) — `cargar_dias_cita` sí (`citasFlow.diasDisponibles()`, `:53`).

### M.3 — Cómo el MASTER contempla groserías / quejas / frustración / ASESOR

**No se re-implementan en el grafo. Son filtros de plataforma que corren ANTES del router** (§G del
diseño, verificado contra `bot/index.js`). El master los "contempla" heredándolos: el intérprete es la
etapa 10 del pipeline y solo ve texto ya limpio. Mapa de cada etapa de `index.js` al modelo:

| # | Etapa `index.js` | Detector/acción | Efecto en el modelo del motor |
|---|---|---|---|
| 4 | Content filter `cfCheck` (`:908`) | groserías → tag `blacklist`; reincidente → `ASESOR modo:'contenido_inapropiado'` (`:915`) | **secuestra a ASESOR antes del router.** El grafo NUNCA ve el texto. |
| 5 | Frustración `esFrustracion` (`:924`) | tono agresivo limpio → `ASESOR modo:'cliente_frustrado'` + tag `queja` (`:928`) | **secuestra a ASESOR.** No es un nodo. |
| 8 | Quejas `quejaCheck` (`:1047`) | 2 pasos → `registrarEscalada` + `ASESOR modo:'queja'` (`:1060`) | **secuestra a ASESOR.** No es un nodo. |
| 9 | Intención de compra (solo `MENU`, `:1074`) | inyecta `SEARCHING` | el motor lo recibe ya como `step=SEARCHING`. |
| 10 | `actionHandler.handleAction` (`:1131`) | router: `FLOWS` + motor + giroFlows | **única etapa donde corre el intérprete.** |

**Las 4 reglas duras del master respecto a ASESOR (no negociables, §G.2):**

1. `STEPS` del intérprete **NUNCA** incluye `ASESOR`/`LISTA_ESPERA`/`CSAT`/`DEVOLUCION` — son de
   `asesorFlow` (`asesorFlow.js:62`), `tipo='sistema'`, para siempre.
2. Con la sesión en `ASESOR`, el motor **no corre**: no posee el `step` → devuelve `undefined` → el
   router lo da a `asesorFlow` (que responde una vez y luego **enmudece**, `asesorFlow.js:83`).
3. **Escalar es acción SELLADA** (`accion:'escalar'` → `registrarEscalada` + `cola_atencion` + set
   `ASESOR`). El grafo elige el *cuándo* (arista `kw:asesor` o `resultado:escalar`), nunca el *cómo*.
   El linter trata `escalar` como nodo sistema inmodificable.
4. **Escalada por reintentos vive en el intérprete** (`data._reintentos ≥ 3 → ASESOR`, §C.2 del
   diseño), no en un nodo — es la única vía por la que el walker toca `ASESOR`, y lo hace **saliendo**
   hacia el estado sellado, nunca manejándolo.

**El lazo de cobro (G.5/G.6) también es herencia sellada del master:** el motor participa SOLO en el
acto 1 (`grabar_pedido`/`cobrar_anticipo` → `insertarPedidoConCarrito` + `insertarLinkPago('generado')`,
**sin tocar inventario**); el **asesor humano** marca pagado (`POST /api/pagos/:id/marcar-pagado`,
`comunicacionPedidos.js:263-300`) y ahí ocurre el descuento por sucursal (`kardexService.movimiento`),
puntos, asiento y ticket. Adelantar el descuento al acto 1 = **doble-descuento** (histórico, MEMORY.md).
El master pasa `sucursalDeSesion(db, ses)` a la acción sellada igual que `citas.js:cobrar` (`:84`).

### M.4 — Primer archivo a crear y su test (respetando las 4 invariantes)

**Primer archivo: NO es el intérprete. Es la red de seguridad — el master no se puede tocar sin oráculo.**

1. **`tests/fixture_min.js`** (Fase 0, §0.3) — siembra un sqlite temporal reusando `db/schema.sql` +
   config JC por defecto + 3 productos + 1 servicio + cobertura de `64000`. Idempotente, solo escribe
   en `os.tmpdir()`.
2. **`tests/golden_snapshot.js`** (Fase 0, §0.4) — apunta `DB_PATH` al fixture, corre
   `actionHandler.handleAction` por los recorridos #1-7 y **graba `tests/golden/jc.json`**. En corridas
   futuras: mismo recorrido → mismo output byte a byte, o falla. **Este es el test del primer archivo**
   y el oráculo de todo lo demás. Se añade a `package.json` `test` como `&& node tests/golden_snapshot.js`.

Solo **después** de que el golden esté verde se construye, en Fase 1, `tests/test_motor_actions.js`
(contract test por acción) y `bot/flows/motor/actions.js`. El **primer archivo de código de producción**
del motor es `actions.js` (wrappers finos sobre `_shared.js`), y su test (`test_motor_actions.js`)
verifica cada acción aislada del grafo — con el patrón `node tests/xxx.js` + asserts + `better-sqlite3`
en memoria (estilo `tests/test_citas.js`), **sin framework nuevo**.

**Las 4 invariantes, aplicadas a este primer código:**

- **Flag por-request:** el registro del motor va dentro de `handleAction` (patrón de `_giro`,
  `actionHandler.js:145`), NO al `require`. `const _flowsActivos = [...FLOWS, ...(motorActivo()?[motor]:[]),
  ...giroFlows.flowsDeGiro(_giro)]`. `motorActivo()` = `moduloActivo('motor_flujo_activo')`.
- **Fail-closed:** grafo ausente/inválido o acción que lanza → el `handle` del motor devuelve
  `undefined` → cae al router viejo (coherente con `actionHandler.js:151-158`). El bot nunca enmudece
  ni cobra a medias (las funciones de dinero ya son transaccionales).
- **Migración = siguiente libre = `0061_flujo_motor.sql`** (verificar `tail -1` al construir).
  Añade `flujo_grafo`/`flujo_nodo`/`flujo_arista` + columnas `anticipo`/`saldo_pendiente` en `citas`
  (NO re-agregar `id_pedido`/`servicio_precio`/`id_servicio` — ya existen desde 0057). Espejo en
  `db/schema.sql` (regla CLAUDE.md). Añadir `motor_flujo_activo` a `DEFAULT_OFF` (`modulosDefaults.js`).
- **Fixture + golden como oráculo:** ninguna fase del motor mergea sin el golden verde. El master ES
  juguetería, así que la regresión byte-idéntica de JC protege todo automáticamente.

### M.5 — Correcciones a los .md que contradicen esta dirección

Cierra las inconsistencias detectadas; aplicar cuando se toque cada doc (este plan no edita código):

1. **`DISENO_MOTOR_FLUJO.md` — número de migración obsoleto.** El encabezado dice "hoy ≥`0059`",
   §A.3 dice `0059`, §H y §R.E dicen "≥`0059`". **Reemplazar por `0061`** (último aplicado real =
   `0060_conciliacion_banco.sql`). El `PLAN` §Fase 2+ punto 4 ya está correcto (`≥0061`).
2. **`DISENO_MOTOR_FLUJO.md` §D.7 (auditoría) — slot resuelto.** El punto "verificar `selectedProduct`
   vs `viewing`" queda **cerrado: es `viewing`** (`menuFlow.js:428,502`). `agregar_carrito` usa
   `ctx.data.viewing`.
3. **`DISENO_MOTOR_FLUJO.md` §R.A/§R.C — enfoque de plantilla.** Donde el índice A-G habla de
   "plantilla de barbería" o "piloto citas primero", léase conforme a §M.2: **el master es
   `jugueteria.json` y cada giro es un DELTA** (`plantillas/deltas/<giro>.json`), no un JSON de flujo
   completo por giro. El orden correcto es master (Fase 3) → deltas (Fase 4). §R.A-R.E ya lo dicen;
   esta sección lo formaliza como el **formato de delta** que el seeder aplica.
4. **`PLAN_IMPLEMENTACION_MOTOR.md` §0/§Fase 2+ — veredicto "NO ahora" es CONDICIONAL, ya resuelto por
   0.bis + esta sección.** El dueño decidió construir (compilar-y-congelar). El "NO ahora" de §0 aplica
   solo al **intérprete-en-vivo** (correctamente rechazado); el **compilar-y-congelar** SÍ entra
   (§0.bis). Esta sección M es el detalle de construcción de ese modelo. No se borra §0 (documenta el
   razonamiento), pero se lee subordinada a §0.bis y §M.

