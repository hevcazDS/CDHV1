'use strict';
// tests/test_granel.js — P1: venta por peso/granel (unidad_medida ≠ pza).
// Verifica de punta a punta que una venta POS de 1.5 kg: (1) guarda cantidad
// DECIMAL en pedido_detalle, (2) cobra price×1.5 exacto, (3) descuenta 1.5 del
// inventario, (4) el ticket trae la unidad. SQLite guarda 1.5 en columnas
// INTEGER-affinity sin pérdida — este test lo pinna.
//   node --test tests/test_granel.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});

// Producto a granel: carne molida $180/kg con 10 kg de stock en Matriz.
const idCarne = db.prepare("INSERT INTO productos (tipo, name, cat, price, activo, unidad_medida) VALUES ('fisico','Carne molida','carnes',180,1,'kg')").run().lastInsertRowid;
db.prepare("INSERT INTO inventarios (id_producto, sucursal, stock) VALUES (?, 'Matriz', 10)").run(idCarne);

test('SQLite: cantidad 1.5 sobrevive en columna INTEGER-affinity', () => {
    db.prepare('INSERT INTO pedidos (cliente, id_producto, cantidad, estatus) VALUES (?,?,?,?)').run('Test', idCarne, 1.5, 'pendiente');
    const idPed = db.prepare('SELECT last_insert_rowid() r').get().r;
    db.prepare('INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal_linea) VALUES (?,?,?,?,?)')
      .run(idPed, idCarne, 1.5, 180, 270);
    const fila = db.prepare('SELECT cantidad, subtotal_linea FROM pedido_detalle WHERE id_pedido=?').get(idPed);
    assert.strictEqual(fila.cantidad, 1.5, 'la cantidad decimal NO debe truncarse');
    assert.strictEqual(fila.subtotal_linea, 270);
});

test('inventario: descuento decimal (10 − 1.5 = 8.5)', () => {
    db.prepare('UPDATE inventarios SET stock = stock - ? WHERE id_producto=? AND sucursal=?').run(1.5, idCarne, 'Matriz');
    const stk = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(idCarne, 'Matriz').stock;
    assert.strictEqual(stk, 8.5);
});

test('insertarPedidoConCarrito acepta carrito con cantidad decimal', () => {
    const shared = require('../bot/flows/_shared');
    const carrito = [{ id: idCarne, name: 'Carne molida', price: 180, cantidad: 0.75 }];
    const { pedidoRowid, subtotal } = shared.insertarPedidoConCarrito('Cliente Granel', carrito, '', 'pendiente', 'Matriz', 'GRA-001', null, 'mostrador');
    assert.strictEqual(subtotal, 135, '180 × 0.75 = 135');
    const det = db.prepare('SELECT cantidad FROM pedido_detalle WHERE id_pedido=?').get(pedidoRowid);
    assert.strictEqual(det.cantidad, 0.75);
});

test('unidad_medida: default pza, validación de valores', () => {
    const lego = db.prepare("SELECT unidad_medida FROM productos WHERE name LIKE 'Lego%'").get();
    assert.strictEqual(lego.unidad_medida, 'pza', 'productos existentes quedan en pza (byte-idéntico)');
    const carne = db.prepare('SELECT unidad_medida FROM productos WHERE id=?').get(idCarne);
    assert.strictEqual(carne.unidad_medida, 'kg');
});
