'use strict';
// ERP Fase 6/Ola 4 — conciliación bancaria + baúl contable (archivero fiscal
// de CFDI). Split por dominio de erpContabilidad.js (ver PLAN_V3.md). Migrado
// al patrón declarativo del tronco: TODAS las rutas son area:'finanzas'
// (contabilidad/administrador/prime; el auditor pasa por su bypass de
// lectura). Bajo el prefijo /api/erp/.
const construirModulo = require('./_construirModulo');

// Casa cada línea del banco contra un cobro (links_pago pagado) o un pago
// (cuentas_pagar pagada) por monto exacto y fecha cercana (±3 días). El valor:
// destapar el movimiento del banco que NO corresponde a nada registrado.
const _VENTANA_DIAS = 3;
function _autoMatch(db, mov) {
    if (mov.monto > 0) { // ingreso → cobro pagado no casado
        const r = db.prepare(`SELECT id FROM links_pago
            WHERE estatus='pagado' AND ABS(monto - ?) < 0.01 AND pagado_en IS NOT NULL
              AND ABS(julianday(date(pagado_en)) - julianday(?)) <= ?
              AND id NOT IN (SELECT match_id FROM movimientos_banco WHERE match_tipo='link_pago' AND match_id IS NOT NULL)
            ORDER BY ABS(julianday(date(pagado_en)) - julianday(?)) LIMIT 1`).get(mov.monto, mov.fecha, _VENTANA_DIAS, mov.fecha);
        if (r) return { tipo: 'link_pago', id: r.id };
    } else if (mov.monto < 0) { // egreso → CxP pagada no casada
        const r = db.prepare(`SELECT id FROM cuentas_pagar
            WHERE estatus='pagada' AND ABS(monto - ?) < 0.01 AND pagada_en IS NOT NULL
              AND ABS(julianday(date(pagada_en)) - julianday(?)) <= ?
              AND id NOT IN (SELECT match_id FROM movimientos_banco WHERE match_tipo='cuenta_pagar' AND match_id IS NOT NULL)
            ORDER BY ABS(julianday(date(pagada_en)) - julianday(?)) LIMIT 1`).get(-mov.monto, mov.fecha, _VENTANA_DIAS, mov.fecha);
        if (r) return { tipo: 'cuenta_pagar', id: r.id };
    }
    return null;
}

// POST /api/erp/conciliacion/importar — { movimientos:[{fecha,concepto,monto,referencia}] }
// (el frontend parsea el CSV). Inserta con un lote y auto-casa lo que puede.
function conciliacionImportar(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const movs = (Array.isArray(d.movimientos) ? d.movimientos : [])
                .map(m => ({ fecha: String(m.fecha || '').slice(0, 10), concepto: String(m.concepto || '').slice(0, 200), monto: Math.round((Number(m.monto) || 0) * 100) / 100, referencia: String(m.referencia || '').slice(0, 80) || null }))
                .filter(m => /^\d{4}-\d{2}-\d{2}$/.test(m.fecha) && m.monto !== 0);
            if (!movs.length) return json(res, { ok: false, error: 'No hay movimientos válidos (fecha YYYY-MM-DD + monto ≠ 0)' }, 400);
            const lote = 'L' + Date.now();
            const suc = require('../../services/sucursalService').sucursalDeSesion(db, ses) || null;
            const ins = db.prepare('INSERT INTO movimientos_banco (fecha, concepto, monto, referencia, lote, sucursal) VALUES (?,?,?,?,?,?)');
            const upd = db.prepare("UPDATE movimientos_banco SET conciliado=1, match_tipo=?, match_id=? WHERE id=?");
            let casados = 0;
            const total = db.transaction(() => {
                for (const m of movs) {
                    const r = ins.run(m.fecha, m.concepto, m.monto, m.referencia, lote, suc);
                    const match = _autoMatch(db, m);
                    if (match) { upd.run(match.tipo, match.id, r.lastInsertRowid); casados++; }
                }
                return movs.length;
            })();
            return json(res, { ok: true, lote, importados: total, conciliados_auto: casados, sin_conciliar: total - casados });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}

// GET /api/erp/conciliacion?desde=&hasta= — movimientos + resumen
function conciliacionGet(req, res, ctx) {
    const { db, json } = ctx;
    const sp = new URL(req.url, 'http://x').searchParams;
    const hasta = (sp.get('hasta') || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const desde = (sp.get('desde') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).slice(0, 10);
    const movs = db.prepare(`SELECT id, fecha, concepto, monto, referencia, conciliado, match_tipo, match_id
        FROM movimientos_banco WHERE fecha>=? AND fecha<=? ORDER BY fecha DESC, id DESC LIMIT 1000`).all(desde, hasta);
    const r2 = n => Math.round(n * 100) / 100;
    const ingresos = r2(movs.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0));
    const egresos = r2(movs.filter(m => m.monto < 0).reduce((s, m) => s + m.monto, 0));
    const sinConciliar = movs.filter(m => !m.conciliado);
    return json(res, {
        desde, hasta, movimientos: movs,
        resumen: { total: movs.length, conciliados: movs.filter(m => m.conciliado).length, sin_conciliar: sinConciliar.length,
            ingresos, egresos, neto: r2(ingresos + egresos), monto_sin_conciliar: r2(sinConciliar.reduce((s, m) => s + m.monto, 0)) },
    });
}

// POST /api/erp/conciliacion/:id — conciliar/desconciliar manual
// body: { match_tipo, match_id }  ó  { conciliar:false }
function conciliacionConciliar(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            if (!db.prepare('SELECT 1 FROM movimientos_banco WHERE id=?').get(id)) return json(res, { ok: false, error: 'Movimiento no encontrado' }, 404);
            if (d.conciliar === false) {
                db.prepare("UPDATE movimientos_banco SET conciliado=0, match_tipo=NULL, match_id=NULL WHERE id=?").run(id);
                return json(res, { ok: true, id, conciliado: false });
            }
            const tipo = ['link_pago', 'cuenta_pagar', 'manual'].includes(d.match_tipo) ? d.match_tipo : 'manual';
            db.prepare("UPDATE movimientos_banco SET conciliado=1, match_tipo=?, match_id=? WHERE id=?").run(tipo, d.match_id != null ? parseInt(d.match_id) : null, id);
            return json(res, { ok: true, id, conciliado: true, match_tipo: tipo });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}

// GET /api/erp/baul?mes=YYYY-MM — archivero fiscal: CFDI del mes + estado de archivo
function baulGet(req, res, ctx) {
    const { db, json } = ctx;
    const baul = require('../../services/baulContable');
    if (!baul.activo(db)) return json(res, { ok: false, error: 'Activa el módulo "Baúl contable" en Módulos' }, 400);
    const mes = new URL(req.url, 'http://x').searchParams.get('mes');
    return json(res, { ok: true, ...baul.listar(db, mes) });
}
// GET /api/erp/baul/exportar?mes=YYYY-MM — descarga el .zip con los XML del mes
function baulExportar(req, res, ctx) {
    const { db, json } = ctx;
    const baul = require('../../services/baulContable');
    if (!baul.activo(db)) return json(res, { ok: false, error: 'Activa el módulo "Baúl contable" en Módulos' }, 400);
    const mes = new URL(req.url, 'http://x').searchParams.get('mes');
    return baul.exportarZip(db, mes).then(r => {
        if (!r.ok) return json(res, r, 400);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${r.nombre}"`, 'Content-Length': r.zip.length });
        return res.end(r.zip);
    }).catch(e => json(res, { ok: false, error: e.message }, 500));
}

const RUTAS = [
    { metodo: 'POST', path: '/api/erp/conciliacion/importar',     area: 'finanzas', handler: conciliacionImportar },
    { metodo: 'GET',  path: '/api/erp/conciliacion',              area: 'finanzas', handler: conciliacionGet },
    { metodo: 'POST', path: /^\/api\/erp\/conciliacion\/(\d+)$/,  area: 'finanzas', handler: conciliacionConciliar },
    { metodo: 'GET',  path: '/api/erp/baul',                      area: 'finanzas', handler: baulGet },
    { metodo: 'GET',  path: '/api/erp/baul/exportar',             area: 'finanzas', handler: baulExportar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/erp/' });
