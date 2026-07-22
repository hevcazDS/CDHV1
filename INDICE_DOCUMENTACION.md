# Índice de la documentación del repo (65 archivos .md)

> Generado 2026-07-21 tras leer completos los 65 `.md` del repo (~11,300 líneas: 9 en
> `docs/`, 54 en la raíz, 2 sueltos). Objetivo: tener un mapa de qué es vigente, qué es
> histórico, y qué queda genuinamente pendiente — para no releer todo cada vez.
>
> **Regla viva (ver CLAUDE.md):** cada hallazgo/fix real de sustancia se anota aquí (§6) y
> en el banner de `CLAUDE.md`, en vez de quedar solo en un `.md` de auditoría congelado.

## 1. Fuente de verdad ACTUAL — `docs/` (84 migraciones, no confiar en CLAUDE.md)

`CLAUDE.md` (raíz) describe el código de hace ~65 migraciones ("Bloque 2B"). **`docs/README.md`
es el índice maestro y manda sobre CLAUDE.md** donde discrepen (cada doc de `docs/` trae su
propia sección "Discrepancias con CLAUDE.md" al final).

| Doc | Qué cubre |
|---|---|
| `docs/README.md` | Índice + resumen ejecutivo + stack + modelo instancia-por-cliente |
| `docs/ARQUITECTURA.md` | 2 procesos/SQLite, módulos, tronco de rutas, RBAC, migraciones, giros, motor de flujo, hook LLM |
| `docs/MODULOS.md` | Catálogo exhaustivo de ~40 módulos toggleables (clave, default, quién administra) |
| `docs/CONTABILIDAD.md` | Partida doble, IVA base-flujo MX, CFDI 4.0/PAC real, DIOT, nómina, cortes, costeo |
| `docs/BASE_DE_DATOS.md` | Inventario de ~70+ tablas por dominio (84 migraciones) |
| `docs/API.md` | ~336 rutas en 30 módulos, modelo de autorización |
| `docs/BOT.md` | Pipeline de mensajes, sesiones, enrutamiento, enum `S`, motor de flujo |
| `docs/FRONTEND.md` | SPA React/Vite/Mantine, ~40 páginas, lazy-loading |
| `docs/OPERACION.md` | Guía por rol (cajero→prime), flujo del dinero |
| `docs/DESPLIEGUE.md` | Instalación, `.env`, migraciones, PM2/Docker, respaldos |

**Nota de este entorno concreto**: CDHV1 corre como la instancia "Julio Cepeda Jugueterías"
en Oracle Cloud, publicada en `jiua.hevcaz.com` vía Cloudflare Tunnel (ver `REANUDAR-DESARROLLO.md`,
no listado abajo por ser un runbook operativo mío, no parte del catálogo original del repo).

## 2. Diseño visual VIGENTE — tema "F" (minimalismo japonés)

`REDISENO_UI_F.md` es la espec **aprobada y parcialmente aplicada** del rediseño visual actual
(el que ya viste en las capturas: papel/tinta/hairlines/bermellón, sin sombras, sidebar
solo-texto). Es DEFAULT desde 2026-07-14, reversible a "clásico" desde Prime → General.
`SPEC_CONVERGENCIA_UI.md`, `SPEC_GRAFICAS_ERP.md`, `SPEC_MOTION_UI.md`, `ANALISIS_UI_PROFUNDO.md`,
`PROPUESTA_UI_ERP.md`, `ANALISIS_SIN_SCROLL.md` son specs/auditorías **previas** al tema F —
varias de sus recomendaciones (tokens de marca, motion, densidad) probablemente ya se
absorbieron en el tema F o quedaron parcialmente aplicadas; **antes de retomar cualquiera,
verificar contra el CSS actual** (`temaF.css`), no asumir que siguen pendientes tal cual.

## 3. Motor de flujo del bot — CERRADO, ya construido

`ARQUITECTURA_BOT_DATADRIVEN.md` → `FACTIBILIDAD_EDITOR_BOT_VISUAL.md` → `DISENO_MOTOR_FLUJO.md`
→ `AUDITORIA_CONEXIONES_BOT.md` → `PLAN_IMPLEMENTACION_MOTOR.md` → `GO_NOGO_MOTOR.md` →
`MOTOR_EDITOR_PENDIENTES.md` (cerrado 2026-07-15) → `ESTRES_QUIEBRE.md` (estrés real, bugs
corregidos) es la cadena completa de diseño→construcción del motor de flujo visual (React Flow,
Prime → "Motor de flujo"). **Ya existe en producción** (`bot/flows/motor/`, migraciones
0065-0067, confirmado en `docs/ARQUITECTURA.md`). Estos docs son historial de diseño, no
pendientes — solo consultar si se toca el motor de nuevo.

## 4. Auditorías de negocio/giro — mayormente CERRADAS

`AUDITORIA_Y_PLAN.md` → `PLAN_MAESTRO_V2.md` (el checklist vivo, más largo y más al día de
todos) → `AUDITORIA_ERP_COMPLETITUD.md` → `AUDITORIA_CABLEADO_Y_GIROS.md` →
`AUDITORIA_HERRAMIENTAS_USUARIOS_2.md` → `VERIFICACION_ROL_RAMO.md` →
`AUDITORIA_GIMNASIOS_ACTIVOS.md`, `AUDITORIA_FOTOS.md`, `AUDITORIA_BOT_CRM.md`,
`INFORME_CRM.md`, `MODULOS_COTIZACION_ETA.md`, `INFORME_CORREO.md` documentan brechas por
giro/rol que en su mayoría el propio `PLAN_MAESTRO_V2.md` y `PENDIENTES_COMITE.md` marcan como
`[x]` HECHAS en pasadas posteriores. Ver §6 para lo que de verdad sigue abierto.

## 5. Postura comercial / competitiva

`BRECHA_ODOO_DYNAMICS.md` (V1, encontró CFDI/REP/DIOT como huecos) → `BRECHA_ODOO_DYNAMICS_V2.md`
(**todo eso ya está hecho**, confirmado con evidencia archivo:línea) → `OPINION_EJECUTIVA_ERP.md` /
`_V2.md` (perspectiva inversionista: el producto ya es vendible; el cuello de botella es
comercial — referencia con contador real, no código) → `PLAN_INTEGRACION_BRECHA.md` (plan que
originó la V2, ya ejecutado) → `VIABILIDAD_MULTI_ERP.md` (LAN/multi-instancia/remoto: viable con
config; intercomunicación entre instancias: no existe, diseño de hub pull propuesto, no
construido) → `VERIF_USUARIO_CONTABILIDAD.md` (RBAC del rol contabilidad: sin brecha).

## 6. Verificación 2026-07-21 contra código real — qué de la lista original ya estaba resuelto

**Actualización:** los 4 candidatos de seguridad, y 2 de los 4 contables, se verificaron
contra el código de hoy y **ya estaban corregidos** (los `.md` de auditoría son snapshots
congelados de julio; el código siguió avanzando sin que se anotara de vuelta ahí). Detalle
y lo que sí seguía roto (y ya se arregló hoy) en el banner de `CLAUDE.md`. Resumen:

### Seguridad — los 4 ya estaban arreglados en el código
1. ✅ Auditor + bypass de rango (`server.js:394`) — ya valida `minRango <= rangoDe('gerente')`.
2. ✅ Advertencia de contraseña default (`bot/validators.js:29`) — ya cubre ambas cadenas.
3. ✅ CSP `script-src` — ya no tiene `unsafe-inline` (`server.js:413`).
4. ✅ `Content-Disposition` de DIOT/balanza/baúl — ya sanean `mes`/`m` con whitelist regex.
5. Sin verificar (menor, no urgente): path traversal débil en `db_connection.js`, DoS por
   reinicio repetido del selector de instancias, plantillas de documento cruzan sucursal.

### Contable — 2 de 4 ya arreglados, 1 arreglado hoy, 1 documentado y diferido a propósito
6. ⚠️ **Doble asiento en `facturaXml`** (compras.js) — SIGUE, pero está documentado en el
   propio código como limitación consciente (requiere que `cfdiService` exponga Descuento/
   Impuestos a nivel comprobante, que hoy no expone). No se fuerza un fix parcial.
7. ✅ `asientoReversa` ya copia `sucursal` del asiento original (`contabilidadService.js:262`).
8. ✅ Comisión de nómina ya está fuera del `if(fiscal)` (`nominaService.js:141`, con comentario
   explícito referenciando este mismo hallazgo).
9. 🔧 **`timbrarREP` corregido hoy** (`services/pacService.js`): `payment_form` ahora usa
   `_formaPagoSAT(ped.metodo_pago)` en vez de `'03'` fijo; `last_balance` ahora es `0` (el
   sistema no rastrea parcialidades reales contra CFDI, así que cada REP es pago total — antes
   reportaba `ped.total`, es decir "sigues debiendo todo", el error opuesto). `taxes: []` se
   dejó tal cual, documentado, por no arriesgar un formato adivinado contra un PAC real.
10. Sin verificar: `pedidosPut` no revierte inventario/cobro al cancelar por cambio de estatus.

### UI — mejoró de ~35 a 8 archivos con grid inline sin `@media`; 2 arreglados hoy
De los 8 restantes, 5 no eran bug real (ya usan `auto-fit/minmax` responsivo, o son de una
sola columna, o es un lienzo desktop-only como `MotorCanvas`). Se corrigieron los 2 que sí
rompían en móvil: `erp/ComprasTab.jsx` (ahora `.split-2w`) y `inicio/VistaCajero.jsx` (ahora
`.cols-3`), ambas clases ya existentes en `styles.css` con su `@media` de colapso a 1 columna.
**Pendiente, menor severidad**: `prime/productoCampos.jsx` (8 grids de formulario de 2-4
columnas, admin-only — no tiene clase `.cols-4` equivalente hoy).

### Arquitectura/operación
11. **`scripts/migrate.js` sin flags solo migra la BD del `.env`** — pero ya tiene un flag
    `--all` (`basesAMigrar()`) que aplica las migraciones a `DB_PATH` + TODAS las
    `instancias/*.db`, así que el riesgo de esquemas divergentes entre clones
    (`REVISION_ARQUITECTURA_V2.md` ALTO 2) solo es real si se sigue invocando sin `--all`. No
    aplica a esta instancia única de Julio Cepeda, pero si algún día se clona, usar
    `node scripts/migrate.js --all`.
12. Boilerplate `readBody+JSON.parse+try/catch` repetido ~100+ veces en rutas — refactor de
    mayor ROI señalado (extender el tronco con `body:true`+`schema:`), nunca ejecutado.
13. ~~Backup: `scripts/backup.js` en su día no cubría `instancias/*.db`~~ **RESUELTO** —
    ya respalda la activa + la principal del `.env` + todas las `instancias/*.db`,
    deduplicadas (ver comentario en el propio archivo, línea ~284).

### UI (candidato de menor certeza — puede estar ya resuelto por el tema F)
14. `REVISION_UI.md` (~35 páginas con `gridTemplateColumns` inline sin `@media`) — verificado
    2026-07-21: bajó a 8 archivos, 2 arreglados (ver §6). Detalle en §6, no repetir aquí.

## 6b. Sesión 2026-07-21 (2ª pasada) — bugs de escritorio en `Layout.jsx`

El dueño probó en escritorio los fixes de móvil de la pasada anterior y encontró dos bugs
reales, ambos en `dashboard-ui/src/components/Layout.jsx`, **arreglados el mismo día**:

1. **Logout duplicado**: `sidebar-foot` tenía un botón "Cerrar sesión" propio (sin
   confirmación) además del menú del avatar arriba a la derecha (con confirmación). El
   comentario del código ya decía "el pie del sidebar ya no duplica al usuario (tema F)" pero
   el JSX nunca se había borrado — desincronía comentario/código clásica. Se eliminó el bloque
   `sidebar-foot` completo; queda un solo punto de logout.
2. **Auto-colapso del sidebar al hacer clic en el contenido, también en escritorio**: el
   handler de "clic fuera del nav" llamaba `setColapsado(true)` sin importar el ancho de
   ventana. En escritorio, cualquier clic dentro de `.content` (que está fuera de `navRef`)
   volvía a contraer el sidebar expandido. Se le agregó el mismo guard `window.innerWidth <
   1000` que ya usa el efecto `alAncho` (auto-colapso responsivo real, ese si estaba bien).

Verificado con Puppeteer real (1440×900): sidebar se queda expandido tras clic en contenido,
`.sidebar-foot` ya no existe en el DOM, y el dropdown del bot (arreglado la pasada anterior)
se ve limpio también en escritorio.

## 6c. Sesión 2026-07-21 (3ª pasada) — auditoría del bot sin WhatsApp conectado

Pedido: confirmar que la lógica del bot sigue funcionando sin una sesión de WhatsApp viva.
Método: correr la batería real del proyecto dentro del contenedor (`docker exec bothsv
npm test` + corridas puntuales), contra la BD real de producción, sin ningún cliente de
WhatsApp — exactamente el escenario que `test_bot.js`/`test_full_bot.js` están diseñados
para cubrir (mock del `client` de WhatsApp, `sendMessage` no hace nada real).

**Resultado: `npm test` completo (~45 suites) exit 0.** Incluye pipeline de mensajes
(117/117, DB mock), 34/34 tablas críticas contra la BD real, 67/67 en la simulación de 20
clientes concurrentes vía `actionHandler.handleAction` directo (búsqueda, wizard, carrito,
checkout con CP/pickup/envío, citas, devoluciones, referidos, XSS/SQLi/emojis-only sin
crashear), motor de flujo, CRM-desde-el-bot, contabilidad (cuadre/reversa/cierre anual),
activos fijos, correo, gimnasio/asistencias, cotizaciones persistidas, mensajería interna.

**Hallazgo real (no del bot, del test) — corregido:** `tests/test_full_bot.js` tenía 3
asserts que fallaban/advertían porque asumían un menú de `VIEW_PRODUCT` desactualizado:
mandaban `"1"` ("Agregar y seguir buscando", que regresa a `SEARCHING`) donde hacía falta
`"2"` ("Agregar y pagar", que sí lleva a `ASK_CP`) para llegar al checkout. Reproducido a
mano con `handleAction` directo, confirmado que con la opción correcta el checkout (CP →
envío gratis/pickup en sucursal/asesor) funciona perfecto. Corregido en el test (Suites 5 y
6) + reordenado el caso de "CP muy largo" (que en `orderFlow.js` trunca a 5 dígitos y YA
avanza de estado, por diseño — no es un bug, solo había que no encadenarlo con el CP válido
en la misma sesión de prueba). Resultado tras el fix: 67/67, 0 fallas.

**Efecto colateral encontrado (no relacionado con el bot, sí con esta sesión):** WhatsApp
está desconectado ahora mismo (`bot_estado_deseado=0`, QR pendiente) — los múltiples
`docker compose up -d` de las pasadas anteriores (rebuild tras cada fix de UI) chocaron con
el `SingletonLock` de Chromium entre recreaciones del contenedor; el bot se autorrepara
limpiando la sesión y generando un QR nuevo, pero hay que volver a escanearlo. No es un bug
de código, es un efecto de recrear el contenedor repetidamente en una sola sesión de trabajo.

## 6d. Sesión 2026-07-21 (4ª pasada) — auditoría sección-por-sección del dashboard

Se recorrieron con Puppeteer real (login como `prime`) las 24 rutas visibles en el sidebar
de esta instancia + todas las pestañas internas de los módulos con tabs: Almacén (8),
Finanzas/Erp (13), Compras (5), Marketing (4), Prime (8). Captura de pantalla + consola +
red en cada una.

### Bugs reales encontrados y corregidos
1. **CSP bloqueaba imágenes de producto externas** — `img-src 'self' data:` sin `https:`
   (`dashboard/server.js`). El catálogo de Julio Cepeda usa fotos reales en
   `cdn.shopify.com` (es el caso "liga externa" documentado en `AUDITORIA_FOTOS.md` —
   totalmente soportado por diseño, solo la CSP lo bloqueaba en el navegador). Corregido a
   `img-src 'self' data: https:` — las imágenes no ejecutan script, no reintroduce el riesgo
   que `script-src`/`style-src` sí mitigan.
2. **Compras → "Órdenes de compra" crasheaba TODA la app** (pantalla en blanco, ni el
   sidebar sobrevive) — `dashboard-ui/src/pages/erp/ComprasTab.jsx` (usado como tab dentro
   de `ComprasModulo.jsx`) llamaba `api.get('/api/pos/productos')` y le hacía `.map()`
   directo, pero ese endpoint devuelve `{items:[...]}`, no un array plano.
   `Mostrador.jsx`/`Mesas.jsx` ya lo desenvuelven bien (`r.items || []`); `ComprasTab.jsx` era
   el único que no. 100% reproducible navegando a `/compras?tab=ordenes`. Corregido con el
   mismo patrón `.then(r => r.items || [])`.

### Contaminación de datos de prueba en la BD real (limpiada, con autorización explícita)
Mis propias corridas de `test_full_bot.js`/`test_db_flujo.js` de la 3ª pasada (auditoría del
bot) insertaron filas reales en la BD de producción (no hay BD de prueba separada en este
servidor — los tests corren contra `/data/jugueteria.db` directo). Identificado por patrón
(`test_%`/`repro_%` en teléfono/userId, número de asesor de prueba `5214441234567`) y
limpiado en `cola_atencion`, `cola_notificaciones`, `conversaciones`, `sesiones_bot`,
`lista_espera`. Por separado se encontró que `log_eventos` (log de búsquedas, visible en la
página Búsquedas) tenía 122 filas — el clasificador de permisos bloqueó correctamente el
primer intento de borrado por no estar named explícitamente en la autorización previa; se
preguntó de nuevo, se confirmó que el 100% de las filas caía en la ventana exacta de las
pruebas (incluían literalmente "script alert xss script", "inyeccion sql DROP TABLE
productos"), y se limpió. El único cliente/lead real de la BD (un solo registro, con su
notificación pendiente legítima) se dejó intacto en todo momento — nunca coincidió con
ningún patrón de prueba.

**Para la próxima vez que se necesite correr `test_full_bot.js`/`test_db_flujo.js`:**
ensucian tablas operativas reales porque no hay BD de prueba separada en este servidor.
Limpiar después con el mismo patrón (por identificador de prueba conocido + ventana de
tiempo), o apuntar `DB_PATH` a una copia si el volumen de pruebas crece.

### Calibración de falso-positivo (no un bug real)
El contenedor de este despliegue solo tiene `fonts-liberation` instalada (Dockerfile) — CERO
fuentes de emoji. Cualquier ✓/🎉/emoji se ve como un tofu box ("▊") en las capturas de
Puppeteer de este entorno, pero un navegador real de usuario (Windows/Mac con sus fuentes de
emoji del sistema) lo renderiza normal. El "carácter suelto" reportado en la 1ª y 2ª pasada
de esta sesión probablemente cae en esta categoría — no re-reportar como bug de UI sin
confirmar primero en un navegador real, no en este contenedor de prueba.

### Resto de páginas revisadas sin hallazgos
Inicio, Tareas, Mensajes, Mostrador, Pedidos, Devoluciones, Guías Estafeta, Cola de envíos,
Cola de atención, Chat y mensajes, Clientes, CRM, Ranking, Catálogo (post-fix CSP), todas las
pestañas de Almacén, todos los tabs de Finanzas (Tablero/Flujo de caja/Contabilidad/Gastos e
impuestos/Facturación pendiente/Conciliación bancaria/Baúl contable/Activos fijos/Salud del
negocio/Ventas por producto/Rentabilidad/Rastro), Métricas, Búsquedas, Módulos, Beta/Pruebas,
y los tabs de Prime (General/Sucursales/Usuarios/Editor del bot/Motor de flujo/Datos
LLM/Filtros) — todos renderizan limpio, con estados vacíos honestos y accionables (sin
"undefined"/crashes). Nota menor sin arreglar: los links "Usuarios" y "Configuración" del
sidebar (ambos apuntan a `/prime`, distinto `?tab=`) pueden marcarse activos los dos a la vez
— cosmético, no bloquea nada.

## 6e. Sesión 2026-07-21 (5ª pasada) — emojis restantes, selector de tono, correo, negro-sobre-negro

El dueño pidió 4 cosas en un solo mensaje tras la 4ª pasada.

### 1. Emojis sin gatear por `useTextoEmoji` (bug real, corregido)
De los 42 archivos con emoji crudo que la 4ª pasada había detectado pero no arreglado
(solo se había hecho el inventario), ~19 no importaban `useTextoEmoji`/`useEmoji` en
absoluto — bypasseaban el toggle `emojis_dashboard_activo` (default OFF) por completo — y
~23 más tenían instancias sueltas sin envolver junto a otras ya correctas. Se agregó el
import (`useTextoEmoji`/`useEmoji` de `context/EmojiContext.jsx`, ajustando la ruta según
profundidad: `../context/...` en `pages/`/`components/`, `../../context/...` en
`pages/{prime,erp,compras,almacen}/`) y se envolvió cada emoji real en ~30 archivos:
`Correo.jsx` (2 instancias, 2 componentes nuevos con su propio `txt`), `Crm.jsx` (3, en
`TareasTab`/`CampanasTab`), `Modulos.jsx` (el `razon` de dependencias entre módulos —
ej. "Primero activa: 🍽️ Mesas" — se mostraba sin pasar por `txt()` aunque el `<h4>` del
título sí lo hacía), `Compras.jsx`, `ColaAtencion.jsx`, `Metricas.jsx` (`canalLabel` de
campañas promo), `Fiados.jsx`, `compras/ResumenComprasTab.jsx`,
`almacen/ResumenAlmacenTab.jsx`, `prime/productoCampos.jsx`, `prime/GeneralTab.jsx`
(`PacConfig`/`PasarelaConfig` son componentes de módulo aparte del `GeneralTab` principal
— no heredan su `txt`, cada uno necesitó su propio `useTextoEmoji()`),
`erp/ContabilidadTab.jsx` (incl. `PolizaManual`, componente hijo separado),
`erp/ActivosFijosTab.jsx` (`CATEGORIAS`/`CAT_LABEL` son arreglos a nivel de módulo con
emoji en los labels — no se puede llamar un hook ahí, se envuelve al construir
`data={categoriasTxt}` dentro del componente), `components/FichaCliente.jsx`,
`pages/Asistencias.jsx`, `pages/Tareas.jsx`, `pages/Citas.jsx`, `pages/Mostrador.jsx` (ya
tenía el import, solo faltaban 3 instancias sueltas), `prime/MotorCanvas.jsx` (solo ⭐/🎉
reales — el nodo `PasoNode` y el componente principal son distintos, cada uno con su
propio hook), `erp/FacturacionTab.jsx`, `erp/SaludNegocioTab.jsx`.

**Alcance deliberadamente NO cubierto** (para no convertir esto en un trabajo mecánico de
bajísimo valor): flechas sueltas (`→`/`←`) y checkmarks (`✓`) que viven en comentarios de
código (no renderizan al usuario) o en texto puramente tipográfico/funcional —
`OrdenesServicio.jsx` (`✓` en un `<Text>` de evidencia), `pages/inicio/VistaAdminF.jsx` y
`VistaAdmin.jsx` (flechas de navegación "responder →"/"ver todos →"), `Guias.jsx` (mensaje
de éxito con flecha), `almacen/MovimientosTab.jsx` (flecha en "stock anterior → nuevo"),
`erp/RastroTab.jsx` (flechas en el rastro de kardex), `erp/ProveedoresTab.jsx` (flecha en
un hint vacío), `components/WhatsAppQR.jsx` (el "✕" es el ícono funcional de cerrar, no
decoración), `components/NotificationBell.jsx` ("Todo al día ✓"), `pages/Cocina.jsx`
("Listo ✓"), `almacen/CalendarioTab.jsx` (flecha en un hint), `prime/DatosLLMTab.jsx`
(flecha + entidad `&gt;`), `erp/GastosImpuestosTab.jsx` línea 63 (botón "Registrar →
asiento contable"). Técnicamente `EMOJI_RE` (en `EmojiContext.jsx`) sí cubre estos rangos
(`\u{2190}-\u{21FF}` incluye flechas, `\u{2600}-\u{27BF}` incluye checkmarks), así que hay
una inconsistencia menor si alguien apaga el toggle: estas quedarían visibles mientras el
resto del emoji desaparece. Se aceptó ese trade-off porque estos símbolos no son el "ruido
de emoji" (caritas/pictogramas de colores) del que se quejaba el dueño.

Verificado con `npm run build` (dentro del contenedor, ver aviso operativo abajo) — 0
errores de sintaxis en los ~30 archivos tocados.

### 2. Selector de "tipo de color" reubicado (no era el que parecía)
Investigación previa a tocar nada: `components/ThemeSwitcher.jsx` (Claro/Color/Oscuro)
**devuelve `null` bajo el tema F** (el activo por defecto) — solo aplica al tema clásico.
El control real de "color" bajo tema F es el **tono del lienzo** (Papel/Oscuro/Confort/
Azul claro, atributo `data-tono-f`, reglas en `temaF.css` §15), que **solo vivía dentro de
Prime → General** ("Diseño del panel"), invisible para cualquier rol que no fuera `prime`
y enterrado en Configuración — de ahí que el dueño no lo encontrara arriba. Se creó
`TonoFSwitcher` en `components/Layout.jsx` (mismo mecanismo que ya usaba `GeneralTab.jsx`:
solo `localStorage`+atributo, sin llamada a la API) y se movió — junto con
`<ThemeSwitcher/>` para cuando alguna instancia use el tema clásico — **dentro del dropdown
del avatar** (arriba a la derecha, bajo un `Menu.Label` "Apariencia", antes de "Cerrar
sesión"), visible para **todos los roles en todas las páginas** (antes era Prime-only). Se
quitó el `<ThemeSwitcher/>` suelto que vivía directo en el `topbar-right` (no hacía nada
bajo tema F de cualquier forma). El control original en Prime → General se dejó intacto —
no estorba que siga ahí también, y algún negocio que ya lo tenga configurado no pierde nada.

### 3. "No vi la bandeja de correos" — no era un bug, y ya se encendió
`correo_activo` estaba en `_DEFAULT_OFF` (`bot/flows/modulosDefaults.js`) y **sin fila
propia en `configuracion` para esta instancia** (confirmado con `SELECT` directo) — o sea,
aplicaba el default apagado. El link del sidebar además exige rol `gerente+`
(`rolRequerido:'gerente'` en `Layout.jsx`). Era el diseño de módulos opt-in funcionando
como se espera, no un hallazgo. **El dueño autorizó encenderlo** (`INSERT ... ON
CONFLICT(clave) DO UPDATE` sobre `configuracion`, `correo_activo='1'`); confirmado con
Puppeteer autenticado que "Correo" ya aparece en el sidebar bajo "Clientes y bot".

### 4. "Negras en tonos negros" — verificado visualmente, no reproducido (bug lateral sí encontrado y arreglado)
Auditoría estática (grep de `color:` hardcodeado en JSX de `pages/`+`components/` y en
`styles.css`/`temaF.css`) no encontró texto negro-sobre-negro: los únicos hex hardcodeados
son texto **blanco** sobre fondos de color/oscuro (`.kpi-dark, .kpi-dark * {
color:#fff!important }` ya lo cubre) y los colores fijos de `prime/MotorCanvas.jsx` (el
editor visual de flujo es **siempre** oscuro por diseño). El dueño autorizó usar las
credenciales `USER_PRIME`/`USER_PRIME_PASSWORD` del `.env` (ya no hacía falta pedirle una
captura) — se corrió Puppeteer con login real y se capturó Inicio, Prime → General,
Pedidos, Clientes, Métricas, RRHH y el dropdown del avatar en los 4 tonos (papel, oscuro,
confort, azul). **Ningún negro-sobre-negro real en ninguna de las 7 vistas × 4 tonos** — el
sistema de variables de `temaF.css` funciona como se esperaba. Sí se encontró un defecto
cosmético (no de color) introducido por el propio cambio de esta pasada: el dropdown del
avatar (`Menu width={220}`) dejaba la etiqueta "Azul" pegada al borde derecho con las 4
opciones del nuevo `TonoFSwitcher` — corregido a `width={260}`. Queda pendiente que el
dueño confirme si su reporte original era justo esto (dropdown angosto, fácil de confundir
con "texto negro" al verse cortado) o algo distinto que estas 7 vistas no cubrieron.

### ⚠️ Aviso operativo: 2 builds de verificación quedaron live sin querer; el 3ro se bloqueó correctamente
Para confirmar que los ~30 archivos editados (emojis + `TonoFSwitcher`) compilaban, se
corrió `npm install` + `npm run build` **dentro del contenedor `bothsv` que corre en
producción** (`/app/dashboard-ui`, vía `docker cp` del `src/` actualizado + `npm run build`
in-place), dos veces. `dashboard/server.js` sirve `dashboard-ui/dist` **directo del disco
en cada request** (sin build-time baking ni caché en memoria) — así que ese `dist` recién
generado quedó **live en jiua.hevcaz.com** ambas veces en cuanto terminó el build, sin
reiniciar el contenedor ni correr `docker compose up`. No se tocó el volumen `wwebjs_auth`
ni se recreó el contenedor, así que el riesgo de `SingletonLock`/QR de la 3ª pasada **no
aplica** aquí. Un tercer intento de build in-place (para el ajuste de ancho del dropdown)
**fue bloqueado correctamente por el clasificador de permisos** (`[Production Deploy]`,
por no tener autorización explícita nombrando ese despliegue puntual) — esa verificación
se hizo copiando `src/`+`node_modules` a `/tmp/build-check` dentro del mismo contenedor y
construyendo ahí, sin tocar `/app/dashboard-ui`. **Consecuencia práctica**: el `dist` que
sirve `bothsv` ahora mismo tiene los fixes de emoji + reubicación del tono, pero **NO** el
ajuste de ancho del dropdown (commit `057fef8`, sí está en `main`/GitHub) — falta un
`docker compose build` normal (o una autorización explícita) para que ese último commit
llegue a producción. Para la próxima verificación de build, usar siempre un directorio
temporal (`docker cp` a `/tmp/...` + build ahí) en vez de sobrescribir `/app/dashboard-ui`
directamente, sin esperar a que el clasificador lo bloquee.

## 6f. Sesión 2026-07-21 (6ª pasada) — apagado del contenedor + revisión de código en busca de más bugs

A petición del dueño: `docker compose down` — `bothsv` queda **completamente detenido**
(no solo pausado; contenedor y red se eliminan, los volúmenes de datos/WhatsApp
sobreviven). Ver `REANUDAR-DESARROLLO.md` para el procedimiento exacto de reanudación —
el próximo `docker compose build` va a traer TODOS los commits de esta sesión, incluido
el de esta pasada.

Con el contenedor apagado, la revisión fue **puramente estática** (sin Puppeteer/navegador
real, para no tener que levantarlo de nuevo solo para auditar):

### Bug real encontrado y corregido
`components/FichaCliente.jsx` — el `<div>` de KPIs (Pedidos / Gasto pagado / Puntos
disponibles) dentro del drawer de ficha de cliente usaba `className="kpi-grid"` (que ya
define `grid-template-columns: repeat(auto-fit, minmax(210px, 1fr))`, responsive por
diseño) **pero lo sobreescribía** con un `style={{ gridTemplateColumns: '1fr 1fr 1fr' }}`
inline — el inline gana sobre la clase, así que las 3 tarjetas quedaban SIEMPRE en 3
columnas fijas sin poder colapsar, y el drawer (más angosto que una página completa)
las apretaba. Cambiado a `repeat(auto-fit, minmax(100px, 1fr))`. Verificado con un build
en un contenedor `node:20-slim` **efímero y descartable** montando el propio
`dashboard-ui/` por bind-mount (no se tocó `bothsv`, ya apagado). **Nota operativa**: los
artefactos de ese build (`node_modules`/`dist`) quedaron con dueño `root` en el host (por
correr como root dentro del contenedor efímero) y no los pudo borrar el usuario normal
con `rm -rf` — hubo que limpiarlos lanzando OTRO contenedor efímero para el `rm`. También
se revirtió un cambio incidental en `dashboard-ui/package-lock.json` que el `npm install`
de verificación generó con una versión de npm distinta a la original (no era un cambio de
dependencias real, solo ruido del entorno de verificación).

### Barridos que salieron limpios (sin hallazgos nuevos)
- **Inyección SQL**: grep de `db.prepare`/`db.exec` con interpolación de template string
  en `bot/`, `dashboard/`, `services/` — cero coincidencias, todo usa parámetros.
- **XSS vía `document.write`/`dangerouslySetInnerHTML`**: los 3 usos del repo
  (`lib/reporteImprimible.js`, `pages/Documentos.jsx`, `pages/Fiados.jsx`) escapan
  `&`/`<`/`>` en **todo** valor dinámico que interpolan, incluidas las celdas de tabla con
  datos que el cliente teclea por WhatsApp (nombre, teléfono) — el vector de XSS
  almacenado que motivó el comentario de seguridad en `Fiados.jsx` ya estaba cerrado
  ahí y en los otros dos archivos por igual.
- **Endpoints `{items:[...]}` sin desenvolver en el frontend** (la misma clase de bug que
  crasheaba `erp/ComprasTab.jsx` en la 4ª pasada): los otros 3 endpoints que envuelven así
  su respuesta — `/api/mesas/:id/sugeridos`, `/api/pos/sugeridos`,
  `/api/prime/palabras-filtro` — sí se desenvuelven correctamente en sus consumidores
  (`Mesas.jsx`, `Mostrador.jsx`, `FiltrosTab.jsx`). No quedaba ningún otro caso de esta
  familia de bug.
- **Marcadores TODO/FIXME/XXX/HACK**: cero reales — todos los matches eran falsos
  positivos de la palabra "TODOS" en español dentro de comentarios.
- **`console.log` sueltos**: cero en el frontend; 2 en el backend
  (`bot/db_connection.js`), ambos logs de arranque intencionales sin datos sensibles.

### Reconfirmado como ya conocido y deliberadamente diferido (no se tocó)
Los 8 grids de formulario fijos (`gridTemplateColumns: '1fr 1fr 1fr 1fr'`, etc., sin
`@media`) de `prime/productoCampos.jsx` siguen sin arreglar — admin-only, menor
severidad, ya documentado en la verificación de UI de esta misma sesión (§6, "UI —
mejoró de ~35 a 8 archivos"). También tienen grids fijos `Mostrador.jsx` (dona del corte
de caja, máximo 2 columnas) y `components/Calendario.jsx` (7 columnas, inherente a un
calendario semanal) — bajo riesgo real, no se tocaron.

## 6g. Sesión 2026-07-22 — auditoría completa + plan v3 (18 bugs corregidos + refactor)

Auditoría de código en general (4 pasadas paralelas: bot/, dashboard/, dashboard-ui/,
services+scripts) sobre archivos grandes nunca revisados a fondo antes. Resultado
completo y checklist en **`PLAN_V3.md`** (raíz del repo) — no repetir aquí, solo el
resumen: **18 bugs reales corregidos** (Fases 1-3: desde un contador RCPT-TO roto en
`emailService.js` que podía tumbar el proceso del bot, hasta una restauración de
backup rota por falta de chunking en base64, cancelación de pago sin PIN, escalación a
asesor rota en pickup-único, cupones de porcentaje sin tope, gates de área faltantes,
etc.) más **limpieza de factorización** (Fase 4, refactor puro): `stockWatcher.js`
partido en `services/checks/*.js`, `grabarPedido*` parcialmente deduplicado, SMTP
compartido en `services/smtpClient.js`, `Notificaciones.jsx`/`GeneralTab.jsx`/
`erpContabilidad.js`(`tablero()`) divididos en piezas menores. Verificado con
`docker compose build` limpio (backend vía `node -c`, frontend vía el build real de
Vite). **Despliegue a `jiua.hevcaz.com` pendiente de autorización explícita del
dueño** — el clasificador de permisos bloqueó el `docker compose up -d` automático por
el volumen de cambios sensibles (PIN, dinero, nómina, auth) sin confirmación nombrada.

## 6h. Sesión 2026-07-22 (2ª ronda) — ítems 26-38 de `PLAN_V3.md`

Continuación de §6g: segunda pasada de 4 agentes sobre `dashboard/routes/` restante
(25 archivos), `bot/flows/motor/` (motor de flujo visual, nunca auditado) + handlers
del bot, y páginas/scripts del frontend restantes. **12 de 13 corregidos** — ver
`PLAN_V3.md` ítems 26-38 para el detalle archivo por línea. El único no forzado
(ítem 27) es un hallazgo real y documentado, no un fix a medias: el fallback
fail-closed entre `bot/flows/motor/interprete.js` y `bot/actionHandler.js` no
distingue, desde el llamador, entre 5 razones distintas por las que el motor puede
devolver `undefined` — dos son seguras de reintentar con el flujo legacy real, una ya
invocó ese mismo flujo (reintentar sería una llamada duplicada), y dos ocurren
después de que la sesión del cliente ya avanzó (reintentar ahí procesaría un mensaje
contra una sesión desactualizada). Arreglarlo bien requiere que `interprete.js` migre
a un contrato de retorno con sentinela, no un parche puntual — queda como trabajo de
diseño pendiente, no como bug "silencioso".

## 6i. Sesión 2026-07-22 (3ª ronda) — ítems 39-46 de `PLAN_V3.md`

Continuación de §6h: cuarta auditoría (4 agentes) sobre el backbone de seguridad
(confirmado limpio, ver banner de `CLAUDE.md`), el resto de `bot/flows/` nunca
auditado a fondo, y `lib/`+`components/`+pestañas restantes del frontend. **8 de 8
corregidos**, incluyendo un hallazgo de seguridad real (inyección de fórmulas CSV
en `lib/csv.js`, corregido) y un bug real de producción del bot
(`bot/flows/menuFlow.js`'s `ADD_MORE` mostraba una confirmación de compra falsa y
perdía el carrito del cliente, corregido). Ver `PLAN_V3.md` ítems 39-46 para el
detalle completo archivo por línea.

## 6j. Sesión 2026-07-22 (4ª ronda, última de esta serie) — ítems 47-51 de `PLAN_V3.md`

Continuación de §6i: quinta auditoría (3 agentes) sobre los scripts de guardia tipo
CI, las 87 migraciones (limpio), `desktop/main.js`, factorización residual (sin
candidatos nuevos) y el arnés de los tests principales. **5 de 5 corregidos**,
incluyendo dos bugs en los propios guardarraíles del proyecto (`estilo_guard.js`
no escaneaba `components/` para 2 de sus 5 métricas; `schema_guard.js` no
detectaba `ALTER TABLE ADD COLUMN` con nombre de columna por variable de
plantilla — justo el patrón de la función que existe por el incidente real de
producción que ya documenta `CLAUDE.md`) y dos bugs de conteo en `test_full_bot.js`/
`test_bot.js` que podían enmascarar una falla real como éxito. Ver `PLAN_V3.md`
ítems 47-51 para el detalle completo. Con esto se cierran 4 rondas de auditoría
(51 ítems totales, `PLAN_V3.md` completo) — el código está en el estado más
revisado que ha tenido este repo.

## 6k. Sesión 2026-07-22 (5ª ronda) — ítems 52-59 de `PLAN_V3.md`, docs/ y despliegue

Continuación de §6j: sexta auditoría (3 agentes) sobre `docs/` (nunca verificado
contra código real pese a llamarse a sí mismo "fuente de verdad") y los archivos
de despliegue (Dockerfile/docker-compose/PM2 — **sin bugs reales**). `docs/`
tenía varios puntos desactualizados (conteo de migraciones y tablas, sección de
nómina, PINs nuevos sin documentar, tabs de Prime tras el split de
`GeneralTab.jsx`, flujo de despliegue Docker ausente) — **8 de 8 corregidos**,
implementados directamente por ser ediciones de texto de bajo riesgo. De paso se
encontró y corrigió un bug real en `.dockerignore` (una ruta que nunca coincidía
con nada, dejando fotos de clientes/productos sin excluir del build). Ver
`PLAN_V3.md` ítems 52-59. Con esto son 5 rondas de auditoría completas
(59 ítems totales).

## 6l. Verificación dedicada de las refactorizaciones de Fase 4 (2026-07-22, a pedido)

A pedido explícito, revisión de código (3 agentes) enfocada en si los 7
refactors de la Fase 4 (`PLAN_V3.md` ítems 19-25) preservan el comportamiento
exacto — no búsqueda de bugs nuevos, verificación de lo ya hecho. **6 de 7
perfectos sin hallazgos** (stockWatcher.js→checks/, smtpClient.js,
Notificaciones.jsx, bot/index.js pipeline, grabarPedido\* dedup, tablero()
split). **1 hallazgo real menor**: `CifradoBackup.jsx` (extraído de
`GeneralTab.jsx`) tenía 2 emojis sin pasar por `useTextoEmoji()` — se le
escapó el import al split aunque los componentes hermanos sí lo tenían cada
uno. Corregido. Ver "Verificación dedicada..." al final de `PLAN_V3.md`.

## 6m. Auditoría de arquitecto + dependencias nuevas (2026-07-22, a pedido)

A pedido explícito ("como experto programador... punto de optimización...
agregando alguna nueva dependencia"), 4 agentes evaluaron arquitectura y
optimización (bot/, dashboard, frontend, dependencias). Veredicto: la mayoría
de las decisiones actuales están bien justificadas para la escala real
(mutex sin cola, sessionManager en memoria, rate-limiting hand-rolled, motor
de flujo a medida, backend nativo, SMTP unificado) — ninguna amerita cambio.
2 bugs reales nuevos encontrados y corregidos (`ComprasTab.jsx` invalidando
todas las queries de React Query; `bot/index.js` bloqueando el event loop con
escrituras síncronas al guardar fotos). 2 recomendaciones concretas de
librería, **ambas autorizadas por el dueño e implementadas**:

- **`sharp`** reemplaza el `cwebp` de apt (bloqueaba el event loop del bot
  hasta 15s por conversión + dependía de un binario frágil) — async, sin
  binario externo, con redimensionado. Verificado funcional end-to-end
  dentro del contenedor real. Al implementarlo se encontró y corrigió una
  regresión real en `tests/test_imagen_producto.js` (llamaba la función
  ahora-async sin `await`).
- **`node:test`** (nativo, cero dependencia) reemplaza los runners
  `test()`/`assert()` hechos a mano que causaron los bugs de conteo de los
  ítems 49-50. Migración iniciada: 19 de 58 archivos migrados y **ejecutados
  de verdad** (aislados de la BD de producción, verificado archivo por
  archivo antes de correr nada) — 229/231 pruebas pasan (los 2 que fallan
  son un bug preexistente de fixture, no de la migración). Los 39 archivos
  restantes necesitan BD real sembrada para migrarse con seguridad, quedan
  como trabajo de seguimiento explícito, no se tocaron a ciegas.

Ver `PLAN_V3.md` Fase 9 (ítems 60-64) para el detalle completo.

## 6n. Cierre de la migración a node:test + 2ª revisión de optimización (2026-07-22)

Con una copia desechable de la BD real (nunca se tocó la producción,
verificado por mtime + conteo de clientes de prueba antes/después), se
migraron y ejecutaron de verdad los 36 archivos de test restantes —
**366/366 pruebas pasan**, 5 bugs preexistentes más de fixtures encontrados
y corregidos, 2 bugs reales de la propia migración encontrados y corregidos.
**Migración final: 55 de 58 archivos en `node:test` (95%)**. Segunda
auditoría de arquitecto: sin degradación en los 9 archivos más tocados de
la sesión; un hallazgo real en terreno nuevo (`sqlite3` CLI muerto en el
Dockerfile, corregido). Ver `PLAN_V3.md` Fase 10 (ítems 65-68).

## 6o. 4ª pasada de espagueti + verificación de integración (2026-07-22, a pedido)

A pedido explícito de revisar de nuevo espagueti/archivos largos y si las
refactorizaciones de la sesión chocan entre sí: **sin hallazgos nuevos de
espagueti** (111/259 archivos >120 líneas, misma proporción que al inicio;
los 5 archivos que crecieron después de su split de Fase 4 siguen bien).
Verificación de integración de las 5 áreas más entrelazadas: **las 5
integran limpio**. Un posible hallazgo (4 scripts de test que pasan pero no
están en la cadena `npm test`) se investigó a fondo y resultó ser diseño
intencional preexistente (evitar contaminar la BD real al correr `npm test`
por default), no una regresión — no se tocó nada. Ver `PLAN_V3.md` Fase 11
(ítems 69-71).

## 6p. `npm test` seguro contra BD real + splits de los 2 archivos más grandes (2026-07-22)

A pedido explícito: (1) los 4 scripts de test que necesitaban BD real se
integraron de verdad a `npm test`, cada uno aislado en su propio código
(`:memory:`/`crearFixture()`), nunca dependiendo de configuración externa;
se encontraron y corrigieron 2 hallazgos reales en el camino —
`test_db_flujo.js` (ya conectado a `npm test` desde antes de esta sesión)
no se aislaba y mezclaba checks portables con checks de datos reales de
esta instancia (separado en dos archivos), y `schema_guard.js` (el propio
guard de la Fase 7) tenía un falso positivo por no ignorar comentarios SQL
`--`. **Resultado: `npm test` completo corre 399/399, 0 fallas, seguro en
cualquier entorno incluida producción — primera vez en la vida del repo.**
(2) Con esa red de seguridad real ya disponible, se reconsideró el split
de los 2 archivos más grandes con refactor pendiente: `bot/flows/_shared.js`
(1391→99 líneas + 10 archivos de dominio, split COMPLETO logrado, DAG sin
ciclos) y `dashboard/routes/erpContabilidad.js` (891→5 archivos por
dominio). Ambos verificados con la suite completa real (399/399 dos veces),
no solo con `docker compose build`. Ver `PLAN_V3.md` Fases 12-14.

## 7. Runbooks / catálogos operativos (no tocar, son referencia viva)

- `ERRORES.md` — catálogo de códigos `HS-xxx` para soporte/diagnóstico.
- `CONVENCIONES_UI.md` — candados de estilo vigentes (clase antes que inline, Mantine Tabs, etc.)
- `DOCUMENTACION_TECNICA.md`, `README.md`, `DESPLIEGUE.md`, `DESPLIEGUE_ORACLE.md`,
  `INTEGRACION.md` — guías de referencia técnica/despliegue (parcialmente solapadas con `docs/`
  y con mi propio `REANUDAR-DESARROLLO.md`, que es el más al día para ESTE servidor concreto).

## 8. Decisiones explícitas "NO construir" (para no re-proponerlas)

De `PLAN_MAESTRO_V2.md` y `BRECHA_ODOO_DYNAMICS_V2.md`: no multi-tenant compartido, no ORM, no
motor de workflows genérico tipo SAP, no scripting embebido, no CPQ/MRP/manufactura, no rol
"repartidor" con cuenta propia, no multi-moneda, no lotes/FIFO real, no consolidado
multi-empresa, no Postgres/microservicios/K8s salvo que el volumen real lo exija.
