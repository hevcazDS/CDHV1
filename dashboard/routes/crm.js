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
        ...safe(() => db.prepare(`SELECT 'tarea' AS tipo, titulo || ' · ' || estatus || COALESCE(' — ' || asignado_a, '') AS texto, creado_en AS fecha FROM crm_tareas WHERE id_cliente=?`).all(id)),
        ...safe(() => db.prepare(`SELECT 'cita' AS tipo, COALESCE(servicio,'Cita') || ' · ' || fecha || ' ' || hora || ' · ' || estatus AS texto, creado_en AS fecha FROM citas WHERE telefono=?`).all(c.telefono)),
    ];
    eventos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    return json(res, eventos.slice(0, 200));
}


// ═══ Fase 2: TAREAS de seguimiento ═══════════════════════════════════════════

// GET /api/crm/tareas?vista=pendientes|vencidas|mias — con nombre del cliente.
function tareasGet(req, res, ctx, { u, ses }) {
    const { db, json } = ctx;
    const vista = u.searchParams.get('vista') || 'pendientes';
    const hoy = new Date().toISOString().slice(0, 10);
    let where = "t.estatus = 'pendiente'";
    const args = [];
    if (vista === 'vencidas') { where += ' AND t.vence_en IS NOT NULL AND t.vence_en < ?'; args.push(hoy); }
    if (vista === 'mias') { where += ' AND t.asignado_a = ?'; args.push(ses?.username || ''); }
    if (vista === 'todas') where = '1=1';
    const filas = db.prepare(`
        SELECT t.*, c.nombre AS cliente_nombre, c.telefono
        FROM crm_tareas t JOIN clientes c ON c.id = t.id_cliente
        WHERE ${where} ORDER BY COALESCE(t.vence_en, '9999'), t.id LIMIT 300`).all(...args);
    return json(res, filas.map(f => ({ ...f, vencida: !!(f.vence_en && f.vence_en < hoy && f.estatus === 'pendiente') })));
}

function tareaPost(req, res, ctx, { params, ses }) {
    const { db, json, readJson } = ctx;
    const id = parseInt(params[0]);
    return readJson(req, res, d => {
        const titulo = String(d.titulo || '').trim();
        if (!titulo) return json(res, { ok: false, error: 'Escribe la tarea' }, 400);
        if (!db.prepare('SELECT id FROM clientes WHERE id=?').get(id)) return json(res, { ok: false, error: 'Cliente no encontrado' }, 404);
        const tipo = ['llamada', 'whatsapp', 'visita', 'seguimiento', 'otro'].includes(d.tipo) ? d.tipo : 'seguimiento';
        const vence = /^\d{4}-\d{2}-\d{2}$/.test(d.vence_en || '') ? d.vence_en : null;
        const r = db.prepare('INSERT INTO crm_tareas (id_cliente, titulo, tipo, vence_en, asignado_a, creado_por) VALUES (?,?,?,?,?,?)')
            .run(id, titulo.slice(0, 300), tipo, vence, String(d.asignado_a || '').trim() || null, ses?.username || null);
        return json(res, { ok: true, id: r.lastInsertRowid });
    });
}

function tareaPut(req, res, ctx, { params }) {
    const { db, json, readJson } = ctx;
    const id = parseInt(params[0]);
    return readJson(req, res, d => {
        if (!['pendiente', 'hecha', 'cancelada'].includes(d.estatus)) return json(res, { ok: false, error: 'Estatus inválido' }, 400);
        const r = db.prepare(`UPDATE crm_tareas SET estatus=?, hecha_en=${d.estatus === 'hecha' ? "datetime('now','localtime')" : 'NULL'} WHERE id=?`).run(d.estatus, id);
        if (!r.changes) return json(res, { ok: false, error: 'Tarea no encontrada' }, 404);
        return json(res, { ok: true, id });
    });
}

// ═══ Fase 2: SEGMENTOS guardados (audiencias) ════════════════════════════════
// Filtro = JSON con claves WHITELISTED (nunca SQL del cliente):
//   { etapa, score_min, dias_sin_compra_min, tag, con_pedidos }
// El opt-out de marketing se respeta SIEMPRE en toda audiencia.
function _sqlDeFiltro(f) {
    const where = ['c.activo = 1'];
    const args = [];
    if (['lead', 'contactado', 'cotizado', 'ganado', 'perdido'].includes(f.etapa)) {
        where.push(`COALESCE(c.etapa, CASE WHEN EXISTS (
            SELECT 1 FROM pedidos p JOIN links_pago lp ON lp.id_pedido = p.id_pedido
            WHERE p.id_cliente = c.id AND lp.estatus = 'pagado') THEN 'ganado' ELSE 'lead' END) = ?`);
        args.push(f.etapa);
    }
    if (Number(f.score_min) > 0) { where.push('c.lead_score >= ?'); args.push(Number(f.score_min)); }
    if (Number(f.dias_sin_compra_min) > 0) {
        where.push(`NOT EXISTS (SELECT 1 FROM pedidos p JOIN links_pago lp ON lp.id_pedido = p.id_pedido
            WHERE p.id_cliente = c.id AND lp.estatus = 'pagado'
              AND lp.pagado_en >= datetime('now', 'localtime', '-' || ? || ' days'))`);
        args.push(String(Math.min(3650, Number(f.dias_sin_compra_min))));
    }
    if (String(f.tag || '').trim()) { where.push('c.tags LIKE ?'); args.push('%' + String(f.tag).trim().slice(0, 40) + '%'); }
    if (f.con_pedidos === true) where.push('EXISTS (SELECT 1 FROM pedidos p WHERE p.id_cliente = c.id)');
    where.push('COALESCE(c.marketing_opt_out, 0) = 0');
    return { where: where.join(' AND '), args };
}

function segmentosGet(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, db.prepare('SELECT * FROM crm_segmentos ORDER BY id DESC').all());
}
function segmentoPost(req, res, ctx, { ses }) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, d => {
        const nombre = String(d.nombre || '').trim();
        if (!nombre) return json(res, { ok: false, error: 'Nombra el segmento' }, 400);
        const filtro = d.filtro && typeof d.filtro === 'object' ? d.filtro : {};
        const r = db.prepare('INSERT INTO crm_segmentos (nombre, filtro_json, creado_por) VALUES (?,?,?)')
            .run(nombre.slice(0, 80), JSON.stringify(filtro), ses?.username || null);
        return json(res, { ok: true, id: r.lastInsertRowid });
    });
}
function segmentoDelete(req, res, ctx, { params }) {
    const { db, json } = ctx;
    db.prepare('DELETE FROM crm_segmentos WHERE id=?').run(parseInt(params[0]));
    return json(res, { ok: true });
}
// preview: por id guardado (?id=) o por filtro directo (?filtro=<json>) para
// probar ANTES de guardar.
function segmentoPreview(req, res, ctx, { u }) {
    const { db, json } = ctx;
    let filtro = {};
    const id = parseInt(u.searchParams.get('id') || '0', 10);
    if (id) {
        const seg = db.prepare('SELECT filtro_json FROM crm_segmentos WHERE id=?').get(id);
        if (!seg) return json(res, { ok: false, error: 'Segmento no encontrado' }, 404);
        try { filtro = JSON.parse(seg.filtro_json); } catch (_) {}
    } else {
        try { filtro = JSON.parse(u.searchParams.get('filtro') || '{}'); } catch (_) {}
    }
    const { where, args } = _sqlDeFiltro(filtro);
    const clientes = db.prepare(`SELECT c.id, c.nombre, c.telefono, c.lead_score FROM clientes c WHERE ${where} ORDER BY c.lead_score DESC LIMIT 200`).all(...args);
    return json(res, { ok: true, total: clientes.length, clientes: clientes.slice(0, 50) });
}


// ═══ Fase 3: CAMPAÑAS multi-paso (gate humano OBLIGATORIO al lanzar) ═════════

function campanasGet(req, res, ctx) {
    const { db, json } = ctx;
    const camps = db.prepare(`
        SELECT k.*, s.nombre AS segmento_nombre,
               (SELECT COUNT(*) FROM crm_campana_inscritos i WHERE i.id_campana = k.id) AS inscritos,
               (SELECT COUNT(*) FROM crm_campana_inscritos i WHERE i.id_campana = k.id AND i.terminado = 1) AS terminados
        FROM crm_campanas k LEFT JOIN crm_segmentos s ON s.id = k.id_segmento
        ORDER BY k.id DESC`).all();
    const pasos = db.prepare('SELECT * FROM crm_campana_pasos ORDER BY id_campana, orden').all();
    for (const c of camps) c.pasos = pasos.filter(p => p.id_campana === c.id);
    return json(res, camps);
}

// POST — crea en BORRADOR (no corre nada hasta lanzarla).
function campanaPost(req, res, ctx, { ses }) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, d => {
        const nombre = String(d.nombre || '').trim();
        const idSeg = Number(d.id_segmento) || 0;
        const pasos = Array.isArray(d.pasos) ? d.pasos : [];
        if (!nombre) return json(res, { ok: false, error: 'Nombra la campaña' }, 400);
        if (!db.prepare('SELECT id FROM crm_segmentos WHERE id=?').get(idSeg)) return json(res, { ok: false, error: 'Elige un segmento válido' }, 400);
        if (!pasos.length || pasos.length > 5) return json(res, { ok: false, error: 'La campaña necesita de 1 a 5 pasos' }, 400);
        for (const p of pasos) {
            if (!String(p.mensaje || '').trim()) return json(res, { ok: false, error: 'Cada paso necesita mensaje' }, 400);
            if (!(Number(p.dia_offset) >= 0)) return json(res, { ok: false, error: 'Cada paso necesita día (0 = al lanzar)' }, 400);
        }
        const r = db.transaction(() => {
            const rc = db.prepare('INSERT INTO crm_campanas (nombre, id_segmento, creado_por) VALUES (?,?,?)')
                .run(nombre.slice(0, 80), idSeg, ses?.username || null);
            const insP = db.prepare('INSERT INTO crm_campana_pasos (id_campana, orden, dia_offset, mensaje, condicion_salto) VALUES (?,?,?,?,?)');
            pasos.forEach((p, i) => insP.run(rc.lastInsertRowid, i + 1, Math.min(90, Number(p.dia_offset)), String(p.mensaje).trim().slice(0, 1000), p.condicion_salto === 'si_compro' ? 'si_compro' : null));
            return rc.lastInsertRowid;
        })();
        return json(res, { ok: true, id: r });
    });
}

// POST /:id/lanzar — EL GATE HUMANO: gerente+ (la ruta lo exige), inscribe el
// snapshot del segmento y activa. aprobada_por queda como rastro de auditoría.
function campanaLanzar(req, res, ctx, { params, ses }) {
    const { db, json } = ctx;
    const id = parseInt(params[0]);
    const c = db.prepare('SELECT * FROM crm_campanas WHERE id=?').get(id);
    if (!c) return json(res, { ok: false, error: 'Campaña no encontrada' }, 404);
    if (c.estatus === 'activa') return json(res, { ok: false, error: 'Ya está activa' }, 400);
    if (c.estatus === 'terminada') return json(res, { ok: false, error: 'Ya terminó — crea una nueva' }, 400);
    const { inscribirSegmento } = require('../../services/crmCampanas');
    const n = c.estatus === 'borrador' ? inscribirSegmento(db, id, c.id_segmento) : 0;   // pausada → reanuda sin re-inscribir
    db.prepare("UPDATE crm_campanas SET estatus='activa', aprobada_por=?, aprobada_en=datetime('now','localtime') WHERE id=?")
      .run(ses?.username || null, id);
    try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('campana_lanzada','panel',?,?)").run(c.nombre + ' #' + id, ses?.username || null); } catch (_) {}
    return json(res, { ok: true, id, inscritos: n, reanudada: c.estatus === 'pausada' });
}

function campanaPausar(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const r = db.prepare("UPDATE crm_campanas SET estatus='pausada' WHERE id=? AND estatus='activa'").run(parseInt(params[0]));
    if (!r.changes) return json(res, { ok: false, error: 'Solo se pausa una campaña activa' }, 400);
    return json(res, { ok: true });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/crm/campanas',                        roles: ['gerente'], handler: campanasGet },
    { metodo: 'POST', path: '/api/crm/campanas',                        roles: ['gerente'], handler: campanaPost },
    { metodo: 'POST', path: /^\/api\/crm\/campanas\/(\d+)\/lanzar$/,    roles: ['gerente'], handler: campanaLanzar },
    { metodo: 'POST', path: /^\/api\/crm\/campanas\/(\d+)\/pausar$/,    roles: ['gerente'], handler: campanaPausar },
    { metodo: 'GET',  path: '/api/crm/tareas',                          area: 'operacion', handler: tareasGet },
    { metodo: 'POST', path: /^\/api\/crm\/clientes\/(\d+)\/tareas$/,    area: 'operacion', handler: tareaPost },
    { metodo: 'PUT',  path: /^\/api\/crm\/tareas\/(\d+)$/,              area: 'operacion', handler: tareaPut },
    { metodo: 'GET',  path: '/api/crm/segmentos',                       roles: ['gerente'], handler: segmentosGet },
    { metodo: 'POST', path: '/api/crm/segmentos',                       roles: ['gerente'], handler: segmentoPost },
    { metodo: 'GET',  path: '/api/crm/segmentos/preview',               roles: ['gerente'], handler: segmentoPreview },
    { metodo: 'DELETE', path: /^\/api\/crm\/segmentos\/(\d+)$/,         roles: ['gerente'], handler: segmentoDelete },
    { metodo: 'GET',  path: '/api/crm/pipeline',                       area: 'operacion', handler: pipeline },
    { metodo: 'PUT',  path: /^\/api\/crm\/clientes\/(\d+)\/etapa$/,    area: 'operacion', handler: etapaPut },
    { metodo: 'GET',  path: /^\/api\/crm\/clientes\/(\d+)\/notas$/,    area: 'operacion', handler: notasGet },
    { metodo: 'POST', path: /^\/api\/crm\/clientes\/(\d+)\/notas$/,    area: 'operacion', handler: notasPost },
    { metodo: 'GET',  path: /^\/api\/crm\/clientes\/(\d+)\/timeline$/, area: 'operacion', handler: timeline },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/crm' });
module.exports._sqlDeFiltro = _sqlDeFiltro;   // usado por services/crmCampanas
module.exports._test = { pipeline, etapaPut, notasPost, timeline, tareasGet, tareaPost, tareaPut, segmentoPost, segmentoPreview, campanaPost, campanaLanzar };   // contract tests
