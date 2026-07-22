'use strict';
// tests/test_mesa.js — F6: flujo de consumo en mesa por WhatsApp (giro restaurante,
// módulo mesas_activo). Abre/retoma mesa, agrega platillos a mesa_items, pide la
// cuenta. Reusa las tablas mesas/mesa_items (el mesero cobra desde el POS).
//   node --test tests/test_mesa.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
for (const [k, v] of [['giro', 'restaurante'], ['mesas_activo', '1']])
    db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)').run(k, v);
require('../bot/flows/_config').invalidarCache();

const mesa = require('../bot/flows/mesaFlow');
const sm = require('../bot/sessionManager');
const { S } = require('../bot/flows/_shared');
const USER = 'comensal@c.us';

test('iniciar: pregunta el número de mesa y deja MESA_ABRIR', () => {
    const r = mesa.iniciar(USER, {});
    assert(/n[uú]mero de mesa/i.test(r));
    assert.strictEqual(sm.getSession(USER).paso_actual, S.MESA_ABRIR);
});

test('MESA_ABRIR: abre la mesa y muestra el menú → MESA_CONSUMO', async () => {
    const s = sm.getSession(USER);
    const r = await mesa.handle({ userId: USER, step: S.MESA_ABRIR, raw: '5', action: '5', data: s.data, tel: '5218110000000' });
    assert(/Mesa 5/.test(r) && /platillo/i.test(r));
    assert.strictEqual(sm.getSession(USER).paso_actual, S.MESA_CONSUMO);
    const m = db.prepare("SELECT * FROM mesas WHERE numero='5' AND estatus='abierta'").get();
    assert(m, 'debe existir la mesa abierta');
});

test('MESA_CONSUMO: agrega un platillo a mesa_items', async () => {
    const s = sm.getSession(USER);
    const r = await mesa.handle({ userId: USER, step: S.MESA_CONSUMO, raw: '1', action: '1', data: s.data, tel: '5218110000000' });
    assert(/agregado/i.test(r) && /Total actual/i.test(r));
    const n = db.prepare('SELECT COUNT(*) n FROM mesa_items WHERE id_mesa=?').get(s.data.mesa_id).n;
    assert.strictEqual(n, 1);
});

test('MESA_CONSUMO: "cuenta" cierra el consumo, marca cocina y vuelve a MENU', async () => {
    const s = sm.getSession(USER);
    const r = await mesa.handle({ userId: USER, step: S.MESA_CONSUMO, raw: 'cuenta', action: 'cuenta', data: s.data, tel: '5218110000000' });
    assert(/Cuenta de la mesa 5/i.test(r));
    assert.strictEqual(sm.getSession(USER).paso_actual, S.MENU);
    const enviados = db.prepare('SELECT COUNT(*) n FROM mesa_items WHERE id_mesa=? AND enviado_cocina=1').get(s.data.mesa_id).n;
    assert.strictEqual(enviados, 1, 'los items deben marcarse enviados a cocina');
});

test('retomar mesa: mismo número reusa la mesa abierta (no crea otra)', async () => {
    sm.clearSession(USER);
    mesa.iniciar(USER, {});
    await mesa.handle({ userId: USER, step: S.MESA_ABRIR, raw: '5', action: '5', data: {}, tel: '5218110000000' });
    const abiertas = db.prepare("SELECT COUNT(*) n FROM mesas WHERE numero='5' AND estatus='abierta'").get().n;
    assert.strictEqual(abiertas, 1, 'no debe duplicar la mesa 5');
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
