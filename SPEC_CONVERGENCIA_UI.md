# SPEC — Convergencia UI del ERP (referencias → producto propio)

Objetivo: que el panel se sienta un **producto premium propio** (nivel Linear/Stripe/Odoo), no una plantilla. Aditivo y CSS-first sobre el sistema que ya existe (`dashboard-ui/src/styles.css`, React + Mantine, sin Google Fonts). **No** rompe Julio Cepeda ni el white-label: todo cuelga de los tokens `--brand`/`--modulo-color` que ya son sobreescribibles por cliente.

Referencias analizadas:
- **R1 Ynex CRM** (`IMG_1506`) — sidebar denso con badges/contadores, topbar rica de acciones, KPI cards con sparkline inline, dona "Leads by source", tabla de deals con acciones por fila.
- **R2 Tomorrow/管理者** (`IMG_1505`) — home-portal en secciones colapsables ("业务核心数据 / 项目管理 / 审批"), KPI con delta "对比昨日 +18%", accesos rápidos en grid de chips-icono, listas de aprobaciones/agenda a la derecha.
- **R3 TeamHub HR** (`IMG_1504`) — paleta **verde monocroma** (idéntica firma que la nuestra), donas de progreso pequeñas por métrica, tabla-detalle de empleado, banner "Level Up your Pro" en el sidebar, badges de estado (Approved/Pending) suaves.
- **R4 Starline** (`IMG_1501`) — **KPI card pastel** con icono en chip redondeado + delta "10.5% From Last Day", líneas Orders/Profit, dona "Sale Analytics" con anotaciones (70% Returned / 20% Completed), "Top Products" como lista compacta, sidebar de ítems con icono suave y píldora activa lima.

Estado actual (capturas de hoy): ya tenemos identidad verde `--brand #1a4d3e`, sidebar de 9 grupos acordeón con regleta de color por dominio, KPI cards con sparklines + swap número/%, card héroe `kpi-dark`, motion CSS, recharts lazy, buscador `Ctrl+K`, subnav vertical en módulos grandes (Finanzas/Almacén). El esqueleto ya es bueno; falta **cerrar la brecha de pulido y de densidad de información**.

---

## A. Qué se toma prestado de CADA referencia (patrón concreto)

### De R4 Starline
1. **KPI card con icono en chip redondeado + delta vs. día anterior.** Hoy nuestras KPI cuadradas muestran una dona pequeña y el número; les falta el *delta* ("+18% vs ayer") que es la lectura de un operador. Adoptar: chip-icono a la izquierda, número grande, y un `kpi-chip verde/rojo` con la flecha y "vs ayer". Ya tenemos `.kpi-chip.verde/.rojo` — solo falta **alimentarlo con dato real** (`ventas_hoy` vs. de ayer; el backend `/api/stats` ya calcula `ventas_hoy`, falta el par del día anterior).
2. **Dona con anotaciones de segmento** (Sale Analytics: "70% Returned", "20% Completed"). Para nuestra "Conversión búsqueda→pago" y estados de pedido: dona central con % grande y etiquetas laterales de cada segmento, en vez de solo un número plano.
3. **"Top Products" como lista compacta** (producto · code · thumb). Reusable tal cual para "Top productos vendidos" e "Urge resurtir" (Almacén ya tiene esa tabla; darle el mismo formato compacto de fila con miniatura).

### De R2 Tomorrow
4. **Home en secciones con encabezado "ver más →".** Su portal agrupa "业务核心数据 · 项目管理 · 审批". Nuestra Inicio ya tiene bloques; adoptar el **encabezado de sección consistente** (`título · ver todos →`) que ya usamos en "Últimos pedidos", extendido a cada bloque del home.
5. **Delta explícito "对比昨日 +18% ↑"** bajo cada KPI del portal. Confirma el patrón de R4: el comparativo contra ayer es el estándar del home operativo.
6. **Grid de accesos rápidos (chips icono).** Su "我的常用" (mis frecuentes) es una fila de botones-icono a acciones. Adoptar como fila de **atajos operativos** en Inicio: "Nueva venta (Mostrador) · Nuevo pedido · Registrar entrada · Corte de caja" — reduce clics a las 4 acciones que más se repiten.

### De R1 Ynex
7. **Contadores/badges en el sidebar.** Ynex pone `12` junto a "Dashboards" y `New`/`Hot` en ítems. Adoptar **badges numéricos discretos** en los links que tienen pendientes: "Pedidos ⟵ 37", "Cola de atención ⟵ 7", "Devoluciones ⟵ N". Es la mejora de navegación de mayor impacto: el operador ve dónde hay trabajo sin entrar.
8. **Topbar de acciones a la derecha del título** (Filters / Export). Nuestras páginas de tabla (Pedidos) ya tienen CSV/refresh sueltos; formalizar una **zona de acciones de página** consistente (filtro + exportar + acción primaria) alineada a la derecha del `page-head`.
9. **Tabla de "deals" con acciones reveladas por fila.** Ya lo tenemos (`.row-actions` opacity .35 → 1 en hover). Mantener y aplicar de forma consistente en todas las tablas.

### De R3 TeamHub
10. **Confirmación de que el verde monocromo es la dirección correcta** — no desviarse a pastel multicolor de marca. TeamHub demuestra que un ERP serio se sostiene con **una** tinta (verde) + neutros + badges de estado suaves. Nuestra `--brand` es exactamente esto.
11. **Donas de progreso chicas por métrica** (leaves usados 14/20). Reusar para "stock crítico N/total", "pagos por cobrar N/total pedidos" — contexto visual sin ocupar una card entera.
12. **Badges de estado suaves** (Approved verde-claro, Pending amarillo-claro). Ya tenemos `.badge-verde/amarillo/rojo` con fondo al 15%. Confirmado: mantener, no subir saturación.

---

## B. Qué NO copiar (rompe la operación de 8 h)

- **Lienzo degradado rosa/lavanda de Starline como default** (R4). Bonito en un dribbble, fatiga en jornada larga y compite con los datos. Se queda **solo** como tema opcional "Color" (ya existe `[data-tema="color"]`). Default = gris/blanco actual.
- **Cards con sombra flotante de 20–28px** (R1/R4). En un ERP de tablas densas la sombra grande crea ruido y "flotan" mal apiladas. Mantener la regla actual: `borde define, sombra 1px despega`. Ya está en styles.css — no tocar.
- **Sidebar de 2 niveles que ESCONDE** (acordeón que colapsa grupos enteros). El acordeón actual está bien porque **la sección activa queda abierta**; el antipatrón es esconder destinos frecuentes tras 2 clics. Los ítems de alto tráfico (Inicio, Pedidos, Mostrador) deben estar siempre a 1 clic → ver mejora D2.
- **Exceso de color por métrica** (cada KPI de un color distinto). R4 tiene 3 pasteles diferentes por card; a 6 KPIs eso es un semáforo mareante. Regla: **color solo comunica estado** (verde=bien, rojo=atención), no decora. El resto es neutro + la tinta de dominio en la regleta.
- **Emojis en títulos de datos** (Starline "Welcome, Josiah 🎉"). En finanzas resta seriedad. Los emojis-icono de acción (📥 entrada, 🛵 repartidor) sí se quedan porque son *funcionales* y ya establecidos.
- **Mini-charts decorativos sin eje ni escala** metidos en cada card (R1). El sparkline solo aporta si la tendencia importa (ventas, pedidos). No poner sparkline en "Clientes activos" o "Chats" donde la forma no dice nada — ahí, número + delta basta.
- **Densidad extrema de Ynex** (sidebar con 15 grupos + subgrupos). Tomamos sus *badges* y su *topbar*, no su saturación. Nuestros 9 grupos son el techo.

---

## C. SÍNTESIS — layout propio que converge las 4

### C1. El shell
Se mantiene la estructura AppShell actual (sidebar izq · topbar · canvas), refinada:

- **Topbar (56px, ya existe).** Izq: buscador `Ctrl+K` (ya está). Der: campana con badge · pill de estado del bot · avatar. **Añadir**: cuando la página es de tabla, la zona de acciones de página (filtro/export/primaria) vive en el `page-head` del canvas, no en la topbar — así la topbar es global y estable (patrón Stripe), y las acciones contextuales están junto a lo que afectan.
- **Sidebar.** Se mantiene grupos-acordeón + regleta de dominio. **Añadir badges de pendientes** (mejora A7/D1). El banner "Level Up Pro" de R3 → lo reusamos como **slot de estado del negocio** al pie del sidebar (p.ej. "Bot detenido — reanudar", o vacío), no como upsell.
- **Canvas.** `page-head` (título + subtítulo + acciones a la derecha) → contenido. La regleta superior de color por módulo (`.content border-top 3px`) ya da orientación de dominio; se mantiene.

### C2. Sistema de KPI card DEFINITIVO
**Decisión: monocromo actual como base, con el patrón de composición de Starline** (no pastel de fondo). Fondo neutro (`--panel`), color solo en el chip-icono y el delta. Un ERP serio no pinta el fondo de cada KPI.

Anatomía (nueva variante `.kpi-card--delta`, aditiva; la cuadrada `.kpi-sq` sigue para el dash de 6):

```
┌─────────────────────────────┐
│ [◐ chip-icono]   Ventas hoy │   ← label arriba der, icono en chip a la izq
│                             │
│ $12,738.00                  │   ← número grande, tabular-nums (ya tenemos .kpi-num)
│ ▲ 18% vs ayer   ~sparkline~ │   ← delta (.kpi-chip verde/rojo) + sparkline opcional
└─────────────────────────────┘
```

Tokens/CSS (reusa lo existente, añade lo mínimo):
```css
/* chip-icono redondeado (patrón Starline), tinta del dominio, no de marca fija */
.kpi-ico {
  width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
  display: grid; place-items: center;
  background: var(--modulo-soft, var(--brand-soft));
  color: var(--modulo-color, var(--brand));
}
/* variante horizontal con delta — reusa .kpi-flex / .kpi-chip que YA existen */
.kpi-card--delta { flex-direction: row; align-items: center; gap: 14px; }
.kpi-card--delta .kpi-num { font-size: 26px; }
```
La `.kpi-dark` héroe (verde, número invertido) se queda: es nuestra firma y ancla la jerarquía del home. El delta se alimenta de dato real — requiere que `/api/stats` devuelva el valor de ayer para ventas y pedidos (backend, Ola 1 abajo).

### C3. Jerarquía tipográfica
Ya tenemos `--font-titulos` (Segoe UI Variable / system stack) y `tabular-nums` en dinero. Formalizar la escala (añadir como comentario-contrato + clases donde falte):

| Rol | Tamaño / peso | Clase |
|---|---|---|
| Título de página | 28px / 600, `-0.02em` | `.page-title` (existe) |
| Subtítulo de página | 14px / 400, `--text-dim` | `.page-sub` (existe) |
| Título de card/sección | 15px / 600 | `.card-header h3` (existe) |
| KPI número | 24–26px / 700, tabular | `.kpi-num` (existe) |
| Label de KPI | 13px / 400 dim | `.kpi-label` (existe) |
| Delta / metadato | 11.5px / 600 | `.kpi-chip` (existe) |
| Header de tabla | 11px / 600 UPPER `.04em` | `th` (existe) |
| Dato de tabla | 13px / 400 | `td` (existe) |

Regla dura ya vigente y que se ratifica: **todo número de dinero = tabular + alineado a la derecha + 2 decimales**. Nada nuevo que construir aquí — solo aplicarlo en las tablas que aún alinean dinero a la izquierda (revisar Almacén/Finanzas).

### C4. Grilla del home (Inicio)
Converge R2 (secciones "ver más") + R4 (KPI+delta) + R1 (badges). De arriba a abajo:

1. **Strip "Requiere tu acción"** (ya existe `.accion-strip`) — pendientes antes que nada.
2. **Atajos operativos** (nuevo, de R2 §6): fila de 4 chips-icono → Mostrador / Nuevo pedido / Entrada mercancía / Corte de caja. Reusa `.mkt-grid` como contenedor.
3. **Fila de 6 KPI cuadradas** (`.kpi-grid6`, existe) — el "dash de monitor", con la card héroe verde primero. **Añadir delta** a las 2–3 que lo ameritan (ventas, pedidos).
4. **Fila de mini-tarjetas de marketing** (`.mkt-grid`, existe) — carritos, conversión, etc.
5. **Fila 2-col** (`.fila-2col`, existe): gráfica pedidos 7d (izq) + "Últimos pedidos" (der), cada uno con header `título · ver todos →`.

El home ya llena el viewport sin scroll (`.pagina-llena`) — se preserva. La única adición estructural es la fila de atajos (§2).

---

## D. Facilidad de uso / intuición (mapeado a páginas reales)

**D1. Badges de pendientes en el sidebar** (de R1). Junto a "Pedidos" un `37`, "Cola de atención" un `7`, "Devoluciones" un `N`. Fuente: los mismos contadores que ya calcula `/api/stats` y el strip de Inicio. Impacto: el operador ve el trabajo sin navegar. → *Layout.jsx, sidebar.*

**D2. Atajos operativos en Inicio + `Ctrl+K` con acciones, no solo secciones.** Hoy `Ctrl+K` navega a secciones; añadirle **acciones** ("Cobrar venta", "Registrar entrada", "Nuevo pedido"). Y la fila de atajos-chip del home (C4 §2). Reduce de 3 clics a 1 las 4 tareas más repetidas. → *Inicio.jsx, buscador global.*

**D3. Mostrador: foco y feedback de cobro.** El input de código de barras ya autofocus; añadir: (a) al agregar producto, **flash de fila** (ya tenemos `@keyframes row-saved`), (b) el botón "Cobrar $X" **fija abajo** (sticky) para que en carritos largos siempre esté a la vista, (c) tras cobrar, toast + auto-reset con foco de vuelta al scanner. Es la pantalla de más horas → merece los toques `.pos-mode` que ya existen, más el sticky. → *Mostrador.jsx.*

**D4. Estados vacíos accionables en TODAS las tablas** (regla D6.3 ya escrita, aplicarla). Almacén "Mercancía por llegar" ya lo hace bien ("Las OC con fecha estimada aparecen aquí"). Replicar el patrón `.empty` + `.empty-accion` (verbo + dónde) en Pedidos vacío, Devoluciones vacío, Carrito vacío del Mostrador ("Escanea o busca un producto para empezar"). → *todas las tablas.*

**D5. Filtros persistentes y visibles en Pedidos.** El filtro Estatus + búsqueda ya están; hacerlos **recordar la última selección** (localStorage) y mostrar un chip "filtrando por: pagado ✕" para que sea obvio por qué faltan filas. Evita el "¿dónde están mis pedidos?" clásico. → *Pedidos.jsx.*

**D6. Finanzas: navegación por subnav ya existe — añadir "saltar a lo que importa".** El Tablero de dirección es denso; añadir al tope 3 chips-KPI clicables (Utilidad / Caja disponible / Ticket promedio) que hagan scroll-to a su bloque. El delta "vs periodo anterior" ya está en verde/rojo — bien. → *Finanzas.jsx.*

**D7. Onboarding visual / primeros pasos.** Para una instancia nueva (white-label) el home vacío no dice qué hacer. Un **checklist de arranque** en Inicio cuando `negocio_configurado` recién pasó a 1 y no hay ventas: "① Da de alta tu primer producto → Catálogo · ② Registra stock → Entrada mercancía · ③ Haz tu primera venta → Mostrador". Se auto-oculta cuando hay datos. Reusa `.accion-strip` / `.card`. → *Inicio.jsx.* (No aplica a JC, que ya tiene datos → invisible ahí.)

**D8. Consistencia de acciones por fila.** Los iconos de acción de Pedidos (✓ / ticket / historial / link) no tienen tooltip. Añadir `title=` a cada uno. Micro-mejora, alto retorno en descubribilidad. → *Pedidos.jsx y tablas con `.row-actions`.*

---

## E. Plan por olas (aditivo, CSS-first, no rompe JC ni white-label)

**Ola 1 — KPI+delta y home (bajo esfuerzo, alto impacto).** ~1 día.
- `/api/stats`: devolver valor de ayer para ventas y pedidos (comparativo).
- CSS: `.kpi-ico`, `.kpi-card--delta` (aditivos; nada existente cambia).
- Inicio: alimentar delta en las KPI que lo ameritan; añadir fila de atajos (C4 §2) y checklist de arranque condicional (D7).
- Riesgo JC: nulo — el delta usa `.kpi-chip` existente; sin datos de ayer, se oculta.

**Ola 2 — Navegación (bajo esfuerzo).** ~0.5 día.
- Badges de pendientes en sidebar (D1) desde contadores ya existentes.
- `Ctrl+K` con acciones además de secciones (D2).
- `title=`/tooltips en acciones de fila (D8).

**Ola 3 — Pantallas de trabajo (medio).** ~1–1.5 días.
- Mostrador: botón Cobrar sticky + flash al agregar + reset con foco (D3).
- Pedidos: filtros persistentes + chip de filtro activo (D5).
- Estados vacíos accionables donde falten (D4).

**Ola 4 — Datos densos (medio).** ~1 día.
- Donas con anotaciones de segmento (A2/A11) para conversión y estados de pedido.
- "Top productos" / "Urge resurtir" como lista compacta con miniatura (A3).
- Finanzas: chips-KPI clicables scroll-to (D6).
- Auditar alineación de dinero a la derecha en Almacén/Finanzas (C3).

**Invariantes de todas las olas:**
- Ningún color nuevo hardcodeado: todo cuelga de `--brand`/`--modulo-color`, sobreescribibles por cliente → white-label intacto.
- Todo CSS es aditivo (clases nuevas); las clases existentes no cambian de significado → JC byte-compatible mientras no active las variantes nuevas.
- Tema default = gris/blanco. Pastel/degradado siguen solo como `[data-tema="color"]` opt-in.
- Sin Google Fonts, sin cambio de stack, sin Tailwind full (solo utilities, como hoy).

---

**skipped:** cualquier rediseño del shell, tokens de fuente nuevos, o dependencia de charts extra. Añadir solo si una ola concreta lo pide. Lo caro (donas anotadas, listas con thumb) queda en Ola 4 porque es lo de menor retorno operativo.
