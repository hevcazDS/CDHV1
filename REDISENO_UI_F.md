# REDISEÑO UI — Esencia "F" (minimalismo japonés) · ESPEC APROBADA

> **Decisión del dueño (2026-07-14):** el nuevo diseño del ERP es la opción **F**
> ("MA" — minimalismo japonés), elegida entre 6 direcciones mockeadas (A Command,
> B Editorial, C Bold, D Orgánico, E Elegante, F Japonés). Los mockups aprobados
> (HTML reales, pixel-fieles) viven en el scratchpad de la sesión y se REPLICAN
> aquí como espec. **Requisito adicional del dueño:** en Ajustes de Prime debe
> poderse **revertir al tema anterior ("clásico")** por si algún cliente lo
> prefiere — el rediseño es el DEFAULT nuevo, no una imposición.

---

## 1. Filosofía (la esencia, no negociable)

**El vacío es la estructura.** Nada de cards con borde+sombra por todo: la
separación la hace el ESPACIO y hairlines de 1px. Nada grita; la información ES
el diseño. Un solo acento (bermellón de sello hanko) reservado para (a) lo
urgente y (b) la acción principal. El peso tipográfico solo aparece donde
importa: los montos y lo accionable.

## 2. Tokens (fuente de verdad del tema F)

```css
--papel:  #fbfaf7;   /* fondo — papel cálido */
--tinta:  #1f1d1a;   /* texto principal / barras de gráfica */
--gris:   #8a8578;   /* texto secundario */
--niebla: #c9c4b8;   /* labels/metadata terciaria */
--hair:   #eceae4;   /* hairlines 1px — ÚNICO separador permitido */
--beru:   #c73e3a;   /* bermellón hanko — acento ÚNICO: urgente + acción */
--matcha: #6d7f5e;   /* positivo (pagado/entregado/▲) */
--ocre:   #a8853c;   /* advertencia suave (por cobrar/seguimiento) */
--azul-gris: #5a7391;/* informativo (confirmado) — uso mínimo */
--panel-2: #f6f4ee;  /* superficie levemente sombreada (ticket POS, fila hover, conv activa) */
```

- **Sombras: NINGUNA** (cero box-shadow). Profundidad = contraste de superficie
  (`--panel-2`) o hairline.
- **Radios: mínimos** (0–5px; el hanko 5px, botones 4-5px). Nada de pills.
- Tipografía: **"Yu Gothic UI", "Segoe UI", system-ui** (peso 300 para números
  grandes/títulos, 600 SOLO donde importa). Montos siempre
  `font-variant-numeric: tabular-nums`. Folios/teléfonos en mono
  (Consolas) color niebla.
- Labels de sección: 10-10.5px, `letter-spacing: .22-.26em`, MAYÚSCULAS, color
  niebla, peso 500.

## 3. Layout global

- **Sidebar 200px, SOLO TEXTO** (sin iconos): logo = "kamon" (círculo con borde
  1.5px, iniciales), nombre del negocio + giro en versalitas espaciadas.
  - Ítem activo: **trazo bermellón de 18px** a la izquierda + texto tinta 600.
  - Inactivos: gris, indentados 30px (alineados tras el trazo).
  - Contadores: número pequeño bermellón (urgente) u ocre (atención) — sin pills.
  - Pie: sello hanko cuadrado bermellón (主) + usuario/rol en texto.
- **Topbar NO existe como barra**: una línea de texto al aire (buscar + ctrl k
  · estado del bot como punto+texto · fecha/tienda · iniciales usuario).
- Títulos de página: 28-30px **peso 300** con la parte clave en 600
  ("Buenos días**, Prime**" · "Finanzas **· dirección**"). Subtítulo con VOZ
  humana y datos vivos ("37 por cobrar — el resto fluye solo").
- Tabs: texto gris con subrayado bermellón fino en el activo (borde inferior
  hairline de la fila de tabs).
- Márgenes generosos: contenido con padding ~34-56px; columnas separadas por
  48-64px de aire, no por bordes.

## 4. Patrones por tipo de página (según los 4 mockups aprobados)

### 4.1 Tablas (Pedidos/Clientes/etc.)
- **Sin `<table>` con bordes/cajas**: filas separadas por hairline, sin fondo.
- Estatus = **punto de color (●7px) + palabra en gris** — NO pastillas/badges.
  (matcha=pagado/entregado, ocre=por cobrar, bermellón=cancelado/urgente,
  azul-gris=confirmado, niebla=pendiente).
- Acción principal por fila como **palabra bermellón 600** ("cobrar", "guía").
- Hover de fila: fondo `--panel-2`.
- Folio/guía en mono niebla. Total en 600 tabular, alineado derecha.
- Filtros: fila de texto con subrayado bermellón en el activo (mismo patrón tab).

### 4.2 Inicio (gráficas)
- KPIs **sin cajas**: label versalitas niebla / número 27px peso 300 (el
  principal en 600) / delta en matcha o bermellón. El KPI urgente (atención) va
  en bermellón con acción "responder ahora →".
- **Gráfica de barras 7 días**: barras de tinta finas (22px), HOY en bermellón,
  valores encima (10.5px gris), días abajo en niebla, línea base hairline,
  **media como línea punteada** niebla con etiqueta. Sin ejes, sin grid.
- **Sparklines**: trazo de tinta 1.5px con punto final bermellón.
- Columna derecha "**Requiere tu mano**": lista hairline de pendientes
  accionables (responder/cobrar/cerrar en bermellón) + "Últimos pedidos".

### 4.3 Finanzas
- Estado de resultados = **barras horizontales finas (4px)** sobre pista hair:
  ventas tinta, costos bermellón (con monto "− $x" en bermellón), utilidad
  matcha, gastos ocre. Total con **borde superior de tinta** y número 24px.
- Cartera por antigüedad = **una barra proporcional segmentada**
  (tinta→ocre→naranja→bermellón) + leyenda con swatches, NO donut.
- Flujo de caja = línea fina 6 meses, punto final bermellón.
- Balance = lista hairline; la fila clave con borde de tinta.

### 4.4 POS / Mostrador
- Búsqueda/escaneo = **input de línea subrayada** (borde inferior 1.5px tinta),
  grande, peso 300.
- Productos = lista 3 columnas SIN cajas (nombre 500 / marca versalitas niebla /
  precio 600 / stock en matcha·ocre·"agotado" ocre).
- Ticket = columna derecha en `--panel-2` (papel sombreado): cantidades en
  bermellón ("1×"), total 34px peso 300 con enteros en 600, métodos de pago como
  **sellos de línea** (borde 1px, el activo borde tinta 1.5px), y
  **COBRAR · F2 = bloque sólido bermellón** (el único bloque de color de toda la
  pantalla).

### 4.5 Atención / Chat
- Lista de conversaciones: hairlines; la activa con **borde izquierdo bermellón**
  + fondo `--panel-2`; estado en color-código (bermellón=esperando asesor,
  ocre=seguimiento, matcha=con el bot).
- Burbujas: cliente = fondo papel sombreado radios 2/14; **bot = delineado
  (borde hair, sin fondo)** alineado derecha, meta "· bot" en matcha.
- Eventos de sistema = línea centrada entre hairlines ("el bot escaló a asesor —
  quedó en silencio para no pisarte").
- Redactar = input de línea subrayada + botón ENVIAR bloque tinta.

## 5. REVERSIBILIDAD (requisito del dueño — obligatorio)

- El tema F es el **DEFAULT** nuevo, pero **en Prime → Ajustes (General) debe
  existir un selector de tema de instancia**: `F (nuevo)` ↔ `Clásico (anterior)`.
- Implementación esperada: clave `configuracion.tema_ui` (`'f'` default |
  `'clasico'`), expuesta en el endpoint de negocio/config de Prime; el frontend
  aplica `data-tema-ui="clasico"` en `<html>` y el CSS del tema clásico actual
  se conserva **completo** bajo ese selector (no se borra nada del tema viejo
  hasta que F esté estable y nadie lo use).
- Es config **por instancia** (cada cliente elige), igual que el resto de
  `configuracion` — sin rebuild, el polling de 60s del tema no aplica al front:
  basta refetch de /api/negocio al cargar.
- Los temas existentes (dark/confort/color del ThemeSwitcher de navegador) se
  mantienen como variantes del CLÁSICO; F trae su propia variante única (papel).

## 6. Plan de ejecución — EN CURSO

### ✅ Capa 1 HECHA (2026-07-14): tema F activo + reversión
- `configuracion.tema_ui` ('f' default | 'clasico') · `GET /api/negocio` lo expone ·
  `PUT /api/prime/tema-ui` (prime) lo cambia · selector en Prime → General
  ("Diseño del panel: Nuevo (minimalista) ↔ Clásico (anterior)").
- `dashboard-ui/src/temaF.css` — TODO bajo `html[data-tema-ui="f"]` (clásico
  intacto): tokens remapeados (papel/tinta/hair/beru/matcha/ocre), cero sombras,
  sidebar solo-texto con kamon y trazo bermellón, grupos en versalitas,
  contadores bermellón sin pastilla, cards fundidas a hairline con headers
  versalitas, tablas hairline + hover papel, badges (CSS y Mantine) → punto+palabra,
  botones planos (filled=tinta, primary CSS=beru), inputs foco tinta, tabs
  subrayado bermellón, títulos peso 300, fuente Yu Gothic UI.
- ThemeSwitcher (claro/color/oscuro) se OCULTA bajo F (pertenece al clásico) y
  se fuerza esquema claro. El atributo se aplica pre-render (main.jsx, cacheado).
- Verificado con captura headless real: Inicio y Pedidos ya rinden en F.

### ⏭ Capas siguientes
1. **Selects nativos de tablas → punto+menú** (Pedidos estatus) y kebab de
   acciones — el residuo más visible del look viejo.
2. Gráficas al estilo F (barras tinta + HOY bermellón, sparklines) en Inicio/
   Métricas; arreglar tipografía KPI fila 2 ("Precio").
3. POS/ticket, Chat/burbujas, topbar-como-línea (quitar fondo del buscador).
4. Trinquete con métricas F + CONVENCIONES_UI.md re-basado a F.
5. Franja superior de módulo (--modulo-color): hoy se ve como línea bermellón
   arriba — decidir si se queda como acento hanko o se elimina.

## 6b. Plan original (referencia)

1. **Tokens + Layout global** (sidebar texto/kamon/trazo, "topbar" de línea,
   tipografía) bajo `data-tema-ui="f"` — con el switch de §5 desde el día 1.
2. **Componentes F**: FilaTabla (hairline+punto-estado+acción bermellón),
   KPI sin caja, BarrasTinta/Sparkline (recharts ajustado o SVG propio),
   BarraSegmentada (aging), InputLínea.
3. Migración página por página (orden: Inicio → Pedidos → Atención → POS →
   Finanzas → resto), **cada una validada con captura headless** contra su mock.
4. Trinquete (`scripts/ui/estilo_guard.js`) ampliado con métricas F: cero
   box-shadow nuevos, cero pills/badges nuevos, cero borders que no sean hair.
5. `CONVENCIONES_UI.md` reescrito a la esencia F (los candados §10 se re-basan).

### Mockups de referencia (pixel-fieles, EN EL REPO)
Los HTML aprobados están copiados en **`docs/mocks-ui-f/`**
(`opcion_f.html` = Pedidos, `f_inicio.html`, `f_finanzas.html`, `f_pos.html`,
`f_chat.html`). Abrir en un navegador = ver el diseño aprobado tal cual. Son la
referencia de validación de cada página migrada (captura headless vs mock).
