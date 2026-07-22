'use strict';
// Preventas / lista de espera / sustitutos / cola de notificaciones + health.
// Extraído del monolito original (server.js 1087-1252) y ahora migrado al
// patrón declarativo del tronco: gate explícito por ruta (operacion/gerente),
// sin opts.prefijo porque agrupa varios prefijos (preventas, sustitutos, cola…).
const construirModulo = require('./_construirModulo');

// PUT /api/preventas/:id — registrar fecha de llegada real
function preventaPut(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const { fecha_llegada_real } = JSON.parse(body);
            db.prepare('UPDATE preventas SET fecha_llegada_real=? WHERE id=?')
              .run(fecha_llegada_real || new Date().toISOString().slice(0, 10), id);
            return json(res, { ok: true, id });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/notificar-lista/:idProducto — notificar lista de espera manualmente (gerente+)
function notificarLista(req, res, ctx, { params }) {
    const { json } = ctx;
    const idProducto = parseInt(params[0]);
    try {
        const notificados = require('../../services/stockService').notificarListaEspera(idProducto);
        return json(res, { ok: true, notificados: notificados.length, telefonos: notificados });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// GET /api/sustitutos/:id — sustitutos para el dashboard
function sustitutosGet(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const idProd = parseInt(params[0]);
    const rows = db.prepare(`
        SELECT ps.id, ps.score, ps.tipo_relacion,
               p.id AS id_sustituto, p.name, p.price, p.stock_tienda, p.stock_cedis
        FROM productos_similares ps JOIN productos p ON p.id = ps.id_sustituto
        WHERE ps.id_producto=? AND ps.activa=1
        ORDER BY ps.score DESC
    `).all(idProd);
    return json(res, rows);
}

// POST /api/sustitutos — agregar relación manual (bidireccional) (gerente+)
function sustitutosPost(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const { id_producto, id_sustituto, tipo_relacion, score } = JSON.parse(body);
            if (!id_producto || !id_sustituto) return json(res, { ok: false, error: 'Faltan ids' }, 400);
            db.prepare(`INSERT OR REPLACE INTO productos_similares (id_producto, id_sustituto, tipo_relacion, score, activa) VALUES (?, ?, ?, ?, 1)`)
              .run(id_producto, id_sustituto, tipo_relacion || 'similar', score || 8);
            db.prepare(`INSERT OR IGNORE INTO productos_similares (id_producto, id_sustituto, tipo_relacion, score, activa) VALUES (?, ?, ?, ?, 1)`)
              .run(id_sustituto, id_producto, tipo_relacion || 'similar', score || 8);
            return json(res, { ok: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// DELETE /api/sustitutos/:id — desactiva la relación y su reversa (gerente+)
function sustitutosDelete(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const id = parseInt(params[0]);
    const rel = db.prepare('SELECT id_producto, id_sustituto FROM productos_similares WHERE id=?').get(id);
    if (rel) {
        db.prepare('UPDATE productos_similares SET activa=0 WHERE id=? OR (id_producto=? AND id_sustituto=?)')
          .run(id, rel.id_sustituto, rel.id_producto);
    } else {
        db.prepare('UPDATE productos_similares SET activa=0 WHERE id=?').run(id);
    }
    return json(res, { ok: true });
}

// GET /api/productos/buscar?q= — buscar productos para vincular
function productosBuscar(req, res, ctx) {
    const { db, json } = ctx;
    const q = '%' + (new URL('http://x' + req.url).searchParams.get('q') || '') + '%';
    const rows = db.prepare(`SELECT id, name, cat, price, stock_tienda, stock_cedis FROM productos WHERE activo=1 AND name LIKE ? ORDER BY name LIMIT 20`).all(q);
    return json(res, rows);
}

// GET /health — estado del bot y dashboard
function health(req, res, ctx) {
    const { db, json } = ctx;
    const _cola = db.prepare("SELECT COUNT(*) AS n FROM cola_notificaciones WHERE estatus='pendiente'").get()?.n || 0;
    const _colaf = db.prepare("SELECT COUNT(*) AS n FROM cola_notificaciones WHERE intentos>=3 AND estatus='pendiente'").get()?.n || 0;
    const _pedidos = db.prepare("SELECT COUNT(*) AS n FROM pedidos").get()?.n || 0;
    return json(res, {
        ok: true, dashboard: 'online', uptime_seg: Math.floor(process.uptime()),
        cola_pendiente: _cola, cola_fallida: _colaf, total_pedidos: _pedidos,
        timestamp: new Date().toISOString(),
        alerta_cola: _cola > 50 ? 'COLA ALTA — revisar' : null,
    });
}

// GET /api/cola — cola de notificaciones pendientes y fallidas
function colaGet(req, res, ctx) {
    const { db, json } = ctx;
    const pendientes = db.prepare(`
        SELECT id, tipo, destinatario, asunto, estatus, intentos, creada_en
        FROM cola_notificaciones WHERE estatus IN ('pendiente','error') OR intentos >= 3
        ORDER BY id DESC LIMIT 100`).all();
    return json(res, {
        pendientes: pendientes.filter(r => r.estatus === 'pendiente' && r.intentos < 3).length,
        fallidas: pendientes.filter(r => r.intentos >= 3).length,
        total: pendientes.length, items: pendientes,
    });
}

// POST /api/cola/reintentar — resetear intentos de mensajes fallidos (operacion)
function colaReintentar(req, res, ctx) {
    const { db, json } = ctx;
    const r = db.prepare(`UPDATE cola_notificaciones SET intentos=0, estatus='pendiente' WHERE intentos >= 3 AND estatus='pendiente'`).run();
    return json(res, { ok: true, reactivados: r.changes });
}

// POST /api/cola/reintentar/:id — reintentar un mensaje específico (operacion)
function colaReintentarId(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const id = parseInt(params[0]);
    db.prepare(`UPDATE cola_notificaciones SET intentos=0, estatus='pendiente' WHERE id=?`).run(id);
    return json(res, { ok: true, id });
}

// GET /api/cola/programados — mensajes programados agrupados por campaña
function colaProgramadosGet(req, res, ctx) {
    const { db, json } = ctx;
    const rows = db.prepare(`
        SELECT asunto, enviar_despues_de, creada_en, MIN(cuerpo) AS cuerpo_muestra, COUNT(*) AS total
        FROM cola_notificaciones WHERE estatus = 'programado'
        GROUP BY asunto, enviar_despues_de ORDER BY enviar_despues_de ASC`).all();
    return json(res, rows);
}

// DELETE /api/cola/programados — cancelar campaña programada (operacion)
function colaProgramadosDelete(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const { asunto, enviar_despues_de } = JSON.parse(body);
            if (!enviar_despues_de) return json(res, { ok: false, error: 'Falta enviar_despues_de' }, 400);
            const r = db.prepare(`
                UPDATE cola_notificaciones SET estatus='cancelado'
                WHERE estatus='programado' AND enviar_despues_de=?
                ${asunto ? 'AND asunto=?' : ''}`).run(...(asunto ? [enviar_despues_de, asunto] : [enviar_despues_de]));
            return json(res, { ok: true, cancelados: r.changes });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

const RUTAS = [
    { metodo: 'PUT',    path: /^\/api\/preventas\/(\d+)$/,          area: 'operacion', handler: preventaPut },
    { metodo: 'POST',   path: /^\/api\/notificar-lista\/(\d+)$/,    roles: ['gerente'], handler: notificarLista },
    { metodo: 'GET',    path: /^\/api\/sustitutos\/(\d+)$/,         handler: sustitutosGet },
    { metodo: 'POST',   path: '/api/sustitutos',                    roles: ['gerente'], handler: sustitutosPost },
    { metodo: 'DELETE', path: /^\/api\/sustitutos\/(\d+)$/,         roles: ['gerente'], handler: sustitutosDelete },
    { metodo: 'GET',    path: '/api/productos/buscar',              handler: productosBuscar },
    { metodo: 'GET',    path: '/health',                            handler: health },
    { metodo: 'GET',    path: '/api/cola',                          area: 'operacion', handler: colaGet },
    { metodo: 'POST',   path: '/api/cola/reintentar',               area: 'operacion', handler: colaReintentar },
    { metodo: 'POST',   path: /^\/api\/cola\/reintentar\/(\d+)$/,   area: 'operacion', handler: colaReintentarId },
    { metodo: 'GET',    path: '/api/cola/programados',              area: 'operacion', handler: colaProgramadosGet },
    { metodo: 'DELETE', path: '/api/cola/programados',              area: 'operacion', handler: colaProgramadosDelete },
];

module.exports = construirModulo(RUTAS);
