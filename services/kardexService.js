// Kardex universal: TODO movimiento de inventario deja rastro auditable en
// inventario_movimientos (anterior → nueva, quién y por qué). Punto único —
// venta, entrada, salida, traslado, ajuste de conteo, reversa y devolución
// pasan por aquí.
'use strict';
let db = require('../bot/db_connection');

// delta: positivo entra, negativo sale. Devuelve { anterior, nueva }.
function movimiento({ id_producto, sucursal, tipo, delta, motivo, usuario, lote, caducidad }) {
    const fila = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(id_producto, sucursal);
    const anterior = fila ? (fila.stock || 0) : 0;
    const nueva = Math.max(0, anterior + delta);
    if (fila) {
        db.prepare('UPDATE inventarios SET stock=? WHERE id_producto=? AND sucursal=?').run(nueva, id_producto, sucursal);
    } else {
        db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock, stock_minimo) VALUES (?,?,?,0)').run(id_producto, sucursal, nueva);
    }
    try {
        db.prepare(`INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo, creado_por, lote, caducidad)
                    VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(id_producto, sucursal, tipo, anterior, nueva, motivo || null, usuario || null, lote || null, caducidad || null);
    } catch (e1) {
        try {
            db.prepare('INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo) VALUES (?,?,?,?,?,?)')
              .run(id_producto, sucursal, tipo, anterior, nueva, motivo || null);
        } catch (e2) {
            // Un ledger de dinero NUNCA falla mudo (el CHECK legacy de 0006
            // se tragó movimientos hasta la migración 0024)
            console.error('[kardex] NO se pudo registrar movimiento:', e2.message, { id_producto, sucursal, tipo });
        }
    }
    return { anterior, nueva };
}

// Kardex por producto con saldo corrido (para la vista de Almacén)
function kardex(idProducto, sucursal, limite = 200) {
    const filtro = sucursal ? ' AND sucursal=?' : '';
    const args = sucursal ? [idProducto, sucursal, limite] : [idProducto, limite];
    return db.prepare(`
        SELECT id, sucursal, tipo, cantidad_anterior, cantidad_nueva,
               (cantidad_nueva - cantidad_anterior) AS delta, motivo, creado_por, creado_en
        FROM inventario_movimientos WHERE id_producto=?${filtro}
        ORDER BY id DESC LIMIT ?`).all(...args);
}

function _setDb(x) { db = x; } // solo tests

module.exports = { movimiento, kardex, _setDb };
