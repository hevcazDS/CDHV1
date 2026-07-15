'use strict';
// CRM Fase 1 (INFORME_CRM.md): pipeline de etapas + notas + timeline unificado.
// Área operación (ventas/atención); auditor lee por su bypass. La etapa NULL se
// DERIVA: cliente con pedido pagado → 'ganado', sin él → 'lead' — así el
// pipeline nace poblado con la historia real sin migrar datos.
const construirModulo = require('./_construirModulo');

const ETAPAS = ['lead', 'contactado', 'cotizado', 'ganado', 'perdido'];

// GET /api/crm/pipeline — clientes agrupados por etapa (efectiva), con score.
function pipeline(req, res, ctx) {
    const { db, json } = ctx;
    const filas = db.prepare(`
        SELECT c.id, c.nombre, c.telefono, c.tags, c.lead_score, c.etapa, c.creado_en,
               COALESCE(c.etapa,
                 CASE WHEN EXISTS (
                   SELECT 1 FROM pedidos p JOIN links_pago lp ON lp.id_pedido = p.id_pedido
                   WHERE p.id_cliente = c.id AND lp.estatus = 'pagado'
                 ) THEN 'ganado' ELSE 'lead' END) AS etapa_efectiva,
               (SELECT MAX(m.enviado_en) FROM mensajes m JOIN conversaciones cv ON cv.id = m.id_conversacion
                WHERE cv.telefono = c.telefono) AS ultimo_mensaje,
               (SELECT COUNT(*) FROM pedidos p WHERE p.id_cliente = c.id) AS pedidos_n
        FROM clientes c
        WHERE c.activo = 1
        ORDER BY c.lead_score DESC, c.id DESC
        LIMIT 500`).all();
    const columnas = {};
    for (const e of ETAPAS) columnas[e] = [];
    for (const f of filas) (columnas[f.etapa_efectiva] || columnas.lead).push(f);
    return json(res, { etapas: ETAPAS, columnas });
}

// PUT /api/crm/clientes/:id/etapa { etapa } — mueve en el pipeline + log.
function etapaPut(req, res, ctx, { params, ses }) {
    const { db, json, readJson } = ctx;
    const id = parseInt(params[0]);
    return readJson(req, res, d => {
        if (!ETAPAS.includes(d.etapa)) return json(res, { ok: false, error: 'Etapa inválida' }, 400);
        const c = db.prepare('SELECT id, etapa FROM clientes WHERE id=?').get(id);
        if (!c) return json(res, { ok: false, error: 'Cliente no encontrado' }, 404);
        db.transaction(() => {
            db.prepare('UPDATE clientes SET etapa=? WHERE id=?').run(d.etapa, id);
            db.prepare('INSERT INTO crm_etapas (id_cliente, de, a, creado_por) VALUES (?,?,?,?)')
              .run(id, c.etapa || null, d.etapa, ses?.username || null);
        })();
        return json(res, { ok: true, id, etapa: d.etapa });
    });
}

// GET/POST notas del cliente.
function notasGet(req, res, ctx, { params }) {
    const { db, json } = ctx;
    return json(res, db.prepare('SELECT * FROM crm_notas WHERE id_cliente=? ORDER BY id DESC LIMIT 100').all(parseInt(params[0])));
}
function notasPost(req, res, ctx, { params, ses }) {
    const { db, json, readJson } = ctx;
    const id = parseInt(params[0]);
    return readJson(req, res, d => {
        const contenido = String(d.contenido || '').trim();
        if (!contenido) return json(res, { ok: false, error: 'Escribe la nota' }, 400);
        const r = db.prepare('INSERT INTO crm_notas (id_cliente, contenido, creado_por) VALUES (?,?,?)')
            .run(id, contenido.slice(0, 2000), ses?.username || null);
        return json(res, { ok: true, id: r.lastInsertRowid });
    });
}

// GET /api/crm/clientes/:id/timeline — historial unificado: pedidos + notas +
// cambios de etapa + citas, mezclados y ordenados por fecha (lo más nuevo 1o).
function timeline(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const id = parseInt(params[0]);
    const c = db.prepare('SELECT id, telefono FROM clientes WHERE id=?').get(id);
    if (!c) return json(res, { ok: false, error: 'Cliente no encontrado' }, 404);
    const safe = (fn) => { try { return fn(); } catch (_) { return []; } };
    const eventos = [
        ...safe(() => db.prepare(`SELECT 'pedido' AS tipo, folio || ' · ' || estatus || COALESCE(' · $' || total, '') AS texto, creado_en AS fecha FROM pedidos WHERE id_cliente=?`).all(id)),
        ...safe(() => db.prepare(`SELECT 'nota' AS tipo, contenido || COALESCE(' — ' || creado_por, '') AS texto, creado_en AS fecha FROM crm_notas WHERE id_cliente=?`).all(id)),
        ...safe(() => db.prepare(`SELECT 'etapa' AS tipo, COALESCE(de,'(inicio)') || ' → ' || a || COALESCE(' — ' || creado_por, '') AS texto, creado_en AS fecha FROM crm_etapas WHERE id_cliente=?`).all(id)),
        ...safe(() => db.prepare(`SELECT 'cita' AS tipo, COALESCE(servicio,'Cita') || ' · ' || fecha || ' ' || hora || ' · ' || estatus AS texto, creado_en AS fecha FROM citas WHERE telefono=?`).all(c.telefono)),
    ];
    eventos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    return json(res, eventos.slice(0, 200));
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/crm/pipeline',                       area: 'operacion', handler: pipeline },
    { metodo: 'PUT',  path: /^\/api\/crm\/clientes\/(\d+)\/etapa$/,    area: 'operacion', handler: etapaPut },
    { metodo: 'GET',  path: /^\/api\/crm\/clientes\/(\d+)\/notas$/,    area: 'operacion', handler: notasGet },
    { metodo: 'POST', path: /^\/api\/crm\/clientes\/(\d+)\/notas$/,    area: 'operacion', handler: notasPost },
    { metodo: 'GET',  path: /^\/api\/crm\/clientes\/(\d+)\/timeline$/, area: 'operacion', handler: timeline },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/crm' });
module.exports._test = { pipeline, etapaPut, notasPost, timeline };   // contract tests
