// tests/test_carrito.js — Contrato de partirCarrito() y wizardSearch()
// (bot/flows/_shared.js), la capa de dominio más crítica del bot: decide qué
// se recoge en tienda vs qué se envía, y qué productos recomienda el wizard.
// Mismo patrón que tests/test_marketing.js: DB SQLite real en memoria
// (DB_PATH=':memory:') con un subset de columnas hand-copiado de la base
// real (verificado con PRAGMA table_info, no contra db/schema.sql — está
// desactualizado, ver CLAUDE.md) — NO toca la base de producción.
//   node --test tests/test_carrito.js
'use strict';
process.env.DB_PATH = ':memory:';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../bot/db_connection');
const { partirCarrito, wizardSearch } = require('../bot/flows/_shared');

db.exec(`
CREATE TABLE productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cat TEXT,
    price REAL NOT NULL DEFAULT 0,
    url_imagen TEXT,
    tags TEXT,
    seo_description TEXT,
    edad_recomendada TEXT,
    edad_min INTEGER,
    edad_max INTEGER,
    genero TEXT,
    tipo_juguete TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    stock_tienda INTEGER NOT NULL DEFAULT 0,
    stock_cedis INTEGER NOT NULL DEFAULT 0,
    stock_exhibicion INTEGER DEFAULT 0,
    ventas_simuladas INTEGER DEFAULT 0
);
CREATE TABLE inventarios (
    id_inventory INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto  INTEGER NOT NULL REFERENCES productos(id),
    sucursal     TEXT NOT NULL,
    stock        INTEGER NOT NULL DEFAULT 0
);
`);

// ── partirCarrito() ──────────────────────────────────────────────────

test('carrito vacío devuelve las 3 listas vacías, sin tronar', () => {
    assert.strictEqual(JSON.stringify(partirCarrito([], 'CENTRO')), JSON.stringify({ pickup: [], envio: [], sinStock: [] }));
});

const insProd = db.prepare('INSERT INTO productos (name, price) VALUES (?, ?)');
const insInv  = db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock) VALUES (?, ?, ?)');

// Producto 1: stock suficiente en la sucursal local del cliente -> pickup
const pLocal = insProd.run('Lego Local', 500).lastInsertRowid;
insInv.run(pLocal, 'CENTRO', 10);

// Producto 2: sin stock local pero sí en CEDIS -> envío
const pCedis = insProd.run('Bici CEDIS', 1200).lastInsertRowid;
insInv.run(pCedis, 'CEDIS', 5);

// Producto 3: sin stock en ninguna sucursal -> sin stock
const pSinStock = insProd.run('Agotado', 100).lastInsertRowid;

const carritoMixto = [
    { id: pLocal,    name: 'Lego Local', price: 500,  cantidad: 1 },
    { id: pCedis,    name: 'Bici CEDIS', price: 1200, cantidad: 1 },
    { id: pSinStock, name: 'Agotado',    price: 100,  cantidad: 1 },
];
const { pickup, envio, sinStock } = partirCarrito(carritoMixto, 'CENTRO');

test('producto con stock local suficiente va a pickup', () => {
    assert(pickup.length === 1 && pickup[0].id === pLocal);
});

test('producto sin stock local pero con stock en otra sucursal va a envío', () => {
    assert(envio.length === 1 && envio[0].id === pCedis);
});

test('envío sin nada en tienda local estima 5 días (vs 2 si hay algo en tienda)', () => {
    assert(envio[0]?._diasEntrega === 5);
});

test('producto sin stock en ninguna sucursal cae en sinStock', () => {
    assert(sinStock.length === 1 && sinStock[0].id === pSinStock);
});

// Producto 4: stock parcial en tienda local (no cubre la cantidad pedida) +
// resto en CEDIS -> debe ir a envío con _diasEntrega=2 (hay algo en tienda)
const pParcial = insProd.run('Parcial', 300).lastInsertRowid;
insInv.run(pParcial, 'CENTRO', 1);
insInv.run(pParcial, 'CEDIS', 10);
const { envio: envioParcial } = partirCarrito([{ id: pParcial, name: 'Parcial', price: 300, cantidad: 3 }], 'CENTRO');

test('stock local insuficiente pero >0 + resto en CEDIS va a envío con 2 días (no 5)', () => {
    assert(envioParcial.length === 1 && envioParcial[0]._diasEntrega === 2);
});

// ── wizardSearch() ───────────────────────────────────────────────────

const insProdNorm = db.prepare(`
    INSERT INTO productos (name, cat, price, edad_min, edad_max, genero, tipo_juguete, activo, stock_tienda, ventas_simuladas)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
// Coincide con: presupuesto medio (250-500), edad nino (3-8), genero nino, tipo diversion
const idMatch = insProdNorm.run('Carro RC', 'Vehículos', 400, 3, 8, 'nino', 'diversion', 10, 5).lastInsertRowid;
// No coincide en precio (fuera de rango medio)
insProdNorm.run('Carro RC Caro', 'Vehículos', 900, 3, 8, 'nino', 'diversion', 10, 5);
// No coincide en tipo (educativo, no diversion)
insProdNorm.run('Rompecabezas', 'Educativo', 400, 3, 8, 'nino', 'educativo', 10, 5);
// Sin stock en ninguna sucursal -> no debe aparecer
insProdNorm.run('Carro RC Agotado', 'Vehículos', 400, 3, 8, 'nino', 'diversion', 0, 5);

const resultados = wizardSearch({ presupuesto: 'medio', edad: 'nino', genero: 'nino', tipo: 'diversion' });

test('encuentra el producto que cumple presupuesto+edad+género+tipo+stock', () => {
    assert(resultados.some(r => r.id === idMatch));
});

test('excluye productos fuera del rango de presupuesto', () => {
    assert(!resultados.some(r => r.name === 'Carro RC Caro'));
});

test('excluye productos de un tipo_juguete distinto', () => {
    assert(!resultados.some(r => r.name === 'Rompecabezas'));
});

test('excluye productos sin stock en ninguna sucursal', () => {
    assert(!resultados.some(r => r.name === 'Carro RC Agotado'));
});

// Sin resultados exactos (tipo que no existe en este catálogo) -> fallback
// relaja el filtro de tipo pero mantiene precio/edad
const resultadosFallback = wizardSearch({ presupuesto: 'medio', edad: 'nino', genero: 'nino', tipo: 'coleccionable' });

test('sin match exacto de tipo, el fallback relaja tipo y aun así respeta presupuesto+edad+stock', () => {
    assert(resultadosFallback.some(r => r.id === idMatch));
});
