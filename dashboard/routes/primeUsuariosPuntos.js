'use strict';
// Extraído mecánicamente de dashboard/server.js (líneas 1854-2016 del
// monolito original) — fase 4 del hardening, item de partir server.js en
// módulos. NINGUNA línea de lógica fue reescrita, solo movida; ctx trae todo
// lo que este rango referenciaba como variable de módulo en el archivo
// original (ver dashboard/server.js para la construcción de ctx).
const { rangoDe, ROLES_CREABLES_POR_GERENTE } = require('../permisos');

module.exports = function primeUsuariosPuntosRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, validar, requireSession, log, pm2, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema } = ctx;
    if (p === '/api/prime/usuarios' && req.method === 'POST') {
        const sesU = requireSession(req, res, ['gerente']);
        if (!sesU) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), UsuarioSchema, res, p);
                if (!datos) return;
                // Administrador solo crea roles POR DEBAJO de su jerarquía
                if (sesU.rol !== 'prime' && !ROLES_CREABLES_POR_GERENTE.includes(datos.rol)) {
                    return json(res, { ok: false, error: 'Solo Prime puede crear usuarios administrador o prime' }, 403);
                }
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
        const sesU = requireSession(req, res, ['gerente']);
        if (!sesU) return;
        if (sesU.rol !== 'prime') {
            const objetivo = db.prepare('SELECT rol FROM usuarios WHERE id=?').get(parseInt(p.split('/').pop()));
            if (objetivo && !ROLES_CREABLES_POR_GERENTE.includes(objetivo.rol)) {
                return json(res, { ok: false, error: 'Solo Prime puede modificar administradores o prime' }, 403);
            }
        }
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
        {
            const sesU = requireSession(req, res, ['gerente']);
            if (!sesU) return;
            if (sesU.rol !== 'prime') {
                const objetivo = db.prepare('SELECT rol FROM usuarios WHERE id=?').get(parseInt(p.split('/').pop()));
                if (objetivo && !ROLES_CREABLES_POR_GERENTE.includes(objetivo.rol)) {
                    return json(res, { ok: false, error: 'Solo Prime puede eliminar administradores o prime' }, 403);
                }
            }
        }
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

    // GET /api/puntos/config — ver estado del sistema de lealtad
    if (p === '/api/puntos/config' && req.method === 'GET') {
        let activo = true;
        try {
            const r = db.prepare("SELECT valor FROM configuracion WHERE clave='puntos_activo' LIMIT 1").get();
            activo = !r || r.valor !== '0';
        } catch(e) { log.debug('No se pudo leer puntos_activo: ' + e.message); }
        return json(res, { puntos_activo: activo });
    }

    // POST /api/puntos/config — habilitar o deshabilitar cualquier módulo (gerente+)
    // Body: { activo: true | false } o { clave: 'nombre_modulo', activo: true | false }
    if (p === '/api/puntos/config' && req.method === 'POST') {
        // (las validaciones de dependencias entre módulos van adentro, tras
        // parsear el body — ver _validarDependencias)
        if (!requireSession(req, res, ['gerente'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), ModuloConfigSchema, res, p);
                if (!datos) return;
                const { clave, activo } = datos;
                // Apagar CONTABILIDAD es un evento de alto riesgo forense
                // (ventas sin asiento) — solo Prime, y siempre queda logueado.
                if (clave === 'contabilidad_activo' && !activo && sesU.rol !== 'prime') {
                    return json(res, { ok: false, error: 'Solo Prime puede desactivar Contabilidad (afecta la integridad de los libros)' }, 403);
                }
                require('../../services/configAudit').logCambio(db, clave, activo ? '1' : '0', sesU.username);
                // Dependencias entre módulos (idea Odoo)
                const { DEPENDE_DE, DEFAULT_OFF } = require('../../bot/flows/modulosDefaults');
                const _estaActivo = (k) => {
                    const r = db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(k);
                    return r ? r.valor !== '0' : !DEFAULT_OFF.includes(k);
                };
                if (activo) {
                    for (const dep of (DEPENDE_DE[clave] || [])) {
                        if (!_estaActivo(dep)) return json(res, { ok: false, error: `Este módulo depende de "${dep}" — actívalo primero` }, 400);
                    }
                } else {
                    const dependientes = Object.entries(DEPENDE_DE).filter(([hijo, deps]) => deps.includes(clave) && _estaActivo(hijo)).map(([hijo]) => hijo);
                    if (dependientes.length) return json(res, { ok: false, error: `No se puede apagar: ${dependientes.join(', ')} depende(n) de este módulo` }, 400);
                }
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
            const puntosService = require('../../bot/handlers/puntosService');
            const saldo = puntosService.consultarSaldo(tel);
            return json(res, saldo || { disponibles: 0, puntos: 0 });
        } catch(e) { return json(res, { error: e.message }, 500); }
    }

    return next();
};
