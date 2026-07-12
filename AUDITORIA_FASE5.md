# Auditoría Fase 5

Fecha: 2026-07-12 · Rama `feat/ola2-tareas-poliza` · Evidencia archivo:línea, sin cambios de código.

`node scripts/rutas/inventario.js --check` → **exit 0**: `✓ Sin colisiones ni sombras de ruta (273 rutas en 24 módulos).` Ninguna ruta de F5 colisiona (incluidas `/api/documentos/plantillas` vs `/api/documentos/:id` y `/api/erp/baul` vs `/api/erp/baul/exportar`).

## Hallazgos (0 bloqueantes, 0 altos)

### 1 — MEDIO · Comprobante de pagaré/contrato no se guarda como "borrador" pero el schema y el PUT lo contemplan (inconsistencia menor de estado)
`dashboard/routes/documentos.js:133` inserta todo documento directamente con `estatus='emitido'`, pero `documentoPut` (`documentos.js:145`) y el schema (`migrations/0063_documentos.sql:25` default `'borrador'`) admiten `borrador|emitido|firmado|cancelado`. No hay ruta que cree un borrador: el ciclo empieza en `emitido`. No es bug (funciona), pero el estado `borrador` es código muerto hasta que la UI ofrezca "guardar sin emitir".
Fix mínimo: ninguno funcional; si no se quiere el estado, quitar `'borrador'` de la lista del PUT y del default del schema. Dejar como está es válido.

### 2 — BAJO · `giroFlows.js` conserva la clave muerta `isp: _CITAS`
`bot/flows/giroFlows.js:31` sigue mapeando `isp → _CITAS` aunque F5.0 retiró `isp` de `_giros.js`. Es inocuo (una instancia con `giro='isp'` heredado recibiría Citas, que es razonable), pero es residuo de la limpieza. `actionHandler.js:145-146` pasa el giro **crudo** (`getValor('giro')`), no el aliaseado, así que la clave nunca estorba a un giro válido.
Fix mínimo: borrar la línea `isp: _CITAS,` (1 línea).

### 3 — BAJO · `freelancer` recibe vocab de `servicios` pero no su flujo de Citas
`_ALIAS_GIRO = { freelancer: 'servicios' }` (`bot/flows/_giros.js:144`) solo se aplica en `getGiro` (vocab/menú). `actionHandler.js:146` llama `flowsDeGiro(_giro)` con el giro crudo, y `giroFlows.js` **no** tiene entrada `freelancer`, así que un freelancer no obtiene el flujo `citasFlow`. Asimetría: habla como servicios pero no agenda citas.
Fix mínimo (1 línea): agregar `freelancer: _CITAS,` en `GIRO_FLOWS` (`giroFlows.js:28`), o aliasear el giro también antes de `flowsDeGiro`. Bajo porque `freelancer` no está en el selector de onboarding (`listaGiros` solo expone `GIROS`).

## Quedó bien (verificado)

- **F5.0 / grep `isp`**: ninguna referencia colgante que rompa. Todas las coincidencias son alias (`_giros.js:144` freelancer→servicios), demos (`scripts/demo/*`), o la subcadena "disp/dispar" en comentarios/vars. `_giros.js` ya no exporta `isp`; `modulosDefaults.js` no lo menciona. `--check` verde.
- **F5.1 MRR y fechas**: `mrr = SUM(monto)` de activas (`suscripciones.js:37`) es correcto. `proximaFecha`/`sumarMes` (`suscripciones.js:13-25`) manejan cambio de año vía normalización nativa de `Date` (verificado: `sumarMes('2026-12-15') → 2027-01-15`) y capean a 28 (`Math.min(d,28)`), evitando el bug de febrero. `por_cobrar_hoy` usa `proximo_cobro <= hoy` consistente con `generarCobros` (`suscripciones.js:121`).
- **F5.1 cobro sin descontar inventario de más**: `_generarCargo` (`suscripciones.js:85-102`) reusa `insertarPedidoConCarrito`, que **no** deduce inventario — la deducción/kardex ocurre solo en `marcar-pagado` (`_insertarPedidoConCarritoTx`, `_shared.js:776-814` no toca `inventarios`). El item del carrito es `{ id: null, tipo:'servicio' }`, así que `costoDe.get(null)` se salta (`_shared.js:807` guarda `item.id ?`). Todo dentro de `db.transaction` con `proximo_cobro` avanzado atómicamente.
- **F5.2 render `{{placeholders}}`**: `render` (`documentos.js:55-59`) sustituye por `split().join()` (sin regex, sin escapes rotos) y traduce `{{n}}`→`\n`. `numeroALetras` verificado: `1234.50 → "Mil doscientos treinta y cuatro pesos 50/100 M.N."`, `1000000 → "Un millón..."`, `100 → "Cien..."`, `0 → "Cero..."`, `21 → "Veintiuno..."`. Siembra perezosa de plantillas estándar solo si faltan (`documentos.js:19-25`), sin drift con schema.
- **F5.2 rutas**: `plantillas` (estático) vs `:id` (regex `\d+`) no colisionan; `--check` lo confirma. RBAC coherente (`POST plantillas` = gerente, resto operacion).
- **F5.3 reporteImprimible**: los 4 llamadores pasan columnas cuyas `key`/`render` mapean a campos reales y todos tienen guard `disabled={!...length}`: ContabilidadTab libro (`cuenta/nombre/debe/haber/saldo`, `ContabilidadTab.jsx:46`) y diario (partidas pre-formateadas, `:59`), ComprasTab OC (`ComprasTab.jsx:94`, `render` de items/total), Mostrador corte (`Mostrador.jsx:405`, dos totales renderizados en `tfoot`), KardexTab (`KardexTab.jsx:32`, `render` de fecha/motivo). `esc()` sanitiza; ningún `undefined` impreso.
- **F5.4 zip nativo**: `crearZip` (STORE) produce un .zip **válido** — verificado con `unzip -t` (OK, sin errores) sobre un paquete real. `zlib.crc32` existe en el Node del entorno (v24.16.0). Headers local/central/EOCD con offsets correctos (`zipService.js:32`).
- **F5.4 hook de archivar**: se dispara solo si `r.ok` tras timbrar (`erpContabilidad.js:284`), `catch`-envuelto y con `.catch(()=>{})` — fail-closed, nunca tumba el timbrado. `baulContable.archivar` valida módulo y `cfdi_uuid` antes de tocar disco (`baulContable.js:19-21`); mes vía `creado_en.slice(0,7)` consistente con el `strftime('%Y-%m')` de `listar`/`exportarZip`. Paths con `_slug` (sin traversal).
- **Fix comisión**: el bloque de comisiones (`nominaService.js:137-144`) está **fuera** de `if(fiscal)` y se suma a `bruto` (`:146`) en modo simple y fiscal. Correcto.
- **Fix cancelar venta (PIN)**: `cancelarVenta` (`Mostrador.jsx:42-56`) intenta sin PIN, y si `e.data.pin_requerido` (que `api.js:14` adjunta al error) reintenta con PIN. Ruta backend `POST /api/pos/venta/:id/cancelar` con `pin:true` existe (`pos.js:438`), el tronco devuelve `pin_requerido:true` (`_construirModulo.js:94`).
- **Fix cancelar/regenerar link (Pedidos)**: acciones condicionadas al estatus del link (`Pedidos.jsx:197` cancelar generado/pagado, `:204` regenerar cancelado/expirado); rutas `POST /api/pagos/:id/cancelar|regenerar` existen (`comunicacionPedidos.js:451-452`).
- **Módulos F5 apagados por defecto**: `suscripcion_activo`, `documentos_activo`, `baul_contable_activo` en `DEFAULT_OFF` (`modulosDefaults.js:54-58`); todos los handlers verifican `activo(db)` antes de operar.
