'use strict';
// Tareas/recordatorios (Ola 2): gerente+ asigna trabajo a un área o usuario;
// los especialistas crean SUS PROPIOS recordatorios (no pueden asignar a
// terceros). "Mis tareas" = asignadas a mi username, a una de mis áreas, o
// creadas por mí. gerente+ ve todas.
const { rangoDe, AREAS_POR_ROL } = require('../permisos');
const construirModulo = require('./_construirModulo');

function misAreas(rol) { return AREAS_POR_ROL[rol] || []; }

// GET /api/tareas[?todas=1] — mis pendientes+hechas recientes; gerente+ con
// ?todas=1 ve el tablero completo (para dar seguimiento al trabajo asignado).
function listar(req, res, ctx, { ses }) {
    const { db, json } = ctx;
    const todas = (new URL(req.url, 'http://x')).searchParams.get('todas') === '1' && rangoDe(ses.rol) >= 2;
    if (todas) {
        return json(res, db.prepare(`SELECT * FROM tareas ORDER BY estatus='hecha', COALESCE(fecha,'9999'), id DESC LIMIT 300`).all());
    }
    const areas = misAreas(ses.rol);
    const filas = db.prepare(`
        SELECT * FROM tareas
        WHERE asignado_a = ? OR creado_por = ? OR area IN (${areas.map(() => '?').join(',') || "''"})
        ORDER BY estatus='hecha', COALESCE(fecha,'9999'), id DESC LIMIT 300`)
        .all(ses.username, ses.username, ...areas);
    return json(res, filas);
}

// GET /api/tareas/pendientes-count — para la campana (solo pendientes MÍAS).
function pendientesCount(req, res, ctx, { ses }) {
    const { db, json } = ctx;
    const areas = misAreas(ses.rol);
    const r = db.prepare(`
        SELECT COUNT(*) n FROM tareas WHERE estatus='pendiente'
        AND (asignado_a = ? OR area IN (${areas.map(() => '?').join(',') || "''"}))`)
        .get(ses.username, ...areas);
    return json(res, { count: r.n });
}

// POST /api/tareas — crear. Especialista: solo para sí mismo (recordatorio).
function crear(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const titulo = String(d.titulo || '').trim();
            if (!titulo) return json(res, { ok: false, error: 'Falta el título' }, 400);
            let area = String(d.area || '').trim() || null;
            let asignadoA = String(d.asignado_a || '').trim() || null;
            if (rangoDe(ses.rol) < 2) { area = null; asignadoA = ses.username; } // recordatorio propio
            const r = db.prepare(`INSERT INTO tareas (titulo, notas, fecha, area, asignado_a, creado_por) VALUES (?,?,?,?,?,?)`)
                .run(titulo, String(d.notas || '').trim() || null, String(d.fecha || '').slice(0, 10) || null, area, asignadoA, ses.username);
            return json(res, { ok: true, id: r.lastInsertRowid });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// PUT /api/tareas/:id — marcar hecha/pendiente. Asignado, creador o gerente+.
function actualizar(req, res, ctx, { ses, params }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const t = db.prepare('SELECT * FROM tareas WHERE id=?').get(params[0]);
            if (!t) return json(res, { ok: false, error: 'No existe' }, 404);
            const esMia = t.asignado_a === ses.username || t.creado_por === ses.username || misAreas(ses.rol).includes(t.area);
            if (!esMia && rangoDe(ses.rol) < 2) return json(res, { ok: false, error: 'Sin permiso' }, 403);
            const d = JSON.parse(body || '{}');
            const hecha = d.estatus === 'hecha';
            db.prepare(`UPDATE tareas SET estatus=?, hecha_en=? WHERE id=?`)
              .run(hecha ? 'hecha' : 'pendiente', hecha ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, t.id);
            return json(res, { ok: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// DELETE /api/tareas/:id — creador o gerente+.
function borrar(req, res, ctx, { ses, params }) {
    const { db, json } = ctx;
    const t = db.prepare('SELECT creado_por FROM tareas WHERE id=?').get(params[0]);
    if (!t) return json(res, { ok: false, error: 'No existe' }, 404);
    if (t.creado_por !== ses.username && rangoDe(ses.rol) < 2) return json(res, { ok: false, error: 'Sin permiso' }, 403);
    db.prepare('DELETE FROM tareas WHERE id=?').run(params[0]);
    return json(res, { ok: true });
}

// roles:['usuario'] = rango mínimo 1 ⇒ cualquier sesión (el auditor queda en
// solo-GET por el bloqueo global de server.js, como en todos lados).
const RUTAS = [
    { metodo: 'GET',    path: '/api/tareas',                   roles: ['usuario'], handler: listar },
    { metodo: 'GET',    path: '/api/tareas/pendientes-count',  roles: ['usuario'], handler: pendientesCount },
    { metodo: 'POST',   path: '/api/tareas',                   roles: ['usuario'], handler: crear },
    { metodo: 'PUT',    path: /^\/api\/tareas\/(\d+)$/,        roles: ['usuario'], handler: actualizar },
    { metodo: 'DELETE', path: /^\/api\/tareas\/(\d+)$/,        roles: ['usuario'], handler: borrar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/tareas' });
