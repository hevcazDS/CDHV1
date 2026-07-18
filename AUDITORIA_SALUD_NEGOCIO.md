# Auditoría y diseño — `calcular_salud_negocio()` (CAC / LTV / Ratio)

> Análisis + diseño, **sin código de producción**. Este doc es el plano; la implementación es un paso aparte.
> Stack real verificado en el repo (no el que asumía el prompt del dueño): backend `http` nativo con rutas declarativas, SQLite `better-sqlite3` (sin triggers de alerta), UI React + Mantine + **Recharts** (no PrimeReact), alertas por **polling** en `services/stockWatcher.js`.

---

## 0. Resumen ejecutivo

- **El ERP ya tiene motor contable de partida doble** (`services/contabilidadService.js` + tablas `asientos`/`asientos_detalle`/`plan_cuentas`). Ventas viven en la cuenta `401`, COGS en `501`, gastos en `601`. Eso da **ingresos, costo y gasto reales por período casi gratis** vía `conta.libroMayor(desde, hasta)`.
- **Ya existen** `GET /api/erp/tablero` (P&L, margen, punto de equilibrio), `GET /api/erp/salud-financiera` (liquidez: razón corriente, prueba ácida, ciclo de efectivo) y `GET /api/erp/rentabilidad-clientes`. **NO existe CAC/LTV/Ratio (unit economics)** — ese es el hueco real y legítimo a llenar.
- **Fórmula del prompt está incoherente** (define `frecuencia_compra_anual` y entre paréntesis la llama "margen unitario", luego multiplica por `margen_neto` otra vez). Corregida abajo. El orden de umbrales del prompt (`>=3` antes de `>5`) también estaba mal — hay que evaluar `>5` primero.
- **Qué sale solo** (con contabilidad ON): ingresos, COGS/margen neto, gasto de operación (601), clientes nuevos, ticket promedio, frecuencia de compra. **Qué NO sale solo**: la parte de "publicidad/marketing" del CAC — no hay categoría de gasto separada. Hoy la publicidad, si se registra, cae mezclada en `601` (Gastos generales). → Se necesita **capturar el gasto de marketing** (input manual o un tag de gasto), si no el CAC no distingue "costo de adquirir clientes" de "costo de operar".
- **Alerta de CAC por polling**: encaja en `stockWatcher.runAll()` como un check más que encola en `cola_notificaciones`/`cola_emails`. Pero el CAC **diario** no se puede computar solo sin gasto de marketing diario → se propone una tabla mínima `gasto_marketing_diario` (o reusar `asientos` con un `referencia_tipo='gasto_marketing'`).

**Recomendación P0**: un solo endpoint nuevo `GET /api/erp/unit-economics` (área `finanzas`) + una `saludNegocioService.calcularSaludNegocio()` reutilizable, alimentado por lo que ya existe, con los inputs de marketing como parámetros. **P1**: capturar gasto de marketing y encender la alerta por polling.

---

## 1. Modelo financiero corregido

El dueño escribió (parafraseado):

> `frecuencia_compra_anual` (margen unitario por cliente) … `LTV = ticket_promedio * frecuencia_compra_anual * margen_neto`

Eso multiplica la frecuencia y el margen como si la frecuencia fuera margen — **muddle**. Lo correcto y estándar:

### Definiciones (todo en periodo **anual**, moneda MXN)

| Métrica | Fórmula | Unidad |
|---|---|---|
| **CAC** (Customer Acquisition Cost) | `gasto_adquisicion / clientes_nuevos` | $ por cliente nuevo |
| **Ticket promedio** | `ingresos_periodo / num_pedidos_periodo` | $ por pedido |
| **Frecuencia de compra anual** | `num_pedidos_periodo / clientes_activos_periodo` × factor_anualización | pedidos/cliente/año |
| **Margen neto** | `(ingresos - COGS - gastos_op) / ingresos` | fracción 0–1 (o %) |
| **LTV** (Lifetime Value) | `ticket_promedio × frecuencia_compra_anual × margen_neto` | $ por cliente |
| **Ratio LTV/CAC** | `LTV / CAC` | adimensional |

Notas de rigor:
- `margen_neto` aquí es una **fracción** (ej. 0.22), no un peso. Así LTV queda en pesos: `$ticket × (pedidos/cliente/año) × fracción = $/cliente`. Ese era el error del prompt: mezclaba "margen unitario en $" con "margen %".
- `gasto_adquisicion` es **solo** el gasto atribuible a conseguir clientes nuevos (publicidad, promos de captación, comisiones de venta a nuevos). **No** es todo `601`. Si no se puede separar, se usa un proxy (ver §2) y se documenta que es proxy.
- **Anualización**: si el período de cálculo son 30 días, `factor_anualización = 365 / dias_periodo`. Con un histórico de 12 meses, usar el año directo (factor 1).

### Semáforo (orden de umbrales corregido — `>5` primero)

```
ratio = LTV / CAC
if      CAC == 0 || clientes_nuevos == 0 : status = 'sin_datos'   // no dividir por cero
else if ratio > 5   : status = 'escalable'    // 'Listo para escalar'
else if ratio >= 3  : status = 'saludable'    // 'Saludable'
else                : status = 'alerta'        // 'Alerta: quemando dinero'
```

> El prompt ponía `>=3 'Saludable'` antes que `>5 'Escalable'`. Si evalúas `>=3` primero, un ratio de 6 nunca llega a 'escalable'. Hay que checar `>5` primero (o `>=3 && <=5` explícito). Corregido arriba.

---

## 2. Mapeo a los datos REALES de este ERP

Verificado contra `db/schema.sql` y `services/contabilidadService.js`.

### 2.1 Lo que sale solo (con `contabilidad_activo` ON)

Todo esto se deriva de `conta.libroMayor(desde, hasta)` (mismas cuentas que usa `tablero`/`salud-financiera`):

| Insumo | Fuente real | SQL / origen |
|---|---|---|
| **ingresos** | cuenta `401` | `libroMayor` → `401.haber - 401.debe` (idéntico a `tablero`, `erpContabilidad.js:111`) |
| **COGS** | cuenta `501` | `501.debe - 501.haber` |
| **gastos_op** | cuenta `601` | `601.debe - 601.haber` |
| **margen_neto** | derivado | `(ingresos - COGS - gastos_op) / ingresos` (ya calculado como `margen_neto_pct` en `tablero`, `erpContabilidad.js:118`) |
| **clientes_nuevos** | `clientes.creado_en` | `SELECT COUNT(*) FROM clientes WHERE date(creado_en) BETWEEN ? AND ?` |
| **ticket_promedio** | `links_pago` pagados | `SELECT SUM(monto)/COUNT(DISTINCT id_pedido) FROM links_pago WHERE estatus='pagado' AND date(pagado_en) BETWEEN ? AND ?` (patrón ya usado en `tablero.ticket`, `erpContabilidad.js:182`) |
| **num_pedidos** | `links_pago` pagados | `COUNT(DISTINCT id_pedido)` mismo query |
| **clientes_activos** | `pedidos` distintos | `SELECT COUNT(DISTINCT id_cliente) FROM pedidos WHERE date(creado_en) BETWEEN ? AND ?` |
| **frecuencia_compra_anual** | derivado | `(num_pedidos / clientes_activos) × 365/dias_periodo` |

> Si `contabilidad_activo` está **OFF**, ingresos/COGS/gastos se pueden aproximar directo de tablas (`pedidos.total`, `pedido_detalle.costo_unitario`, sin gastos de operación) — pero el margen neto quedaría inflado (sin gastos). El endpoint debe **degradar con honestidad**: devolver `conta_activa:false` y marcar `margen_neto` como "solo bruto" (igual que `saludFinanciera` hoy corta con `if (!conta.activo()) return {conta_activa:false}`).

### 2.2 Lo que NO sale solo — el gasto de adquisición

Este es el problema central del CAC. **No hay categoría de gasto de marketing/publicidad** en el sistema:

- `plan_cuentas` (schema.sql:1076) tiene `601 Gastos generales` — un solo cubo. Renta, luz, papelería **y** publicidad caen todos ahí vía `asientoGasto()`.
- `empleados.comision_pct` / `nominas.comisiones` existen (comisiones de venta) → parte del costo de adquirir, pero mezclado con retención.
- `links_pago` **no** tiene `comision_pct` ni `cobrado_por` a nivel de comisión de captación (sí `pedidos.cobrado_por`, para corte por cajero, no para CAC).

**Conclusión honesta**: hoy `gasto_adquisicion` **NO es computable automáticamente**. Opciones, de menos a más trabajo:

1. **Input manual (P0, recomendado)**: el endpoint acepta `?gasto_marketing=NNNN` (o lee `configuracion.gasto_marketing_mensual`). El contador/gerente teclea cuánto se gastó en publicidad ese período. CAC = ese número / clientes_nuevos. Simple, honesto, cero migración.
2. **Tag de gasto (P1)**: agregar `asientos.etiqueta` o una subcuenta `602 Publicidad y marketing` en `plan_cuentas`, y que `asientoGasto()` acepte `cuentaCargo:'602'`. Entonces el gasto de marketing sale solo del libro mayor. Es la vía "correcta" contable.
3. **Proxy total (fallback)**: usar todo `601` como `gasto_adquisicion`. **NO recomendado** — infla el CAC brutalmente (mete la renta como si fuera costo de adquirir). Solo como último recurso, claramente etiquetado `es_proxy:true`.

> Para el **CAC diario** de la alerta (§5) hace falta gasto de marketing **por día** → ahí sí conviene una tabla mínima `gasto_marketing_diario` (o filtrar `asientos` de la subcuenta `602` por fecha). Ver §5.

---

## 3. Diseño de la función y el endpoint

### 3.1 Dónde vive

- **Servicio**: `services/saludNegocioService.js` — reutilizable por el endpoint y por el check de `stockWatcher` (mismo patrón que `reporteService.js`, que es compartido por dashboard y watcher). Recibe `db` inyectable para tests (como `contabilidadService._setDb`).
- **Ruta**: `GET /api/erp/unit-economics` dentro de `dashboard/routes/erpContabilidad.js`, registrada en el arreglo `RUTAS` con `area:'finanzas'` (mismo gate que todo `/api/erp/*`). El área `finanzas` la cubren los roles `contabilidad`, `gerente`, `prime` y el `auditor` (lectura) — ver `dashboard/permisos.js:22,36`.

> No inventes rol nuevo: `finanzas` **ya es** el área correcta (el prompt decía "'finanzas' + 'prime'"; en este repo `finanzas` es un *área*, y `prime`/`gerente`/`auditor` ya la pasan por jerarquía/bypass). Reusar `area:'finanzas'` = una línea en el arreglo `RUTAS`.

### 3.2 Firma

```js
// services/saludNegocioService.js
// desde/hasta: 'YYYY-MM-DD'. gastoMarketing: número (input manual) o null.
// Si null, intenta leer configuracion.gasto_marketing_mensual; si tampoco, marca sin_datos.
function calcularSaludNegocio({ desde, hasta, gastoMarketing = null }) { /* ... */ }
```

### 3.3 JSON de salida (contrato)

```json
{
  "conta_activa": true,
  "desde": "2026-06-18", "hasta": "2026-07-18", "dias": 31,
  "insumos": {
    "clientes_nuevos": 42,
    "num_pedidos": 118,
    "clientes_activos": 90,
    "ingresos": 254300.00,
    "cogs": 152580.00,
    "gastos_op": 48000.00,
    "gasto_marketing": 18000.00,
    "gasto_marketing_es_input_manual": true
  },
  "metricas": {
    "cac": 428.57,
    "ticket_promedio": 2155.08,
    "frecuencia_compra_anual": 15.44,
    "margen_neto": 0.211,
    "ltv": 7024.13,
    "ratio_ltv_cac": 16.39
  },
  "status": "escalable",
  "status_label": "Listo para escalar",
  "objetivo_ratio": 3.0,
  "notas": ["gasto_marketing capturado manualmente; el CAC excluye renta/nómina fija"]
}
```

Reglas de robustez (no simplificar):
- **División por cero**: `cac=0`/`clientes_nuevos=0`/`ingresos=0` → `status:'sin_datos'`, nunca `NaN`/`Infinity`.
- **Honestidad de fuente**: `gasto_marketing_es_input_manual` y `es_proxy` explícitos, para que la UI no presente un CAC-basura como si fuera contable.
- Redondeo a 2 decimales con el `r2` que ya existe en el módulo.

---

## 4. Visualización (Recharts / Mantine — real para este stack)

Verificado: `recharts` está instalado (`dashboard-ui/package.json:26`), `@mantine/core@7` también. Convención dura del repo: **todo import de recharts vive en un archivo cargado con `lazy()`** (ver cabecera de `components/MiniCharts.jsx`). La nueva UI sería un tab más en la carpeta `dashboard-ui/src/pages/erp/` (junto a `TableroTab.jsx`, `RentabilidadClientesTab.jsx`), registrado como `lazy()` en el orquestador de la página ERP.

### 4.1 Barra: CAC vs Ganancia por cliente (LTV)

Reusa el patrón `Comparativo` de `MiniCharts.jsx` (dos barras por categoría). Snippet nuevo, mismo estilo/tokens:

```jsx
// dentro de un archivo lazy (p.ej. pages/erp/SaludNegocioTab.jsx)
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList, ReferenceLine, Cell } from 'recharts';

const TT = { contentStyle: { background:'var(--panel)', border:'1px solid var(--border)', borderRadius:10, fontSize:12 }, labelStyle:{ color:'var(--text)', fontWeight:600 } };
const money = (v) => '$' + Number(v||0).toLocaleString('es-MX', { maximumFractionDigits: 0 });

function CacVsLtv({ cac, ltv }) {
  const datos = [
    { name: 'CAC (costo)',    valor: cac, color: 'var(--red)' },
    { name: 'LTV (ganancia)', valor: ltv, color: 'var(--green)' },
  ];
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={datos} margin={{ left: 4, right: 40, top: 8, bottom: 2 }} barCategoryGap="35%">
        <XAxis dataKey="name" stroke="var(--text-mute)" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis hide />
        <Tooltip {...TT} formatter={(v) => [money(v), null]} />
        <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={64}>
          {datos.map((d, i) => <Cell key={i} fill={d.color} />)}
          <LabelList dataKey="valor" position="top" formatter={money} style={{ fontSize: 11, fill: 'var(--text-mute)' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

### 4.2 Gauge / semáforo del Ratio vs objetivo 3.0 (Mantine `RingProgress`)

No hace falta Recharts para esto — Mantine `RingProgress` (nativo, ya instalado) es el gauge. El anillo se llena proporcional al ratio contra un tope visual (ej. 6×), y el color es el semáforo:

```jsx
import { RingProgress, Text, Stack, Group, Badge } from '@mantine/core';

function RatioGauge({ ratio, objetivo = 3.0 }) {
  const color = ratio == null ? 'gray' : ratio > 5 ? 'teal' : ratio >= 3 ? 'green' : 'red';
  const label = ratio == null ? 'Sin datos' : ratio > 5 ? 'Escalable' : ratio >= 3 ? 'Saludable' : 'Alerta: quemando dinero';
  const pct = ratio == null ? 0 : Math.min(100, (ratio / 6) * 100); // tope visual 6x
  return (
    <Group align="center" gap="lg">
      <RingProgress
        size={150} thickness={14} roundCaps
        sections={[{ value: pct, color }]}
        label={
          <Stack gap={0} align="center">
            <Text fw={800} size="xl">{ratio == null ? '—' : ratio.toFixed(1) + '×'}</Text>
            <Text size="xs" c="dimmed">LTV / CAC</Text>
          </Stack>
        }
      />
      <Stack gap={4}>
        <Badge color={color} variant="light" size="lg">{label}</Badge>
        <Text size="sm" c="dimmed">Objetivo: {objetivo.toFixed(1)}× o más</Text>
        <Text size="xs" c="dimmed">&lt;3 quema dinero · 3–5 sano · &gt;5 listo para escalar</Text>
      </Stack>
    </Group>
  );
}
```

> `RingProgress` no dibuja una aguja de gauge; para un negocio esto comunica igual de bien (anillo + número grande + badge de color). Si el dueño insiste en aguja tipo velocímetro, se hace con Recharts `PieChart` semicircular (`startAngle=180 endAngle=0`) — no es necesario en P0.

Umbrales del semáforo **repetidos en cliente** solo para color; la **verdad del `status`** viene del backend (§3.3), el front no la recalcula (evita drift, mismo principio que `modulosDefaults.js`).

---

## 5. Alerta de eficiencia (polling en stockWatcher)

Nada de triggers SQL (no se usan para alertas en este repo). Se engancha como un check más en `services/stockWatcher.js`, encolando en `cola_notificaciones` (WhatsApp al operador) o `cola_emails` — exactamente el patrón de `checkStockMinimo`/`checkBackupReciente`.

### 5.1 Regla

> Si el **CAC promedio de los últimos 7 días** sube **>20%** vs la **media móvil de 30 días** → encolar aviso.

```
cac_7d  = gasto_marketing(últimos 7d)  / clientes_nuevos(últimos 7d)
cac_30d = gasto_marketing(últimos 30d) / clientes_nuevos(últimos 30d)
if clientes_nuevos_7d > 0 && cac_30d > 0 && cac_7d > cac_30d * 1.20:
    encolar alerta (dedup: 1 vez cada 24h, como checkStockMinimo)
```

### 5.2 SQL de las dos medias

`clientes_nuevos` por ventana (sale solo):

```sql
-- 7 días
SELECT COUNT(*) n FROM clientes
 WHERE date(creado_en) > date('now','localtime','-7 days');
-- 30 días
SELECT COUNT(*) n FROM clientes
 WHERE date(creado_en) > date('now','localtime','-30 days');
```

`gasto_marketing` por ventana — **este es el eslabón que falta**. Depende de la fuente elegida en §2.2:

- **Si se agrega subcuenta `602`** (marketing): sale del libro mayor por fecha —
  ```sql
  SELECT COALESCE(SUM(d.debe - d.haber),0) g
    FROM asientos a JOIN asientos_detalle d ON d.id_asiento = a.id
   WHERE d.cuenta = '602'
     AND a.fecha > date('now','localtime','-7 days');   -- y '-30 days' para la otra
  ```
- **Si se usa tabla nueva `gasto_marketing_diario(fecha TEXT, monto REAL, canal TEXT)`**:
  ```sql
  SELECT COALESCE(SUM(monto),0) g FROM gasto_marketing_diario
   WHERE fecha > date('now','localtime','-7 days');
  ```

### 5.3 El problema honesto y su solución

**El CAC diario NO se puede computar solo con lo que existe hoy** — no hay gasto de publicidad fechado. Sin eso, `cac_7d`/`cac_30d` no tienen numerador. Por lo tanto la alerta **requiere P1** (captura de marketing). Propuesta mínima:

- Migración `NNNN_gasto_marketing.sql`: **o** una subcuenta `INSERT OR IGNORE INTO plan_cuentas VALUES ('602','Publicidad y marketing','gasto')` (vía canónica, reusa todo el motor contable), **o** una tabla `gasto_marketing_diario` de 3 columnas (más simple para quien no lleva contabilidad).
- UI: un campo "Gasto de publicidad de hoy/este mes" en el mismo tab de Salud del Negocio (`POST` que hace `asientoGasto(concepto, monto, ..., {cuentaCargo:'602'})` si vas por subcuenta — el helper ya acepta `cuentaCargo`).
- El check `checkCacIneficiente()` se agrega a `runAll()` junto a los demás `_runCheck(...)`, con dedup diario (`cola_notificaciones` asunto `'Alerta CAC'` en las últimas 23h, patrón `checkStockMinimo`).

```js
// bosquejo del check (NO implementar aquí)
function checkCacIneficiente() {
  const n7  = clientesNuevos(7),  g7  = gastoMkt(7);
  const n30 = clientesNuevos(30), g30 = gastoMkt(30);
  if (!(n7 > 0) || !(g30 > 0) || !(n30 > 0)) return 0;   // sin datos → callar
  const cac7 = g7 / n7, cac30 = g30 / n30;
  if (cac7 <= cac30 * 1.20) return 0;
  if (yaAlertadoHoy('Alerta CAC')) return 0;
  _insertCola(operadorTel, 'Alerta CAC',
    `⚠️ El costo de adquirir clientes subió ${Math.round((cac7/cac30-1)*100)}% esta semana ` +
    `($${cac7.toFixed(0)} vs $${cac30.toFixed(0)} promedio del mes). Revisa la campaña.`,
    'alerta_cac');
  return 1;
}
```

---

## 6. Plan de implementación

### P0 — utilizable ya, sin migración
1. `services/saludNegocioService.js` con `calcularSaludNegocio({desde,hasta,gastoMarketing})` — reusa `conta.libroMayor` para ingresos/COGS/gastos y queries directas para clientes_nuevos/ticket/frecuencia. `gastoMarketing` = **input manual** (query param o `configuracion.gasto_marketing_mensual`).
2. `GET /api/erp/unit-economics` en `erpContabilidad.js` con `area:'finanzas'` (una línea en `RUTAS`).
3. Tab `pages/erp/SaludNegocioTab.jsx` (lazy) con `RatioGauge` (Mantine) + `CacVsLtv` (Recharts) + tabla de insumos. Degradar con honestidad si `conta_activa:false` o `sin_datos`.
4. Test de contrato mínimo: DB en memoria con asientos 401/501/601 + N clientes → asserts de CAC/LTV/ratio y del `status` en los 4 tramos (sin_datos / alerta / saludable / escalable). Mismo patrón que los tests "contract" del repo.

### P1 — precisión + alerta automática
5. Migración `602 Publicidad y marketing` en `plan_cuentas` (o tabla `gasto_marketing_diario`), espejada en `db/schema.sql` (regla del repo). Campo de captura en el tab.
6. Cuando exista marketing fechado: `gasto_marketing` sale solo del libro mayor por fecha (§5.2) → el CAC deja de necesitar input manual.
7. `checkCacIneficiente()` en `stockWatcher.runAll()` con dedup diario → encola `cola_notificaciones`.

### Lo que NO hay que construir (YAGNI)
- No un nuevo motor contable ni rol nuevo: `finanzas`/`prime`/`gerente`/`auditor` y `libroMayor` ya existen.
- No cohorts/retención por cliente en P0 — la frecuencia agregada del período basta para el ratio. Cohorts es P2 si el dueño lo pide.
- No aguja de velocímetro custom: `RingProgress` cubre el semáforo.

---

## 7. Honestidad de datos (lo que falta hoy)

| Insumo | ¿Sale solo? | Comentario |
|---|---|---|
| ingresos / COGS / gastos_op | ✅ (conta ON) | libro mayor 401/501/601 |
| margen_neto | ✅ (conta ON) | derivado; **solo bruto** si conta OFF |
| clientes_nuevos | ✅ | `clientes.creado_en` |
| ticket_promedio / num_pedidos | ✅ | `links_pago` pagados |
| frecuencia_compra_anual | ✅ | pedidos/cliente anualizado |
| **gasto_adquisicion (marketing)** | ❌ | **no hay categoría**; input manual (P0) o subcuenta 602 (P1) |
| **CAC diario (para la alerta)** | ❌ | requiere gasto de marketing **fechado** → P1 |

El CAC/LTV/Ratio es honesto y accionable **en cuanto se capture el gasto de marketing**. Todo lo demás ya está en la base.
