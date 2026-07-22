'use strict';
// tests/test_recetas.js — P3: recetas/insumos (BOM). Vender 3 tacos (receta:
// 0.120 kg de carne + 2 tortillas c/u) descuenta carne 0.36 kg y tortillas 6,
// SIN tocar el "stock" del platillo. Producto sin receta → flujo normal.
//   node --test tests/test_recetas.js

const assert = require('assert');
const { test, after } = require('node:test');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const recetas = require('../services/recetasService');

// Insumos: carne (kg) y tortilla (pza); platillo: taco.
const idCarne = db.prepare("INSERT INTO productos (tipo, name, cat, price, activo, unidad_medida) VALUES ('fisico','Carne pastor','insumos',150,1,'kg')").run().lastInsertRowid;
const idTort = db.prepare("INSERT INTO productos (tipo, name, cat, price, activo) VALUES ('fisico','Tortilla','insumos',1,1)").run().lastInsertRowid;
const idTaco = db.prepare("INSERT INTO productos (tipo, name, cat, price, activo) VALUES ('fisico','Taco pastor','platillos',25,1)").run().lastInsertRowid;
db.prepare("INSERT INTO inventarios (id_producto, sucursal, stock) VALUES (?, 'Matriz', 5)").run(idCarne);
db.prepare("INSERT INTO inventarios (id_producto, sucursal, stock) VALUES (?, 'Matriz', 100)").run(idTort);
db.prepare('INSERT INTO producto_insumos (id_producto, id_insumo, cantidad) VALUES (?,?,?)').run(idTaco, idCarne, 0.12);
db.prepare('INSERT INTO producto_insumos (id_producto, id_insumo, cantidad) VALUES (?,?,?)').run(idTaco, idTort, 2);

test('insumosDe: la receta del taco tiene 2 líneas', () => {
    const ins = recetas.insumosDe(db, idTaco);
    assert.strictEqual(ins.length, 2);
});

test('vender 3 tacos: carne −0.36 kg, tortillas −6, platillo sin stock propio tocado', () => {
    const conReceta = recetas.descontarVenta(db, { id_producto: idTaco, cantidad: 3, sucursal: 'Matriz', motivo: 'Venta TEST', usuario: 'test' });
    assert.strictEqual(conReceta, true, 'debe reportar que SÍ había receta');
    const carne = db.prepare("SELECT stock FROM inventarios WHERE id_producto=? AND sucursal='Matriz'").get(idCarne).stock;
    const tort = db.prepare("SELECT stock FROM inventarios WHERE id_producto=? AND sucursal='Matriz'").get(idTort).stock;
    assert.strictEqual(carne, 4.64, '5 − 0.12×3');
    assert.strictEqual(tort, 94, '100 − 2×3');
    const stkTaco = db.prepare("SELECT stock FROM inventarios WHERE id_producto=? AND sucursal='Matriz'").get(idTaco);
    assert(!stkTaco, 'el platillo no genera fila de inventario propia');
});

test('el kardex narra el insumo ("— insumo de receta")', () => {
    const m = db.prepare("SELECT motivo FROM inventario_movimientos WHERE id_producto=? ORDER BY id DESC LIMIT 1").get(idCarne);
    assert(/insumo de receta/.test(m.motivo));
});

test('producto SIN receta: descontarVenta=false (el caller descuenta normal)', () => {
    const idLego = db.prepare("SELECT id FROM productos WHERE name LIKE 'Lego%'").get().id;
    assert.strictEqual(recetas.descontarVenta(db, { id_producto: idLego, cantidad: 1, sucursal: 'Matriz', usuario: 'test' }), false);
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
