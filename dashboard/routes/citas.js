'use strict';
// Agenda de citas (giros de servicio): consultar/crear/actualizar.
// PILOTO del paso 3 (tronco B-lite): las rutas se declaran como DATOS con su
// gate explícito (área 'operacion') y construirModulo devuelve la misma función
// (req,res,p,u,ctx,next) — el dispatch de server.js no cambia. Ver
// dashboard/routes/_construirModulo.js. Auditor lee por su bypass global.
const construirModulo = require('./_construirModulo');

function listar(req, res, ctx, { u }) {
    const { db, json } = ctx;
    const sp = u.searchParams;
    const hoy = new Date().toISOString().slice(0, 10);
    const desde = (sp.get('desde') || hoy).slice(0, 10);
    const hasta = (sp.get('hasta') || desde).slice(0, 10);
    return json(res, db.prepare(
        'SELECT * FROM citas WHERE fecha >= ? AND fecha <= ? ORDER BY fecha, hora'
    ).all(desde, hasta));
}

function crear(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') || !/^\d{2}:\d{2}$/.test(d.hora || '')) {
                return json(res, { ok: false, error: 'Fecha (YYYY-MM-DD) y hora (HH:MM) requeridas' }, 400);
            }
            const tel = String(d.telefono || '').replace(/\D/g, '');
            if (!tel) return json(res, { ok: false, error: 'Falta teléfono' }, 400);
            const r = db.prepare('INSERT INTO citas (telefono, nombre, servicio, fecha, hora, notas) VALUES (?,?,?,?,?,?)')
                .run(tel, String(d.nombre || '').trim() || null, String(d.servicio || '').trim() || null,
                     d.fecha, d.hora, String(d.notas || '').trim() || null);
            return json(res, { ok: true, id: r.lastInsertRowid });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

function actualizar(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const cita = db.prepare('SELECT id, telefono, servicio FROM citas WHERE id=?').get(id);
            if (!cita) return json(res, { ok: false, error: 'Cita no encontrada' }, 404);
            if (d.estatus && ['pendiente', 'confirmada', 'completada', 'cancelada', 'no_asistio'].includes(d.estatus)) {
                db.prepare('UPDATE citas SET estatus=? WHERE id=?').run(d.estatus, id);
                // Embudo de citas (CRO): registra el desenlace para medir no-show
                if (d.estatus === 'completada' || d.estatus === 'no_asistio') {
                    try {
                        db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES (?, 'whatsapp', ?, ?)")
                            .run(d.estatus === 'completada' ? 'cita_cumplida' : 'cita_no_asistio', cita.servicio || String(id), cita.telefono || null);
                    } catch (_) {}
                }
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') && /^\d{2}:\d{2}$/.test(d.hora || '')) {
                db.prepare('UPDATE citas SET fecha=?, hora=?, recordatorio_enviado=0 WHERE id=?').run(d.fecha, d.hora, id);
            }
            if (d.notas !== undefined) db.prepare('UPDATE citas SET notas=? WHERE id=?').run(String(d.notas).trim() || null, id);
            return json(res, { ok: true, id });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/citas',            area: 'operacion', handler: listar },
    { metodo: 'POST', path: '/api/citas',            area: 'operacion', handler: crear },
    { metodo: 'PUT',  path: /^\/api\/citas\/(\d+)$/, area: 'operacion', handler: actualizar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/citas' });
