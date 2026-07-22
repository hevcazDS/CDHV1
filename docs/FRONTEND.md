# Frontend (dashboard-ui)

SPA React + Vite + **Mantine**, build a `dashboard-ui/dist`
(`npm run build:dashboard-ui`), servido estáticamente por `dashboard/server.js`
— sin servidor de frontend en producción (mismo proceso Node). `dist` está
**gitignoreado**: se (re)construye en el servidor al desplegar, así que un
cambio en un `.jsx` solo llega a producción tras correr el build ahí.

Dev: `npm run dev:dashboard-ui` (Vite con `/api` proxeado a `:3001`).

## Índice
1. [Estructura](#estructura)
2. [Navegación por rol](#navegación-por-rol)
3. [Páginas](#páginas)
4. [Componentes reutilizables](#componentes-reutilizables)
5. [Contextos y helpers](#contextos-y-helpers)
6. [Estilo (style-guard)](#estilo-style-guard)
7. [Lazy-loading](#lazy-loading)

---

## Estructura

```
dashboard-ui/src/
  App.jsx            ← rutas + guards de rango; 33 páginas con React.lazy
  context/           AuthContext.jsx, EmojiContext.jsx
  api.js             fetch wrapper (credentials:'include'; get/post/put/del)
  components/        shell + piezas reutilizables (eager)
  pages/             una página por sección; subcarpetas prime/almacen/compras/erp/inicio
  lib/               permisos.js, roles.js, format.js, factura.js, csv.js, ui.jsx…
  styles.css         sistema visual hand-written (CSS custom props)
```

El shell (`Login`/`Onboarding`/`Layout`) carga **eager**; todo lo demás es
`lazy(() => import('./pages/X'))` bajo `<Suspense>`.

## Navegación por rol

`components/Layout.jsx` define **9 grupos por dominio** (`GRUPOS`) y filtra cada
enlace por:

- `rolRequerido` (rango mínimo: `gerente`/`prime`) — vía `tieneRango` (`lib/roles.js`).
- `area`/`areas` (especialistas) — vía `permite` (`lib/permisos.js`, espejo del backend `dashboard/permisos.js`).
- `moduloRequerido` — solo aparece si el módulo está ON (batch a `GET /api/modulos?claves=...`, cacheado en `localStorage` para que el menú no "brinque").

El **auditor** ve todo lo de gerente salvo `/prime` y `/modulos` (solo lectura).
Los guards de ruta en `App.jsx` repiten el gate por si alguien navega por URL.

Grupos: **Panel** (Inicio/Tareas/Mensajes), **Ventas** (Mostrador/Mesas/Cocina/
Citas/Check-in/Órdenes de servicio/Suscripciones/Documentos/Pedidos/Devoluciones/
Fiados), **Envíos** (Guías/Cola de envíos), **Clientes y bot** (Cola de atención/
Chat/Clientes/CRM/Ranking/Marketing/Correo), **Catálogo** (Productos), **Almacén**,
**Compras y finanzas** (Compras/Finanzas/Métricas/Búsquedas), **Personal** (RRHH),
**Ajustes** (Usuarios/Módulos/Configuración/Beta). Cada grupo tiñe el borde
superior del contenido con su color de dominio (`MODULO_DE_GRUPO`).

## Páginas

`pages/` (una por sección). Operación: `Inicio`, `Pedidos`, `Devoluciones`,
`Clientes`, `Guias`, `ColaEnvios`, `ColaAtencion`, `Notificaciones`,
`ListaEspera`, `Preventas`, `Mensajes`, `Tareas`, `Ranking`, `Busquedas`,
`Metricas`, `Etiquetas`, `Beta`. Ventas/servicios: `Mostrador` (POS), `Mesas`,
`Cocina`, `Citas`, `Asistencias`, `OrdenesServicio`, `Suscripciones`,
`Documentos`, `Fiados`. ERP: `Erp` (Finanzas), `Compras`, `Almacen`, `Rrhh`,
`Correo`, `Crm`. Páginas-módulo (tabs internos): `CatalogoModulo`,
`ComprasModulo`, `MarketingModulo` (más `Ofertas`, `Cupones`, `Sustitutos`).
Config: `Modulos`, `Prime`.

`Prime.jsx` es un orquestador delgado que monta un componente por pestaña desde
`pages/prime/`: `GeneralTab`, `SucursalesTab`, `InventarioTab`, `CatalogoTab`,
`UsuariosTab`, `DatosLLMTab`, `FiltrosTab`, `DemoTab`, `MotorTab`+`MotorCanvas`
(lienzo React Flow del motor de flujo), `BotEditorTab`, `VariantesModal`,
`productoCampos.jsx` (campos compartidos). Cada tab monta solo cuando está
activo (`{TabActivo && <TabActivo/>}`) → sus queries disparan al abrir.
`GeneralTab.jsx` a su vez delega 8 widgets ya extraídos a
`pages/prime/general/*.jsx` (`ZonasComisiones`, `RegimenFiscal`, `PacConfig`,
`PasarelaConfig`, `ZonaHoraria`, `ZonaPeligro`, `CifradoBackup`, `LinkPagoBase`).
Subcarpetas `pages/almacen/`, `pages/compras/`, `pages/erp/`, `pages/inicio/`
alojan los tabs de esas páginas-módulo.

## Componentes reutilizables

`components/`: `Layout` (shell sidebar+header), `Login`, `Onboarding` (wizard),
`BotStatusWidget` (polea `/api/bot/status` + historial, con start/stop/restart),
`WhatsAppQR`, `NotificationBell` (campana agregadora), `BuscadorGlobal`,
`SoporteWidget` (botón flotante de Hevcaz, lee `GET /api/soporte`),
`InstanciaSwitcher`, `ThemeSwitcher`, `Badge` (mapas de color por dominio:
pago/devolucion/cola/guia/notif), `Modal`, `Skeleton`, `Calendario`,
`EstatusMenu`, y gráficas (`GraficaSemana`, `MiniCharts`, `PuntosGrafica`).

## Contextos y helpers

- `context/AuthContext.jsx` — envuelve `/api/login|me|logout`, expone `{ user, login, logout }`.
- `context/EmojiContext.jsx` — respeta `emojis_dashboard_activo` (look minimalista).
- `api.js` — fetch con `credentials:'include'` (cookie de sesión), sin axios; `del` acepta body opcional.
- `lib/` — `permisos.js`/`roles.js` (espejo del RBAC backend), `format.js` (`fmt`/`fdate`/`soloTelefono`), `factura.js` (leyenda/datos fiscales del ticket), `csv.js`, `reporteImprimible.js`, `apiError.js`, `fontPrefs.js`, `ui.jsx`.

## Estilo (style-guard)

`src/styles.css`, custom properties. **Tema por defecto: claro minimalista**
(canvas gris `#eef0f2`, tarjetas blancas, acento monocromo oscuro), por la
referencia visual del cliente; dark y confort quedan como opciones del
`ThemeSwitcher`. Tailwind solo en modo *utilities* (sin preflight, para no
pisar Mantine). Deliberadamente **no carga Google Fonts** (evita excepción CSP);
cae al stack de fuente del sistema.

## Lazy-loading

`App.jsx` usa `React.lazy` en las **33** páginas. `vite.config.js` `manualChunks`
fija vendors cacheables: `vendor-react`, `vendor-mantine`, `vendor-query`;
`recharts`/`qrcode`/React Flow quedan en el chunk diferido de su página. Al
añadir una página, regístrala como otro `lazy(...)` para mantenerla fuera del
bundle inicial.

## Discrepancias con CLAUDE.md

1. CLAUDE.md describe una SPA sin Mantine y con "20 secciones"; hoy hay **~40 páginas** y usa **Mantine** + React Flow.
2. CLAUDE.md no menciona los grupos de sidebar por dominio ni el filtrado por `area`/`moduloRequerido` (solo por rol).
3. Ausentes de CLAUDE.md: páginas de Mostrador/Mesas/Cocina/Citas/CRM/Finanzas/Almacén/Compras/RRHH/Correo/Documentos/Suscripciones/Fiados/Órdenes de servicio y el lienzo del motor de flujo.
