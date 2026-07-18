'use strict';
// tests/test_crm_pipeline_bot.js — P0: el BOT alimenta el pipeline CRM en vivo
// (services/crmBot.js + cableado). Pinnea: avance de etapa idempotente y sin
// retroceso, no degrada 'ganado', 'perdido' solo explícito, gating por módulo,
// nota + score, y la integración real (primer mensaje → contactado; cotizar →
// cotizado). Solo DATOS: nunca mensajes ni pedidos.
//   node tests/test_crm_pipeline_bot.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';
if (!process.env.ASESOR_WHATSAPP) process.env.ASESOR_WHATSAPP = '5214441234567';

const db = require('../bot/db_connection');
const crmBot = require('../services/crmBot');
const conf = require('../bot/flows/_config');
let ok = 0;
const t = (n, fn) => { const r = fn(); if (r && r.then) return r.then(() => { ok++; console.log('✅ ' + n); }); ok++; console.log('✅ ' + n); };

const setFlag = (c, on) => { db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?,?)').run(c, on ? '1' : '0'); conf.invalidarCache(); };
const nuevoCli = (tel, etapa) => db.prepare('INSERT INTO clientes (nombre, telefono, etapa, activo, lead_score) VALUES (?,?,?,1,0)').run('Cli ' + tel, tel, etapa || null).lastInsertRowid;
const etapaDe = (id) => db.prepare('SELECT etapa FROM clientes WHERE id=?').get(id).etapa;

const pruebas = [];
const T = (n, fn) => pruebas.push([n, fn]);

T('avanzarEtapa: lead/null → contactado → cotizado → ganado, con log en crm_etapas', () => {
    const id = nuevoCli('5215550700', null);
    assert(crmBot.avanzarEtapa(db, id, 'contactado'));
    assert.strictEqual(etapaDe(id), 'contactado');
    assert(crmBot.avanzarEtapa(db, id, 'cotizado'));
    assert(crmBot.avanzarEtapa(db, id, 'ganado'));
    assert.strictEqual(etapaDe(id), 'ganado');
    const logs = db.prepare("SELECT a FROM crm_etapas WHERE id_cliente=? AND creado_por='bot' ORDER BY id").all(id).map(r => r.a);
    assert.deepStrictEqual(logs, ['contactado', 'cotizado', 'ganado']);
});

T('NO retrocede ni repite (idempotente)', () => {
    const id = nuevoCli('5215550701', 'cotizado');
    assert.strictEqual(crmBot.avanzarEtapa(db, id, 'contactado'), false, 'no retrocede');
    assert.strictEqual(crmBot.avanzarEtapa(db, id, 'cotizado'), false, 'no repite');
    assert.strictEqual(etapaDe(id), 'cotizado');
});

T('un GANADO no lo degrada el bot (ni a perdido)', () => {
    const id = nuevoCli('5215550702', 'ganado');
    assert.strictEqual(crmBot.avanzarEtapa(db, id, 'contactado'), false);
    assert.strictEqual(crmBot.avanzarEtapa(db, id, 'perdido', { permitirPerdido: true }), false);
    assert.strictEqual(etapaDe(id), 'ganado');
});

T("'perdido' solo explícito (permitirPerdido)", () => {
    const id = nuevoCli('5215550703', 'contactado');
    assert.strictEqual(crmBot.avanzarEtapa(db, id, 'perdido'), false, 'sin permiso no marca perdido');
    assert(crmBot.avanzarEtapa(db, id, 'perdido', { permitirPerdido: true }));
    assert.strictEqual(etapaDe(id), 'perdido');
});

T('gating: crm_pipeline_activo OFF → no-opea todo', () => {
    setFlag('crm_pipeline_activo', false);
    const id = nuevoCli('5215550704', null);
    assert.strictEqual(crmBot.avanzarEtapa(db, id, 'contactado'), false);
    assert.strictEqual(crmBot.agregarNota(db, id, 'x'), false);
    assert.strictEqual(crmBot.subirScore(db, id, 10), false);
    assert.strictEqual(etapaDe(id), null);
    setFlag('crm_pipeline_activo', true);
});

T('nota + score suben en la ficha', () => {
    const id = nuevoCli('5215550705', 'contactado');
    assert(crmBot.agregarNota(db, id, 'Abandonó el carrito — motivo: precio'));
    assert(crmBot.subirScore(db, id, 15));
    assert(db.prepare("SELECT 1 FROM crm_notas WHERE id_cliente=? AND creado_por='bot' AND contenido LIKE '%precio%'").get(id));
    assert.strictEqual(db.prepare('SELECT lead_score FROM clientes WHERE id=?').get(id).lead_score, 15);
});

T('INTEGRACIÓN: primer mensaje del cliente → contactado (sin mensajes falsos)', async () => {
    const sm = require('../bot/sessionManager');
    const { handleAction } = require('../bot/actionHandler');
    const mock = { sendMessage: async (_, m) => m, getChats: async () => [] };
    const tel = '5215550706';
    nuevoCli(tel, null);
    const U = tel + '@c.us'; sm.clearSession(U);
    await handleAction(U, sm.getSession(U), { body: 'hola', hasMedia: false, type: 'chat' }, mock);
    assert.strictEqual(db.prepare('SELECT etapa FROM clientes WHERE telefono=?').get(tel).etapa, 'contactado');
});

T('INTEGRACIÓN: la acción cotizar del motor marca cotizado + sube score', () => {
    setFlag('cotizacion_activo', true);
    const { ACTIONS } = require('../bot/flows/motor/actions');
    const tel = '5215550707';
    const id = nuevoCli(tel, 'contactado');
    const r = ACTIONS.cotizar({ tel, data: { carrito: [{ id: 1, name: 'X', price: 100, cantidad: 1 }] } });
    assert.strictEqual(r.resultado, 'ok');
    assert.strictEqual(etapaDe(id), 'cotizado');
    assert(db.prepare('SELECT lead_score FROM clientes WHERE id=?').get(id).lead_score > 0);
});

T('P2 saludo: un cliente GANADO recibe el saludo frecuente; un lead, el normal', () => {
    const shared = require('../bot/flows/_shared');
    const telG = '5215550708', telN = '5215550709';
    db.prepare("INSERT INTO clientes (nombre, telefono, etapa, tags, activo) VALUES ('Rosa Frecuente',?, 'ganado', 'pedido_123', 1)").run(telG);
    db.prepare("INSERT INTO clientes (nombre, telefono, etapa, activo) VALUES ('Lalo Lead',?, 'contactado', 1)").run(telN);
    const gan = shared.menuPrincipal(telG);
    assert(/preferencia|confianza|gusto tenerte/i.test(gan), 'saludo frecuente esperado: ' + gan.slice(0, 60));
    const lead = shared.menuPrincipal(telN);
    assert(!/preferencia|confianza/i.test(lead), 'un lead no recibe saludo de frecuente');
});

(async () => {
    for (const [n, fn] of pruebas) { await fn(); ok++; console.log('✅ ' + n); }
    console.log('\n' + ok + '/9 OK — el bot alimenta el pipeline CRM en vivo (solo datos).');
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
    process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
