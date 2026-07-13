'use strict';
// tests/test_motor_interprete.js — tests del intérprete del motor (Fase 2, §C/§D).
// Cubre matchInput, resolverDestino, el linter, la carga de grafo, STEPS dinámico,
// una transición conversacional real, el escape a ASESOR por reintentos y el
// fail-closed sin grafo activo. Siembra un grafo mínimo en el fixture.
//   node tests/test_motor_interprete.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const G = require('../bot/flows/motor/grafo');
const linter = require('../bot/flows/motor/linter');
const interprete = require('../bot/flows/motor/interprete');
const sm = require('../bot/sessionManager');

let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

// ── unidades puras ──────────────────────────────────────────────────────────
t('matchInput: dígito, kw, regex, comodín, resultado', () => {
    const m = interprete.matchInput;
    assert.strictEqual(m('1', '1', '1'), true);
    assert.strictEqual(m('1', '2', '2'), false);
    assert.strictEqual(m('kw:asesor', 'quiero asesor', 'x'), true);
    assert.strictEqual(m('regex:^\\d{5}$', '', '64000'), true);
    assert.strictEqual(m('*', 'loquesea', 'x'), true);
    assert.strictEqual(m('resultado:hay', 'hay', 'hay'), false); // no se matchea contra input
});

t('resolverDestino: ramifica por resultado, si no usa la arista de entrada', () => {
    const aristas = [
        { input: '*', destino: 'BUSCANDO' },
        { input: 'resultado:hay', destino: 'VER' },
        { input: 'resultado:vacio', destino: 'ESPERA' },
    ];
    assert.strictEqual(interprete.resolverDestino(aristas, aristas[0], 'hay'), 'VER');
    assert.strictEqual(interprete.resolverDestino(aristas, aristas[0], 'vacio'), 'ESPERA');
    assert.strictEqual(interprete.resolverDestino(aristas, aristas[0], 'ok'), 'BUSCANDO');
});

t('linter: acepta grafo válido, rechaza colgante/huérfano/anticipo-sin-%', () => {
    const bueno = {
        inicial: 'MENU',
        nodos: { MENU: { paso: 'MENU', tipo: 'conversacion' }, FIN: { paso: 'FIN', tipo: 'conversacion' } },
        aristas: { MENU: [{ input: '1', destino: 'FIN' }] },
    };
    assert.strictEqual(linter.validar(bueno).ok, true);

    const colgante = { inicial: 'MENU', nodos: { MENU: { paso: 'MENU' } }, aristas: { MENU: [{ input: '1', destino: 'NOEXISTE' }] } };
    assert.strictEqual(linter.validar(colgante).ok, false);

    const huerfano = { inicial: 'MENU', nodos: { MENU: { paso: 'MENU' }, ISLA: { paso: 'ISLA' } }, aristas: {} };
    assert(linter.validar(huerfano).errs.some(e => /huérfano/.test(e)));

    const gratis = { inicial: 'MENU', nodos: { MENU: { paso: 'MENU' }, C: { paso: 'C' } },
        aristas: { MENU: [{ input: '1', destino: 'C', accion: 'cobrar_anticipo', params: {} }] } };
    assert(linter.validar(gratis).errs.some(e => /anticipo sin porcentaje/.test(e)));
});

// ── sin grafo activo: fail-closed ────────────────────────────────────────────
t('sin grafo: cargarGrafoActivo=null, STEPS=[], handle=undefined', async () => {
    G.invalidar();
    assert.strictEqual(G.cargarGrafoActivo(), null);
    assert.deepStrictEqual(interprete.STEPS, []);
    const r = await interprete.handle({ userId: 'u@c.us', step: 'MENU', action: '1', raw: '1', data: {}, tel: '5218110000000' });
    assert.strictEqual(r, undefined);
});

// ── con grafo sembrado ───────────────────────────────────────────────────────
function sembrarGrafo() {
    const gid = db.prepare("INSERT INTO flujo_grafo (version, giro_base, activo, valido) VALUES (1,'jugueteria',1,1)").run().lastInsertRowid;
    const nodo = db.prepare('INSERT INTO flujo_nodo (id_grafo, paso, tipo, frase_clave, es_inicial) VALUES (?,?,?,?,?)');
    nodo.run(gid, 'MENU', 'conversacion', 'menu_opciones', 1);
    nodo.run(gid, 'BUSCA', 'conversacion', 'menu_opciones', 0);
    nodo.run(gid, 'NUM', 'conversacion', 'menu_opciones', 0);
    nodo.run(gid, 'CONFIRM_ORDER', 'sistema', 'menu_opciones', 0);
    const ari = db.prepare('INSERT INTO flujo_arista (id_grafo, paso, orden, input, destino) VALUES (?,?,?,?,?)');
    ari.run(gid, 'MENU', 1, '1', 'BUSCA');
    ari.run(gid, 'MENU', 2, '2', 'NUM');
    ari.run(gid, 'MENU', 3, '*', 'MENU');
    ari.run(gid, 'NUM', 1, '1', 'MENU');   // NUM solo acepta '1' → probar reintentos
    G.invalidar();
    return gid;
}

t('grafo sembrado: carga + forma correcta', () => {
    sembrarGrafo();
    const g = G.cargarGrafoActivo();
    assert(g && g.inicial === 'MENU');
    assert.strictEqual(g.nodos.CONFIRM_ORDER.tipo, 'sistema');
    assert.strictEqual(g.aristas.MENU.length, 3);
});

t('STEPS: solo pasos conversacion (excluye sistema)', () => {
    const steps = interprete.STEPS;
    assert(steps.includes('MENU') && steps.includes('BUSCA') && steps.includes('NUM'));
    assert(!steps.includes('CONFIRM_ORDER'));
});

t('handle: transición conversacional avanza el estado y renderiza', async () => {
    const U = 'flujo@c.us';
    sm.clearSession(U);
    const r = await interprete.handle({ userId: U, step: 'MENU', action: '1', raw: '1', data: {}, tel: '5218110000000' });
    assert(typeof r === 'string' && r.length > 0);
    assert.strictEqual(sm.getSession(U).paso_actual, 'BUSCA');
});

t('reintentos: 3 inputs inválidos → escape a ASESOR', async () => {
    const U = 'reint@c.us';
    sm.clearSession(U);
    let data = {};
    for (let i = 1; i <= 2; i++) {
        await interprete.handle({ userId: U, step: 'NUM', action: '99', raw: '99', data, tel: '5218110000000' });
        data = sm.getSession(U).data;
        assert.strictEqual(sm.getSession(U).paso_actual, 'NUM');   // sigue en NUM
    }
    await interprete.handle({ userId: U, step: 'NUM', action: '99', raw: '99', data, tel: '5218110000000' });
    assert.strictEqual(sm.getSession(U).paso_actual, 'ASESOR');    // 3er fallo → sellado
});

t('handle: paso ajeno al grafo → undefined (router viejo)', async () => {
    const r = await interprete.handle({ userId: 'x@c.us', step: 'PASO_INEXISTENTE', action: '1', raw: '1', data: {}, tel: '5218110000000' });
    assert.strictEqual(r, undefined);
});

console.log('\n' + ok + '/9 OK — intérprete del motor conforme a §C/§D.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
