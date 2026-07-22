'use strict';
// tests/test_motor_render.js — valida el mecanismo render-hook de Fase 3: un nodo
// de conversación con `render` reproduce un prompt DINÁMICO byte-idéntico llamando
// al código de render existente (aquí render_menu → menuPrincipal). También prueba
// el seeder + linter. NO afirma paridad del flujo completo (eso es el harness de
// autoría incremental); prueba que el mecanismo es correcto.
//   node --test tests/test_motor_render.js

const assert = require('assert');
const { test, after } = require('node:test');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const seeder = require('../bot/flows/motor/seeder');
const G = require('../bot/flows/motor/grafo');
const interprete = require('../bot/flows/motor/interprete');
const shared = require('../bot/flows/_shared');
const sm = require('../bot/sessionManager');

// Plantilla mínima: HOME (conversacion, render_menu) --1--> HOME (se queda).
// El punto es que el render del nodo salga IDÉNTICO a menuPrincipal(tel).
const plantilla = {
    giro_base: 'jugueteria',
    nodos: [
        { paso: 'HOME', tipo: 'conversacion', render: 'render_menu', es_inicial: 1,
          aristas: [{ input: '1', destino: 'HOME' }, { input: '*', destino: 'HOME' }] },
    ],
};

test('seeder: siembra + linter válido + activa', () => {
    const res = seeder.sembrar(db, plantilla, { activar: true });
    assert.strictEqual(res.valido, 1, 'linter debió aprobar: ' + JSON.stringify(res.errs));
    const g = G.cargarGrafoActivo();
    assert(g && g.nodos.HOME.render === 'render_menu');
});

test('render-hook: el nodo con render sale byte-idéntico a menuPrincipal', async () => {
    const U = 'render@c.us';
    sm.clearSession(U);
    // arrancar en HOME y mandar '1' → el motor renderiza el nodo destino (HOME)
    sm.updateSession(U, 'HOME', {});
    const salida = await interprete.handle({ userId: U, step: 'HOME', action: '1', raw: '1', data: {}, tel: '5218110000000' });
    const esperado = shared.menuPrincipal('5218110000000');
    assert.strictEqual(salida, esperado, 'el render del motor debe igualar menuPrincipal byte a byte');
});

test('STEPS expone el nodo de conversación del grafo activo', () => {
    assert(interprete.STEPS.includes('HOME'));
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
