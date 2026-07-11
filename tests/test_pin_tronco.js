'use strict';
// Contrato del cable pin:true del tronco (_construirModulo): una ruta sensible
// debe (a) exigir PIN a un especialista, (b) dejarlo pasar a gerente+ sin PIN,
// (c) al pasar, correr el handler con el body ya parseado y dejar bitácora.
// Sin framework: better-sqlite3 en memoria + asserts. `node tests/test_pin_tronco.js`.
const assert = require('assert');
const Database = require('better-sqlite3');
const construirModulo = require('../dashboard/routes/_construirModulo');
const autorizacion = require('../dashboard/autorizacion');
const permisos = require('../dashboard/permisos');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT, actualizado_en TEXT);
  CREATE TABLE configuracion_log (id INTEGER PRIMARY KEY AUTOINCREMENT, clave TEXT, valor_anterior TEXT, valor_nuevo TEXT, usuario TEXT, creado_en TEXT DEFAULT (datetime('now','localtime')));
`);
autorizacion.setPin(db, '4321'); // PIN de la instancia

// ── ctx/req/res mínimos ─────────────────────────────────────────────────────
let sesionActual = null;              // la fija cada caso
const respuestas = [];                // json() capturado
const ctx = {
    db, permisos, autorizacion,
    permite: permisos.permite,
    json: (res, obj, status = 200) => { respuestas.push({ obj, status }); return res; },
    readBody: (req, cb) => cb(req._body),
    requireSession: () => sesionActual, // el auth real vive en server.js; aquí lo inyectamos
};
let corrioHandler = null;
const handler = (req, res, _ctx, extra) => { corrioHandler = extra; return res; };

const mod = construirModulo(
    [{ metodo: 'POST', path: '/api/activos/baja', area: 'finanzas', pin: true, handler }],
    { prefijo: '/api/activos/' }
);
const llamar = (sesion, bodyObj) => {
    sesionActual = sesion; corrioHandler = null; respuestas.length = 0;
    mod({ method: 'POST', _body: JSON.stringify(bodyObj) }, {}, '/api/activos/baja', null, ctx, () => 'NEXT');
    return respuestas[respuestas.length - 1];
};

// ── Casos ───────────────────────────────────────────────────────────────────
// 1) Especialista (contabilidad → área finanzas, rango 1) SIN pin → 403.
let r = llamar({ rol: 'contabilidad', username: 'ana' }, { id: 7 });
assert.strictEqual(r.status, 403, 'especialista sin PIN debe dar 403');
assert.strictEqual(r.obj.pin_requerido, true, 'debe marcar pin_requerido');
assert.strictEqual(corrioHandler, null, 'el handler NO debe correr sin PIN');

// 2) Especialista con PIN incorrecto → 403.
r = llamar({ rol: 'contabilidad', username: 'ana' }, { id: 7, pin: '0000' });
assert.strictEqual(r.status, 403, 'PIN incorrecto debe dar 403');
assert.strictEqual(corrioHandler, null, 'handler NO corre con PIN malo');

// 3) Especialista con PIN correcto → handler corre con body parseado + bitácora.
const antes = db.prepare("SELECT COUNT(*) n FROM configuracion_log WHERE clave='autorizacion:POST /api/activos/baja'").get().n;
r = llamar({ rol: 'contabilidad', username: 'ana' }, { id: 7, pin: '4321' });
assert.ok(corrioHandler, 'handler debe correr con PIN correcto');
assert.strictEqual(corrioHandler.body.id, 7, 'el handler recibe el body ya parseado');
assert.strictEqual(corrioHandler.ses.username, 'ana', 'el handler recibe la sesión');
const despues = db.prepare("SELECT COUNT(*) n FROM configuracion_log WHERE clave='autorizacion:POST /api/activos/baja'").get().n;
assert.strictEqual(despues, antes + 1, 'debe dejar exactamente una fila de bitácora');
assert.strictEqual(db.prepare('SELECT valor_nuevo FROM configuracion_log ORDER BY id DESC LIMIT 1').get().valor_nuevo, 'ok', 'la bitácora NO guarda el body/PIN');

// 4) gerente (rango 2) SIN pin → pasa (administrador+ no teclea PIN).
r = llamar({ rol: 'gerente', username: 'jefe' }, { id: 9 });
assert.ok(corrioHandler, 'gerente pasa sin PIN');
assert.strictEqual(corrioHandler.body.id, 9);

// 5) Sin sesión (área no permitida) → 403 Sin permiso, nunca llega al PIN.
r = llamar({ rol: 'cajero', username: 'caja' }, { id: 1, pin: '4321' });
assert.strictEqual(r.status, 403, 'cajero no tiene finanzas → 403 antes del PIN');
assert.strictEqual(corrioHandler, null);

console.log('✓ test_pin_tronco: 5/5 — pin:true exige PIN, audita y respeta el gate de área');
