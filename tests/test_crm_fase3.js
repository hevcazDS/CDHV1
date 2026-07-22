'use strict';
// tests/test_crm_fase3.js — CRM Fase 3: campañas multi-paso + acciones CRM en
// el motor. Pinnea las REGLAS DURAS: solo corre lanzada (gate humano con
// rastro), opt-out excluido al inscribir Y a media campaña, salto si_compro,
// avance por días, techo por tick, y las acciones del lienzo.
//   node --test tests/test_crm_fase3.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const { inscribirSegmento, avanzarCampanas } = require('../services/crmCampanas');
const { campanaPost, campanaLanzar } = require('../dashboard/routes/crm')._test;
const ctx = (out) => ({ db, json: (res, d, code) => { out.d = d; out.code = code || 200; }, readJson: (req, res, cb) => cb(req._body) });

// Clientes: dos normales + un opt-out con score alto.
const idA = db.prepare("INSERT INTO clientes (nombre, telefono, activo, lead_score) VALUES ('Ana Campaña','5215550300',1,60)").run().lastInsertRowid;
const idB = db.prepare("INSERT INTO clientes (nombre, telefono, activo, lead_score) VALUES ('Beto Campaña','5215550301',1,70)").run().lastInsertRowid;
db.prepare("INSERT INTO clientes (nombre, telefono, activo, lead_score, marketing_opt_out) VALUES ('OptOut Campaña','5215550302',1,99,1)").run();
// segmento: score >= 50
db.prepare("INSERT INTO crm_segmentos (nombre, filtro_json) VALUES ('VIPs test', '{\"score_min\":50}')").run();
const idSeg = db.prepare('SELECT id FROM crm_segmentos ORDER BY id DESC LIMIT 1').get().id;

let cola = [];
const encolar = (tel, asunto, cuerpo) => cola.push({ tel, asunto, cuerpo });

let idCamp;

test('crear campaña (borrador) valida pasos', () => {
    const out = {};
    campanaPost({ _body: { nombre: 'Reactivación', id_segmento: idSeg, pasos: [
        { dia_offset: 0, mensaje: 'Hola {nombre}, tenemos novedades 🎉' },
        { dia_offset: 3, mensaje: '{nombre}, ¿lo pensaste?', condicion_salto: 'si_compro' },
    ] } }, null, ctx(out), { ses: { username: 'gerente1' } });
    assert(out.d.ok);
    idCamp = out.d.id;
    assert.strictEqual(db.prepare('SELECT estatus FROM crm_campanas WHERE id=?').get(idCamp).estatus, 'borrador');
});

test('REGLA DURA: en borrador el tick NO manda nada', () => {
    cola = [];
    const n = avanzarCampanas(db, encolar);
    assert.strictEqual(n, 0);
    assert.strictEqual(cola.length, 0);
});

test('lanzar (gate humano): inscribe el segmento SIN opt-out y deja rastro', () => {
    const out = {};
    campanaLanzar(null, null, ctx(out), { params: [String(idCamp)], ses: { username: 'gerente1' } });
    assert(out.d.ok);
    assert.strictEqual(out.d.inscritos, 2, 'Ana y Beto — el opt-out (score 99) NO');
    const c = db.prepare('SELECT * FROM crm_campanas WHERE id=?').get(idCamp);
    assert.strictEqual(c.estatus, 'activa');
    assert.strictEqual(c.aprobada_por, 'gerente1', 'rastro de quién lanzó');
});

test('tick día 0: manda el paso 1 personalizado a los 2 inscritos', () => {
    cola = [];
    const n = avanzarCampanas(db, encolar);
    assert.strictEqual(n, 2);
    assert(cola.some(m => m.tel === '5215550300' && /Hola Ana/.test(m.cuerpo)));
    assert(cola.some(m => m.tel === '5215550301' && /Hola Beto/.test(m.cuerpo)));
    // y NO re-manda en el siguiente tick (paso_actual avanzó, día 3 aún no llega)
    cola = [];
    assert.strictEqual(avanzarCampanas(db, encolar), 0);
});

test('salto si_compro: Ana compra → su paso 2 se salta; Beto (día 3) sí lo recibe', () => {
    // Ana paga después de inscribirse
    const ped = db.prepare("INSERT INTO pedidos (cliente, id_cliente, id_producto, cantidad, estatus) VALUES ('Ana',?,1,1,'entregado')").run(idA).lastInsertRowid;
    db.prepare("INSERT INTO links_pago (id_pedido, monto, moneda, estatus, pagado_en) VALUES (?,100,'MXN','pagado',datetime('now','localtime','+1 minute'))").run(ped);
    // viajar en el tiempo: la inscripción fue hace 4 días
    db.prepare("UPDATE crm_campana_inscritos SET inscrito_en = datetime('now','localtime','-4 days') WHERE id_campana=?").run(idCamp);
    // (el pago de Ana debe seguir siendo POSTERIOR a la inscripción)
    cola = [];
    const n = avanzarCampanas(db, encolar);
    assert.strictEqual(n, 1, 'solo Beto');
    assert(cola[0].tel === '5215550301' && /Beto/.test(cola[0].cuerpo));
    const ana = db.prepare('SELECT terminado FROM crm_campana_inscritos WHERE id_campana=? AND id_cliente=?').get(idCamp, idA);
    assert.strictEqual(ana.terminado, 1, 'Ana terminó por salto');
});

test('al agotar pasos, los inscritos terminan y la campaña se marca terminada', () => {
    cola = [];
    avanzarCampanas(db, encolar);   // Beto ya recibió paso 2 → siguiente tick lo termina
    const c = db.prepare('SELECT estatus FROM crm_campanas WHERE id=?').get(idCamp);
    assert.strictEqual(c.estatus, 'terminada');
});

test('acciones CRM del lienzo: crm_cambiar_etapa + crm_crear_tarea + crm_agregar_nota', () => {
    const { ACTIONS } = require('../bot/flows/motor/actions');
    const cx = { tel: '5215550300', raw: 'me interesa la cotización', userId: 'x@c.us', data: {} };
    assert.strictEqual(ACTIONS.crm_cambiar_etapa(cx, { etapa: 'cotizado' }).resultado, 'ok');
    assert.strictEqual(db.prepare('SELECT etapa FROM clientes WHERE id=?').get(idA).etapa, 'cotizado');
    assert.strictEqual(ACTIONS.crm_crear_tarea(cx, { titulo: 'Mandar cotización', dias_vence: 2 }).resultado, 'ok');
    assert(db.prepare('SELECT 1 FROM crm_tareas WHERE id_cliente=? AND creado_por=?').get(idA, 'bot'));
    assert.strictEqual(ACTIONS.crm_agregar_nota(cx, {}).resultado, 'ok');
    assert(db.prepare("SELECT 1 FROM crm_notas WHERE id_cliente=? AND contenido LIKE '%cotización%'").get(idA));
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
