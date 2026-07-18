'use strict';
// tests/test_asistencias.js — check-in / asistencia (gym P1). Registra visita por
// teléfono/nombre, cuenta visitas del mes, y lista el día.  node tests/test_asistencias.js
const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const A = require('../dashboard/routes/asistencias')._test;
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };
const ctx = (out) => ({ db, json: (res, d, code) => { out.d = d; out.code = code || 200; }, readJson: (req, res, cb) => cb(req._body), u: new URL('http://x/api/asistencias') });

const idCli = db.prepare("INSERT INTO clientes (nombre, telefono, activo) VALUES ('Socio Uno','5215551200',1)").run().lastInsertRowid;

t('check-in por teléfono resuelve el cliente y cuenta 1 visita del mes', () => {
    const out = {};
    A.checkin({ _body: { telefono: '5215551200' } }, null, ctx(out), { ses: { username: 'recepcion' } });
    assert(out.d.ok && out.d.nombre === 'Socio Uno' && out.d.visitas_mes === 1);
    assert.strictEqual(db.prepare('SELECT id_cliente FROM asistencias WHERE id=?').get(out.d.id).id_cliente, idCli);
});

t('segundo check-in del mismo socio → 2 visitas del mes', () => {
    const out = {};
    A.checkin({ _body: { id_cliente: idCli } }, null, ctx(out), { ses: {} });
    assert.strictEqual(out.d.visitas_mes, 2);
});

t('check-in de visitante sin cuenta (solo nombre)', () => {
    const out = {};
    A.checkin({ _body: { nombre: 'Invitado' } }, null, ctx(out), { ses: {} });
    assert(out.d.ok && out.d.nombre === 'Invitado');
    assert.strictEqual(db.prepare('SELECT id_cliente FROM asistencias WHERE id=?').get(out.d.id).id_cliente, null);
});

t('listar el día devuelve las 3 visitas', () => {
    const out = {};
    A.listar(null, null, ctx(out), { u: new URL('http://x/api/asistencias') });
    assert.strictEqual(out.d.total, 3);
    assert(out.d.asistencias.some(a => a.nombre === 'Socio Uno') && out.d.asistencias.some(a => a.nombre === 'Invitado'));
});

console.log('\n' + ok + '/4 OK — check-in / asistencia del gimnasio.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
process.exit(ok === 4 ? 0 : 1);
