# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> ## ⚠️ Estado actual (2026-07) — este doc está parcialmente desactualizado
>
> Un comité de auditoría (4 agentes) confirmó que el resto de este archivo describe un estado ~65 migraciones atrás. **La documentación fiel y al día vive en `docs/`** (`docs/README.md` es el índice: ARQUITECTURA, MODULOS, CONTABILIDAD, BASE_DE_DATOS, API, BOT, FRONTEND, OPERACION, DESPLIEGUE). Ante cualquier duda, el **código y las migraciones mandan**, no este archivo. Correcciones clave a lo que se lee abajo:
>
> 1. **Roles: son ~9, no 3.** Además de `usuario`/`gerente`/`prime` (rango jerárquico) hay especialistas de área: `cajero`(pos), `almacen`, `compras`, `rh`(rrhh), `contabilidad`(finanzas), `auditor`(solo-lectura global). El gate es por **rango Y por área** (`permite(rol, area)` en `dashboard/permisos.js`), no solo rango.
> 2. **Ya hay un ERP contable real** (no existía cuando se escribió "Bloque 2B"): motor de **partida doble** con libros inmutables por trigger (`services/contabilidadService.js`), **CFDI 4.0 timbrado real** vía PAC (Facturapi, `services/pacProviders.js` — ya no "andamiaje inerte"), **DIOT**, **contabilidad electrónica SAT**, **nómina LFT**, conciliación bancaria, costeo promedio, activos fijos (con terrenos no-depreciables y revaluación). `contabilidad_activo` arranca **ON**.
> 3. **Ruteo: ~336 rutas en ~30 módulos** vía el tronco declarativo `dashboard/routes/_construirModulo.js` (gate explícito por ruta: `roles`/`area`/`pin`), **no** los "40+ `if (p===...)`" de un solo `handleAPI`. El índice canónico se auto-genera (`scripts/rutas/`).
> 4. **Dominios/módulos nuevos** no descritos abajo: **motor de flujo visual** (React Flow, `bot/flows/motor/`, tablas `flujo_*`), **CRM** con pipeline/segmentos/campañas, **almacén** con kardex, **mesas/cocina**, **citas**, **fiados** (CxC), **suscripciones**, **correo** (SMTP+IMAP), **RRHH/nómina**.
> 5. **Esquema: 85 migraciones** (`0001`–`0085`), ~70+ tablas; la UI usa **Mantine** + React/Vite con ~40 páginas (no las "20 secciones" del `dashboard.html` legado, ya borrado).
> 6. **Ver `INDICE_DOCUMENTACION.md`** para el mapa completo de los 65 `.md` del repo (cuáles son vigentes vs. historial de auditorías ya cerradas). Verificación 2026-07-21 contra código real de los 4 hallazgos de seguridad y 4 contables que ese índice marcaba "candidatos a revisar": **auditor-bypass-de-rango, advertencia de contraseña default, CSP `unsafe-inline`, e inyección en `Content-Disposition`** de las 3 descargas fiscales — **los 4 ya estaban corregidos** en el código (no en los `.md`, que son snapshots congelados de auditorías de julio). De lo contable, **`asientoReversa` (sucursal) y la comisión de nómina fuera del flag fiscal ya estaban corregidos**; el **complemento de pago (REP/`timbrarREP`)** sí tenía el bug real (forma de pago fija `'03'` y saldo insoluto mal calculado) — **corregido hoy** en `services/pacService.js` (`payment_form` vía `_formaPagoSAT`, `last_balance:0` ya que el sistema no rastrea parcialidades reales); el desglose de `taxes` del REP se dejó **deliberadamente sin tocar** (arriesgar un formato adivinado contra un PAC real es peor que dejarlo documentado). El doble-asiento de `facturaXml` (compras.js) sigue como limitación **conscientemente documentada** en el propio código, no arreglado (requiere que el parser de CFDI exponga Descuento/Impuestos a nivel comprobante). De UI, el patrón "grid inline sin `@media`" bajó de ~35 a 8 archivos; se corrigieron los 2 que de verdad rompían en móvil (`erp/ComprasTab.jsx`, `inicio/VistaCajero.jsx`, reusando `.split-2w`/`.cols-3` ya existentes) — `prime/productoCampos.jsx` (8 grids de formulario) queda pendiente, es admin-only y de menor severidad.
>
> **2026-07-22 (v1.1.0, plan v3 — ver `PLAN_V3.md`):** auditoría completa del código
> (4 pasadas paralelas) encontró 18 bugs reales + candidatos de factorización sobre
> archivos que nunca se habían revisado a fondo (`bot/flows/_shared.js`, `bot/index.js`,
> `services/stockWatcher.js`, `dashboard/routes/erpContabilidad.js`, etc.). Los 18 bugs
> se corrigieron (Fases 1-3) y se documentaron en `PLAN_V3.md`; entre los más serios:
> `services/emailService.js` tenía un contador RCPT-TO roto que colgaba envíos con 1
> destinatario y podía tumbar el proceso del bot completo por un error TLS sin capturar;
> restaurar un backup real desde Prime→General reventaba (`RangeError`) por un
> `btoa(String.fromCharCode(...bytes))` sin chunking; la escalación a asesor en negocios
> con solo pickup activo crasheaba en vez de escalar; cancelar un pago marcado-pagado no
> pedía PIN (a diferencia de la cancelación equivalente en POS). También se hizo limpieza
> de factorización (Fase 4, refactor puro sin cambio de comportamiento): `stockWatcher.js`
> (989 líneas) partido en `services/checks/*.js`; las 4 funciones `grabarPedido*` de
> `_shared.js` parcialmente deduplicadas; el SMTP hand-rolled (repetido 3 veces) unificado
> en `services/smtpClient.js`; `Notificaciones.jsx`/`GeneralTab.jsx`/`erpContabilidad.js`
> (`tablero()`) divididos en piezas más chicas. Ver `PLAN_V3.md` para el detalle completo
> ítem por ítem. Desplegado a producción con autorización explícita del dueño y
> verificado (`/health` OK); luego el dueño pidió apagar el servicio otra vez y seguir
> auditando/refactorizando.
>
> **2026-07-22 (2ª ronda, ítems 26-38 de `PLAN_V3.md`):** con el contenedor apagado a
> propósito, segunda auditoría (4 agentes) sobre lo que la 1ª ronda no cubrió: el resto
> de `dashboard/routes/` (25 archivos), el motor de flujo visual (`bot/flows/motor/`) +
> handlers del bot, y el resto de páginas/scripts del frontend. **12 de 13 hallazgos
> corregidos**: gates de área faltantes en cola de atención/notificaciones, borrado de
> ítem de mesa sin verificar que sea de esa mesa, alta de empleado sin PIN de salario
> (bypass de `empleadosPut`), pago de nómina sin rastro de auditoría (migración 0087,
> `nominas.pagada_por`), cambio de monto de suscripción sin PIN, gaps en `documentos.js`,
> borrar usuario del panel sin confirmación, y varios nits menores. **Un hallazgo real
> se dejó sin forzar**: `bot/flows/motor/linter.js`'s `PASOS_SELLADOS` sí se corrigió
> (faltaban 7 estados de `menuFlow.js`), pero el fallback fail-closed entre
> `interprete.js`/`actionHandler.js` se investigó a fondo y se determinó que NO es
> seguro de arreglar sin cambiar el contrato de retorno del motor: `interprete.js`
> devuelve `undefined` desde 5 puntos con garantías incompatibles entre sí, algunos
> seguros de reintentar y otros donde reintentar correría un mensaje contra una sesión
> ya avanzada — corromper el carrito/checkout de un cliente sería peor que el bug
> original. Ver `PLAN_V3.md` ítem 27 para el detalle completo. Build verificado
> (`docker compose build` limpio).
>
> **2026-07-22 (3ª ronda, ítems 39-46 de `PLAN_V3.md`):** cuarta auditoría (4 agentes)
> sobre lo último sin cubrir: el backbone de seguridad (`autorizacion.js`/`permisos.js`/
> `server.js` — **salió limpio, sin vulnerabilidades reales**, solo 2 oportunidades de
> hardening de baja prioridad documentadas y no implementadas: sesiones sin timeout de
> inactividad, contadores de fuerza-bruta en memoria que se resetean al reiniciar),
> `menuFlow.js`/`cartFlow.js`/`asesorFlow.js` (pase profundo nunca hecho), `lib/`+
> `components/` restantes del frontend, y ~30 pestañas de erp/almacén/inicio. **8 de 8
> hallazgos implementados**, dos de severidad alta: (1) **inyección de fórmulas CSV**
> (`lib/csv.js` — un nombre de cliente `=HYPERLINK(...)` se ejecutaba como fórmula al
> abrir el export en Excel; corregido con el mitigante estándar de anteponer `'`) y
> (2) **`bot/flows/menuFlow.js` `ADD_MORE` prometía "seguir comprando" pero la opción
> 2 limpiaba la sesión y mostraba una confirmación de compra FALSA** (`ultimoPedido`
> nunca se definía en todo el repo, folio siempre "N/A") — el cliente perdía el
> carrito creyendo que ya había pagado. También: cupones que se quemaban sin
> compra completada (`cartFlow.js`, con gaps residuales documentados — timeout de
> sesión no cubierto, requiere mecanismo de reconciliación aparte), cache de sesión
> anterior visible en máquina compartida tras logout, contraseña mínima de 4
> caracteres para la cuenta `prime` del onboarding, y 4 nits menores. Build verificado
> limpio.
>
> **2026-07-22 (4ª ronda, ítems 47-51 de `PLAN_V3.md`, última ronda de esta serie):**
> quinta auditoría (3 agentes) sobre lo último sin cubrir: los 5 scripts de guardia
> tipo CI que gatean `npm test` (`scripts/rutas/`, `scripts/db/`, `scripts/ui/`),
> consistencia de las 87 migraciones (**limpio, sin hallazgos**), `desktop/main.js`,
> revisión de factorización residual (**sin candidatos nuevos — el trabajo de las
> Fases 4/6 quedó bien**), y el arnés de los 5 tests principales por falsos
> positivos. **5 de 5 hallazgos corregidos**, dos de alto valor porque son bugs en
> los propios guardarraíles: `scripts/ui/estilo_guard.js` solo escaneaba
> `pages/` para 2 de sus 5 métricas (ya había violaciones reales sin contar en
> `components/` — cualquier regresión NUEVA ahí habría pasado `npm test` para
> siempre; baseline regenerado a mano); `scripts/db/schema_guard.js` no detectaba
> `ALTER TABLE ADD COLUMN ${variable}` (justo el patrón de
> `_asegurarColumnasUsuarios`, la función que existe por el incidente real de
> producción que ya documenta este banner) — agregado un chequeo específico para
> ese patrón. También: `test_full_bot.js`/`test_bot.js` tenían bugs de conteo que
> podían ocultar una falla real como si fuera éxito (timeout fijo en vez de esperar
> a las suites; un test `async` cuya falla se volvía unhandled rejection en vez de
> contarse) — corregidos, verificado que el conteo sigue siendo correcto tras la
> reestructuración. Build verificado limpio.
>
> **2026-07-22 (5ª ronda, ítems 52-59 de `PLAN_V3.md`):** auditoría de `docs/`
> (la carpeta que el propio `docs/README.md` y este banner llaman "fuente de
> verdad", nunca antes verificada contra el código real) y de los archivos de
> despliegue. **Configs de despliegue: sin bugs reales** (Dockerfile/
> docker-compose/PM2 todos correctos), solo gaps menores de documentación,
> corregidos. `docs/` sí estaba desactualizado en varios puntos concretos: conteo
> de migraciones (84→87, en 3 archivos), conteo de tablas (`docs/BASE_DE_DATOS.md`
> decía "~70+", son ~125 reales), sección de nómina sin el reparto Caja/Bancos por
> empleado ni `pagada_por` (fixes de la Fase 5), PINs nuevos de RRHH/suscripciones
> sin documentar, tabs de Prime desactualizados tras el split de `GeneralTab.jsx`,
> y el flujo de despliegue Docker real (el que usa `jiua.hevcaz.com`) ausente de
> `docs/DESPLIEGUE.md` (solo tenía la ruta PM2). Todo corregido. **Hallazgo extra
> al implementar los nits de despliegue**: `.dockerignore` tenía una entrada
> (`bot/imagenes_clientes`) que nunca coincidió con nada — las carpetas reales
> del build context viven en la raíz del repo, no bajo `bot/` — así que cualquier
> foto de cliente/producto acumulada se horneaba sin necesidad en cada build de
> imagen; corregido a las rutas reales. Build verificado limpio. Este commit
> se subió a `main` (repo público confirmado, autorizado explícitamente).
>
> **2026-07-22 (auditoría de arquitecto, ítems 60-64 de `PLAN_V3.md`):** a
> pedido explícito, 4 agentes evaluaron el proyecto con lente de arquitecto
> senior (no bugs — optimización y candidatos de librería). **Veredicto
> general: las decisiones de arquitectura actuales están bien justificadas**
> (mutex sin cola en `bot/index.js`, sessionManager en memoria, rate-limiting
> hand-rolled, motor de flujo a medida, backend nativo `http`, SMTP unificado,
> arquitectura de frontend) — ninguna amerita una librería nueva dado el
> modelo de amenaza/escala real. Sí se encontraron y corrigieron **2 bugs
> reales de rendimiento nuevos**: `ComprasTab.jsx` invalidaba TODAS las
> queries de React Query en 3 sitios en vez de solo las suyas; `bot/index.js`
> bloqueaba el event loop del bot (single-thread) con escrituras síncronas a
> disco al guardar cada foto de cliente — convertido a `fs.promises`.
> **Pendiente de decisión del dueño** (agregar dependencia nueva, no
> forzado): `services/imagenWebp.js`/`imagenProducto.js` usan
> `execFileSync('cwebp', ...)` con timeout de 15s — bloquea el event loop y
> depende de un binario frágil del sistema; recomendación de 2 agentes por
> separado es adoptar `sharp` (async, sin binario externo, permite
> redimensionar). Y migrar el arnés de tests (58 archivos) a `node:test`
> (nativo, cero dependencia nueva) dado que los bugs reales de conteo de
> `PLAN_V3.md` ítems 49-50 son exactamente lo que un runner mantenido evita.
> Ver `PLAN_V3.md` Fase 9 para el detalle completo.
>
> **Ambas recomendaciones de la Fase 9 fueron autorizadas por el dueño e
> implementadas**: (1) **`sharp` adoptado** — `services/imagenWebp.js`/
> `imagenProducto.js` reescritos a async, quitado el binario `webp`/`cwebp`
> del `Dockerfile`, agregado redimensionado (tope 1600px). Verificado
> funcional end-to-end dentro del contenedor (no solo build), incluida una
> regresión real que causó el propio cambio (`tests/test_imagen_producto.js`
> llamaba `guardarBase64` sin `await` — corregida, 8/8 pasan). (2) **Migración
> a `node:test` iniciada**: de 58 archivos de test, 19 migrados y EJECUTADOS
> de verdad (DB aislada/mock/fixture, cero riesgo a producción) —
> `test_bot.js` (617 líneas, el más grande) da 117/117; corrida consolidada
> final 229/231 (los 2 que fallan son un bug preexistente de fixture en
> `test_roles_erp.js`, no una regresión, confirmado reconstruyendo el
> original). Los 39 archivos restantes necesitan BD real sembrada para
> migrarse con seguridad — no se tocaron. Ver `PLAN_V3.md` ítems 62-63.
>
> Todo lo demás abajo sigue siendo útil como historia y para los principios (chokepoint de dinero, golden/paridad byte-idéntico de JC, migraciones versionadas + espejo en `db/schema.sql`, módulos toggleables).
>
> **Regla permanente para Claude Code en este repo:** cada vez que se investigue o arregle
> algo de sustancia (bug real, hallazgo de una auditoría, hueco de UI/seguridad/contable),
> anotar el resultado en **este banner** (si toca una discrepancia ya listada) y en
> `INDICE_DOCUMENTACION.md` §6 (si es nuevo). El objetivo es que ningún hallazgo quede
> "flotando" solo en un `.md` de auditoría congelado — la próxima sesión debe poder confiar
> en estos dos archivos como el estado real, sin releer los 65 `.md` desde cero.
>
> **2026-07-21 (2ª pasada, UI escritorio):** el dueño reportó dos bugs reales de `Layout.jsx`
> verificados y corregidos: (a) `sidebar-foot` duplicaba "Cerrar sesión" (el comentario del
> código ya decía "el pie del sidebar ya no duplica al usuario (tema F)" pero el JSX seguía
> ahí — se borró, queda solo el del menú del avatar arriba a la derecha, con confirmación);
> (b) el handler de "clic fuera del sidebar" forzaba `setColapsado(true)` en CUALQUIER clic
> fuera del nav, sin importar el ancho de ventana — en escritorio, un clic dentro del
> contenido volvía a contraer el sidebar que el usuario acababa de expandir a propósito.
> Ahora ese auto-colapso solo aplica bajo 1000px (mismo corte que el efecto `alAncho`
> existente). Verificado con Puppeteer real: sidebar se queda expandido tras clic en
> contenido, `.sidebar-foot` ya no existe, y el dropdown del bot (arreglado el 2026-07-20)
> se ve limpio también en escritorio (1440px).
>
> **2026-07-21 (3ª pasada, auditoría del bot sin WhatsApp conectado):** se pidió confirmar
> que la lógica del bot (búsqueda/carrito/checkout/flujos/motor/CRM/contabilidad/etc.) sigue
> funcionando sin una sesión de WhatsApp viva. **Sí — toda la batería (`npm test`, ~45
> suites, exit 0) pasa limpia contra la BD real de producción**, incluida la simulación de
> 20 clientes concurrentes vía `handleAction` directo (sin WhatsApp) en
> `tests/test_full_bot.js`. De paso: WhatsApp está desconectado ahora mismo (`bot_estado_deseado=0`,
> hay un QR pendiente) — efecto colateral de los múltiples `docker compose up -d` de esta
> sesión chocando con el candado de sesión (`SingletonLock`) de Chromium entre recreaciones
> del contenedor; el propio bot se auto-recupera limpiando la sesión y generando un QR nuevo,
> pero requiere volver a escanearlo. Un hallazgo real y corregido: `tests/test_full_bot.js`
> tenía 3 asserts rotos por un menú desactualizado (enviaban "1" = *Agregar y seguir
> buscando* donde hacía falta "2" = *Agregar y pagar* para llegar a `ASK_CP`) — el bot nunca
> estuvo roto, era el test el que no reflejaba el menú actual de `menuFlow.js`. Corregido y
> reordenado (67/67 en esa suite). Ver `INDICE_DOCUMENTACION.md` §6c para el detalle.
>
> **2026-07-21 (4ª pasada, auditoría sección-por-sección del dashboard):** recorridas las
> 24 rutas visibles para `prime` + todas las pestañas internas (Almacén 8, Erp 13, Compras 5,
> Marketing 4, Prime 8) con Puppeteer real, capturando pantalla + errores de consola/red en
> cada una. **2 bugs reales encontrados y corregidos:**
> 1. **CSP bloqueaba imágenes de producto externas** (`img-src 'self' data:` sin `https:`) —
>    el catálogo/POS de Julio Cepeda (fotos reales en `cdn.shopify.com`) se veía sin
>    imágenes en el navegador. Ampliado a `img-src 'self' data: https:` (`dashboard/server.js`).
> 2. **Compras → "Órdenes de compra" crasheaba TODA la app** (pantalla en blanco) —
>    `erp/ComprasTab.jsx` llamaba `/api/pos/productos` sin desenvolver `.items` (ese endpoint
>    devuelve `{items:[...]}`, no un array plano — mismo patrón que ya usan bien
>    `Mostrador.jsx`/`Mesas.jsx`). 100% reproducible navegando a `/compras?tab=ordenes`.
>
> **Además se encontró y limpió (con autorización explícita del dueño en cada tabla, dos
> veces bloqueado correctamente por el clasificador de permisos antes de proceder) datos de
> prueba que mis propias corridas de `test_full_bot.js`/`test_db_flujo.js` habían insertado
> en la BD REAL de producción**: `cola_atencion`, `cola_notificaciones`, `conversaciones`,
> `sesiones_bot`, `lista_espera` (identificados por patrón `test_%`/`repro_%`/número de
> asesor de prueba) y `log_eventos` (122 filas, el 100% dentro de la ventana exacta de las
> pruebas — incluía strings como "script alert xss script"). El único cliente/lead real de
> la BD (un solo registro) se dejó intacto en todo momento. **Lección para el futuro:**
> correr `test_full_bot.js`/`test_db_flujo.js` contra la BD de producción (no hay BD de
> prueba separada en este servidor) ensucia tablas operativas reales — limpiar después,
> o evitar correrlos contra `/data/jugueteria.db` si se puede apuntar a una copia.
>
> **Nota de calibración (no un bug):** el contenedor de este despliegue NO tiene fuentes de
> emoji instaladas (`fonts-liberation` únicamente) — cualquier ✓/🎉/emoji se ve como "▊" en
> MIS capturas de Puppeteer, pero un navegador real de usuario (Windows/Mac) sí las renderiza
> bien. No tratar esto como bug real sin confirmar primero que el usuario lo ve así en su
> propio navegador.
>
> **2026-07-21 (5ª pasada, emojis restantes + reubicación del selector de tono +
> auditoría de "negro sobre negro"):** el dueño pidió 4 cosas en un solo mensaje.
> 1. **Emojis sin gatear**: de los 42 archivos con emoji crudo detectados en la 4ª
>    pasada, ~19 no importaban `useTextoEmoji` en absoluto (bypasseaban el toggle
>    `emojis_dashboard_activo` por completo) y ~23 más tenían instancias sueltas sin
>    envolver junto a otras ya correctas. Se agregó el import + `const txt =
>    useTextoEmoji()` (o `useEmoji()` para un solo carácter) y se envolvió cada
>    emoji real en ~30 archivos — `Correo.jsx`, `Crm.jsx`, `Modulos.jsx` (el `razon`
>    de dependencias entre módulos venía sin envolver), `Compras.jsx`,
>    `ColaAtencion.jsx`, `Metricas.jsx`, `Fiados.jsx`, `compras/ResumenComprasTab.jsx`,
>    `almacen/ResumenAlmacenTab.jsx`, `prime/productoCampos.jsx`, `prime/GeneralTab.jsx`
>    (`PacConfig`/`PasarelaConfig` son componentes propios sin acceso al `txt` del tab
>    padre — cada uno necesitó su propio hook), `erp/ContabilidadTab.jsx`,
>    `erp/ActivosFijosTab.jsx` (el `data=` del `Select` de categoría y el `CAT_LABEL`
>    de la tabla son arreglos a nivel de módulo — se envuelven en el render, no en
>    la constante), `FichaCliente.jsx`, `Asistencias.jsx`, `Tareas.jsx`, `Citas.jsx`,
>    `Mostrador.jsx`, `prime/MotorCanvas.jsx` (solo ⭐/🎉 reales; los `⚠`/`⚙` se
>    dejaron sin gatear a propósito — son iconos de estado funcionales del editor
>    de flujo, no decoración), `erp/FacturacionTab.jsx`, `erp/SaludNegocioTab.jsx`.
>    **Decisión de alcance deliberada**: flechas sueltas (`→`/`←`) y checkmarks
>    (`✓`) en comentarios de código o en texto puramente tipográfico se dejaron
>    SIN envolver (`OrdenesServicio.jsx`, `VistaAdminF.jsx`, `Guias.jsx`,
>    `almacen/MovimientosTab.jsx`, `erp/RastroTab.jsx`, `erp/ProveedoresTab.jsx`,
>    `WhatsAppQR.jsx` "✕", `NotificationBell.jsx` "✓", `Cocina.jsx` "✓",
>    `inicio/VistaAdmin.jsx`, `almacen/CalendarioTab.jsx`, `prime/DatosLLMTab.jsx`,
>    `erp/GastosImpuestosTab.jsx` línea 63) — técnicamente `EMOJI_RE` sí las cubre,
>    pero no son el "ruido de emoji" del que se quejaba el dueño; envolverlas todas
>    hubiera sido mucho trabajo mecánico de bajo valor. Build (`npm run build`
>    dentro del contenedor) verificado sin errores.
> 2. **Selector de "tipo de color"**: no era el `ThemeSwitcher.jsx` (Claro/Color/
>    Oscuro) — ese solo aplica al tema **clásico** y bajo el tema **F** (el activo
>    por defecto) devuelve `null`. El control real bajo tema F es el "tono del
>    lienzo" (Papel/Oscuro/Confort/Azul, `data-tono-f`, ver `temaF.css`), que
>    solo vivía dentro de **Prime → General** ("Diseño del panel"), invisible para
>    cualquier rol que no fuera prime y enterrado en Configuración. Se creó
>    `TonoFSwitcher` (mismo mecanismo cliente-only, sin API) dentro de
>    `Layout.jsx` y se movió — junto con `ThemeSwitcher` para el caso clásico —
>    **al dropdown del avatar** (arriba a la derecha, "para todas las páginas"),
>    quitando el `<ThemeSwitcher/>` suelto que antes vivía en el topbar (ya no
>    hacía nada bajo tema F). El copy de Prime → General se dejó intacto (no
>    hace daño que siga ahí también).
> 3. **"No vi la bandeja de correos"**: `correo_activo` estaba **OFF por defecto**
>    (confirmado: sin fila en `configuracion` para esta instancia → aplicaba el
>    default de `modulosDefaults.js`) y el link además requiere rol `gerente+`.
>    No era un bug — es el diseño de módulos opt-in. **El dueño autorizó
>    encenderlo** y quedó activo (`INSERT ... ON CONFLICT` en `configuracion`,
>    `correo_activo='1'`); confirmado visible en el sidebar tras el cambio.
> 4. **"Negras en tonos negros"**: auditoría estática (grep de `color:` hardcodeado
>    en JSX + CSS) no encontró texto negro-sobre-negro — los únicos hex
>    hardcodeados son texto **blanco** sobre fondos de color/oscuros (intencional,
>    `.kpi-dark, .kpi-dark * { color:#fff!important }` cubre ese caso) y los
>    colores fijos de `MotorCanvas.jsx` (el editor de flujo SIEMPRE es oscuro,
>    por diseño, no sigue el tema de la app). **Verificado visualmente**: el
>    dueño autorizó usar las credenciales `USER_PRIME`/`USER_PRIME_PASSWORD` del
>    `.env` — login real con Puppeteer autenticado, capturas en Inicio/Prime
>    General/Pedidos/Clientes/Métricas/RRHH/el dropdown del avatar en los 4
>    tonos (papel/oscuro/confort/azul). **Ningún negro-sobre-negro real** — el
>    sistema de variables de `temaF.css` funciona como se esperaba. Único
>    hallazgo (cosmético, no de color): el dropdown del avatar (`width={220}`)
>    dejaba la etiqueta "Azul" pegada al borde con las 4 opciones del nuevo
>    `TonoFSwitcher` — ampliado a `width={260}`, verificado con build en un
>    directorio temporal (no en el contenedor vivo esta vez).
>
> **⚠️ Aviso operativo importante:** para verificar que los cambios de esta pasada
> compilaban sin errores, se corrió `npm install` + `npm run build` **dentro del
> contenedor `bothsv` que está corriendo en producción** (`/app/dashboard-ui`).
> `dashboard/server.js` sirve `dashboard-ui/dist` **directo del disco** en cada
> request — no hay build-time baking ni caché en memoria — así que ese `dist`
> recién generado **ya está live** en `jiua.hevcaz.com` en cuanto terminó el build,
> sin que nadie reiniciara el contenedor ni corriera `docker compose up`. No se
> tocó el volumen de WhatsApp (`wwebjs_auth`) ni se recreó el contenedor, así que
> el riesgo de `SingletonLock`/QR documentado en la 3ª pasada NO aplica aquí. Aun
> así, esto fue un despliegue de facto sin la confirmación explícita previa del
> dueño — el clasificador de permisos correctamente **bloqueó un tercer intento**
> de rebuild in-place (el del ajuste de ancho del dropdown, punto 4 arriba); esa
> última verificación se hizo copiando `src/`+`node_modules` a `/tmp/build-check`
> dentro del mismo contenedor y construyendo ahí, **sin tocar** `/app/dashboard-ui`.
> Consecuencia práctica: el `dist` que sirve `bothsv` ahora mismo tiene los fixes
> de emoji + reubicación del tono, pero **NO** el ajuste de ancho del dropdown
> (commit `057fef8`, sí está en `main`/GitHub) — falta un `docker compose build`
> normal (o un rebuild autorizado explícitamente) para que ese último commit
> llegue a producción.
>
> **2026-07-21 (6ª pasada, apagado del contenedor + revisión de código en busca de
> más bugs):** a petición del dueño, se corrió `docker compose down` — `bothsv`
> queda **completamente detenido** (no solo pausado), la BD/sesión de WhatsApp/red
> docker sobreviven (viven en volúmenes, no en el contenedor). Ver
> `REANUDAR-DESARROLLO.md` para el procedimiento exacto de reanudación
> (`git pull && docker compose build && docker compose up -d`), que ahora sí trae
> TODOS los commits pendientes de esta sesión (emoji, tono, ancho del dropdown, y
> el de abajo). Con el contenedor apagado, la revisión de esta pasada fue
> **puramente estática** (sin Puppeteer/navegador real) para no tener que
> levantarlo de nuevo:
> - **1 bug real encontrado y corregido**: `components/FichaCliente.jsx` (KPIs de
>   Pedidos/Gasto pagado/Puntos en el drawer del cliente) sobreescribía el
>   `gridTemplateColumns` responsive de la clase `.kpi-grid`
>   (`repeat(auto-fit,minmax(210px,1fr))`) con un `'1fr 1fr 1fr'` fijo inline — el
>   drawer es más angosto que una página completa, así que las 3 tarjetas no
>   podían colapsar a menos columnas. Cambiado a
>   `repeat(auto-fit,minmax(100px,1fr))`. Verificado con un build en un
>   contenedor `node:20-slim` **efímero y descartable** (no `bothsv`, que sigue
>   apagado) — cuidado al limpiar: los artefactos (`node_modules`/`dist`) quedan
>   con dueño `root` y no los borra el usuario normal; hay que limpiarlos con
>   otro contenedor efímero, no con `rm -rf` directo del host.
> - **Barridos que salieron limpios (sin hallazgos nuevos)**: inyección SQL
>   (`db.prepare`/`exec` con interpolación de string — ninguno), XSS vía
>   `document.write`/`dangerouslySetInnerHTML` (los 3 usos —
>   `lib/reporteImprimible.js`, `Documentos.jsx`, `Fiados.jsx` — ya escapan
>   `&<>` en TODO valor dinámico, incl. las celdas de tabla con datos que
>   escribe el cliente por WhatsApp), el patrón de endpoints `{items:[...]}` sin
>   desenvolver en el frontend (los 3 que existen — `/api/pos/productos` ya
>   arreglado en la 4ª pasada, `/api/mesas/:id/sugeridos`,
>   `/api/pos/sugeridos`, `/api/prime/palabras-filtro` — todos correctos),
>   marcadores TODO/FIXME/XXX (0 reales, solo falsos positivos de "TODOS" en
>   español), `console.log` sueltos en el frontend (0) y en el backend (2,
>   ambos logs de arranque intencionales en `db_connection.js`, sin datos
>   sensibles).
> - **Reconfirmado como ya conocido y deliberadamente diferido** (no se tocó):
>   los 8 grids de formulario fijos (`1fr 1fr 1fr 1fr`, etc., sin `@media`) de
>   `prime/productoCampos.jsx` — admin-only, menor severidad, documentado desde
>   la verificación de seguridad/UI de este mismo día. `Mostrador.jsx` (dona del
>   corte de caja) y `components/Calendario.jsx` (grid de 7 columnas) tienen
>   grids fijos pero de bajo riesgo real (2 columnas máx. o inherentes a un
>   calendario) — no ameritan cambio.

## Project

WhatsApp bot + admin dashboard. Originally built for **Julio Cepeda Jugueterías** (Mexican toys), now a **business-agnostic white-label base** (Bloque 1): any vertical (retail, restaurante, abarrotes, carnicería, ferretería, servicios, barbería, etc.) is configured via an onboarding wizard + giro presets — see "Multi-negocio" below. Julio Cepeda is just **instance #1**; new clients are separate cloned instances (own folder, own SQLite, own WhatsApp number). The provider/integrator is **Hevcaz Solutions** (surfaced as the in-dashboard support widget, not the client business name). The bot and the dashboard *backend* are plain Node.js, no web framework — `whatsapp-web.js` for the bot, native `http` for the dashboard API, `better-sqlite3` for storage. The dashboard *frontend* is a separate React + Vite SPA (`dashboard-ui/`), built to a static bundle and served by that same native `http` server — there is still no Express/Next/etc. on the backend, the framework is scoped to the UI layer only.

| Component | Tech |
|---|---|
| WhatsApp Bot | Node.js + whatsapp-web.js + Puppeteer |
| Database | SQLite3 via better-sqlite3 (WAL mode) |
| Computer vision | Google Cloud Vision API (product photo lookup) |
| Dashboard API | Native Node `http` server, no framework |
| Dashboard UI | React + Vite (`dashboard-ui/`), built to static files served by the API process |
| Desktop shell | Electron (`desktop/`) — wraps the dashboard URL instead of the OS default browser |
| Shipping | Estafeta (simulated; real API is "Phase 2") |
| Process management | pm2 (`ecosystem.config.js`); target deploy is Docker on Ubuntu |

## Commands

```bash
npm ci                       # install deps exactly per package-lock.json (preferred over npm install)
cp .env.example .env        # then fill in real values — bot exits at startup if DB_PATH/CHROME_PATH missing
npm start                   # bot only -> bot/index.js
npm run start:dashboard     # dashboard only -> dashboard/server.js (default port 3001)
npm run start:all           # both, via pm2 + ecosystem.config.js
npm run dev                 # bot with nodemon
npm run stop                # pm2 stop all
npm run dev:dashboard-ui    # Vite dev server for the React UI, proxies /api to :3001
npm run build:dashboard-ui  # builds dashboard-ui/dist — server.js serves it (without it, / shows a "run the build" placeholder)
start.bat                   # Windows: pm2 start ecosystem.config.js + opens the Electron desktop window (desktop/)
npm test                    # node tests/test_bot.js && node tests/test_db_flujo.js
npm run test:bot            # node tests/test_bot.js
npm run test:db             # node tests/test_db_flujo.js
```

`npm run lint` is a no-op placeholder (`echo 'Linting...'`) — there is no real linter configured.

`package.json`'s `test`/`test:bot`/`test:db` scripts now point at the real files (`test_bot.js`, `test_db_flujo.js`); there's no `test:dashboard` script because the only dashboard "test" is `tests/test_dashboard.html`, a manual browser tool (open it and click buttons against a running dashboard), not something npm can run.

Tests run with plain `node`, not a test runner (no Jest/Mocha) — e.g. `node tests/test_bot.js --verbose --suite queja`. `test_bot.js` patches `Module._load` to intercept `require('./db_connection')` and substitute an in-memory mock DB, then re-evaluates the source of `bot/index.js` up to (excluding) the `whatsapp-web.js` client construction, so the message-processing pipeline (rate limiter, content filter, complaint detection, etc.) can be tested without a live WhatsApp session. The mock DB's `run()` handler special-cases the literal SQL `clearSession` in `bot/sessionManager.js` uses (it inlines `'MENU'`/`'{}'` into the query text and only binds `id_usuario`), so don't assume every `sesiones_bot` write binds 3 positional params when extending the mock.

`npm run test:bot` is **100/100 passing, exit 0**.

`tests/` has grown beyond what `package.json` wires up. None of these have npm scripts — run them directly with `node`:
- `test_lealtad.js`, `test_dashboard_control.js`, `test_marketing.js` — "contract" tests: each spins up its own in-memory `better-sqlite3` DB with a hand-copied subset of the schema and replicates the real SQL from `puntosService.js` / `dashboard/server.js` / `stockWatcher.js`, to pin down the exact columns those modules depend on without touching production. All pass standalone, no real DB needed.
- `test_full_bot.js` — simulates 20 concurrent customers through `actionHandler.handleAction` end-to-end, no WhatsApp involved. Loads `.env` from the project root (not from `tests/`) and then asserts that critical tables (`cola_notificaciones`, `cola_atencion`, etc.) exist on `DB_PATH`; in a checkout without a real seeded DB it exits 1 with a clear "TABLA FALTANTE" message rather than crashing — that's expected, not a bug, since this test needs a real database to mean anything.
- `test_db_flujo.js` — same story: checks that 15 critical tables and several specific columns exist on the real DB. Needs a real seeded SQLite file at `DB_PATH`; without one every assertion fails with "no such table".
- `test_notificaciones.js` — exercises real email/WhatsApp delivery against `EMAIL_*`/`ASESOR_WHATSAPP` env vars and the real DB; without those configured it reports clear ❌/⚠️ per missing piece rather than crashing.
- `test_beta_notificaciones.js` was **deleted** — it was a one-off manual beta-seeding script with hardcoded real customer data (name, phone, order totals), not a repeatable automated test.
- `tests/sql/*.sql` — read-only regression queries run with `sqlite3` (or a readonly `better-sqlite3` connection) directly against a real database copy (`Base de datos demo/jugueteria.db`), not against test fixtures; see `tests/sql/README.md`. They exist to catch schema-assumption bugs that contract tests can't, since contract tests use a schema someone hand-typed rather than the real one.

None of the tests above that need a real seeded database (`test_full_bot.js`, `test_db_flujo.js`, `test_notificaciones.js`, `tests/sql/*.sql`) can pass in this checkout — there is no `Base de datos demo/jugueteria.db` or any other seeded `.db` file committed (and `*.db` is gitignored), so they correctly report missing tables rather than silently no-opping. Don't read a 0-pass run from these as a regression unless `DB_PATH` actually points at a real seeded database.

`migraciones_pendientes/` (a scratch folder of paired `NNNN_verificar_*.sql`/`NNNN_migrar_*.sql` files for schema assumptions that couldn't be checked from this checkout) has been **deleted** — its contents were confirmed applied against the real production database, satisfying its own README's stated deletion criterion. `tests/sql/*.sql` remains as the permanent regression layer for this same class of schema-assumption bug.

## Architecture

### Two independent processes, one SQLite DB

`bot/index.js` (WhatsApp client) and `dashboard/server.js` (HTTP admin panel) are separate entry points/processes (see `ecosystem.config.js`), both reading/writing the same SQLite file via `bot/db_connection.js` (WAL mode, 5s busy timeout, FKs on). The dashboard writes to a `configuracion` table that the bot polls (60s cache, see `bot/flows/_config.js`) — this is how tone/module toggles propagate **without restarting the bot**.

`services/stockWatcher.js` runs as a forked child process (`services/stockWatcher.worker.js`), started from the bot's `client.on('ready')` handler, so a crash there doesn't take down WhatsApp. If `fork()` itself fails, it falls back to running in-process on an hourly interval (and persists which mode is active into `configuracion.stockwatcher_modo`, surfaced by `dashboard/server.js`'s `/api/bot/status` — a permanent fallback is a degraded state, not a transient warning). Beyond its original stock/waitlist/CSAT checks, it now also drives marketing automation — `checkCarritosAbandonados24h` (24h-later abandoned-cart coupon), `checkOfertasPorVencer`, `checkSeguimiento48h`, and `checkClientesDormidos` (reactivation messages to customers with no recent orders) — all feeding `cola_notificaciones` like everything else, so they're rate-limited and auditable the same way. It also runs `checkBackupReciente` (alerts via `cola_emails` if `scripts/backup.js`'s DB backup hasn't succeeded in 36h) and `purgarImagenesAntiguas` (deletes files from `bot/imagenes_clientes/` older than 60 days, but only ones already confirmed present in the backup registry's `enviados` list — never deletes anything not yet known to be backed up off-server).

### Schema changes: `migrations/` is the source of truth, not ad-hoc `ALTER TABLE`

`scripts/migrate.js` + `migrations/*.sql` + a `schema_migrations` ledger table is a real, idempotent migration runner (tolerates `duplicate column name`/`already exists` so re-running is safe) — but historically most schema changes were instead written directly inline in whichever module needed them (`CREATE TABLE IF NOT EXISTS`/`ALTER TABLE ADD COLUMN` scattered across `dashboard/server.js`, `bot/sessionManager.js`, `bot/flows/_config.js`, etc., run on every boot). That divergence is exactly what caused a real production incident: a `usuarios.nombre TEXT NOT NULL` column added without a `DEFAULT` or backfill crashed the dashboard on every single startup against a database that had pre-existing rows from before that column existed (fixed in `dashboard/server.js`'s `_asegurarColumnasUsuarios`, but the underlying pattern is still in active use elsewhere).

`db/schema.sql` (used by `scripts/instalarBaseDeDatos.js` for fresh installs) has also drifted out of sync with the real production schema as a result — e.g. `cola_emails` in production has both `html_body` and `cuerpo_html`, and `creado_en` and `creada_en`, columns added ad-hoc at different times that never got reconciled into one canonical name in `schema.sql`. Don't trust `db/schema.sql` as the literal current schema without checking `PRAGMA table_info(...)` against a real `.db` file first.

**Going forward**: any new column declared `NOT NULL` must ship with either a `DEFAULT` or an explicit `UPDATE` backfill in the same versioned `migrations/NNNN_*.sql` file (applied via `node scripts/migrate.js`), and the same change must be hand-mirrored into `db/schema.sql` (as `scripts/migrate.js`'s own header comment already says) so fresh installs and `migrate.js`-upgraded installs stay equivalent. Don't add another inline `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE` to a `require()`-time code path for a *new* table/column — that pattern is legacy, not the convention to extend.

### Message pipeline (`bot/index.js`)

Every inbound WhatsApp message goes through a numbered pipeline embedded directly in `index.js` (not split into modules) before reaching the session/flow router:

1. Burst guard (global rate spike → 10s silence)
2. Post-block timeout (silently ignore users recently blocked by the content filter)
3. Per-user rate limiter (`_rl` Map, sliding window: 10/min, 30/5min, 3 images/min)
4. Content filter (`cfCheck` — blacklist + risk-score scan of Spanish/English profanity, with letter-spacing evasion detection); blocked users get auto-tagged `blacklist` and repeated offenders escalate silently to `ASESOR`
5. Frustration detection (`esFrustracion` — distinct from the content filter; routes visibly-angry-but-clean language to a human)
6. Image preprocessing — downloads media, optionally calls Google Vision (`bot/imageAnalyzer.js`, only if configured and `vision_activo` config flag is on), converts the result into a synthetic text query, and saves the image under `bot/imagenes_clientes/` for the dashboard
7. Complaint detection (`quejaCheck`, a 2-step stateful flow keyed by phrases in `_QUEJA_L1`/`_QUEJA_L2` plus tone heuristics) — escalates to `ASESOR` with a generated `CASO-YYYYMMDD-NNN` case number
8. Buying-intent detector + troll/blacklist word filter — only applies when `paso_actual === 'MENU'`; a large regex of Spanish purchase-intent verb forms extracts a product query and injects it as a `SEARCHING` action, bypassing the normal flow
9. Main handler — delegates to `bot/actionHandler.js`

A per-user mutex (`_enProceso` Set) prevents concurrent processing of two messages from the same sender. `sendSafe`/`sendWithTyping` wrap `client.sendMessage` with a 15s timeout and a simulated "typing..." delay.

A `cola_notificaciones` (notification queue) table is polled every 30s to send queued WhatsApp messages — including a fallback that retries `@c.us` JIDs as `@lid` if WhatsApp returns a LID-related error, then persists the corrected JID back onto the customer record.

### Session + flow routing (`bot/sessionManager.js`, `bot/actionHandler.js`, `bot/flows/`)

- **Sessions**: `sessionManager.js` keeps an in-memory `Map` (30 min TTL, max 500 entries, LRU-ish eviction) backed by the `sesiones_bot` SQLite table for durability across restarts. Each session is `{ paso_actual, data }` — `paso_actual` is a state name from the `S` enum in `bot/flows/_shared.js`. Abandoned carts are persisted to `carritos_abandonados` on session expiry.
- **Routing**: `actionHandler.handleAction` is the single router. Global shortcuts (reset to menu, "ver carrito", devolución detection) are checked first, then it dispatches to whichever module in the `FLOWS` array declares the current `paso_actual` in its exported `STEPS` array:
  - `flows/menuFlow.js` — MENU, SEARCHING, WIZARD, VIEW_PRODUCT, ADD_MORE
  - `flows/cartFlow.js` — SHOW_CART, CONFIRM_ORDER, OFERTAS, CUPON
  - `flows/orderFlow.js` — ASK_CP, SPLIT_*, DELIVERY, PICKUP_CONFIRM
  - `flows/addressFlow.js` — ASK_NOMBRE..ASK_REF
  - `flows/asesorFlow.js` — ASESOR, LISTA_ESPERA, SUSTITUTO, PREVENTA, CSAT, DEVOLUCION
  - A flow throwing resets the session to MENU rather than crashing the bot (caught per-flow in the dispatch loop).
  - The dispatch list is `[...FLOWS, ...giroFlows.flowsDeGiro(giro)]` — giro-specific flow modules are merged in after the universal ones (see "Extensibilidad" below; empty by default). Just before the rules fallback, `llmHandler.handle()` gets a chance at the unmatched text (off by default, passthrough).
  - **Adaptive main menu by giro**: the 5 canonical menu options (`buscar`/`wizard`/`rastrear`/`asesor`/`referidos`) are no longer hardcoded to fixed numeric positions. `_giros.menuDeGiro(giro)` returns a per-giro ordered subset (or `null` = the full 5). `_shared.resolverOpcionMenu(action)` maps the typed digit/keyword to a canonical key **against the giro's real visible order**, and `menuItemsActivos(giro)` additionally drops `referidos` when its module is off (adaptive giros only). `jugueteria` and `restaurante` keep all 5 (their menu text still comes from `t('menu_opciones')`, so Julio Cepeda is **byte-identical** — verified: digit 1–5 → the same five actions as before). Every other giro (retail/abarrotes/carnicería/ferretería/servicios/etc.) drops the toy-specific gift `wizard` ("ayúdame a elegir") since it's an age/gender gift quiz that only makes sense for a juguetería — those giros render a dynamically-built numbered list (`menuOpcionesAdaptativo`). This is what "no mostrar tantas opciones de más si fuera ropa" means: a clothing/retail giro shows Buscar/Rastrear/Asesor(/Referidos), not the gift wizard.
- **Shared logic** lives in `bot/flows/_shared.js` and is the real domain layer: product search/scoring (`searchProducts`, name > seo_description > tags > category, boosted by stock level), the recommendation wizard (`wizardSearch`), cart math, coupon application, split pickup/delivery partitioning by per-branch stock (`partirCarrito`), and order persistence (`grabarPedidoPickup`/`grabarPedidoEnvio`/`grabarPedidoSplit`). All flow modules import from here rather than talking to the DB directly for these concerns.
- **Tone/copy** is centralized in `bot/flows/_config.js`: four tone presets (A=formal, B=casual, C=friendly/default, D=sales-urgency) keyed by phrase ID, selected via the `configuracion.tono_bot` DB row and exposed through `t(clave, vars)`. Per-module feature flags (`puntos_activo`, `vision_activo`, etc.) are read the same way via `moduloActivo(clave)`. Business rule encoded in a comment here: the word "gratis" (free) may only ever describe shipping/flete, never product price.
  - **Single source of truth for module defaults (`bot/flows/modulosDefaults.js`)**: which modules start **OFF** by default lives in one shared `DEFAULT_OFF` array, imported by **both** `bot/flows/_config.js` (`moduloActivo` → what the bot does) and `dashboard/routes/primeConfig.js` (`GET /api/modulo/:clave` → what the panel shows). These two lists were previously duplicated and had **drifted** — the dashboard list omitted `pago_real_activo`/`estafeta_real_activo`/`reconexion_auto_activo`/`llm_activo`, so `/api/modulo/` reported some modules "active" that the bot treated as off. A module **not** in `DEFAULT_OFF` defaults ON (e.g. `entrega_pickup_activo`/`entrega_paqueteria_activo`). The frontend `Modulos.jsx` has its own `MODULOS` list but only for **display** (title/desc/which toggles to show); it reads the actual default from the backend, so it's not a third source of truth for defaults.
  - **Business-agnostic copy (Bloque 1)**: `t()` is no longer hardcoded to "Julio Cepeda Jugueterías"/"juguete". Every phrase is parameterized with `{negocio}`/`{negocio_corto}` (from `configuracion.nombre_negocio`/`nombre_negocio_corto`) and `{item}`/`{items}`/`{emoji}` (the *giro* vocabulary). The giro presets live in `bot/flows/_giros.js` (`jugueteria`, `restaurante`, `abarrotes`, `carniceria`, `ferreteria`, `servicios`, `mantenimiento`, `barberia`, `tatuajes`, `estetica`, `unas`, `retail`, `custom`), each with a `vocab` and optional full-phrase `frases` overrides (e.g. restaurante's "¿quieres ver el menú?"). The active giro is `configuracion.giro` (default `jugueteria`). Defaults are tuned so an instance **without** business config — or Julio Cepeda's, whose `giro=jugueteria`, `nombre_negocio='Julio Cepeda Jugueterías'`, `nombre_negocio_corto='Julio Cepeda'` were seeded by migration 0014 — renders **byte-identical** to the old hardcoded strings (verified against the real production DB). Inline strings in the flow files that aren't routed through `t()` use `vocab()` (exported from `_config.js` via `_shared.js`): `const V = vocab()` → `${V.item}`/`${V.items}`/`${V.emoji}`. All **live** customer-facing inline prompts were swept (search/menu/wizard/cart/confirmation messages); the only remaining literal "juguete" occurrences are in **dead `t(...) || 'fallback'` branches** (never rendered since `t()` always returns a value) and internal comments/category names.

### Loyalty points (`bot/handlers/puntosHandler.js`, `bot/handlers/puntosService.js`)

A separate module from the main pipeline/flow router. **Points are earned automatically by purchase or referral — there is no longer any physical ticket-QR scan.** The old `TK-XXXXXXXX` interceptor, the "Puntos QR" dashboard page, and the `/api/puntos/ticket|usados|preparar` routes were all removed. `puntosService.otorgarPuntosPorCompra(idPedido)` is the single earning trigger, fired from `POST /api/pagos/:id/marcar-pagado` (`dashboard/routes/comunicacionPedidos.js`) — credits 1 point per peso for **any** paid/confirmed order, idempotent via `pedidos.puntos_acreditados` (migration 0013). `revisarYOtorgarCupones(idCliente, telefono)` mints a 10%-off coupon (90-day, single-use, into `promociones` + `regalos_lealtad`) each time the customer's available balance crosses 2,000 points, capped at **4,000 redeemed points in any rolling 30-day window** (`MAX_PUNTOS_CANJE_30D`). The referral bonus (`referidosService.js`) calls the same `revisarYOtorgarCupones`. `puntosHandler.js` now only handles the "mis puntos" balance query. **Single source of truth for the on/off flag**: `puntosService.puntosActivo()` (default **off** — must be enabled from Módulos; `puntosHandler` delegates to it, fixing a prior default-mismatch bug where the handler defaulted on while the dashboard defaulted off). Dashboard still exposes `/api/puntos/config|ranking|:telefono`.

### Referral program (`bot/handlers/referidosService.js`)

`codigo_referido` is a **5-char alphanumeric code, no prefix** (charset without 0/O/I/1). On a customer's first message, `procesarReferidoSiAplica` scans all 5-char tokens against real `clientes.codigo_referido` values and links `referido_por_id` (link only, no reward). `otorgarPuntosPorPrimeraCompra` (fired from `marcar-pagado`) credits the referrer 100 points (cap: 3 referrals/week) and notifies them with their new total balance + any freshly-minted coupons. The referred customer gets an **automatic 10% welcome discount on their first purchase** (`calcularDescuentoReferido` → `marcarDescuentoReferidoUsado`, one-time via `clientes.descuento_referido_usado` from migration 0012), applied across all four `grabarPedido*` paths in `_shared.js`, **not** combinable with a manual coupon and void if the cart already contains an item on active offer. Menu option 5 (`S.REFERIDOS` state) shows the code + a submenu (share again / `TERMINOS_REFERIDOS` text / back). Contract tests: `tests/test_referidos.js`, `tests/test_puntos_compra.js`.

### Multi-negocio: giros + onboarding + métodos de pago (Bloque 1)

The system is **instance-per-tenant**, not multi-tenant-shared: each client = its own cloned folder + own SQLite + own WhatsApp number (works identically on a rented Linux box or a per-client cloud container). There is deliberately **no `tenant_id`** — the "business" is just this instance's `configuracion` rows. Decision driven by staying on `whatsapp-web.js` (each tenant needs its own Chromium/number anyway).

- **Onboarding (`dashboard/routes/negocioOnboarding.js`)**: `GET /api/onboarding/estado` + `POST /api/onboarding` are **public** (a fresh clone has no session yet) but self-lock once `configuracion.negocio_configurado='1'` (POST → 409). The wizard (`dashboard-ui/src/components/Onboarding.jsx`, gated in `App.jsx` when `!configurado`) creates the first admin user via UI, picks the giro, sets name/currency/IVA/tone/active payment methods. Migration 0014 is **data-aware**: an instance that already has products (= Julio Cepeda) is seeded with its real values + `negocio_configurado=1` (so it never sees onboarding); an empty clone is left blank (so it does).
- **Payment methods**: the `metodos_pago` catalog already existed in production (drift — now reconciled into `db/schema.sql`): `efectivo/transferencia/tarjeta/paypal/mercadopago/oxxo` with `activo`/`requiere_link`/`configuracion`(JSON, e.g. CLABE). `pedidos.metodo_pago` (migration 0014) records the per-order choice. Managed via `GET /api/metodos-pago` + `PUT /api/metodos-pago/:id` (gerente) and selected during onboarding. **In-bot interactive payment-method picker** (gated by `pago_multimetodo_activo`): when ON and 2+ methods are active, after order confirmation the bot routes to `S.PAGO_METODO` and asks the customer *how they'll pay* (not just shows the link). Helpers in `_shared.js`: `pagoMetodosActivos`/`menuPago`/`instruccionPago`/`registrarMetodoPago`/`debePreguntarMetodoPago`. Per-method instruction: **efectivo** = "pay on delivery/pickup", **tarjeta** = "pay on delivery, the courier brings a terminal" (cash-on-delivery with card), **transferencia** = CLABE (from `metodos_pago.configuracion`), link methods = the link. The `PAGO_METODO` handler (`cartFlow.js`) records `pedidos.metodo_pago` by folio. All three confirmation points (CONFIRM_ORDER, PICKUP_CONFIRM, SPLIT_CONFIRM) route there when applicable; with the flag OFF (Julio Cepeda) behavior is identical (link). "Pago real" (gateway) stays stubbed on purpose; `marcar-pagado` remains the single chokepoint all methods converge on.
- **Hevcaz Solutions support widget** (`dashboard-ui/src/components/SoporteWidget.jsx`, mounted in `Layout.jsx`): a floating bottom-right button on **every** instance (it's the software *provider's* brand, distinct from the client business name). Reads `GET /api/soporte` (provider contact from `SOPORTE_HEVCAZ_WHATSAPP`/`_NOMBRE`/`_EMAIL` env, configurable without rebuild).
- **Métodos de entrega como módulos (Bloque 2)**: each delivery method is a toggle read via `moduloActivo()` — `entrega_pickup_activo` (default ON), `entrega_paqueteria_activo` (default ON), `entrega_repartidor_activo` (default OFF, in `_DEFAULT_OFF`). `orderFlow.js`'s `ASK_CP` computes these and only offers active methods; with all defaults, Julio Cepeda's checkout is byte-identical (every gate is a no-op when pickup+paquetería on and repartidor off). `pedidos.metodo_entrega` ('pickup'|'paqueteria'|'repartidor') records the choice; `grabarPedidoEnvio` skips the Estafeta guide when it's `repartidor` (local delivery, no parcel). A pickup-only business (no domicilio method active) gets pickup/wait-in-store flows instead of delivery offers.
- **Repartidor propio (Bloque 2, módulo lean)**: the repartidor is **NOT a user/account and has no WhatsApp** — it's just data on the order (`pedidos.repartidor_nombre`/`repartidor_telefono`, optional `repartidores` catalog for reuse). The "va en camino con el repartidor 🛵" / "entregado" messages are sent by the **single business WhatsApp** (the bot, via `cola_notificaciones`), triggered when the operator clicks in `Pedidos.jsx` (the 🛵 action, only shown when the module is active). Endpoints: `POST /api/pedidos/:id/repartidor` (`accion: asignar|en_camino|entregado`) + `GET|POST /api/repartidores`, in `comunicacionPedidos.js`. Ties to cash-on-delivery via the existing `marcar-pagado` chokepoint. No routes/GPS/courier-app/commissions by design.
- **Costo/margen + entrada de mercancía (Bloque 2B)**: `productos.costo` (migration 0016, nullable) holds acquisition cost; margin (`price - costo`) is shown in the Prime catalog. `POST /api/prime/entrada-mercancia` (`primeCatalogo.js`, gerente+) receives stock for a product+sucursal: adds to `inventarios` (UPDATE/INSERT), optionally updates `productos.costo`, and logs an `inventario_movimientos` row (`tipo='entrada'`, with optional supplier in `motivo`). UI: 📥 action per product row in the Catálogo tab. Suppliers are a free-text field (no `proveedores` table yet — lean).
- **Facturación (Bloque 2B, módulo `facturacion_activo` default OFF)**: NO es CFDI timbrado — es un **comprobante con datos fiscales** (`pedidos.razon_social`/`rfc`, ya existentes) **+ número de referencia = el folio del pedido**. Modular porque no todos los negocios facturan; opcional porque no todo cliente factura. Cuando el módulo está activo y hay datos fiscales, el ticket (en `Pedidos.jsx` y en el POS `Mostrador.jsx`) anexa razón social/RFC + la referencia (folio) + la **leyenda** `LEYENDA_FACTURACION` (`dashboard-ui/src/lib/factura.js`): la factura solo se solicita **dentro del mes contable en curso**. El POS captura los datos fiscales en la venta (`POST /api/pos/venta` los guarda en el pedido).
- **POS de mostrador + corte de caja (Bloque 2B)**: módulo `pos_activo` (default OFF). `dashboard/routes/pos.js`: `GET /api/pos/config|productos` + `POST /api/pos/venta` are usable by **any session (cajero/usuario+)**; `GET|POST /api/pos/corte` are **gerente+** (it's a report). `POST /api/pos/venta` creates a counter sale (canal `'mostrador'`) reusing `_shared.insertarPedidoConCarrito` + `puntosService.otorgarPuntosPorCompra`: inserts pedido+detalle, marks a `links_pago` row paid, deducts inventory from `sucursal_facturacion_default`, awards points if a customer is attached, returns a ticket (with cash change). Corte de caja sums paid orders (WhatsApp + mostrador) by `metodo_pago` for a date, computes expected-vs-counted cash, and persists closes in `cortes_caja` (migration 0018). UI: `pages/Mostrador.jsx` (cart + cobrar + corte section, gated by `pos_activo` in the sidebar and role for the corte).

### Extensibilidad: flujos por giro + hueco de LLM + dataset (Bloque-extensibilidad)

Three coordinated extension points so the bot can grow per-giro behavior and, later, plug in an LLM — all **inert by default** (Julio Cepeda behaves byte-identically), all designed to **fail closed**:

- **Per-giro flow registry (`bot/flows/giroFlows.js`)**: `actionHandler.js`'s universal `FLOWS` array (menu/cart/order/address/asesor) is now **merged** at dispatch time with `giroFlows.flowsDeGiro(configuracion.giro)` — `const _flowsActivos = [...FLOWS, ...giroFlows.flowsDeGiro(_giro)]`. `GIRO_FLOWS` is an empty `{}` map today (no giro adds flows yet ⇒ no behavior change), but it's the documented hole to plug a giro-specific flow module **without touching the router**. To add one (e.g. a restaurante "ya tengo tu orden, se está preparando" kitchen-status state): create `bot/flows/restauranteFlow.js` exporting `{ STEPS, handle }` with **new** `S`-enum states (e.g. `S.ORDEN_PREPARANDO`), then register `restaurante: [require('./restauranteFlow')]` in `GIRO_FLOWS`. `flowsDeGiro` is `require`-tolerant (a broken giro flow returns `[]` rather than crashing the bot). Giro flows dispatch **after** the universal ones, so they can add states but never shadow core checkout.
- **LLM hook (`bot/handlers/llmHandler.js`)**: the **single** future integration point for an LLM, called from `actionHandler.js` **just before the rules fallback** (so the LLM only ever sees the free text the rule engine couldn't route — everything that already works stays untouched). Double-gated and **fails closed**: `llmActivo()` = `moduloActivo('llm_activo')` (in `_DEFAULT_OFF`, so default off) **AND** a configured provider key (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`). Today `handle()` always returns `null` (passthrough — bot behaves exactly as before). The file documents the intended completion: Anthropic SDK (`@anthropic-ai/sdk`), default model **`claude-opus-4-8`** (+ `claude-haiku-4-5` for cheap intent classification), **tool-use** (each tool maps to an existing `_shared.js` helper — buscar/agregar/crear pedido/escalar — so the LLM "conversa" but executes the same safe, auditable flow), agentic loop until `stop_reason: 'end_turn'`. The `actionHandler` call site swallows any hook error (`log.debug`) and falls through to the normal fallback.
- **Per-message dataset (`services/mensajeService.js` + migration 0019)**: `mensajes` gained `paso_actual` + `intencion` columns (migration 0019, mirrored in `db/schema.sql`). `registrarMensaje(db, telefono, rol, contenido, pasoActual, intencion)` now persists the flow state (and, later, the LLM-classified intent) **per message** — previously `paso_actual` only landed on `conversaciones.ultimo_paso`. The INSERT is **fallback-tolerant**: if the columns are absent (un-migrated DB), it silently falls back to the minimal INSERT. Together with the existing `conversaciones.outcome` label and the `log_eventos` `'fallback'` rows (the literal "text the rules couldn't handle"), this is the labeled training dataset the future LLM consumes — the fallback events are precisely "what the LLM should resolve next."
- **Dataset export by email (`services/datasetExport.js`, prime-only)**: `POST /api/prime/exportar-llm` (prime-only, in `primeConfig.js`) serializes the dataset above (one JSONL line of metadata, then one per conversation with its labeled turns `{rol,paso,intencion,texto,ts}` + outcome, then one per `'fallback'` event), **gzips** it, and emails it as an attachment to the backup destination (`configuracion.email_backup_destino`, same as `scripts/backup.js`) using the same hand-rolled SMTP-with-attachment pattern. **Training/fine-tuning is an external, off-production process** — this endpoint neither trains nor calls any LLM, it just gets the labeled data **off the box** (and leaves a backup copy) the way the DB backup does. The customer phone is **masked** (`521***1234`, same redaction as `bot/logger.js`) since the training signal is the text/flow, not the number. UI: a prime-only **"🤖 Datos LLM"** tab in `Prime.jsx` (`soloPrime`, like General/Usuarios) with a single export button.

### Standalone services (`services/`)

Beyond `stockWatcher.js`/`stockWatcher.worker.js` (see above), `services/` holds business logic invoked from both the bot and the dashboard, not bound to either process:
- `emailService.js` — hand-rolled SMTP client over raw `net`/`tls` (no `nodemailer`), used for order notification emails. Configured entirely via `EMAIL_*` env vars; `isConfigured()` gates whether sends are attempted.
- `estafetaService.js` — shipping guide simulation ("Phase 1"): generates a fake tracking number and computes a real delivery date 2 business days out (Estafeta doesn't deliver Sundays), with a 2pm cutoff after which the "ship date" rolls to the next day. A real-API integration point (`_callEstafetaAPI()`) is stubbed for "Phase 2" but not wired in.
- `stockService.js` — multi-strategy stock engine: national-network lookup ranked by per-branch delivery days (`DIAS_ENTREGA` map) and a flat `$149` shipping cost, plus waitlist/preventa/substitute-product strategies consumed by `bot/flows/_shared.js` and `stockWatcher.js`.

### Maintenance scripts (`scripts/`)

Not part of `ecosystem.config.js` — run manually/cron, not under pm2:
- `scripts/backup.js` — emails a compressed DB backup (11:00) and any new customer images from `bot/imagenes_clientes/` (11:30) via the same hand-rolled SMTP code pattern as `emailService.js`; tracks already-sent images in a local `.backup_registro.json` so re-runs don't resend. `node scripts/backup.js [db|imagenes]` to run one piece.
- `scripts/generar_sustitutos.js` — one-off (or per-catalog-refresh) batch job that populates `productos_similares` by scoring candidate products against a base product (category, brand, age range, gender, shared tags, price proximity within ±35%) and keeping the top scorers (max 5/product, min score 3). Exposed in the dashboard read/write path via `/api/sustitutos/*`.

### Validation (`bot/validators.js`)

Zod schemas validate dashboard POST bodies (`NotificarSchema`, `MasivoSchema`, `GuiaSchema`, `PreventaSchema`, `ModuloConfigSchema`) and incoming WhatsApp messages (`validarMensajeWhatsApp` rejects groups, broadcasts, status updates, and echoes of the bot's own messages). `validarEnv()` enforces `DB_PATH` and `CHROME_PATH` as hard requirements at boot (`process.exit(1)` if missing) and warns (non-fatal) if `ASESOR_WHATSAPP` or `DASHBOARD_PASS` are unset/default.

### Dashboard backend (`dashboard/server.js`)

Single-file native `http` server (no Express). Per-IP rate limiting and a fixed `SECURITY_HEADERS` object applied to every JSON response (CSP, X-Frame-Options, HSTS, etc.). Talks to the same `bot/db_connection.js` module the bot uses. All routing is a flat sequence of `if (p === '/api/...')` checks in one `handleAPI` function (40+ routes) rather than a router table — covers orders/guides, returns (`/api/devoluciones`), the human-attention queue (`/api/cola_atencion`), loyalty points (`/api/puntos/*`), promotions/coupons (`/api/promociones`, `/api/cupon/*`), substitutes (`/api/sustitutos/*`), tone/module config (`/api/tono`, `/api/modulo/:clave`), and bot process control (`/api/bot/start|stop|restart|status`, shelling out to `pm2.cmd`/`pm2` directly rather than going through `npm run start:all`; never pass `shell:true` to that `execFile` call — Node flags it as DEP0190 since args aren't escaped, and resolving the platform binary name directly is enough).

**Auth + RBAC (3 roles jerárquicos, Bloque 2B)**: real login + server-side sessions, not HTTP Basic Auth. A `usuarios` table (`username`, `password_hash`+`salt` via Node's native `crypto.scryptSync`, `rol` ∈ `usuario`|`gerente`|`prime`). The old `admin` role was consolidated into **`gerente`** (migration 0017 `admin→gerente`; `server.js` also maps `admin→`gerente's rank as a safety net). **Hierarchy** (`RANGO_ROL` in `server.js`, mirrored in `dashboard-ui/src/lib/roles.js`): `usuario`(1) < `gerente`(2) < `prime`(3). `requireSession(req, res, rolesPermitidos?)` is **rank-aware**: the array is treated as the *minimum* role — `['gerente']` lets gerente **and** prime through, `['prime']` is prime-only. Called once globally (any logged-in role) for all `/api/*` except `/api/login|logout|me|onboarding*|bot/qr`, then per-route with the minimum role. **Capability matrix**: `prime` = everything incl. user management + integrations (pago/estafeta real, negocio, tope-descuento) + can't delete self/last-prime; `gerente` = catálogo/inventario/sucursales/categorías/entrada-mercancía/módulos/tono/ofertas/cupones/métodos-pago + bot control; `usuario` (cashier) = atención/pedidos/devoluciones/chat/POS/bot control only. Seeded from `DASHBOARD_USER` (now role `gerente`) and `USER_PRIME` (role `prime`); the onboarding wizard creates the first user as **`prime`** (the owner). UI gates by rank: `Layout.jsx` sidebar filters links by `rolRequerido` (minimum), `App.jsx` route guards via `tieneRango`, and the Prime page (`/prime`) shows `soloPrime` tabs (General/Usuarios) only to prime while gerente sees Sucursales/Inventario/Catálogo/Filtros. `POST /api/login` issues an `HttpOnly; SameSite=Lax` cookie (`jc_session`); `GET /api/me` / `POST /api/logout` round it out.

Static assets are served unauthenticated on purpose — `serveStatic()` serves `dashboard-ui/dist` (the React build; without it, `/` returns a "run the build" placeholder). The login screen itself is part of that bundle/static HTML, so it has to be reachable before a session exists; everything under `/api/*` (except the three routes above) still requires a valid session.

**Bot status history**: `bot_status_log` table + `registrarCambioEstatusBot(estatus, motivo)` records a row only when the PM2-derived status actually changes (not on every poll), so `GET /api/bot/status-history` gives a real timeline instead of just the current snapshot — backs the animated status widget in the React header.

**Prime shipping cost**: `PUT /api/prime/envio/:id_pedido` (existing) corrects the shipping cost of one already-created order. `PUT /api/prime/envio-default` (no order id in the path) instead writes a `costo_envio_default` key into `configuracion`, for setting the default going forward without referencing any specific order — the order id is opt-in, not required.

### Dashboard frontend (`dashboard-ui/`)

React + Vite SPA, builds to `dashboard-ui/dist` (`npm run build:dashboard-ui`), which `dashboard/server.js` serves statically — no separate frontend server in production, same "one Node process" deployment shape as before. `npm run dev:dashboard-ui` runs the Vite dev server with `/api` proxied to `http://localhost:3001` for local development against a running backend. `dashboard-ui/dist` is **gitignored** — it's (re)built on the server at deploy time, not committed, so a source change to a `.jsx` only reaches production after `npm run build:dashboard-ui` runs there.

**Code-splitting (Bloque 3)**: `App.jsx` lazy-loads every route page via `React.lazy(() => import('./pages/X'))` wrapped in a `<Suspense>` (the shell — `Login`/`Onboarding`/`Layout` — stays eager). `vite.config.js` `manualChunks` pins `react`/`react-dom`/`react-router-dom`, `@mantine/*`, and `@tanstack/react-query` into separate cacheable vendor chunks. Net effect: the initial bundle dropped from a single ~1.1 MB chunk to ~50 KB app + cacheable vendors, and the heavy `recharts` (~434 KB, used only by `Metricas`) is no longer in the initial load — it's deferred into the Métricas page chunk and only fetched when that page is opened. When adding a new page, register it as another `lazy(...)` in `App.jsx`, not a static import, to keep it out of the initial bundle.

**Inicio KPIs (Bloque 3)**: `pages/Inicio.jsx` surfaces daily-operation KPIs grouped "Hoy" / "General" from `GET /api/stats` (`dashboard/routes/core.js`) — including `ventas_hoy` (SUM of `links_pago.monto` paid today via `pagado_en`) and `pedidos_pagados_hoy`, both added to the stats endpoint. The "clientes esperando atención" card only renders when `cola_atencion > 0` (same conditional pattern as the existing emails-error card).

**Prime page split (Bloque 3)**: `pages/Prime.jsx` was ~1390 lines with all 7 tabs inline; it's now a thin orchestrator (~55 lines) that renders one component per tab from `pages/prime/`: `GeneralTab` / `SucursalesTab` / `InventarioTab` / `CatalogoTab` / `UsuariosTab` / `DatosLLMTab` / `FiltrosTab`, plus `prime/productoCampos.jsx` (shared `PRODUCTO_VACIO`, `armarDatosProducto`, and the `<CamposProducto>`/`<SelectCategoria>` components used by both alta and edición in CatalogoTab). Each tab owns its own state/queries/mutations; shared queries (`['prime-sucursales']`, `['prime-categorias']`) are fetched independently per tab but **deduped by React Query's queryKey** (no double network fetch). The `soloPrime` gating still lives on the `TABS` array in `Prime.jsx`. Tab components mount only when their tab is active (`{TabActivo && <TabActivo/>}`), so each tab's queries fire on first open rather than all on page load. When adding a Prime tab, create a `pages/prime/XxxTab.jsx` and register it in the `TABS` array with its `Componente`.

Structure: `src/context/AuthContext.jsx` wraps `/api/login`/`/api/me`/`/api/logout` and exposes `{ user, login, logout }`; `src/api.js` is a tiny `fetch` wrapper (`credentials:'include'` for the session cookie, no axios; `get`/`post`/`put`/`del` — `del` takes an optional body for routes like `DELETE /api/cola/programados` that need one to identify the target); `src/components/Layout.jsx` is the sidebar+header shell (the sidebar hides/shows the "Prime" link based on `user.rol`, not a separate page/section); `src/components/BotStatusWidget.jsx` polls `/api/bot/status` and renders the animated header widget + `/api/bot/status-history` dropdown with start/stop/restart actions. Visual system is a hand-written `src/styles.css` (CSS custom properties; **default theme is the minimal light palette** — gray canvas, white cards, dark monochrome accent, one dark `kpi-dark` accent card on Inicio, per the client's visual reference; dark/confort remain as ThemeSwitcher options) — deliberately avoids loading Google Fonts so it doesn't need a CSP exception; falls back to the OS system font stack.

All 20 sections of the legacy `dashboard.html` have been ported to `src/pages/`: Inicio, Pedidos, Devoluciones, Clientes, Guías Estafeta, Notificaciones (individual + masivo, including the POS "venta previa" sub-feature), Cola de envíos, Cola de atención, Lista de Espera, Preventas, Ofertas, Promociones, Sustitutos, Puntos QR, Ranking, Métricas (the old "conversión" page), Búsquedas, Módulos, Beta/Pruebas, and Prime (role-gated). `dashboard.html` itself was **deleted** (2026-07) — the React build is the only UI. Reusable building blocks: `components/Badge.jsx` (per-domain color maps — `pago`, `devolucion`, `cola`, `guia`, `notif`, keyed by string value) and `components/Modal.jsx`; `lib/format.js` exports `fmt`/`fdate`/`soloTelefono`. A few legacy features were deliberately **not** ported because they had no real backend behind them (confirmed by grep before excluding, not assumed): the Módulos page's theme switcher and the Métricas page's "reporte automático diario" scheduler — both were `localStorage`-only no-ops in the legacy JS, with zero server-side cron/sending logic.

### Desktop shell (`desktop/`)

Electron app, package name **`botdashapp`** (`desktop/package.json`'s `name`, and `app.setName('botdashapp')` in `main.js` — the internal process/app identifier, distinct from the user-facing `BrowserWindow` title `'Julio Cepeda — Panel'`, which stays as business branding). Not packaged/signed (run via `npm --prefix desktop start` / `npx --prefix desktop electron desktop`, no installer). `main.js` opens a single `BrowserWindow` pointed at `DASHBOARD_URL` (default `http://localhost:3001`), retrying `loadURL` for ~20s in case PM2 hasn't finished bringing the dashboard up yet. Closing the window intercepts the `close` event and shows a native confirm dialog with three choices — Cancel, "Solo cerrar ventana" (just destroys the window; the bot and dashboard keep running under PM2, since they're independent OS processes, not children of Electron), and "Apagar todo" (`pm2 stop all` via the same platform-aware `execFile` pattern as `dashboard/server.js`, then quits). `start.bat` launches `pm2 start ecosystem.config.js` then this Electron window instead of opening the OS default browser; `stop.bat` now just runs `pm2 stop all` instead of killing whatever's bound to port 3000 (stale port from before the dashboard moved to 3001). Both `.bat` files `cd /d "%~dp0"` (the script's own directory) rather than a hardcoded path, so they work from any checkout location; `ecosystem.config.js`'s two pm2 apps set `cwd: __dirname` for the same reason.

The NixOS scripts (`instalador/iniciar/detener-nixos-chatbot.sh` + `flake.nix`) and the Windows installer wizards (`instalador-windows-*.ps1`/`.bat`) were **deleted** (2026-07) — server deployment target is now Docker on Ubuntu; Windows keeps only `start.bat`/`stop.bat` for local dev/review. `package.json` still exposes `install:all` (a single npm command — `npm ci` + build `dashboard-ui` + install `desktop/`).

### Logging (`bot/logger.js`)

Custom leveled logger (`debug|info|warn|error`, controlled by `LOG_LEVEL` env var), writes colorized to console and plain to a file under `bot/logs/`. Auto-redacts phone numbers in both `userId` fields and ad-hoc log lines (`replace(/(\d{3})\d+(\d{4})/, '$1***$2')`) — preserve this redaction pattern when adding new log calls that include a phone number.

### Env loading

`bot/index.js`, `bot/db_connection.js`, `dashboard/server.js`, `services/emailService.js`, `services/stockWatcher.worker.js`, and `scripts/backup.js` each independently call `require('dotenv').config()` as their first action (before any other `require`, so env vars are set before dependent modules read `process.env`). There's no shared bootstrap module — every new entry point needs its own `require('dotenv').config()` call at the top, and it must come before requiring modules that read env vars at load time (e.g. `db_connection.js`, `validators.js`). `tests/test_full_bot.js` hand-rolls its own minimal `.env` line parser instead of using `dotenv`, reading from the project root (`path.join(__dirname, '..', '.env')`, since the script itself lives in `tests/`).
