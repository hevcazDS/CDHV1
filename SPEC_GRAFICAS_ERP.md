# SPEC — Gráficas en el ERP (auditoría "texto que debería ser visual")

Contexto técnico: recharts **ya está instalado** y ya hay dos patrones probados que hay que reusar:

1. **Patrón lazy-chunk**: `GraficaSemana.jsx` se carga con `const GraficaSemana = lazy(() => import('../../components/GraficaSemana'))` + `<Suspense>` (ver `pages/inicio/VistaAdmin.jsx:11`). Así recharts vive en su propio chunk y NO engorda el bundle inicial. **Toda gráfica nueva sigue este patrón**: el componente que importa recharts va en un archivo aparte y se monta con `lazy()`.
2. **Patrón de estilo**: tooltip con `background: var(--panel)`, ejes sin `tickLine`/`axisLine`, grid solo horizontal (`vertical={false}`), colores por tokens CSS (ver `GraficaSemana.jsx:9-21`). Copiar tal cual.

Propuesta central: crear **un solo archivo nuevo** `dashboard-ui/src/components/MiniCharts.jsx` (lazy-cargado donde se use) que exporte 4 componentes chicos: `<Dona>`, `<BarrasH>` (barras horizontales), `<Sparkline>` y `<BarrasDivergentes>`. Todos los lotes de abajo se montan con esos 4 + `GraficaSemana` existente. Cero librerías nuevas, cero backend nuevo salvo lo marcado ⚠️.

---

## A. Crítica página por página

### 1. Finanzas → Tablero de dirección (`pages/erp/TableroTab.jsx`, captura `10_erp.png`)
La página más "de dirección" del sistema es 100 % tablas de texto:
- **Estado de resultados** (líneas 66-72): Ventas → COGS → U. bruta → Gastos → U. operativa como 5 filas de tabla. La *estructura* del P&L (de cuánto vendido cuánto queda) es exactamente lo que una cascada/barras muestra de un vistazo y una tabla no.
- **Comparativo vs período anterior** (líneas 74-81): "▲ +816.25%" como texto inline. Un delta sin barra de referencia no comunica magnitud.
- **Aging de CxC** (líneas 131-137): 4 filas `0-30 / 31-60 / 61-90 / 90+`. La pregunta del dueño es "¿qué proporción de mi cartera está podrida?" — eso es proporción, no lista.
- **Margen por categoría** (líneas 146-164): tabla con % coloreado. Comparar magnitudes entre categorías leyendo números es lo que peor hace el ojo; comparar largos de barra es lo que mejor hace.
- **Punto de equilibrio** (líneas 82-96): "ventas para no perder" vs "ventas del período" vs holgura — es la definición de libro de un **bullet chart**.
- **Ticket promedio** (118-127): actual vs anterior como dos filas. Menor prioridad (son solo 2 números, el texto casi basta).

### 2. Finanzas → Flujo de caja (`pages/erp/FlujoCajaTab.jsx`)
- **Proyección hoy/30/60/90** (líneas 29-34): 4 KPI cards sueltas. Es una *serie temporal* de 4 puntos — la trayectoria (¿voy hacia arriba o me quedo sin caja en 60d?) solo se ve conectando los puntos.
- **Entra vs Sale por bucket de vencimiento** (líneas 36-61): tabla 3×6. El neto por bucket (fila 3) es la señal crítica y está enterrada en la última fila. Barras divergentes (entra arriba en verde, sale abajo en rojo) por bucket lo hace evidente.
- **Salud financiera** (63-76): 6 números sueltos (CCC, razón corriente…). Aceptable como texto; ver sección D.

### 3. Finanzas → Gastos e impuestos (`pages/erp/GastosImpuestosTab.jsx`)
- **Impuestos del período** (líneas 67-83): IVA trasladado vs acreditable como tabla. Dos barras enfrentadas + el resultado (por pagar/a favor) es más honesto que 5 filas.
- **Gastos registrados** (86-107): lista plana por fecha. Falta la vista "¿en qué se me va el dinero?" — hoy no hay agrupación por concepto ni tendencia mensual. Con los mismos campos (`fecha`, `concepto`, `total` de `GET /api/erp/gastos`) se puede agrupar client-side.

### 4. Finanzas → Ventas por producto (`pages/erp/VentasProductoTab.jsx`)
- Tabla producto/SKU/unidades/total (líneas 47-62) sin ningún "top". El 80/20 (¿qué 5 productos son la mitad de mi venta?) exige escanear y sumar mentalmente. Un top-10 en barras horizontales encima de la tabla lo resuelve.

### 5. Finanzas → Rentabilidad por cliente (`pages/erp/RentabilidadClientesTab.jsx`)
- Igual: tabla ordenada por margen (correcto) pero sin visual del "20 % que da el 80 %" que su propio comentario de código promete (línea 9). Top-10 clientes por margen en barras H, con la barra en rojo si `margen < 0`.

### 6. Inicio (`pages/inicio/VistaAdmin.jsx`, captura `04_inicio_estable.png`)
- Ya tiene `GraficaSemana` (bien) y anillos decorativos en los KPI. Pero los 6 KPI (`ventas`, `pedidos`, `chats`…) son números sin contexto temporal: "$0.00 hoy" no dice si eso es normal o una catástrofe. Un **sparkline de 7 días** bajo el número da el contexto. Datos: `met.por_dia` de `/api/metricas` **ya está cargado en esta misma vista** (línea 26) — pedidos y monto por día, cero fetch extra. (Chats/clientes por día no existen por día → esos KPI quedan sin sparkline, no inventar.)
- El toggle `123`/`%` (líneas 90-93) ya intenta dar contexto en texto ("% del prom. diario") — el sparkline lo hace sin que el usuario tenga que apretar nada.

### 7. Mostrador → Corte de caja (`pages/Mostrador.jsx` `CorteCaja`, captura `10_mostrador.png`)
- **Ventas por método de pago** (líneas 314-322): tabla método/n/total. La pregunta del corte es "¿cómo se repartió el día?" — proporción pura → **dona** con el total al centro. `GET /api/pos/corte` ya devuelve `por_metodo: [{metodo, n, total}]` y `total_sistema`.
- **Diferencia contado vs esperado** (328-332): el color ya lo resuelve; no graficar (2 números).

### 8. Compras → Resumen (`pages/compras/ResumenComprasTab.jsx`)
- 4 KPI de conteo (OC abiertas, vencidas, por vencer, solicitudes). Los conteos están bien como número, pero **CxP por vencimiento** merece la misma visual que el aging de CxC: hoy "vencidas=2, por vencer=3" no dice *cuánto dinero*. Con `cxp[]` ya cargado (campos `monto`, `dias_para_vencer`, `estatus`) se agrupan client-side los buckets vencido / esta semana / 8-30d / 30+ → mini barras.

### 9. Almacén → Resumen (`pages/almacen/ResumenAlmacenTab.jsx`, captura `10_almacen.png`)
- KPI "119 agotados / 41 críticos / 181 sin ubicar" — números correctos como alerta. Lo que falta es la **composición del inventario vigilado**: agotado (rojo) / crítico (amarillo) / sano (verde) como una sola barra apilada 100 %. Todo sale de `inv[]` ya cargado (`stock`, `stock_minimo`).
- La tabla "Urge resurtir" se queda como tabla (es una lista de acción, ver D).

### 10. Pedidos (`10_pedidos.png`) y Tareas, Clientes, Módulos, Prime
- Son páginas **operativas/CRUD**: listas de trabajo, no de análisis. No meter gráficas (ver D).

---

## B. Especificación por candidato

Formato: **qué** → tipo de gráfica · regla de percepción · datos (ya existentes) · dónde se monta.

### B1. P&L en cascada horizontal — Tablero ⭐
- **Tipo**: barras horizontales tipo cascada (recharts `BarChart layout="vertical"` con barras flotantes: cada fila `[base, base+valor]`): Ventas (completa, `--brand`) → COGS (rojo, arranca donde termina) → U. bruta → Gastos (rojo) → U. operativa (verde/rojo según signo).
- **Por qué**: el P&L es descomposición de un total; la posición/longitud sobre eje común es el canal perceptual más preciso (Cleveland-McGill). La cascada muestra "de cada peso vendido, cuánto se comió cada cosa".
- **Datos**: `GET /api/erp/tablero` → `pyl.{ingresos, cogs, utilidad_bruta, gastos, utilidad_operativa}`. Ya en el componente.
- **Monta en**: `TableroTab.jsx`, card "Estado de resultados", **arriba** de la tabla actual (la tabla se queda: cifras exactas). Componente `<CascadaPyL>` dentro de `MiniCharts.jsx`, altura ~150.

### B2. Comparativo período vs anterior — Tablero ⭐
- **Tipo**: barras agrupadas de 2 pares (Ventas act/ant, Utilidad act/ant), período actual en `--brand`, anterior en `--panel-2` (gris, como hace `GraficaSemana` con los días no-máximos).
- **Por qué**: un % de variación sin las magnitudes engaña (+816 % sobre casi-cero); dos barras lado a lado dan magnitud Y variación.
- **Datos**: `pyl.ingresos`/`pyl.utilidad_operativa` + `comparativo.{ingresos, utilidad_operativa, var_ingresos_pct, var_utilidad_pct}` (mismo endpoint, ver `erpContabilidad.js:195-199`).
- **Monta en**: `TableroTab.jsx`, reemplaza la línea de texto "vs período anterior" (líneas 74-81); el % vive en el tooltip y como etiqueta sobre la barra actual.

### B3. Aging de CxC — Tablero ⭐
- **Tipo**: **una barra apilada 100 % horizontal** con 4 segmentos: `0-30` = `--green`, `31-60` = `--info`, `61-90` = `--yellow`, `90+` = `--red`. Debajo, la tabla actual con montos exactos.
- **Por qué**: aging es proporción de un total (¿qué % de mi cartera está vencida?); parte-de-todo con pocas categorías ordenadas → barra apilada, no dona (el orden temporal importa).
- **Datos**: `aging` = `{'0-30': n, '31-60': n, '61-90': n, '90+': n}` (mismo endpoint).
- **Monta en**: `TableroTab.jsx` card "Antigüedad de cuentas por cobrar", encima de la tabla. Componente `<BarraApilada>` (variante de `BarrasDivergentes` o propio, ~40 px de alto).

### B4. Punto de equilibrio — Tablero
- **Tipo**: **bullet chart** (una barra: ventas del período; una marca vertical: `ventas_equilibrio`; zona a la izquierda de la marca teñida `rgba(var(--red),0.08)`).
- **Por qué**: "medida vs meta" es el caso canónico del bullet; la holgura se VE como distancia entre punta de barra y marca.
- **Datos**: `punto_equilibrio.{ventas_equilibrio, ventas_periodo, holgura}` (mismo endpoint).
- **Monta en**: `TableroTab.jsx`, dentro del bloque `pe` (líneas 82-96), reemplaza la mini-tabla; el texto de gastos fijos/margen de contribución se queda como caption.

### B5. Margen por categoría — Tablero ⭐
- **Tipo**: barras horizontales dobles por categoría (ventas en `--panel-2` de fondo, margen encima en `--brand`; margen negativo en `--red`), top 8, ordenadas por ventas. El `margen_pct` como etiqueta al final de la barra.
- **Por qué**: comparación de magnitud entre categorías → longitud en eje común; superponer margen sobre ventas muestra "vendo mucho pero gano poco" (el caso Puleva) sin leer dos columnas.
- **Datos**: `categorias[] = {categoria, ventas, margen, margen_pct}` (mismo endpoint, ya limitado a 20).
- **Monta en**: `TableroTab.jsx` card "Margen por categoría": gráfica arriba (top 8), la tabla scrolleable actual debajo para el detalle completo. Componente `<BarrasH>`.

### B6. Proyección de caja — Flujo de caja ⭐
- **Tipo**: **área con gradiente** de 4 puntos (Hoy → 30d → 60d → 90d), línea `--brand`, relleno degradado; si algún punto < 0, ese tramo del área en `--red` y línea de cero punteada (`ReferenceLine y={0}`).
- **Por qué**: trayectoria en el tiempo → posición sobre eje común conectada; "cruzo el cero en el día X" es la alerta #1 de una pyme y en 4 cards sueltas no se ve.
- **Datos**: `GET /api/erp/flujo-caja` → `proyeccion.{hoy, en_30d, en_60d, en_90d}`.
- **Monta en**: `FlujoCajaTab.jsx`, reemplaza (o corona) el `<Group>` de 4 `<Proy>` (líneas 29-34): gráfica de área ~160 px arriba, los 4 números como etiquetas sobre cada punto o mini-cards debajo.

### B7. Entra vs Sale por vencimiento — Flujo de caja
- **Tipo**: **barras divergentes** por bucket (vencido, 0-30, 31-60, 61+, sin fecha): por cobrar hacia arriba (`--green`), por pagar hacia abajo (`--red`), punto/rombo con el neto.
- **Por qué**: dos series con signo opuesto sobre las mismas categorías; la asimetría por bucket (me pagan después de que debo pagar) salta a la vista.
- **Datos**: `por_cobrar` y `por_pagar` (`{vencido, d0_30, d31_60, d61mas, sin_fecha, total}`, mismo endpoint, ver `erpContabilidad.js:320-335`).
- **Monta en**: `FlujoCajaTab.jsx`, card "Por cobrar vs por pagar", encima de la tabla (tabla se queda). Componente `<BarrasDivergentes>`.

### B8. Corte de caja por método — Mostrador ⭐
- **Tipo**: **dona** con `total_sistema` formateado al centro; un segmento por método (efectivo `--brand`, tarjeta `--info`, transferencia `--green`, resto paleta muted). Leyenda al lado con método + monto (sustituye leyenda de recharts por la tabla existente, que ya es la leyenda perfecta).
- **Por qué**: parte-de-todo con 2-5 categorías sin orden intrínseco → dona; el centro aprovecha el hueco para el dato que el cajero busca primero (total del día).
- **Datos**: `GET /api/pos/corte?fecha=` → `por_metodo[{metodo, n, total}]`, `total_sistema`. Ya cargados en `CorteCaja`.
- **Monta en**: `Mostrador.jsx` función `CorteCaja` (línea ~314): dona a la izquierda (~140 px), tabla actual a la derecha como leyenda/detalle. Ojo: `Mostrador.jsx` es página lazy pero recharts NO debe entrar a su chunk para el flujo de venta — la dona solo se monta cuando `mostrarCorte` es true, y `MiniCharts` se importa con `lazy()` dentro de `CorteCaja`, así el escaneo de códigos de barras nunca paga el peso.

### B9. Sparklines en KPIs de Inicio — VistaAdmin ⭐
- **Tipo**: **sparkline** (LineChart/AreaChart desnudo: sin ejes, sin grid, sin tooltip o tooltip mínimo, ~36 px alto, ancho de la card) bajo el número de las cards "Ventas cobradas hoy" y "Pedidos de hoy".
- **Por qué**: un número de "hoy" sin historia no es señal; el sparkline (Tufte) da tendencia en el espacio de una palabra. Solo para los 2 KPI que tienen serie diaria real.
- **Datos**: `met.por_dia` de `GET /api/metricas`, ya consumido en la misma vista (`VistaAdmin.jsx:26,41` vía `diasSemana()` → `[{label, n, t}]`): `n` para pedidos, `t` para ventas. Cero backend.
- **Monta en**: `pages/inicio/VistaAdmin.jsx`, dentro de las 2 primeras cards del `kpi-grid6` (líneas 95-100). En la card oscura (`kpi-dark`) el trazo va `rgba(255,255,255,0.6)`. Componente `<Sparkline>` lazy (mismo `Suspense` que ya envuelve la vista o uno propio con fallback `null`).
- Réplica barata en `VistaFinanzas.jsx` (misma estructura, ya carga `GraficaSemana`).

### B10. Top productos — Ventas por producto
- **Tipo**: barras horizontales top 10 por `total`, con etiqueta de unidades; barra acumulada opcional NO (chartjunk).
- **Por qué**: ranking → longitud; el nombre del producto necesita espacio horizontal (por eso H, no V).
- **Datos**: `GET /api/erp/productos-vendidos` → `filas[{producto, sku, unidades, total}]` (ya viene ordenado por total).
- **Monta en**: `VentasProductoTab.jsx`, entre el total (línea 46) y la tabla. `<BarrasH datos={filas.slice(0,10)}>`.

### B11. Top clientes por margen — Rentabilidad por cliente
- **Tipo**: barras H top 10 por `margen`; barra `--red` si margen negativo; badge rojo con `adeudo_fiado` si > 0.
- **Por qué**: mismo principio de ranking; el margen negativo en rojo convierte la gráfica en lista de decisiones (a quién dejar de fiar).
- **Datos**: `GET /api/erp/rentabilidad-clientes` → `clientes[{nombre, ventas, margen, margen_pct, adeudo_fiado}]`.
- **Monta en**: `RentabilidadClientesTab.jsx` encima de la tabla. Mismo `<BarrasH>` de B10. (Idéntico patrón sirve para `RentabilidadVendedoresTab.jsx` gratis.)

### B12. IVA trasladado vs acreditable — Gastos e impuestos
- **Tipo**: 2 barras horizontales enfrentadas (trasladado `--red` tenue, acreditable `--green` tenue) + el resultado como texto grande (ya existe).
- **Datos**: `GET /api/erp/impuestos` → `{iva_trasladado, iva_acreditable, iva_resultado}`.
- **Monta en**: `GastosImpuestosTab.jsx` card "Impuestos del periodo", arriba de la tabla. Prioridad baja (la tabla ya es corta).

### B13. Gastos por concepto — Gastos e impuestos
- **Tipo**: barras H top 8 agrupando client-side `gastos[]` por `concepto` normalizado (`replace(/^Gasto: /,'')`, lowercase). ⚠️ Sin normalización semántica ("luz" ≠ "Luz CFE") la agrupación es aproximada — aceptable y se marca con caption "agrupado por concepto tal como se capturó".
- **Datos**: `GET /api/erp/gastos` → `[{fecha, concepto, total}]`. Cero backend.
- **Monta en**: `GastosImpuestosTab.jsx`, card "Gastos registrados", encima de la tabla.

### B14. Composición inventario vigilado — Resumen Almacén
- **Tipo**: **una barra apilada 100 %** (agotado `--red` / crítico `--yellow` / sano `--green`) sobre los productos con `stock_minimo > 0`, con conteos como etiqueta.
- **Datos**: `inv[]` ya cargado en `ResumenAlmacenTab.jsx` (líneas 22-24 ya calculan los 3 grupos).
- **Monta en**: `ResumenAlmacenTab.jsx`, entre la fila de KPIs y las 2 cards. Reusa `<BarraApilada>` de B3.

### B15. CxP por vencimiento (monto) — Resumen Compras
- **Tipo**: mini barras H de 4 buckets (vencida / ≤7d / 8-30d / >30d) con **montos** (no conteos), vencida en `--red`.
- **Datos**: `cxp[]` ya cargado (`monto`, `dias_para_vencer`); bucketing client-side de 4 líneas.
- **Monta en**: `ResumenComprasTab.jsx`, dentro de la card "Próximos pagos a proveedor", arriba de la tabla. Reusa `<BarrasH>`.

---

## C. Reglas de visualización del sistema (6)

1. **La gráfica resume, la tabla responde**: toda gráfica que agregue se monta *encima* de la tabla existente, nunca la sustituye si la tabla tiene acción (botón, link) o cifras exactas auditables. Excepción: KPI-cards redundantes que la gráfica absorbe (B6).
2. **Colores solo por tokens y solo semánticos**: `--green` = entra dinero/sano, `--red` = sale dinero/vencido/negativo, `--yellow` = por vencer/crítico, `--brand`/`--accent` = la serie principal del negocio, `--info` = serie secundaria neutra, `--panel-2` = comparativo/fondo (patrón ya usado en `GraficaSemana.jsx:35`). Nunca hex inline: los 4 temas (claro/oscuro/confort) ya redefinen los tokens.
3. **Dinero siempre es-MX en tooltip**: un solo formateador compartido — reusar `money()` de `lib/format.js` / `fmtMoneda` de `pages/inicio/comunes.jsx` pasado por prop (como ya hace `GraficaSemana`). Tooltip con el estilo exacto de `GraficaSemana.jsx:14-21` (panel, borde, radio 10, fontSize 12).
4. **Sparklines desnudos**: sin ejes, sin grid, sin leyenda, sin puntos (solo el último, r=3); altura ≤ 40 px; si toda la serie es 0, no renderizar (un electro plano es ruido).
5. **≤ 8 categorías por gráfica**: top-N + nada de "otros" fantasma salvo que "otros" sea > 15 % del total. Dona solo con 2-5 segmentos; de 6+ → barras H.
6. **Cero estados de carga aparatosos**: fallback de `Suspense` = `null` o el texto plano existente; una gráfica que parpadea vale menos que una tabla estable. Y toda gráfica va en chunk lazy (patrón `VistaAdmin.jsx:11`) — regla dura: **ningún `import ... from 'recharts'` fuera de archivos cargados con `lazy()`**.

## D. Qué NO graficar

- **Pedidos, Tareas, Clientes, Cola, Guías** (`10_pedidos.png`): tablas de trabajo con acciones por fila. El usuario viene a *hacer*, no a *analizar*. Una gráfica ahí es decoración que roba espacio a la fila 8.
- **"Urge resurtir" y "Mercancía por llegar"** (Almacén): listas de acción con identidad (¿QUÉ producto, en QUÉ sucursal?). La gráfica agrega; aquí la identidad es el dato.
- **Salud financiera** (`FlujoCajaTab.jsx:63-76`): 6 ratios escalares sin serie histórica en el backend. Un gauge por ratio sería chartjunk clásico (mucho pixel, un número). El color condicional que ya tienen (rojo si CCC>45, etc.) es la visualización correcta. ⚠️ Si algún día se persiste el histórico mensual de ratios, ahí sí: sparklines.
- **Balance general** (Tablero): 3 números que deben *cuadrar* — la igualdad contable se verifica leyendo, y el badge "Cuadra/Descuadre" ya lo resume. Una dona de activos/pasivos/capital confunde (capital no es "parte" en el mismo sentido).
- **Ticket promedio, diferencia de corte, KPIs de conteo** (2 números): el texto con delta coloreado gana; una gráfica de 2 barras es pompa.
- **Métricas del bot** (`Metricas.jsx`): ya tiene sus gráficas; no tocar en este esfuerzo.

## E. Plan por lotes

**Lote 0 (previo, ~2 h)**: crear `dashboard-ui/src/components/MiniCharts.jsx` con `<Dona>`, `<BarrasH>`, `<Sparkline>`, `<BarraApilada>`, `<BarrasDivergentes>` (todos ~30 líneas c/u, mismo estilo de tooltip/ejes de `GraficaSemana`). Un solo archivo = un solo chunk recharts compartido con el de `GraficaSemana` (vite ya agrupa vendor).

**Lote 1 — máximo impacto / mínimo esfuerzo (~1 día)**
| Pieza | Ref | Esfuerzo |
|---|---|---|
| Sparklines en 2 KPI de Inicio (datos ya en memoria) | B9 | 1-2 h |
| Dona corte de caja en Mostrador | B8 | 1-2 h |
| Aging CxC barra apilada (Tablero) | B3 | 1 h |
| Área proyección de caja 4 puntos | B6 | 2 h |

**Lote 2 — tablero de dirección completo (~1-1.5 días)**
| Pieza | Ref | Esfuerzo |
|---|---|---|
| Cascada P&L | B1 | 3-4 h (la barra flotante es lo único no-trivial) |
| Comparativo período (2 pares de barras) | B2 | 1 h |
| Margen por categoría barras H | B5 | 1-2 h |
| Bullet punto de equilibrio | B4 | 2 h |
| Barras divergentes entra/sale (Flujo) | B7 | 2 h |

**Lote 3 — rankings y resúmenes (~1 día)**
| Pieza | Ref | Esfuerzo |
|---|---|---|
| Top productos (BarrasH, reuso directo) | B10 | 1 h |
| Top clientes por margen (+ vendedores gratis) | B11 | 1-2 h |
| Composición inventario (BarraApilada, reuso) | B14 | 1 h |
| CxP por monto en Resumen Compras | B15 | 1 h |
| IVA enfrentado + gastos por concepto | B12/B13 | 2 h |

Total estimado: ~4 días de trabajo efectivo, **cero endpoints nuevos**, 1 archivo de componentes nuevo, y todos los cambios son aditivos (las tablas actuales se conservan como detalle/auditoría).
