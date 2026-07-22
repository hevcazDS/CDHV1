'use strict';
// tests/test_mermas.js — P4: mermas tipificadas + caducidad/lote lean.
// Verifica: merma con tipo → movimiento tipo='merma' con motivo estandarizado y
// costo por tipo en el reporte; entrada con lote/caducidad → aparece en el
// reporte de caducidades próximas (solo si hay stock).
//   node --test tests/test_mermas.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const kardex = require('../services/kardexService');

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});

// Producto con costo conocido: jamón $80 costo, 10 kg en Matriz.
const idJamon = db.prepare("INSERT INTO productos (tipo, name, cat, price, costo, activo, unidad_medida) VALUES ('fisico','Jamón','carnes',120,80,1,'kg')").run().lastInsertRowid;
db.prepare("INSERT INTO inventarios (id_producto, sucursal, stock) VALUES (?, 'Matriz', 10)").run(idJamon);

test('kardex acepta lote/caducidad en la entrada', () => {
    kardex.movimiento({ id_producto: idJamon, sucursal: 'Matriz', tipo: 'entrada', delta: 5, motivo: 'Entrada test', usuario: 'test', lote: 'L-77', caducidad: '2026-07-20' });
    const m = db.prepare("SELECT lote, caducidad FROM inventario_movimientos WHERE id_producto=? AND tipo='entrada' ORDER BY id DESC LIMIT 1").get(idJamon);
    assert.strictEqual(m.lote, 'L-77');
    assert.strictEqual(m.caducidad, '2026-07-20');
});

test('merma tipificada: movimiento tipo=merma, motivo estandarizado, decimal', () => {
    kardex.movimiento({ id_producto: idJamon, sucursal: 'Matriz', tipo: 'merma', delta: -1.5, motivo: 'merma:caducidad — se pasó', usuario: 'test' });
    kardex.movimiento({ id_producto: idJamon, sucursal: 'Matriz', tipo: 'merma', delta: -0.5, motivo: 'merma:dano', usuario: 'test' });
    const stk = db.prepare("SELECT stock FROM inventarios WHERE id_producto=? AND sucursal='Matriz'").get(idJamon).stock;
    assert.strictEqual(stk, 13, '10 + 5 − 1.5 − 0.5 = 13');
});

test('reporte de mermas: agrupa por tipo con costo (cantidad × costo)', () => {
    const { mermas } = require('../dashboard/routes/almacen')._test;
    let out = null;
    mermas(null, null, { db, json: (r, d) => { out = d; } }, { u: new URL('http://x/api/almacen/mermas') });
    const cad = out.resumen.find(r => r.tipo === 'caducidad');
    const dan = out.resumen.find(r => r.tipo === 'dano');
    assert.strictEqual(cad.cantidad, 1.5);
    assert.strictEqual(cad.costo, 120, '1.5 × $80 costo');
    assert.strictEqual(dan.costo, 40, '0.5 × $80');
    assert.strictEqual(out.costo_total, 160);
});

test('caducidades próximas: entrada con caducidad ≤ +30d aparece (hay stock)', () => {
    const { caducidades } = require('../dashboard/routes/almacen')._test;
    let out = null;
    caducidades(null, null, { db, json: (r, d) => { out = d; } }, { u: new URL('http://x/api/almacen/caducidades?dias=30') });
    const fila = out.filas.find(f => f.lote === 'L-77');
    assert.ok(fila, 'la entrada L-77 (2026-07-20) debe aparecer');
    assert.ok(fila.stock_actual > 0);
    assert.ok(fila.dias_restantes <= 30);
});
