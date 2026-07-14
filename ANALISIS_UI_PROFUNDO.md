# Análisis profundo de la interfaz (2026-07-13)

> Queja del dueño: "no está acomodada para ser intuitiva, se ve muy genérica,
> tenemos varias dependencias y no las aprovechamos al 100, no se ve
> profesionalmente hermosa". **El diagnóstico por evidencia le da la razón, y el
> root cause es uno solo con muchas caras: HAY DOS SISTEMAS DE DISEÑO PELEANDO.**

## Root cause: dos sistemas de diseño en paralelo

La UI nació como CSS artesanal (`styles.css`, ~20 páginas "legadas" según el
propio `fontPrefs.js`) y encima se fue montando Mantine. Hoy conviven **dos
fuentes de verdad que no se hablan**:

| Aspecto | Mantine theme (`main.jsx`) | styles.css (tokens propios) |
|---|---|---|
| Fuente cuerpo | Inter (self-hosted @fontsource) | system stack (`-apple-system, Segoe UI…`) |
| Fuente títulos | Poppins 600 | `--font-titulos` = system stack, con **comentario OBSOLETO** ("Poppins nunca cargaba" — ya sí carga vía @fontsource) |
| Radius | `defaultRadius: 'lg'` (~16px) | `--radius: 10px / --radius-lg: 14px` (comentario dice "16/24 = look template") — **esquinas distintas entre componentes vecinos** |
| Color primario | `primaryColor: 'dark'` → **botones negros genéricos** | `--brand: #2e8b6a` (verde firma) que Mantine **no conoce** |
| Sombras | las de Mantine | `--shadow` propia |

Resultado visual: cada pantalla es una mezcla de dos familias tipográficas, dos
radios, dos sombras y dos colores primarios. Eso ES el "se ve genérica": no hay
UNA identidad aplicada consistentemente. La marca verde existe en CSS pero los
botones Mantine salen negros (`primaryColor:'dark'`).

## Números duros (medidos en el código)

| Señal | Medición |
|---|---|
| Tablas HTML crudas vs Mantine Table | **35 vs 17** — densidad/hover/orden/sticky inconsistentes por página |
| "Cargando..." como texto plano vs Skeleton | **38 vs 3** — el 92% de las cargas se ven amateur |
| Colores hex hardcodeados en pages/*.jsx | **27** (fuera de todo token) |
| `@mantine/hooks` instalado | **0 usos** (debounce/hotkeys/mediaquery hechos a mano o ausentes) |
| `@mantine/form` | 4 usos (el resto: formularios a mano) |
| Botón Mantine vs `className="btn"` casero | 73 archivos vs 21 usos de la clase vieja |
| recharts | solo 4 archivos (Inicio SIN sparklines en KPIs) |
| Páginas en el sidebar | 34 páginas / 9 grupos — plano, sin jerarquía por frecuencia de uso |

## Dependencias desaprovechadas (lo que ya pagamos y no usamos)

1. **@mantine/hooks (0 usos)**: `useDebouncedValue` (búsquedas), `useHotkeys`
   (atajos), `useMediaQuery` (responsive en JS), `useLocalStorage` (preferencias
   — hoy hand-rolled en fontPrefs/ThemeSwitcher).
2. **Mantine theme al 10%**: no hay `colors.brand` (tupla de 10 tonos del verde
   firma), ni `components:{ Button:{ defaultProps... } }` para estandarizar, ni
   `shadows`/`radius` unificados con los tokens CSS.
3. **NO instalados y que resolverían quejas directas** (mismo vendor, cero
   fricción):
   - `@mantine/notifications` — reemplaza el toast-bus casero (`lib/ui.js`).
   - `@mantine/modals` — reemplaza `confirmar()`/`prompt()` caseros.
   - `@mantine/spotlight` — **búsqueda global Ctrl+K** (ir a página / cliente /
     folio / producto). LA feature que hace sentir "pro" a un ERP con 34 páginas.
   - `@mantine/dates` — DatePicker/rangos decentes (hoy `<input type="date">`).
4. **recharts**: sparklines en las tarjetas KPI del Inicio, mini-donut de aging,
   barras de venta por sucursal — hoy los KPIs son número plano.
5. **fuentes**: se cargan 4 familias @fontsource (Inter, Poppins, IBM Plex,
   Source Sans) = peso extra, pero el CSS legado ni las usa (system stack).
   Decidir UNA pareja (Inter + Poppins) y borrar las otras dos del bundle.

## Intuitividad / arquitectura de información

1. **Inicio no es un centro de mando**: KPIs planos sin acción. Un operador de
   POS y un contador ven casi lo mismo. Falta: accesos rápidos por ROL y por
   GIRO (barbería → "Citas de hoy"; abarrotes → "Cobrar", "Fiados vencidos"),
   y "continuar donde me quedé".
2. **Sidebar de 34 entradas**: sin favoritos, sin recientes, sin búsqueda de
   secciones (lo cubriría Spotlight). Los 9 grupos ayudan pero el usuario nuevo
   no sabe dónde vive "Corte de caja" (¿POS? ¿Finanzas?).
3. **Vocabulario técnico residual** en páginas viejas (folios/estatus crudos,
   badges sin leyenda).
4. **Estados vacíos pobres**: tablas vacías sin explicación ni CTA ("Aún no hay
   pedidos — comparte tu WhatsApp para recibir el primero").

## Plan de acción (fases, cada una committeable y con candado)

### F1 — UNA sola fuente de verdad de diseño (la fase que mata lo "genérico")
- `createTheme` completo en `main.jsx`: `colors.brand` (10 tonos del verde
  #2e8b6a), `primaryColor:'brand'`, `defaultRadius` = el de CSS (10/14),
  `shadows` y `headings` alineados.
- `styles.css`: tokens re-apuntados a los de Mantine (`var(--mantine-color-brand-6)`
  etc.) o viceversa — UNA tabla de tokens. Corregir el comentario/valor obsoleto
  de `--font-titulos` (que use Poppins self-hosted).
- Borrar 2 de las 4 familias @fontsource del bundle.
- Candado en CONVENCIONES_UI.md: "ningún hex nuevo en JSX; token o nada".
- Resultado visible: botones/acentos con la marca verde en TODO, esquinas y
  sombras idénticas Mantine↔CSS.

### F2 — Tabla estándar del ERP
- Componente `<TablaERP>` (Mantine Table: sticky header, hover, sort por
  columna, empty-state con CTA, skeleton de carga, densidad compacta).
- Migrar las 35 tablas crudas gradualmente (empezar por Pedidos/Clientes/
  Fiados/Almacén, las de más uso diario).

### F3 — Aprovechar el vendor (instalar los 4 paquetes hermanos)
- `@mantine/notifications` → sustituir toast-bus; `@mantine/modals` →
  sustituir confirmar()/prompt() caseros (borrar `lib/ui.js` al final).
- `@mantine/spotlight` → Ctrl+K global: páginas + clientes + folios + productos
  (endpoints de búsqueda ya existen).
- `@mantine/dates` → filtros de fecha/rango en reportes.
- `@mantine/hooks` → debounce en TODAS las búsquedas, hotkeys (F2 cobrar en
  POS, / buscar).

### F4 — Inicio como centro de mando por rol/giro
- Accesos rápidos según rol (cajero: Cobrar/Corte; finanzas: Conciliación/
  Impuestos) y giro (citas de hoy para barbería, mesas abiertas para restaurante).
- Sparklines recharts en los KPI (venta 7d, pedidos 7d) + aging mini-donut.
- "Pendientes que te tocan" (ya existe la campana agregadora — reutilizar su
  fuente de datos como lista accionable).

### F5 — Estados y micro-detalles pro
- Skeletons en vez de los 38 "Cargando..." (patrón único `<CargaTabla>`).
- Empty-states con ilustración ligera (SVG inline) + CTA.
- Transiciones de página (los tokens --dur/--ease YA existen, aplicarlos a
  la entrada de rutas), focus rings consistentes (--ring ya existe).
- Purga de los 27 hex hardcodeados → tokens.

### F6 — IA del sidebar
- Favoritos (pin) + "recientes" arriba; renombrar entradas según giro
  (vocabulario del negocio); contadores en vivo donde duelen (Fiados vencidos,
  Cola atención) — la infra de badges ya existe en la campana.

### Orden y tamaño
F1 (M, el 60% del efecto visual) → F3-spotlight+notifications (S-M, el efecto
"pro" más barato) → F2 (M, incremental) → F4 (M) → F5 (S, incremental) → F6 (S).

### Candados a formalizar en CONVENCIONES_UI.md al cerrar F1
1. Token o nada: ningún hex/px de radio/sombra nueva en JSX.
2. Tabla nueva = `<TablaERP>`, nunca `<table>` cruda.
3. Toast/confirm = Mantine notifications/modals, nunca el bus casero.
4. Carga = Skeleton, nunca texto "Cargando...".
5. Fecha = @mantine/dates, nunca `<input type="date">` en páginas nuevas.
