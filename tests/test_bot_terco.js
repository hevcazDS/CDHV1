'use strict';
// tests/test_bot_terco.js — robustez del bot semiautónomo ante el cliente terco
// (hallazgo del estrés 2026-07-15, BUG-1): pedir un humano en texto libre desde
// el MENÚ escala a asesor en vez de interpretarse como búsqueda de producto.
// Además: datos basura no graban pedidos fantasma. Pipeline REAL, sin WhatsApp.
//   node --test tests/test_bot_terco.js

const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';
if (!process.env.ASESOR_WHATSAPP) process.env.ASESOR_WHATSAPP = '5214441234567';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const sm = require('../bot/sessionManager');
const { handleAction } = require('../bot/actionHandler');
const mockClient = { sendMessage: async (_, m) => m, getChats: async () => [] };

const msg = async (U, texto) => {
    const r = await handleAction(U, sm.getSession(U), { body: texto, hasMedia: false, type: 'chat', _fromIntent: false }, mockClient);
    return r || '';
};

test('pedir un humano en texto libre → escala (no busca producto)', async () => {
    const U = 'terco1@c.us'; sm.clearSession(U);
    await msg(U, 'hola');
    const r = await msg(U, 'quiero hablar con una persona');
    assert(!/resultados? (para|de)/i.test(r), 'no debe responder con búsqueda de producto: ' + r.slice(0, 80));
    assert.strictEqual(sm.getSession(U).paso_actual, 'ASESOR', 'debe quedar en ASESOR');
});

test('"no me entiendes" también escala', async () => {
    const U = 'terco2@c.us'; sm.clearSession(U);
    await msg(U, 'hola');
    await msg(U, 'no me entiendes');
    assert.strictEqual(sm.getSession(U).paso_actual, 'ASESOR');
});

test('texto raro nunca deja al bot mudo ni corrompe la sesión', async () => {
    const U = 'terco3@c.us'; sm.clearSession(U);
    await msg(U, 'hola');
    const PASOS_OK = new Set(['MENU','SEARCHING','VIEW_PRODUCT','ADD_MORE','LISTA_ESPERA','ASESOR','WIZARD_Q1','WIZARD_Q2','WIZARD_Q3','SUSTITUTO']);
    for (const basura of ['xqz ????', '😀😀😀', 'aaaaaaa', 'no se', '?????']) {
        const r = await msg(U, basura);
        assert(typeof r === 'string' && r.trim().length > 0, 'respuesta vacía ante: ' + basura);
        assert(!/^ERROR:/.test(r), 'error crudo ante: ' + basura);
        const paso = sm.getSession(U).paso_actual;
        assert(PASOS_OK.has(paso), 'paso inválido tras basura: ' + paso);
    }
});

test('datos basura no graban pedidos fantasma', async () => {
    const db = require('../bot/db_connection');
    const antes = db.prepare('SELECT COUNT(*) n FROM pedidos').get().n;
    const U = 'terco4@c.us'; sm.clearSession(U);
    await msg(U, 'hola');
    for (const m of ['comprar', 'no se', '-5', 'muchos', '00000', 'abc', 'ya dame']) await msg(U, m);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM pedidos').get().n, antes, 'apareció un pedido sin checkout real');
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
