'use strict';
// tests/test_cotizacion_persist.js — persistencia y consulta de la cotización del
// bot (cierra el pendiente "consultar estado de cotización"). Pinnea: la acción
// cotizar guarda; el cliente la consulta ("mi cotización"); vence a los 7 días; se
// marca 'convertida' al pagar; sigue siendo SOLO informativa (no crea pedidos).
//   node tests/test_cotizacion_persist.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const conf = require('../bot/flows/_config');
const cotBot = require('../services/cotizacionBot');
db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('cotizacion_activo','1')").run();
conf.invalidarCache();

let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };
const TEL = '5215550900';

t('la acción cotizar PERSISTE la cotización y devuelve folio', () => {
    const { ACTIONS } = require('../bot/flows/motor/actions');
    db.prepare("INSERT INTO clientes (nombre, telefono, activo) VALUES ('Cli',?,1)").run(TEL);
    const pedidosAntes = db.prepare('SELECT COUNT(*) n FROM pedidos').get().n;
    const r = ACTIONS.cotizar({ tel: TEL, data: { carrito: [{ id: 1, name: 'Peluche', price: 200, cantidad: 2 }] } });
    assert.strictEqual(r.resultado, 'ok');
    assert(/^COT-\d{5}$/.test(r.data.cotizacion_folio), 'folio: ' + r.data.cotizacion_folio);
    const fila = db.prepare('SELECT * FROM cotizaciones_bot WHERE telefono=?').get(TEL);
    assert(fila && fila.total === 499 && fila.n_items === 2 && fila.estatus === 'vigente');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM pedidos').get().n, pedidosAntes, 'cotizar NO crea pedidos');
});

t('esConsulta detecta "mi cotización" y variantes', () => {
    assert(cotBot.esConsulta('cómo va mi cotización'));
    assert(cotBot.esConsulta('mi cotizacion'));
    assert(cotBot.esConsulta('estado de mi cotización'));
    assert(!cotBot.esConsulta('quiero un peluche'));
});

t('ultimaVigente + mensaje: el cliente consulta su cotización', () => {
    const cot = cotBot.ultimaVigente(db, TEL);
    assert(cot && cot.total === 499);
    const msg = cotBot.mensaje(cot);
    assert(/COT-\d{5}/.test(msg) && /499\.00/.test(msg) && /vigente/i.test(msg));
});

t('sin cotización → mensaje claro (no revienta)', () => {
    const msg = cotBot.mensaje(cotBot.ultimaVigente(db, '5219999999999'));
    assert(/no tengo una cotizaci/i.test(msg));
});

t('vencimiento: una cotización pasada de fecha deja de estar vigente', () => {
    const tel2 = '5215550901';
    db.prepare("INSERT INTO cotizaciones_bot (telefono, subtotal, envio, total, n_items, vence_en) VALUES (?,100,0,100,1, datetime('now','localtime','-1 day'))").run(tel2);
    assert.strictEqual(cotBot.ultimaVigente(db, tel2), null, 'una vencida no se devuelve');
    assert.strictEqual(db.prepare("SELECT estatus FROM cotizaciones_bot WHERE telefono=?").get(tel2).estatus, 'vencida');
});

t('marcarConvertida: al pagar, la cotización vigente pasa a convertida', () => {
    assert(cotBot.marcarConvertida(db, TEL));
    assert.strictEqual(db.prepare("SELECT estatus FROM cotizaciones_bot WHERE telefono=? ORDER BY id DESC LIMIT 1").get(TEL).estatus, 'convertida');
    // ya no hay vigente que consultar
    assert.strictEqual(cotBot.ultimaVigente(db, TEL), null);
});

t('gating: cotizacion_activo OFF → la acción no persiste', () => {
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('cotizacion_activo','0')").run();
    conf.invalidarCache();
    const { ACTIONS } = require('../bot/flows/motor/actions');
    const tel3 = '5215550902';
    const antes = db.prepare('SELECT COUNT(*) n FROM cotizaciones_bot WHERE telefono=?').get(tel3).n;
    const r = ACTIONS.cotizar({ tel: tel3, data: { carrito: [{ id: 1, price: 100, cantidad: 1 }] } });
    assert.strictEqual(r.resultado, 'inactivo');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM cotizaciones_bot WHERE telefono=?').get(tel3).n, antes);
});

console.log('\n' + ok + '/7 OK — cotización persistida + consultable + vence + convertida (solo informativa).');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
process.exit(ok === 7 ? 0 : 1);
