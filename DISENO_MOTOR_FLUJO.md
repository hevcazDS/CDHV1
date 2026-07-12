# Diseño del motor de flujo configurable por tenant

> El dueño YA decidió construirlo, con un argumento correcto: en un ERP white-label
> multitienda el **flujo** (no solo el texto) varía por giro y por cliente —
> barbería-con-anticipo vs. barbería-sin-anticipo, restaurante, retail. Hoy esa
> variación vive en **código** (`giroFlows.js`, el enum `S`, la lógica de cada `handle()`),
> así que onboardear una variante exige tocar el hot path de ventas. Este documento
> diseña **cómo** hacerlo viable y seguro: modelo de datos, plantillas-como-datos,
> el intérprete, la frontera de seguridad, la integración agenda+compra, la estrategia
> de pruebas y la migración por fases.
>
> **Reconciliación con `ARQUITECTURA_BOT_DATADRIVEN.md`:** aquel doc acertó en el
> **modelo de datos** (nodos/aristas/slots + acciones-como-código referenciadas por
> nombre) y en la **frontera sistema-vs-conversación** (checkout/dinero = topología
> sellada). Aquí se **conserva** ambos. Lo que cambia es el alcance: ese doc recomendó
> detenerse en "frases + mapa de solo-lectura" argumentando que *nadie recablea un flujo
> de venta*. Ese argumento **falla para el caso de negocio real**: la diferencia
> barbería-con-anticipo vs. sin-anticipo **no es texto**, es una arista y una acción de
> cobro; y ese sí es un cambio que cada tienda de servicio necesita. Por eso el motor
> **sí** se construye — pero **solo para los nodos de conversación**, con el checkout de
> dinero manteniéndose sellado exactamente como aquel doc pedía. El motor no es un
> "ComfyUI que recablea el checkout"; es un intérprete de la capa conversacional que
> *invoca* acciones de dinero selladas.

Fecha: 2026-07. Evidencia verificada en código (archivo:línea).

---

## Índice

- [A. Modelo de datos definitivo](#a-modelo-de-datos-definitivo)
- [B. Plantillas por giro como datos](#b-plantillas-por-giro-como-datos)
- [C. El motor / intérprete](#c-el-motor--intérprete)
- [D. Frontera de seguridad](#d-frontera-de-seguridad)
- [E. Integración agenda + compra](#e-integración-agenda--compra)
- [F. Estrategia de pruebas](#f-estrategia-de-pruebas)
- [G. Migración por fases (días-persona)](#g-migración-por-fases)

---

## A. Modelo de datos definitivo

### A.0 Principio rector (la frontera dato/código)

> **Topología conversacional, prompts, opciones y parámetros = DATOS.
> Lógica de dinero/inventario/persistencia = CÓDIGO sellado.**
> Un nodo *referencia* una acción por nombre y le pasa *parámetros*; nunca contiene su lógica.

Esto no es nuevo: el sistema ya distingue "config editable sin reiniciar" (`configuracion`,
polled cada 60s, `bot/flows/_config.js`) de "código". El motor extiende esa frontera a la
**topología** del segmento conversacional, dejando intactas las funciones de `_shared.js`
que cobran y graban (`grabarPedidoEnvio` `_shared.js:863`, `insertarLinkPago` `_shared.js:745`,
`insertarPedidoConCarrito` `_shared.js:815`).

### A.1 El grafo: nodos, aristas, slots

**Nodo** = un `paso_actual`. Es el equivalente data-driven de un `case` dentro de un `handle()`.
Campos:
- `paso` — nombre del estado (ej. `CITA_SERVICIO`). Es lo que hoy vive en el enum `S`
  (`_shared.js:31-66`) y se persiste en `sesiones_bot.paso_actual`.
- `tipo` — `'conversacion'` (interpretado por el motor) | `'sistema'` (topología fija en código;
  el motor lo *invoca* pero no lo *interpreta* — sección D).
- `frase_clave` — apunta a `configuracion.frase_<clave>` (patrón existente `_config.js`, `t()`).
  El **texto** NO se guarda en la tabla del grafo; se reutiliza el editor de frases de Prime.
- `accion_entrada` — nombre en el catálogo `ACTIONS` (opcional), corre **al llegar** al nodo
  (ej. `cargar_slots_cita` para calcular las horas libres antes de renderizar el prompt).
- `params_json` — parámetros de la acción/nodo (ej. `{"porcentaje_anticipo": 30}` para un nodo
  de cobro, `{"tipo_catalogo": "servicio"}` para el picker de servicios). **Este es el mecanismo
  clave**: la variante barbería-con-anticipo vs. sin-anticipo es *el mismo nodo con distinto
  `params_json`* (o presente/ausente), no código distinto.

**Arista** = transición `(nodo_origen, input) → nodo_destino`, con acción opcional en la transición.
El `input` es un **matcher** (los 3 que ya existen en código, ahora como dato):
- `"1"` — dígito exacto (`if (action==='1')`, patrón en todo `citasFlow.js`).
- `"kw:asesor"` — keyword (estilo `resolverOpcionMenu`, `_shared.js`).
- `"regex:^(si|sí|ok)"` — regex (patrón `_INTENT_REGEX` de `menuFlow.js`).
- `"resultado:hay|vacio|ok|escalar"` — ramifica según el **retorno** de la acción del nodo
  (ej. `buscar_producto` devuelve `resultado:'hay'|'vacio'`), no según el input del usuario.
- `"*"` — comodín / texto libre (cae aquí si nada más matcheó; ej. capturar el nombre en `ASK_NOMBRE`).

**Slot** = variable que el flujo captura y persiste. **No requiere tabla nueva:** ya es una llave
de `sesiones_bot.data` (JSON blob, `sessionManager.js`). `citasFlow` ya guarda `cita_fecha`,
`cita_hora`, `cita_servicio` así (`citasFlow.js:113,123,101`). El grafo solo *documenta* qué slot
capta cada nodo, para validación y para el mapeo `slot → {var}` que consume `t()`.

### A.2 Cómo un nodo invoca una ACCIÓN de negocio parametrizada

El puente es **un solo módulo**, `bot/flows/motor/actions.js`, con un mapa `ACTIONS`. Cada acción
es `(ctx, params) → { resultado, data }`. `ctx` es el mismo objeto que ya arma `actionHandler.js:144`
(`{ userId, action, step, data, tel, raw, ... }`). `resultado` es un string que las aristas
`resultado:xxx` usan para ramificar. `data` son los slots a fusionar en la sesión.

```js
// bot/flows/motor/actions.js — ÚNICO puente datos → código de negocio.
// Cada acción envuelve UNA función ya existente de _shared.js. NADA de topología aquí.
const shared = require('../_shared');

const ACTIONS = {
  // ── conversación (seguras de reordenar) ──
  buscar_producto: (ctx) => {
    const r = shared.searchProducts(ctx.raw, 3, ctx.tel);
    return { resultado: r.length ? 'hay' : 'vacio', data: { resultados: r } };
  },
  agregar_carrito: (ctx) => {
    const r = shared.agregarAlCarrito(ctx.data.carrito || [], ctx.data.viewing);
    return { resultado: 'ok', data: { carrito: r } };
  },
  cargar_dias_cita: (ctx) => {
    const dias = require('../citasFlow').diasDisponibles();
    return { resultado: dias.length ? 'hay' : 'vacio', data: { cita_dias: dias } };
  },

  // ── SELLADAS (dinero/inventario) — params configurables, lógica intocable (sección D) ──
  cobrar_anticipo: (ctx, params) => {
    // params.porcentaje viene del grafo (30, 50…). El CÓMO se cobra es intocable.
    return crearAnticipoDeCita(ctx, params.porcentaje);   // reusa insertarLinkPago/grabarPedido
  },
  crear_cita: (ctx, params) => {
    return registrarCita(ctx);                            // INSERT INTO citas (código sellado)
  },
  grabar_pedido: (ctx) => {
    return shared.grabarPedidoEnvio(ctx.data, ctx.tel);   // _shared.js:863 — sellado
  },
};
```

El nodo declara `accion_entrada: 'buscar_producto'` (o la arista declara `accion: 'cobrar_anticipo'`)
y `params_json: {"porcentaje": 30}`. **El intérprete nunca sabe qué hace la acción** — solo su
nombre, sus params y su `resultado`. Esa ignorancia deliberada es la frontera de seguridad.

### A.3 Tablas SQLite (por instancia — sin `tenant_id`, coherente con instancia-por-cliente)

Nueva migración `migrations/0027_flujo_motor.sql` (siguiente número libre tras `0026_citas.sql`),
espejada en `db/schema.sql` (regla del CLAUDE.md: toda columna nueva con `DEFAULT`, migración
versionada + espejo en schema).

```sql
-- Un grafo por instancia, versionado para revertir. Solo 1 activo.
CREATE TABLE IF NOT EXISTS flujo_grafo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    INTEGER NOT NULL DEFAULT 1,
  giro_base  TEXT,                                  -- de qué plantilla se sembró
  activo     INTEGER NOT NULL DEFAULT 0,            -- CHECK: máx 1 activo (validado en app)
  valido     INTEGER NOT NULL DEFAULT 0,            -- pasó el linter de grafo (sección D)
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS flujo_nodo (
  id_grafo       INTEGER NOT NULL REFERENCES flujo_grafo(id) ON DELETE CASCADE,
  paso           TEXT NOT NULL,                     -- = paso_actual
  tipo           TEXT NOT NULL DEFAULT 'conversacion'
                 CHECK(tipo IN ('conversacion','sistema')),
  frase_clave    TEXT,                              -- apunta a configuracion.frase_<clave>
  accion_entrada TEXT,                              -- nombre en ACTIONS (opcional)
  params_json    TEXT NOT NULL DEFAULT '{}',        -- parámetros de la acción/nodo
  es_inicial     INTEGER NOT NULL DEFAULT 0,        -- nodo raíz del giro (usualmente MENU)
  PRIMARY KEY (id_grafo, paso)
);

CREATE TABLE IF NOT EXISTS flujo_arista (
  id_grafo  INTEGER NOT NULL REFERENCES flujo_grafo(id) ON DELETE CASCADE,
  paso      TEXT NOT NULL,                          -- nodo origen
  orden     INTEGER NOT NULL,                       -- orden de render de la opción
  label     TEXT,                                   -- lo que ve el cliente ("💈 Corte") | NULL si no es opción de menú
  input     TEXT NOT NULL,                          -- matcher: '1' | 'kw:x' | 'regex:x' | 'resultado:x' | '*'
  destino   TEXT NOT NULL,                          -- paso destino
  accion    TEXT,                                   -- acción de negocio en la transición (opcional)
  params_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (id_grafo, paso, orden)
);
```

Notas de diseño:
- **Las frases NO se duplican aquí.** `flujo_nodo.frase_clave` apunta a `configuracion.frase_<clave>`,
  reutilizando el editor de Prime y `t()` (`_config.js`). Una tienda edita el texto de un nodo con
  la herramienta que ya existe.
- **`sesiones_bot` NO se migra.** Ya es `{ paso_actual TEXT, data TEXT }` genérico (`sessionManager.js`).
  Cualquier máquina de estados encaja sin tocar la persistencia de sesión — ventaja heredada del diseño previo.
- **Anticipo de cita — falta una columna, no una tabla.** `citas` hoy NO tiene columnas de dinero
  (`db/schema.sql:1129-1141`: telefono/nombre/servicio/fecha/hora/estatus/notas). El andamiaje de
  anticipo YA EXISTE pero en `preventa_clientes` (`stockService.js:172-181`: `porcentaje_anticipo`,
  `anticipo_pagado`, `saldo_pendiente`, `estatus='apartado'`). La integración (sección E) **reusa ese
  patrón**: se añade a `citas` las columnas `anticipo`, `saldo_pendiente`, `id_pedido_anticipo`
  (FK al pedido que porta el link de pago real) en la misma migración `0027`.

---

## B. Plantillas por giro como datos

Una **plantilla** = un conjunto de filas `flujo_nodo` + `flujo_arista` + las `frase_<clave>` que
referencia. Vive como **seed data**, no como código de flujo. Se guardan como archivos JSON en
`bot/flows/motor/plantillas/*.json` (versionados en git — son *presets de fábrica*, no config de
tienda), y el seeder los inserta en las tablas al onboardear.

```
bot/flows/motor/plantillas/
  jugueteria.json            ← reproduce EXACTAMENTE el flujo actual (regresión byte-idéntica, sección F.4)
  barberia_sin_anticipo.json
  barberia_con_anticipo.json
  restaurante.json
  retail.json
```

Cada plantilla es `{ nodos:[...], aristas:[...], frases:{clave:texto} }`. Ejemplo de un nodo:

```json
{ "paso": "CITA_ANTICIPO", "tipo": "sistema", "frase_clave": "cita_anticipo",
  "accion_entrada": "cobrar_anticipo", "params_json": { "porcentaje": 30 } }
```

### B.1 Onboarding siembra la plantilla; Prime la ajusta

El onboarding (`dashboard/routes/negocioOnboarding.js`, `POST /api/onboarding`) ya elige `giro`
y siembra `configuracion` de forma **data-aware** (migración 0014). Se le añade un paso:

1. Al elegir el giro, si el giro tiene una plantilla de motor, el seeder inserta un `flujo_grafo`
   nuevo (`activo=0, valido=0`) con sus nodos/aristas/frases desde el JSON.
2. Corre el **linter de grafo** (sección D). Si pasa → `valido=1, activo=1`.
3. La barbería elige en el wizard: *"¿Pides anticipo para reservar?"* → si sí, se siembra
   `barberia_con_anticipo.json` en vez de `barberia_sin_anticipo.json`. **Es una fila distinta,
   no una rama de código.**

Prime (rol `prime`) obtiene un editor de grafo (Fase 4, sección G) que hace `UPDATE`/`INSERT` sobre
`flujo_nodo`/`flujo_arista`, siempre re-corriendo el linter antes de `activo=1`. Un ajuste típico:
"quiero pedir 50% en vez de 30%" = `UPDATE flujo_nodo SET params_json='{"porcentaje":50}'` — sin deploy.

### B.2 Ejemplo concreto: barbería + anticipo como grafo

Servicios = productos `tipo='servicio'` (ya existe: `citasFlow.js:20-23` lee
`SELECT ... FROM productos WHERE tipo='servicio'`). Grafo:

```
                         ┌─────────────────────────────────────────────────────────┐
  (inicial)              │  frase: cita_bienvenida                                   │
  MENU ──kw:cita──▶ CITA_SERVICIO  accion_entrada: cargar_servicios (tipo=servicio)  │
                         └──── input "1".."9" (uno por servicio) ──▶ CITA_FECHA ──────┘
                                                                       │ accion_entrada: cargar_dias_cita
                                            resultado:vacio ──▶ ASESOR │ resultado:hay
                                                                       ▼
                                    CITA_FECHA ──"1".."6" (un día)──▶ CITA_HORA
                                                                       │ accion_entrada: cargar_horas_cita
                                                                       ▼
                                    CITA_HORA ──"1".."N" (una hora)──▶ CITA_CONFIRMA
                                                                       │ frase: cita_resumen_con_anticipo
                            ┌── "2" (cambiar) ──▶ CITA_FECHA           │
                            │                                          ▼
                     CITA_CONFIRMA ──"1" (confirmar)── accion: crear_cita ──▶ CITA_ANTICIPO
                                                                       │  tipo: sistema (SELLADO)
                                                                       │  accion_entrada: cobrar_anticipo {porcentaje:30}
                                                                       │  frase: cita_anticipo (con {monto} {link})
                                                                       ▼
                                                              CITA_AGENDADA (fin) ──▶ MENU
```

La **misma plantilla sin anticipo** es idéntica salvo dos cambios de datos:
- `CITA_CONFIRMA` usa `frase_clave: cita_resumen` (sin la línea del anticipo),
- la arista `"1"` va directo de `CITA_CONFIRMA` a `CITA_AGENDADA` (se **omite** el nodo
  `CITA_ANTICIPO`). Cero cambio de código. La barbería que quiere anticipo tiene una fila más.

---

## C. El motor / intérprete

Un módulo, `bot/flows/motor/interprete.js` (~130 líneas), que se registra como **un flow más** en
el array de `actionHandler.js:18-24`, al final, detrás de un flag. Reemplaza el cuerpo de los
`handle()` de los flows de **conversación** — no toca los de sistema.

### C.1 Registro (convivencia con el router actual)

El router ya itera flows y despacha por `STEPS.includes(step)` con `break` en el primero que matchea
(`actionHandler.js:147-158`). El motor declara `STEPS = [pasos del grafo activo con tipo='conversacion']`:

```js
// bot/actionHandler.js  (cambio mínimo)
const motor = motorActivo() ? require('./flows/motor/interprete') : null;
const _flowsActivos = [...FLOWS, ...(motor ? [motor] : []), ...giroFlows.flowsDeGiro(_giro)];
```

Un paso está **en un flow viejo XOR en el grafo**, nunca en ambos (el `break` garantiza que gana el
primero). Se migra estado por estado moviéndolo del flow viejo al grafo. `motorActivo()` = un
`moduloActivo('motor_flujo_activo')` (default OFF, en `_DEFAULT_OFF`, `modulosDefaults.js`) — con el
flag apagado, Julio Cepeda corre **exactamente** el código de hoy.

### C.2 El loop

```js
// bot/flows/motor/interprete.js  (bosquejo ejecutable)
const G = require('./grafo');        // cargarGrafoActivo() con cache 60s (mismo patrón que _config)
const A = require('./actions');      // el mapa ACTIONS
const { t } = require('../_config');
const sm = require('../sessionManager');

async function handle(ctx) {
  const grafo = G.cargarGrafoActivo();
  const nodo  = grafo && grafo.nodos[ctx.step];
  if (!nodo || nodo.tipo === 'sistema') return undefined;   // no es del motor → router viejo

  // 1. resolver la opción/arista contra el input del usuario
  const aristas = grafo.aristas[ctx.step] || [];
  let arista = aristas.find(a => matchInput(a.input, ctx.action, ctx.raw));

  // 2. validación / reintento: ningún matcher aplicó
  if (!arista) {
    const reintentos = (ctx.data._reintentos || 0) + 1;
    if (reintentos >= 3) {                                   // escape a asesor tras 3 fallos
      sm.updateSession(ctx.userId, 'ASESOR', { ...ctx.data, _reintentos: 0 });
      return t('escalar_asesor');
    }
    sm.updateSession(ctx.userId, ctx.step, { ...ctx.data, _reintentos: reintentos });
    return t(nodo.frase_clave + '_invalido') || t(nodo.frase_clave);   // reprompt
  }

  // 3. ejecutar acción de la transición (si la hay). SELLADA para nodos 'sistema' destino.
  let res = { resultado: 'ok', data: {} };
  if (arista.accion) {
    try { res = await A.run(arista.accion, ctx, arista.params); }
    catch (e) { require('../logger').error('accion motor ' + arista.accion, e);
                return undefined; }                          // fail-closed → router viejo / menú
  }

  // 4. destino: fijo, o ramificado por res.resultado si la arista es 'resultado:xxx'
  const destino = resolverDestino(aristas, arista, res.resultado);
  const nodoDestino = grafo.nodos[destino];

  // 5. acción_entrada del destino (calcular slots antes de renderizar)
  let entradaData = {};
  if (nodoDestino && nodoDestino.accion_entrada) {
    try { const r = await A.run(nodoDestino.accion_entrada, {...ctx, data:{...ctx.data, ...res.data}}, nodoDestino.params);
          entradaData = r.data || {}; } catch (e) { return undefined; }
  }

  // 6. persistir slots + avanzar estado (misma API de siempre)
  const nuevaData = { ...ctx.data, ...res.data, ...entradaData, _reintentos: 0 };
  sm.updateSession(ctx.userId, destino, nuevaData);

  // 7. si el destino es 'sistema', devolver undefined para que lo tome su flow de código
  if (nodoDestino && nodoDestino.tipo === 'sistema') return undefined;

  // 8. renderizar el prompt del nodo destino con las frases de la tienda
  return t(nodoDestino.frase_clave, slotsToVars(nuevaData));
}
```

- `matchInput(input, action, raw)` cubre los 3 casos que ya existen en código: dígito, keyword, regex,
  más `'*'` y `'resultado:'`. Es una función de ~15 líneas.
- `slotsToVars(data)` mapea `session.data` → las `{vars}` que `t()` inyecta (igual que hoy
  `t('agregado_pagar', {producto})`). El grafo declara qué slots expone cada frase.
- **Validación/reintentos**: paso 2. Reproduce el patrón actual `if (!m[action]) return 'Responde con...'`
  (`citasFlow.js:99,108,122`), pero con un **límite de 3** y escape automático a `ASESOR` — mejora sobre
  el código actual que reprompta indefinidamente.
- **Escape a asesor**: paso 2 al 3er fallo, y cualquier arista `kw:asesor` en cualquier nodo.
- **Estado en sessionManager**: sin cambios. `paso_actual` = `destino`, `data` = slots. `_reintentos`
  es un slot interno más.

### C.3 Handoff conversación ↔ sistema

El punto delicado es el paso 7-8: cuando el motor llega a un nodo `tipo='sistema'` (ej. `CONFIRM_ORDER`,
`CITA_ANTICIPO`), **actualiza la sesión a ese paso y devuelve `undefined`**. En la MISMA vuelta del
router (`actionHandler.js:147`) NO reentra (ya hizo `break`), pero el mensaje del cliente ya fue
consumido para *llegar* ahí. Solución: el nodo de sistema se renderiza en el **siguiente** mensaje, o
—mejor— el motor, al detectar destino de sistema, **invoca directamente** el `handle` del flow de código
correspondiente pasándole el `ctx` con el nuevo step. Esto es simétrico con cómo `menuFlow` hoy delega a
`citasFlow.iniciar()` (`citasFlow.js:78`). El intérprete tiene un `dispatchSistema(destino, ctx)` que
busca el flow en `FLOWS` cuyos `STEPS` incluyen `destino` y llama su `handle`. Así "agendar → cobrar"
ocurre en un solo turno, sin pedirle al cliente que mande otro mensaje.

---

## D. Frontera de seguridad

**Regla dura:** las acciones de dinero/inventario son **selladas** — sus **parámetros** son
configurables, su **lógica es intocable**. Configurar el flujo NUNCA puede romper una venta.

### D.1 Qué es sellado (código, `tipo='sistema'`)

Estas funciones de `_shared.js` son el checkout y **no se interpretan** — el motor solo las *invoca*
por nombre a través de `ACTIONS`, y el editor de grafo marca sus nodos como **bloqueados** (no se
puede cambiar su `destino` ni su `accion`, solo su `frase_clave` y params permitidos):

| Nodo sistema | Función sellada | Evidencia |
|---|---|---|
| `CONFIRM_ORDER` / `PAGO_METODO` | `grabarPedidoEnvio` / `grabarPedidoPickup` / `grabarPedidoSplit` | `_shared.js:863,819,951` |
| (cobro) | `insertarPedidoConCarrito` + `insertarLinkPago` | `_shared.js:815,745` |
| `ASK_CP → SPLIT_* → DELIVERY` | `partirCarrito`, cálculo de flete | `_shared.js:493` |
| `PAGO_METODO` | `registrarMetodoPago` | `_shared.js:731` |
| `CITA_ANTICIPO` | `cobrar_anticipo` → `insertarLinkPago` | sección E |
| (descuento stock) | dentro de `insertarPedidoConCarrito` (tx) | `_shared.js:815-816` |

Params configurables permitidos en nodos sistema (whitelist estricta, todo lo demás rechazado):
`porcentaje` (anticipo), `frase_clave`, `metodo_entrega_default`. **NO** configurables: `destino`,
`accion`, el orden de captura de dirección (contractual con Estafeta).

### D.2 El linter de grafo (validación ANTES de activar)

Corre en el endpoint de guardado (no en runtime). Rechaza el `activo=1` si:

1. **Nodo huérfano** — un nodo sin arista entrante (excepto el `es_inicial`). BFS desde el inicial;
   los no alcanzados se reportan.
2. **Destino colgante** — una `flujo_arista.destino` que no existe como `flujo_nodo.paso`.
3. **Ciclo sin salida** — un componente fuertemente conexo del que no se alcanza ningún nodo terminal
   (Tarjan/DFS). Un ciclo *con* salida (ej. `CONFIRM ⇄ FECHA`) es legal.
4. **Nodo de cobro sin monto** — un nodo cuya acción está en el set `{cobrar_anticipo, grabar_pedido}`
   y `params.porcentaje` ausente/≤0 o inválido. **Esta es la regla anti-"vender gratis".**
5. **Nodo sistema modificado** — su `destino`/`accion` difiere del preset sellado. Se compara contra
   una tabla de referencia `flujo_nodo_sistema_ref` (los nodos de sistema canónicos, versionados en git).
6. **Toda rama de checkout desemboca en terminal** — desde cualquier nodo con acción de cobro, todo
   camino llega a un nodo `es_terminal` (`gracias_cierre`/`CITA_AGENDADA`).

```js
// bot/flows/motor/linter.js  (bosquejo)
function validar(grafo) {
  const errs = [];
  const pasos = new Set(Object.keys(grafo.nodos));
  for (const [orig, aristas] of Object.entries(grafo.aristas))
    for (const a of aristas)
      if (!pasos.has(a.destino)) errs.push(`destino colgante: ${orig}→${a.destino}`);
  const alcanzables = bfs(grafo, nodoInicial(grafo));
  for (const p of pasos) if (!alcanzables.has(p)) errs.push(`nodo huérfano: ${p}`);
  for (const n of Object.values(grafo.nodos))
    if (ACCIONES_DINERO.has(n.accion_entrada) && !(n.params.porcentaje > 0))
      errs.push(`cobro sin monto: ${n.paso}`);
  // ... ciclos, nodos sistema intocados, terminales de checkout
  return { ok: errs.length === 0, errs };
}
```

### D.3 Fail-closed en runtime

Tres capas, coherentes con el patrón existente (`flowsDeGiro` es require-tolerante,
`actionHandler.js:146`; un flow que lanza resetea a MENU, `actionHandler.js:152-156`):
1. `cargarGrafoActivo()` falla o no hay grafo `valido=1 activo=1` → el motor devuelve `undefined` →
   cae al router viejo. **El bot nunca se queda mudo.**
2. Una acción lanza → `catch` → `undefined` → router viejo. **Nunca cobra dos veces ni a medias**
   (las funciones de dinero ya son transaccionales, `insertarPedidoConCarrito` es una tx).
3. El grafo solo se activa si `valido=1` (linter). Un grafo mal guardado **nunca** llega a runtime.

---

## E. Integración agenda + compra

El caso duro: **"agenda una cita Y compra un producto en la misma conversación"**, y **"el anticipo de
la cita se vuelve un pedido/cobro real"**. La clave es **no duplicar lógica**: el subflujo de cita y el
de carrito/checkout se **entrelazan** reusando las acciones selladas de `_shared.js`.

### E.1 El anticipo de cita ES un pedido (reusar grabarPedido/links_pago)

Un anticipo no es un mecanismo nuevo de cobro. Es un **pedido normal** cuyo `total` = el monto del
anticipo, que pasa por el **mismo** `insertarLinkPago` (`_shared.js:745`) y converge en el **mismo**
chokepoint `POST /api/pagos/:id/marcar-pagado` que todo lo demás. La acción `cobrar_anticipo`:

```js
// bot/flows/motor/actions.js — cobrar_anticipo (SELLADA)
function crearAnticipoDeCita(ctx, porcentaje) {
  const precio = ctx.data.cita_servicio_precio || 0;           // del servicio elegido (citasFlow.js:101)
  if (!(porcentaje > 0) || !(precio > 0))                      // guard: el linter ya lo previene, defensa en profundidad
    return { resultado: 'sin_cobro', data: {} };               // barbería sin anticipo cae aquí naturalmente
  const anticipo = +(precio * porcentaje / 100).toFixed(2);
  const saldo    = +(precio - anticipo).toFixed(2);

  // Un "pedido" de una línea = el servicio, total = anticipo. REUSA la ruta de dinero existente.
  const carrito = [{ id: ctx.data.cita_servicio_id, name: ctx.data.cita_servicio, price: anticipo, cantidad: 1 }];
  const r = shared.grabarPedidoAnticipoCita({ ...ctx.data, carrito, total: anticipo }, ctx.tel);
  // ↑ thin wrapper sobre insertarPedidoConCarrito + insertarLinkPago; NO descuenta inventario (servicio).

  // Ligar el pedido a la cita (columnas nuevas de citas, migración 0027)
  db.prepare('UPDATE citas SET anticipo=?, saldo_pendiente=?, id_pedido_anticipo=? WHERE id=?')
    .run(anticipo, saldo, r.pedidoId, ctx.data.cita_id);
  return { resultado: 'cobrar', data: { anticipo, saldo, link: r.linkUrl } };
}
```

`grabarPedidoAnticipoCita` es un wrapper ~15 líneas sobre `insertarPedidoConCarrito`+`insertarLinkPago`
(no una copia). El link se paga por el flujo normal; `marcar-pagado` confirma el anticipo, `citas.estatus`
pasa a `confirmada` (trigger o en el handler de `marcar-pagado`, junto al `otorgarPuntosPorCompra`
existente). El saldo (`saldo_pendiente`) se cobra en mostrador el día de la cita (POS ya existe). Esto
es **idéntico en forma** al `apartado` de preventas (`stockService.js:172-181`) — mismo patrón,
reutilizado.

### E.2 Entrelazar cita + carrito sin duplicar

Se modela con **dos subgrafos que comparten el nodo carrito**, unidos por un nodo de bifurcación tras
agendar. El carrito/checkout es EL MISMO de siempre (`SHOW_CART → CONFIRM_ORDER`), sellado:

```
CITA_AGENDADA (fin cita, servicio+anticipo ya cobrado)
     │  frase: cita_ok_ofrecer_producto  ("¿Quieres agregar algún producto para tu cita?")
     ├── "no" ──────────────────────────────────▶ MENU
     └── "si" ──▶ SEARCHING ──resultado:hay──▶ VIEW_PRODUCT ──"agregar"──▶ SHOW_CART
                     (conversación)                (conversación)          │ (SISTEMA, sellado)
                                                                           ▼
                                                                    CONFIRM_ORDER ──▶ grabar_pedido
                                                                    (mismo checkout de siempre)
```

Puntos clave:
- El subflujo de cita (`CITA_*`) y el de compra (`SEARCHING/VIEW_PRODUCT/SHOW_CART/CONFIRM_ORDER`) son
  **nodos independientes** unidos por aristas de datos. No se duplica `SHOW_CART` ni `CONFIRM_ORDER`:
  el grafo simplemente enruta a los nodos que ya existen. `SHOW_CART`+`CONFIRM_ORDER` son `tipo='sistema'`,
  así que corren su código sellado (`cartFlow`/`orderFlow`) vía el handoff de C.3.
- **Dos cobros, un patrón**: el anticipo de la cita (pedido A, total=anticipo) y el producto (pedido B,
  checkout normal) son **dos pedidos**, cada uno con su `links_pago`, ambos por la misma ruta. No hay
  lógica especial de "cobro combinado" — se evita justamente por seguridad (dos pedidos auditables >
  un cobro mixto frágil).
- La barbería-sin-anticipo salta `CITA_ANTICIPO` (no existe el nodo) y llega directo a `CITA_AGENDADA`;
  el resto del entrelazado es idéntico.

### E.3 Diagrama de estados (agenda + compra completo, con anticipo)

```
MENU ─kw:cita─▶ CITA_SERVICIO ─(n)─▶ CITA_FECHA ─(n)─▶ CITA_HORA ─(n)─▶ CITA_CONFIRMA
                                                                             │ "1"
                                                                   accion: crear_cita
                                                                             ▼
                                                        ┌── CITA_ANTICIPO (sistema) ──┐   ← solo si plantilla con anticipo
                                                        │   accion: cobrar_anticipo    │
                                                        │   → pedido A + link_pago     │
                                                        └──────────┬───────────────────┘
                                                                   ▼
                                                          CITA_AGENDADA (fin)
                                                          ├─"no"─▶ MENU
                                                          └─"si"─▶ SEARCHING ─▶ VIEW_PRODUCT ─▶ SHOW_CART
                                                                                                    │ (sistema)
                                                                                                    ▼
                                                                                            CONFIRM_ORDER
                                                                                            → pedido B + link_pago
                                                                                                    │
                                                                                                    ▼
                                                                                            gracias_cierre ─▶ MENU

marcar-pagado(pedido A) ⇒ citas.estatus='confirmada'   (chokepoint existente, +1 línea)
marcar-pagado(pedido B) ⇒ venta normal + puntos          (sin cambios)
```

---

## F. Estrategia de pruebas

Hoy: `node` plano, sin Jest/Mocha; `test_bot.js` parchea `Module._load` para inyectar un DB mock e
re-evalúa el pipeline (CLAUDE.md). `test:bot` = **100/100**. Los tests de "contrato" (`test_citas.js`,
`test_lealtad.js`, etc.) montan un `better-sqlite3` en memoria con un subconjunto del schema. **Se
mantiene ese estilo — sin framework nuevo.** Cuatro capas de tests nuevos:

### F.1 Contract tests por ACCIÓN (~1 archivo, ~25 asserts)

`tests/test_motor_actions.js`. Por cada acción de `ACTIONS`, montar el DB mock mínimo y verificar que
**hace lo correcto dado sus params**, aislada del grafo:
- `cobrar_anticipo({porcentaje:30})` sobre servicio de $100 → crea 1 pedido total=$30, 1 `links_pago`,
  `citas.anticipo=30 saldo_pendiente=70`. Con `porcentaje:0` → `resultado:'sin_cobro'`, 0 pedidos.
- `crear_cita` → 1 fila en `citas` con estatus `pendiente`.
- `buscar_producto` → `resultado:'hay'` con productos, `'vacio'` sin.
- `grabar_pedido` → delega a `grabarPedidoEnvio` (ya cubierto por tests existentes; aquí solo el wrapper).
Estos son los que garantizan que la capa de dinero sellada hace lo correcto — **no** se testea el grafo aquí.

### F.2 Tests del INTÉRPRETE (~1 archivo, ~20 asserts)

`tests/test_motor_interprete.js`. Dado **un grafo de prueba** (fixture JSON inline) + una **secuencia de
inputs** → los estados y acciones esperados. El intérprete se ejerce con acciones *mock* (un `ACTIONS`
falso que registra llamadas), así se testea la **topología/loop** sin tocar dinero:
- Grafo lineal A→B→C, inputs `["1","1"]` → estados `[B, C]`, sin acciones.
- Ramificación por `resultado`: acción mock devuelve `'vacio'` → va a la arista `resultado:vacio`.
- **Reintentos**: 3 inputs inválidos → estado `ASESOR`, frase de escalada. 2 inválidos + 1 válido → avanza.
- **Fail-closed**: acción que lanza → `handle` devuelve `undefined` (router viejo toma el control).
- `matchInput`: dígito/keyword/regex/comodín/resultado — tabla de casos.

### F.3 Test de INTEGRACIÓN agenda + compra end-to-end (~1 archivo, ~12 asserts)

`tests/test_motor_agenda_compra.js`. DB mock con `citas`, `pedidos`, `links_pago`, `productos`. Sembrar
la plantilla `barberia_con_anticipo` en el DB mock, correr la **secuencia real de inputs** de un cliente
que agenda (servicio→fecha→hora→confirma) y **luego** compra un producto, y verificar el estado final:
- 1 fila en `citas` (estatus pendiente→confirmada tras marcar-pagado del anticipo).
- 2 filas en `pedidos` (anticipo A + producto B), 2 en `links_pago`.
- `citas.id_pedido_anticipo` liga A; `citas.saldo_pendiente` correcto.
- Repetir con `barberia_sin_anticipo`: 1 cita, 1 pedido (solo el producto), 0 anticipo.

### F.4 Harness de REGRESIÓN byte-idéntica (el más importante — el dueño lo exigió)

`tests/test_motor_regresion_jc.js`. La plantilla `jugueteria.json` debe producir **exactamente** el
comportamiento del código actual. Dos mecanismos:

1. **Snapshot golden.** Antes de tocar nada (Fase 0), un script recorre Julio Cepeda por los ~25 estados
   con secuencias scripteadas (reusando el mock DB de `test_bot.js`) y **graba** cada respuesta a
   `tests/golden/jc_flujo.snap`. Con el motor encendido y `jugueteria.json` activo, el mismo recorrido
   debe dar **byte por byte** lo mismo. Un diff = falla.
2. **Los 117 tests actuales corren con el flag OFF y con el flag ON.** Con OFF: prueban el código viejo
   (deben seguir 100/100 — es el código intacto). Con ON + `jugueteria.json`: prueban que el motor los
   reproduce. Los que dependan de estructura interna del código viejo (no de comportamiento observable)
   se **migran 1:1** a aserciones de comportamiento. Meta: **117/117 con el flag en ambos estados**.

Framework: **ninguno nuevo.** Se extiende el patrón `node tests/xxx.js` + asserts. Total nuevo estimado:
**~4 archivos, ~70 asserts**, más el golden snapshot. Se añaden a `package.json` `test` como
`&& node tests/test_motor_*.js`.

---

## G. Migración por fases

> Invariante de cada fase: `test:bot` sigue verde y Julio Cepeda es byte-idéntico con el flag OFF.
> Cada fase es desplegable y reversible sola. Esfuerzo en **días-persona** de un dev que conoce el código.

| Fase | Qué | Días | Riesgo |
|---|---|---:|---|
| **0. Red de seguridad** | Golden snapshot de JC (F.4.1) + correr los 117 tests como baseline. **Sin esto no se empieza.** | 1 | nulo |
| **1. Extraer acciones** | `bot/flows/motor/actions.js` + contract tests (F.1). Envolver las funciones de `_shared.js` que ya existen — **cero lógica nueva de negocio**, solo el mapa `ACTIONS` + wrappers finos (`grabarPedidoAnticipoCita`). Migración `0027` (tablas + columnas de anticipo en `citas`). | 3 | bajo |
| **2. El intérprete tras flag** | `interprete.js` + `matchInput`/`slotsToVars`/`resolverDestino` + `grafo.js` (loader con cache) + tests del intérprete (F.2). Flag `motor_flujo_activo` default OFF. Registrarlo en `actionHandler`. | 4 | medio (código nuevo en hot path) |
| **3. Piloto: citas** | Escribir `barberia_con/sin_anticipo.json` + linter (`linter.js`, sección D.2). Encender el flag SOLO para giros de servicio (los `CITA_*`, sin dinero de retail). Test de integración (F.3). citasFlow viejo queda como fallback. | 4 | medio |
| **4. Editor + onboarding** | Seeder de plantillas en onboarding (B.1) + endpoint de guardado con linter + UI de edición de nodos en Prime (empieza texto+params; aristas de conversación después). | 5 | medio (UI) |
| **5. Migrar giro por giro** | `jugueteria.json` (reproduce el flujo actual) + regresión byte-idéntica (F.4). Encender el flag para jugueteria SOLO cuando el golden pase 100%. Luego restaurante/retail. Los nodos `orderFlow`/`cartFlow`/`addressFlow` quedan `tipo='sistema'` **para siempre**. | 6 | medio-alto |
| **6. Apagar código viejo** | Cuando todos los giros corren por el motor y el golden es estable N semanas, borrar los `handle()` de conversación de los flows viejos (menuFlow, citasFlow…). Los flows de **sistema** se quedan. | 2 | bajo (ya validado) |

**Total: ~25 días-persona.** Orden estricto: piloto citas (giro de servicio, sin dinero de retail, el
flow más simple `citasFlow.js:89-149`) → extraer acciones → motor tras flag → migrar giro por giro →
apagar el viejo. Nunca se migra checkout de dinero al intérprete: se queda sellado.

### Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| El motor rompe una venta en producción | Flag por-estado + fail-closed a router viejo (D.3) + los nodos de dinero nunca se interpretan (D.1). El golden snapshot corre en cada deploy. |
| Un tenant guarda un grafo que vende gratis | Linter obligatorio antes de `activo=1`: "cobro sin monto" (D.2.4) + nodos sistema inmodificables (D.2.5). |
| Los 117 tests dejan de proteger el comportamiento | F.4.2: corren con flag OFF (código viejo intacto) Y ON (motor). Se migran 1:1 a aserciones de comportamiento observable. |
| Divergencia entre plantilla y schema | Migración `0027` versionada + espejo en `db/schema.sql` (regla CLAUDE.md). Plantillas JSON versionadas en git. |
| Handoff conversación↔sistema en un turno (C.3) | `dispatchSistema` reusa el patrón `menuFlow→citasFlow.iniciar()` ya probado (`citasFlow.js:78`); test de integración (F.3) cubre el turno único agendar→cobrar. |
| Complejidad del editor de aristas en Prime | Fase 4 empieza con edición de **texto + params** (cubre barbería 30%↔50% sin tocar aristas); la edición de aristas de conversación es incremental y opcional. Los money-nodes nunca son editables. |

---

## Apéndice — evidencia archivo:línea

- Router / dispatch / fail-closed: `bot/actionHandler.js:18-24, 144-158`.
- Enum `S` (estados): `bot/flows/_shared.js:31-66`.
- Piloto citasFlow (el más simple): `bot/flows/citasFlow.js:78-149`; delega desde menú `:78`.
- `citas` sin columnas de dinero hoy: `db/schema.sql:1129-1141`; migración `migrations/0026_citas.sql`.
- Acciones de dinero selladas: `grabarPedidoEnvio` `_shared.js:863`, `grabarPedidoPickup` `:819`,
  `grabarPedidoSplit` `:951`, `insertarPedidoConCarrito` `:815`, `insertarLinkPago` `:745`,
  `partirCarrito` `:493`, `registrarMetodoPago` `:731`, `agregarAlCarrito` `:387`.
- Andamiaje de anticipo existente (a reusar): `services/stockService.js:154-193` (`registrarPreventa`:
  `porcentaje_anticipo`, `anticipo_pagado`, `saldo_pendiente`, `estatus='apartado'`).
- Chokepoint de pago único: `POST /api/pagos/:id/marcar-pagado` (`dashboard/routes/comunicacionPedidos.js`).
- Sesión genérica (no requiere migración): `bot/sessionManager.js` (`{ paso_actual, data }`).
- Frases en datos + `t()` + editor Prime: `bot/flows/_config.js`; `dashboard/routes/primeConfig.js`.
- Registro por giro (hueco a generalizar): `bot/flows/giroFlows.js:27-46`.
- Defaults de módulos (dónde va `motor_flujo_activo`): `bot/flows/modulosDefaults.js`.
- Estilo de tests de contrato a extender: `tests/test_citas.js`, `tests/test_reversion.js`.
