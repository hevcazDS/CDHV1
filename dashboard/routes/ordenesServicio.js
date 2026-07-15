'use strict';
// Órdenes de servicio/trabajo (auditoría de giros r2 #3): mantenimiento y
// servicios registran QUÉ se encargó y QUÉ se hizo (evidencia de trabajo
// completado). Ligables a una cita y a un empleado. Área operación; la página
// del panel se muestra con citas_activo (los giros de servicio lo traen).
const construirModulo = require('./_construirModulo');

function listar(req, res, ctx, { u }) {
    const { db, json } = ctx;
    const est = (u.searchParams.get('estatus') || '').trim();
    const filas = db.prepare(`
        SELECT o.*, e.nombre AS empleado_nombre
        FROM ordenes_servicio o LEFT JOIN empleados e ON e.id = o.id_empleado
        ${est ? "WHERE o.estatus = ?" : ''}
        ORDER BY o.id DESC LIMIT 300`).all(...(est ? [est] : []));
    return json(res, filas);
}

function crear(req, res, ctx, { ses }) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, d => {
        const descripcion = String(d.descripcion || '').trim();
        if (!descripcion) return json(res, { ok: false, error: 'Describe el trabajo encargado' }, 400);
        const tel = String(d.telefono || '').replace(/\D/g, '') || null;
        const folio = 'OS-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' +
            String((db.prepare('SELECT COUNT(*) n FROM ordenes_servicio').get().n || 0) + 1).padStart(3, '0');
        const r = db.prepare(`INSERT INTO ordenes_servicio (folio, id_cliente, id_cita, cliente_nombre, telefono, descripcion, id_empleado, creado_por)
                              VALUES (?,?,?,?,?,?,?,?)`)
            .run(folio, Number(d.id_cliente) > 0 ? Number(d.id_cliente) : null,
                 Number(d.id_cita) > 0 ? Number(d.id_cita) : null,
                 String(d.cliente_nombre || '').trim() || null, tel, descripcion,
                 Number(d.id_empleado) > 0 ? Number(d.id_empleado) : null, ses?.username || null);
        return json(res, { ok: true, id: r.lastInsertRowid, folio });
    });
}

function actualizar(req, res, ctx, { params }) {
    const { db, json, readJson } = ctx;
    const id = parseInt(params[0]);
    return readJson(req, res, d => {
        const o = db.prepare('SELECT id FROM ordenes_servicio WHERE id=?').get(id);
        if (!o) return json(res, { ok: false, error: 'Orden no encontrada' }, 404);
        if (d.estatus && ['abierta', 'en_curso', 'completada', 'cancelada'].includes(d.estatus)) {
            db.prepare(`UPDATE ordenes_servicio SET estatus=?, cerrado_en=${d.estatus === 'completada' || d.estatus === 'cancelada' ? "datetime('now','localtime')" : 'NULL'} WHERE id=?`).run(d.estatus, id);
        }
        if (d.trabajo_realizado !== undefined) db.prepare('UPDATE ordenes_servicio SET trabajo_realizado=? WHERE id=?').run(String(d.trabajo_realizado).trim() || null, id);
        if (d.id_empleado !== undefined) db.prepare('UPDATE ordenes_servicio SET id_empleado=? WHERE id=?').run(Number(d.id_empleado) > 0 ? Number(d.id_empleado) : null, id);
        if (d.descripcion !== undefined && String(d.descripcion).trim()) db.prepare('UPDATE ordenes_servicio SET descripcion=? WHERE id=?').run(String(d.descripcion).trim(), id);
        return json(res, { ok: true, id });
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/ordenes-servicio',            area: 'operacion', handler: listar },
    { metodo: 'POST', path: '/api/ordenes-servicio',            area: 'operacion', handler: crear },
    { metodo: 'PUT',  path: /^\/api\/ordenes-servicio\/(\d+)$/, area: 'operacion', handler: actualizar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/ordenes-servicio' });
module.exports._test = { crear, actualizar };   // contract test r2
