'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 1854-2016 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
module.exports = function primeUsuariosPuntosRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (p === '/api/prime/usuarios' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), UsuarioSchema, res, p);
                if (!datos) return;
                const { username, password, rol, nombre: nombreInput } = datos;
                const nombre = String(nombreInput || username || '').trim();
                if (!nombre) return json(res, { ok: false, error: 'username es obligatorio' }, 400);
                if (db.prepare('SELECT id FROM usuarios WHERE username=?').get(username)) {
                    return json(res, { ok: false, error: 'Ese usuario ya existe' }, 400);
                }
                const salt = crypto.randomBytes(16).toString('hex');
                const email = `${String(username).trim().toLowerCase()}@local`;
                const idRol = rol === 'prime' ? 2 : 1;
                const r = db.prepare('INSERT INTO usuarios (username, nombre, email, password_hash, id_rol, salt, rol) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run(username, nombre, email, hashPassword(password, salt), idRol, salt, rol);
                log.info('[prime] usuario creado: ' + username + ' (' + rol + ')');
                return json(res, { ok: true, id: r.lastInsertRowid, username, nombre, rol });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/usuarios\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), UsuarioUpdateSchema, res, p);
                if (!datos) return;
                const existente = db.prepare('SELECT id, rol FROM usuarios WHERE id=?').get(id);
                if (!existente) return json(res, { ok: false, error: 'Usuario no encontrado' }, 404);
                if (datos.rol && datos.rol !== 'prime' && existente.rol === 'prime') {
                    const otrosPrime = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol='prime' AND id!=?").get(id).n;
                    if (otrosPrime === 0) return json(res, { ok: false, error: 'No puedes quitarle el rol prime al único usuario prime' }, 400);
                }
                if (datos.nombre !== undefined) {
                    const nombre = String(datos.nombre || '').trim();
                    if (!nombre) return json(res, { ok: false, error: 'nombre no puede estar vacío' }, 400);
                    db.prepare('UPDATE usuarios SET nombre=? WHERE id=?').run(nombre, id);
                }
                if (datos.rol) db.prepare('UPDATE usuarios SET rol=? WHERE id=?').run(datos.rol, id);
                if (datos.password) {
                    const salt = crypto.randomBytes(16).toString('hex');
                    db.prepare('UPDATE usuarios SET password_hash=?, salt=? WHERE id=?').run(hashPassword(datos.password, salt), salt, id);
                }
                return json(res, { ok: true, id });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    if (req.method === 'DELETE' && p.match(/^\/api\/prime\/usuarios\/\d+$/)) {
        const ses = requireSession(req, res, ['prime']);
        if (!ses) return;
        const id = parseInt(p.split('/').pop());
        try {
            const existente = db.prepare('SELECT id, username, rol FROM usuarios WHERE id=?').get(id);
            if (!existente) return json(res, { ok: false, error: 'Usuario no encontrado' }, 404);
            if (existente.username === ses.username) return json(res, { ok: false, error: 'No puedes borrar tu propia cuenta' }, 400);
            if (existente.rol === 'prime') {
                const otrosPrime = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol='prime' AND id!=?").get(id).n;
                if (otrosPrime === 0) return json(res, { ok: false, error: 'No puedes borrar al único usuario prime' }, 400);
            }
            db.prepare('DELETE FROM usuarios WHERE id=?').run(id);
            return json(res, { ok: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // GET /api/puntos/ticket/:codigo — datos de un ticket específico
    if (p.startsWith('/api/puntos/ticket/') && req.method === 'GET') {
        const codigo = decodeURIComponent(p.split('/').pop()).toUpperCase();
        if (codigo === 'RANDOM') {
            // Ticket aleatorio disponible (no reclamado, no expirado)
            const t = db.prepare(`
                SELECT * FROM tickets_venta
                WHERE codigo_qr LIKE 'TK-%'
                  AND puntos_reclamados = 0
                  AND datetime(expira_reclamo_en) > datetime('now','localtime')
                ORDER BY RANDOM() LIMIT 1
            `).get();
            return json(res, t || {});
        }
        const t = db.prepare(`SELECT * FROM tickets_venta WHERE codigo_qr=? LIMIT 1`).get(codigo);
        // Agregar número del bot para el QR
        const telefonoBot = (process.env.ASESOR_WHATSAPP || '').replace(/[^0-9]/g, '');
        return json(res, t ? { ...t, telefono_bot: telefonoBot } : {});
    }

    // GET /api/puntos/usados — últimos 20 tickets reclamados
    if (p === '/api/puntos/usados' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT codigo_qr, total, puntos_otorgados, telefono_cliente, reclamado_en
            FROM tickets_venta
            WHERE puntos_reclamados = 1
            ORDER BY reclamado_en DESC LIMIT 20
        `).all();
        return json(res, rows);
    }

    // GET /api/puntos/config — ver estado del sistema de lealtad
    if (p === '/api/puntos/config' && req.method === 'GET') {
        let activo = true;
        try {
            const r = db.prepare("SELECT valor FROM configuracion WHERE clave='puntos_activo' LIMIT 1").get();
            activo = !r || r.valor !== '0';
        } catch(e) { log.debug('No se pudo leer puntos_activo: ' + e.message); }
        return json(res, { puntos_activo: activo });
    }

    // POST /api/puntos/config — habilitar o deshabilitar cualquier módulo
    // Body: { activo: true | false } o { clave: 'nombre_modulo', activo: true | false }
    if (p === '/api/puntos/config' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), ModuloConfigSchema, res, p);
                if (!datos) return;
                const { clave, activo } = datos;
                db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime(\'now\',\'localtime\'))').run(clave, activo ? '1' : '0');
                log.info('Módulo ' + clave + ': ' + (activo ? 'ACTIVADO' : 'DESACTIVADO'));
                return json(res, { ok: true, clave, activo });
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET /api/puntos/ranking — top clientes por puntos
    // (debe ir antes del catch-all /api/puntos/:telefono de abajo, que de
    // otro modo intercepta "ranking" como si fuera un número de teléfono)
    if (p === '/api/puntos/ranking' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT c.nombre, c.telefono,
                   pc.puntos_ganados, pc.puntos_canjeados,
                   (pc.puntos_ganados - pc.puntos_canjeados) AS disponibles,
                   pc.ultimo_movimiento
            FROM puntos_cliente pc JOIN clientes c ON c.id = pc.id_cliente
            ORDER BY disponibles DESC LIMIT 20
        `).all();
        return json(res, rows);
    }

    // GET /api/puntos/:telefono — consultar saldo de un cliente
    if (p.startsWith('/api/puntos/') && req.method === 'GET') {
        const tel = decodeURIComponent(p.split('/').pop());
        try {
            const puntosService = require('../bot/handlers/puntosService');
            const saldo = puntosService.consultarSaldo(tel);
            return json(res, saldo || { disponibles: 0, puntos: 0 });
        } catch(e) { return json(res, { error: e.message }, 500); }
    }

    // POST /api/puntos/preparar — asignar código QR a un ticket al cerrar venta
    // Body: { id_ticket, total, telefono_cliente }
    if (p === '/api/puntos/preparar' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { id_ticket, total, telefono_cliente } = JSON.parse(body);
                if (!id_ticket || !total) return json(res, { ok: false, error: 'Faltan id_ticket y total' }, 400);
                const puntosService = require('../bot/handlers/puntosService');
                const r = puntosService.prepararTicket(id_ticket, total, telefono_cliente);
                return json(res, r);
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    return next();
};
