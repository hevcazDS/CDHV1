'use strict';
// recetasService — BOM plano (P3): un platillo (producto vendible) se compone
// de INSUMOS (otros productos). Al COBRAR, si el producto tiene receta, se
// descuentan los insumos y NO el platillo — punto único llamado por los tres
// sitios de venta (POS, mesas, marcar-pagado). Sin receta → false y el caller
// descuenta el producto como siempre (byte-idéntico para no-restaurantes).
const kardexService = require('./kardexService');

function insumosDe(db, idProducto) {
    try {
        return db.prepare(`
            SELECT pi.id_insumo, pi.cantidad, p.name
            FROM producto_insumos pi JOIN productos p ON p.id = pi.id_insumo
            WHERE pi.id_producto = ?`).all(idProducto);
    } catch (_) { return []; }   // BD sin migración 0072 → sin recetas
}

// true = tenía receta y se descontaron los insumos (el caller NO descuenta el
// platillo). false = sin receta, flujo normal.
function descontarVenta(db, { id_producto, cantidad, sucursal, motivo, usuario }) {
    const insumos = insumosDe(db, id_producto);
    if (!insumos.length) return false;
    for (const ins of insumos) {
        const delta = -Math.round(ins.cantidad * cantidad * 1000) / 1000;
        try {
            kardexService.movimiento({
                id_producto: ins.id_insumo, sucursal, tipo: 'venta',
                delta, motivo: (motivo || 'Venta') + ' — insumo de receta', usuario,
            });
        } catch (e) { console.error('[recetas] insumo no descontado:', ins.name, e.message); }
    }
    return true;
}

module.exports = { insumosDe, descontarVenta };
