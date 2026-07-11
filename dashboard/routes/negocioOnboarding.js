'use strict';
// negocioOnboarding.js — Alta desde cero de cualquier negocio (first-run) +
// gestión de métodos de pago. Parte del Bloque 1 (sistema agnóstico de giro).
//
// El onboarding es PÚBLICO a propósito (una instancia recién clonada todavía
// no tiene admin ni sesión), pero se auto-bloquea en cuanto el negocio queda
// configurado (configuracion.negocio_configurado='1'): a partir de ahí
// POST /api/onboarding responde 409. En la instancia de Julio Cepeda la
// migración 0014 ya dejó negocio_configurado='1', así que nunca ve el alta.
// Migrado al patrón declarativo: onboarding/soporte caen al gate global
// (onboarding va en la whitelist pública de server.js); métodos-pago = gerente+.
const { GIROS } = require('../../bot/flows/_giros');
const construirModulo = require('./_construirModulo');

function estaConfigurado(db) {
    try {
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='negocio_configurado'").get();
        return !!r && r.valor === '1';
    } catch (_) { return false; }
}

// ── GET /api/onboarding/estado — público (first-run) ──────────────────────
function onboardingEstado(req, res, ctx) {
    const { db, json } = ctx;
    let hayAdmin = false;
    try { hayAdmin = (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n) > 0; } catch (_) {}
    const giros = Object.keys(GIROS).map(k => ({ clave: k, label: GIROS[k].label }));
    let metodos = [];
    try { metodos = db.prepare('SELECT id, nombre, requiere_link FROM metodos_pago ORDER BY id').all(); } catch (_) {}
    let nombreNegocio = '';
    try { const r = db.prepare("SELECT valor FROM configuracion WHERE clave='nombre_negocio'").get(); nombreNegocio = r ? r.valor : ''; } catch (_) {}
    return json(res, { configurado: estaConfigurado(db), hayAdmin, giros, metodos, nombre_negocio: nombreNegocio });
}

// ── POST /api/onboarding — público SOLO mientras no esté configurado ──────
function onboarding(req, res, ctx) {
    const { db, json, readBody, log, crypto, hashPassword } = ctx;
    const setCfg = (k, v) => db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now','localtime'))").run(k, String(v));
    return readBody(req, body => {
        try {
            if (estaConfigurado(db)) return json(res, { ok: false, error: 'El negocio ya fue configurado' }, 409);
            const d = JSON.parse(body || '{}');
            const nombre = String(d.nombre_negocio || '').trim();
            const giro   = String(d.giro || '').trim();
            const user   = String(d.admin_username || '').trim();
            const pass   = String(d.admin_password || '');
            if (!nombre) return json(res, { ok: false, error: 'Falta el nombre del negocio' }, 400);
            if (!GIROS[giro]) return json(res, { ok: false, error: 'Giro inválido' }, 400);
            if (!user || pass.length < 4) return json(res, { ok: false, error: 'Usuario y contraseña (mínimo 4 caracteres) requeridos' }, 400);

            setCfg('nombre_negocio', nombre);
            setCfg('nombre_negocio_corto', String(d.nombre_negocio_corto || nombre).trim());
            setCfg('giro', giro);
            setCfg('moneda', String(d.moneda || 'MXN'));
            setCfg('iva_pct', String(d.iva_pct ?? '16'));
            if (['A', 'B', 'C', 'D'].includes(d.tono)) setCfg('tono_bot', d.tono);

            if (Array.isArray(d.metodos_pago)) {
                const ids = d.metodos_pago.map(Number).filter(Boolean);
                db.prepare('UPDATE metodos_pago SET activo=0').run();
                for (const id of ids) db.prepare('UPDATE metodos_pago SET activo=1 WHERE id=?').run(id);
            }

            // Crear al dueño como PRIME (control total) solo si ese username
            // no existe ya (en un clon sin .env de credenciales, este es el
            // primer usuario y debe poder gestionar todo).
            const existe = db.prepare('SELECT id FROM usuarios WHERE username=?').get(user);
            if (!existe) {
                const salt = crypto.randomBytes(16).toString('hex');
                const email = user.toLowerCase() + '@local';
                db.prepare('INSERT INTO usuarios (username, nombre, email, password_hash, id_rol, salt, rol) VALUES (?,?,?,?,?,?,?)')
                  .run(user, user, email, hashPassword(pass, salt), 2, salt, 'prime');
            }

            setCfg('negocio_configurado', '1');
            log.info('[onboarding] negocio configurado: ' + nombre + ' (' + giro + ')');
            return json(res, { ok: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── GET /api/soporte — contacto del proveedor de software (Hevcaz Solutions)
// para el widget flotante. Configurable por env sin recompilar. ──
function soporte(req, res, ctx) {
    return ctx.json(res, {
        nombre:   process.env.SOPORTE_HEVCAZ_NOMBRE   || 'Hevcaz Solutions',
        whatsapp: (process.env.SOPORTE_HEVCAZ_WHATSAPP || '').replace(/[^0-9]/g, ''),
        email:    process.env.SOPORTE_HEVCAZ_EMAIL    || '',
    });
}

// ── Gestión de métodos de pago (gerente+) ──
function metodosGet(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, db.prepare('SELECT id, nombre, activo, requiere_link, configuracion FROM metodos_pago ORDER BY id').all());
}
function metodosPut(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0], 10);
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            if (d.activo !== undefined) db.prepare('UPDATE metodos_pago SET activo=? WHERE id=?').run(d.activo ? 1 : 0, id);
            if (d.configuracion !== undefined) {
                const cfgVal = typeof d.configuracion === 'string' ? d.configuracion : JSON.stringify(d.configuracion);
                db.prepare('UPDATE metodos_pago SET configuracion=? WHERE id=?').run(cfgVal, id);
            }
            return json(res, { ok: true, id });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/onboarding/estado',           handler: onboardingEstado },
    { metodo: 'POST', path: '/api/onboarding',                  handler: onboarding },
    { metodo: 'GET',  path: '/api/soporte',                     handler: soporte },
    { metodo: 'GET',  path: '/api/metodos-pago',                roles: ['gerente'], handler: metodosGet },
    { metodo: 'PUT',  path: /^\/api\/metodos-pago\/(\d+)$/,     roles: ['gerente'], handler: metodosPut },
];

module.exports = construirModulo(RUTAS);
