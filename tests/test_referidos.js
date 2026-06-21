// tests/test_referidos.js — Pruebas de contrato del programa de referidos
// (bot/handlers/referidosService.js). A diferencia de test_lealtad.js /
// test_marketing.js (que replican el SQL a mano), aquí se intercepta
// require('../db_connection') con un better-sqlite3 en memoria real y se
// REQUIERE el módulo real, así que se prueba el código real, no una réplica.
// Ejecutar: node tests/test_referidos.js
'use strict';

const path     = require('path');
const Module   = require('module');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
db.exec(`
CREATE TABLE clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono TEXT, nombre TEXT,
    codigo_referido TEXT, referido_por_id INTEGER
);
CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT, actualizado_en TEXT);
CREATE TABLE pedidos (
    id_pedido INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente INTEGER, estatus TEXT
);
CREATE TABLE referidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_referente INTEGER, id_referido INTEGER, telefono_referido TEXT,
    puntos_otorgados INTEGER DEFAULT 100,
    creado_en TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE puntos_cliente (
    id_cliente INTEGER PRIMARY KEY, telefono TEXT,
    puntos_ganados INTEGER DEFAULT 0, ultimo_movimiento TEXT
);
CREATE TABLE movimientos_puntos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cliente INTEGER, telefono TEXT, tipo TEXT, puntos INTEGER, concepto TEXT
);
CREATE TABLE cola_notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT, destinatario TEXT, asunto TEXT, cuerpo TEXT, estatus TEXT
);
`);

const _origLoad = Module._load.bind(Module);
Module._load = function (req, parent, isMain) {
    if (req === '../db_connection') return db;
    return _origLoad(req, parent, isMain);
};

const referidosService = require(path.join(__dirname, '..', 'bot', 'handlers', 'referidosService'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

function nuevoCliente(tel, nombre) {
    return db.prepare('INSERT INTO clientes (telefono, nombre) VALUES (?,?)').run(tel, nombre).lastInsertRowid;
}
function confirmarPrimeraCompra(idCliente) {
    return db.prepare("INSERT INTO pedidos (id_cliente, estatus) VALUES (?, 'confirmado')").run(idCliente).lastInsertRowid;
}

console.log('\nSuite: Programa de referidos (referidosService.js, módulo real)\n');

// ── 1. Vinculación en primer mensaje no otorga nada todavía ────────────────
{
    const idReferente = nuevoCliente('521000000001', 'Ana');
    const codigo = referidosService.asegurarCodigoReferido(idReferente);
    ok(/^REF-[A-Z0-9]{8}$/.test(codigo), 'asegurarCodigoReferido genera formato REF-XXXXXXXX');

    const idNuevo = nuevoCliente('521000000002', 'Beto');
    const res = referidosService.procesarReferidoSiAplica(idNuevo, '521000000002', 'hola, me invitó ' + codigo);
    ok(res && res.ok && res.idReferente === idReferente, 'procesarReferidoSiAplica vincula al referente correcto');

    const cli = db.prepare('SELECT referido_por_id FROM clientes WHERE id=?').get(idNuevo);
    ok(cli.referido_por_id === idReferente, 'clientes.referido_por_id queda vinculado');

    const puntos = db.prepare('SELECT * FROM puntos_cliente WHERE id_cliente=?').get(idReferente);
    ok(!puntos, 'NO se otorgan puntos en el primer contacto (solo se vincula)');
    const notifs = db.prepare('SELECT * FROM cola_notificaciones').all();
    ok(notifs.length === 0, 'NO se manda ningún mensaje en el primer contacto');

    // Segundo mensaje con código no debe reasignar el vínculo
    const idOtroReferente = nuevoCliente('521000000003', 'Carla');
    const codigo2 = referidosService.asegurarCodigoReferido(idOtroReferente);
    referidosService.procesarReferidoSiAplica(idNuevo, '521000000002', 'ahora uso ' + codigo2);
    const cli2 = db.prepare('SELECT referido_por_id FROM clientes WHERE id=?').get(idNuevo);
    ok(cli2.referido_por_id === idReferente, 'un vínculo ya hecho no se reasigna con un segundo código');
}

// ── 2. Primera compra finalizada: mensaje + puntos al referente ───────────
{
    const idReferente = nuevoCliente('521000000010', 'Diana');
    const codigoRef = referidosService.asegurarCodigoReferido(idReferente);
    const idReferido = nuevoCliente('521000000011', 'Eric');
    referidosService.procesarReferidoSiAplica(idReferido, '521000000011', 'me invitó ' + codigoRef);

    confirmarPrimeraCompra(idReferido);
    const res = referidosService.otorgarPuntosPorPrimeraCompra(idReferido);
    ok(res && res.ok && res.otorgoPuntosReferente === true, 'otorgarPuntosPorPrimeraCompra acredita al referente');

    const notifComprador = db.prepare("SELECT * FROM cola_notificaciones WHERE destinatario='521000000011'").get();
    ok(!!notifComprador && /código de referido/i.test(notifComprador.cuerpo), 'el comprador recibe su propio código de referido');
    ok(/m[aá]ximo 3 referidos por semana/i.test(notifComprador.cuerpo), 'el mensaje al comprador avisa el tope semanal de 3');

    const fila = db.prepare('SELECT * FROM referidos WHERE id_referente=? AND id_referido=?').get(idReferente, idReferido);
    ok(!!fila, 'se crea la fila en referidos (referente, referido)');

    const saldoReferente = db.prepare('SELECT puntos_ganados FROM puntos_cliente WHERE id_cliente=?').get(idReferente);
    ok(saldoReferente && saldoReferente.puntos_ganados === 100, 'el referente recibe +100 puntos');

    const notifReferente = db.prepare("SELECT * FROM cola_notificaciones WHERE destinatario='521000000010'").get();
    ok(!!notifReferente && /puntos sumados/i.test(notifReferente.cuerpo), 'el referente recibe notificación de puntos ganados');
}

// ── 3. Idempotencia: compras siguientes no vuelven a disparar nada ────────
{
    const idReferente = nuevoCliente('521000000020', 'Fer');
    const codigoRef = referidosService.asegurarCodigoReferido(idReferente);
    const idReferido = nuevoCliente('521000000021', 'Gus');
    referidosService.procesarReferidoSiAplica(idReferido, '521000000021', 'me invitó ' + codigoRef);

    confirmarPrimeraCompra(idReferido); // compra #1 — dispara
    referidosService.otorgarPuntosPorPrimeraCompra(idReferido);
    confirmarPrimeraCompra(idReferido); // compra #2 — NO debe disparar nada más
    const res2 = referidosService.otorgarPuntosPorPrimeraCompra(idReferido);
    ok(res2 === null, 'una segunda compra finalizada no vuelve a disparar el flujo (nFinalizados!==1)');

    const saldo = db.prepare('SELECT puntos_ganados FROM puntos_cliente WHERE id_cliente=?').get(idReferente);
    ok(saldo.puntos_ganados === 100, 'el referente no recibe puntos duplicados en la segunda compra');
}

// ── 4. Tope semanal de 3 referidos: el comprador igual recibe su código,
//      pero el referente NO se acredita si ya llegó al tope ────────────────
{
    const idReferente = nuevoCliente('521000000030', 'Hugo');
    for (let i = 0; i < 3; i++) {
        const idR = nuevoCliente('52100000004' + i, 'relleno' + i);
        db.prepare('INSERT INTO referidos (id_referente, id_referido, telefono_referido) VALUES (?,?,?)')
          .run(idReferente, idR, '52100000004' + i);
    }
    const codigoRef = referidosService.asegurarCodigoReferido(idReferente);
    const idReferido = nuevoCliente('521000000050', 'Ivan');
    referidosService.procesarReferidoSiAplica(idReferido, '521000000050', 'me invitó ' + codigoRef);
    confirmarPrimeraCompra(idReferido);
    const res = referidosService.otorgarPuntosPorPrimeraCompra(idReferido);
    ok(res && res.otorgoPuntosReferente === false, 'al llegar al tope semanal, NO se acredita al referente');

    const notifComprador = db.prepare("SELECT * FROM cola_notificaciones WHERE destinatario='521000000050'").get();
    ok(!!notifComprador, 'el comprador SIGUE recibiendo su propio código aunque el referente esté topado');

    const filaNueva = db.prepare('SELECT id FROM referidos WHERE id_referente=? AND id_referido=?').get(idReferente, idReferido);
    ok(!filaNueva, 'no se inserta fila en referidos cuando se topó el límite semanal');
}

// ── 5. Apagador: referidos_activo='0' desactiva todo el programa ──────────
{
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('referidos_activo','0')").run();

    const idReferente = nuevoCliente('521000000060', 'Julia');
    const codigoRef = referidosService.asegurarCodigoReferido(idReferente); // sigue funcionando standalone
    const idReferido = nuevoCliente('521000000061', 'Kevin');
    const resLink = referidosService.procesarReferidoSiAplica(idReferido, '521000000061', 'me invitó ' + codigoRef);
    ok(resLink === null, 'con el apagador en 0, procesarReferidoSiAplica no vincula nada');

    confirmarPrimeraCompra(idReferido);
    const resCompra = referidosService.otorgarPuntosPorPrimeraCompra(idReferido);
    ok(resCompra === null, 'con el apagador en 0, otorgarPuntosPorPrimeraCompra no hace nada');

    db.prepare("DELETE FROM configuracion WHERE clave='referidos_activo'").run();
}

console.log('\nResultado: ' + pass + ' pass, ' + fail + ' fail\n');
process.exit(fail ? 1 : 0);
