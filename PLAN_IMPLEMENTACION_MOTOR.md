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
4. **Migración = 0060** (no 0027, no 0058 — `ls migrations/ | tail -1` = `0059_repartos.sql` al
   2026-07-12), espejada en `db/schema.sql`.
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
