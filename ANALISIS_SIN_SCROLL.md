# Viabilidad: UI 100% sin scroll de página (2026-07-14)

> Pedido del dueño: que el área de trabajo + menú lateral SIEMPRE quepan en el
> viewport (sin scroll de página); scroll SOLO INTERNO en secciones de listas/
> reportes grandes (inventarios, pedidos, kardex). Análisis por agente.

## Veredicto: PARCIALMENTE VIABLE — sí se puede, con trabajo por grupos
El **70% del patrón ya existe**: `html/body/#root height:100%`, `.content` a
`100dvh` flex-column, `.pagina-llena` (Inicio ya funciona así), `.tabla-compacta`
y `.table-wrap` con scroll interno. Falta generalizarlo a las otras ~33 páginas.

## Patrón a generalizar
```css
.page { flex:1; display:flex; flex-direction:column; min-height:0; }
.page-head { flex-shrink:0; }               /* título/filtros nunca scrollean */
.page-scrollable { flex:1; min-height:0; overflow:auto; }  /* SOLO aquí scrollea */
```
Altura útil real: 1366×768 → **664px** (584px para la lista tras el head);
1920×1080 → 976px. Regla de oro: **probar en 1366×768 religiosamente**.

## Clasificación (34 páginas)
- **A. Ya funciona (1):** Inicio (usar de modelo).
- **B. Tablas simples (19) — FÁCIL (~20min c/u):** Pedidos, Clientes, Compras,
  Devoluciones, Guías, ColaAtencion, ColaEnvios, Fiados, Documentos,
  Suscripciones, Cupones, Etiquetas, Preventas, Sustitutos, Ranking, Búsquedas,
  Mesas, Citas(lista), módulos-raíz. Envolver la tabla en `.page-scrollable`.
- **C. Sub-módulos con tabs (Almacén 7 tabs, Compras, Catálogo, Marketing) —
  MODERADO:** scroll POR TAB (cada tab con su `.page-scrollable`), reset de
  scroll al cambiar de tab.
- **D. Módulos complejos (Prime 7 tabs, Erp, Rrhh) — RIESGO ALTO:** formularios
  largos (GeneralTab ~650px de contenido vs 664px disponibles en laptop) →
  scroll por tab obligatorio, o agrupar secciones en Accordion.
- **E. Especiales — CRÍTICO:** Mostrador (POS de altura variable: necesita
  scroll propio del carrito, no de página), Métricas (4 gráficas apiladas
  >1200px → gráfica principal fija + resto scrolleable), Notificaciones (chat +
  listas: scroll independiente por sección — el hilo ya lo tiene), Tareas
  (kanban no cabe → scroll horizontal propio).

## Esfuerzo estimado
| Fase | Qué | Tiempo |
|---|---|---|
| 1 | CSS global + 19 tablas simples | ~1 día |
| 2 | Sub-módulos con tabs | 4-6h |
| 3 | Prime/Erp/Rrhh (scroll por tab) | 1-2 días |
| 4 | Especiales (POS/Métricas/Notif/Kanban) | 1-2 días |
| **Total** | | **~4-6 días** |

## Riesgos principales
1. **Formularios largos en 768px de alto** (Prime GeneralTab ≈ todo el alto
   disponible) → Accordion por sección o aceptar scroll interno del tab.
2. **Contenido dinámico** (chat, carrito POS) → scroll individual por sección.
3. **Gráficas apiladas en Métricas** → principal fija + resto scrolleable.
4. **Tabs anidados**: el scroll debe vivir DENTRO del tab y resetearse al cambiar.
5. Nada que perder en <1000px: el colapso del sidebar ya existe.

## Recomendación
Hacerlo por fases DESPUÉS de terminar la migración visual F (para no re-tocar
las mismas páginas dos veces): al migrar cada página al patrón F, se le aplica
`.page/.page-scrollable` en el mismo pase. Fase 1+2 dan el 80% de la sensación
"app de escritorio" con el 40% del esfuerzo.
