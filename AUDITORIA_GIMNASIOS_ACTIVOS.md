# Auditoría: Giro GIMNASIOS + Activos Fijos

> Análisis de solo lectura sobre el repo `bothHS 1.2`. No implementa código.
> Fecha: 2026-07-18. El bot de WhatsApp es el centro; sistema white-label, instancia por cliente.

---

## PARTE A — ¿El sistema soporta el giro GIMNASIOS?

Un gimnasio vende: (1) **membresías mensuales recurrentes**, (2) **clases/citas con entrenador** (con cupo por horario), (3) **control de acceso/asistencia**, y (4) opcionalmente **retail** (suplementos, agua, ropa).

### Estado actual (evidencia)

**El giro `gimnasio` NO existe.** No está en `GIROS` de `bot/flows/_giros.js` (líneas 19-99: jugueteria, retail, restaurante, abarrotes, carniceria, ferreteria, servicios, mantenimiento, barberia, tatuajes, estetica, unas, custom). Tampoco en `MENU_GIRO` (`_giros.js:121`), `MODULOS_POR_GIRO` (`modulosDefaults.js:90`), ni en el ajuste de `max_unidades_producto` del onboarding (`negocioOnboarding.js:67`).

**Lo que SÍ existe y sirve de molde / se reusa:**

- **Suscripción recurrente = membresía mensual → YA CUBIERTA en lo esencial.** `services/suscripcionCobro.js`:
  - `generarCargo` (línea 24) crea el cargo de un período reusando la ruta de dinero sellada (pedido canal `'suscripcion'` + `links_pago 'generado'`), avanza `proximo_cobro` un mes (`_sumarMes`, línea 7, clamp a día ≤28 para evitar meses cortos), y el cobro se confirma en `marcar-pagado` como todo lo demás → dispara puntos/contabilidad por el mismo chokepoint.
  - `generarCobrosVencidos` (línea 44) cobra todas las suscripciones `activa` con `proximo_cobro <= hoy`; una mala no frena a las demás. El tick automático corre desde `stockWatcher` (F6).
  - Módulo `suscripcion_activo` (default OFF, `modulosDefaults.js:54`) + proyección MRR mencionada en el header.
  - **Conclusión suscripción: una mensualidad de gym es exactamente una suscripción de monto fijo. Funciona tal cual.** Falta solo vocabulario ("membresía" vs "suscripción") y el ciclo de "congelar/reactivar" (ver brecha).

- **Citas con cupo = clases con entrenador → YA CUBIERTA, incluido el cupo.** `bot/flows/citasFlow.js`:
  - `slotsLibres` (línea 31) respeta `citas_capacidad` (config, default 1) por slot: `if ((ocupadas[hora]||0) < cap)`. **Soporta cupo por horario > 1**, no es 1 a la vez. Un spinning de 15 lugares = `citas_capacidad=15`.
  - Horario configurable sin reiniciar: `citas_hora_inicio/fin/duracion_min/capacidad`.
  - Elige "servicio" del catálogo (`productos tipo='servicio'`) → aquí el "servicio" es la clase (spinning, yoga, etc.).
  - Anticipo opcional (`citas_anticipo_pct`, línea 156) genera link de pago. Recordatorio 1 día antes.
  - Módulo `citas_activo` (default OFF, `modulosDefaults.js:29`).
  - **Limitación real:** el cupo es un **número único global** (`citas_capacidad`), no por clase ni por entrenador. Todas las clases del mismo horario comparten el mismo cupo. Para gyms chicos alcanza; para uno con varias salas simultáneas, no distingue "spinning=15 / yoga=20 a la misma hora".

- **POS / retail** (`pos_activo`) para venta de suplementos en mostrador — reutilizable sin cambios.
- **Onboarding acepta cualquier giro nuevo automáticamente:** `negocioOnboarding.js:27` genera la lista desde `Object.keys(GIROS)`, valida contra `GIROS[giro]` (línea 48) y aplica `MODULOS_POR_GIRO[giro]` (línea 63). **Agregar la clave `gimnasio` a esos dos objetos lo hace aparecer en el wizard sin tocar backend ni UI.**

### Brecha

| Necesidad gym | ¿Existe? | Nota |
|---|---|---|
| Membresía mensual recurrente | ✅ Sí | `suscripcion_activo` tal cual |
| Reservar clase/cita | ✅ Sí | `citas_activo` |
| Cupo por horario | ✅ Sí (global) | `citas_capacidad`; **no** por clase/sala |
| Vocabulario ("membresía", "clase", 💪) | ❌ No | falta preset de giro |
| **Control de asistencia / check-in** | ❌ No | no hay tabla ni flujo de asistencia/acceso |
| **Congelar/pausar membresía** | ❌ No | `suscripciones.estatus` existe (`activa`) pero no hay flujo "congelar" que suspenda el cobro y luego reanude corriendo `proximo_cobro` |
| Cupo por clase/entrenador distinto | ⚠️ Parcial | cupo global, no por servicio |
| Retail suplementos | ✅ Sí | `pos_activo` |

### Diseño mínimo

**P0 — habilitar el giro sin motor nuevo (todo config + un preset):**
1. Agregar a `_giros.js` `GIROS.gimnasio` con `vocab: { item: 'clase', items: 'clases', emoji: '💪' }` y opcional `frases.menu_opciones` ("Ver clases / Reservar / Mi membresía"). Usar `estetica`/`servicios` como molde (menú de servicio con "citas").
2. Registrar `gimnasio` en `MENU_GIRO` (`_giros.js:121`) con `_MENU_SERVICIO` (buscar/citas/rastrear/asesor/referidos) — el wizard de regalo no aplica.
3. Registrar en `MODULOS_POR_GIRO` (`modulosDefaults.js:90`): `gimnasio: ['citas_activo', 'suscripcion_activo', 'pos_activo']`.
4. Onboarding ya lo recoge solo. Configurar `citas_capacidad` al cupo de sala.

Con eso un gym ya: cobra mensualidad recurrente, deja reservar clases con cupo, y vende suplementos en mostrador. **Cero motor nuevo.**

**P1 — lo que un gym operativo pide y hoy falta:**
1. **Congelar membresía:** añadir estatus `'congelada'` en `suscripciones` y que `generarCobrosVencidos` (`suscripcionCobro.js:46`) filtre `estatus='activa'` (ya lo hace) → congelar solo cambia el estatus. Reactivar = poner `proximo_cobro` a hoy+días restantes. Es 1 columna de estado + 2 endpoints, sin motor.
2. **Check-in / asistencia:** tabla `asistencias (id, id_cliente/telefono, fecha, hora, tipo)`. Mínimo: el socio manda "llegué" por WhatsApp o el mostrador registra en POS; sirve para reportes de uso. No requiere hardware; el "control de acceso" con torniquete es hardware fuera de alcance (marcarlo como Fase 2).
3. **Cupo por clase:** mover la capacidad de config global a una columna en el "servicio" (`productos`), y que `slotsLibres` (`citasFlow.js:31`) lea el cupo del servicio elegido en vez de `citas_capacidad`. Cambio localizado en una función.

**Recomendación:** P0 es un PR de ~15 líneas (dos objetos + un vocab). P1 solo si el cliente gym lo pide; el 80% opera con P0.

---

## PARTE B — ¿El inventario maneja ACTIVOS FIJOS?

El dueño afirma que "el inventario ya tiene secciones de activos fijos: equipo, maquinaria, vehículos, cómputo, inmuebles". **Verificación honesta contra el código.**

### Estado actual (evidencia)

**NO existe manejo de activos fijos. El dueño lo está asumiendo.** Evidencia:

1. **Esquema (`db/schema.sql`):** No hay ninguna tabla `activos_fijos`, `activos`, `depreciacion`, ni columna `tipo_activo`. `grep -i "activo_fijo|activos_fijos|depreciaci|tipo_activo"` sobre el esquema → **0 coincidencias**.
2. **`productos.tipo` (`schema.sql:278`):** `TEXT NOT NULL DEFAULT 'fisico'` con valores `fisico | consumible | servicio` (migración 0023). **No incluye `activo_fijo`.** El inventario es exclusivamente mercancía-para-vender + servicios.
3. **Plan de cuentas (`migrations/0022_erp_financiero.sql:53-64`):** el catálogo salta de `119 IVA acreditable` directo a `201 Proveedores`. **No hay cuentas de activo fijo** (no existe un bloque 12xx: mobiliario, equipo de cómputo, vehículos, edificios, ni "Depreciación acumulada"). Cuentas totales: 101, 102, 105, 115, 119, 201, 209, 301, 401, 501, 601. Once cuentas, ninguna de activo no circulante.
4. **Contabilidad (`services/contabilidadService.js`):** No hay `asientoCompraActivo`, `asientoDepreciacion`, ni corrida de depreciación. La única referencia a "depreciación" en toda la UI es un comentario en `ContabilidadTab.jsx:119` que dice que **el usuario la capturaría a mano** como asiento manual — es decir, ni siquiera hay automatización.
5. **Compra / entrada de mercancía:** `dashboard/routes/compras.js` y la entrada de mercancía (`primeCatalogo entrada-mercancia`) **capitalizan todo como inventario**: el asiento de compra usa cuenta `115 Inventario` por default (`contabilidadService.js:145`, `cuentaCargo: '115'|'601'`) o `601 Gastos`. **No hay una tercera vía "esto es un activo fijo, capitalízalo en 12xx y deprécialo".** Comprar una caminadora hoy se registra como inventario (a revender) o como gasto — ninguna de las dos es correcta contablemente para un activo.
6. **UI:** No hay pestaña ni sección de "activos fijos" en `dashboard-ui/src/pages/prime/*` (CatalogoTab/InventarioTab) ni en Contabilidad.

### Conclusión honesta

**El inventario de hoy es SOLO mercancía-para-vender (más servicios). No existe el concepto de activo fijo, ni sus categorías (equipo/maquinaria/vehículos/cómputo/inmuebles), ni depreciación, ni cuentas contables 12xx.** La afirmación del dueño es falsa respecto al código actual. Registrar una caminadora, un vehículo de reparto o el equipo de cómputo en el sistema hoy solo es posible mal-clasificándolo como producto de venta o como gasto general.

### Diseño mínimo (para tenerlo bien contablemente)

**P0 — activo fijo con depreciación lineal, atado a la compra:**

1. **Tabla `activos_fijos`** (migración nueva + espejo en `schema.sql`):
   ```
   activos_fijos(
     id, nombre, categoria TEXT,        -- 'equipo'|'maquinaria'|'vehiculos'|'computo'|'inmuebles'
     costo REAL NOT NULL,               -- valor de adquisición (base depreciable)
     valor_residual REAL DEFAULT 0,
     fecha_adquisicion TEXT NOT NULL,
     vida_util_meses INTEGER NOT NULL,  -- lineal: (costo-residual)/vida_util_meses por mes
     depreciacion_acumulada REAL DEFAULT 0,
     estatus TEXT DEFAULT 'activo',     -- activo|baja
     id_pedido_compra INTEGER,          -- liga a la compra que lo originó
     sucursal TEXT
   )
   ```
   `categoria` como TEXT libre con las 5 sugeridas (lean; sin tabla de catálogo aparte).

2. **Cuentas nuevas en `plan_cuentas`** (agregar al INSERT de 0022, es idempotente):
   ```
   ('120','Mobiliario y equipo','activo'),
   ('121','Equipo de cómputo','activo'),
   ('122','Equipo de transporte (vehículos)','activo'),
   ('123','Maquinaria','activo'),
   ('124','Edificios / Inmuebles','activo'),
   ('129','Depreciación acumulada','activo'),  -- contra-activo (saldo acreedor)
   ('602','Gasto por depreciación','gasto')
   ```

3. **Asiento de compra de activo** (`asientoCompraActivo` en `contabilidadService.js`, gemelo de `asientoCompra`): en vez de cargar `115 Inventario`, carga la cuenta 12x de la categoría; el crédito sigue igual (`201 Proveedores` o `102 Bancos`) + IVA `119`. Esto **distingue capitalizar (activo) de comprar inventario (COGS futuro) de gasto.**

4. **Depreciación lineal mensual:** función `correrDepreciacion(mes)` que, por cada activo `estatus='activo'` con `depreciacion_acumulada < costo-residual`, genera un asiento `602 Gasto por depreciación (debe) / 129 Depreciación acumulada (haber)` por el importe mensual, e incrementa `depreciacion_acumulada`. Disparable manualmente (botón en Contabilidad) o desde el tick de `stockWatcher` una vez al mes. Idempotente por mes (registrar `referencia_tipo='depreciacion'`, `referencia_id=YYYY-MM` y no repetir).

5. **Atarlo a la compra:** en la entrada de mercancía / OC, un checkbox "es activo fijo" que, en vez de sumar a `inventarios`, inserta en `activos_fijos` y llama `asientoCompraActivo`. Reusa el flujo de compra existente, solo bifurca el destino.

**P1:**
- UI: pestaña "Activos fijos" en Prime/Contabilidad (alta, listado con valor en libros = costo − depreciación acumulada, baja).
- Baja/venta de activo (asiento de baja: da de alta la depreciación acumulada, reconoce ganancia/pérdida).
- Reporte de activos por categoría para el balance.

**Alcance realista:** P0 es una tabla + 7 cuentas seed + 2 funciones contables + una bifurcación en la compra. No es un módulo pesado; es el mínimo para que un gym (o cualquier negocio con equipo caro) lleve sus activos y depreciación correctamente en vez de ensuciar el inventario de venta.

---

## Resumen ejecutivo

**Gimnasios:** El giro **no está definido**, pero **el 80% del motor ya existe y se reusa sin código nuevo**: la suscripción recurrente (`suscripcionCobro.js`) es exactamente una mensualidad de gym, y las citas (`citasFlow.js`) ya soportan **cupo por horario** (`citas_capacidad`) para clases. El onboarding recoge cualquier giro nuevo automáticamente. **P0 = un preset de giro (~15 líneas: `GIROS.gimnasio` + `MENU_GIRO` + `MODULOS_POR_GIRO` encendiendo citas+suscripción+pos)**, sin motor nuevo. Falta de verdad (P1, solo si el cliente lo pide): congelar membresía, check-in/asistencia, y cupo por-clase (hoy es global). El control de acceso con torniquete es hardware, fuera de alcance.

**Activos fijos:** **La afirmación del dueño es falsa.** No existe absolutamente nada de activos fijos en el código: ni tabla, ni `productos.tipo='activo_fijo'` (solo `fisico|consumible|servicio`), ni cuentas 12xx en el plan (salta de 119 a 201), ni depreciación (solo un comentario que sugiere asientos manuales). El inventario de hoy es exclusivamente mercancía-para-vender; comprar un activo se mal-clasifica como inventario o gasto. **P0 para tenerlo bien:** tabla `activos_fijos` (con categorías equipo/maquinaria/vehículos/cómputo/inmuebles), 7 cuentas nuevas (120-124 activo, 129 depreciación acumulada, 602 gasto por depreciación), un asiento de compra de activo, depreciación lineal mensual idempotente, y un checkbox "es activo fijo" que bifurca la compra existente. Módulo mediano-chico, no un ERP nuevo.
