'use strict';
// tests/golden_snapshot.js — GOLDEN SNAPSHOT del copy del bot de Julio Cepeda.
// Fase 0 del motor de flujo: captura las respuestas EXACTAS de JC ante recorridos
// scripteados, contra la DB del fixture (fixture_min.js). Es la condición de
// mérito de toda fase posterior: si un cambio altera un byte de una respuesta de
// JC sin querer, este runner REVIENTA.
//
// Uso:
//   node tests/golden_snapshot.js            # compara contra tests/golden/jc.json
//   node tests/golden_snapshot.js --update   # (re)genera el baseline
//
// Es un runner APARTE de test_bot.js (que usa el mock de sesiones). Este SÍ
// necesita productos/inventario reales → el fixture. No se mezclan.

const fs = require('fs');
const path = require('path');

// 0) Reloj congelado ANTES de cargar el bot: varias respuestas (asesor "fuera de
//    horario 🌙", saludos por hora) dependen de la hora actual → sin esto el
//    golden no sería reproducible. Fijo un miércoles 6pm (dentro del horario
//    11am–8pm) para que el copy de horario sea estable.
const _RealDate = Date;
const _FIXED = new _RealDate('2025-01-15T18:00:00-06:00').getTime();
global.Date = class extends _RealDate {
    constructor(...a) { if (a.length === 0) super(_FIXED); else super(...a); }
    static now() { return _FIXED; }
};

// 1) DB_PATH al fixture ANTES de cargar cualquier módulo del bot (db_connection
//    lo lee al require; dotenv.config() NO sobrescribe una var ya puesta).
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true'; // no se usa aquí

// 2) Cargar el router real (usa la DB del fixture vía db_connection singleton).
const actionHandler = require('../bot/actionHandler');
const sessionManager = require('../bot/sessionManager');

// Cliente stub: los flujos de texto no envían nada; los que sí (imagen/asesor)
// no deben tumbar el runner. Todo no-op async.
const stubClient = new Proxy({}, { get: () => (async () => {}) });

// Recorridos: cada uno resetea la sesión y alimenta inputs 1 a 1, capturando la
// respuesta devuelta por handleAction (lo que index.js enviaría al cliente).
// Cada recorrido camina transiciones REALES del router (no loops de reset).
// Ver secuencia: buscar(1)→texto→elegir nº→detalle→2(agregar y pagar)→CP→método.
const RECORRIDOS = {
    '1_menu':        ['hola'],                                  // saludo + menú de giro
    '2_buscar_ver':  ['hola', '1', 'lego', '1'],                // búsqueda → detalle de producto
    '3_pickup':      ['hola', '1', 'lego', '1', '2', '64000', '2'], // add+pagar → CP → sucursal
    '4_envio_dir':   ['hola', '1', 'lego', '1', '2', '64000', '1'], // → envío → captura de dirección
    '5_wizard':      ['hola', '2', '2', '1', '3'],              // wizard de regalo completo
    '6_sin_stock':   ['hola', '1', 'balón', '1'],               // producto 0 stock → rama espera
    '7_asesor':      ['hola', '4'],                             // escalada a asesor humano
    '8_referidos':   ['hola', '5'],                             // código de referido
};

const USER = 'golden@c.us';

async function correrRecorrido(inputs) {
    sessionManager.clearSession(USER);
    const turnos = [];
    for (const input of inputs) {
        const session = sessionManager.getSession(USER);
        let resp;
        try {
            resp = await actionHandler.handleAction(USER, session, { body: input, from: USER }, stubClient);
        } catch (e) {
            resp = '__ERROR__ ' + e.message;
        }
        turnos.push({ in: input, out: resp == null ? null : String(resp) });
    }
    return turnos;
}

async function main() {
    const update = process.argv.includes('--update');
    const goldenPath = path.join(__dirname, 'golden', 'jc.json');
    const snapshot = {};
    for (const [nombre, inputs] of Object.entries(RECORRIDOS)) {
        snapshot[nombre] = await correrRecorrido(inputs);
    }

    if (update || !fs.existsSync(goldenPath)) {
        fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
        fs.writeFileSync(goldenPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
        console.log((fs.existsSync(goldenPath) ? '📸 Baseline (re)generado' : '📸 Baseline creado') + ': tests/golden/jc.json');
        console.log('   Recorridos:', Object.keys(snapshot).join(', '));
        // limpiar el fixture temporal
        try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
        return;
    }

    // Comparar byte a byte contra el baseline.
    const base = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    let fallos = 0;
    for (const nombre of Object.keys(snapshot)) {
        const a = JSON.stringify(base[nombre]);
        const b = JSON.stringify(snapshot[nombre]);
        if (a !== b) {
            fallos++;
            console.error('❌ DIFF en recorrido "' + nombre + '":');
            const ta = base[nombre] || [], tb = snapshot[nombre] || [];
            for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
                const ea = JSON.stringify(ta[i]), eb = JSON.stringify(tb[i]);
                if (ea !== eb) { console.error('   turno ' + i + ' input=' + (tb[i]?.in ?? ta[i]?.in)); console.error('     baseline: ' + ea); console.error('     ahora:    ' + eb); }
            }
        } else {
            console.log('✅ ' + nombre);
        }
    }
    try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
    if (fallos) { console.error('\n' + fallos + ' recorrido(s) cambiaron respecto al golden. Si el cambio es intencional: --update.'); process.exit(1); }
    console.log('\nGOLDEN OK — el copy de Julio Cepeda es byte-idéntico al baseline.');
}

main().catch(e => { console.error('FATAL', e.stack || e.message); process.exit(1); });
