# SPEC_MOTION_UI — Sistema de motion y micro-interacciones

Objetivo: que el dashboard deje de sentirse "plantilla estática" y se sienta producto vivo
(nivel Linear/Stripe) **solo con CSS** — sin Google Fonts (CSP), sin libs nuevas.
Todo el CSS de este documento es para pegar en `dashboard-ui/src/styles.css` casi literal.
Regla dura en todo el spec: **solo se animan `transform`, `opacity`, `box-shadow`, `color`,
`background-color`, `border-color`** — nunca `width/height/top/left/margin/padding` (layout thrash).

---

## A. CRÍTICA VISUAL (capturas de `scratchpad/shots/`)

Lo que sigue gritando "plantilla", elemento por elemento:

1. **Nada se mueve, nunca** (todas las capturas). Hoy los únicos motion del producto son
   `bot-pulse` en el widget del bot y un `translateY(-2px)` en `.kpi-clic`. Todo lo demás —
   sidebar, tablas, tabs, modales, badges, botones — cambia de estado con un `transition: all .15s ease`
   genérico o directamente sin transición. Un cambio de página es un "flashazo": el contenido
   nuevo aparece de golpe. Esa ausencia total de coreografía es el 60% de la sensación "template".

2. **`04_inicio_estable.png` — KPIs sin vida.** Seis cards con RingProgress estáticos. Un ring
   que ya está dibujado al llegar no comunica nada; el mismo ring que se dibuja en 400ms al
   montar dice "esto está calculando TU operación". Además la card héroe verde (`kpi-dark`)
   es la única con personalidad — las otras cinco son idénticas entre sí y al hover no responden.

3. **`10_pedidos.png` — la tabla es un Excel congelado.** El hover de fila existe
   (`tbody tr:hover td { background: var(--panel-2) }`) pero salta sin transición, y las
   filas no tienen affordance de "esto es clickeable". Los 4 iconos de acción por fila
   (✓/📄/🕘/🔗) aparecen siempre a opacidad completa → ruido; el patrón Linear es
   atenuarlos y revelarlos al hover de la fila. Los selects de estatus nativos con la
   flechita doble del OS gritan "formulario sin diseñar".

4. **`10_mostrador.png` — el POS no se siente táctil.** Los chips de denominación
   ($50/$100/$200/$500) y "Cobrar $0.00" son la zona que un cajero golpea cientos de veces
   al día y no tienen estado pressed: sin scale, sin feedback. En una pantalla touch eso se
   percibe como "no respondió". El `Total: $0.00` tampoco reacciona cuando cambia el monto.

5. **`10_erp.png` (Finanzas) — la subnav vertical no orienta.** El item activo
   ("Tablero de dirección") es solo un fondo gris; no hay indicador que se *mueva* entre
   items al navegar. Los montos grandes ($55,124.99, $70,924.00) aparecen sin transición
   al cambiar el rango de fechas — un cambio de dato importante que pasa desapercibido.

6. **`10_almacen.png` — las alertas rojas no alertan.** Las dos cards con borde rojo
   (119 agotados / 41 críticos) tienen exactamente el mismo peso visual estático que las
   neutras. Un borde rojo quieto se vuelve invisible al segundo día; el estado "requiere
   acción" merece al menos una transición de color al hover y un dot que respire.
   Los "0" rojos de la tabla "Urge resurtir" idem.

7. **`10_modulos.png` — los toggles son el switch azul default.** El azul `#228be6` del
   switch es Mantine-stock, ni siquiera respeta `--brand` — es la señal más obvia de
   "plantilla sin tematizar" de todas las capturas. El flip del toggle sí transiciona (.25s)
   pero la fila entera no confirma el cambio (sin flash de fondo, sin transición del texto).

8. **`10_prime.png` / `10_almacen.png` — tabs sin indicador animado.** El subrayado del tab
   activo ("Sucursales", "Resumen") aparece/desaparece; en cualquier producto pulido el
   subrayado *se desliza* al tab destino. Es la micro-interacción más barata y más
   reconocible que existe.

9. **`10_tareas.png` / `10_clientes.png` — "Cargando..." de texto.** Cuando estas tablas
   cargan muestran una celda con "Cargando..." (patrón repetido en 20+ páginas, ver §C).
   Texto plano de carga = 2012. El skeleton shimmer es el marcador generacional más fuerte
   entre "plantilla" y "producto".

10. **Global — focus invisible.** No hay `:focus-visible` en ningún control custom
    (`.btn`, `.sidebar-link`, `.tabs .btn`, filas). Tab por el teclado y no sabes dónde
    estás. Aparte de accesibilidad, el ring de focus bien hecho (offset + color de marca)
    es parte del look Stripe.

11. **Global — el sidebar activo no se desliza.** `.sidebar-link.active` cambia de fondo
    instantáneamente. Sin pill que viaje ni indicador lateral, la navegación se siente de
    página-recargada aunque sea SPA.

---

## B. SISTEMA DE MOTION — pegar en `styles.css`

### B0. Tokens (van dentro del `:root` existente)

```css
:root {
  /* ── Motion tokens ──────────────────────────────────────────────── */
  --dur-1: 120ms;   /* micro: hover, pressed, color de badge */
  --dur-2: 200ms;   /* estándar: cards, tabs, indicadores */
  --dur-3: 320ms;   /* entrada: página, modal, drawer */
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);      /* llegar suave (default) */
  --ease-in-out:    cubic-bezier(0.45, 0, 0.55, 1);      /* mover entre posiciones */
  --ease-spring:    cubic-bezier(0.34, 1.56, 0.64, 1);   /* rebote sutil (pressed→release) */
  --ring: 0 0 0 3px color-mix(in srgb, var(--brand) 25%, transparent);
}
```

### B1. Cards — elevación + borde al hover

Solo cards *interactivas* levantan (KPIs clickeables, filas-card); una card estática que
levanta al hover promete un click que no existe. Se marca con `.card-hover` (o ya existente
`.kpi-clic`).

```css
.card, .kpi-card {
  transition: box-shadow var(--dur-2) var(--ease-out-quart),
              border-color var(--dur-2) var(--ease-out-quart),
              transform var(--dur-2) var(--ease-out-quart);
}
.card-hover:hover, .kpi-clic:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--brand) 30%, var(--border));
  box-shadow: 0 1px 2px rgba(16,17,20,0.04), 0 8px 20px rgba(16,17,20,0.07);
}
.card-hover:active, .kpi-clic:active { transform: translateY(0); transition-duration: var(--dur-1); }
```

(Sustituye el `.kpi-clic { transition: transform .12s ease }` actual.)

### B2. Filas de tabla — hover con transición + acciones reveladas

```css
tbody td { transition: background-color var(--dur-1) ease; }
tbody tr:hover td { background: var(--panel-2); }
tbody tr:active td { background: color-mix(in srgb, var(--brand) 6%, var(--panel-2)); }

/* Acciones por fila: atenuadas en reposo, plenas al hover de SU fila.
   Uso: envolver los iconos de acción de Pedidos/Clientes/etc. en un td.row-actions
   (o poner la clase en el td que ya los contiene — solo clase, sin cambiar estructura). */
.row-actions { opacity: .35; transition: opacity var(--dur-1) ease; }
tr:hover .row-actions, .row-actions:focus-within { opacity: 1; }
```

### B3. Botones — pressed state real

```css
.btn {
  transition: background-color var(--dur-1) ease, border-color var(--dur-1) ease,
              color var(--dur-1) ease, transform var(--dur-1) ease,
              box-shadow var(--dur-1) ease;              /* reemplaza "all .15s ease" */
}
.btn:hover { border-color: var(--accent); }
.btn:active { transform: scale(0.97); }
.btn-primary:hover { filter: none; background: linear-gradient(135deg, var(--accent-2), var(--accent)); }
.btn-primary:active { transform: scale(0.97); }
.btn:disabled, .btn-primary:disabled { transform: none; }
```

### B4. Sidebar — indicador que se desliza + hover con vida

El pill que "viaja" entre links requiere JS/FLIP; el equivalente 100% CSS que se percibe
casi igual: barra lateral que crece desde el centro en el link activo + slide del texto al hover.

```css
.sidebar-link {
  position: relative;
  transition: background-color var(--dur-1) ease, color var(--dur-1) ease;
}
.sidebar-link::before {                 /* indicador lateral */
  content: '';
  position: absolute; left: 0; top: 50%;
  width: 3px; height: 0; border-radius: 3px;
  background: var(--brand);
  transform: translateY(-50%);
  transition: height var(--dur-2) var(--ease-out-quart), opacity var(--dur-2) ease;
  opacity: 0;
}
.sidebar-link.active::before { height: 18px; opacity: 1; }
.sidebar-link:hover:not(.active) { transform: translateX(2px); }
.sidebar-link { transition: background-color var(--dur-1) ease, color var(--dur-1) ease,
                transform var(--dur-2) var(--ease-out-quart); }
.sidebar-link:active { transform: translateX(2px) scale(0.98); }
```

Nota: `height` en un pseudo-elemento de 3px NO causa reflow del layout circundante
(está en `position:absolute`), así que es seguro.

### B5. Tabs — subrayado que aparece con dirección

Las tabs actuales (`.tabs` segmented y las de subrayado tipo Almacén/Prime) sin JS no pueden
deslizar *entre* tabs, pero sí pueden crecer desde el centro (se lee como animado):

```css
.tabs .btn { transition: background-color var(--dur-1) ease, color var(--dur-1) ease; }

/* Tabs de subrayado (Almacén, Prime, ERP): clase .tab-underline en cada botón/tab */
.tab-underline { position: relative; }
.tab-underline::after {
  content: '';
  position: absolute; left: 12px; right: 12px; bottom: -1px;
  height: 2px; border-radius: 2px; background: var(--brand);
  transform: scaleX(0);
  transition: transform var(--dur-2) var(--ease-out-quart);
}
.tab-underline.activo::after, .tab-underline[data-active]::after { transform: scaleX(1); }

/* Subnav vertical (Finanzas): mismo indicador que el sidebar */
.subnav-item { position: relative; transition: background-color var(--dur-1) ease, color var(--dur-1) ease; }
.subnav-item::before {
  content: ''; position: absolute; left: -2px; top: 50%; width: 3px; height: 0;
  border-radius: 3px; background: var(--modulo-color, var(--brand));
  transform: translateY(-50%); opacity: 0;
  transition: height var(--dur-2) var(--ease-out-quart), opacity var(--dur-2) ease;
}
.subnav-item.activo::before { height: 16px; opacity: 1; }
```

### B6. Entrada de página — fade + rise sutil

Una sola clase en el contenedor de rutas. Como `<Outlet/>` remonta el componente por ruta,
la animación corre en cada navegación sin JS extra.

```css
@keyframes page-enter {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
.content > * { animation: page-enter var(--dur-3) var(--ease-out-quart) both; }
```

6px y 320ms es el rango Linear; más de 10px/400ms se siente "landing animada", menos se
pierde. Si alguna página pesada tartamudea, cambiar el selector a una clase opt-in
`.page-enter` — pero con solo transform/opacity no debería.

### B7. Modales y drawers

```css
@keyframes backdrop-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes modal-in {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}
.modal-backdrop { animation: backdrop-in var(--dur-2) ease both; }
.modal { animation: modal-in var(--dur-3) var(--ease-out-quart) both; }

/* Dropdowns (buscador global, bot-status): misma familia, más corto */
.buscador-drop, .bot-status-dropdown {
  animation: modal-in var(--dur-2) var(--ease-out-quart) both;
  transform-origin: top;
}
```

(La animación de *salida* requiere retrasar el unmount en JS — no vale el costo. Entrada
animada + salida instantánea es exactamente lo que hace Linear.)

### B8. Badges de estatus — transición de color

Cuando un pedido pasa de `generado` a `pagado` sin recargar, el badge debe fundir, no saltar:

```css
.badge { transition: background-color var(--dur-2) ease, color var(--dur-2) ease; }

/* Dot de alerta que respira — SOLO para estados que piden acción (rojo).
   Un pulse en todo dot devalúa la señal. */
@keyframes dot-breathe {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--red) 40%, transparent); }
  50%      { box-shadow: 0 0 0 4px transparent; }
}
.badge-rojo .badge-dot, .badge-offline .badge-dot { animation: dot-breathe 2s ease-in-out infinite; }
```

### B9. Focus-visible rings (global)

```css
:focus-visible {
  outline: none;
  box-shadow: var(--ring);
  border-radius: var(--radius);
}
.btn:focus-visible, .sidebar-link:focus-visible, .tabs .btn:focus-visible,
.subnav-item:focus-visible, .switch input:focus-visible + .switch-slider {
  outline: none;
  box-shadow: var(--ring);
}
input:focus-visible, select:focus-visible, textarea:focus-visible {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 12%, transparent);
}
/* input:focus actual pasa a transicionar también la sombra */
input, select, textarea { transition: border-color var(--dur-1) ease, box-shadow var(--dur-1) ease; }
```

### B10. POS — feedback táctil (`.pos-mode`)

```css
.pos-mode .mantine-Button-root, .pos-mode .btn {
  transition: transform var(--dur-1) var(--ease-spring), background-color var(--dur-1) ease;
}
.pos-mode .mantine-Button-root:active, .pos-mode .btn:active {
  transform: scale(0.94);           /* más agresivo que el admin: es touch */
}
/* El total "late" cuando cambia: poner key={total} en el nodo del total (remonta) o
   toggling de la clase al actualizar */
@keyframes pos-tick { 0% { transform: scale(1.04); } 100% { transform: none; } }
.pos-total.tick { animation: pos-tick var(--dur-2) var(--ease-out-quart); }
```

### B11. Toggles de módulos — confirmar el cambio

```css
.switch-slider { transition: background-color var(--dur-2) ease, border-color var(--dur-2) ease; }
.switch-slider::before { transition: transform var(--dur-2) var(--ease-spring); }
.switch input:checked + .switch-slider { background: var(--brand); border-color: var(--brand); }

/* Flash de la fila al guardar (opt-in: se agrega/quita la clase tras el PUT) */
@keyframes row-saved { from { background: var(--brand-soft); } to { background: transparent; } }
.toggle-row.saved { animation: row-saved 800ms ease both; }
```

Esto también arregla el hallazgo A7: el switch pasa del azul Mantine-stock a `--brand`.

### B12. Reduced motion — obligatorio, al FINAL del archivo

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Un solo bloque global cubre todo lo anterior (incluye `bot-pulse` y los skeletons de §C).
No hace falta repetirlo por componente.

---

## C. SKELETON LOADERS

**Dónde están los "Cargando..." de texto hoy** (grep real): Pedidos, Clientes, Devoluciones,
Ranking, Cupones, ColaEnvios (×3), ColaAtencion, ListaEspera, Busquedas, Beta, Guias,
Ofertas, Etiquetas, Preventas, Sustitutos, Modulos, Notificaciones (hilo de chat),
inicio/VistaOperador, VistaFinanzas, VistaAdmin (gráfica + tabla), prime/VariantesModal,
prime/BotEditorTab, erp/TableroTab, erp/FlujoCajaTab, erp/GastosImpuestosTab. ~26 puntos,
todos con el mismo patrón `rows === undefined && <... className="empty">Cargando...</...>`.

### CSS

```css
/* ── Skeleton shimmer ───────────────────────────────────────────────── */
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.skel {
  display: inline-block;
  height: 12px; width: 100%;
  border-radius: 6px;
  background: linear-gradient(90deg,
    var(--panel-2) 25%,
    color-mix(in srgb, var(--text) 6%, var(--panel-2)) 50%,
    var(--panel-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
.skel-row td .skel { width: 70%; }
.skel-row td:first-child .skel { width: 45%; }
.skel-block { height: 120px; border-radius: var(--radius); display: block; }
```

### Componente (uno, ~10 líneas — `dashboard-ui/src/components/Skeleton.jsx`)

```jsx
export function SkelRows({ cols, rows = 5 }) {
  return Array.from({ length: rows }, (_, i) => (
    <tr key={i} className="skel-row">
      {Array.from({ length: cols }, (_, j) => <td key={j}><span className="skel" /></td>)}
    </tr>
  ));
}
export function SkelBlock({ height = 120 }) {
  return <span className="skel skel-block" style={{ height }} />;
}
```

### Patrón de reemplazo (mecánico, mismo shape que el código actual)

```jsx
// antes
{rows === undefined && <tr><td colSpan={7} className="empty">Cargando...</td></tr>}
// después
{rows === undefined && <SkelRows cols={7} />}

// antes (no-tabla)
{!metodos && <div className="empty">Cargando...</div>}
// después
{!metodos && <SkelBlock height={160} />}
```

Prioridad de conversión: Pedidos, Clientes, Inicio (VistaAdmin/Operador/Finanzas) y los tabs
de ERP — son las pantallas que se abren cada día. El resto puede migrar oportunísticamente.

---

## D. REGLETA DE MÓDULO (§D5 de la propuesta — pendiente de aplicar)

### Mapa dominio → color (alineado a los grupos reales de `Layout.jsx`)

| Dominio (grupo sidebar) | Rutas | `--modulo-color` | soft |
|---|---|---|---|
| Panel | `/`, `/tareas` | `var(--brand)` `#1a4d3e` | `rgba(26,77,62,.08)` |
| Ventas | `/pedidos /devoluciones /mostrador /mesas /citas /fiados` | `var(--brand)` | idem |
| Envíos | `/guias /cola-envios` | `#0e7490` teal | `rgba(14,116,144,.08)` |
| Clientes y bot | `/cola /notificaciones /clientes /ranking /marketing` | `#0e8a4d` verde claro | `rgba(14,138,77,.08)` |
| Catálogo | `/catalogo` | `#a16207` ámbar | `rgba(161,98,7,.08)` |
| Almacén | `/almacen` | `#7c5314` ocre | `rgba(124,83,20,.08)` |
| Compras y finanzas | `/compras /erp /metricas /busquedas` | `#245a8f` azul | `rgba(36,90,143,.08)` |
| Personal | `/rrhh` | `#6b3fa0` morado | `rgba(107,63,160,.08)` |
| Ajustes | `/modulos /prime /beta` | `var(--text-mute)` gris | `rgba(107,115,133,.08)` |

### CSS final

```css
/* ── Regleta de módulo (§D5): orientación por color de dominio ─────── */
.content { border-top: 3px solid var(--modulo-color, transparent); }

[data-modulo="panel"]    { --modulo-color: var(--brand);  --modulo-soft: var(--brand-soft); }
[data-modulo="ventas"]   { --modulo-color: var(--brand);  --modulo-soft: var(--brand-soft); }
[data-modulo="envios"]   { --modulo-color: #0e7490;       --modulo-soft: rgba(14,116,144,.08); }
[data-modulo="clientes"] { --modulo-color: #0e8a4d;       --modulo-soft: rgba(14,138,77,.08); }
[data-modulo="catalogo"] { --modulo-color: #a16207;       --modulo-soft: rgba(161,98,7,.08); }
[data-modulo="almacen"]  { --modulo-color: #7c5314;       --modulo-soft: rgba(124,83,20,.08); }
[data-modulo="finanzas"] { --modulo-color: #245a8f;       --modulo-soft: rgba(36,90,143,.08); }
[data-modulo="personal"] { --modulo-color: #6b3fa0;       --modulo-soft: rgba(107,63,160,.08); }
[data-modulo="ajustes"]  { --modulo-color: var(--text-mute); --modulo-soft: rgba(107,115,133,.08); }

/* El link activo del sidebar hereda el color del dominio */
[data-modulo] .sidebar-link.active {
  background: var(--modulo-soft);
  color: var(--modulo-color);
}
[data-modulo] .sidebar-link.active::before { background: var(--modulo-color); }

/* Chip de icono junto al título (opt-in, cuando la página lo adopte) */
.page-icon {
  width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
  background: var(--modulo-soft); color: var(--modulo-color);
  display: grid; place-items: center;
}
```

### Aplicación con el MÍNIMO JSX: un solo cambio, en `Layout.jsx`

No tocar ninguna página. `Layout.jsx` ya calcula `grupoActivo` a partir de la ruta
(línea ~172); se reutiliza para poner `data-modulo` en el AppShell:

```jsx
// junto a GRUPOS, una vez:
const MODULO_DE_GRUPO = {
  'Panel': 'panel', 'Ventas': 'ventas', 'Envíos': 'envios',
  'Clientes y bot': 'clientes', 'Catálogo': 'catalogo', 'Almacén': 'almacen',
  'Compras y finanzas': 'finanzas', 'Personal': 'personal', 'Ajustes': 'ajustes',
};

// en el return (el data-attr en el wrapper cubre sidebar + contenido):
<AppShell ... data-modulo={MODULO_DE_GRUPO[grupoActivo] || 'panel'}>
```

Total: ~12 líneas de JSX en un archivo + el bloque CSS. La regleta (borde superior de 3px),
el tinte del link activo y las variables `--modulo-color/--modulo-soft` quedan disponibles
para cualquier página del dominio sin que la página sepa nada. El `.page-icon` se adopta
página por página cuando se quiera (no bloquea nada).

Nota `grupoActivo`: hoy matchea por `e.to === location.pathname`; rutas con querystring
(`/prime?tab=usuarios`) y subrutas caen al default — aceptable (Ajustes/Panel), no requiere
arreglo para que la regleta funcione.

---

## E. VEREDICTO DE DEPENDENCIAS

**No hace falta framer-motion. CSS cubre el 100% de este spec.** Razonamiento honesto:

- Todo lo de §B es transiciones/keyframes sobre transform+opacity — el caso exacto donde
  CSS nativo es superior: corre en el compositor, cero JS en el main thread, cero bundle.
- framer-motion (`motion`) son ~32–45 KB gz. Lo que compraría y NO está en este spec:
  animaciones de *salida* (AnimatePresence), layout animations FLIP (el pill del sidebar
  que literalmente viaja entre links, reordenamiento animado de listas), y springs físicos
  reales. Ninguna es necesaria para "dejar de verse plantilla"; todas son pulido de segunda
  ronda. Si en 3 meses el dueño pide "que la lista se reordene animada", se evalúa entonces
  — agregarla hoy es pagar bundle y una segunda forma de animar (CSS + JS conviviendo, dos
  sistemas que mantener) a cambio de nada visible.
- Micro-alternativa si algún día se quiere salida animada de modales: la web API nativa
  `element.animate()` + `finished` promise, cero deps.
- **View Transitions API**: Chrome/Electron la soporta (`document.startViewTransition`) y
  este producto corre en Electron — es el candidato natural para transición entre rutas
  *mejor* que framer-motion y con costo cero. Pero §B6 ya cubre la percepción; anotarla
  como mejora futura, no hacerla ahora.
- **Mantine**: no actualizar por motivos visuales. El proyecto usa Mantine 7/8 con
  AppShell/Accordion; las mejoras visuales de versiones nuevas son marginales y el riesgo
  de regresión del AppShell (offsets del navbar, ya causa de bugs pasados según los
  comentarios del CSS) supera cualquier beneficio. Los estilos que importan aquí los
  controla `styles.css`, no Mantine. Único toque a Mantine: tematizar el Switch azul
  (§B11 lo resuelve para el switch custom; si Módulos usa el `<Switch>` de Mantine,
  fijar `--switch-checked-bg: var(--brand)` o el prop `color` — 1 línea).
- **Tailwind**: ya está (utilities only); no interviene en este spec.

**Costo total del spec: 0 KB de bundle, ~250 líneas de CSS, ~25 líneas de JSX.**

---

## F. TOP 10 por impacto visual / esfuerzo

| # | Cambio | Impacto | Esfuerzo | Notas |
|---|---|---|---|---|
| 1 | **Skeleton loaders** (§C) en Pedidos/Clientes/Inicio/ERP | ★★★★★ | 2h | El marcador anti-plantilla más fuerte; patrón mecánico |
| 2 | **Entrada de página** fade+rise (§B6) | ★★★★★ | 10 min | 4 líneas; se siente en CADA navegación |
| 3 | **Tokens motion + botones pressed + inputs** (§B0, B3, B9) | ★★★★ | 30 min | Base de todo; mata el `transition: all` genérico |
| 4 | **Regleta de módulo** (§D) | ★★★★ | 1h | Firma visual del producto; screenshots de venta |
| 5 | **Sidebar: indicador + hover slide** (§B4) | ★★★★ | 20 min | La navegación se siente "de app" |
| 6 | **Switch a --brand + spring** (§B11) | ★★★★ | 15 min | El azul stock es el delator #1 en Módulos |
| 7 | **POS táctil** (§B10) | ★★★ | 20 min | Crítico para el giro retail/mostrador; scale 0.94 |
| 8 | **Modales/dropdowns animados** (§B7) | ★★★ | 15 min | Buscador global y bot-status incluidos |
| 9 | **Filas: hover transicionado + acciones reveladas** (§B2) | ★★★ | 30 min | Pedidos gana claridad; requiere clase en 1 td por tabla |
| 10 | **Tabs/subnav con indicador** (§B5) + badges en transición (§B8) | ★★ | 30 min | Cierra el sistema |

**Orden de ejecución sugerido**: 3 → 2 → 1 → 5 → 6 → 4 → 8 → 7 → 9 → 10.
El bloque `prefers-reduced-motion` (§B12) se pega junto con el paso 3 y ya cubre todo lo demás.
