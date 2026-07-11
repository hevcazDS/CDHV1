'use strict';
// Núcleo del dashboard: buscador global, AUTH (login/logout/me), listados
// (pedidos/clientes/guías), stats y control del proceso bot en PM2.
// Migrado al patrón declarativo del tronco:
//   - login/logout/me caen al gate global (están en la whitelist pública de
//     server.js, por eso se alcanzan SIN sesión; la lógica de sesión vive en
//     el handler).
//   - buscar/pedidos/guias/stats → gate global (cualquier sesión).
//   - clientes y todo /api/bot/* → area:'operacion' (defensa en profundidad;
//     el widget del bot ya se oculta para no-operacion en el front).
// Sin opts.prefijo: agrupa muchos prefijos distintos.
const { permite, rangoDe } = require('../permisos');
const construirModulo = require('./_construirModulo');

// GET /api/buscar?q= — buscador global del topbar (handler ÚNICO; antes había
// una copia en atencionCliente que nunca se alcanzaba — colisión consolidada).
function buscar(req, res, ctx) {
    const { db, json } = ctx;
    const q = ((new URL(req.url, 'http://x')).searchParams.get('q') || '').trim();
    if (q.length < 2) return json(res, { clientes: [], pedidos: [], productos: [], guias: [] });
    const like = '%' + q + '%';
    const clientes = db.prepare("SELECT id, nombre, telefono FROM clientes WHERE activo=1 AND (nombre LIKE ? OR telefono LIKE ?) ORDER BY id DESC LIMIT 5").all(like, like);
    const pedidos = db.prepare("SELECT id_pedido, folio, cliente, estatus, total, creado_en FROM pedidos WHERE folio LIKE ? OR cliente LIKE ? ORDER BY id_pedido DESC LIMIT 5").all(like, like);
    const productos = db.prepare("SELECT id, name, price FROM productos WHERE activo=1 AND name LIKE ? LIMIT 5").all(like);
    let guias = [];
    try { guias = db.prepare("SELECT numero_guia, estatus, dest_nombre, dest_ciudad FROM guias_estafeta WHERE numero_guia LIKE ? OR dest_nombre LIKE ? LIMIT 5").all(like, like); } catch (_) {}
    return json(res, { clientes, pedidos, productos, guias });
}

// POST /api/login {username, password} — pública (whitelist). Crea sesión.
function login(req, res, ctx) {
    const { db, json, readBody, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, crearSesion, SESSION_TTL_MS, SESSION_TTL_MS_RECORDAR, COOKIE_SECURE_FLAG } = ctx;
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

// POST /api/logout — pública (whitelist)
function logout(req, res, ctx) {
    const { json, obtenerSesion, eliminarSesion, COOKIE_SECURE_FLAG } = ctx;
    const s = obtenerSesion(req);
    if (s) eliminarSesion(s.token);
    res.setHeader('Set-Cookie', `jc_session=; HttpOnly; SameSite=Lax${COOKIE_SECURE_FLAG}; Max-Age=0; Path=/`);
    return json(res, { ok: true });
}

// GET /api/me — quién soy / sesión viva (pública; el handler decide 401)
function me(req, res, ctx) {
    const { json, obtenerSesion } = ctx;
    const s = obtenerSesion(req);
    if (!s) return json(res, { ok: false }, 401);
    return json(res, { ok: true, username: s.username, rol: s.rol, version: ctx.APP_VERSION });
}

// GET /api/pedidos
function pedidos(req, res, ctx) {
    const { db, json } = ctx;
    const rows = db.prepare(`
        SELECT p.id_pedido, p.folio, p.cliente, p.estatus, p.ciudad_envio,
               p.email_notificado, p.creado_en, p.a_credito, p.cobrado_por,
               p.metodo_entrega, p.repartidor_nombre, p.repartidor_telefono,
               lp.id AS id_link_pago, lp.monto AS total, lp.estatus AS pago_estatus, lp.url_link,
               g.numero_guia, g.estatus AS guia_estatus, g.fecha_envio_est, g.fecha_entrega_est
        FROM pedidos p
        LEFT JOIN links_pago lp ON lp.id_pedido = p.id_pedido
        LEFT JOIN guias_estafeta g ON g.id_pedido = p.id_pedido
        ORDER BY p.id_pedido DESC LIMIT 100`).all();
    return json(res, rows);
}

// GET /api/clientes — lista (area 'operacion', alineado con la página Clientes)
function clientes(req, res, ctx) {
    const { db, json } = ctx;
    const _u = new URL('http://x' + req.url);
    const q = (_u.searchParams.get('q') || '').trim();
    const tag = (_u.searchParams.get('tag') || '').trim();
    let sql = "SELECT id, nombre, telefono, email, canal_origen, creado_en, ultima_actividad, codigo_referido, COALESCE(tags,'') AS tags FROM clientes WHERE activo=1";
    const params = [];
    if (q) { sql += ' AND (nombre LIKE ? OR telefono LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); }
    if (tag) { sql += " AND COALESCE(tags,'') LIKE ?"; params.push('%' + tag + '%'); }
    sql += ' ORDER BY ultima_actividad DESC, creado_en DESC LIMIT 300';
    const rows = db.prepare(sql).all(...params);
    // Backfill perezoso del código de referido para clientes previos al programa.
    const { asegurarCodigoReferido } = require('../../bot/handlers/referidosService');
    for (const r of rows) { if (!r.codigo_referido) r.codigo_referido = asegurarCodigoReferido(r.id); }
    return json(res, rows);
}

// GET /api/guias
function guias(req, res, ctx) {
    const { db, json } = ctx;
    const rows = db.prepare(`
        SELECT g.*, p.cliente, p.ciudad_envio FROM guias_estafeta g
        JOIN pedidos p ON p.id_pedido = g.id_pedido ORDER BY g.id DESC LIMIT 100`).all();
    return json(res, rows);
}

// GET /api/stats — KPIs de operación (Inicio)
function stats(req, res, ctx) {
    const { db, json } = ctx;
    const st = {
        pedidos_hoy: db.prepare("SELECT COUNT(*) c FROM pedidos WHERE date(creado_en)=date('now','localtime')").get()?.c || 0,
        pedidos_total: db.prepare("SELECT COUNT(*) c FROM pedidos").get()?.c || 0,
        clientes_total: db.prepare("SELECT COUNT(*) c FROM clientes WHERE activo=1").get()?.c || 0,
        guias_total: db.prepare("SELECT COUNT(*) c FROM guias_estafeta").get()?.c || 0,
        pagos_pendientes: db.prepare("SELECT COUNT(*) c FROM links_pago WHERE estatus='generado'").get()?.c || 0,
        pagos_pagados: db.prepare("SELECT COUNT(*) c FROM links_pago WHERE estatus='pagado'").get()?.c || 0,
        ventas_hoy: db.prepare("SELECT COALESCE(SUM(monto),0) s FROM links_pago WHERE estatus='pagado' AND date(pagado_en)=date('now','localtime')").get()?.s || 0,
        pedidos_pagados_hoy: db.prepare("SELECT COUNT(*) c FROM links_pago WHERE estatus='pagado' AND date(pagado_en)=date('now','localtime')").get()?.c || 0,
        cola_atencion: db.prepare("SELECT COUNT(*) c FROM cola_atencion WHERE estatus='en_espera'").get()?.c || 0,
        emails_error: db.prepare("SELECT COUNT(*) c FROM cola_emails WHERE estatus='error'").get()?.c || 0,
        chats_hoy: (() => { try { return db.prepare("SELECT COUNT(*) c FROM chats_iniciados WHERE fecha=date('now','localtime')").get()?.c || 0; } catch (_) { return 0; } })(),
        chats_30d: (() => { try { return db.prepare("SELECT COUNT(*) c FROM chats_iniciados WHERE fecha >= date('now','-30 days','localtime')").get()?.c || 0; } catch (_) { return 0; } })(),
        clientes_nuevos_30d: db.prepare("SELECT COUNT(*) c FROM clientes WHERE activo=1 AND datetime(creado_en) >= datetime('now','-30 days','localtime')").get()?.c || 0,
    };
    try {
        st.marketing = {
            abandonados_n: db.prepare('SELECT COUNT(*) c FROM carritos_abandonados WHERE convertido=0').get()?.c || 0,
            abandonados_monto: (() => {
                try {
                    return db.prepare(`SELECT COALESCE(SUM(json_extract(j.value,'$.price') * COALESCE(json_extract(j.value,'$.cantidad'),1)),0) s
                        FROM carritos_abandonados ca, json_each(ca.carrito_json) j WHERE ca.convertido=0`).get()?.s || 0;
                } catch (_) { return 0; }
            })(),
            motivo_top: db.prepare("SELECT motivo, COUNT(*) c FROM carritos_abandonados WHERE convertido=0 AND motivo IS NOT NULL AND motivo!='' GROUP BY motivo ORDER BY c DESC LIMIT 1").get() || null,
            recuperados_30d: db.prepare("SELECT COUNT(*) c FROM carritos_abandonados WHERE convertido=1 AND datetime(COALESCE(convertido_en, abandonado_en)) >= datetime('now','-30 days','localtime')").get()?.c || 0,
            busquedas_30d: db.prepare("SELECT COUNT(*) c FROM log_eventos WHERE tipo_evento='busqueda'").get()?.c || 0,
            pagos_30d: db.prepare("SELECT COUNT(*) c FROM log_eventos WHERE tipo_evento='pago_confirmado'").get()?.c || 0,
        };
    } catch (_) { st.marketing = null; }
    return json(res, st);
}

// GET /api/bot/status — estado real del proceso bot-whatsapp en PM2 (async)
function botStatus(req, res, ctx) {
    const { db, json, pm2, registrarCambioEstatusBot } = ctx;
    pm2(['jlist'], (err, stdout) => {
        if (err) return json(res, { ok: false, error: 'pm2 no disponible: ' + err.message }, 500);
        try {
            const lista = JSON.parse(stdout);
            const proc = lista.find(p2 => p2.name === 'bot-whatsapp');
            if (!proc) {
                registrarCambioEstatusBot('no_iniciado', null);
                return json(res, { ok: true, registrado: false, estatus: 'no_iniciado' });
            }
            const estatus = proc.pm2_env?.status || 'desconocido';
            registrarCambioEstatusBot(estatus, null);
            let stockwatcherModo = null;
            try { stockwatcherModo = db.prepare("SELECT valor FROM configuracion WHERE clave='stockwatcher_modo'").get()?.valor || null; } catch (_) {}
            return json(res, {
                ok: true, registrado: true, estatus,
                uptime_ms: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
                reinicios: proc.pm2_env?.restart_time || 0,
                memoria_mb: proc.monit?.memory ? Math.round(proc.monit.memory / 1024 / 1024) : 0,
                stockwatcher_modo: stockwatcherModo,
            });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/bot/status-history — timeline de cambios de estatus (widget header)
function botStatusHistory(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, db.prepare('SELECT estatus, motivo, registrado_en FROM bot_status_log ORDER BY id DESC LIMIT 50').all());
}

// GET /api/bot/qr — QR de WhatsApp pendiente (bot/index.js lo publica en config)
function botQr(req, res, ctx) {
    const { db, json } = ctx;
    let fila = null;
    try { fila = db.prepare("SELECT valor, actualizado_en FROM configuracion WHERE clave='whatsapp_qr'").get(); } catch (_) {}
    return json(res, { qr: fila?.valor || null, actualizado_en: fila?.actualizado_en || null });
}

// POST /api/bot/start — enciende solo bot-whatsapp (async)
function botStart(req, res, ctx) {
    const { db, json, pm2, ECOSYSTEM_PATH, registrarCambioEstatusBot } = ctx;
    pm2(['start', ECOSYSTEM_PATH, '--only', 'bot-whatsapp'], (err, stdout, stderr) => {
        if (err) return json(res, { ok: false, error: stderr || err.message }, 500);
        try { db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('bot_estado_deseado','1') ON CONFLICT(clave) DO UPDATE SET valor='1'").run(); } catch (_) {}
        registrarCambioEstatusBot('online', 'iniciado manualmente desde el dashboard');
        return json(res, { ok: true, estatus: 'iniciado' });
    });
}

// POST /api/bot/stop (async)
function botStop(req, res, ctx) {
    const { db, json, pm2, registrarCambioEstatusBot } = ctx;
    pm2(['stop', 'bot-whatsapp'], (err, stdout, stderr) => {
        if (err) return json(res, { ok: false, error: stderr || err.message }, 500);
        try { db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('bot_estado_deseado','0') ON CONFLICT(clave) DO UPDATE SET valor='0'").run(); } catch (_) {}
        registrarCambioEstatusBot('stopped', 'detenido manualmente desde el dashboard');
        return json(res, { ok: true, estatus: 'detenido' });
    });
}

// POST /api/bot/restart — cierra la ventana Electron y reinicia bot-whatsapp (async)
function botRestart(req, res, ctx) {
    const { json, pm2, cerrarElectronSiAbierto, registrarCambioEstatusBot } = ctx;
    cerrarElectronSiAbierto(() => {
        pm2(['restart', 'bot-whatsapp'], (err, stdout, stderr) => {
            if (err) return json(res, { ok: false, error: stderr || err.message }, 500);
            registrarCambioEstatusBot('online', 'reiniciado manualmente desde el dashboard');
            return json(res, { ok: true, estatus: 'reiniciado' });
        });
    });
}

// POST /api/bot/bridge/restart — reinicio del bridge WhatsApp. area:'operacion'
// MÁS check fino: Prime/Administrador/Operador (auditor, ya bloqueado global, fuera).
function botBridgeRestart(req, res, ctx, { ses }) {
    const { json, pm2, cerrarElectronSiAbierto, registrarCambioEstatusBot, log } = ctx;
    if (rangoDe(ses.rol) < 2 && !['operador', 'usuario'].includes(ses.rol)) {
        return json(res, { ok: false, error: 'Reiniciar el bridge es de Prime/Administrador/Operador' }, 403);
    }
    log.warn('[HS-502] Reinicio de bridge solicitado por ' + ses.username);
    cerrarElectronSiAbierto(() => {
        pm2(['restart', 'bot-whatsapp'], (err, stdout, stderr) => {
            if (err) return json(res, { ok: false, error: '[HS-502] ' + (stderr || err.message) }, 500);
            registrarCambioEstatusBot('online', '[HS-502] bridge reiniciado por ' + ses.username);
            return json(res, { ok: true, estatus: 'bridge reiniciado' });
        });
    });
}

// Orden: rutas exactas; /api/bot/status ANTES de status-history (ambas exactas,
// sin colisión por ser strings distintos, pero se listan juntas por claridad).
const RUTAS = [
    { metodo: 'GET',  path: '/api/buscar',                 handler: buscar },
    { metodo: 'POST', path: '/api/login',                  handler: login },
    { metodo: 'POST', path: '/api/logout',                 handler: logout },
    { metodo: 'GET',  path: '/api/me',                     handler: me },
    { metodo: 'GET',  path: '/api/pedidos',                handler: pedidos },
    { metodo: 'GET',  path: '/api/clientes',               area: 'operacion', handler: clientes },
    { metodo: 'GET',  path: '/api/guias',                  handler: guias },
    { metodo: 'GET',  path: '/api/stats',                  handler: stats },
    { metodo: 'GET',  path: '/api/bot/status',             area: 'operacion', handler: botStatus },
    { metodo: 'GET',  path: '/api/bot/status-history',     area: 'operacion', handler: botStatusHistory },
    { metodo: 'GET',  path: '/api/bot/qr',                 area: 'operacion', handler: botQr },
    { metodo: 'POST', path: '/api/bot/start',              area: 'operacion', handler: botStart },
    { metodo: 'POST', path: '/api/bot/stop',               area: 'operacion', handler: botStop },
    { metodo: 'POST', path: '/api/bot/restart',            area: 'operacion', handler: botRestart },
    { metodo: 'POST', path: '/api/bot/bridge/restart',     area: 'operacion', handler: botBridgeRestart },
];

module.exports = construirModulo(RUTAS);
