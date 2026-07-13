'use strict';
// suscripciones.js — F5.1: suscripción mensual (giro servicios, módulo
// suscripcion_activo). Captura cliente + monto + día de corte; el MRR (SUM de
// activas) proyecta el ingreso recurrente. Cobrar un período REUSA la ruta de
// dinero sellada (pedido + links_pago 'generado'): el cobro real se confirma en
// marcar-pagado, igual que todo. No inventa cobro nuevo.
const construirModulo = require('./_construirModulo');
const { flagActivo } = require('../../services/configFlags');

const activo = (db) => flagActivo(db, 'suscripcion_activo');

// Próxima fecha (YYYY-MM-DD) con ese día de corte, en o después de hoy.
function proximaFecha(diaCorte) {
    const d = Math.min(Math.max(parseInt(diaCorte) || 1, 1), 28);
    const hoy = new Date();
    let y = hoy.getFullYear(), m = hoy.getMonth();
    if (hoy.getDate() > d) m += 1;              // ya pasó este mes → el siguiente
    const f = new Date(y, m, d);
    return f.toISOString().slice(0, 10);
}
const { generarCargo, generarCobrosVencidos } = require('../../services/suscripcionCobro');

function listar(req, res, ctx) {
    const { db, json } = ctx;
    if (!activo(db)) return json(res, { ok: false, error: 'El módulo de suscripciones está desactivado' }, 403);
    const subs = db.prepare('SELECT * FROM suscripciones ORDER BY estatus, proximo_cobro').all();
    const hoy = new Date().toISOString().slice(0, 10);
    const r2 = n => Math.round(n * 100) / 100;
    const activas = subs.filter(s => s.estatus === 'activa');
    return json(res, {
        suscripciones: subs,
        resumen: {
            mrr: r2(activas.reduce((s, x) => s + x.monto, 0)),   // ingreso recurrente mensual proyectado
            activas: activas.length,
            suspendidas: subs.filter(s => s.estatus === 'suspendida').length,
            por_cobrar_hoy: activas.filter(s => s.proximo_cobro && s.proximo_cobro <= hoy).length,
        },
    });
}

function crear(req, res, ctx, { ses }) {
    const { db, json, readJson } = ctx;
    if (!activo(db)) return json(res, { ok: false, error: 'Módulo desactivado' }, 403);
    return readJson(req, res, d => {
        const monto = Number(d.monto);
        if (!String(d.nombre || '').trim()) return json(res, { ok: false, error: 'Falta el nombre del cliente' }, 400);
        if (!(monto > 0)) return json(res, { ok: false, error: 'Monto inválido' }, 400);
        const diaCorte = Math.min(Math.max(parseInt(d.dia_corte) || 1, 1), 28);
        const suc = require('../../services/sucursalService').sucursalDeSesion(db, ses) || null;
        const r = db.prepare(`INSERT INTO suscripciones (id_cliente, nombre, telefono, concepto, monto, dia_corte, proximo_cobro, referencia, sucursal, creado_por)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
            d.id_cliente || null, String(d.nombre).trim(), String(d.telefono || '').replace(/\D/g, '') || null,
            String(d.concepto || '').trim() || 'Suscripción mensual', Math.round(monto * 100) / 100,
            diaCorte, proximaFecha(diaCorte), String(d.referencia || '').trim() || null, suc, ses.username || null);
        return json(res, { ok: true, id: r.lastInsertRowid });
    });
}

function actualizar(req, res, ctx, { params }) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, d => {
        const id = parseInt(params[0]);
        const s = db.prepare('SELECT * FROM suscripciones WHERE id=?').get(id);
        if (!s) return json(res, { ok: false, error: 'Suscripción no encontrada' }, 404);
        if (d.estatus && ['activa', 'suspendida', 'cancelada'].includes(d.estatus)) db.prepare('UPDATE suscripciones SET estatus=? WHERE id=?').run(d.estatus, id);
        if (d.monto != null && Number(d.monto) > 0) db.prepare('UPDATE suscripciones SET monto=? WHERE id=?').run(Math.round(Number(d.monto) * 100) / 100, id);
        if (d.dia_corte != null) { const dc = Math.min(Math.max(parseInt(d.dia_corte) || 1, 1), 28); db.prepare('UPDATE suscripciones SET dia_corte=?, proximo_cobro=? WHERE id=?').run(dc, proximaFecha(dc), id); }
        if (d.referencia !== undefined) db.prepare('UPDATE suscripciones SET referencia=? WHERE id=?').run(String(d.referencia).trim() || null, id);
        return json(res, { ok: true, id });
    });
}

function cobrar(req, res, ctx, { params, ses }) {
    const { db, json } = ctx;
    if (!activo(db)) return json(res, { ok: false, error: 'Módulo desactivado' }, 403);
    const id = parseInt(params[0]);
    const s = db.prepare('SELECT * FROM suscripciones WHERE id=?').get(id);
    if (!s) return json(res, { ok: false, error: 'Suscripción no encontrada' }, 404);
    if (s.estatus !== 'activa') return json(res, { ok: false, error: 'La suscripción no está activa' }, 400);
    try { const r = generarCargo(db, s, ses); return json(res, { ok: true, folio: r.folio, id_pedido: r.pedidoRowid, total: r.subtotal, proximo_cobro: r.proximo }); }
    catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// Genera los cargos de TODAS las activas vencidas hoy (o antes). Botón manual;
// el tick automático de stockWatcher (checkSuscripcionesVencidas) usa la MISMA lógica.
function generarCobros(req, res, ctx, { ses }) {
    const { db, json } = ctx;
    if (!activo(db)) return json(res, { ok: false, error: 'Módulo desactivado' }, 403);
    const r = generarCobrosVencidos(db, ses);
    return json(res, { ok: true, generados: r.generados, total: r.total });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/suscripciones',                     area: 'operacion', handler: listar },
    { metodo: 'POST', path: '/api/suscripciones',                     area: 'operacion', handler: crear },
    { metodo: 'POST', path: '/api/suscripciones/generar-cobros',      area: 'operacion', handler: generarCobros },
    { metodo: 'PUT',  path: /^\/api\/suscripciones\/(\d+)$/,          area: 'operacion', handler: actualizar },
    { metodo: 'POST', path: /^\/api\/suscripciones\/(\d+)\/cobrar$/,  area: 'operacion', handler: cobrar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/suscripciones' });
