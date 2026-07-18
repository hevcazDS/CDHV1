'use strict';
// tests/test_mensajeria.js — mensajería interna del equipo (1-a-1 + grupos).
// Pinnea: directo idempotente (no duplica el par), grupo con N miembros, envío/
// lectura solo para miembros (403 al ajeno), y el conteo de no-leídos + marcado
// de leído al abrir.  node tests/test_mensajeria.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const M = require('../dashboard/routes/mensajeria')._test;
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

// tres usuarios
const uid = {};
for (const u of ['ana', 'beto', 'caro']) {
    uid[u] = db.prepare("INSERT INTO usuarios (username, nombre, password_hash, salt, rol) VALUES (?,?,'x','y','usuario')").run(u, u.toUpperCase()).lastInsertRowid;
}
// ctx que simula la sesión de un usuario dado (obtenerSesion por username)
const ctxDe = (username, out) => ({
    db,
    json: (res, d, code) => { out.d = d; out.code = code || 200; },
    readJson: (req, res, cb) => cb(req._body),
    obtenerSesion: () => ({ username, rol: 'usuario' }),
});

t('directo: se crea una vez y es idempotente (no duplica el par)', () => {
    const o1 = {}; M.directoPost({ _body: { id_usuario: uid.beto } }, null, ctxDe('ana', o1));
    assert(o1.d.ok && o1.d.id_canal);
    const o2 = {}; M.directoPost({ _body: { id_usuario: uid.ana } }, null, ctxDe('beto', o2)); // el otro sentido
    assert.strictEqual(o2.d.id_canal, o1.d.id_canal, 'mismo canal para el mismo par');
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM canales_internos WHERE tipo='directo'").get().n, 1);
});

t('directo: no se puede chatear con uno mismo', () => {
    const o = {}; M.directoPost({ _body: { id_usuario: uid.ana } }, null, ctxDe('ana', o));
    assert.strictEqual(o.code, 400);
});

t('enviar y leer dentro del directo; el no-miembro recibe 403', () => {
    const oc = {}; M.directoPost({ _body: { id_usuario: uid.beto } }, null, ctxDe('ana', oc));
    const canal = oc.d.id_canal;
    const oe = {}; M.enviarPost({ _body: { cuerpo: 'hola beto' } }, null, ctxDe('ana', oe), { params: [String(canal)] });
    assert(oe.d.ok);
    // caro NO es miembro → 403 al leer y al enviar
    const o403 = {}; M.mensajesGet(null, null, ctxDe('caro', o403), { params: [String(canal)] });
    assert.strictEqual(o403.code, 403);
    const o403b = {}; M.enviarPost({ _body: { cuerpo: 'colado' } }, null, ctxDe('caro', o403b), { params: [String(canal)] });
    assert.strictEqual(o403b.code, 403);
});

t('no-leídos: beto ve 1, y al abrir el canal baja a 0', () => {
    const on = {}; M.noLeidosGet(null, null, ctxDe('beto', on));
    assert.strictEqual(on.d.total, 1, 'el mensaje de ana cuenta como no leído para beto');
    // ana no se cuenta a sí misma
    const oa = {}; M.noLeidosGet(null, null, ctxDe('ana', oa));
    assert.strictEqual(oa.d.total, 0);
    // beto abre el canal → marca leído
    const oc = {}; M.directoPost({ _body: { id_usuario: uid.ana } }, null, ctxDe('beto', oc));
    const om = {}; M.mensajesGet(null, null, ctxDe('beto', om), { params: [String(oc.d.id_canal)] });
    assert(om.d.some(m => /hola beto/.test(m.cuerpo)) && om.d[0].mio === false);
    const on2 = {}; M.noLeidosGet(null, null, ctxDe('beto', on2));
    assert.strictEqual(on2.d.total, 0, 'tras abrir, ya no hay no-leídos');
});

t('grupo: se crea con varios miembros y todos pueden escribir/leer', () => {
    const og = {}; M.grupoPost({ _body: { nombre: 'Equipo', miembros: [uid.beto, uid.caro] } }, null, ctxDe('ana', og));
    assert(og.d.ok);
    const canal = og.d.id_canal;
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM canal_miembros WHERE id_canal=?').get(canal).n, 3, 'ana+beto+caro');
    M.enviarPost({ _body: { cuerpo: 'hola equipo' } }, null, ctxDe('caro', {}), { params: [String(canal)] });
    const om = {}; M.mensajesGet(null, null, ctxDe('beto', om), { params: [String(canal)] });
    assert(om.d.some(m => /hola equipo/.test(m.cuerpo)));
});

t('grupo sin integrantes reales → rechazado', () => {
    const o = {}; M.grupoPost({ _body: { nombre: 'Solo yo', miembros: [] } }, null, ctxDe('ana', o));
    assert.strictEqual(o.code, 400);
});

t('canales: ana ve su directo con beto y el grupo, con nombre resuelto', () => {
    const o = {}; M.canalesGet(null, null, ctxDe('ana', o));
    const tipos = o.d.map(c => c.tipo).sort();
    assert.deepStrictEqual(tipos, ['directo', 'grupo']);
    const directo = o.d.find(c => c.tipo === 'directo');
    assert.strictEqual(directo.nombre, 'BETO', 'el directo muestra el nombre del otro');
});

console.log('\n' + ok + '/7 OK — mensajería interna: directo dedupe + grupo + membresía + no-leídos.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
process.exit(ok === 7 ? 0 : 1);
