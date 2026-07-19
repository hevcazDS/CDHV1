// Costeo PROMEDIO ponderado (Fase 6): cada entrada de mercancía registra
// historial y recalcula productos.costo como promedio móvil.
// LLAMAR ANTES de aumentar el stock (usa el stock previo para ponderar).
'use strict';
let db = require('../bot/db_connection');

const _r2 = (n) => Math.round(Number(n) * 100) / 100;

function registrarEntrada(idProducto, cantidad, costoUnitario, origen) {
    cantidad = parseFloat(cantidad);   // granel: 2.5 kg NO se trunca a 2 (promedio correcto)
    costoUnitario = Number(costoUnitario);
    if (!(cantidad > 0) || !Number.isFinite(costoUnitario) || costoUnitario < 0) {
        throw new Error('Entrada de costo inválida (cantidad/costo)');
    }
    const stockPrevio = db.prepare('SELECT COALESCE(SUM(stock),0) s FROM inventarios WHERE id_producto=?').get(idProducto)?.s || 0;
    const costoPrevio = db.prepare('SELECT costo FROM productos WHERE id=?').get(idProducto)?.costo;

    const promedio = (costoPrevio == null || stockPrevio <= 0)
        ? _r2(costoUnitario)
        : _r2(((stockPrevio * Number(costoPrevio)) + (cantidad * costoUnitario)) / (stockPrevio + cantidad));

    const t = db.transaction(() => {
        db.prepare('INSERT INTO historial_costos (id_producto, cantidad, costo_unitario, origen) VALUES (?,?,?,?)')
          .run(idProducto, cantidad, _r2(costoUnitario), origen || null);
        db.prepare('UPDATE productos SET costo=? WHERE id=?').run(promedio, idProducto);
    });
    t();
    return { costo_promedio: promedio, stock_previo: stockPrevio };
}

function _setDb(x) { db = x; } // solo tests

module.exports = { registrarEntrada, _setDb };
