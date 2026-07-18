// Motor contable (Fase 6): asientos de partida doble sobre plan_cuentas.
// Los asientos AUTOMÁTICOS solo corren con el módulo `contabilidad_activo`
// encendido; el registro manual y las consultas funcionan siempre.
// Cuentas: 101 Caja · 102 Bancos · 115 Inventario · 201 Proveedores ·
//          209 IVA trasladado · 401 Ventas · 501 Costo de ventas
'use strict';
let db = require('../bot/db_connection');
const { moduloActivo, getValor } = (() => {
    try { return require('../bot/flows/_config'); }
    catch (_) { return { moduloActivo: () => false, getValor: (_c, fb) => fb }; }
})();

const _r2 = (n) => Math.round(Number(n) * 100) / 100;

let _activoFn = () => moduloActivo('contabilidad_activo');
function activo() { return _activoFn(); }

// ¿Está cerrado el mes de esta fecha? El cierre es TOTAL (el contador cierra
// 'YYYY-MM' explícitamente), ya no por días 1-3: un mes <= periodo_cerrado
// está cerrado. Devuelve el 'YYYY-MM' cerrado o null.
function mesCerradoDe(fecha) {
    // Se lee del db del servicio (no de la cache de _config) para reflejar un
    // cierre/reapertura al instante y honrar _setDb en tests.
    let cerrado = '';
    try { cerrado = db.prepare("SELECT valor FROM configuracion WHERE clave='periodo_cerrado'").get()?.valor || ''; } catch (_) {}
    const mes = String(fecha || new Date().toISOString().slice(0, 10)).slice(0, 7);
    return (cerrado && mes <= cerrado) ? cerrado : null;
}

// partidas: [{ cuenta, debe?, haber? }] — debe cuadrar (±1 centavo).
// fecha: 'YYYY-MM-DD' opcional (permite capturar en meses pasados).
// override: true deja asentar en un mes CERRADO (el que llama ya validó rol
// y dejó la huella de quién autorizó).
function registrarAsiento({ concepto, referencia_tipo = 'manual', referencia_id = null, partidas, fecha = null, override = false, sucursal = null }) {
    if (!Array.isArray(partidas) || partidas.length < 2) throw new Error('Un asiento requiere al menos 2 partidas');
    // CIERRE DE PERÍODO (idea SAP): si el mes del asiento está cerrado por el
    // contador, no entra — salvo override autorizado (gerente/prime, con huella).
    const cerrado = mesCerradoDe(fecha);
    if (cerrado && !override) {
        throw new Error('Período contable CERRADO hasta ' + cerrado + ' — un Administrador o Prime puede autorizar la captura en meses cerrados (queda registrado quién)');
    }
    let debe = 0, haber = 0;
    for (const pa of partidas) {
        if (!pa.cuenta) throw new Error('Partida sin cuenta');
        debe += _r2(pa.debe || 0); haber += _r2(pa.haber || 0);
    }
    if (Math.abs(_r2(debe) - _r2(haber)) > 0.01) {
        throw new Error(`Asiento descuadrado: debe ${_r2(debe)} vs haber ${_r2(haber)}`);
    }
    const t = db.transaction(() => {
        const suc = sucursal ? String(sucursal) : null;   // multitienda 0051
        const a = fecha
            ? db.prepare('INSERT INTO asientos (fecha, concepto, referencia_tipo, referencia_id, sucursal) VALUES (?,?,?,?,?)')
                .run(fecha, String(concepto).slice(0, 200), referencia_tipo, referencia_id != null ? String(referencia_id) : null, suc)
            : db.prepare('INSERT INTO asientos (concepto, referencia_tipo, referencia_id, sucursal) VALUES (?,?,?,?)')
                .run(String(concepto).slice(0, 200), referencia_tipo, referencia_id != null ? String(referencia_id) : null, suc);
        const ins = db.prepare('INSERT INTO asientos_detalle (id_asiento, cuenta, debe, haber) VALUES (?,?,?,?)');
        for (const pa of partidas) ins.run(a.lastInsertRowid, pa.cuenta, _r2(pa.debe || 0), _r2(pa.haber || 0));
        return a.lastInsertRowid;
    });
    return t();
}

function _cuentaCobro(metodoPago) { return metodoPago === 'efectivo' ? '101' : '102'; }

// multitienda 0051: la tienda que originó un pedido (sus líneas guardan
// sucursal_origen). Un pedido split multi-sucursal se atribuye a la primera —
// centro de costos ligero, no prorrateo.
function _sucursalDePedido(idPedido) {
    try {
        return db.prepare("SELECT sucursal_origen FROM pedido_detalle WHERE id_pedido=? AND sucursal_origen IS NOT NULL AND sucursal_origen != '' LIMIT 1")
            .get(idPedido)?.sucursal_origen || null;
    } catch (_) { return null; }
}

// Venta cobrada: cargo Caja/Bancos, abono Ventas (+IVA trasladado si aplica)
function asientoVenta(idPedido, monto, metodoPago, fecha = null) {
    if (!activo() || !(monto > 0)) return null;
    // Idempotente igual que asientoVentaCredito/asientoCobroCredito: si ya se
    // asentó esta venta, no duplicar (defensa por si el chokepoint de pago
    // fallara en aislarlo). Comité forense.
    if (db.prepare("SELECT 1 FROM asientos WHERE referencia_tipo='venta' AND referencia_id=? LIMIT 1").get(String(idPedido))) return null;
    const iva = parseFloat(getValor('iva_pct', '0')) || 0;
    const base = iva > 0 ? _r2(monto / (1 + iva / 100)) : _r2(monto);
    const partidas = [{ cuenta: _cuentaCobro(metodoPago), debe: monto }];
    partidas.push({ cuenta: '401', haber: base });
    if (iva > 0) partidas.push({ cuenta: '209', haber: _r2(monto - base) });
    return registrarAsiento({ concepto: 'Venta pedido ' + idPedido, referencia_tipo: 'venta', referencia_id: idPedido, partidas, fecha, sucursal: _sucursalDePedido(idPedido) });
}

// VENTA A CRÉDITO (fiado) — capa de DEVENGADO. El ingreso se reconoce YA
// (cargo 105 Clientes, abono 401 Ventas), pero el IVA aún NO es exigible en
// México hasta cobrarlo → se causa en 208 (IVA trasladado no cobrado). El
// costo de venta se reconoce aparte (asientoCostoVenta) al entregar. Idempotente.
function asientoVentaCredito(idPedido, monto, fecha = null) {
    if (!activo() || !(monto > 0)) return null;
    if (db.prepare("SELECT 1 FROM asientos WHERE referencia_tipo='venta_credito' AND referencia_id=? LIMIT 1").get(String(idPedido))) return null;
    const iva = parseFloat(getValor('iva_pct', '0')) || 0;
    const base = iva > 0 ? _r2(monto / (1 + iva / 100)) : _r2(monto);
    const partidas = [{ cuenta: '105', debe: monto }, { cuenta: '401', haber: base }];
    if (iva > 0) partidas.push({ cuenta: '208', haber: _r2(monto - base) });
    return registrarAsiento({ concepto: 'Venta a crédito pedido ' + idPedido, referencia_tipo: 'venta_credito', referencia_id: idPedido, partidas, fecha, sucursal: _sucursalDePedido(idPedido) });
}

// COBRO de una venta a crédito: entra el dinero (cargo Caja/Bancos, abono 105
// Clientes) y el IVA se vuelve exigible (cargo 208, abono 209). NO re-reconoce
// ingreso ni costo (ya se hizo al vender). Idempotente.
function asientoCobroCredito(idPedido, monto, metodoPago, fecha = null) {
    if (!activo() || !(monto > 0)) return null;
    if (db.prepare("SELECT 1 FROM asientos WHERE referencia_tipo='cobro_credito' AND referencia_id=? LIMIT 1").get(String(idPedido))) return null;
    const iva = parseFloat(getValor('iva_pct', '0')) || 0;
    const base = iva > 0 ? _r2(monto / (1 + iva / 100)) : _r2(monto);
    const partidas = [{ cuenta: _cuentaCobro(metodoPago), debe: monto }, { cuenta: '105', haber: monto }];
    if (iva > 0) { const _i = _r2(monto - base); partidas.push({ cuenta: '208', debe: _i }, { cuenta: '209', haber: _i }); }
    return registrarAsiento({ concepto: 'Cobro venta a crédito pedido ' + idPedido, referencia_tipo: 'cobro_credito', referencia_id: idPedido, partidas, fecha, sucursal: _sucursalDePedido(idPedido) });
}

// Costo de lo vendido: cargo Costo de ventas, abono Inventario (costo promedio)
function asientoCostoVenta(idPedido, fecha = null) {
    if (!activo()) return null;
    // Usa el costo CONGELADO al pedido (d.costo_unitario, migración 0061); si es
    // NULL (fila vieja) cae al costo actual del producto — comportamiento previo.
    const row = db.prepare(`
        SELECT COALESCE(SUM(d.cantidad * COALESCE(d.costo_unitario, p.costo, 0)), 0) c
        FROM pedido_detalle d JOIN productos p ON p.id = d.id_producto
        WHERE d.id_pedido = ?
    `).get(idPedido);
    const costo = _r2(row?.c || 0);
    if (!(costo > 0)) return null;
    return registrarAsiento({
        concepto: 'Costo de venta pedido ' + idPedido, referencia_tipo: 'costo_venta', referencia_id: idPedido,
        partidas: [{ cuenta: '501', debe: costo }, { cuenta: '115', haber: costo }], fecha,
        sucursal: _sucursalDePedido(idPedido),
    });
}

// Compra: desglosa el IVA ACREDITABLE (119) simétrico a asientoVenta con el
// trasladado (209) — sin esto el reporte de impuestos infla el IVA por pagar.
// opts: { cuentaCargo: '115'|'601', base: subtotal exacto (CFDI), concepto }.
// El total capturado se asume CON IVA (como la factura real del proveedor).
function asientoCompra(folioOC, total, opts = {}) {
    if (!activo() || !(total > 0)) return null;
    const iva = parseFloat(getValor('iva_pct', '0')) || 0;
    const base = opts.base > 0 ? _r2(opts.base) : (iva > 0 ? _r2(total / (1 + iva / 100)) : _r2(total));
    const partidas = [{ cuenta: opts.cuentaCargo || '115', debe: base }];
    if (total - base > 0.005) partidas.push({ cuenta: '119', debe: _r2(total - base) });
    partidas.push({ cuenta: '201', haber: total });
    return registrarAsiento({
        concepto: opts.concepto || 'Compra ' + folioOC, referencia_tipo: 'compra', referencia_id: folioOC,
        partidas, fecha: opts.fecha || null, override: !!opts.override, sucursal: opts.sucursal || null,
    });
}

// Gasto directo (renta, luz, papelería): cargo Gastos (+119 si trae IVA),
// abono Caja/Bancos. Es el registro diario del contador.
function asientoGasto(concepto, total, metodo, conIva, opts = {}) {
    if (!activo() || !(total > 0)) return null;
    const iva = conIva ? (parseFloat(getValor('iva_pct', '0')) || 0) : 0;
    const base = iva > 0 ? _r2(total / (1 + iva / 100)) : _r2(total);
    // cuentaCargo permite clasificar el gasto en una subcuenta (ej. 602 Publicidad
    // para el CAC); default 601 Gastos generales (comportamiento de siempre).
    const partidas = [{ cuenta: opts.cuentaCargo || '601', debe: base }];
    if (total - base > 0.005) partidas.push({ cuenta: '119', debe: _r2(total - base) });
    partidas.push({ cuenta: metodo === 'bancos' ? '102' : '101', haber: total });
    return registrarAsiento({ concepto: 'Gasto: ' + concepto, referencia_tipo: 'gasto', referencia_id: null, partidas, fecha: opts.fecha || null, override: !!opts.override, sucursal: opts.sucursal || null });
}

// Devolución de mercancía: la pieza vuelve al inventario a su costo promedio
// (cargo Inventario, abono Costo de ventas). El reembolso de dinero al
// cliente no está modelado como flujo todavía → se registra con asiento
// manual si aplica.
function asientoDevolucion(idPedido, idProducto, cantidad) {
    if (!activo() || !(cantidad > 0)) return null;
    const costo = _r2((db.prepare('SELECT COALESCE(costo,0) c FROM productos WHERE id=?').get(idProducto)?.c || 0) * cantidad);
    if (!(costo > 0)) return null;
    return registrarAsiento({
        concepto: 'Devolución pedido ' + idPedido, referencia_tipo: 'devolucion', referencia_id: idPedido,
        partidas: [{ cuenta: '115', debe: costo }, { cuenta: '501', haber: costo }],
    });
}

// Entrada de mercancía SIN orden de compra (compra de contado):
// cargo Inventario, abono Bancos
function asientoEntradaContado(descripcion, monto) {
    if (!activo() || !(monto > 0)) return null;
    return registrarAsiento({
        concepto: 'Entrada de mercancía ' + descripcion, referencia_tipo: 'compra', referencia_id: descripcion,
        partidas: [{ cuenta: '115', debe: monto }, { cuenta: '102', haber: monto }],
    });
}

// Pago a proveedor: cargo Proveedores, abono Bancos
function asientoPagoCxP(idCxp, monto) {
    if (!activo() || !(monto > 0)) return null;
    return registrarAsiento({
        concepto: 'Pago a proveedor (CxP ' + idCxp + ')', referencia_tipo: 'pago_cxp', referencia_id: idCxp,
        partidas: [{ cuenta: '201', debe: monto }, { cuenta: '102', haber: monto }],
    });
}

// Reversa contable de una operación (cancelaciones): duplica los asientos
// originales con debe/haber invertidos. Idempotente: si ya hay REVERSA
// para esa referencia, no vuelve a generar.
function asientoReversa(tipo, refId) {
    if (!activo()) return null;
    const ref = String(refId);
    const yaRevertido = db.prepare(
        "SELECT 1 FROM asientos WHERE referencia_tipo=? AND referencia_id=? AND concepto LIKE 'REVERSA%' LIMIT 1"
    ).get(tipo, ref);
    if (yaRevertido) return null;
    const originales = db.prepare(
        "SELECT id, concepto, sucursal FROM asientos WHERE referencia_tipo=? AND referencia_id=? AND concepto NOT LIKE 'REVERSA%'"
    ).all(tipo, ref);
    const det = db.prepare('SELECT cuenta, debe, haber FROM asientos_detalle WHERE id_asiento=?');
    const ids = [];
    for (const o of originales) {
        const partidas = det.all(o.id).map(x => ({ cuenta: x.cuenta, debe: x.haber, haber: x.debe }));
        // Conserva la sucursal del asiento original (multitienda 0051): sin esto
        // la reversa cae con sucursal NULL y el P&L por tienda queda inflado.
        ids.push(registrarAsiento({ concepto: 'REVERSA ' + o.concepto, referencia_tipo: tipo, referencia_id: ref, partidas, sucursal: o.sucursal || null }));
    }
    return ids;
}

// sucursal (opcional, multitienda 0051): solo los asientos de esa tienda. Los
// asientos históricos (sucursal NULL) no entran al filtrar — la vista por
// tienda existe desde que existe la dimensión.
function libroMayor(desde, hasta, sucursal = null) {
    return db.prepare(`
        SELECT d.cuenta, pc.nombre, pc.tipo,
               ROUND(SUM(d.debe), 2) debe, ROUND(SUM(d.haber), 2) haber,
               ROUND(SUM(d.debe) - SUM(d.haber), 2) saldo
        FROM asientos_detalle d
        JOIN asientos a ON a.id = d.id_asiento
        LEFT JOIN plan_cuentas pc ON pc.codigo = d.cuenta
        WHERE a.fecha >= ? AND a.fecha <= ? AND (? = '' OR a.sucursal = ?)
        GROUP BY d.cuenta ORDER BY d.cuenta
    `).all(desde, hasta, sucursal || '', sucursal || '');
}

function _setDb(x) { db = x; }            // solo tests
function _setActivo(f) { _activoFn = f; } // solo tests

module.exports = { activo, mesCerradoDe, registrarAsiento, asientoVenta, asientoVentaCredito, asientoCobroCredito, asientoCostoVenta, asientoCompra, asientoGasto, asientoPagoCxP, asientoDevolucion, asientoEntradaContado, asientoReversa, libroMayor, _setDb, _setActivo };
