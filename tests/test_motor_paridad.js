'use strict';
// tests/test_motor_paridad.js — HARNESS DE PARIDAD (Fase 3, F.4). Con el motor
// ENCENDIDO y jugueteria.json activo, los MISMOS recorridos del golden deben dar
// byte por byte lo mismo que tests/golden/jc.json (que se capturó con el motor
// APAGADO). Si difiere un byte, revienta. Es la condición de mérito de que la
// plantilla base reproduce a Julio Cepeda.
//   node --test tests/test_motor_paridad.js

const assert = require('assert');
const { test, after } = require('node:test');
const fs = require('fs');
const path = require('path');

// Reloj congelado idéntico al golden (asesor "fuera de horario" depende de la hora).
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
// Encender el motor + sembrar la plantilla base ANTES de cargar el router.
db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('motor_flujo_activo','1')").run();
const seeder = require('../bot/flows/motor/seeder');
const plantilla = seeder.cargarPlantilla('jugueteria');
const res = seeder.sembrar(db, plantilla, { activar: true });
if (!res.valido) { console.error('❌ jugueteria.json no pasó el linter:', res.errs); process.exit(1); }

// Invalidar la caché de módulos para que moduloActivo lea el flag recién puesto.
try { require('../bot/flows/_config').invalidarCache(); } catch (_) {}

const actionHandler = require('../bot/actionHandler');
const sm = require('../bot/sessionManager');
const stub = new Proxy({}, { get: () => (async () => {}) });

const RECORRIDOS = {
    '1_menu':        ['hola'],
    '2_buscar_ver':  ['hola', '1', 'lego', '1'],
    '3_pickup':      ['hola', '1', 'lego', '1', '2', '64000', '2'],
    '4_envio_dir':   ['hola', '1', 'lego', '1', '2', '64000', '1'],
    '5_wizard':      ['hola', '2', '2', '1', '3'],
    '6_sin_stock':   ['hola', '1', 'balón', '1'],
    '7_asesor':      ['hola', '4'],
    '8_referidos':   ['hola', '5'],
};
const USER = 'golden@c.us';

async function correr(inputs) {
    sm.clearSession(USER);
    const turnos = [];
    for (const input of inputs) {
        const session = sm.getSession(USER);
        let resp;
        try { resp = await actionHandler.handleAction(USER, session, { body: input, from: USER }, stub); }
        catch (e) { resp = '__ERROR__ ' + e.message; }
        turnos.push({ in: input, out: resp == null ? null : String(resp) });
    }
    return turnos;
}

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden', 'jc.json'), 'utf8'));

for (const [nombre, inputs] of Object.entries(RECORRIDOS)) {
    test('paridad: ' + nombre, async () => {
        const ahora = await correr(inputs);
        const a = JSON.stringify(golden[nombre]);
        const b = JSON.stringify(ahora);
        if (a !== b) {
            const ga = golden[nombre] || [];
            const detalles = [];
            for (let i = 0; i < Math.max(ga.length, ahora.length); i++) {
                if (JSON.stringify(ga[i]) !== JSON.stringify(ahora[i])) {
                    detalles.push('turno ' + i + ' input=' + (ahora[i]?.in ?? ga[i]?.in) +
                        ' | golden: ' + JSON.stringify(ga[i]?.out || '').slice(0, 160) +
                        ' | motor:  ' + JSON.stringify(ahora[i]?.out || '').slice(0, 160));
                }
            }
            assert.fail('DIFF (motor ON) en "' + nombre + '":\n' + detalles.join('\n'));
        }
    });
}

after(() => {
    try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
