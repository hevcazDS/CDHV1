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
11. **`scripts/migrate.js` solo migra la BD del `.env`**, no `instancias/*.db` — con múltiples
    clones, esquemas divergentes garantizados (`REVISION_ARQUITECTURA_V2.md` ALTO 2). No aplica
    a esta instancia única de Julio Cepeda, pero si algún día se clona, revisar antes.
12. Boilerplate `readBody+JSON.parse+try/catch` repetido ~100+ veces en rutas — refactor de
    mayor ROI señalado (extender el tronco con `body:true`+`schema:`), nunca ejecutado.
13. Backup: **`scripts/backup.js` en su día no cubría `instancias/*.db`** — irrelevante aquí
    (instancia única), pero si se clona el negocio, revisar.

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
