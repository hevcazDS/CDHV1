'use strict';
// tests/test_buscar_roles.js — contract test del buscador global con ALCANCE
// POR ROL (matriz aprobada: prime/gerente/auditor ven TODO; el resto solo su
// trabajo). Invoca el handler directo con ctx stub sobre el fixture.
//   node --test tests/test_buscar_roles.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const { buscar } = require('../dashboard/routes/core')._test;

// Sembrar un dato "Demo" en CADA fuente para probar exclusiones.
db.prepare("INSERT INTO clientes (nombre, telefono, activo) VALUES ('Cliente Demo','5215550001',1)").run();
db.prepare("INSERT INTO pedidos (cliente, id_producto, cantidad, estatus, folio) VALUES ('Cliente Demo',1,1,'pendiente','DEMO-0001')").run();
try { db.prepare("INSERT INTO proveedores (nombre, activo) VALUES ('Proveedor Demo',1)").run(); } catch (_) {}
try { db.prepare("INSERT INTO empleados (nombre, puesto) VALUES ('Empleado Demo','ventas')").run(); } catch (_) {}
// producto: el fixture trae 'Lego City Policía' etc.; agrego uno que matchee 'demo'
db.prepare("INSERT INTO productos (tipo, name, cat, price, activo) VALUES ('fisico','Juguete Demo','demo',10,1)").run();

function correr(rol, q) {
    let out = null;
    const ctx = {
        db,
        json: (res, data) => { out = data; },
        log: { debug: () => {} },
        obtenerSesion: () => (rol ? { rol, username: 'test-' + rol } : null),
    };
    buscar({ url: '/api/buscar?q=' + encodeURIComponent(q) }, null, ctx, {});
    return out;
}

const llenas = (r) => Object.entries(r).filter(([, v]) => v.length).map(([k]) => k).sort();

test('prime ve TODO lo que matchea', () => {
    const r = correr('prime', 'demo');
    const f = llenas(r);
    for (const k of ['clientes', 'pedidos', 'productos', 'proveedores', 'empleados']) assert(f.includes(k), 'prime debería ver ' + k);
});

test('auditor ve TODO (regla del dueño)', () => {
    const r = correr('auditor', 'demo');
    const f = llenas(r);
    for (const k of ['clientes', 'pedidos', 'proveedores', 'empleados']) assert(f.includes(k), 'auditor debería ver ' + k);
});

test('cajero: clientes/pedidos/productos SÍ — proveedores/empleados NO', () => {
    const r = correr('cajero', 'demo');
    assert(r.clientes.length > 0 && r.pedidos.length > 0 && r.productos.length > 0);
    assert.strictEqual(r.proveedores.length, 0, 'cajero NO debe ver proveedores');
    assert.strictEqual(r.empleados.length, 0, 'cajero NO debe ver empleados');
});

test('almacén: SOLO productos', () => {
    const r = correr('almacen', 'demo');
    assert(r.productos.length > 0);
    for (const k of ['clientes', 'pedidos', 'proveedores', 'empleados', 'documentos']) {
        assert.strictEqual(r[k].length, 0, 'almacén NO debe ver ' + k);
    }
});

test('rh: SOLO empleados', () => {
    const r = correr('rh', 'demo');
    assert(r.empleados.length > 0);
    for (const k of ['clientes', 'pedidos', 'productos', 'proveedores']) {
        assert.strictEqual(r[k].length, 0, 'rh NO debe ver ' + k);
    }
});

test('compras: productos y proveedores — clientes NO', () => {
    const r = correr('compras', 'demo');
    assert(r.productos.length > 0 && r.proveedores.length > 0);
    assert.strictEqual(r.clientes.length, 0);
});

test('sin sesión: alcance CERO (nada se filtra)', () => {
    const r = correr(null, 'demo');
    assert.deepStrictEqual(llenas(r), [], 'sin sesión no debe regresar nada');
});

test('detección de teléfono: dígitos → busca cliente por número', () => {
    const r = correr('prime', '5215550001');
    assert(r.clientes.length > 0 && r.clientes[0].telefono.includes('5215550001'));
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
