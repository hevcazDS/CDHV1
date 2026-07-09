'use strict';
// PIN de autorización (administrador/prime lo configuran) y ZONA DE PELIGRO
// de prime: reset total de la instancia (deja la tienda limpia y reabre el
// onboarding). El respaldo manual también es prime-only.
const autorizacion = require('../autorizacion');

const TABLAS_RESET = [
    // operación
    'pedido_detalle', 'links_pago', 'guias_estafeta', 'devoluciones', 'pedidos',
    'carritos_abandonados', 'cola_atencion', 'conversaciones', 'mensajes',
    'cola_notificaciones', 'cola_emails', 'valoraciones', 'log_eventos',
    'lista_espera', 'alertas_reabasto', 'preventa_clientes', 'preventas',
    'sesiones_bot', 'chats_iniciados', 'puntos_cliente', 'regalos_lealtad',
    'promociones', 'tickets_venta', 'clientes',
    // catálogo e inventario
    'ubicaciones_inventario', 'inventario_movimientos', 'inventarios',
    'productos_similares', 'productos', 'categorias', 'sucursales',
    // ERP
    'asientos_detalle', 'asientos', 'cuentas_pagar', 'ordenes_compra_detalle',
    'ordenes_compra', 'proveedores', 'historial_costos', 'solicitudes_compra',
    'cortes_caja', 'nominas', 'horarios_empleado', 'empleados',
    'vision_revisiones', 'metodos_pago', 'series_folios', 'contadores_caso',
];

module.exports = function seguridadOperativaRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession, log, hashPassword, safeEqual, pm2 } = ctx;

    // GET estado del PIN (¿hay uno configurado?)
    if (p === '/api/autorizacion/pin' && req.method === 'GET') {
        if (!requireSession(req, res)) return;
        return json(res, { configurado: autorizacion.hayPin(db) });
    }
    // PUT: configurar/cambiar el PIN — administrador y prime
    if (p === '/api/autorizacion/pin' && req.method === 'PUT') {
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                autorizacion.setPin(db, JSON.parse(body || '{}').pin);
                log.info('[seguridad] PIN de autorización actualizado');
                return json(res, { ok: true });
            } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
        });
    }

    // ZONA DE PELIGRO — prime re-valida su contraseña + texto BORRAR.
    // Borra TODO lo operativo, conserva solo usuarios prime y reabre onboarding.
    if (p === '/api/prime/reset-instancia' && req.method === 'POST') {
        const ses = requireSession(req, res, ['prime']);
        if (!ses) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                if (String(d.confirmacion || '').toUpperCase() !== 'BORRAR') {
                    return json(res, { ok: false, error: 'Escribe BORRAR para confirmar' }, 400);
                }
                const yo = db.prepare('SELECT * FROM usuarios WHERE username=?').get(ses.username);
                if (!yo || !safeEqual(hashPassword(String(d.password || ''), yo.salt), yo.password_hash)) {
                    return json(res, { ok: false, error: 'Contraseña incorrecta' }, 401);
                }
                let borradas = 0;
                db.pragma('foreign_keys = OFF');
                try {
                    db.transaction(() => {
                        // bypass de los triggers de inmutabilidad (0030)
                        try { db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('mantenimiento_bd','1') ON CONFLICT(clave) DO UPDATE SET valor='1'").run(); } catch (_) {}
                        for (const t of TABLAS_RESET) {
                            try { db.prepare('DELETE FROM ' + t).run(); borradas++; } catch (_) {}
                        }
                        try { db.prepare("DELETE FROM configuracion WHERE clave='mantenimiento_bd'").run(); } catch (_) {}
                        db.prepare("DELETE FROM usuarios WHERE rol != 'prime'").run();
                        db.prepare("DELETE FROM configuracion").run();
                    })();
                } finally { db.pragma('foreign_keys = ON'); }
                log.warn('[PELIGRO] Instancia reseteada por ' + ses.username + ' (' + borradas + ' tablas)');
                return json(res, { ok: true, tablas: borradas, msg: 'Instancia limpia. El onboarding se reabrirá para crear la tienda de cero.' });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // Respaldo manual — prime-only (administrador NO)
    if (p === '/api/prime/respaldo-manual' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            require('child_process').execFile(process.execPath, [require('path').join(__dirname, '..', '..', 'scripts', 'backup.js'), 'db'], { timeout: 120000 },
                (err) => log[err ? 'warn' : 'info']('[respaldo manual] ' + (err ? err.message : 'enviado')));
            return json(res, { ok: true, msg: 'Respaldo en proceso — llegará al correo configurado' });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // POST /api/prime/whatsapp/purgar-sesion — borra .wwebjs_auth/.wwebjs_cache
    // (HS-503: sesión corrupta o en conflicto). Prime + contraseña + 'BORRAR'.
    // Desvincula el número: el siguiente arranque pide QR limpio.
    if (p === '/api/prime/whatsapp/purgar-sesion' && req.method === 'POST') {
        const sesW = requireSession(req, res, ['prime']);
        if (!sesW) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                if (d.confirmacion !== 'BORRAR') return json(res, { ok: false, error: "Escribe BORRAR en 'confirmacion'" }, 400);
                const u = db.prepare('SELECT * FROM usuarios WHERE username=?').get(sesW.username);
                if (!u || hashPassword(String(d.password || ''), u.salt) !== u.password_hash) {
                    return json(res, { ok: false, error: 'Contraseña incorrecta' }, 403);
                }
                log.warn('[HS-503] Purga de sesión de WhatsApp solicitada por ' + sesW.username);
                pm2(['stop', 'bot-whatsapp'], () => {
                    const fs = require('fs');
                    const path = require('path');
                    let borrados = [];
                    for (const dir of ['.wwebjs_auth', '.wwebjs_cache']) {
                        const ruta = path.join(__dirname, '..', '..', dir);
                        try {
                            if (fs.existsSync(ruta)) { fs.rmSync(ruta, { recursive: true, force: true }); borrados.push(dir); }
                        } catch (e) { log.error('[HS-503] No se pudo borrar ' + dir + ': ' + e.message); }
                    }
                    try { db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('bot_estado_deseado','0') ON CONFLICT(clave) DO UPDATE SET valor='0'").run(); } catch (_) {}
                    try { db.prepare("DELETE FROM configuracion WHERE clave='whatsapp_qr'").run(); } catch (_) {}
                    return json(res, { ok: true, borrados, nota: 'Sesión purgada. Enciende el bot y escanea el QR limpio.' });
                });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    return next();
};
