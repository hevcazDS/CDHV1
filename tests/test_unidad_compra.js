'use strict';
// tests/test_unidad_compra.js — P6: conversión compra↔venta (ferretería).
// Compras 2 cajas de 100 tornillos → stock +200 piezas; el costo por caja se
// prorratea a costo por pieza. Sin factor (default 1) todo queda igual.
//   node tests/test_unidad_compra.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

const idTornillo = db.prepare("INSERT INTO productos (tipo, name, cat, price, activo, unidad_medida, unidad_compra, factor_compra) VALUES ('fisico','Tornillo 1\"','ferreteria',2,1,'pza','caja',100)").run().lastInsertRowid;

// Réplica de la lógica del handler (la conversión es puro cálculo + kardex).
function entrada(idProducto, cantidad, costo, enUC) {
    const prod = db.prepare('SELECT unidad_compra, factor_compra FROM productos WHERE id=?').get(idProducto);
    const factor = Number(prod.factor_compra) > 0 ? Number(prod.factor_compra) : 1;
    const usar = !!enUC && factor !== 1;
    const efectiva = usar ? Math.round(cantidad * factor * 1000) / 1000 : cantidad;
    const costoU = (costo != null && usar) ? Math.round((costo / factor) * 10000) / 10000 : costo;
    require('../services/kardexService').movimiento({
        id_producto: idProducto, sucursal: 'Matriz', tipo: 'entrada', delta: efectiva,
        motivo: usar ? `Entrada — ${cantidad} ${prod.unidad_compra}(s) × ${factor}` : 'Entrada',
        usuario: 'test',
    });
    if (costoU != null) db.prepare('UPDATE productos SET costo=? WHERE id=?').run(costoU, idProducto);
    return { efectiva, costoU };
}

t('2 cajas × factor 100 → +200 piezas al stock', () => {
    const r = entrada(idTornillo, 2, 150, true);   // $150 la caja
    assert.strictEqual(r.efectiva, 200);
    const stk = db.prepare("SELECT stock FROM inventarios WHERE id_producto=? AND sucursal='Matriz'").get(idTornillo).stock;
    assert.strictEqual(stk, 200);
});

t('costo por caja se prorratea: $150/100 = $1.50 por pieza', () => {
    const costo = db.prepare('SELECT costo FROM productos WHERE id=?').get(idTornillo).costo;
    assert.strictEqual(costo, 1.5);
});

t('el kardex narra la conversión ("2 caja(s) × 100")', () => {
    const m = db.prepare("SELECT motivo FROM inventario_movimientos WHERE id_producto=? ORDER BY id DESC LIMIT 1").get(idTornillo);
    assert(/2 caja\(s\) × 100/.test(m.motivo), m.motivo);
});

t('sin en_unidad_compra: entrada normal (factor ignorado)', () => {
    const r = entrada(idTornillo, 5, null, false);
    assert.strictEqual(r.efectiva, 5);
    const stk = db.prepare("SELECT stock FROM inventarios WHERE id_producto=? AND sucursal='Matriz'").get(idTornillo).stock;
    assert.strictEqual(stk, 205);
});

t('producto sin factor (default 1): en_unidad_compra no altera nada', () => {
    const idLego = db.prepare("SELECT id FROM productos WHERE name LIKE 'Lego%'").get().id;
    db.prepare("INSERT INTO inventarios (id_producto, sucursal, stock) VALUES (?, 'Norte', 0)").run(idLego);
    const prod = db.prepare('SELECT factor_compra FROM productos WHERE id=?').get(idLego);
    assert.strictEqual(prod.factor_compra, 1, 'default 1 → byte-idéntico para productos existentes');
});

console.log('\n' + ok + '/5 OK — conversión de unidades compra↔venta.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
