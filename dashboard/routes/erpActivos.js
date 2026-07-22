'use strict';
// ERP Fase 6 — activos fijos: capitalización, baja, depreciación lineal y
// revaluación. Split por dominio de erpContabilidad.js (ver PLAN_V3.md).
// Migrado al patrón declarativo del tronco: TODAS las rutas son
// area:'finanzas' (contabilidad/administrador/prime; el auditor pasa por su
// bypass de lectura). Bajo el prefijo /api/erp/.
const construirModulo = require('./_construirModulo');

// ── Activos fijos (capitalización + depreciación lineal) ────────────────────
function activosGet(req, res, ctx) {
    const inc = new URL(req.url, 'http://x').searchParams.get('incluir_bajas') === '1';
    return ctx.json(res, require('../../services/activosFijosService').listar({ incluirBajas: inc }));
}
function activosPost(req, res, ctx) {
    const { json, readJson } = ctx;
    return readJson(req, res, d => {
        try {
            const r = require('../../services/activosFijosService').comprarActivo({
                nombre: d.nombre, categoria: d.categoria, costo: Number(d.costo),
                valor_residual: Number(d.valor_residual) || 0, vida_util_meses: Number(d.vida_util_meses) || 60,
                fecha: d.fecha || null, metodo: d.metodo === 'caja' ? 'caja' : 'bancos', sucursal: d.sucursal || null,
            });
            return json(res, { ok: true, ...r });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}
function activosBaja(req, res, ctx, { params }) {
    const { json, readJson } = ctx;
    return readJson(req, res, d => {
        try { return json(res, { ok: true, ...require('../../services/activosFijosService').darDeBaja(parseInt(params[0]), d.motivo || '') }); }
        catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}
function activosDepreciar(req, res, ctx) {
    const { json, readJson } = ctx;
    return readJson(req, res, d => {
        const n = require('../../services/activosFijosService').depreciarMes(d.fecha || null);
        return json(res, { ok: true, depreciados: n });
    });
}
// POST /api/erp/activos/:id/revaluar — { nuevo_valor } reconoce plusvalía al alza.
function activosRevaluar(req, res, ctx, { params }) {
    const { json, readJson } = ctx;
    return readJson(req, res, d => {
        try { return json(res, { ok: true, ...require('../../services/activosFijosService').revaluarActivo({ id: parseInt(params[0]), nuevo_valor: d.nuevo_valor, fecha: d.fecha || null }) }); }
        catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/erp/activos',                   area: 'finanzas', handler: activosGet },
    { metodo: 'POST', path: '/api/erp/activos',                   area: 'finanzas', handler: activosPost },
    { metodo: 'POST', path: /^\/api\/erp\/activos\/(\d+)\/baja$/, area: 'finanzas', handler: activosBaja },
    { metodo: 'POST', path: '/api/erp/activos/depreciar',         area: 'finanzas', handler: activosDepreciar },
    { metodo: 'POST', path: /^\/api\/erp\/activos\/(\d+)\/revaluar$/, area: 'finanzas', handler: activosRevaluar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/erp/' });
