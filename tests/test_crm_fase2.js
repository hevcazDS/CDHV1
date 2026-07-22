'use strict';
// tests/test_crm_fase2.js — CRM Fase 2: tareas de seguimiento (crear/vencidas/
// hecha) + segmentos guardados (filtro whitelisted, opt-out SIEMPRE respetado).
//   node --test tests/test_crm_fase2.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const { tareasGet, tareaPost, tareaPut, segmentoPost, segmentoPreview } = require('../dashboard/routes/crm')._test;
const ctx = (out) => ({ db, json: (res, d, code) => { out.d = d; out.code = code || 200; }, readJson: (req, res, cb) => cb(req._body) });

const idA = db.prepare("INSERT INTO clientes (nombre, telefono, activo, lead_score) VALUES ('Alto Score','5215550200',1,90)").run().lastInsertRowid;
const idB = db.prepare("INSERT INTO clientes (nombre, telefono, activo, lead_score, marketing_opt_out) VALUES ('OptOut','5215550201',1,95,1)").run().lastInsertRowid;
db.prepare("INSERT INTO clientes (nombre, telefono, activo, lead_score) VALUES ('Bajo Score','5215550202',1,3)").run();

test('tarea: crear con vencimiento y verla en "vencidas"', () => {
    const out = {};
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    tareaPost({ _body: { titulo: 'Llamar para cerrar cotización', tipo: 'llamada', vence_en: ayer, asignado_a: 'vendedor1' } }, null, ctx(out), { params: [String(idA)], ses: { username: 'gerente1' } });
    assert(out.d.ok);
    const out2 = {};
    tareasGet(null, null, ctx(out2), { u: new URL('http://x/api/crm/tareas?vista=vencidas'), ses: {} });
    const t1 = out2.d.find(x => x.id_cliente === idA);
    assert(t1 && t1.vencida === true && t1.cliente_nombre === 'Alto Score');
});

test('tarea: marcar hecha sella hecha_en y sale de pendientes', () => {
    const id = db.prepare('SELECT id FROM crm_tareas ORDER BY id DESC LIMIT 1').get().id;
    const out = {};
    tareaPut({ _body: { estatus: 'hecha' } }, null, ctx(out), { params: [String(id)] });
    assert(out.d.ok);
    const fila = db.prepare('SELECT estatus, hecha_en FROM crm_tareas WHERE id=?').get(id);
    assert.strictEqual(fila.estatus, 'hecha');
    assert(fila.hecha_en);
    const out2 = {};
    tareasGet(null, null, ctx(out2), { u: new URL('http://x/api/crm/tareas?vista=pendientes'), ses: {} });
    assert(!out2.d.some(x => x.id === id));
});

test('vista "mias": filtra por asignado', () => {
    const out = {};
    tareaPost({ _body: { titulo: 'Visita al local', asignado_a: 'ana' } }, null, ctx(out), { params: [String(idA)], ses: {} });
    const out2 = {};
    tareasGet(null, null, ctx(out2), { u: new URL('http://x/api/crm/tareas?vista=mias'), ses: { username: 'ana' } });
    assert(out2.d.length === 1 && out2.d[0].asignado_a === 'ana');
});

test('segmento: score_min filtra y el OPT-OUT se excluye SIEMPRE', () => {
    const out = {};
    segmentoPreview(null, null, ctx(out), { u: new URL('http://x/api/crm/segmentos/preview?filtro=' + encodeURIComponent(JSON.stringify({ score_min: 50 }))) });
    assert(out.d.ok);
    const ids = out.d.clientes.map(c => c.id);
    assert(ids.includes(idA), 'Alto Score (90) entra');
    assert(!ids.includes(idB), 'OptOut (95) NO entra aunque su score alcance — regla dura');
});

test('segmento: guardar y preview por id', () => {
    const out = {};
    segmentoPost({ _body: { nombre: 'VIPs', filtro: { score_min: 50 } } }, null, ctx(out), { ses: { username: 'gerente1' } });
    assert(out.d.ok);
    const out2 = {};
    segmentoPreview(null, null, ctx(out2), { u: new URL('http://x/api/crm/segmentos/preview?id=' + out.d.id) });
    assert(out2.d.ok && out2.d.total >= 1);
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
