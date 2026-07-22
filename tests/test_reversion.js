// Contract test: reversionService repone inventario, resta puntos y deja
// el pedido/pago en el estatus correcto (POS cancela, pago deshecho → Pendiente).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const db = new Database(':memory:');

db.exec(`
CREATE TABLE pedidos (id_pedido INTEGER PRIMARY KEY, folio TEXT, total REAL, estatus TEXT,
    id_cliente INTEGER, puntos_acreditados INTEGER DEFAULT 0, actualizado_en TEXT);
CREATE TABLE pedido_detalle (id INTEGER PRIMARY KEY, id_pedido INTEGER, id_producto INTEGER,
    cantidad INTEGER, sucursal_origen TEXT);
CREATE TABLE inventarios (id_producto INTEGER, sucursal TEXT, stock INTEGER);
CREATE TABLE links_pago (id INTEGER PRIMARY KEY, id_pedido INTEGER, estatus TEXT);
CREATE TABLE puntos_cliente (id_cliente INTEGER PRIMARY KEY, telefono TEXT,
    puntos_ganados INTEGER DEFAULT 0, puntos_canjeados INTEGER DEFAULT 0, ultimo_movimiento TEXT);
CREATE TABLE inventario_movimientos (id INTEGER PRIMARY KEY, id_producto INTEGER, sucursal TEXT,
    tipo TEXT, cantidad INTEGER, motivo TEXT);
`);

db.prepare("INSERT INTO pedidos VALUES (1,'F-1',500,'entregado',7,1,NULL)").run();
db.prepare("INSERT INTO pedido_detalle (id_pedido,id_producto,cantidad,sucursal_origen) VALUES (1,10,2,'Centro')").run();
db.prepare("INSERT INTO inventarios VALUES (10,'Centro',3)").run();
db.prepare("INSERT INTO links_pago (id_pedido,estatus) VALUES (1,'pagado')").run();
db.prepare("INSERT INTO puntos_cliente (id_cliente,telefono,puntos_ganados) VALUES (7,'521555',800)").run();

// Inyectar la BD en memoria al servicio
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...a) {
    if (request.includes('db_connection')) return db;
    return origLoad.apply(this, [request, ...a]);
};
const { revertirCobro } = require('../services/reversionService');
Module._load = origLoad;

const ok = (c, msg) => assert.ok(c, msg);

test('Caso POS: cancela el pedido', () => {
    const r1 = revertirCobro(1, { sucursalDefault: 'Centro' });
    ok(r1.ok, 'reversión ejecuta');
    ok(db.prepare('SELECT stock FROM inventarios WHERE id_producto=10').get().stock === 5, 'inventario repuesto 3→5');
    ok(db.prepare('SELECT puntos_ganados FROM puntos_cliente WHERE id_cliente=7').get().puntos_ganados === 300, 'puntos 800-500=300');
    ok(db.prepare('SELECT estatus FROM pedidos WHERE id_pedido=1').get().estatus === 'cancelado', 'pedido cancelado');
    ok(db.prepare('SELECT estatus FROM links_pago WHERE id_pedido=1').get().estatus === 'cancelado', 'pago cancelado');
    ok(db.prepare('SELECT puntos_acreditados FROM pedidos WHERE id_pedido=1').get().puntos_acreditados === 0, 'flag de puntos apagado');
});

test('Idempotencia de puntos: segunda reversión no vuelve a restar', () => {
    const r2 = revertirCobro(1, { sucursalDefault: 'Centro', cancelarPedido: false });
    ok(r2.puntos_revertidos === 0, 'segunda reversión no resta puntos otra vez');
    ok(db.prepare('SELECT estatus FROM pedidos WHERE id_pedido=1').get().estatus === 'Pendiente', 'cancelarPedido:false regresa a Pendiente');
});
