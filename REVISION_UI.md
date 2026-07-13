# Revisión UI — Dashboard ERP (React + Vite + Mantine)

Revisión de front senior sobre `dashboard-ui/`. Cero cambios de código; solo hallazgos con evidencia `archivo:línea`, problema y fix concreto. Ordenados por impacto. **QW** = quick win (1-2 líneas).

Contexto ya resuelto (NO re-reportado): colapso de sidebar a riel, apilado de `.fila-2col`, KPIs 6→3→2, hover de tarjetas, retiro de la franja "Requiere tu acción".

---

## ALTO

### 1. Rejillas de 2 columnas inline SIN `@media` — se rompen en navegador angosto
**Evidencia:** ~30 sitios con `style={{ display:'grid', gridTemplateColumns:'1fr 1.4fr' }}` (o similar) sin punto de quiebre. Ej.: `erp/ContabilidadTab.jsx:64`, `erp/GastosImpuestosTab.jsx:46` (3 col), `erp/ProveedoresTab.jsx:27`, `erp/TableroTab.jsx:66`, `Rrhh.jsx:79,275`, `Compras.jsx:52`, `Citas.jsx:64`, `Mesas.jsx:71`, `Suscripciones.jsx:65`, `Documentos.jsx:71`, `Mostrador.jsx:167`.

El fix de responsividad solo tocó `.fila-2col` (styles.css:458). Todas estas otras rejillas quedan a columnas fijas: en una ventana angosta la columna izquierda (formulario/lista) se comprime a ~120px y el texto/inputs se aplastan. Es el mismo bug que ya se arregló, pero replicado a mano en cada página.

**Fix:** una clase utilitaria en `styles.css` que reemplace el inline. Todas estas rejillas son "panel lateral + contenido":
```css
/* Rejilla lado-a-lado que apila en angosto (reemplaza los gridTemplateColumns inline) */
.split-2 { display: grid; grid-template-columns: 1fr 1.4fr; gap: 20px; align-items: start; }
.split-2.izq  { grid-template-columns: 1fr 1.6fr; }
@media (max-width: 900px) { .split-2, .split-2.izq { grid-template-columns: 1fr; } }
```
Luego `<div className="split-2">` en lugar del `style` inline. Impacto alto porque afecta a casi todo el módulo ERP/Compras/RRHH en web.

### 2. KPI-grids con `gridTemplateColumns` fijo inline que pisa el responsive de `.kpi-grid`
**Evidencia:** `Metricas.jsx:124,150,417` (`repeat(4,1fr)`), `compras/ResumenComprasTab.jsx:34` (`repeat(4,1fr)`), `inicio/VistaOperador.jsx:26` (`repeat(5,1fr)` sobre `.kpi-grid6`), `inicio/VistaEspecialista.jsx:116` (`repeat(4,1fr)` sobre `.kpi-grid6`), `Clientes.jsx:46` (`repeat(3,1fr)`).

`.kpi-grid` (styles.css:446) YA es responsivo (`auto-fit minmax(210px,1fr)`), y `.kpi-grid6` tiene sus `@media` (472-473). Pero estas páginas lo **sobrescriben** con un número fijo de columnas via inline, anulando el repliegue. En ventana angosta se aplastan 4-5 KPIs en una fila igual que el bug ya arreglado en Inicio.

**Fix (QW por archivo):** quitar el `style={{ gridTemplateColumns: 'repeat(4,1fr)' }}` y dejar solo `className="kpi-grid"` (que ya reparte responsivamente). Si se necesita forzar 4 en pantalla ancha, añadir un `.kpi-grid-4` con su `@media` en el CSS en vez del inline.

### 3. Doble estilado de tarjeta: `<Card className="card">` aplica padding dos veces
**Evidencia:** 74 ocurrencias de `Card withBorder ... className="card"` (grep en `pages/`). Ej. `erp/ContabilidadTab.jsx:65,90`, `inicio/VistaAdmin.jsx:119,143`, `Mostrador.jsx:277,344`.

Mantine `<Card p="lg">` ya pone su padding; la clase `.card` (styles.css:188) añade **otro** `padding: 24px` + su propio `background/border`. Cuando ambos coexisten el resultado depende de especificidad y varía: unas cards llevan `p="lg"`, otras `p="md"`, otras solo `.card`, otras `withBorder` + `.card` (borde duplicado). Es la causa raíz de que el padding de las tarjetas se sienta ligeramente distinto entre páginas.

**Fix:** elegir UNA fuente de verdad. Recomendado: dejar que Mantine `Card` maneje fondo/borde/padding y **eliminar** `className="card"` de los `<Card>` (mantener `.card` solo para los `<div className="card">` que NO son Mantine). Alternativa mínima: definir `.card` para que no re-declare padding cuando ya hay `.mantine-Card-root`. Es refactor amplio pero es el origen real de la inconsistencia de densidad entre páginas.

### 4. Tres paradigmas de navegación por pestañas distintos conviviendo
**Evidencia:**
- `Erp.jsx:54-67` y `Compras`/`ComprasModulo` → sub-nav vertical `.subnav` (patrón Zoho).
- `Almacen.jsx:39-41`, `Prime.jsx`, `Rrhh.jsx` → Mantine `<Tabs>` horizontales.
- Clase CSS propia `.tabs` (styles.css:666) → botones-pill en un tercer estilo.

Tres módulos hermanos del mismo nivel (Finanzas / Almacén / Compras / RRHH) presentan sus secciones con tres controles visualmente distintos. Rompe la sensación de "un solo producto" y es lo que más delata "ensamblado por partes".

**Fix:** unificar. Dado que Finanzas ya migró a `.subnav` vertical por tener muchas secciones, y Almacén también tiene 7+ tabs, moverlos al mismo `.modulo-layout`/`.subnav`. Como mínimo (QW): que Almacén/RRHH usen el mismo componente de tabs que el resto en lugar de Mantine `<Tabs>` crudo. No es 1-2 líneas, pero es el hallazgo de consistencia de mayor impacto visual.

---

## MEDIO

### 5. Títulos de tarjeta partidos entre `<h3>` y `<Title order={4}>`
**Evidencia:** patrón `.card-header h3` (styles.css:578) usado en `inicio/VistaAdmin.jsx:145,161`, `erp/ContabilidadTab.jsx:67,91`; vs `<Title order={4}>` de Mantine en `Pedidos.jsx:149`, `Mostrador.jsx:169,225`, `Metricas` y casi todos los tabs.

Dos tipografías/tamaños para el mismo rol (encabezado de card): `.card-header h3` es 15px `var(--font-titulos)`; `Title order={4}` de Mantine rinde ~18px con su propia familia/peso. Se nota al comparar Inicio (h3) con Pedidos (Title).

**Fix:** estandarizar en uno. Como `.card-header h3` ya está tuneado al look ERP (15px, font-titulos), preferirlo y envolver siempre en `.card-header`; o forzar `Title order={4}` vía CSS a 15px/font-titulos. QW parcial: añadir en CSS `.mantine-Card-root .mantine-Title-root { font-family: var(--font-titulos); }` para al menos unificar familia.

### 6. Colores de estado hardcodeados en vez de variables (rompe temas)
**Evidencia:** `Pedidos.jsx:174` `background:'var(--yellow)', color:'#000'` (chip "fiado"); `color:'#4aa8ff'` en `VistaAdmin.jsx:98`, `color:'#b16cea'` en `:109`; 10 `color:'#hex'` literales en `pages/` (grep). Además `Mostrador.jsx:161` usa `rgba(251,189,35,0.15)` a mano en vez de `var(--yellow)`.

Estos literales no cambian con `data-tema="color"`/`data-confort`/dark. En modo Confort (oscuro cálido) o Color, un `#4aa8ff`/`#b16cea`/`#000` queda fuera de paleta y con contraste dudoso. El CSS ya define `--yellow/--info/--accent-2` por tema; el JSX los ignora.

**Fix (QW):** sustituir por las variables existentes — `#4aa8ff`→`var(--info)`, `#b16cea`→`var(--accent-2)`, el chip fiado a `.badge-amarillo` (ya existe, styles.css:659) en vez de `background:var(--yellow);color:#000`.

### 7. Banda amarilla de "inventario desactivado" (Mostrador) fuera del sistema de badges
**Evidencia:** `Mostrador.jsx:160-164` — `div` con `background:rgba(251,189,35,0.15)`, `border:1px solid var(--yellow)`, radio y padding a mano. Mismo patrón repetido con estilos inline distintos en `ContabilidadTab`/otros para avisos.

Hay varios "banners de aviso" hechos ad-hoc con inline styles ligeramente diferentes (radio 8 aquí, 6 allá, colores a mano). El CSS ya tiene `.banner-alerta` (styles.css:481) para exactamente esto.

**Fix:** crear una variante `.banner-aviso` (amarilla) hermana de `.banner-alerta` y reusarla, en vez de inline por página. Unifica radio/tipografía/color de todos los avisos.

### 8. Radios hardcodeados (`borderRadius: 6/8`) en vez de `var(--radius)`
**Evidencia:** 54 ocurrencias de `borderRadius: <número>` (grep). Ej. `Mostrador.jsx` (varios `borderRadius:6` y `8`), `Pedidos.jsx:252` (`borderRadius:6`), `Notificaciones.jsx` (8 casos). El sistema define `--radius:10px` y `--radius-lg:14px` (styles.css:28-29) precisamente para evitar esto.

Cajas internas con radios 6/8 conviven con cards a 10/14 → esquinas visiblemente disímiles dentro de una misma vista.

**Fix (QW por sitio):** `borderRadius: 6/8` → `borderRadius: 'var(--radius)'`. O extraer las "sub-cajas punteadas" repetidas (`border:1px dashed var(--border); borderRadius:6; padding:10`) que aparecen 4× en `Mostrador.jsx:244,250,256` a una clase `.subcaja`.

### 9. Densidad de tabla ERP: celdas de "Partidas" multi-línea sin límite ni scroll horizontal en móvil
**Evidencia:** `erp/ContabilidadTab.jsx:101-105` — columna "Partidas" renderiza N `<div>` apilados por asiento; con muchos apuntes la fila crece mucho. Las tablas ERP están en `.table-wrap` (scroll-x ✓) pero el diario mete detalle vertical en una celda, mezclando dos densidades.

**Fix:** menor. Es aceptable, pero para jerarquía: mostrar solo resumen (nº partidas + total) y expandir el detalle en modal/acordeón, coherente con lo que ya hace `almacen/InventarioTab.jsx` (expansión por sucursal). No urgente.

---

## BAJO

### 10. `ActionIcon` usa `title=` (tooltip nativo) pero no `aria-label` — accesibilidad
**Evidencia:** `Pedidos.jsx:184-208` — cada `ActionIcon` tiene `title="..."` pero ningún `aria-label`. Son botones solo-icono; un lector de pantalla anuncia "botón" sin nombre (title no siempre se expone como nombre accesible en todos los AT).

**Fix (QW):** añadir `aria-label` con el mismo texto del `title` en los `ActionIcon` solo-icono. Patrón repetido en Mostrador/tabs.

### 11. Sombra "flotante" del tema Color contradice la decisión ERP
**Evidencia:** `styles.css:100` (`--shadow: 0 10px 30px ...`) y `:106-108` — el tema Color reintroduce la sombra difusa de 28-30px que el tema claro deliberadamente quitó (comentario en styles.css:75-76: "la sombra flotante de 28px era estética de landing SaaS"). Con `border-color: transparent` las cards del tema Color solo se definen por sombra grande → look "template SaaS" que el default rechaza.

**Fix:** bajar la sombra del tema Color a la escala del default (`0 1px 2px + 0 4px 12px`) y devolver un borde tenue. Coherencia entre temas.

### 12. `swap-kpi` (#/%) y `PuntosGrafica` (dots) son controles de estilo distinto para la misma idea
**Evidencia:** `VistaAdmin.jsx:87-90` usa `.swap-kpi` (pills con texto "123"/"%"); la selección de modo de gráfica usa `.dots` (styles.css:489, puntitos). Ambos son "toggle de vista" a 10px del mismo bloque, con dos lenguajes visuales.

**Fix:** menor/cosmético. Unificar a un solo segmented-control (Mantine `SegmentedControl` o `.tabs` pill) para ambos toggles del tablero. Baja prioridad.

---

## Sólido (ya está bien, no tocar)

- **Sistema de motion (styles.css:699-838)**: coherente, restringido a transform/opacity, con `prefers-reduced-motion` que cubre todo (882). Focus-visible estilo anillo (B9, 815-823) bien resuelto en botones/inputs/sidebar.
- **Variables de tema y `--brand` white-label**: bien pensado que `--brand` sea la firma del producto y esté definida en todos los temas (comentario 18-22). `tabular-nums` en dinero/KPIs (43-46) es correcto para ERP.
- **Regleta de color por módulo** (`[data-modulo]`, 857-877): buena orientación visual sin ruido; el indicador lateral del sidebar/subnav que crece (B4/B5) es un detalle fino.
- **Skeletons shimmer** (840-855) en lugar de "Cargando…" — bien; aunque nótese que varias tablas todavía usan el texto (`VistaAdmin.jsx:171` "Cargando...", `ContabilidadTab` no) → oportunidad menor de migrar a `SkelRows`, ya usado en `Pedidos.jsx:165`.
- **KPIs cuadrados responsivos** (`.kpi-grid6` + `.kpi-sq`, 468-476) y card héroe `.kpi-dark` con la tinta del producto: jerarquía clara en Inicio.

---

### Resumen de prioridad
1. Rejillas 2-col inline sin `@media` (#1) y KPI-grids fijos (#2) — es el **mismo bug ya arreglado en `.fila-2col`, replicado a mano** en ~35 páginas. Mayor riesgo de romperse en navegador angosto.
2. Doble estilado `<Card className="card">` (#3) y tres estilos de tabs (#4) — origen real de la inconsistencia de densidad/navegación entre módulos.
3. El resto (colores/radios hardcodeados #6/#8, banners ad-hoc #7) son quick wins que se pueden barrer con find-replace guiado por las variables que YA existen.
