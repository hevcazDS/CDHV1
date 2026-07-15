'use strict';
// tests/test_citas_empleado.js — P2: citas por empleado + comisión por servicio.
// Contract test: asignación (crear/actualizar), listado con nombre, y el reporte
// de comisiones (citas COBRADAS × comision_pct del empleado, fallback al global).
//   node tests/test_citas_empleado.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

// Dos barberos: uno con comisión propia (20%), otro sin (usa la global 10%).
db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('comision_pct','10')").run();
const eA = db.prepare("INSERT INTO empleados (nombre, puesto, salario_diario, comision_pct) VALUES ('Barbero A','barbero',300,20)").run().lastInsertRowid;
const eB = db.prepare("INSERT INTO empleados (nombre, puesto, salario_diario, comision_pct) VALUES ('Barbero B','barbero',300,0)").run().lastInsertRowid;

const hoy = new Date().toISOString().slice(0, 10);

// Citas cobradas: A corta $200, B corta $100 (pedido + link pagado + id_pedido).
function citaCobrada(idEmp, precio) {
    const ped = db.prepare("INSERT INTO pedidos (cliente, id_producto, cantidad, estatus, total) VALUES ('X',1,1,'entregado',?)").run(precio).lastInsertRowid;
    db.prepare("INSERT INTO links_pago (id_pedido, monto, moneda, estatus, pagado_en) VALUES (?,?,'MXN','pagado',datetime('now','localtime'))").run(ped, precio);
    return db.prepare("INSERT INTO citas (telefono, servicio, servicio_precio, fecha, hora, id_empleado, id_pedido, estatus) VALUES ('5218110000000','Corte',?,?,?,?,?,'completada')")
        .run(precio, hoy, '11:00', idEmp, ped).lastInsertRowid;
}
citaCobrada(eA, 200);
citaCobrada(eB, 100);
// Una cita SIN cobrar de A — no debe contar en comisiones.
db.prepare("INSERT INTO citas (telefono, servicio, fecha, hora, id_empleado) VALUES ('5218110000001','Corte',?,?,?)").run(hoy, '12:00', eA);

t('citas.id_empleado: asignación y reasignación persisten', () => {
    const id = db.prepare("INSERT INTO citas (telefono, servicio, fecha, hora, id_empleado) VALUES ('5218110000002','Tinte',?, '13:00', ?)").run(hoy, eA).lastInsertRowid;
    assert.strictEqual(db.prepare('SELECT id_empleado FROM citas WHERE id=?').get(id).id_empleado, eA);
    db.prepare('UPDATE citas SET id_empleado=? WHERE id=?').run(eB, id);
    assert.strictEqual(db.prepare('SELECT id_empleado FROM citas WHERE id=?').get(id).id_empleado, eB);
});

t('listado con nombre del empleado (LEFT JOIN — sin asignar no truena)', () => {
    const filas = db.prepare(`SELECT c.id, e.nombre AS empleado_nombre FROM citas c LEFT JOIN empleados e ON e.id=c.id_empleado WHERE c.fecha=?`).all(hoy);
    assert(filas.some(f => f.empleado_nombre === 'Barbero A'));
    assert(filas.some(f => f.empleado_nombre === 'Barbero B'));
});

t('comisiones: solo citas COBRADAS, pct propio (A: 200×20%=40) y fallback global (B: 100×10%=10)', () => {
    const { comisiones } = require('../dashboard/routes/citas')._test;
    let out = null;
    const ctx = { db, json: (res, data) => { out = data; } };
    comisiones(null, null, ctx, { u: new URL('http://x/api/citas/comisiones?desde=' + hoy + '&hasta=' + hoy) });
    const A = out.filas.find(f => f.nombre === 'Barbero A');
    const B = out.filas.find(f => f.nombre === 'Barbero B');
    assert.strictEqual(A.cobrado, 200);
    assert.strictEqual(A.servicios, 1, 'la cita sin cobrar de A no cuenta');
    assert.strictEqual(A.comision, 40, '200 × 20% (pct propio)');
    assert.strictEqual(B.comision, 10, '100 × 10% (fallback global)');
});

console.log('\n' + ok + '/3 OK — citas por empleado + comisión por servicio.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
