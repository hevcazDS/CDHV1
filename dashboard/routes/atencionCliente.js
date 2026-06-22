'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 892-1086 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function atencionClienteRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (p === '/api/cola_atencion' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const estatusF = (_u.searchParams.get('estatus') || 'en_espera').trim();
        const rows = db.prepare(`
            SELECT ca.*, c.nombre AS cliente, c.telefono
            FROM cola_atencion ca
            LEFT JOIN clientes c ON c.id = ca.id_cliente
            WHERE ca.estatus = ?
            ORDER BY ca.prioridad ASC, ca.creada_en ASC LIMIT 200
        `).all(estatusF);
        return json(res, rows);
    }

    // PUT /api/cola_atencion/:id — el asesor marca que ya atendió/resolvió
    if (req.method === 'PUT' && p.match(/^\/api\/cola_atencion\/\d+$/)) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { estatus } = JSON.parse(body);
                const validos = ['en_espera','atendida','resuelta'];
                if (!validos.includes(estatus)) return json(res, { ok:false, error:'Estatus inválido' }, 400);
                const campoFecha = estatus === 'atendida' ? 'atendida_en' : estatus === 'resuelta' ? 'resuelta_en' : null;
                db.prepare(
                    'UPDATE cola_atencion SET estatus=?' + (campoFecha ? `, ${campoFecha}=datetime('now','localtime')` : '') + ' WHERE id=?'
                ).run(estatus, id);
                return json(res, { ok:true, estatus });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/pedidos/:id/mensajes — últimos mensajes del cliente con el bot
    if (req.method === 'GET' && p.match(/^\/api\/pedidos\/\d+\/mensajes$/)) {
        const idPed = parseInt(p.split('/')[3]);
        const ped = db.prepare('SELECT id_cliente, cliente FROM pedidos WHERE id_pedido=? LIMIT 1').get(idPed);
        if (!ped) return json(res, []);
        const rows = db.prepare('SELECT m.rol, m.contenido, m.enviado_en FROM mensajes m JOIN conversaciones cv ON cv.id=m.id_conversacion WHERE cv.id_cliente=? ORDER BY m.enviado_en DESC LIMIT 10').all(ped.id_cliente);
        return json(res, rows.reverse());
    }

    // GET /api/clientes/:id/mensajes — conversación de un cliente
    if (req.method === 'GET' && p.match(/^\/api\/clientes\/\d+\/mensajes$/)) {
        const idCli = parseInt(p.split('/')[3]);
        const rows = db.prepare('SELECT m.rol, m.contenido, m.enviado_en FROM mensajes m JOIN conversaciones cv ON cv.id=m.id_conversacion WHERE cv.id_cliente=? ORDER BY m.enviado_en DESC LIMIT 15').all(idCli);
        return json(res, rows.reverse());
    }

    // GET /api/buscar?q=texto — buscador global (pedidos + clientes + guías)
    if (p === '/api/buscar' && req.method === 'GET') {
        const q = (new URL('http://x'+req.url).searchParams.get('q')||'').trim();
        if (q.length < 2) return json(res, { pedidos:[], clientes:[], guias:[] });
        const like = '%'+q+'%';
        const pedidos = db.prepare('SELECT id_pedido, folio, cliente, estatus, total, creado_en FROM pedidos WHERE folio LIKE ? OR cliente LIKE ? LIMIT 5').all(like, like);
        const clientes = db.prepare('SELECT id, nombre, telefono, COALESCE(tags,\'\') AS tags FROM clientes WHERE nombre LIKE ? OR telefono LIKE ? LIMIT 5').all(like, like);
        const guias = db.prepare('SELECT numero_guia, estatus, dest_nombre, dest_ciudad FROM guias_estafeta WHERE numero_guia LIKE ? OR dest_nombre LIKE ? LIMIT 5').all(like, like);
        return json(res, { pedidos, clientes, guias });
    }

    // POST /api/actualizar_guia — actualizar estatus de guía manualmente
    if (p === '/api/actualizar_guia' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), GuiaSchema, res, p);
                if (!datos) return;
                const { numeroGuia, estatus, descripcion, ubicacion } = datos;

                const estafeta = require('../services/estafetaService');
                const ok = estafeta.actualizarEstatusGuia(numeroGuia, estatus, descripcion, ubicacion);
                return json(res, { ok, numeroGuia, estatus });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // ── PENDIENTE 3: Lista de espera ────────────────────────────────
    if (p === '/api/lista-espera' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT le.id, le.telefono, le.nombre_cliente, le.cantidad,
                   le.estatus, le.creada_en, le.notificado_en,
                   p.name AS producto, p.price, p.stock_tienda, p.stock_cedis
            FROM lista_espera le
            JOIN productos p ON p.id = le.id_producto
            ORDER BY le.creada_en DESC
            LIMIT 200
        `).all();
        // Agrupar por producto para el dashboard
        const porProducto = {};
        for (const r of rows) {
            if (!porProducto[r.producto]) {
                porProducto[r.producto] = {
                    nombre: r.producto, precio: r.price,
                    stock_tienda: r.stock_tienda, stock_cedis: r.stock_cedis,
                    esperas: []
                };
            }
            porProducto[r.producto].esperas.push(r);
        }
        return json(res, { lista: Object.values(porProducto), total: rows.length });
    }

    // ── PENDIENTE 3: Log de búsquedas ────────────────────────────────
    if (p === '/api/busquedas' && req.method === 'GET') {
        // `compra` (búsqueda -> pedido real, vía stockWatcher.actualizarComprasDesdeEventos)
        // todavía puede no existir en producción — cae a la query original sin ese dato.
        let rows;
        try {
            rows = db.prepare(`
                SELECT valor AS busqueda, COUNT(*) AS veces,
                       MAX(registrado_en) AS ultima_vez,
                       SUM(COALESCE(compro,0)) AS compras
                FROM log_eventos
                WHERE tipo_evento='busqueda'
                GROUP BY valor
                ORDER BY veces DESC
                LIMIT 50
            `).all();
        } catch (_) {
            rows = db.prepare(`
                SELECT valor AS busqueda, COUNT(*) AS veces,
                       MAX(registrado_en) AS ultima_vez
                FROM log_eventos
                WHERE tipo_evento='busqueda'
                GROUP BY valor
                ORDER BY veces DESC
                LIMIT 50
            `).all();
        }
        return json(res, rows);
    }

    // GET /api/metricas/campanas — conversión real (envío -> pedido dentro de
    // 7 días) por campaña de marketing (carrito abandonado, oferta por
    // vencer, reactivación de dormidos, etc.), via el tag `campana` en
    // cola_notificaciones. Defensivo: [] si la columna todavía no existe.
    if (p === '/api/metricas/campanas' && req.method === 'GET') {
        try {
            const rows = db.prepare(`
                SELECT cn.campana,
                       COUNT(DISTINCT cn.id) AS enviados,
                       COUNT(DISTINCT CASE WHEN p.id_pedido IS NOT NULL THEN cn.id END) AS convertidos
                FROM cola_notificaciones cn
                LEFT JOIN clientes c ON c.telefono = cn.destinatario
                LEFT JOIN pedidos p ON (p.id_cliente = c.id OR p.cliente = c.nombre)
                   AND p.creado_en BETWEEN cn.creada_en AND datetime(cn.creada_en, '+7 days')
                WHERE cn.campana IS NOT NULL AND cn.estatus='enviado'
                GROUP BY cn.campana ORDER BY convertidos DESC
            `).all();
            return json(res, rows);
        } catch (_) { return json(res, []); }
    }

    // GET /api/metricas/abandono-motivos — por qué los clientes no terminan
    // su compra (precio/envío/otro), capturado por bot/handlers/abandonoHandler.js.
    // Defensivo: [] si `carritos_abandonados.motivo` todavía no existe.
    if (p === '/api/metricas/abandono-motivos' && req.method === 'GET') {
        try {
            const rows = db.prepare(`
                SELECT motivo, COUNT(*) AS n
                FROM carritos_abandonados
                WHERE motivo IS NOT NULL
                GROUP BY motivo ORDER BY n DESC
            `).all();
            return json(res, rows);
        } catch (_) { return json(res, []); }
    }

    // ── Preventas ─────────────────────────────────────────────────────
    if (p === '/api/preventas' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT pv.*, pr.name AS nombre_producto, pr.price
            FROM preventas pv JOIN productos pr ON pr.id = pv.id_producto
            WHERE pv.activa=1 ORDER BY pv.id DESC
        `).all();
        return json(res, rows);
    }

    if (p === '/api/preventas' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), PreventaSchema, res, p);
                if (!datos) return;
                const { id_producto, nombre_preventa, fecha_llegada_est,
                        stock_maximo, precio_preventa, porcentaje_anticipo } = datos;
                if (!id_producto || !nombre_preventa || !fecha_llegada_est)
                    return json(res, { ok:false, error:'Faltan campos obligatorios' }, 400);
                const r = db.prepare(`
                    INSERT INTO preventas (id_producto, nombre_preventa, fecha_llegada_est,
                        stock_maximo, precio_preventa, porcentaje_anticipo, activa)
                    VALUES (?,?,?,?,?,?,1)
                `).run(id_producto, nombre_preventa, fecha_llegada_est,
                        stock_maximo||50, precio_preventa||0, porcentaje_anticipo||50);
                return json(res, { ok:true, id: r.lastInsertRowid });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // PUT /api/preventas/:id — marcar como llegada real
    return next();
};
