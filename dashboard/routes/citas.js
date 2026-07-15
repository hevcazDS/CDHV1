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
    const emp = parseInt(sp.get('empleado') || '0', 10) || 0;
    return json(res, db.prepare(
        `SELECT c.*, e.nombre AS empleado_nombre FROM citas c
         LEFT JOIN empleados e ON e.id = c.id_empleado
         WHERE c.fecha >= ? AND c.fecha <= ?${emp ? ' AND c.id_empleado = ' + emp : ''}
         ORDER BY c.fecha, c.hora`
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
            const r = db.prepare('INSERT INTO citas (telefono, nombre, servicio, fecha, hora, notas, id_empleado) VALUES (?,?,?,?,?,?,?)')
                .run(tel, String(d.nombre || '').trim() || null, String(d.servicio || '').trim() || null,
                     d.fecha, d.hora, String(d.notas || '').trim() || null,
                     Number(d.id_empleado) > 0 ? Number(d.id_empleado) : null);
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
            if (d.id_empleado !== undefined) db.prepare('UPDATE citas SET id_empleado=? WHERE id=?').run(Number(d.id_empleado) > 0 ? Number(d.id_empleado) : null, id);
            return json(res, { ok: true, id });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/citas/:id/cobrar — cobra el servicio de la cita reusando la
// maquinaria del POS (insertarPedidoConCarrito con tipo 'servicio' = sin stock).
// Cierra el círculo agendar→cobrar de los giros de servicio. Cajero/operador.
function cobrar(req, res, ctx, { params, ses }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const d = (() => { try { return JSON.parse(body || '{}'); } catch (_) { return {}; } })();
            const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(id);
            if (!cita) return json(res, { ok: false, error: 'Cita no encontrada' }, 404);
            if (cita.id_pedido) return json(res, { ok: false, error: 'Esta cita ya fue cobrada' }, 400);
            const precio = Number(d.precio) > 0 ? Number(d.precio) : Number(cita.servicio_precio) || 0;
            if (!(precio > 0)) return json(res, { ok: false, error: 'Captura el precio del servicio' }, 400);
            const shared = require('../../bot/flows/_shared');
            const metodoPago = String(d.metodo_pago || 'efectivo').trim();
            const nombre = cita.nombre || 'Cliente';
            const carrito = [{ id: cita.id_servicio || null, name: cita.servicio || 'Servicio', price: precio, cantidad: 1, tipo: 'servicio' }];
            const { sucursalDeSesion } = require('../../services/sucursalService');
            const sucursal = sucursalDeSesion(db, ses) || '';
            const folio = shared.generarFolio('pedido');
            let idCliente = null;
            if (cita.telefono) { try { const c = shared.upsertCliente(cita.telefono, nombre); idCliente = c?.id || null; } catch (_) {} }
            const r = db.transaction(() => {
                const { pedidoRowid, subtotal } = shared.insertarPedidoConCarrito(nombre, carrito, '', 'entregado', sucursal, folio, idCliente, 'mostrador');
                db.prepare("UPDATE pedidos SET subtotal=?, total=?, metodo_pago=?, metodo_entrega='pickup', cobrado_por=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?")
                  .run(subtotal, subtotal, metodoPago, ses.username || null, pedidoRowid);
                const met = db.prepare('SELECT id FROM metodos_pago WHERE nombre=?').get(metodoPago);
                db.prepare("INSERT INTO links_pago (id_pedido, id_metodo, monto, moneda, estatus, pagado_en, creado_en) VALUES (?,?,?,'MXN','pagado',datetime('now','localtime'),datetime('now','localtime'))")
                  .run(pedidoRowid, met ? met.id : null, subtotal);
                db.prepare("UPDATE citas SET id_pedido=?, estatus='completada' WHERE id=?").run(pedidoRowid, id);
                try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('cita_cobrada','mostrador',?,?)").run(String(subtotal), cita.telefono || null); } catch (_) {}
                return { pedidoRowid, subtotal, folio };
            })();
            try {
                const _conta = require('../../services/contabilidadService');
                _conta.asientoVenta(r.pedidoRowid, r.subtotal, metodoPago);
            } catch (_) {}
            try { if (idCliente) require('../../bot/handlers/puntosService').otorgarPuntosPorCompra(r.pedidoRowid); } catch (_) {}
            return json(res, { ok: true, folio: r.folio, total: r.subtotal, id_pedido: r.pedidoRowid });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// GET /api/citas/empleados — lista LIGERA (id+nombre) para asignar quién
// atiende. Área operación: solo nombres, sin salarios ni datos de RRHH.
function empleadosLigero(req, res, ctx) {
    const { db, json } = ctx;
    try { return json(res, db.prepare("SELECT id, nombre, puesto FROM empleados WHERE COALESCE(activo,1)=1 ORDER BY nombre").all()); }
    catch (_) { try { return json(res, db.prepare('SELECT id, nombre, puesto FROM empleados ORDER BY nombre').all()); } catch (__) { return json(res, []); } }
}

// GET /api/citas/comisiones?desde&hasta — comisión POR SERVICIO al empleado
// asignado: SUM(precio de citas COBRADAS del período) × empleados.comision_pct
// (con fallback al comision_pct global de configuración). Gerente+ (es reporte
// de nómina/dinero, no operación).
function comisiones(req, res, ctx, { u }) {
    const { db, json } = ctx;
    const hoy = new Date().toISOString().slice(0, 10);
    const desde = (u.searchParams.get('desde') || hoy.slice(0, 8) + '01').slice(0, 10);
    const hasta = (u.searchParams.get('hasta') || hoy).slice(0, 10);
    const pctGlobal = parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='comision_pct'").get()?.valor || '0') || 0;
    const filas = db.prepare(`
        SELECT e.id, e.nombre, e.comision_pct,
               COUNT(c.id) AS servicios,
               COALESCE(SUM(lp.monto), 0) AS cobrado
        FROM citas c
        JOIN empleados e ON e.id = c.id_empleado
        JOIN links_pago lp ON lp.id_pedido = c.id_pedido AND lp.estatus = 'pagado'
        WHERE c.id_pedido IS NOT NULL AND c.fecha >= ? AND c.fecha <= ?
        GROUP BY e.id ORDER BY cobrado DESC`).all(desde, hasta);
    const r2 = n => Math.round(n * 100) / 100;
    return json(res, {
        desde, hasta, comision_pct_global: pctGlobal,
        filas: filas.map(f => {
            const pct = (f.comision_pct > 0 ? f.comision_pct : pctGlobal);
            return { ...f, pct, comision: r2(f.cobrado * pct / 100) };
        }),
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/citas',            area: 'operacion', handler: listar },
    { metodo: 'GET',  path: '/api/citas/empleados',  area: 'operacion', handler: empleadosLigero },
    { metodo: 'GET',  path: '/api/citas/comisiones', roles: ['gerente'], handler: comisiones },
    { metodo: 'POST', path: '/api/citas',            area: 'operacion', handler: crear },
    { metodo: 'PUT',  path: /^\/api\/citas\/(\d+)$/, area: 'operacion', handler: actualizar },
    { metodo: 'POST', path: /^\/api\/citas\/(\d+)\/cobrar$/, areas: ['pos', 'operacion'], handler: cobrar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/citas' });
module.exports._test = { comisiones };   // contract test P2
