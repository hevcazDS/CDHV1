'use strict';
// tests/test_citas_gestion.js — P0-b: reagendar / cancelar cita por el bot
// (self-service, deja de mandar todo a "escribe asesor"). Corre el flow real
// contra el fixture con giro de servicio (citas_activo ON).
//   node tests/test_citas_gestion.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const conf = require('../bot/flows/_config');
// giro de servicio + citas ON para que el flow opere
db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('giro','barberia')").run();
db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('citas_activo','1')").run();
conf.invalidarCache();

const gestion = require('../bot/flows/citasGestionFlow');
const sm = require('../bot/sessionManager');
let ok = 0;
const pruebas = [];
const T = (n, fn) => pruebas.push([n, fn]);

const TEL = '5215550800';
const U = TEL + '@c.us';
const manana = (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10); })();
const nuevaCita = () => {
    db.prepare("DELETE FROM citas WHERE telefono=?").run(TEL);
    return db.prepare("INSERT INTO citas (telefono, nombre, servicio, fecha, hora, estatus) VALUES (?,?,?,?,?, 'confirmada')")
        .run(TEL, 'Cli', 'Corte', manana, '12:00').lastInsertRowid;
};
const cx = (action) => ({ userId: U, action, step: sm.getSession(U).paso_actual, data: sm.getSession(U).data || {}, tel: TEL, raw: action });

T('esIntencionGestion detecta cancelar/cambiar/reagendar Y consultar cita', () => {
    assert(gestion.esIntencionGestion('quiero cancelar mi cita'));
    assert(gestion.esIntencionGestion('puedo cambiar la cita?'));
    assert(gestion.esIntencionGestion('reagendar cita'));
    assert(gestion.esIntencionGestion('cuándo es mi cita'), 'consultar');
    assert(gestion.esIntencionGestion('cómo va mi cita'), 'consultar');
    assert(gestion.esIntencionGestion('mi cita'), 'consultar');
    assert(!gestion.esIntencionGestion('quiero un corte'));
});

T('sin cita futura → mensaje claro, vuelve a MENU', () => {
    db.prepare("DELETE FROM citas WHERE telefono=?").run(TEL);
    sm.clearSession(U);
    const r = gestion.iniciar(U, {}, TEL);
    assert(/no encontr/i.test(r));
    assert.strictEqual(sm.getSession(U).paso_actual, 'MENU');
});

T('iniciar con cita → muestra la cita y entra a CITA_GESTION', () => {
    nuevaCita();
    sm.clearSession(U);
    const r = gestion.iniciar(U, {}, TEL);
    assert(/12:00/.test(r) && /Reagendar/i.test(r));
    assert.strictEqual(sm.getSession(U).paso_actual, 'CITA_GESTION');
});

T('cancelar (opción 2) → estatus cancelada + log', async () => {
    const id = nuevaCita();
    sm.clearSession(U); gestion.iniciar(U, {}, TEL);
    const r = await gestion.handle(cx('2'));
    assert(/cancelada/i.test(r));
    assert.strictEqual(db.prepare('SELECT estatus FROM citas WHERE id=?').get(id).estatus, 'cancelada');
    assert(db.prepare("SELECT 1 FROM log_eventos WHERE tipo_evento='cita_cancelada'").get());
    assert.strictEqual(sm.getSession(U).paso_actual, 'MENU');
});

T('reagendar (1 → día → hora) → actualiza fecha/hora + log, no duplica cita', async () => {
    const id = nuevaCita();
    const citasAntes = db.prepare('SELECT COUNT(*) n FROM citas WHERE telefono=?').get(TEL).n;
    sm.clearSession(U); gestion.iniciar(U, {}, TEL);
    const r1 = await gestion.handle(cx('1'));
    assert(/qué día/i.test(r1) && sm.getSession(U).paso_actual === 'CITA_REAG_FECHA');
    const r2 = await gestion.handle(cx('1'));   // primer día de la lista
    assert(/hora/i.test(r2) && sm.getSession(U).paso_actual === 'CITA_REAG_HORA');
    const r3 = await gestion.handle(cx('1'));   // primera hora de la lista
    assert(/reagendada/i.test(r3));
    const fila = db.prepare('SELECT fecha, hora, estatus FROM citas WHERE id=?').get(id);
    assert.strictEqual(fila.estatus, 'confirmada', 'reagendar no cancela');
    assert(fila.fecha && fila.hora, 'fecha/hora quedaron');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM citas WHERE telefono=?').get(TEL).n, citasAntes, 'no crea cita nueva');
    assert(db.prepare("SELECT 1 FROM log_eventos WHERE tipo_evento='cita_reagendada'").get());
});

T('citas_activo OFF → el flow no opera (fail-closed a MENU)', async () => {
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('citas_activo','0')").run();
    conf.invalidarCache();
    nuevaCita(); sm.clearSession(U);
    const r = gestion.iniciar(U, {}, TEL);
    assert.strictEqual(r, null);
    assert.strictEqual(sm.getSession(U).paso_actual, 'MENU');
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('citas_activo','1')").run();
    conf.invalidarCache();
});

(async () => {
    for (const [n, fn] of pruebas) { await fn(); ok++; console.log('✅ ' + n); }
    console.log('\n' + ok + '/6 OK — reagendar/cancelar cita por el bot (self-service).');
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
    process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
