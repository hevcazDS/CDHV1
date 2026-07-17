'use strict';
// tests/test_motor_cotiza_eta.js — módulos de APOYO del bot en el lienzo:
//   cotizar (subtotal+envío+total del carrito) y tiempo_entrega (ETA de envío).
// Pinnea: (1) cálculo correcto y regla "gratis solo en flete"; (2) gating por
// módulo (OFF → 'inactivo'); (3) solo LECTURA (no graba pedidos); (4) el diálogo
// respeta los 4 tonos y llena los slots (para que el cambio de modo de hablar no
// rompa la gestión). Corre las acciones reales del registro del motor.
//   node tests/test_motor_cotiza_eta.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const { ACTIONS, CATALOGO } = require('../bot/flows/motor/actions');
const conf = require('../bot/flows/_config');
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

const setFlag = (clave, on) => {
    db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?,?)').run(clave, on ? '1' : '0');
    conf.invalidarCache();
};
const carrito = [{ id: 1, name: 'Peluche', price: 200, cantidad: 2 }];   // subtotal 400 < 699 → flete 99

t('cotizar OFF → inactivo (gating por módulo, no calcula)', () => {
    setFlag('cotizacion_activo', false);
    const r = ACTIONS.cotizar({ data: { carrito } });
    assert.strictEqual(r.resultado, 'inactivo');
    assert.deepStrictEqual(r.data, {});
});

t('cotizar ON → subtotal+envío+total correctos; envío con costo', () => {
    setFlag('cotizacion_activo', true);
    const r = ACTIONS.cotizar({ data: { carrito } });
    assert.strictEqual(r.resultado, 'ok');
    assert.strictEqual(r.data.cotizacion_subtotal, '400.00');
    assert.strictEqual(r.data.cotizacion_envio, '$99.00');
    assert.strictEqual(r.data.cotizacion_total, '499.00');
    assert.strictEqual(r.data.cotizacion_n, 2);
});

t('cotizar: sobre el umbral el flete es "gratis" (regla: gratis solo en flete)', () => {
    const r = ACTIONS.cotizar({ data: { carrito: [{ id: 1, name: 'Bici', price: 800, cantidad: 1 }] } });
    assert.strictEqual(r.data.cotizacion_envio, 'gratis');
    assert.strictEqual(r.data.cotizacion_total, '800.00');   // total nunca dice "gratis"
});

t('cotizar: carrito vacío → vacio', () => {
    assert.strictEqual(ACTIONS.cotizar({ data: { carrito: [] } }).resultado, 'vacio');
    assert.strictEqual(ACTIONS.cotizar({ data: {} }).resultado, 'vacio');
});

t('cotizar es SOLO LECTURA: no graba pedidos', () => {
    const antes = db.prepare('SELECT COUNT(*) n FROM pedidos').get().n;
    ACTIONS.cotizar({ data: { carrito } });
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM pedidos').get().n, antes);
});

t('tiempo_entrega OFF → inactivo; ON → devuelve eta_fecha humana', () => {
    setFlag('tiempo_entrega_activo', false);
    assert.strictEqual(ACTIONS.tiempo_entrega({ data: {} }).resultado, 'inactivo');
    setFlag('tiempo_entrega_activo', true);
    const r = ACTIONS.tiempo_entrega({ data: {} });
    assert.strictEqual(r.resultado, 'ok');
    assert(typeof r.data.eta_fecha === 'string' && /de /.test(r.data.eta_fecha), 'fecha humana: ' + r.data.eta_fecha);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(r.data.eta_fecha_iso));
});

t('catálogo del editor expone ambas como NO selladas con sus salidas', () => {
    assert(CATALOGO.cotizar && !CATALOGO.cotizar.sellada);
    assert(CATALOGO.cotizar.salidas.includes('vacio') && CATALOGO.cotizar.salidas.includes('inactivo'));
    assert(CATALOGO.tiempo_entrega && !CATALOGO.tiempo_entrega.sellada);
});

t('DIÁLOGO: los 4 tonos renderizan no-vacío y llenan los slots', () => {
    const slots = { cotizacion_subtotal: '400.00', cotizacion_envio: '$99.00', cotizacion_total: '499.00' };
    for (const tono of ['A', 'B', 'C', 'D']) {
        setFlag('tono_bot', tono);
        const cot = conf.t('cotizacion_resumen', slots);
        assert(cot && cot.length > 0, 'cotizacion_resumen vacía en tono ' + tono);
        assert(cot.includes('499.00') && cot.includes('400.00'), 'slot sin interpolar en tono ' + tono + ': ' + cot);
        assert(!cot.includes('{cotizacion'), 'quedó un slot crudo en tono ' + tono);
        const eta = conf.t('eta_envio', { eta_fecha: 'miércoles 19 de julio' });
        assert(eta.includes('miércoles 19 de julio'), 'eta sin interpolar en tono ' + tono);
    }
});

t('DIÁLOGO editable: frase_<clave> override gana sobre el tono', () => {
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('frase_cotizacion_resumen', 'Total a pagar: ${cotizacion_total} 👍')").run();
    conf.invalidarCache();
    for (const tono of ['A', 'C']) {
        setFlag('tono_bot', tono);
        const cot = conf.t('cotizacion_resumen', { cotizacion_total: '499.00' });
        assert.strictEqual(cot, 'Total a pagar: $499.00 👍', 'el override debe ganar en tono ' + tono);
    }
    db.prepare("DELETE FROM configuracion WHERE clave='frase_cotizacion_resumen'").run();
    conf.invalidarCache();
});

console.log('\n' + ok + '/9 OK — módulos cotizar/tiempo_entrega: cálculo + gating + 4 tonos + editable.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
process.exit(ok === 9 ? 0 : 1);
