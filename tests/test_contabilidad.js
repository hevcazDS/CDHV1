'use strict';
// tests/test_contabilidad.js — contract test del motor contable (comité 2026-07).
// Pinnea los invariantes de mayor riesgo financiero: partida doble que CUADRA,
// idempotencia de cada asiento, reversa idempotente, y el barrido de asientos
// huérfanos que repara un pago sin asiento. Sin HTTP: usa una BD temporal con el
// subset de esquema real y llama al servicio directo.  node tests/test_contabilidad.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DB = path.join(os.tmpdir(), `conta_test_${process.pid}_${Date.now()}.db`);
process.env.DB_PATH = DB;
new (require('better-sqlite3'))(DB).close();

const db = require('../bot/db_connection');
db.pragma('foreign_keys = OFF');   // contract test: no sembramos plan_cuentas/pedidos completos
db.exec(`
  CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT);
  CREATE TABLE asientos (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL DEFAULT (date('now','localtime')),
    concepto TEXT, referencia_tipo TEXT, referencia_id TEXT, sucursal TEXT, creado_en TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE asientos_detalle (id INTEGER PRIMARY KEY AUTOINCREMENT, id_asiento INTEGER, cuenta TEXT, debe REAL DEFAULT 0, haber REAL DEFAULT 0);
  CREATE TABLE pedidos (id_pedido INTEGER PRIMARY KEY, a_credito INTEGER DEFAULT 0, metodo_pago TEXT);
  CREATE TABLE pedido_detalle (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER, id_producto INTEGER, cantidad REAL, precio_unitario REAL, costo_unitario REAL, sucursal_origen TEXT);
  CREATE TABLE productos (id INTEGER PRIMARY KEY, costo REAL);
  CREATE TABLE links_pago (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER, monto REAL, estatus TEXT DEFAULT 'generado', pagado_en TEXT);
`);
db.prepare("INSERT INTO configuracion (clave,valor) VALUES ('iva_pct','16')").run();

const conta = require('../services/contabilidadService');
conta._setActivo(() => true);   // módulo contabilidad ON para el test

const cuadraGlobal = () => {
    const r = db.prepare('SELECT ROUND(SUM(debe),2) d, ROUND(SUM(haber),2) h FROM asientos_detalle').get();
    return Math.abs((r.d || 0) - (r.h || 0)) < 0.01;
};
const tieneAsiento = (tipo, ref) => !!db.prepare('SELECT 1 FROM asientos WHERE referencia_tipo=? AND referencia_id=? LIMIT 1').get(tipo, String(ref));

let ok = 0; const pruebas = [];
const t = (n, fn) => pruebas.push([n, fn]);

// pedido 1: contado, efectivo, $116 (base 100 + IVA 16), costo 40
db.prepare("INSERT INTO pedidos (id_pedido,a_credito,metodo_pago) VALUES (1,0,'efectivo')").run();
db.prepare('INSERT INTO productos (id,costo) VALUES (7,40)').run();
db.prepare("INSERT INTO pedido_detalle (id_pedido,id_producto,cantidad,precio_unitario,costo_unitario,sucursal_origen) VALUES (1,7,1,116,40,'S1')").run();

t('venta con IVA: cuadra, base 100 / IVA 16, idempotente', () => {
    conta.asientoVenta(1, 116, 'efectivo');
    assert(tieneAsiento('venta', 1) && cuadraGlobal());
    const base = db.prepare("SELECT haber FROM asientos_detalle WHERE cuenta='401'").get().haber;
    const iva = db.prepare("SELECT haber FROM asientos_detalle WHERE cuenta='209'").get().haber;
    assert.strictEqual(base, 100); assert.strictEqual(iva, 16);
    assert.strictEqual(conta.asientoVenta(1, 116, 'efectivo'), null, 'segunda vez no duplica');
});

t('costo de venta: 501/115 por 40, idempotente', () => {
    conta.asientoCostoVenta(1);
    assert(tieneAsiento('costo_venta', 1) && cuadraGlobal());
    assert.strictEqual(db.prepare("SELECT debe FROM asientos_detalle WHERE cuenta='501'").get().debe, 40);
    assert.strictEqual(conta.asientoCostoVenta(1), null, 'segunda vez no duplica');
});

t('reversa: cuadra y es idempotente', () => {
    conta.asientoReversa('venta', 1);
    assert(cuadraGlobal(), 'tras reversa el mayor sigue cuadrando');
    assert.strictEqual(conta.asientoReversa('venta', 1), null, 'no re-revierte');
});

t('barrido de huérfanos: repara un pago sin asiento', () => {
    // pedido 2 pagado (contado) SIN asiento — simula el crash tras el cobro
    db.prepare("INSERT INTO pedidos (id_pedido,a_credito,metodo_pago) VALUES (2,0,'efectivo')").run();
    db.prepare("INSERT INTO pedido_detalle (id_pedido,id_producto,cantidad,precio_unitario,costo_unitario,sucursal_origen) VALUES (2,7,1,58,40,'S1')").run();
    db.prepare("INSERT INTO links_pago (id_pedido,monto,estatus,pagado_en) VALUES (2,58,'pagado',datetime('now','localtime'))").run();
    assert(!tieneAsiento('venta', 2), 'arranca sin asiento');
    const r = conta.barrerAsientosHuerfanos();
    assert(r.reparados >= 1, 'reparó al menos 1: ' + JSON.stringify(r));
    assert(tieneAsiento('venta', 2) && tieneAsiento('costo_venta', 2) && cuadraGlobal());
    assert.strictEqual(conta.barrerAsientosHuerfanos().reparados, 0, 'ya no hay huérfanos');
});

t('reembolso: reversa ingreso + sale caja, cuadra e idempotente por devolución', () => {
    conta.asientoReembolso(55, 1, 58, 'efectivo');   // devolución #55 del pedido 1
    assert(tieneAsiento('reembolso', 55) && cuadraGlobal());
    // sale dinero por caja (101 al haber)
    assert(db.prepare("SELECT haber FROM asientos_detalle ad JOIN asientos a ON a.id=ad.id_asiento WHERE a.referencia_tipo='reembolso' AND ad.cuenta='101'").get().haber === 58);
    assert.strictEqual(conta.asientoReembolso(55, 1, 58, 'efectivo'), null, 'no reembolsa dos veces la misma devolución');
});

(async () => {
    for (const [n, fn] of pruebas) { await fn(); ok++; console.log('✅ ' + n); }
    console.log('\n' + ok + '/' + pruebas.length + ' OK — contabilidad: cuadre + idempotencia + reversa + barrido + reembolso.');
    try { db.close(); } catch (_) {}
    for (const s of ['', '-wal', '-shm']) { try { fs.rmSync(DB + s, { force: true }); } catch (_) {} }
    process.exit(ok === pruebas.length ? 0 : 1);
})().catch(e => { console.error('❌', e); process.exit(1); });
