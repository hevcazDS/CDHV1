// tests/test_puntos_compra.js — Pruebas de contrato de puntosService.js
// (sistema de puntos por compra/referido, sin escaneo de ticket físico).
// Igual patrón que test_referidos.js: se intercepta require('../db_connection')
// con un better-sqlite3 en memoria real y se REQUIERE el módulo real.
// Ejecutar: node tests/test_puntos_compra.js
'use strict';

const path     = require('path');
const Module   = require('module');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
db.exec(`
CREATE TABLE clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono TEXT, nombre TEXT
);
CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT, actualizado_en TEXT);
CREATE TABLE pedidos (
    id_pedido INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente INTEGER, estatus TEXT, total REAL,
    puntos_acreditados INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE puntos_cliente (
    id_cliente INTEGER PRIMARY KEY, telefono TEXT,
    puntos_ganados INTEGER DEFAULT 0, puntos_canjeados INTEGER DEFAULT 0, ultimo_movimiento TEXT
);
CREATE TABLE movimientos_puntos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente INTEGER, telefono TEXT, tipo TEXT, puntos INTEGER, concepto TEXT,
    creado_en TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE cola_notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT, destinatario TEXT, asunto TEXT, cuerpo TEXT, estatus TEXT
);
CREATE TABLE promociones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT, tipo TEXT, valor REAL, id_producto INTEGER, activa INTEGER DEFAULT 1,
    fecha_inicio TEXT, fecha_fin TEXT, usos_max INTEGER DEFAULT 0, usos_actual INTEGER DEFAULT 0
);
CREATE TABLE regalos_lealtad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente INTEGER, telefono TEXT, codigo_cupon TEXT, valor REAL,
    puntos_usados INTEGER, expira_en TEXT, estatus TEXT DEFAULT 'activo'
);
`);

const _origLoad = Module._load.bind(Module);
Module._load = function (req, parent, isMain) {
    if (req === '../db_connection') return db;
    return _origLoad(req, parent, isMain);
};

const puntosService = require(path.join(__dirname, '..', 'bot', 'handlers', 'puntosService'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

function nuevoCliente(tel, nombre) {
    return db.prepare('INSERT INTO clientes (telefono, nombre) VALUES (?,?)').run(tel, nombre).lastInsertRowid;
}
function nuevoPedido(idCliente, total) {
    return db.prepare("INSERT INTO pedidos (id_cliente, estatus, total) VALUES (?, 'confirmado', ?)").run(idCliente, total).lastInsertRowid;
}

console.log('\nSuite: Puntos por compra (puntosService.js, módulo real)\n');

// ── 1. Apagador: módulo inactivo por defecto ───────────────────────────────
{
    ok(puntosService.puntosActivo() === false, 'puntos_activo es falso por defecto (sin fila en configuracion)');
    const idCli = nuevoCliente('521000000100', 'Pablo');
    const idPed = nuevoPedido(idCli, 500);
    const res = puntosService.otorgarPuntosPorCompra(idPed);
    ok(res === null, 'con el módulo apagado, otorgarPuntosPorCompra no hace nada');
    const ped = db.prepare('SELECT puntos_acreditados FROM pedidos WHERE id_pedido=?').get(idPed);
    ok(ped.puntos_acreditados === 0, 'el pedido no queda marcado como acreditado si el módulo está apagado');
}

db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('puntos_activo','1')").run();
ok(puntosService.puntosActivo() === true, 'puntos_activo se activa explícitamente desde Módulos');

// ── 2. Compra normal: 1 punto por peso, notifica, idempotente ─────────────
{
    const idCli = nuevoCliente('521000000101', 'Quica');
    const idPed = nuevoPedido(idCli, 500);
    const res = puntosService.otorgarPuntosPorCompra(idPed);
    ok(res && res.puntosSumados === 500, 'acredita 1 punto por peso de la compra');
    ok(res.puntosDisp === 500, 'el saldo disponible refleja los puntos recién ganados');

    const notif = db.prepare("SELECT * FROM cola_notificaciones WHERE destinatario='521000000101'").get();
    ok(!!notif && /ganaste \*500 puntos\*/i.test(notif.cuerpo), 'notifica al cliente cuánto ganó');

    const res2 = puntosService.otorgarPuntosPorCompra(idPed);
    ok(res2 === null, 'el mismo pedido no se acredita dos veces (puntos_acreditados)');
    const saldo = db.prepare('SELECT puntos_ganados FROM puntos_cliente WHERE id_cliente=?').get(idCli);
    ok(saldo.puntos_ganados === 500, 'el saldo no duplica puntos en una segunda llamada');
}

// ── 3. Cruzar el umbral de 2,000 puntos emite un cupón de 10% ─────────────
{
    const idCli = nuevoCliente('521000000102', 'Rodo');
    const idPed = nuevoPedido(idCli, 2500);
    const res = puntosService.otorgarPuntosPorCompra(idPed);
    ok(res.cuponesNuevos.length === 1, 'al cruzar 2,000 puntos disponibles se emite 1 cupón de 10%');
    ok(/^LEAL-[A-Z0-9]{6}$/.test(res.cuponesNuevos[0].cupon), 'el cupón tiene el formato LEAL-XXXXXX');

    const promo = db.prepare('SELECT * FROM promociones WHERE codigo=?').get(res.cuponesNuevos[0].cupon);
    ok(promo && promo.tipo === 'porcentaje' && promo.valor === 10 && promo.usos_max === 1, 'el cupón es 10% de un solo uso');

    const notif = db.prepare("SELECT * FROM cola_notificaciones WHERE destinatario='521000000102'").get();
    ok(/cupón de 10% de descuento/i.test(notif.cuerpo), 'la notificación informa el cupón ganado');

    const saldo = db.prepare('SELECT puntos_ganados, puntos_canjeados FROM puntos_cliente WHERE id_cliente=?').get(idCli);
    ok(saldo.puntos_ganados - saldo.puntos_canjeados === 500, 'el saldo disponible baja en 2,000 al canjear el cupón');
}

// ── 4. Tope de 4,000 puntos redimidos en cualquier ventana de 30 días ─────
{
    const idCli = nuevoCliente('521000000103', 'Sole');
    // Una sola compra grande alcanza para 4 cupones (8,000 puntos), pero el
    // tope de la ventana de 30 días solo permite redimir 2 (4,000 puntos)
    // de una sola vez.
    const idPed = nuevoPedido(idCli, 8000);
    const res = puntosService.otorgarPuntosPorCompra(idPed);
    ok(res.cuponesNuevos.length === 2, 'el tope de 30 días limita a 2 cupones aunque el saldo alcance para más');

    const canjeado = db.prepare(`
        SELECT COALESCE(SUM(-puntos),0) AS n FROM movimientos_puntos
        WHERE id_cliente=? AND tipo='canje'
    `).get(idCli).n;
    ok(canjeado === 4000, 'no se redimen más de 4,000 puntos en la ventana de 30 días');

    const notif = db.prepare("SELECT * FROM cola_notificaciones WHERE destinatario='521000000103'").get();
    ok(/tope de puntos redimibles/i.test(notif.cuerpo), 'se avisa al cliente que llegó al tope de redención');

    // Una segunda compra dentro del mismo periodo no debe poder redimir nada
    // que empuje el total canjeado en los últimos 30 días por encima de 4,000.
    const idPed2 = nuevoPedido(idCli, 100);
    puntosService.otorgarPuntosPorCompra(idPed2);
    const canjeado2 = db.prepare(`
        SELECT COALESCE(SUM(-puntos),0) AS n FROM movimientos_puntos
        WHERE id_cliente=? AND tipo='canje' AND datetime(creado_en) >= datetime('now','-30 days','localtime')
    `).get(idCli).n;
    ok(canjeado2 <= 4000, 'el total redimido en la ventana de 30 días nunca supera el tope, ni con compras adicionales');
}

console.log('\nResultado: ' + pass + ' pass, ' + fail + ' fail\n');
process.exit(fail ? 1 : 0);
