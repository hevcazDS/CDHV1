'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 399-573 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function coreRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, cerrarElectronSiAbierto, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, SESSION_TTL_MS_RECORDAR, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    // POST /api/login {username, password} — reemplaza el pop-up de Basic Auth
    if (p === '/api/login' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { username, password, recordar } = JSON.parse(body || '{}');
                const uname = String(username || '');
                if (loginBloqueado(uname)) {
                    return json(res, { ok: false, error: 'Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intenta de nuevo en unos minutos.' }, 429);
                }
                const u2 = db.prepare('SELECT * FROM usuarios WHERE username=?').get(uname);
                if (!u2 || !safeEqual(hashPassword(String(password || ''), u2.salt), u2.password_hash)) {
                    registrarIntentoFallido(uname);
                    return json(res, { ok: false, error: 'Usuario o contraseña incorrectos' }, 401);
                }
                limpiarIntentosLogin(uname);
                const ttlMs = recordar ? SESSION_TTL_MS_RECORDAR : SESSION_TTL_MS;
                const token = crearSesion(u2.username, u2.rol, ttlMs);
                res.setHeader('Set-Cookie', `jc_session=${token}; HttpOnly; SameSite=Lax${COOKIE_SECURE_FLAG}; Max-Age=${ttlMs / 1000}; Path=/`);
                return json(res, { ok: true, username: u2.username, rol: u2.rol });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // POST /api/logout
    if (p === '/api/logout' && req.method === 'POST') {
        const s = obtenerSesion(req);
        if (s) eliminarSesion(s.token);
        res.setHeader('Set-Cookie', `jc_session=; HttpOnly; SameSite=Lax${COOKIE_SECURE_FLAG}; Max-Age=0; Path=/`);
        return json(res, { ok: true });
    }

    // GET /api/me — quién soy / si mi sesión sigue viva (para el shell de React)
    if (p === '/api/me' && req.method === 'GET') {
        const s = obtenerSesion(req);
        if (!s) return json(res, { ok: false }, 401);
        return json(res, { ok: true, username: s.username, rol: s.rol });
    }

    // GET /api/pedidos
    if (p === '/api/pedidos' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT p.id_pedido, p.folio, p.cliente, p.estatus, p.ciudad_envio,
                   p.email_notificado, p.creado_en,
                   p.metodo_entrega, p.repartidor_nombre, p.repartidor_telefono,
                   lp.id AS id_link_pago, lp.monto AS total, lp.estatus AS pago_estatus, lp.url_link,
                   g.numero_guia, g.estatus AS guia_estatus,
                   g.fecha_envio_est, g.fecha_entrega_est
            FROM pedidos p
            LEFT JOIN links_pago lp ON lp.id_pedido = p.id_pedido
            LEFT JOIN guias_estafeta g ON g.id_pedido = p.id_pedido
            ORDER BY p.id_pedido DESC LIMIT 100
        `).all();
        return json(res, rows);
    }

    // GET /api/clientes
    if (p === '/api/clientes' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const q   = (_u.searchParams.get('q')  ||'').trim();
        const tag = (_u.searchParams.get('tag') ||'').trim();
        let sql = "SELECT id, nombre, telefono, email, canal_origen, creado_en, ultima_actividad, codigo_referido, COALESCE(tags,'') AS tags FROM clientes WHERE activo=1";
        const params = [];
        if (q)   { sql += ' AND (nombre LIKE ? OR telefono LIKE ?)'; params.push('%'+q+'%','%'+q+'%'); }
        if (tag) { sql += " AND COALESCE(tags,'') LIKE ?"; params.push('%'+tag+'%'); }
        sql += ' ORDER BY ultima_actividad DESC, creado_en DESC LIMIT 300';
        const rows = db.prepare(sql).all(...params);
        // Backfill perezoso: clientes creados antes del programa de referidos
        // (o por una vía que no sea el primer-contacto) aún no tienen código —
        // se genera aquí mismo para que el asesor siempre tenga uno que mencionar.
        const { asegurarCodigoReferido } = require('../../bot/handlers/referidosService');
        for (const r of rows) {
            if (!r.codigo_referido) r.codigo_referido = asegurarCodigoReferido(r.id);
        }
        return json(res, rows);
    }

    // GET /api/guias
    if (p === '/api/guias' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT g.*, p.cliente, p.ciudad_envio
            FROM guias_estafeta g
            JOIN pedidos p ON p.id_pedido = g.id_pedido
            ORDER BY g.id DESC LIMIT 100
        `).all();
        return json(res, rows);
    }

    // GET /api/stats
    if (p === '/api/stats' && req.method === 'GET') {
        const stats = {
            pedidos_hoy: db.prepare("SELECT COUNT(*) c FROM pedidos WHERE date(creado_en)=date('now','localtime')").get()?.c || 0,
            pedidos_total: db.prepare("SELECT COUNT(*) c FROM pedidos").get()?.c || 0,
            clientes_total: db.prepare("SELECT COUNT(*) c FROM clientes WHERE activo=1").get()?.c || 0,
            guias_total: db.prepare("SELECT COUNT(*) c FROM guias_estafeta").get()?.c || 0,
            pagos_pendientes: db.prepare("SELECT COUNT(*) c FROM links_pago WHERE estatus='generado'").get()?.c || 0,
            pagos_pagados: db.prepare("SELECT COUNT(*) c FROM links_pago WHERE estatus='pagado'").get()?.c || 0,
            // Ventas cobradas hoy ($): suma de links de pago marcados pagados
            // con fecha de pago de hoy. KPI central para la operación diaria.
            ventas_hoy: db.prepare("SELECT COALESCE(SUM(monto),0) s FROM links_pago WHERE estatus='pagado' AND date(pagado_en)=date('now','localtime')").get()?.s || 0,
            pedidos_pagados_hoy: db.prepare("SELECT COUNT(*) c FROM links_pago WHERE estatus='pagado' AND date(pagado_en)=date('now','localtime')").get()?.c || 0,
            cola_atencion: db.prepare("SELECT COUNT(*) c FROM cola_atencion WHERE estatus='en_espera'").get()?.c || 0,
            // cola_notificaciones (WhatsApp) ya tiene su propia página dedicada
            // (ColaEnvios.jsx); cola_emails nunca tuvo ninguna — un correo de
            // confirmación de pedido podía fallar en silencio sin que el
            // operador tuviera forma de notarlo desde el dashboard.
            emails_error: db.prepare("SELECT COUNT(*) c FROM cola_emails WHERE estatus='error'").get()?.c || 0,
        };
        return json(res, stats);
    }

    // GET /api/bot/status — estado real del proceso bot-whatsapp en PM2
    if (p === '/api/bot/status' && req.method === 'GET') {
        pm2(['jlist'], (err, stdout) => {
            if (err) return json(res, { ok:false, error:'pm2 no disponible: ' + err.message }, 500);
            try {
                const lista = JSON.parse(stdout);
                const proc = lista.find(p2 => p2.name === 'bot-whatsapp');
                if (!proc) {
                    registrarCambioEstatusBot('no_iniciado', null);
                    return json(res, { ok:true, registrado:false, estatus:'no_iniciado' });
                }
                const estatus = proc.pm2_env?.status || 'desconocido';
                registrarCambioEstatusBot(estatus, null);
                // stockwatcher_modo lo escribe bot/index.js (proceso separado) en
                // `configuracion` — 'fork' es lo sano, 'in-process'/'caido' indican
                // que los checks de stock/marketing dejaron de correr aislados.
                let stockwatcherModo = null;
                try {
                    stockwatcherModo = db.prepare("SELECT valor FROM configuracion WHERE clave='stockwatcher_modo'").get()?.valor || null;
                } catch (_) {}
                return json(res, {
                    ok:true, registrado:true,
                    estatus,
                    uptime_ms:  proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
                    reinicios:  proc.pm2_env?.restart_time || 0,
                    memoria_mb: proc.monit?.memory ? Math.round(proc.monit.memory / 1024 / 1024) : 0,
                    stockwatcher_modo: stockwatcherModo,
                });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
        return;
    }

    // GET /api/bot/status-history — últimos cambios de estatus, para el
    // widget del header (qué pasó, no solo "inactivo" a secas)
    if (p === '/api/bot/status-history' && req.method === 'GET') {
        const rows = db.prepare('SELECT estatus, motivo, registrado_en FROM bot_status_log ORDER BY id DESC LIMIT 50').all();
        return json(res, rows);
    }

    // GET /api/bot/qr — QR de WhatsApp pendiente de escanear, si hay uno.
    // bot/index.js (proceso separado, sin IPC) lo publica en `configuracion`
    // en cada evento 'qr' y lo limpia al autenticar — antes el único lugar
    // donde aparecía era la terminal del proceso pm2, invisible desde aquí.
    if (p === '/api/bot/qr' && req.method === 'GET') {
        let fila = null;
        try {
            fila = db.prepare("SELECT valor, actualizado_en FROM configuracion WHERE clave='whatsapp_qr'").get();
        } catch (_) {}
        return json(res, { qr: fila?.valor || null, actualizado_en: fila?.actualizado_en || null });
    }

    // POST /api/bot/start — enciende solo bot-whatsapp (no toca el dashboard)
    if (p === '/api/bot/start' && req.method === 'POST') {
        pm2(['start', ECOSYSTEM_PATH, '--only', 'bot-whatsapp'], (err, stdout, stderr) => {
            if (err) return json(res, { ok:false, error: stderr || err.message }, 500);
            registrarCambioEstatusBot('online', 'iniciado manualmente desde el dashboard');
            return json(res, { ok:true, estatus:'iniciado' });
        });
        return;
    }

    // POST /api/bot/stop
    if (p === '/api/bot/stop' && req.method === 'POST') {
        pm2(['stop', 'bot-whatsapp'], (err, stdout, stderr) => {
            if (err) return json(res, { ok:false, error: stderr || err.message }, 500);
            registrarCambioEstatusBot('stopped', 'detenido manualmente desde el dashboard');
            return json(res, { ok:true, estatus:'detenido' });
        });
        return;
    }

    // POST /api/bot/restart — cierra la ventana de Electron existente antes de
    // pedirle a pm2 que reinicie: bot/index.js ya la reabre sola en su
    // arranque, así que el operador siempre ve una ventana fresca tras
    // reiniciar, sin que el dashboard mismo se vea afectado (pm2 solo toca
    // bot-whatsapp, nunca el proceso 'dashboard').
    if (p === '/api/bot/restart' && req.method === 'POST') {
        cerrarElectronSiAbierto(() => {
            pm2(['restart', 'bot-whatsapp'], (err, stdout, stderr) => {
                if (err) return json(res, { ok:false, error: stderr || err.message }, 500);
                registrarCambioEstatusBot('online', 'reiniciado manualmente desde el dashboard');
                return json(res, { ok:true, estatus:'reiniciado' });
            });
        });
        return;
    }

    // POST /api/notificar — enviar mensaje de estatus a un cliente
    return next();
};
