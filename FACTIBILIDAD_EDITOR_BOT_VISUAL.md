# Factibilidad — Editor visual tipo ComfyUI para el bot (Prime)

Evaluación con evidencia en código. Repo `bothHS 1.2`. Fecha 2026-07-12.

---

## A. Veredicto

**🟡 Factible con recorte fuerte de alcance.**

- ✅ **Visualizar el flujo como grafo**: sí, se puede DERIVAR del código actual (los `STEPS` de cada flow + las aristas se declaran a mano una vez). Bajo riesgo.
- ✅ **Editar frases desde el nodo y guardar por instancia**: la tubería completa YA EXISTE (`configuracion.frase_<clave>` + `t()`). El "editor visual" sería una piel nueva sobre un backend que ya funciona.
- ❌ **Reconectar aristas para cambiar el flujo**: NO viable sin reescribir el motor del bot. El flujo vive en `if/switch` dentro de cada `flows/*.js` (código, no datos). Un grafo editable de aristas no cambiaría nada — o peor, mentiría al operador. Esto NO debe construirse.
- 🟡 **Cobertura de frases**: hay una trampa. El diccionario editable `FRASES` tiene **solo 12 claves** (`_config.js:76-155`), pero el bot tiene **~40 estados** (`S`, `_shared.js:31-66`) y la mayor parte del texto real vive **inline en los flows** vía `vocab()`, no en `FRASES`. Un grafo de 40 nodos mostraría ~12 con frases editables y ~28 vacíos. Ver §C.

**Conclusión honesta**: el valor está en el **mapa navegable + editar las frases que ya son editables**, no en un editor de flujo. El "sueño ComfyUI" (reconectar el flujo) es un anti-objetivo aquí.

---

## B. ¿Se deriva el grafo del código?

**Los NODOS sí se derivan; las ARISTAS no** (el flujo es implícito).

Evidencia de que el flujo es implícito, no un grafo explícito:

- El router despacha por pertenencia a un array, no por grafo: `actionHandler.js:147-158` — `for (const flow of _flowsActivos) { if (!flow.STEPS.includes(step)) continue; ... }`.
- Cada módulo declara sus estados en un `STEPS` plano (sin transiciones):
  - `menuFlow.js:98` — `[MENU, SEARCHING, WIZARD_Q1..3, VIEW_PRODUCT, ADD_MORE, REFERIDOS, VARIANTE]`
  - `cartFlow.js:67` — `[SHOW_CART, CONFIRM_ORDER, OFERTAS, CUPON, PAGO_METODO, PAGO_COMPROBANTE]`
  - `orderFlow.js:65` — `[ASK_CP, SPLIT_DELIVERY, SPLIT_CONFIRM, DELIVERY, PICKUP_CONFIRM]`
  - `addressFlow.js:59`, `asesorFlow.js:62`, `citasFlow.js:15`.
- Las transiciones ("de MENU a SEARCHING") viven dentro de cada `handle()` como `sessionManager.updateSession(userId, S.X, ...)` disperso en `if/switch`. No hay tabla de aristas.

Por tanto:

- **Nodos** = la unión de todos los `STEPS` (más los pseudo-estados de entrada: reset/global, devolución `_RE_DEVOLUCION`). Derivables automáticamente leyendo los arrays.
- **Aristas** = **declarar a mano una vez**. Extraerlas por análisis estático de los `updateSession(...)` sería frágil (hay ramas condicionales, `SPLIT_*`, etc.) y no vale el esfuerzo.

**Fuente de verdad propuesta para el grafo**: un único archivo declarativo estático,
`dashboard/routes/botGrafo.js` (o `bot/flows/_grafo.js` para poder compartirlo), con:

```js
// nodos: derivados de STEPS + agrupados por módulo/flow, con su(s) clave(s) de frase.
// aristas: lista a mano [{from:'MENU', to:'SEARCHING'}, ...] — SOLO para dibujar.
module.exports = {
  nodos: [
    { id:'MENU', modulo:'menu', label:'Menú principal', frases:['menu_opciones','saludo_nuevo','saludo_recurrente'] },
    { id:'SEARCHING', modulo:'menu', label:'Buscando', frases:['buscar_inicio'] },
    // ...
  ],
  aristas: [ {from:'MENU', to:'SEARCHING'}, {from:'MENU', to:'WIZARD_Q1'}, ... ],
};
```

Las aristas son **puramente decorativas** (para pintar líneas). El bot las ignora — nunca se leen en runtime. Esto mantiene el grafo como documentación viva sin acoplarlo al motor.

---

## C. Modelo de datos

**No inventar tablas. Reusar lo que ya existe.**

Persistencia de frases por instancia — YA IMPLEMENTADA:

- Almacenamiento: filas en `configuracion` con clave `frase_<clave>` (`primeConfig.js:180-183`):
  `INSERT ... configuracion (clave,valor) VALUES ('frase_menu_opciones', ...)`. Vacío ⇒ `DELETE` (vuelve al original).
- Lectura en runtime: `t()` da prioridad al override de instancia sobre giro y tono (`_config.js:186-189`):
  `const propia = _cache.modulos['frase_' + clave]; ... (propia && String(propia).trim()) || overrides... || base...`.
- Cache 60s, sin reiniciar el bot (`_config.js:17-36`).
- API existente: `GET/PUT /api/prime/frases`, prime-only (`primeConfig.js:153-186, 494-495`).

**Representación del grafo (nodos + aristas + frases)**:

| Pieza | Dónde vive | Editable por operador |
|---|---|---|
| Nodos (estados) | Derivados de `STEPS` + `_grafo.js` estático | No (los define el código) |
| Aristas (líneas) | `_grafo.js` estático, decorativas | No |
| Frases del nodo | `FRASES` (base/tono/giro) + override en `configuracion.frase_<clave>` | **Sí** (lo único editable) |

El nodo del grafo **no necesita fila propia en DB**. Un nodo = `{id, modulo, label, frases[]}` estático; cada `clave` de frase se resuelve contra el endpoint existente (`efectivo` = lo que ve el cliente, `override` = lo personalizado). El editor visual reusa `PUT /api/prime/frases` sin backend nuevo.

**Hueco a cubrir (la trampa de §A)**: `FRASES` cubre 12 claves; el resto del texto está inline en los flows con `vocab()` (ver CLAUDE.md "Business-agnostic copy"). Para que un nodo como `ASK_CALLE`/`CITA_FECHA` sea editable habría que **migrar esos literales a `FRASES`** primero (agregar la clave, cambiar el literal por `t('clave')`). Ese es el trabajo real y de riesgo (tocar los flows), no el grafo. MVP: mostrar esos nodos como "no editable aún" en vez de fingir.

---

## D. UI: react-flow vs a mano

**Recomendación: grafo a mano (SVG + CSS), NO react-flow.**

Razones:

- **Escala**: ~40 nodos, aristas fijas, layout que puede ser estático (columnas por módulo). No hay pan/zoom/drag masivo que justifique una lib de 400 KB+.
- **Bundle**: el proyecto acaba de hacer code-splitting agresivo para bajar el initial load y sacar recharts (CLAUDE.md "Code-splitting Bloque 3"). Meter `@xyflow/react` (~150 KB min+gz, +d3 deps) contradice ese esfuerzo. Iría lazy en su propio chunk, pero sigue siendo peso para una feature de nicho (solo prime).
- **CSP**: el CSP actual es `script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'` (`server.js:386`). react-flow inyecta estilos inline → `'unsafe-inline'` ya está, así que **técnicamente pasa**. No es un bloqueante, pero tampoco un argumento a favor.
- **Mantenimiento**: Mantine ya está; un layout en columnas con `<div>` (nodo) + un `<svg>` de fondo para las líneas es ~150 líneas, cero dependencias, y reusa `BotEditorTab.jsx` casi tal cual dentro de cada nodo.

**Anatomía del nodo** (reusa lo que ya hay):

```
┌─ [MENU]  Menú principal ────────────┐
│  menu_opciones      [personalizada] │  ← título = acción/estado
│  ┌ hoy el cliente ve: ────────────┐ │
│  │ 1️⃣ Buscar... (preview t())     │ │  ← f.efectivo (ya lo da el API)
│  └────────────────────────────────┘ │
│  [ textarea override por tono ]      │  ← mismo control de BotEditorTab
│  [Guardar] [Restablecer]             │
└──────────────────────────────────────┘
```

- Título = `nodo.label` / `id`. Cuerpo = un `BotEditorTab`-por-nodo (mismo `PUT /api/prime/frases`).
- Guardado **por tienda/instancia**: automático — el `PUT` escribe en `configuracion` de esta instancia (cada clon tiene su propia SQLite, CLAUDE.md "instance-per-tenant").
- Edición por tono: hoy el editor guarda **un texto plano que gana sobre los 4 tonos** (`_config.js:188`). Si se quiere override *por tono* (A/B/C/D independientes) habría que ampliar la clave a `frase_<clave>_<tono>` — trabajo extra, no MVP.

---

## E. Alcance: MVP vs completo

**MVP útil (lo que sí conviene construir)**:
1. Vista de grafo read-mostly: nodos por módulo, aristas decorativas, navegable.
2. En cada nodo con clave(s) en `FRASES`: editar la frase inline (reusa `/api/prime/frases`).
3. Nodos sin frase en `FRASES`: mostrados en gris "texto fijo por ahora".
   Es el `BotEditorTab` actual + un mapa encima. Backend nuevo ≈ 0.

**Completo (reconectar el flujo) — NO construir**:
- Arrastrar aristas para cambiar transiciones NO tiene efecto: el flujo está en `if/switch` del código (`menuFlow.handle`, etc.), no en datos. Haría falta un motor de flujo interpretado (máquina de estados declarativa que reemplace los `handle()`), es una reescritura del núcleo del bot y de todos los tests (`test_bot.js` 100/100). No.
- **Qué NO debe ser editable nunca**: las aristas del checkout (`SHOW_CART → CONFIRM_ORDER → ASK_CP → DELIVERY/PICKUP → PAGO`). Dejar reconectar eso = romper ventas. El grafo debe ser **explícitamente de solo lectura en su topología**; solo el texto es editable.

**Riesgo intermedio (opcional, fuera de MVP)**: migrar literales inline de los flows a `FRASES` para ampliar cobertura de nodos editables. Toca los `flows/*.js` (los mismos que verifican los tests) → hacer clave por clave, con test.

---

## F. Plan por fases

| Fase | Qué | Esfuerzo | Riesgo |
|---|---|---|---|
| **0** | `_grafo.js` estático: nodos derivados de `STEPS` + aristas a mano + `frases[]` por nodo (mapear las 12 claves de `FRASES` a sus estados). Endpoint `GET /api/prime/grafo` (o servir el JSON directo). | ~0.5 día | Bajo |
| **1 (MVP)** | Nueva pestaña Prime `GrafoBotTab.jsx`: layout en columnas por módulo, `<svg>` para líneas, nodo = tarjeta con `BotEditorTab` embebido por clave. Reusa `/api/prime/frases`. Nodos sin frase → gris. | ~1.5–2 días | Bajo |
| **2 (opc.)** | Ampliar cobertura: migrar N literales inline de flows a `FRASES` (clave + `t()` + test por cada uno). Prioriza los estados de más peso (ASK_*, CITA_*, PAGO_*). | ~0.5 día por lote | Medio (toca flows/tests) |
| **3 (opc.)** | Override por tono (`frase_<clave>_<tono>`): ampliar `t()`, `frasesPut`, UI con 4 campos. | ~1 día | Medio |
| **~~4~~** | ~~Reconectar aristas / editor de flujo~~. **Descartado** — reescritura del motor. | — | Inaceptable |

**Recomendación**: Fases 0+1 dan el 80% del valor pedido ("ver el flujo como mapa + ajustar frases por tienda") con backend cero y sin tocar el bot. Vender el MVP como "mapa del bot", no como "editor de flujo", para no crear la expectativa de reconectar aristas.

---

### Resumen de evidencia

- Router por array, no grafo: `bot/actionHandler.js:147-158`.
- Estados: `bot/flows/_shared.js:31-66` (~40 `S.*`).
- `STEPS` por módulo: `menuFlow.js:98`, `cartFlow.js:67`, `orderFlow.js:65`, `addressFlow.js:59`, `asesorFlow.js:62`, `citasFlow.js:15`.
- Frases base: `bot/flows/_config.js:76-155` (**12 claves**).
- Override por instancia en runtime: `_config.js:186-189`.
- Persistencia `configuracion.frase_<clave>`: `dashboard/routes/primeConfig.js:180-183`.
- API + editor actual: `primeConfig.js:153-186, 494-495`; `dashboard-ui/src/pages/prime/BotEditorTab.jsx`.
- CSP: `dashboard/server.js:386`.
