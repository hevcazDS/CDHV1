// Reversión de un cobro ya aplicado (cancelaciones): repone el inventario
// que marcar-pagado/POS descontó y resta los puntos de lealtad acreditados.
// Único punto de verdad para las 2 rutas de cancelación (POS y pagos).
'use strict';
const db = require('../bot/db_connection');

// opts: { sucursalDefault?, cancelarPedido = true }
function revertirCobro(idPedido, opts = {}) {
    const ped = db.prepare('SELECT * FROM pedidos WHERE id_pedido=?').get(idPedido);
    if (!ped) return { ok: false, error: 'Pedido no encontrado' };

    let puntosRevertidos = 0;
    const t = db.transaction(() => {
        // 1. Reponer inventario
        const items = db.prepare('SELECT id_producto, cantidad, sucursal_origen FROM pedido_detalle WHERE id_pedido=?').all(idPedido);
        for (const it of items) {
            const suc = it.sucursal_origen || opts.sucursalDefault;
            if (!suc) throw new Error('Detalle sin sucursal de origen y sin sucursal default — no se puede reponer inventario');
            const anterior = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(it.id_producto, suc)?.stock ?? 0;
            db.prepare('UPDATE inventarios SET stock = stock + ? WHERE id_producto=? AND sucursal=?')
              .run(it.cantidad, it.id_producto, suc);
            try {
                db.prepare("INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo) VALUES (?,?,?,?,?,?)")
                  .run(it.id_producto, suc, 'reversa_cancelacion', anterior, anterior + it.cantidad, 'Cancelación pedido ' + (ped.folio || idPedido));
            } catch (_) {}
        }

        // 2. Revertir puntos (mismo criterio que otorgarPuntosPorCompra: 1 punto/peso)
        if (ped.puntos_acreditados && ped.id_cliente) {
            puntosRevertidos = Math.max(0, Math.floor(Number(ped.total || 0)));
            if (puntosRevertidos > 0) {
                db.prepare("UPDATE puntos_cliente SET puntos_ganados = MAX(0, puntos_ganados - ?), ultimo_movimiento=datetime('now','localtime') WHERE id_cliente=?")
                  .run(puntosRevertidos, ped.id_cliente);
            }
            db.prepare('UPDATE pedidos SET puntos_acreditados=0 WHERE id_pedido=?').run(idPedido);
        }

        // 3. Pago cancelado; pedido según el caso (POS cancela, un pago
        //    deshecho regresa el pedido a Pendiente)
        db.prepare("UPDATE links_pago SET estatus='cancelado' WHERE id_pedido=?").run(idPedido);
        const nuevoEstatus = opts.cancelarPedido === false ? 'Pendiente' : 'cancelado';
        db.prepare("UPDATE pedidos SET estatus=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(nuevoEstatus, idPedido);
    });
    t();
    // Contra-asientos si la contabilidad está activa (idempotente)
    try {
        const conta = require('./contabilidadService');
        conta.asientoReversa('venta', idPedido);
        // Fiado (venta de mostrador a crédito): el ingreso se asienta como
        // 'venta_credito' y el cobro como 'cobro_credito' — sin revertirlos,
        // cancelar un fiado dejaba una venta fantasma en el mayor. asientoReversa
        // es no-op si el asiento de ese tipo no existe (venta de contado).
        conta.asientoReversa('venta_credito', idPedido);
        conta.asientoReversa('cobro_credito', idPedido);
        conta.asientoReversa('costo_venta', idPedido);
    } catch (_) {}
    return { ok: true, id_pedido: idPedido, puntos_revertidos: puntosRevertidos };
}

module.exports = { revertirCobro };
