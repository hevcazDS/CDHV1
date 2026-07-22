// tests/test_direccion_guardada.js — Pruebas de contrato del atajo de
// "reusar dirección guardada" (Fase JIUA 8, hallazgo del Diseñador
// Conversacional: el embudo de envío repetía nombre/calle/colonia/ciudad/
// referencia incluso para clientes recurrentes con la misma dirección).
//
// Mismo patrón que tests/test_referidos.js: se intercepta
// require('../db_connection') / require('./db_connection') con un
// better-sqlite3 en memoria real y se REQUIEREN los módulos reales
// (bot/flows/_shared.js, bot/sessionManager.js, bot/flows/addressFlow.js,
// bot/flows/orderFlow.js), así que se prueba el código real.
// Ejecutar: node --test tests/test_direccion_guardada.js
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const Module   = require('module');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
db.exec(`
CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT, descripcion TEXT, actualizado_en TEXT);
CREATE TABLE clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono TEXT, nombre TEXT, canal_origen TEXT, activo INTEGER DEFAULT 1,
    ultima_actividad TEXT
);
CREATE TABLE direcciones_envio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente INTEGER, alias TEXT, calle TEXT, colonia TEXT, ciudad TEXT,
    estado TEXT, cp TEXT, referencia TEXT, es_default INTEGER DEFAULT 0
);
CREATE TABLE pedidos (
    id_pedido INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT, cliente TEXT, id_cliente INTEGER, estatus TEXT, tono_bot TEXT
);
CREATE TABLE puntos_entrega (id INTEGER PRIMARY KEY AUTOINCREMENT, estado TEXT, activo INTEGER DEFAULT 1, nombre TEXT, direccion TEXT, maps_url TEXT);
`);

const _origLoad = Module._load.bind(Module);
Module._load = function (req, parent, isMain) {
    if (req === '../db_connection' || req === './db_connection') return db;
    return _origLoad(req, parent, isMain);
};

const shared      = require(path.join(__dirname, '..', 'bot', 'flows', '_shared'));
const sessionMgr  = require(path.join(__dirname, '..', 'bot', 'sessionManager'));
const addressFlow = require(path.join(__dirname, '..', 'bot', 'flows', 'addressFlow'));
const orderFlow   = require(path.join(__dirname, '..', 'bot', 'flows', 'orderFlow'));
const { S } = shared;

function nuevoCliente(tel, nombre) {
    return db.prepare('INSERT INTO clientes (telefono, nombre) VALUES (?,?)').run(tel, nombre).lastInsertRowid;
}
function guardarDireccion(idCliente, dir) {
    db.prepare(`
        INSERT INTO direcciones_envio (id_cliente, alias, calle, colonia, ciudad, estado, cp, referencia, es_default)
        VALUES (?, 'WhatsApp', ?, ?, ?, ?, ?, ?, 1)
    `).run(idCliente, dir.calle, dir.colonia, dir.ciudad, dir.estado, dir.cp, dir.referencia || '');
}
function ctxBase(userId, tel, step, data, action, raw) {
    return { userId, session: {}, message: {}, client: {}, raw: raw ?? action, action, step, data, tel };
}

// ── 1. Sin dirección guardada → va directo a ASK_NOMBRE, como antes ───────
test('sin dirección guardada → va directo a ASK_NOMBRE, como antes', () => {
    const tel = '521100000001';
    nuevoCliente(tel, 'Nuevo Cliente');
    const userId = tel + '@c.us';
    const prompt = shared.iniciarCapturaDireccion(userId, tel, { metodo: 'envio' });
    assert.ok(/nombre completo/i.test(prompt), 'sin dirección previa, el prompt pide nombre completo directamente');
    const ses = sessionMgr.getSession(userId);
    assert.ok(ses.paso_actual === S.ASK_NOMBRE, 'la sesión avanza a ASK_NOMBRE cuando no hay dirección guardada');
});

// ── 2. Con dirección guardada → ofrece reusarla en vez de ASK_NOMBRE ──────
test('con dirección guardada → ofrece reusarla en vez de ASK_NOMBRE', () => {
    const tel = '521100000002';
    const idCliente = nuevoCliente(tel, 'Cliente Recurrente');
    guardarDireccion(idCliente, { calle: 'Av. Siempre Viva 123', colonia: 'Centro', ciudad: 'SLP', estado: 'San Luis Potosí', cp: '78000', referencia: 'Casa azul' });
    const userId = tel + '@c.us';

    const prompt = shared.iniciarCapturaDireccion(userId, tel, { metodo: 'envio', carrito: [{ name: 'Lego', price: 500, cantidad: 1 }] });
    assert.ok(/dirección guardada/i.test(prompt), 'con dirección previa, ofrece reusarla');
    assert.ok(prompt.includes('Av. Siempre Viva 123') && prompt.includes('Casa azul'), 'el prompt muestra la dirección guardada completa');

    const ses = sessionMgr.getSession(userId);
    assert.ok(ses.paso_actual === S.CONFIRM_DIR_GUARDADA, 'la sesión avanza a CONFIRM_DIR_GUARDADA en vez de ASK_NOMBRE');
    assert.ok(ses.data.direccionGuardada && ses.data.direccionGuardada.calle === 'Av. Siempre Viva 123', 'la dirección guardada queda disponible en session.data');
});

// ── 3. Aceptar la dirección guardada (opción 1) construye el resumen y
//      avanza a CONFIRM_ORDER con los datos de la dirección ya mergeados ──
test('opción 1 acepta la dirección guardada: construye el resumen y avanza a CONFIRM_ORDER', async () => {
    const tel = '521100000003';
    const idCliente = nuevoCliente(tel, 'Cliente Tres');
    guardarDireccion(idCliente, { calle: 'Calle Falsa 456', colonia: 'Jardines', ciudad: 'Querétaro', estado: 'Querétaro', cp: '76000', referencia: 'Portón negro' });
    const userId = tel + '@c.us';

    sessionMgr.updateSession(userId, S.CONFIRM_DIR_GUARDADA, {
        metodo: 'envio',
        carrito: [{ name: 'Carrito RC', price: 800, cantidad: 1 }],
        direccionGuardada: { nombre: 'Cliente Tres', calle: 'Calle Falsa 456', colonia: 'Jardines', ciudad: 'Querétaro', estado: 'Querétaro', cp: '76000', referencia: 'Portón negro' },
    });
    const ses1 = sessionMgr.getSession(userId);
    const ctx = ctxBase(userId, tel, S.CONFIRM_DIR_GUARDADA, ses1.data, '1');
    const texto = await addressFlow.handle(ctx);

    assert.ok(texto.includes('Calle Falsa 456') && texto.includes('Confirmar y pagar'), 'opción 1 construye el resumen del pedido con la dirección guardada');
    const ses2 = sessionMgr.getSession(userId);
    assert.ok(ses2.paso_actual === S.CONFIRM_ORDER, 'tras aceptar, la sesión avanza a CONFIRM_ORDER (igual que captura manual)');
    assert.ok(ses2.data.calle === 'Calle Falsa 456' && ses2.data.referencia === 'Portón negro', 'los datos de la dirección guardada quedan mergeados en session.data');
    assert.ok(!ses2.data.direccionGuardada, 'direccionGuardada no queda colgando en session.data una vez usada');
});

// ── 4. Rechazar la dirección guardada (opción 2) vuelve a ASK_NOMBRE ──────
test('opción 2 rechaza la dirección guardada: vuelve a ASK_NOMBRE', async () => {
    const tel = '521100000004';
    const idCliente = nuevoCliente(tel, 'Cliente Cuatro');
    guardarDireccion(idCliente, { calle: 'Vieja 1', colonia: 'Vieja Col', ciudad: 'Vieja Ciudad', estado: 'X', cp: '00000', referencia: '' });
    const userId = tel + '@c.us';

    sessionMgr.updateSession(userId, S.CONFIRM_DIR_GUARDADA, {
        metodo: 'envio',
        direccionGuardada: { nombre: 'Cliente Cuatro', calle: 'Vieja 1', colonia: 'Vieja Col', ciudad: 'Vieja Ciudad', estado: 'X', cp: '00000', referencia: '' },
    });
    const ses1 = sessionMgr.getSession(userId);
    const ctx = ctxBase(userId, tel, S.CONFIRM_DIR_GUARDADA, ses1.data, '2');
    const texto = await addressFlow.handle(ctx);

    assert.ok(/nombre completo/i.test(texto), 'opción 2 vuelve a pedir el nombre completo desde cero');
    const ses2 = sessionMgr.getSession(userId);
    assert.ok(ses2.paso_actual === S.ASK_NOMBRE, 'la sesión retrocede a ASK_NOMBRE al rechazar la dirección guardada');
    assert.ok(!ses2.data.direccionGuardada, 'direccionGuardada se descarta al elegir "usar otra"');
});

// ── 5. Integración real: orderFlow.js (S.DELIVERY, soloEnvio) ofrece la
//      dirección guardada en vez de ir directo a ASK_NOMBRE ───────────────
test('orderFlow.js (DELIVERY soloEnvio) ofrece la dirección guardada real, no solo el ASK_NOMBRE hardcoded', async () => {
    const tel = '521100000005';
    const idCliente = nuevoCliente(tel, 'Cliente Cinco');
    guardarDireccion(idCliente, { calle: 'Integración 5', colonia: 'Col5', ciudad: 'CDMX', estado: 'CDMX', cp: '01000', referencia: '' });
    const userId = tel + '@c.us';

    const ctx = ctxBase(userId, tel, S.DELIVERY, { soloEnvio: true, carrito: [] }, '1');
    const texto = await orderFlow.handle(ctx);
    assert.ok(/dirección guardada/i.test(texto) && texto.includes('Integración 5'), 'orderFlow.js (DELIVERY soloEnvio) ofrece la dirección guardada real, no solo el ASK_NOMBRE hardcoded');
    const ses = sessionMgr.getSession(userId);
    assert.ok(ses.paso_actual === S.CONFIRM_DIR_GUARDADA, 'orderFlow.js deja la sesión en CONFIRM_DIR_GUARDADA, no en ASK_NOMBRE');
});
