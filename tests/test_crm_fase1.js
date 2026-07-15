'use strict';
// tests/test_crm_fase1.js — CRM Fase 1: pipeline (etapa derivada + explícita
// con log), notas y timeline unificado.
//   node tests/test_crm_fase1.js

const assert = require('assert');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const { pipeline, etapaPut, notasPost, timeline } = require('../dashboard/routes/crm')._test;
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

const ctx = (out) => ({ db, json: (res, d, code) => { out.d = d; out.code = code || 200; }, readJson: (req, res, cb) => cb(req._body) });

// Dos clientes: uno con pedido PAGADO (→ ganado derivado), otro sin nada (→ lead).
const idGanado = db.prepare("INSERT INTO clientes (nombre, telefono, activo, lead_score) VALUES ('Cliente Pagador','5215550100',1,80)").run().lastInsertRowid;
const idLead = db.prepare("INSERT INTO clientes (nombre, telefono, activo, lead_score) VALUES ('Cliente Curioso','5215550101',1,5)").run().lastInsertRowid;
const ped = db.prepare("INSERT INTO pedidos (cliente, id_cliente, id_producto, cantidad, estatus, folio, total) VALUES ('Cliente Pagador',?,1,1,'entregado','CRM-001',500)").run(idGanado).lastInsertRowid;
db.prepare("INSERT INTO links_pago (id_pedido, monto, moneda, estatus, pagado_en) VALUES (?,500,'MXN','pagado',datetime('now','localtime'))").run(ped);

t('pipeline: etapa DERIVADA — pagador en ganado, curioso en lead', () => {
    const out = {};
    pipeline(null, null, ctx(out));
    assert(out.d.columnas.ganado.some(c => c.id === idGanado));
    assert(out.d.columnas.lead.some(c => c.id === idLead));
});

t('mover etapa: explícita + log en crm_etapas', () => {
    const out = {};
    etapaPut({ _body: { etapa: 'cotizado' } }, null, ctx(out), { params: [String(idLead)], ses: { username: 'vendedor1' } });
    assert(out.d.ok);
    assert.strictEqual(db.prepare('SELECT etapa FROM clientes WHERE id=?').get(idLead).etapa, 'cotizado');
    const log = db.prepare('SELECT * FROM crm_etapas WHERE id_cliente=?').get(idLead);
    assert.strictEqual(log.a, 'cotizado');
    assert.strictEqual(log.creado_por, 'vendedor1');
    // y el pipeline lo refleja
    const out2 = {};
    pipeline(null, null, ctx(out2));
    assert(out2.d.columnas.cotizado.some(c => c.id === idLead));
});

t('etapa inválida → 400', () => {
    const out = {};
    etapaPut({ _body: { etapa: 'inventada' } }, null, ctx(out), { params: [String(idLead)], ses: {} });
    assert.strictEqual(out.code, 400);
});

t('notas: se guardan con autor', () => {
    const out = {};
    notasPost({ _body: { contenido: 'Pidió cotización de 20 piezas, hablar el viernes' } }, null, ctx(out), { params: [String(idLead)], ses: { username: 'vendedor1' } });
    assert(out.d.ok);
    const n = db.prepare('SELECT * FROM crm_notas WHERE id_cliente=?').get(idLead);
    assert(/viernes/.test(n.contenido));
    assert.strictEqual(n.creado_por, 'vendedor1');
});

t('timeline unificado: pedido + nota + cambio de etapa, ordenado', () => {
    const out = {};
    timeline(null, null, ctx(out), { params: [String(idLead)] });
    const tipos = out.d.map(e => e.tipo);
    assert(tipos.includes('nota') && tipos.includes('etapa'), 'lead: nota + etapa');
    const out2 = {};
    timeline(null, null, ctx(out2), { params: [String(idGanado)] });
    assert(out2.d.some(e => e.tipo === 'pedido' && /CRM-001/.test(e.texto)), 'ganado: su pedido en el timeline');
});

console.log('\n' + ok + '/5 OK — CRM Fase 1: pipeline + notas + timeline.');
try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
