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

// partidas: [{ cuenta, debe?, haber? }] — debe cuadrar (±1 centavo)
function registrarAsiento({ concepto, referencia_tipo = 'manual', referencia_id = null, partidas }) {
    if (!Array.isArray(partidas) || partidas.length < 2) throw new Error('Un asiento requiere al menos 2 partidas');
    let debe = 0, haber = 0;
    for (const pa of partidas) {
        if (!pa.cuenta) throw new Error('Partida sin cuenta');
        debe += _r2(pa.debe || 0); haber += _r2(pa.haber || 0);
    }
    if (Math.abs(_r2(debe) - _r2(haber)) > 0.01) {
        throw new Error(`Asiento descuadrado: debe ${_r2(debe)} vs haber ${_r2(haber)}`);
    }
    const t = db.transaction(() => {
        const a = db.prepare('INSERT INTO asientos (concepto, referencia_tipo, referencia_id) VALUES (?,?,?)')
            .run(String(concepto).slice(0, 200), referencia_tipo, referencia_id != null ? String(referencia_id) : null);
        const ins = db.prepare('INSERT INTO asientos_detalle (id_asiento, cuenta, debe, haber) VALUES (?,?,?,?)');
        for (const pa of partidas) ins.run(a.lastInsertRowid, pa.cuenta, _r2(pa.debe || 0), _r2(pa.haber || 0));
        return a.lastInsertRowid;
    });
    return t();
}

function _cuentaCobro(metodoPago) { return metodoPago === 'efectivo' ? '101' : '102'; }

// Venta cobrada: cargo Caja/Bancos, abono Ventas (+IVA trasladado si aplica)
function asientoVenta(idPedido, monto, metodoPago) {
    if (!activo() || !(monto > 0)) return null;
    const iva = parseFloat(getValor('iva_pct', '0')) || 0;
    const base = iva > 0 ? _r2(monto / (1 + iva / 100)) : _r2(monto);
    const partidas = [{ cuenta: _cuentaCobro(metodoPago), debe: monto }];
    partidas.push({ cuenta: '401', haber: base });
    if (iva > 0) partidas.push({ cuenta: '209', haber: _r2(monto - base) });
    return registrarAsiento({ concepto: 'Venta pedido ' + idPedido, referencia_tipo: 'venta', referencia_id: idPedido, partidas });
}

// Costo de lo vendido: cargo Costo de ventas, abono Inventario (costo promedio)
function asientoCostoVenta(idPedido) {
    if (!activo()) return null;
    const row = db.prepare(`
        SELECT COALESCE(SUM(d.cantidad * COALESCE(p.costo, 0)), 0) c
        FROM pedido_detalle d JOIN productos p ON p.id = d.id_producto
        WHERE d.id_pedido = ?
    `).get(idPedido);
    const costo = _r2(row?.c || 0);
    if (!(costo > 0)) return null;
    return registrarAsiento({
        concepto: 'Costo de venta pedido ' + idPedido, referencia_tipo: 'costo_venta', referencia_id: idPedido,
        partidas: [{ cuenta: '501', debe: costo }, { cuenta: '115', haber: costo }],
    });
}

// Compra recibida: cargo Inventario, abono Proveedores
function asientoCompra(folioOC, total) {
    if (!activo() || !(total > 0)) return null;
    return registrarAsiento({
        concepto: 'Compra ' + folioOC, referencia_tipo: 'compra', referencia_id: folioOC,
        partidas: [{ cuenta: '115', debe: total }, { cuenta: '201', haber: total }],
    });
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
        "SELECT id, concepto FROM asientos WHERE referencia_tipo=? AND referencia_id=? AND concepto NOT LIKE 'REVERSA%'"
    ).all(tipo, ref);
    const det = db.prepare('SELECT cuenta, debe, haber FROM asientos_detalle WHERE id_asiento=?');
    const ids = [];
    for (const o of originales) {
        const partidas = det.all(o.id).map(x => ({ cuenta: x.cuenta, debe: x.haber, haber: x.debe }));
        ids.push(registrarAsiento({ concepto: 'REVERSA ' + o.concepto, referencia_tipo: tipo, referencia_id: ref, partidas }));
    }
    return ids;
}

function libroMayor(desde, hasta) {
    return db.prepare(`
        SELECT d.cuenta, pc.nombre, pc.tipo,
               ROUND(SUM(d.debe), 2) debe, ROUND(SUM(d.haber), 2) haber,
               ROUND(SUM(d.debe) - SUM(d.haber), 2) saldo
        FROM asientos_detalle d
        JOIN asientos a ON a.id = d.id_asiento
        LEFT JOIN plan_cuentas pc ON pc.codigo = d.cuenta
        WHERE a.fecha >= ? AND a.fecha <= ?
        GROUP BY d.cuenta ORDER BY d.cuenta
    `).all(desde, hasta);
}

function _setDb(x) { db = x; }            // solo tests
function _setActivo(f) { _activoFn = f; } // solo tests

module.exports = { activo, registrarAsiento, asientoVenta, asientoCostoVenta, asientoCompra, asientoPagoCxP, asientoDevolucion, asientoEntradaContado, asientoReversa, libroMayor, _setDb, _setActivo };
