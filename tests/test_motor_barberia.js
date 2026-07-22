'use strict';
// tests/test_motor_barberia.js — paridad de un DELTA DE GIRO (Fase 4). Corre el
// recorrido de agendar cita de barbería DOS veces sobre el mismo fixture: con el
// motor APAGADO (código: menuFlow adaptativo + citasFlow vía giroFlows) y con el
// motor ENCENDIDO + barberia.json activo (nodos delegados). Deben ser byte a byte
// iguales → el delta de giro reproduce la barbería-en-código.
//   node --test tests/test_motor_barberia.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
// Reloj congelado: los días/horas de cita dependen de la fecha actual.
const _RealDate = Date;
const _FIXED = new _RealDate('2025-01-15T18:00:00-06:00').getTime();
global.Date = class extends _RealDate {
    constructor(...a) { if (a.length === 0) super(_FIXED); else super(...a); }
    static now() { return _FIXED; }
};

const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
// Giro barbería + citas encendidas (el fixture ya trae un servicio 'Corte de cabello').
for (const [k, v] of [['giro', 'barberia'], ['citas_activo', '1'], ['motor_flujo_activo', '0']])
    db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)').run(k, v);

const cfg = require('../bot/flows/_config');
const actionHandler = require('../bot/actionHandler');
const sm = require('../bot/sessionManager');
const stub = new Proxy({}, { get: () => (async () => {}) });

// Recorrido SIN mutación: agenda hasta la pantalla de confirmar (no confirma → no
// INSERT), para que las dos pasadas lean el mismo estado y sean deterministas.
const RECORRIDO = ['hola', '2', '1', '1', '1'];   // menú → agendar → servicio → día → hora
const USER = 'barber@c.us';

async function correr() {
    sm.clearSession(USER);
    const out = [];
    for (const input of RECORRIDO) {
        const s = sm.getSession(USER);
        let r; try { r = await actionHandler.handleAction(USER, s, { body: input, from: USER }, stub); }
        catch (e) { r = '__ERROR__ ' + e.message; }
        out.push(r == null ? null : String(r));
    }
    return out;
}

test('paridad barbería: código (motor OFF) === motor + delta barberia.json, turno a turno', async () => {
    cfg.invalidarCache();
    const codigo = await correr();               // motor OFF

    // Encender el motor + sembrar el delta de barbería.
    db.prepare("UPDATE configuracion SET valor='1' WHERE clave='motor_flujo_activo'").run();
    const seeder = require('../bot/flows/motor/seeder');
    const res = seeder.sembrar(db, seeder.cargarPlantilla('barberia'), { activar: true });
    assert.strictEqual(res.valido, 1, 'barberia.json no pasó el linter: ' + JSON.stringify(res.errs));
    cfg.invalidarCache();
    require('../bot/flows/motor/grafo').invalidar();
    const motor = await correr();                // motor ON

    for (let i = 0; i < RECORRIDO.length; i++) {
        assert.strictEqual(motor[i], codigo[i],
            'DIFF turno ' + i + ' [' + RECORRIDO[i] + ']\n   código: ' + JSON.stringify((codigo[i] || '').slice(0, 140)) +
            '\n   motor:  ' + JSON.stringify((motor[i] || '').slice(0, 140)));
    }
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
