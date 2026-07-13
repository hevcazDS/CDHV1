# Convenciones de UI — la base que TODA hoja nueva debe usar

> El candado para que el panel no vuelva a divergir. El sistema visual vive en
> `dashboard-ui/src/styles.css` (variables + clases). El JSX **usa esas clases**;
> NO reinventa layouts/colores/radios con `style` inline. Regla de oro: si vas a
> escribir un `style={{...}}` con grid/color/radio, primero busca la clase.

## 1. Layout de página
- Página normal: `<div className="page-title">` + `<div className="page-sub">` arriba, contenido abajo.
- Inicio / dashboards de rol: `.pagina-llena` (llena el alto, la gráfica prioriza y hace scroll en pantallas bajas).

## 2. Rejillas responsivas (NO grids fijos inline)
| Necesito | Clase | Se repliega |
|---|---|---|
| Formulario + contenido (2 col) | `.split-2` (1fr 1.5fr) | → 1 col < 1000px |
| Formulario angosto + contenido ancho | `.split-2w` (1fr 2fr) | → 1 col < 1000px |
| Fila gráfica + tabla | `.fila-2col` | → 1 col < 1000px |
| Tarjetas KPI (n variable) | `.kpi-grid` (auto-fit) | wrap automático |
| Exactamente 6 KPIs cuadrados | `.kpi-grid6` | 6 → 3 → 2 |
- ❌ NUNCA `style={{ gridTemplateColumns: '1fr 1.4fr' }}` inline (no tiene `@media`, se aplasta en navegador). Ese fue el bug replicado en ~35 páginas.

## 3. Pestañas
- Usa **Mantine `<Tabs>`** (`<Tabs><Tabs.List><Tabs.Tab>`). El CSS global ya las estiliza como **grupo de píldoras** (activo con la tinta del producto) y las envuelve. Almacén, Compras, RRHH, Prime y **Finanzas** ya son horizontales/píldoras.
- ❌ No inventes un tercer estilo de tabs ni uses el subrayado default. La clase `.subnav` vertical queda solo para casos legacy; lo nuevo es horizontal.

## 4. Tarjetas
- `<Card withBorder radius="md" p="lg" className="card">` para tarjetas de contenido. `.card` fija fondo/borde/radio del look ERP (`--radius-lg`, 24px de padding).
- KPIs: `<Card ... className="kpi-card kpi-sq">` (+ `kpi-dark` para la héroe, + `kpi-clic` si es clickeable → micro-elevación en hover).
- Encabezado de card: `<div className="card-header"><h3>…</h3></div>` (o `<Title order={4}>`, ya unificado a `var(--font-titulos)`).

## 5. Colores, radios, tipografía → SIEMPRE variables
- Colores de estado: `var(--green)`, `var(--red)`, `var(--yellow)`, `var(--info)`, `var(--accent)`, `var(--accent-2)`. ❌ Nada de `#4aa8ff`/`#b16cea`/`#000` literales (rompen en tema Color/Confort/Oscuro).
- Radios: `var(--radius)` (10px) / `var(--radius-lg)` (14px). ❌ Nada de `borderRadius: 6/8` a mano (sub-cajas disímiles).
- Badges de estado: clases `.badge .badge-verde/-rojo/-amarillo/-azul` (no `background`+`color` inline).
- Avisos/banners: `.banner-alerta` (no divs con estilos inline por página).

## 6. Iconos del riel (sidebar colapsado)
- Cada grupo de `GRUPOS` (`Layout.jsx`) DEBE tener su entrada en `ICONO_CATEGORIA` con la **clave EXACTA del título** y un icono distinto. Si agregas un grupo, agrega su icono (o cae al fallback Home y se ve duplicado).

## 7. Motion / accesibilidad
- Solo transiciones de `transform/opacity/box-shadow/color/border` (el CSS ya cubre `prefers-reduced-motion`). Hover de tarjeta = elevación 1px + sombra mínima (no sombra dura).
- `ActionIcon` solo-icono: además de `title=`, pon `aria-label=` con el mismo texto.

## 8. Responsividad web (el panel corre en navegador, no solo Electron)
- El sidebar se auto-colapsa a riel < 1000px. Toda página debe verse bien de ~768px en adelante: usa las clases responsivas de §2, tablas dentro de `.table-wrap` (scroll-x), y no fuerces anchos fijos.

## 9. Rutas del backend (dashboard/routes/*.js)
- Handler POST/PUT que lee un body JSON: usa **`ctx.readJson(req, res, d => { ... })`** (lee body + parsea + try/catch; body inválido → 400, error → 500). ❌ No repitas el boilerplate `readBody(req, body => { try { const d = JSON.parse(body||'{}') … } catch(e){ json(…500) } })`.
- Cada ruta declara su gate explícito (`area`/`areas`/`roles`/`pin`) en el arreglo `RUTAS` de su módulo (`_construirModulo`). Nada sin gate salvo diseño (flota).
- Validación de payload: `ctx.validar(d, Schema, res, ruta)` (Zod) para los POST con esquema.
- Nombres de archivo en `Content-Disposition`: saneados (`replace(/[^0-9-]/g,'')` para periodos, `_slug` para folios) — nunca interpolar input crudo.

---
**En una línea:** clase antes que `style` inline; variable antes que literal; Mantine `<Tabs>` para pestañas; `.split-2`/`.kpi-grid` para columnas; `readJson` para bodies. Así cada hoja nueva nace con la misma base.
