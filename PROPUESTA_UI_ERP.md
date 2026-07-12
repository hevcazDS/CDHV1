# PROPUESTA UI/UX — Reorganización del ERP (bothHS)

Auditoría basada en screenshots reales del dashboard vivo (scratchpad/shots), `Layout.jsx`, las 29 páginas de `dashboard-ui/src/pages/`, los 12 tabs de `pages/erp/`, los 8 tabs de `pages/prime/`, los 6 de `pages/almacen/`, `lib/permisos.js` y `styles.css`.

Queja del dueño a resolver: **"se ve a medias, con unas cosas aquí y otras por otro lado, herramientas incompletas; diseño genérico de plantilla"**.

---

## A. DIAGNÓSTICO — por qué se siente "a medias y desperdigado"

### A1. El sidebar promete poco y las tabs esconden mucho (inversión de jerarquía)

El problema #1 es de **arquitectura de información**: el peso funcional del producto NO está donde el ojo navega.

| Entrada del sidebar | Lo que realmente contiene | Percepción |
|---|---|---|
| "Finanzas" (1 link, `/erp`) | **12 tabs**: Tablero de dirección, Flujo de caja, Proveedores, Órdenes de compra, CxP, Contabilidad, Gastos e impuestos, Ventas por producto, Rentabilidad ×2, Facturación, Rastro (`Erp.jsx`) | El módulo más "ERP" del producto se ve como una pagina más. En el screenshot `10_erp.png` los 12 tabs se parten en **dos renglones** de texto plano — parece menú de comida, no un módulo financiero. |
| "Configuración" (1 link, `/prime`) | **8 tabs**, y 4 de ellas son OPERACIÓN, no configuración: **Sucursales, Inventario, Catálogo** (¡el alta de productos!), Usuarios (`Prime.jsx`) | El screenshot `10_prime.png` lo confirma: la página se titula "Gestión — Sucursales, inventario y catálogo"… pero vive bajo el grupo "Configuración" con icono de estrella. Nadie que quiera dar de alta un producto miraría ahí. |
| "Almacén" (1 link) | 6 tabs: Inventario/ubicaciones, Calendario, Reportes, Conteo físico, Traslados/Salidas/Entradas, Kardex (`Almacen.jsx`) | Aceptable como agrupación, pero el label del tab "Traslados / Salidas / Entradas" delata que son 3 herramientas apretadas en una. |

**Consecuencia medible**: el sidebar muestra ~24 links, pero el producto tiene **~50 superficies funcionales**. La mitad del ERP es invisible hasta que caes por accidente en la página correcta. Eso ES la sensación de "a medias": el usuario ve 12 tabs desnudos sin KPI, sin icono, sin estado, y concluye "esto está incompleto", aunque detrás haya CxP con vencimientos y pólizas contables.

### A2. Duplicidad Compras (verificada en código)

- Sidebar → "Compras y finanzas" tiene DOS links: `/erp` ("Finanzas") y `/compras` ("Compras").
- `/compras` (`Compras.jsx`) = solicitudes de adquisición + captura de facturas CFDI/manual → CxP.
- `/erp` tab "Órdenes de compra" (`erp/ComprasTab.jsx`) = las OC reales.
- La propia página lo confiesa en su subtítulo (línea 40 de `Compras.jsx`): *"las órdenes de compra están en ERP → Órdenes de compra"*. **Cuando una página necesita un letrero explicando dónde está su otra mitad, la IA está rota.** El ciclo compra-a-pago (solicitud → OC → recepción → factura → CxP → pago) está partido en 2 páginas y 3 tabs de otra página.

Otras duplicidades/fragmentaciones del mismo tipo:
- **Inventario ×2**: `prime/InventarioTab.jsx` (bajo "Configuración") y `almacen/InventarioTab.jsx` (bajo "Catálogo e inventario"). Dos vistas del mismo dominio en dos ramas distintas del árbol.
- **Entrada de mercancía ×3**: 📥 en Prime→Catálogo (`entrada-mercancia`), Almacén→Movimientos, y Compras→factura XML "cargar al inventario".
- **Usuarios ×2 rutas**: `/prime?tab=usuarios` como link propio + dentro de `/prime`. Funciona, pero refuerza que "Configuración" es un cajón de sastre.

### A3. Hueco de flujo: dar de alta un producto (el caso ácido)

Camino real del dueño hoy: **Sidebar → grupo "Configuración" (último de 11 grupos, hay que scrollear) → link "Configuración" ⭐ → tab "Catálogo" (4º tab) → formulario.** Son 3-4 clics, y los dos primeros son **contraintuitivos** (nada en "Configuración" sugiere "producto"). El grupo "Catálogo e inventario" del sidebar existe… pero NO contiene el catálogo: contiene Almacén, Productos relacionados y Etiquetas. Es el hueco más doloroso del árbol: el grupo que se llama "Catálogo" no tiene el catálogo.

### A4. Páginas que parecen herramienta a medias (evidencia en screenshots)

- **`10_erp.png` (Proveedores)**: formulario "Nuevo proveedor" ocupando el 40% izquierdo **permanentemente**, tabla vacía "Sin proveedores todavía" a la derecha, y 60% de la pantalla en blanco abajo. Patrón "form-junto-a-tabla" repetido en media app: hace que TODAS las páginas parezcan CRUD de tutorial. Un ERP profesional pone la tabla a lo ancho y el alta en un botón "+ Nuevo" → modal/drawer (ya existe `components/Modal.jsx`).
- **`10_tareas.png`**: formulario gigante arriba, tabla "Sin pendientes 🎉" abajo, ~70% de pantalla vacía. Sin agrupación por fecha (hoy/vencidas/próximas), sin checkbox de completar visible en la fila. Se lee como demo.
- **`10_mostrador.png`**: el POS — la pantalla que más horas verá un cajero — tiene tipografía y densidad de página admin cualquiera. "Corte de caja (global)" pegado abajo en la misma vista de cobro (el corte es un evento de fin de turno, no debe convivir con el cobro). Sin botones de monto rápido ($50/$100/$200/exacto), sin grid de productos frecuentes. Compárese con Square/Loyverse: el POS es una superficie táctil de botones grandes, no un formulario.
- **`10_clientes.png`**: filas con nombre "-", teléfonos crudos de 14 dígitos, columna TAGS vacía, sin foto/inicial, sin LTV ni #pedidos. Es un `SELECT *`, no un CRM. No hay ficha de cliente (drill-down) — el dato existe (pedidos, puntos, fiados) pero no hay dónde verlo junto.
- **`04_inicio_estable.png`**: 6 KPI cards + 4 mini-cards + gráfica; decente, pero "$0.00 Ventas cobradas hoy" como card héroe negra transmite "muerto". Un buen home muestra la acción pendiente (7 esperando atención, 35 pendientes) ANTES que un cero.
- **`10_modulos.png`**: la columna derecha "Estado de módulos" lista claves crudas (`puntos_activo`, `pago_link_activo`…) en monoespaciada — jerga interna visible al dueño. Redundante con los toggles de la izquierda: se percibe como panel de debug olvidado.
- **`10_almacen.png`**: tabla repite "4D Rompecabezas Bulbasaur" 9 veces (una por sucursal) — falta agrupar por producto con expansión por sucursal, o un selector de sucursal arriba (hay multitienda pero la UI no tiene **contexto de sucursal global**).

### A5. Sin migas ni "dónde estoy"

Al entrar a `/prime` el título dice "Gestión", el sidebar resalta "Configuración", y el tab activo dice "Sucursales". Tres nombres distintos para el mismo lugar. No hay breadcrumb (`Finanzas → Cuentas por pagar`), y los 12 tabs de ERP no son deep-linkeables por URL (solo localStorage `erp-tab`), así que no se puede mandar un link "revisa CxP" a un empleado.

### A6. Lo que SÍ está bien (no tocar)

- Sidebar operación-primero con orden idéntico por rol (comentario en `Layout.jsx:22-27`) — filosofía correcta, es la ejecución del agrupamiento lo que falla.
- Poda por rol/área/módulo ya funciona (`permite()`, `moduloRequerido`) — la reorganización la reutiliza tal cual.
- Home por rol ya existe (`pages/inicio/Vista{Admin,Cajero,Operador,Finanzas,Especialista}.jsx`) — hay que enriquecerlo, no crearlo.
- BuscadorGlobal en topbar — semilla del command palette.
- Riel colapsable con flyouts — patrón moderno, se conserva.

---

## B. BENCHMARK — cómo lo resuelven los grandes y qué adoptar

| Producto | Patrón clave | Aplicable aquí |
|---|---|---|
| **Odoo** | "Apps" como módulos con **home propio** (cada app abre en su overview con KPIs y accesos); el usuario instala solo las apps de su giro | Sí — es exactamente el modelo para Finanzas/Almacén/Compras (ver B1) |
| **SAP Business One** | Módulos por **ciclo de negocio** (Compras-A/P, Ventas-A/R, Inventario, Finanzas), no por tipo de pantalla; drill-down universal (todo documento linkea a su origen) | Sí — reunificar el ciclo de compras; el RastroTab ya es el embrión del drill-down |
| **Zoho Inventory/Books** | Sidebar de **7-9 entradas máximo**, cada una con sub-navegación interna; "Getting Started" checklist por módulo vacío | Sí — empty states accionables (ver B4) |
| **Square/Loyverse POS** | El POS es una **superficie aparte** (táctil, botones grandes, sin chrome de admin); el back-office es otro mundo visual | Sí — Mostrador merece layout propio (ver B6) |
| **NetSuite** | Dashboard por rol como página de inicio ("Role Center") con portlets de SU trabajo | Ya medio existe (`pages/inicio/`), falta convertirlo en centro de acción |

### Los 7 patrones a adoptar (sin dependencias nuevas, sin romper nada)

1. **Módulo con home propio (patrón Odoo)**: `/erp`, `/almacen` y el nuevo `/catalogo` abren en un **tab "Resumen"** — 3-5 KPIs + accesos directos a sus sub-secciones + pendientes (CxP por vencer, stock crítico, OC abiertas). Costo: un `ResumenTab.jsx` por módulo reutilizando los endpoints de stats que ya existen (TableroTab ya es 80% de esto para finanzas — se renombra "Resumen" y pasa a ser el tab default).
2. **Sub-navegación lateral dentro del módulo, no tabs desbordados**: cuando un módulo pasa de ~6 secciones (ERP: 12), las tabs horizontales en 2 renglones se cambian por una **lista vertical de secciones agrupadas** dentro de la página (patrón Zoho/Stripe: "REPORTES ▸ Ventas por producto / Rentabilidad…"). Es CSS + el mismo array `TABS`, cero dependencias.
3. **Tabs con URL** (`/erp?tab=cxp` como ya hace `/prime?tab=usuarios`): deep-links compartibles + breadcrumb barato (`page-title` pasa a "Finanzas · Cuentas por pagar"). Cambio de 5 líneas por página contenedora (`useSearchParams` en vez de `localStorage`).
4. **Empty states accionables (patrón Zoho)**: "Sin proveedores todavía" → "Sin proveedores todavía · [+ Registrar el primero] · o súbelos desde una factura XML en Compras". Cada tabla vacía dice **qué hacer y dónde**. Es el antídoto directo a "se ve a medias".
5. **Command palette sobre BuscadorGlobal**: el buscador del topbar ya existe; se le agrega modo comando (Ctrl+K, prefijo ">") que navega a páginas/acciones ("nueva orden de compra", "corte de caja") además de buscar entidades. Registro estático de rutas + `useNavigate` — sin librería.
6. **POS como superficie propia (patrón Square)**: `/mostrador` con clase `pos-mode` — tipografía 1.25×, botones ≥48px, grid de productos frecuentes, montos rápidos, y el corte de caja movido a un tab/botón "Cerrar turno". Solo CSS + reorganizar `Mostrador.jsx`.
7. **Alta en modal/drawer, tabla a lo ancho**: matar el patrón "formulario permanente junto a tabla" en Proveedores, Tareas, Sucursales, etc. — botón "+ Nuevo" abre `Modal.jsx`. La tabla (el trabajo real) recupera el 100% del ancho.

Descartados a propósito: mega-menú tipo SAP (overkill para pyme), apps instalables de Odoo (ya lo cubren los módulos toggleables de `Modulos.jsx`), breadcrumbs multinivel reales (con "Módulo · Sección" en el título basta — la app solo tiene 2 niveles).

---

## C. REORGANIZACIÓN PROPUESTA — nuevo mapa de navegación

Principio: **el sidebar nombra dominios de negocio (7-9 grupos); cada dominio pesado es UNA página-módulo con Resumen + secciones**. La poda por rol/módulo/giro se queda en el mecanismo actual de `Layout.jsx` (`area`/`areas`/`moduloRequerido`/`rolRequerido`) — solo cambian los grupos y destinos.

```
📍 Panel
   ├─ Inicio                        (home por rol, ya existe pages/inicio/)
   └─ Tareas                        (rediseño: lista primero, alta en modal)

🧾 Ventas                           ← renombra "Mostrador"+"Pedidos y atención"
   ├─ Mostrador (POS)               pos_activo · superficie pos-mode
   ├─ Mesas                         mesas_activo (solo restaurante)
   ├─ Citas                         citas_activo (barbería/estética/servicios)
   ├─ Pedidos                       (absorbe como tabs: Guías, Cola de envíos —
   │                                 hoy grupo "Envíos", jerga de paquetería que
   │                                 una barbería no debe ver: gated por
   │                                 entrega_paqueteria_activo igual que hoy)
   ├─ Devoluciones
   └─ Fiados                        ventas_credito_activo

💬 Clientes y bot                   ← fusiona "Clientes" + chat
   ├─ Cola de atención
   ├─ Chat y mensajes
   ├─ Clientes                      (+ ficha de cliente drill-down, Ola 3)
   ├─ Ranking / Lealtad
   └─ Marketing                     ← fusiona Ofertas + Cupones + Lista de
                                      espera + Preventas como tabs de UNA
                                      página (hoy 4 links en 2 grupos)

📦 Catálogo                         ← NUEVO grupo; resuelve A3
   ├─ Productos                     ← PROMOCIÓN: prime/CatalogoTab sale de
   │                                  "Configuración" y se vuelve página
   │                                  (alta/edición/variantes/entrada 📥)
   ├─ Etiquetas
   └─ Productos relacionados        (tab dentro de Productos, no página)

🏬 Almacén                          (igual, con tab Resumen nuevo)
   ├─ Resumen                       stock crítico · pendientes de conteo
   ├─ Inventario y ubicaciones      (+ selector de sucursal arriba)
   ├─ Movimientos                   (Traslados/Salidas/Entradas, sub-tabs)
   ├─ Conteo físico
   ├─ Calendario
   └─ Kardex / Reportes             (gerente+/auditor, igual que hoy)
   ※ prime/InventarioTab se ELIMINA del árbol de Configuración
     (redirige aquí; una sola casa para inventario)

🛒 Compras                          ← FUSIÓN Compras.jsx + 3 tabs de Erp.jsx:
   ├─ Resumen                       OC abiertas · CxP por vencer · solicitudes
   ├─ Solicitudes                   (de Compras.jsx)
   ├─ Órdenes de compra             (de erp/ComprasTab.jsx)
   ├─ Recepción y facturas          (XML CFDI + manual, de Compras.jsx)
   ├─ Cuentas por pagar             (de erp/CxpTab.jsx)
   └─ Proveedores                   (de erp/ProveedoresTab.jsx)
   → el ciclo compra-a-pago completo en UNA página; muere el letrero de A2.
   → rol `compras` ve exactamente esto y nada más (ya lo hace `areas`).

🏦 Finanzas                         (Erp.jsx queda con 9 secciones, en
   ├─ Resumen                        sub-nav vertical agrupada, patrón B2)
   ├─ Flujo de caja
   ├─ Contabilidad
   ├─ Gastos e impuestos
   ├─ Facturación pendiente
   ├─ REPORTES ▸ Ventas por producto · Rentabilidad cliente ·
   │             Rentabilidad vendedor · Rastro de documento
   └─ (Métricas y Búsquedas del grupo "Reportes" pueden vivir aquí o
      quedarse como grupo aparte "Reportes" — recomendado: moverlas a
      Finanzas ▸ REPORTES y matar un grupo más)

👥 Personal
   └─ Recursos Humanos              rrhh_activo

⚙️ Ajustes                          ← "Configuración" purgada de operación
   ├─ Negocio                       (prime/GeneralTab: identidad, giro, pagos)
   ├─ Sucursales                    (prime/SucursalesTab — es setup, se queda)
   ├─ Usuarios y roles              (prime/UsuariosTab)
   ├─ Módulos                       (Modulos.jsx; columna "Estado de módulos"
   │                                 con claves crudas → se elimina o pasa a Beta)
   ├─ Bot                           (BotEditorTab + tono + FiltrosTab + DatosLLM)
   └─ Beta / Pruebas                prime
```

**Neto**: de 11 grupos / ~24 links → **9 grupos / ~20 destinos**, pero con las ~50 superficies TODAS alcanzables con nombre de negocio visible. Nada se borra: `Erp.jsx`, `Compras.jsx` y `Prime.jsx` son contenedores delgados — mover un tab de contenedor es mover un import y una entrada de array.

### Adaptación por giro (poda automática, mecanismo actual)

| Giro | Ve | No ve |
|---|---|---|
| Juguetería/retail (JC) | Todo lo de hoy — **byte-idéntico en capacidades** | — |
| Barbería/estética/uñas | Ventas (Citas, Mostrador), Clientes, Catálogo (servicios), Finanzas | Envíos/Guías (entrega_paqueteria off), Almacén-Kardex, Preventas |
| Restaurante | Mesas, Mostrador, Pedidos | Guías, Lista de espera |
| Abarrotes/carnicería | Mostrador, Fiados, Almacén, Compras | Citas, Mesas, Guías (según config) |

Regla nueva a agregar: los grupos "Envíos"(→tabs de Pedidos), Mesas, Citas ya están gated por módulo — solo falta que el **preset del giro apague los módulos** que no aplican en el onboarding (los datos ya existen en `_giros.js`; hoy el onboarding no los aprovecha para módulos).

### Home por rol (enriquecer `pages/inicio/`)

- **prime/gerente (VistaAdmin)**: fila de "requiere tu acción" arriba (esperando atención, solicitudes de compra pendientes, CxP por vencer, stock crítico) ANTES de los KPIs; el KPI héroe cambia a la métrica con dato (no "$0.00" negro).
- **cajero (VistaCajero)**: botonzote "Abrir Mostrador" + su corte del día + fiados por cobrar.
- **operador (VistaOperador)**: cola de atención embebida + pedidos por confirmar + tareas asignadas.
- **contabilidad (VistaFinanzas)**: flujo de caja de la semana + CxP próximas + accesos a pólizas.
- **almacén/compras (VistaEspecialista)**: stock crítico / OC por recibir + sus tareas.

---

## D. IDENTIDAD VISUAL — de "plantilla admin" a producto

El tema light actual (gris `#eceef1` + blanco + acento negro `#1d1f24`) es limpio pero **anónimo**: es la paleta default de cualquier template Tailwind de 2024. Sin tipografía display (CSP sin Google Fonts), la identidad debe salir de: **un color de firma, numerales tabulares, densidad disciplinada y UN elemento gráfico propio**.

### D1. Paleta — monocromo + una tinta de firma

Mantener el canvas gris/blanco (es correcto para uso de 8h), pero introducir **una tinta "editorial" profunda** que sea del PRODUCTO (white-label: no es el color del cliente, es la firma del ERP — como el morado Odoo o el azul SAP). Propuesta: **verde-tinta oscuro** (serio, financiero, distinto del azul-admin genérico y del negro actual):

```css
:root, [data-mantine-color-scheme="light"] {
  /* firma del producto (no del cliente) */
  --brand:        #1a4d3e;   /* tinta verde bosque — headers de módulo, active states, KPI héroe */
  --brand-soft:   rgba(26, 77, 62, 0.08);
  --brand-ink:    #0e2b22;   /* hover/pressed */
  /* el acento negro actual pasa a ser SOLO texto/bordes, no "color de marca" */
  --accent:       var(--brand);
  --accent-soft:  var(--brand-soft);
  /* semánticos — subir saturación un punto (hoy demasiado tímidos) */
  --green:  #0e8a4d;  --yellow: #b07100;  --red: #cc2f4d;
  --info:   #245a8f;                       /* falta un azul informativo hoy */
  /* superficies (se mantienen) */
  --bg: #eef0f2; --panel: #ffffff; --panel-2: #f4f5f7; --border: #e4e7ea;
}
```

El cliente white-label puede sobrescribir `--brand` desde configuración (una key `configuracion.color_marca` → style inline en `index.html`), pero el default ES la identidad del producto Hevcaz.

### D2. Tipografía — stack de sistema con carácter

Sin Google Fonts no hay display font, pero sí hay jerarquía. Quitar 'Poppins'/'Inter' de `--font-titulos` (no cargan — hoy es aspiracional; el fallback ya es el sistema):

```css
:root {
  --font-ui:   -apple-system, "Segoe UI Variable Display", "Segoe UI", system-ui, Roboto, sans-serif;
  --font-num:  var(--font-ui);  /* con font-feature obligatorio ↓ */
  --font-mono: "Cascadia Code", ui-monospace, "Segoe UI Mono", Consolas, monospace;
}
/* REGLA DURA: todo dato numérico (dinero, stock, folios) en tabular */
.money, .kpi-value, td.num, .folio { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
```

Jerarquía (hoy casi plana): `--fz-display: 26px/700` solo el título de página; `--fz-h2: 15px/650` headers de card **en mayúsculas pequeñas con letter-spacing .04em** (esto solo ya despega de plantilla); `--fz-body: 13.5px`; `--fz-meta: 11.5px`. Los folios (`DEMO-0082`) y claves en `--font-mono` a 12px — ya lo hace Pedidos, sistematizarlo.

### D3. Densidad y tablas (el 70% de la superficie del ERP son tablas)

- Filas a **40px** (hoy ~52px): `td { padding: 9px 12px; }` — un ERP se juzga por cuántas filas caben sin scroll.
- Alineación: dinero y cantidades **a la derecha** siempre (hoy Pedidos tiene los totales a la izquierda — error de género en `10_pedidos.png`).
- Cabecera de tabla sticky + zebra sutil `--panel-2` solo al hover.
- Radios: bajar `--radius: 16px → 10px` y `--radius-lg: 24px → 14px`. Los radios de 16-24px + pills en botones es el look "dashboard de template". Botones a 8px, no 999px (dejar pill solo para badges/chips).

### D4. Cards, badges, KPIs

- **Cards sin sombra flotante**: `border: 1px solid var(--border)` + sombra solo `0 1px 2px rgba(16,17,20,.04)`. La sombra 28px actual es la estética "SaaS landing", no ERP.
- **Badges**: fondo `--x-soft` al 8%, texto del semántico, SIN borde, `font-weight: 650`, 11px, radio pill. Unificar los 5 mapas de `Badge.jsx` a estos tokens.
- **KPI cards**: valor 24px tabular + label 11px mayúsculas + delta con flecha. La card héroe usa `--brand` (no negro) y se elige por relevancia (mayor pendiente de acción), no fija en ventas.

### D5. Elemento distintivo de marca (del producto)

**"La regleta de módulo"**: una barra superior de 3px con el color del dominio en cada página-módulo, + el icono del dominio en un chip cuadrado junto al título:

```css
.page-module { border-top: 3px solid var(--modulo-color); }
.page-icon   { width: 34px; height: 34px; border-radius: 8px;
               background: var(--modulo-soft); color: var(--modulo-color);
               display: grid; place-items: center; }
/* dominio → color: Ventas --brand · Finanzas #245a8f · Almacén #7c5314 ·
   Compras #6b3fa0 · Clientes #0e8a4d · Ajustes gris */
```

Mismo color en el link activo del sidebar de ese grupo. Efecto: orientación instantánea ("estoy en Finanzas, azul") + firma visual reconocible en screenshots de venta — es el equivalente barato de los colores por-app de Odoo. Cero dependencias, ~30 líneas de CSS.

### D6. Cuatro reglas de composición (pegarlas en el CSS como comentario)

1. **Tabla manda**: la lista/tabla ocupa el ancho completo; crear/editar SIEMPRE en modal o drawer, nunca formulario permanente al lado.
2. **Una acción primaria por vista**: un solo botón `--brand` relleno por pantalla; el resto `variant="default"`.
3. **Vacío = siguiente paso**: todo empty state lleva verbo + botón ("Registra tu primer proveedor"), nunca solo "Sin datos".
4. **Número = tabular + alineado a la derecha + 2 decimales en dinero**, sin excepción.

---

## E. PLAN DE EJECUCIÓN por olas (priorizado por percepción de valor vendible)

### Ola 1 — "Deja de verse a medias" (quick wins, ~2-3 días)
1. **Tokens visuales D1-D4** en `styles.css`: `--brand`, radios 10px, filas 40px, tabular-nums, badges unificados, cards con borde. Un solo archivo, riesgo casi nulo, cambia la cara ENTERA de la app. ⭐ mayor ROI del plan.
2. **Empty states accionables** (regla D6.3) en las ~10 tablas con "Sin X todavía": Proveedores, Tareas, Clientes-tags, etc.
3. **Matar el panel "Estado de módulos"** con claves crudas en `Modulos.jsx` (o moverlo a Beta).
4. **Título con contexto**: `page-title` de páginas-módulo pasa a "Finanzas · Cuentas por pagar" (breadcrumb barato) + tabs por URL (`?tab=`) en Erp/Almacen/Prime.
5. **Dinero a la derecha + tabular** en Pedidos/CxP/Corte.

### Ola 2 — "Todo tiene su casa" (cirugía de IA, ~4-6 días)
6. **Página Compras unificada** (C): mover ProveedoresTab/ComprasTab/CxpTab de `Erp.jsx` a un nuevo contenedor `/compras` que absorbe `Compras.jsx` (solicitudes + facturas). Erp queda en 9 secciones. Es mover imports entre 2 arrays de tabs — los componentes tab no se tocan.
7. **Promover Catálogo a página** (`/catalogo`, grupo nuevo "Catálogo"): `prime/CatalogoTab` + Etiquetas + Sustitutos como tabs. `prime/InventarioTab` se retira del árbol (redirige a Almacén). "Configuración" queda solo con ajustes reales.
8. **Sub-nav vertical agrupada en Finanzas** (patrón B2) en vez de 12 tabs en 2 renglones; grupo "REPORTES" plegado.
9. **Reagrupar sidebar** a los 9 grupos de C (solo editar `GRUPOS` en `Layout.jsx` + rutas nuevas en `App.jsx` con redirects de las viejas). Envíos → tabs de Pedidos.
10. **Alta-en-modal** en Proveedores, Sucursales, Tareas (rediseño de Tareas: lista agrupada hoy/vencidas/próximas).

### Ola 3 — "Home propio y flujo" (~4-5 días)
11. **Tab Resumen** en Finanzas (renombrar Tablero), Almacén y Compras (KPIs + pendientes + accesos) — patrón Odoo B1.
12. **Inicio por rol enriquecido**: fila "requiere tu acción" en VistaAdmin; botonzote POS en VistaCajero (C, home por rol).
13. **Command palette** sobre `BuscadorGlobal` (Ctrl+K, acciones + navegación).
14. **Onboarding aplica preset de módulos por giro** (los presets de `_giros.js` apagan mesas/citas/paquetería según giro).

### Ola 4 — "Herramientas completas" (cirugía profunda, ~1-2 semanas, post-venta)
15. **POS modo pantalla completa** (`pos-mode`): grid de frecuentes, montos rápidos, corte como "Cerrar turno" separado.
16. **Ficha de cliente** (drawer/página al click en Clientes: pedidos, puntos, fiados, chat) — convierte la tabla-SELECT en CRM.
17. **Selector de sucursal global** (chip en topbar) que filtra Almacén/Pedidos/Corte.
18. **Almacén agrupado por producto** (expandir sucursales) en vez de 9 filas repetidas.

**Regla de seguridad para todas las olas**: Julio Cepeda no pierde nada — todo movimiento es de contenedor (arrays `TABS`/`GRUPOS`), los componentes de negocio no se reescriben, y las rutas viejas (`/erp`, `/prime?tab=...`) quedan como redirects. La poda por rol sigue siendo `permite()`/`tieneRango()` sin cambios de contrato.

**Qué vende cada ola**: Ola 1 cambia la primera impresión en demos (el 80% de "genérico" es tipografía/densidad/badges); Ola 2 elimina la queja literal de "unas cosas aquí y otras por allá"; Ola 3 da el momento "wow" de producto (Resumen por módulo + Ctrl+K); Ola 4 es profundidad para retención, no para la venta inicial.
