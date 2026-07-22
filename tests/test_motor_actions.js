'use strict';
// tests/test_motor_actions.js — contract test de bot/flows/motor/actions.js (Fase 1).
// Verifica que cada acción envuelve su función de _shared.js con el contrato
// { resultado, data } esperado por el intérprete (Fase 2). Corre contra el fixture.
//   node --test tests/test_motor_actions.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const { ACTIONS } = require('../bot/flows/motor/actions');

const ctx = (over = {}) => ({ userId: 'test@c.us', tel: '5218110000000', raw: '', data: {}, ...over });

test('buscar_producto: match → resultado "hay" + resultados[]', () => {
    const r = ACTIONS.buscar_producto(ctx({ raw: 'lego' }));
    assert.strictEqual(r.resultado, 'hay');
    assert(Array.isArray(r.data.resultados) && r.data.resultados.length > 0);
    assert(/lego/i.test(r.data.resultados[0].name));
});

test('agregar_carrito: producto en curso → resultado "ok" + carrito con 1 renglón', () => {
    const r = ACTIONS.agregar_carrito(ctx({ data: { viewing: { id: 1, name: 'Lego', price: 599 } } }));
    assert.strictEqual(r.resultado, 'ok');
    assert.strictEqual(r.data.carrito.length, 1);
    assert.strictEqual(r.data.carrito[0].cantidad, 1);
});

test('aplicar_cupon: código inexistente → resultado "no"', () => {
    const r = ACTIONS.aplicar_cupon(ctx({ raw: 'NOEXISTE123', data: { carrito: [{ id: 1, price: 100, cantidad: 1 }] } }));
    assert.strictEqual(r.resultado, 'no');
});

test('cargar_dias_cita: contrato { resultado, data.cita_dias[] }', () => {
    const r = ACTIONS.cargar_dias_cita(ctx());
    assert(['hay', 'vacio'].includes(r.resultado));
    assert(Array.isArray(r.data.cita_dias));
});

test('acciones SELLADAS registradas como funciones (sin invocarlas)', () => {
    for (const n of ['grabar_pedido_pickup', 'grabar_pedido_envio', 'grabar_pedido_split', 'escalar']) {
        assert.strictEqual(typeof ACTIONS[n], 'function', 'falta acción sellada: ' + n);
    }
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
