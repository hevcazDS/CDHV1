'use strict';
// Mensajería interna del EQUIPO (usuarios del panel): 1-a-1 y canales de grupo.
// Distinta del chat de WhatsApp con clientes. Todo usuario con sesión puede usarla
// (gate global de /api/*). La membresía se valida por canal en cada handler: nadie
// lee ni escribe en un canal del que no es miembro. Ver migración 0080.
const construirModulo = require('./_construirModulo');

// id del usuario en sesión (las rutas son de gate global → ses llega por obtenerSesion).
function _yo(req, ctx) {
    const ses = ctx.obtenerSesion ? ctx.obtenerSesion(req) : null;
    if (!ses) return null;
    try { return db_(ctx).prepare('SELECT id, username, nombre, rol FROM usuarios WHERE username=?').get(ses.username) || null; }
    catch (_) { return null; }
}
function db_(ctx) { return ctx.db; }
function _esMiembro(db, idCanal, idUsuario) {
    return !!db.prepare('SELECT 1 FROM canal_miembros WHERE id_canal=? AND id_usuario=?').get(idCanal, idUsuario);
}

// GET /api/mensajeria/usuarios — con quién puedo chatear (todos menos yo).
function usuariosGet(req, res, ctx) {
    const { db, json } = ctx;
    const yo = _yo(req, ctx);
    if (!yo) return json(res, { ok: false, error: 'Sesión inválida' }, 401);
    return json(res, db.prepare('SELECT id, username, nombre, rol FROM usuarios WHERE id != ? ORDER BY nombre, username').all(yo.id));
}

// GET /api/mensajeria/canales — mis canales, con no-leídos, último mensaje y (para
// directos) el nombre del otro. Ordenados por actividad reciente.
function canalesGet(req, res, ctx) {
    const { db, json } = ctx;
    const yo = _yo(req, ctx);
    if (!yo) return json(res, { ok: false, error: 'Sesión inválida' }, 401);
    const canales = db.prepare(`
        SELECT c.id, c.tipo, c.nombre, m.ultimo_leido
        FROM canales_internos c JOIN canal_miembros m ON m.id_canal = c.id
        WHERE m.id_usuario = ?`).all(yo.id);
    const out = canales.map(c => {
        const ult = db.prepare('SELECT id, cuerpo, id_remitente, creado_en FROM mensajes_internos WHERE id_canal=? ORDER BY id DESC LIMIT 1').get(c.id);
        const noLeidos = db.prepare('SELECT COUNT(*) n FROM mensajes_internos WHERE id_canal=? AND id > ? AND id_remitente != ?').get(c.id, c.ultimo_leido, yo.id).n;
        let nombre = c.nombre;
        if (c.tipo === 'directo') {
            const otro = db.prepare(`SELECT u.nombre, u.username FROM canal_miembros m JOIN usuarios u ON u.id=m.id_usuario WHERE m.id_canal=? AND m.id_usuario != ? LIMIT 1`).get(c.id, yo.id);
            nombre = otro ? (otro.nombre || otro.username) : '(usuario)';
        }
        return { id: c.id, tipo: c.tipo, nombre, no_leidos: noLeidos,
            ultimo: ult ? { cuerpo: ult.cuerpo.slice(0, 80), creado_en: ult.creado_en } : null,
            ult_ts: ult ? ult.creado_en : c.id };
    });
    out.sort((a, b) => String(b.ult_ts).localeCompare(String(a.ult_ts)));
    return json(res, out);
}

// GET /api/mensajeria/no-leidos — total para la insignia del menú.
function noLeidosGet(req, res, ctx) {
    const { db, json } = ctx;
    const yo = _yo(req, ctx);
    if (!yo) return json(res, { total: 0 });
    const r = db.prepare(`
        SELECT COALESCE(SUM(x.n),0) total FROM (
            SELECT (SELECT COUNT(*) FROM mensajes_internos mi WHERE mi.id_canal=m.id_canal AND mi.id > m.ultimo_leido AND mi.id_remitente != ?) n
            FROM canal_miembros m WHERE m.id_usuario = ?
        ) x`).get(yo.id, yo.id);
    return json(res, { total: r.total || 0 });
}

// POST /api/mensajeria/directo { id_usuario } — obtiene o crea el canal 1-a-1.
function directoPost(req, res, ctx) {
    const { db, json, readJson } = ctx;
    const yo = _yo(req, ctx);
    if (!yo) return json(res, { ok: false, error: 'Sesión inválida' }, 401);
    return readJson(req, res, d => {
        const otro = parseInt(d.id_usuario) || 0;
        if (!otro || otro === yo.id) return json(res, { ok: false, error: 'Usuario inválido' }, 400);
        if (!db.prepare('SELECT 1 FROM usuarios WHERE id=?').get(otro)) return json(res, { ok: false, error: 'Ese usuario no existe' }, 404);
        const clave = [yo.id, otro].sort((a, b) => a - b).join('_');
        const r = db.transaction(() => {
            let c = db.prepare("SELECT id FROM canales_internos WHERE clave_directo=?").get(clave);
            if (!c) {
                const id = db.prepare("INSERT INTO canales_internos (tipo, clave_directo, creado_por) VALUES ('directo', ?, ?)").run(clave, yo.id).lastInsertRowid;
                const insM = db.prepare('INSERT OR IGNORE INTO canal_miembros (id_canal, id_usuario) VALUES (?,?)');
                insM.run(id, yo.id); insM.run(id, otro);
                c = { id };
            }
            return c.id;
        })();
        return json(res, { ok: true, id_canal: r });
    });
}

// POST /api/mensajeria/grupo { nombre, miembros:[ids] } — crea un canal de grupo.
function grupoPost(req, res, ctx) {
    const { db, json, readJson } = ctx;
    const yo = _yo(req, ctx);
    if (!yo) return json(res, { ok: false, error: 'Sesión inválida' }, 401);
    return readJson(req, res, d => {
        const nombre = String(d.nombre || '').trim().slice(0, 60);
        if (!nombre) return json(res, { ok: false, error: 'Ponle nombre al grupo' }, 400);
        const miembros = [...new Set((Array.isArray(d.miembros) ? d.miembros : []).map(x => parseInt(x)).filter(x => x > 0))];
        miembros.push(yo.id); // el creador siempre entra
        const validos = miembros.filter(id => db.prepare('SELECT 1 FROM usuarios WHERE id=?').get(id));
        if (validos.length < 2) return json(res, { ok: false, error: 'Elige al menos un integrante más' }, 400);
        const id = db.transaction(() => {
            const gid = db.prepare("INSERT INTO canales_internos (tipo, nombre, creado_por) VALUES ('grupo', ?, ?)").run(nombre, yo.id).lastInsertRowid;
            const insM = db.prepare('INSERT OR IGNORE INTO canal_miembros (id_canal, id_usuario) VALUES (?,?)');
            for (const u of [...new Set(validos)]) insM.run(gid, u);
            return gid;
        })();
        return json(res, { ok: true, id_canal: id });
    });
}

// GET /api/mensajeria/canales/:id/mensajes — mensajes del canal (solo miembro).
// Marca leído hasta el último al abrir.
function mensajesGet(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const yo = _yo(req, ctx);
    if (!yo) return json(res, { ok: false, error: 'Sesión inválida' }, 401);
    const idCanal = parseInt(params[0]);
    if (!_esMiembro(db, idCanal, yo.id)) return json(res, { ok: false, error: 'No perteneces a este canal' }, 403);
    const msgs = db.prepare(`
        SELECT mi.id, mi.cuerpo, mi.creado_en, mi.id_remitente, u.nombre, u.username
        FROM mensajes_internos mi LEFT JOIN usuarios u ON u.id = mi.id_remitente
        WHERE mi.id_canal=? ORDER BY mi.id DESC LIMIT 200`).all(idCanal).reverse();
    const ultimo = msgs.length ? msgs[msgs.length - 1].id : 0;
    if (ultimo) db.prepare('UPDATE canal_miembros SET ultimo_leido=? WHERE id_canal=? AND id_usuario=? AND ultimo_leido < ?').run(ultimo, idCanal, yo.id, ultimo);
    return json(res, msgs.map(m => ({ id: m.id, cuerpo: m.cuerpo, creado_en: m.creado_en, mio: m.id_remitente === yo.id, autor: m.nombre || m.username || '' })));
}

// POST /api/mensajeria/canales/:id/mensajes { cuerpo } — enviar (solo miembro).
function enviarPost(req, res, ctx, { params }) {
    const { db, json, readJson } = ctx;
    const yo = _yo(req, ctx);
    if (!yo) return json(res, { ok: false, error: 'Sesión inválida' }, 401);
    const idCanal = parseInt(params[0]);
    if (!_esMiembro(db, idCanal, yo.id)) return json(res, { ok: false, error: 'No perteneces a este canal' }, 403);
    return readJson(req, res, d => {
        const cuerpo = String(d.cuerpo || '').trim().slice(0, 4000);
        if (!cuerpo) return json(res, { ok: false, error: 'Mensaje vacío' }, 400);
        const id = db.prepare('INSERT INTO mensajes_internos (id_canal, id_remitente, cuerpo) VALUES (?,?,?)').run(idCanal, yo.id, cuerpo).lastInsertRowid;
        // el remitente queda al día con su propio mensaje
        db.prepare('UPDATE canal_miembros SET ultimo_leido=? WHERE id_canal=? AND id_usuario=?').run(id, idCanal, yo.id);
        return json(res, { ok: true, id });
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/mensajeria/usuarios',                        handler: usuariosGet },
    { metodo: 'GET',  path: '/api/mensajeria/canales',                         handler: canalesGet },
    { metodo: 'GET',  path: '/api/mensajeria/no-leidos',                       handler: noLeidosGet },
    { metodo: 'POST', path: '/api/mensajeria/directo',                         handler: directoPost },
    { metodo: 'POST', path: '/api/mensajeria/grupo',                           handler: grupoPost },
    { metodo: 'GET',  path: /^\/api\/mensajeria\/canales\/(\d+)\/mensajes$/,   handler: mensajesGet },
    { metodo: 'POST', path: /^\/api\/mensajeria\/canales\/(\d+)\/mensajes$/,   handler: enviarPost },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/mensajeria' });
module.exports._test = { usuariosGet, canalesGet, noLeidosGet, directoPost, grupoPost, mensajesGet, enviarPost };
