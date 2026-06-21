// tests/test_carrito.js — Contrato de partirCarrito() y wizardSearch()
// (bot/flows/_shared.js), la capa de dominio más crítica del bot: decide qué
// se recoge en tienda vs qué se envía, y qué productos recomienda el wizard.
// Mismo patrón que tests/test_marketing.js: DB SQLite real en memoria
// (DB_PATH=':memory:') con un subset de columnas hand-copiado de la base
// real (verificado con PRAGMA table_info, no contra db/schema.sql — está
// desactualizado, ver CLAUDE.md) — NO toca la base de producción.
'use strict';
process.env.DB_PATH = ':memory:';

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
    ventas_simuladas INTEGER DEFAULT 0
);
CREATE TABLE inventarios (
    id_inventory INTEGER PRIMARY KEY AUTOINCREMENT,
    id_producto  INTEGER NOT NULL REFERENCES productos(id),
    sucursal     TEXT NOT NULL,
    stock        INTEGER NOT NULL DEFAULT 0
);
`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

console.log('\nSuite: partirCarrito() y wizardSearch() (bot/flows/_shared.js)\n');

// ── partirCarrito() ──────────────────────────────────────────────────
console.log('-- partirCarrito --');

ok(JSON.stringify(partirCarrito([], 'CENTRO')) === JSON.stringify({ pickup: [], envio: [], sinStock: [] }),
    'carrito vacío devuelve las 3 listas vacías, sin tronar');

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
ok(pickup.length === 1 && pickup[0].id === pLocal, 'producto con stock local suficiente va a pickup');
ok(envio.length === 1 && envio[0].id === pCedis, 'producto sin stock local pero con stock en otra sucursal va a envío');
ok(envio[0]?._diasEntrega === 5, 'envío sin nada en tienda local estima 5 días (vs 2 si hay algo en tienda)');
ok(sinStock.length === 1 && sinStock[0].id === pSinStock, 'producto sin stock en ninguna sucursal cae en sinStock');

// Producto 4: stock parcial en tienda local (no cubre la cantidad pedida) +
// resto en CEDIS -> debe ir a envío con _diasEntrega=2 (hay algo en tienda)
const pParcial = insProd.run('Parcial', 300).lastInsertRowid;
insInv.run(pParcial, 'CENTRO', 1);
insInv.run(pParcial, 'CEDIS', 10);
const { envio: envioParcial } = partirCarrito([{ id: pParcial, name: 'Parcial', price: 300, cantidad: 3 }], 'CENTRO');
ok(envioParcial.length === 1 && envioParcial[0]._diasEntrega === 2,
    'stock local insuficiente pero >0 + resto en CEDIS va a envío con 2 días (no 5)');

// ── wizardSearch() ───────────────────────────────────────────────────
console.log('\n-- wizardSearch --');

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
ok(resultados.some(r => r.id === idMatch), 'encuentra el producto que cumple presupuesto+edad+género+tipo+stock');
ok(!resultados.some(r => r.name === 'Carro RC Caro'), 'excluye productos fuera del rango de presupuesto');
ok(!resultados.some(r => r.name === 'Rompecabezas'), 'excluye productos de un tipo_juguete distinto');
ok(!resultados.some(r => r.name === 'Carro RC Agotado'), 'excluye productos sin stock en ninguna sucursal');

// Sin resultados exactos (tipo que no existe en este catálogo) -> fallback
// relaja el filtro de tipo pero mantiene precio/edad
const resultadosFallback = wizardSearch({ presupuesto: 'medio', edad: 'nino', genero: 'nino', tipo: 'coleccionable' });
ok(resultadosFallback.some(r => r.id === idMatch),
    'sin match exacto de tipo, el fallback relaja tipo y aun así respeta presupuesto+edad+stock');

console.log(`\n${pass}/${pass + fail} pruebas pasaron\n`);
if (fail > 0) process.exit(1);
