# REVISIÓN COMPARATIVA — bothHS vs ERPs establecidos (Odoo / SAP B1 / NetSuite / Zoho / Square)

Segunda ronda. Basada en el código real de la rama actual (commits `550f3fe` Ola 1 UI y `5f3c606` selector de tienda), leído con Read/Grep — no en suposiciones. Severidades: 🔴 crítico · 🟠 importante · 🟢 deseable.

---

## VEREDICTO EJECUTIVO

**¿Está listo para venderse contra Odoo/Zoho en pyme MX?** Casi — para el segmento correcto. Contra Odoo Community o Zoho Books en una pyme de 1-5 sucursales que vive de WhatsApp, el producto ya compite y tiene un diferenciador que ninguno de los cinco tiene nativo (el bot de ventas por WhatsApp con POS, lealtad y multitienda integrados). NO compite todavía donde la pyme MX exige factura: **sin timbrado CFDI real está fuera de la conversación** contra Aspel/CONTPAQi/Odoo MX en cualquier negocio que facture. Y hay **un bug de integridad real** en la feature nueva (selector de tienda) que hay que cerrar antes de demos con datos vivos.

**Las 5 cosas a cerrar primero, en orden:**
1. 🔴 **Split-brain del selector de tienda**: `POST /api/instancias/abrir` reinicia SOLO el dashboard (`process.exit(0)` en `instancias.js:77`); el **bot es otro proceso pm2** y sigue con la BD anterior abierta — dashboard en tienda B, bot vendiendo/escribiendo en tienda A hasta que alguien lo reinicie a mano. Fix: en `abrir()`, antes del exit, `pm2 restart bot` con el helper `pm2()` que ya existe en `server.js:65` (o restart all).
2. 🔴 **Conectar el PAC** (el andamiaje `services/pacService.js`/`cfdiService.js` ya existe, inerte): sin CFDI 4.0 timbrado no hay venta en pyme MX formal.
3. 🟠 **Candado del auditor demasiado ancho** (`server.js:368`): auditor+GET brinca CUALQUIER gate de rango, incluido `['prime']` — puede listar `/api/instancias` (todas las BDs de tenants) y leer config prime. Fix de 1 línea: solo conceder el bypass cuando `minRango <= rangoDe('gerente')`.
4. 🟠 **`--brand` roto fuera del tema claro**: los tokens de la Ola 1 solo se definieron bajo `[data-mantine-color-scheme="light"]` (`styles.css:57-66`); `styles.css:522` usa `var(--brand)` en un gradiente que en dark/color/confort es variable indefinida → card KPI héroe sin fondo. Fix: definir `--brand/--brand-soft/--brand-ink/--info` también en `:root` y en los otros dos temas.
5. 🟠 **Ola 2 de la propuesta (Compras unificada + Catálogo como página)**: la queja original del dueño ("unas cosas aquí y otras por allá") sigue abierta — la Ola 1 arregló la cara, no el mapa.

---

## EJE 1 — CARENCIAS FUNCIONALES

Verificado que **ya existe** (no son carencias): partida doble con asientos y dimensión sucursal (`erpContabilidad.js`), CxP/CxC, kardex, POS con corte (`pos.js`, `cortes_caja`), nómina MX aproximada (`nominaService.js`, `rrhh.js`), citas, mesas, PIN de autorización (`autorizacion.js`), lealtad/referidos, multitienda por sucursal en asientos, ingesta de CFDI por XML en Compras.

| Carencia | Sev. | Cómo lo hace el benchmark vs nosotros |
|---|---|---|
| **Timbrado CFDI 4.0 real** | 🔴 | Odoo MX/CONTPAQi timbran con PAC integrado; nosotros leemos XML de proveedores (`compras/factura-xml` ✓) pero solo *emitimos* "comprobante con datos fiscales". `pacService.js` está listo e inerte — es conectar credenciales, no construir. |
| **Conciliación bancaria** | 🟠 | Zoho Books/Odoo importan estado de cuenta (CSV/OFX) y concilian contra asientos con matching sugerido. Aquí no existe nada (grep: cero hits reales). Para el flujo de caja que ya tenemos (`FlujoCajaTab`) es el siguiente paso natural: import CSV + match manual basta para pyme. |
| **Reportes fiscales MX** (DIOT, contabilidad electrónica XML, IVA acreditable/trasladado) | 🟠 | Aspel/CONTPAQi los generan de fábrica; Odoo MX vía localización. Tenemos `GastosImpuestosTab` (aprox) pero nada exportable al SAT. Sin esto el contador del cliente seguirá usando otro sistema al lado — el ERP queda como "operativo", no "contable". |
| **Multi-moneda** | 🟢 | NetSuite/Odoo nativo; nosotros MXN fijo (`crearInstanciaDemo.js:50` y config). Correcto para el segmento — no gastar aquí. |
| **Recepción parcial / 3-way match en OC** | 🟢 | SAP B1 hace OC→recepción→factura con match; nosotros OC + factura sin recepción formal parcial. Deseable cuando haya clientes con volumen de compras. |
| **Reporte consolidado multi-tienda** | 🟠 | Odoo multi-company consolida; nuestro modelo "una BD por tienda" hace imposible un P&L consolidado sin herramienta extra (ver Eje 4). Si el pitch incluye "dueño con 3 tiendas", esto se va a pedir en el mes 1. |
| **E-commerce/catálogo público** | 🟢 | Odoo/Square lo traen; nuestro canal ES WhatsApp — es el diferenciador, no una carencia. No construir tienda web. |

**Posicionamiento honesto**: somos "Square/Loyverse + bot WhatsApp + contabilidad ligera", no "Odoo completo". Esa frase vende mejor que fingir paridad.

## EJE 2 — ACOMODO (IA / NAVEGACIÓN)

Aplicado de la propuesta: Ola 1 completa ✓ (verificado en `styles.css`: radios 10/14, `td` 9px≈filas 40px, `tabular-nums`, `.empty-accion`, panel de claves crudas fuera de Módulos, tabs de Finanzas con `?tab=` y título contextual). Pendiente: **Olas 2, 3 y 4 completas**.

¿Sigue siendo correcto el orden? **Sí, con un ajuste**: el selector de tienda (que no estaba en el plan) hace MÁS urgente el punto 9 de la Ola 2 (reagrupar sidebar), porque ahora un prime demo-ea saltando entre giros y ve en segundos si el menú de una barbería tiene jerga de paquetería — la poda por giro vía `MODULOS_POR_GIRO` ya aplicada cubre la mayor parte ✓. Prioridad revisada:

1. **Ola 2.6-2.7** (Compras unificada + Catálogo a página): sigue siendo la queja literal del dueño. `Compras.jsx:40` todavía trae el letrero "las órdenes de compra están en ERP →". Sin cambios de componentes, solo contenedores.
2. **Ola 3.11** (tab Resumen por módulo) sube un puesto: con el switcher de instancias, cada demo por giro abre en Finanzas/Almacén y lo primero que se ve debe ser un overview, no "Sin proveedores todavía" (aunque ahora al menos es accionable ✓).
3. **Ola 2.8** (sub-nav vertical en Finanzas): ERP quedó en tabs deep-linkeables ✓ pero siguen siendo 12 en dos renglones para finanzas/prime.
4. Ola 4 (POS fullscreen, ficha de cliente) sin cambios: post-venta.

Comparación: Odoo tras elegir app muestra SU overview; nosotros tras elegir tienda mostramos el mismo Inicio genérico. El "momento demo" del switcher merece que Inicio salude con el giro ("Barbería El Patrón — citas de hoy") — ya hay `VistaEspecialista`/vistas por rol, falta variar el hero por giro (barato: los módulos activos ya dicen qué cards mostrar).

## EJE 3 — DISEÑO (evaluación de la Ola 1 aplicada)

Bien ejecutado: tokens honestos (se quitó el Poppins/Inter fantasma y se documentó el porqué en `styles.css:24-26` ✓), reglas de composición pegadas como comentario ✓, sombras de card a 1px ✓, `--font-mono` para folios ✓.

Incoherencias concretas:

| Problema | Sev. | Detalle y fix |
|---|---|---|
| `--brand` solo existe en tema claro | 🟠 | `styles.css:57-66` define `--brand/--brand-soft/--brand-ink/--info` únicamente bajo `[data-mantine-color-scheme="light"]`. `styles.css:522` (`linear-gradient(150deg, var(--brand), var(--brand-ink)) !important`) se evalúa en TODOS los temas → en dark (`:root`), color y confort el gradiente es inválido (background se descarta). Fix: mover `--brand*` e `--info` a `:root` con valores por tema (dark: `#2c6a56`; confort: mapear a su ámbar; color: su naranja) o al menos fallback `var(--brand, var(--accent))`. |
| Tres identidades visuales conviven | 🟠 | El tema "color" (`styles.css:79-106`) conserva naranja/morado, gradientes y glassmorphism — exactamente la estética "template" que la Ola 1 mató en el tema claro. Odoo/Zoho tienen UN lenguaje con variantes light/dark, no tres personalidades. Recomendación: derivar los temas alternos de los mismos tokens (`--brand` recoloreado) y quitarles gradientes/pills, o degradar "color" a legado no-default. |
| Pills en botones siguen | 🟢 | `.btn` sigue con `border-radius: 999px` (la propuesta D3 decía 8px, pill solo para badges). Menor, pero es de los tics de plantilla más visibles. |
| Falta el elemento distintivo (D5) | 🟢 | La "regleta de módulo" (barra 3px + chip de color por dominio) no se aplicó — era el ancla de identidad de producto. ~30 líneas CSS, cero riesgo; buena candidata para la próxima pasada. |
| Estados hover/focus | 🟢 | `tbody tr:hover` ✓ (`styles.css:566`); focus de inputs sigue solo con cambio de borde a `--accent` — con el verde bosque el contraste de foco es sutil; agregar `outline: 2px solid var(--brand-soft)` ayuda accesibilidad sin rediseño. |

## EJE 4 — ARQUITECTURA

Lo que un arquitecto de ERP aplaudiría: instancia-por-tenant con SQLite (aislamiento perfecto, backup=copiar archivo, cero noisy-neighbor — es literalmente el modelo que usan los POS locales tipo Loyverse offline), migraciones versionadas con baseline ✓, registro declarativo de rutas (`_construirModulo`) ✓, puntero que **nunca mueve archivos de datos** ✓, validación del puntero en ambos lados ✓.

Lo que haría distinto / riesgos reales a 10-50 clientes:

| Punto | Sev. | Análisis |
|---|---|---|
| **Reinicio parcial al cambiar de tienda** | 🔴 | Ya descrito en veredicto #1: `instancias.js:77` solo mata el dashboard. El bot (proceso pm2 hermano) y el `stockWatcher` (hijo del bot) siguen en la BD anterior. No es teórico: el bot escribe pedidos/sesiones cada minuto. Fix mínimo: `pm2 restart` de ambos apps en `abrir()`. |
| **Dos modelos de multitienda compitiendo** | 🟠 | Ya existe multitienda REAL dentro de una BD (dimensión `sucursales` en inventario y asientos — Ola D). El selector de instancias agrega "una BD por tienda". Un arquitecto separaría los conceptos con nombres distintos en la UI: *sucursales* = tiendas del MISMO negocio (consolidan); *instancias* = negocios/demos distintos (no consolidan). Si un cliente real usa instancias para sus 3 tiendas, pierde el consolidado y duplica catálogo — hay que impedir esa tentación con copy claro en el switcher. |
| **Prefijo débil en la validación del puntero** | 🟠 | `bot/db_connection.js:25` usa `path.resolve(_ruta).startsWith(_dirInstancias)` — sin separador final, `C:\...\instancias-evil\x.db` pasa el check. Explotarlo requiere escribir el puntero (endpoint prime ya restringe a basename, sería vía filesystem), pero el fix es gratis: `startsWith(_dirInstancias + path.sep)`. |
| **Escala 10-50 clientes** | 🟢 | El modelo instancia-por-cliente (carpeta+BD+número WhatsApp propios) escala bien administrativamente hasta ~50 con Docker por cliente; lo que NO escala es la operación manual (deploys, migraciones, monitoreo por caja). Antes de 10 clientes: un script de flota (`node scripts/migrate.js` sobre N instancias + healthcheck que reporte a un canal). No hace falta multi-tenant compartido — whatsapp-web.js lo impide de todos modos. |
| **SQLite WAL, 2 procesos** | 🟢 | Correcto a esta escala (WAL + busy_timeout 5s). El riesgo real no es concurrencia sino **transacciones largas del dashboard** bloqueando el checkpoint; vigilar el tamaño del `-wal`. A 50 clientes cada uno tiene SU archivo — no hay efecto acumulado. Postgres sería resolver un problema que no se tiene. |
| **Restart como mecanismo de recarga** | 🟢 | exit(0)+pm2 es "boring tech" y está bien para cambiar de BD (~4s). NetSuite/Odoo recargan en caliente porque son multi-tenant; nosotros no lo necesitamos. Dejarlo. |

## EJE 5 — SEGURIDAD (revisado en código, archivo:línea)

Sólido de base: sesiones HMAC-firmadas con secreto local fuera de la BD (`server.js:283-318` — mejor que muchos ERPs pyme), scrypt para passwords y PIN (`autorizacion.js:15` con `timingSafeEqual` ✓), lockout por username además de rate-limit por IP (`server.js:124-155`), X-Forwarded-For solo con `TRUST_PROXY=1` (`server.js:100`), auditor con bloqueo global de escritura (`server.js:655`), single-session por usuario (`server.js:309`).

Agujeros concretos:

| # | Agujero | Sev. | Archivo:línea | Fix |
|---|---|---|---|---|
| 1 | **Auditor lee rutas prime-only**: el bypass GET no tiene techo de rango — con `roles:['prime']` (minRango 3) el auditor (rango 1) pasa igual. Puede listar todas las BDs de `instancias/` con nombre/giro, leer config prime e integraciones. | 🟠 | `server.js:368` | `if (!autorizado && permisos.esAuditor(s.rol) && req.method === 'GET' && minRango <= rangoDe('gerente')) autorizado = true;` |
| 2 | **DoS por reinicio repetido**: `abrir` no tiene cooldown — una sesión prime (o su token robado) puede tumbar el dashboard cada ~4s indefinidamente; pm2 con `max_restarts` podría incluso dejar de levantarlo. El rate-limit (80 POST/min) no aplica techo útil aquí. | 🟠 | `instancias.js:77` | Cooldown módulo-local: rechazar si hubo un `abrir` hace <60s (una variable con timestamp basta). |
| 3 | **Path traversal del puntero (lado lector)**: prefijo sin separador acepta carpetas hermanas `instancias*`. El escritor (`instancias.js:65`) sí valida basename ✓ — la asimetría es el hueco. | 🟠 | `bot/db_connection.js:25` | `startsWith(_dirInstancias + path.sep)`. |
| 4 | **Credencial semilla por default**: sin `.env`, se crea el usuario `admin`/`cambiar_esto` con rol gerente; `validarEnv()` solo lo advierte, no lo impide. En un clon instalado con prisa queda una puerta conocida. | 🟠 | `server.js:77-78, 235` | Negarse a sembrar si `DASH_PASS === 'cambiar_esto'` (log claro), o forzar cambio en primer login. |
| 5 | **Cookie sin `Secure`** por default: decisión documentada y razonable para 127.0.0.1/Electron (`server.js:81-86`), pero el flag depende de que quien despliegue detrás de Caddy se acuerde de `DASHBOARD_COOKIE_SECURE=true`. | 🟢 | `server.js:85` | Auto-activar cuando `TRUST_PROXY==='1'` (si hay proxy, hay TLS). |
| 6 | **CSP con `unsafe-inline`** en script-src: pendiente conocido; con React/Vite el camino es nonce o mover los inline. Riesgo real bajo (app local, sin contenido de terceros), pero es lo primero que marca cualquier scanner en una evaluación de compra. | 🟢 | `server.js:384` | Build sin inline scripts (Vite ya lo permite) y quitar `unsafe-inline` de script-src; style-src puede quedarse. |
| 7 | **Lockout como arma**: 5 intentos fallidos bloquean al username 15 min sin importar IP — un tercero que conozca el username puede mantener fuera al dueño a costo cero. | 🟢 | `server.js:129-148` | Aceptable en pyme; si molesta, combinar username+IP en la llave del lockout. |
| 8 | **PII en logs**: `bot/logger.js` redacta teléfonos ✓; el log de instancias registra solo username+clave de tienda ✓. Sin hallazgos nuevos. | ✓ | — | — |

**Nota positiva**: la respuesta de `abrir` sale ANTES del exit (`instancias.js:74-77`) y el audit-log registra quién cambió de tienda (`configAudit`, línea 72) — trazabilidad que ni Zoho da en su plan base.

---

### Cierre

El producto ya no "se ve a medias" en el tema claro — la deuda ahora es de mapa (Olas 2-3), de coherencia entre temas, y de dos cierres duros para vender en MX: **PAC** y el **fix del split-brain del switcher**. Con esos cinco puntos del veredicto cerrados, la comparación contra Odoo/Zoho en pyme mexicana chica se gana por canal (WhatsApp) y por precio de implementación, que es donde Odoo pierde siempre.
