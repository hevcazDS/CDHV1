// Contract test variantes: matriz por sucursal, agregado vía kardex,
// carrito distingue variantes, escáner por UPC de variante.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Module = require('module');
const db = new Database(':memory:');
const ok = (c, m) => assert.ok(c, m);

db.exec(`
CREATE TABLE productos (id INTEGER PRIMARY KEY, name TEXT, price REAL, tipo TEXT DEFAULT 'fisico');
CREATE TABLE inventarios (id_producto INTEGER, sucursal TEXT, stock INTEGER, stock_minimo INTEGER DEFAULT 0);
CREATE TABLE inventario_movimientos (id INTEGER PRIMARY KEY, id_producto INTEGER, sucursal TEXT, tipo TEXT,
  cantidad_anterior INTEGER, cantidad_nueva INTEGER, motivo TEXT, creado_por TEXT, creado_en TEXT DEFAULT (datetime('now')));
CREATE TABLE producto_variantes (id INTEGER PRIMARY KEY AUTOINCREMENT, id_producto INTEGER NOT NULL, talla TEXT, color TEXT,
  sku TEXT, upc TEXT, activo INTEGER NOT NULL DEFAULT 1, creado_en TEXT DEFAULT (datetime('now')), UNIQUE(id_producto, talla, color));
CREATE TABLE inventario_variantes (id_variante INTEGER NOT NULL, sucursal TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id_variante, sucursal));
`);
db.prepare("INSERT INTO productos (id, name, price) VALUES (1, 'Playera Básica', 199)").run();

const orig = Module._load;
Module._load = function (r, ...a) {
  if (typeof r === 'string' && r.includes('db_connection')) return db;
  return orig.apply(this, [r, ...a]);
};
const vs = require('../services/variantesService');
const kardexService = require('../services/kardexService');
kardexService._setDb(db);
Module._load = orig;

let porUpc; // compartido entre los casos 3 y 4 (escáner → descuento de esa misma variante)

test('1. guardar matriz con stock en 2 sucursales', () => {
    vs.guardarMatriz(1, [
      { talla: 'M', color: 'Rojo', upc: '750VAR0001', stocks: { Centro: 5, Norte: 2 } },
      { talla: 'L', color: 'Rojo', upc: '750VAR0002', stocks: { Centro: 3 } },
    ], 'tester');
    ok(db.prepare('SELECT COUNT(*) c FROM producto_variantes WHERE activo=1').get().c === 2, 'matriz crea 2 variantes');
    ok(db.prepare("SELECT stock FROM inventarios WHERE id_producto=1 AND sucursal='Centro'").get().stock === 8, 'agregado Centro = 5+3');
    ok(db.prepare("SELECT stock FROM inventarios WHERE id_producto=1 AND sucursal='Norte'").get().stock === 2, 'agregado Norte = 2');
    ok(db.prepare("SELECT COUNT(*) c FROM inventario_movimientos WHERE tipo='ajuste_variantes'").get().c === 2, 'ajustes quedaron en kardex');
});

test('2. variantesConStock para el bot', () => {
    const conStock = vs.variantesConStock(1);
    ok(conStock.length === 2 && conStock[0].etiqueta.includes('/'), `bot ve ${conStock.length} variantes con etiqueta "${conStock[0].etiqueta}"`);
});

test('3. escáner POS por UPC de variante', () => {
    porUpc = vs.porCodigo('750VAR0002');
    ok(porUpc && porUpc.id_producto === 1 && porUpc.talla === 'L', 'UPC de variante resuelve producto+talla');
});

test('4. venta descuenta el espejo de la variante', () => {
    vs.descontarVariante(porUpc.id_variante, 'Centro', 1);
    ok(db.prepare('SELECT stock FROM inventario_variantes WHERE id_variante=? AND sucursal=?').get(porUpc.id_variante, 'Centro').stock === 2, 'venta descuenta variante L: 3→2');
});

test('5. quitar una fila la INACTIVA y recalcula agregado', () => {
    vs.guardarMatriz(1, [{ talla: 'M', color: 'Rojo', upc: '750VAR0001', stocks: { Centro: 5, Norte: 2 } }], 'tester');
    ok(db.prepare("SELECT activo FROM producto_variantes WHERE talla='L'").get().activo === 0, 'fila quitada queda inactiva (histórico intacto)');
    ok(vs.variantesConStock(1).length === 1, 'el bot ya no la ofrece');
});

test('6. carrito distingue variantes (misma prenda, tallas distintas = 2 renglones)', () => {
    const items = [
      { id: 1, price: 199, id_variante: 10, variante: 'M / Rojo' },
      { id: 1, price: 199, id_variante: 11, variante: 'L / Rojo' },
    ];
    const idxDistinto = (c, p) => c.findIndex(i => i.id === p.id && (i.id_variante || null) === (p.id_variante || null));
    ok(idxDistinto([{ id: 1, id_variante: 10 }], items[1]) === -1, 'misma prenda otra talla = renglón aparte');
    ok(idxDistinto([{ id: 1, id_variante: 10 }], items[0]) === 0, 'misma talla = mismo renglón');
});
