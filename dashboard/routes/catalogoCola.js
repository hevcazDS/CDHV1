'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 1087-1252 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function catalogoColaRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (req.method === 'PUT' && p.startsWith('/api/preventas/')) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { fecha_llegada_real } = JSON.parse(body);
                db.prepare('UPDATE preventas SET fecha_llegada_real=? WHERE id=?')
                  .run(fecha_llegada_real || new Date().toISOString().slice(0,10), id);
                return json(res, { ok:true, id });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/notificar-lista/:idProducto — notificar lista de espera manualmente
    if (req.method === 'POST' && p.startsWith('/api/notificar-lista/')) {
        if (!requireSession(req, res, ['gerente'])) return; // notificación en bloque a la lista de espera = gerente+
        const idProducto = parseInt(p.split('/').pop());
        try {
            const stockSvc = require('../../services/stockService');
            const notificados = stockSvc.notificarListaEspera(idProducto);
            return json(res, { ok:true, notificados: notificados.length, telefonos: notificados });
        } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
    }

    // ── PENDIENTE 5: Validación stock al confirmar pago ───────────────
    // (GET de sustitutos para el dashboard)
    if (p.startsWith('/api/sustitutos/') && req.method === 'GET') {
        const idProd = parseInt(p.split('/').pop());
        const rows = db.prepare(`
            SELECT ps.id, ps.score, ps.tipo_relacion,
                   p.id AS id_sustituto, p.name, p.price, p.stock_tienda, p.stock_cedis
            FROM productos_similares ps JOIN productos p ON p.id = ps.id_sustituto
            WHERE ps.id_producto=? AND ps.activa=1
            ORDER BY ps.score DESC
        `).all(idProd);
        return json(res, rows);
    }

    // POST /api/sustitutos — agregar relación manual entre productos
    if (p === '/api/sustitutos' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { id_producto, id_sustituto, tipo_relacion, score } = JSON.parse(body);
                if (!id_producto || !id_sustituto) return json(res, { ok: false, error: 'Faltan ids' }, 400);
                db.prepare(`
                    INSERT OR REPLACE INTO productos_similares
                        (id_producto, id_sustituto, tipo_relacion, score, activa)
                    VALUES (?, ?, ?, ?, 1)
                `).run(id_producto, id_sustituto, tipo_relacion || 'similar', score || 8);
                // Relación bidireccional opcional
                db.prepare(`
                    INSERT OR IGNORE INTO productos_similares
                        (id_producto, id_sustituto, tipo_relacion, score, activa)
                    VALUES (?, ?, ?, ?, 1)
                `).run(id_sustituto, id_producto, tipo_relacion || 'similar', score || 8);
                return json(res, { ok: true });
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // DELETE /api/sustitutos/:id — eliminar relación por id de la tabla.
    // POST /api/sustitutos crea el par en ambas direcciones, así que aquí
    // desactivamos las dos para no dejar la reversa huérfana y activa.
    if (p.startsWith('/api/sustitutos/') && req.method === 'DELETE') {
        const id = parseInt(p.split('/').pop());
        const rel = db.prepare('SELECT id_producto, id_sustituto FROM productos_similares WHERE id=?').get(id);
        if (rel) {
            db.prepare('UPDATE productos_similares SET activa=0 WHERE id=? OR (id_producto=? AND id_sustituto=?)')
              .run(id, rel.id_sustituto, rel.id_producto);
        } else {
            db.prepare('UPDATE productos_similares SET activa=0 WHERE id=?').run(id);
        }
        return json(res, { ok: true });
    }

    // GET /api/productos/buscar?q=texto — buscar productos para vincular
    if (p === '/api/productos/buscar' && req.method === 'GET') {
        const q = '%' + (new URL('http://x' + req.url).searchParams.get('q') || '') + '%';
        const rows = db.prepare(`
            SELECT id, name, cat, price, stock_tienda, stock_cedis
            FROM productos WHERE activo=1 AND name LIKE ?
            ORDER BY name LIMIT 20
        `).all(q);
        return json(res, rows);
    }

    // GET /health — estado del bot y dashboard
    if (p === '/health' && req.method === 'GET') {
        const _cola = db.prepare("SELECT COUNT(*) AS n FROM cola_notificaciones WHERE estatus='pendiente'").get()?.n || 0;
        const _colaf = db.prepare("SELECT COUNT(*) AS n FROM cola_notificaciones WHERE intentos>=3 AND estatus='pendiente'").get()?.n || 0;
        const _pedidos = db.prepare("SELECT COUNT(*) AS n FROM pedidos").get()?.n || 0;
        const _uptime = Math.floor(process.uptime());
        return json(res, {
            ok: true,
            dashboard: 'online',
            uptime_seg: _uptime,
            cola_pendiente: _cola,
            cola_fallida: _colaf,
            total_pedidos: _pedidos,
            timestamp: new Date().toISOString(),
            alerta_cola: _cola > 50 ? 'COLA ALTA — revisar' : null,
        });
    }

    // GET /api/cola — ver cola de notificaciones pendientes y fallidas
    if (p === '/api/cola' && req.method === 'GET') {
        const pendientes = db.prepare(`
            SELECT id, tipo, destinatario, asunto, estatus, intentos, creada_en
            FROM cola_notificaciones
            WHERE estatus IN ('pendiente','error') OR intentos >= 3
            ORDER BY id DESC LIMIT 100
        `).all();
        const resumen = {
            pendientes: pendientes.filter(r => r.estatus === 'pendiente' && r.intentos < 3).length,
            fallidas:   pendientes.filter(r => r.intentos >= 3).length,
            total:      pendientes.length,
            items:      pendientes,
        };
        return json(res, resumen);
    }

    // POST /api/cola/reintentar — resetear intentos de mensajes fallidos
    if (p === '/api/cola/reintentar' && req.method === 'POST') {
        const r = db.prepare(`
            UPDATE cola_notificaciones SET intentos=0, estatus='pendiente'
            WHERE intentos >= 3 AND estatus='pendiente'
        `).run();
        return json(res, { ok: true, reactivados: r.changes });
    }

    // POST /api/cola/reintentar/:id — reintentar un mensaje específico
    if (req.method === 'POST' && p.startsWith('/api/cola/reintentar/')) {
        const id = parseInt(p.split('/').pop());
        db.prepare(`UPDATE cola_notificaciones SET intentos=0, estatus='pendiente' WHERE id=?`).run(id);
        return json(res, { ok: true, id });
    }

    // GET /api/cola/programados — mensajes programados agrupados por campaña
    if (p === '/api/cola/programados' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT asunto, enviar_despues_de, creada_en,
                   MIN(cuerpo) AS cuerpo_muestra,
                   COUNT(*) AS total
            FROM cola_notificaciones
            WHERE estatus = 'programado'
            GROUP BY asunto, enviar_despues_de
            ORDER BY enviar_despues_de ASC
        `).all();
        return json(res, rows);
    }

    // DELETE /api/cola/programados — cancelar campaña programada
    if (p === '/api/cola/programados' && req.method === 'DELETE') {
        return readBody(req, body => {
            try {
                const { asunto, enviar_despues_de } = JSON.parse(body);
                if (!enviar_despues_de) return json(res, { ok:false, error:'Falta enviar_despues_de' }, 400);
                const r = db.prepare(`
                    UPDATE cola_notificaciones SET estatus='cancelado'
                    WHERE estatus='programado' AND enviar_despues_de=?
                    ${asunto ? 'AND asunto=?' : ''}
                `).run(...(asunto ? [enviar_despues_de, asunto] : [enviar_despues_de]));
                return json(res, { ok:true, cancelados: r.changes });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/cola/historial — últimos 50 mensajes enviados o fallidos
    return next();
};
