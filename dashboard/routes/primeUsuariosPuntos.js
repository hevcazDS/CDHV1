'use strict';
// Gestión de usuarios (alta/edición/baja con jerarquía de roles) + config del
// sistema de puntos + toggle de módulos + ranking/saldo. Migrado al patrón
// declarativo del tronco: gate por-ruta (gerente para usuarios/toggle, prime
// para borrar usuarios; ranking/saldo caen al gate global).
//
// FIX al migrar: POST /api/puntos/config (el toggle de Módulos) usaba `sesU`
// sin definirlo en ese bloque (el split mecánico del monolito lo dejó fuera de
// scope) → ReferenceError → 500 en CADA toggle. Ahora usa el `ses` que entrega
// el gate roles:['gerente']. Verificado con repro directo.
const { ROLES_CREABLES_POR_GERENTE } = require('../permisos');
const construirModulo = require('./_construirModulo');

// POST /api/prime/usuarios — alta de usuario (gerente+; roles altos solo prime)
function usuariosPost(req, res, ctx, { ses }) {
    const { db, json, readBody, validar, log, crypto, hashPassword, UsuarioSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), UsuarioSchema, res, '/api/prime/usuarios');
            if (!datos) return;
            if (ses.rol !== 'prime' && !ROLES_CREABLES_POR_GERENTE.includes(datos.rol)) {
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

// PUT /api/prime/usuarios/:id — edición (gerente+; tocar roles altos solo prime)
function usuariosPut(req, res, ctx, { params, ses }) {
    const { db, json, readBody, validar, crypto, hashPassword, UsuarioUpdateSchema } = ctx;
    const id = parseInt(params[0]);
    if (ses.rol !== 'prime') {
        const objetivo = db.prepare('SELECT rol FROM usuarios WHERE id=?').get(id);
        if (objetivo && !ROLES_CREABLES_POR_GERENTE.includes(objetivo.rol)) {
            return json(res, { ok: false, error: 'Solo Prime puede modificar administradores o prime' }, 403);
        }
    }
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body || '{}'), UsuarioUpdateSchema, res, '/api/prime/usuarios');
            if (!datos) return;
            // Antiescalada: un gerente no puede ASIGNAR un rol fuera de su alcance
            // (ni prime/gerente). El guard de arriba valida el rol ACTUAL del
            // objetivo; hay que validar también el rol NUEVO (datos.rol) — si no,
            // un gerente edita un cajero → rol='prime' + password conocida = prime.
            // El POST (alta) ya hace esta validación; el PUT la omitía.
            if (ses.rol !== 'prime' && datos.rol && !ROLES_CREABLES_POR_GERENTE.includes(datos.rol)) {
                return json(res, { ok: false, error: 'Solo Prime puede asignar el rol "' + datos.rol + '"' }, 403);
            }
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

// DELETE /api/prime/usuarios/:id — baja (SOLO prime; no self ni último prime)
function usuariosDelete(req, res, ctx, { params, ses }) {
    const { db, json } = ctx;
    const id = parseInt(params[0]);
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
function puntosConfigGet(req, res, ctx) {
    const { db, json, log } = ctx;
    let activo = true;
    try {
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='puntos_activo' LIMIT 1").get();
        activo = !r || r.valor !== '0';
    } catch (e) { log.debug('No se pudo leer puntos_activo: ' + e.message); }
    return json(res, { puntos_activo: activo });
}

// POST /api/puntos/config — habilitar/deshabilitar cualquier módulo (gerente+).
// Body: { clave, activo }
function puntosConfigPost(req, res, ctx, { ses }) {
    const { db, json, readBody, validar, log, ModuloConfigSchema } = ctx;
    return readBody(req, body => {
        try {
            const datos = validar(JSON.parse(body), ModuloConfigSchema, res, '/api/puntos/config');
            if (!datos) return;
            const { clave, activo } = datos;
            // Apagar CONTABILIDAD es alto riesgo forense (ventas sin asiento) —
            // solo Prime, y siempre queda logueado.
            if (clave === 'contabilidad_activo' && !activo && ses.rol !== 'prime') {
                return json(res, { ok: false, error: 'Solo Prime puede desactivar Contabilidad (afecta la integridad de los libros)' }, 403);
            }
            require('../../services/configAudit').logCambio(db, clave, activo ? '1' : '0', ses.username);
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
            db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now','localtime'))").run(clave, activo ? '1' : '0');
            log.info('Módulo ' + clave + ': ' + (activo ? 'ACTIVADO' : 'DESACTIVADO'));
            return json(res, { ok: true, clave, activo });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/puntos/ranking — top clientes por puntos (antes del catch-all :telefono)
function puntosRanking(req, res, ctx) {
    const { db, json } = ctx;
    const rows = db.prepare(`
        SELECT c.nombre, c.telefono, pc.puntos_ganados, pc.puntos_canjeados,
               (pc.puntos_ganados - pc.puntos_canjeados) AS disponibles, pc.ultimo_movimiento
        FROM puntos_cliente pc JOIN clientes c ON c.id = pc.id_cliente
        ORDER BY disponibles DESC LIMIT 20`).all();
    return json(res, rows);
}

// GET /api/puntos/:telefono — saldo de un cliente
function puntosSaldo(req, res, ctx, { params }) {
    const { json } = ctx;
    const tel = decodeURIComponent(params[0]);
    try {
        const saldo = require('../../bot/handlers/puntosService').consultarSaldo(tel);
        return json(res, saldo || { disponibles: 0, puntos: 0 });
    } catch (e) { return json(res, { error: e.message }, 500); }
}

// Orden importa: config/ranking (exactas) ANTES del catch-all /api/puntos/:telefono.
const RUTAS = [
    { metodo: 'POST',   path: '/api/prime/usuarios',                roles: ['gerente'], handler: usuariosPost },
    { metodo: 'PUT',    path: /^\/api\/prime\/usuarios\/(\d+)$/,    roles: ['gerente'], handler: usuariosPut },
    { metodo: 'DELETE', path: /^\/api\/prime\/usuarios\/(\d+)$/,    roles: ['prime'],   handler: usuariosDelete },
    { metodo: 'GET',    path: '/api/puntos/config',                 handler: puntosConfigGet },
    { metodo: 'POST',   path: '/api/puntos/config',                 roles: ['gerente'], handler: puntosConfigPost },
    { metodo: 'GET',    path: '/api/puntos/ranking',                handler: puntosRanking },
    { metodo: 'GET',    path: /^\/api\/puntos\/(.+)$/,              handler: puntosSaldo },
];

module.exports = construirModulo(RUTAS);
