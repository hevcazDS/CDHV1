'use strict';
// ERP Fase 6 — núcleo contable: plan de cuentas, asientos (diario), libro
// mayor, rastro de folio, gastos, impuestos y cierre de período/ejercicio.
// Migrado al patrón declarativo del tronco: TODAS las rutas son
// area:'finanzas' (contabilidad/administrador/prime; el auditor pasa por su
// bypass de lectura). Bajo el prefijo /api/erp/ (convive con erpProveedores,
// erpTablero, erpCfdi, erpConciliacion, erpActivos — el split original de
// erpContabilidad.js por dominio, ver PLAN_V3.md).
const conta = require('../../services/contabilidadService');
const { esAdminOMas } = require('../permisos');
const construirModulo = require('./_construirModulo');

function _rango(req) {
    const sp = new URL(req.url, 'http://x').searchParams;
    const hoy = new Date().toISOString().slice(0, 10);
    const mes = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return { desde: (sp.get('desde') || mes).slice(0, 10), hasta: (sp.get('hasta') || hoy).slice(0, 10) };
}

function planCuentas(req, res, ctx) {
    return ctx.json(res, ctx.db.prepare('SELECT * FROM plan_cuentas ORDER BY codigo').all());
}

// Integridad contable: pagos sin asiento (ventana de crash) y ventas sin costo
// (producto sin costo → utilidad inflada). Solo lectura; el barrido automático
// (stockWatcher) repara los primeros. ?dias= acota (default 90).
function integridad(req, res, ctx) {
    const { json } = ctx;
    if (!conta.activo()) return json(res, { conta_activa: false });
    const dias = Math.max(1, parseInt(new URL(req.url, 'http://x').searchParams.get('dias') || '90', 10));
    const r = conta.ventasSinAsiento({ dias });
    return json(res, { conta_activa: true, dias, ...r, total_sin_venta: r.sin_venta.length, total_sin_costo: r.sin_costo.length });
}

// multitienda 0051: ?sucursal= validada contra el catálogo ('' = todo el negocio)
function _sucursalParam(req, db) {
    const s = ((new URL(req.url, 'http://x')).searchParams.get('sucursal') || '').trim();
    if (!s) return '';
    try { return db.prepare('SELECT 1 FROM sucursales WHERE nombre=?').get(s) ? s : ''; } catch (_) { return ''; }
}

function asientosGet(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    const asientos = db.prepare('SELECT * FROM asientos WHERE fecha >= ? AND fecha <= ? ORDER BY id DESC LIMIT 200').all(desde, hasta);
    const det = db.prepare(`SELECT d.cuenta, pc.nombre, d.debe, d.haber FROM asientos_detalle d LEFT JOIN plan_cuentas pc ON pc.codigo = d.cuenta WHERE d.id_asiento=?`);
    return json(res, asientos.map(a => ({ ...a, partidas: det.all(a.id) })));
}

function libroMayor(req, res, ctx) {
    const { desde, hasta } = _rango(req);
    const suc = _sucursalParam(req, ctx.db);
    return ctx.json(res, { desde, hasta, sucursal: suc || null, cuentas: conta.libroMayor(desde, hasta, suc || null) });
}

// POST /api/erp/cierre-anual — { anio } cierra el ejercicio (resultados → capital).
function cierreAnualPost(req, res, ctx) {
    const { json, readJson } = ctx;
    return readJson(req, res, d => {
        try { const r = conta.cierreAnual(d.anio); return json(res, r, r && r.ok === false ? 400 : 200); }
        catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}

// GET /api/erp/rastro — cadena completa desde un folio
function rastro(req, res, ctx) {
    const { db, json } = ctx;
    const q = ((new URL(req.url, 'http://x')).searchParams.get('folio') || '').trim();
    if (!q) return json(res, { ok: false, error: 'Falta folio' }, 400);
    const ped = db.prepare('SELECT * FROM pedidos WHERE folio=? OR id_pedido=? LIMIT 1').get(q, parseInt(q.replace(/\D/g, ''), 10) || -1);
    if (!ped) return json(res, { ok: false, error: 'No encontré pedido con folio ' + q }, 404);
    const id = ped.id_pedido, folio = ped.folio || ('#' + id);
    const like1 = '%' + folio + '%', like2 = '%pedido ' + id + '%';
    return json(res, {
        ok: true, pedido: ped,
        detalle: db.prepare('SELECT d.*, pr.name FROM pedido_detalle d LEFT JOIN productos pr ON pr.id=d.id_producto WHERE d.id_pedido=?').all(id),
        pagos: db.prepare('SELECT * FROM links_pago WHERE id_pedido=?').all(id),
        kardex: db.prepare('SELECT * FROM inventario_movimientos WHERE motivo LIKE ? OR motivo LIKE ? ORDER BY id').all(like1, like2),
        asientos: db.prepare(`SELECT a.*, (SELECT GROUP_CONCAT(d2.cuenta || ' $' || COALESCE(NULLIF(d2.debe,0), d2.haber), ' · ') FROM asientos_detalle d2 WHERE d2.id_asiento=a.id) partidas_txt
                              FROM asientos a WHERE a.referencia_id=? OR a.concepto LIKE ? OR a.concepto LIKE ? ORDER BY a.id`).all(String(id), like1, like2),
        devoluciones: db.prepare('SELECT * FROM devoluciones WHERE id_pedido=?').all(id),
    });
}

function periodoCierreGet(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, { cerrado: db.prepare("SELECT valor FROM configuracion WHERE clave='periodo_cerrado'").get()?.valor || null });
}
function periodoCierrePut(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const v = String(JSON.parse(body || '{}').cerrado || '').trim();
            if (v && !/^\d{4}-\d{2}$/.test(v)) return json(res, { ok: false, error: 'Formato YYYY-MM (o vacío para reabrir)' }, 400);
            require('../../services/configAudit').logCambio(db, 'periodo_cerrado', v || null, ses.username);
            if (v) db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('periodo_cerrado', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(v);
            else db.prepare("DELETE FROM configuracion WHERE clave='periodo_cerrado'").run();
            ctx.log.info('[contable] período ' + (v ? 'cerrado hasta ' + v : 'REABIERTO') + ' por ' + ses.username);
            return json(res, { ok: true, cerrado: v || null });
        } catch (e2) { return json(res, { ok: false, error: e2.message }, 500); }
    });
}

// POST /api/erp/gastos — registrar gasto directo (asiento 601)
function gastosPost(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const monto = Number(d.monto);
            if (!String(d.concepto || '').trim() || !(monto > 0)) return json(res, { ok: false, error: 'Faltan concepto o monto' }, 400);
            if (!conta.activo()) return json(res, { ok: false, error: 'Activa el módulo Contabilidad en Módulos para registrar gastos' }, 400);
            const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : null;
            const mesCerrado = conta.mesCerradoDe(fecha);
            if (mesCerrado) {
                if (!esAdminOMas(ses.rol)) {
                    return json(res, { ok: false, error: 'El período ' + mesCerrado + ' está cerrado. Solo un Administrador o Prime puede autorizar la captura en meses cerrados.', mes_cerrado: mesCerrado }, 409);
                }
                require('../../services/configAudit').logCambio(db, 'gasto_mes_cerrado', (fecha || '').slice(0, 7) + ' · ' + String(d.concepto).trim() + ' $' + monto, ses.username);
            }
            // multitienda 0051: gasto atribuible a una tienda (opcional)
            let sucGasto = String(d.sucursal || '').trim() || null;
            if (sucGasto && !db.prepare('SELECT 1 FROM sucursales WHERE nombre=?').get(sucGasto)) sucGasto = null;
            const id = conta.asientoGasto(String(d.concepto).trim(), monto, d.metodo === 'bancos' ? 'bancos' : 'caja', !!d.con_iva, { fecha, override: !!mesCerrado, sucursal: sucGasto });
            return json(res, { ok: true, id_asiento: id, en_mes_cerrado: !!mesCerrado });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}
function gastosGet(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    const gastos = db.prepare(`
        SELECT a.id, a.fecha, a.concepto, COALESCE(SUM(d.haber), 0) total
        FROM asientos a JOIN asientos_detalle d ON d.id_asiento = a.id
        WHERE a.referencia_tipo='gasto' AND a.fecha >= ? AND a.fecha <= ?
        GROUP BY a.id ORDER BY a.id DESC LIMIT 200`).all(desde, hasta);
    return json(res, gastos);
}

function impuestos(req, res, ctx) {
    const { json } = ctx;
    const { desde, hasta } = _rango(req);
    const cuentas = conta.libroMayor(desde, hasta);
    const de = (cod) => cuentas.find(c => c.cuenta === cod) || { debe: 0, haber: 0 };
    const trasladado = Math.round((de('209').haber - de('209').debe) * 100) / 100;
    const acreditable = Math.round((de('119').debe - de('119').haber) * 100) / 100;
    return json(res, {
        desde, hasta,
        ventas_base: Math.round((de('401').haber - de('401').debe) * 100) / 100,
        gastos: Math.round((de('601').debe - de('601').haber) * 100) / 100,
        iva_trasladado: trasladado, iva_acreditable: acreditable,
        iva_resultado: Math.round((trasladado - acreditable) * 100) / 100,
    });
}

// POST /api/erp/asientos — asiento manual
function asientosPost(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            // Fecha malformada pasaría el candado lexicográfico de mes cerrado y
            // dejaría el asiento invisible en los rangos BETWEEN de los reportes.
            const fecha = String(d.fecha || '').slice(0, 10);
            if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json(res, { ok: false, error: 'Fecha inválida (YYYY-MM-DD)' }, 400);
            const mesCerrado = conta.mesCerradoDe(fecha || null);
            if (mesCerrado) {
                if (!esAdminOMas(ses.rol)) {
                    return json(res, { ok: false, error: 'El período ' + mesCerrado + ' está cerrado. Solo un Administrador o Prime puede autorizar la captura en meses cerrados.', mes_cerrado: mesCerrado }, 409);
                }
                require('../../services/configAudit').logCambio(db, 'asiento_mes_cerrado', (fecha || '').slice(0, 7) + ' · ' + (String(d.concepto || '').trim() || 'Asiento manual'), ses.username);
            }
            // multitienda 0051: póliza atribuible a una tienda (opcional)
            let sucManual = String(d.sucursal || '').trim() || null;
            if (sucManual && !db.prepare('SELECT 1 FROM sucursales WHERE nombre=?').get(sucManual)) sucManual = null;
            const id = conta.registrarAsiento({
                concepto: String(d.concepto || '').trim() || 'Asiento manual',
                referencia_tipo: 'manual',
                partidas: Array.isArray(d.partidas) ? d.partidas : [],
                fecha: fecha || null,
                override: !!mesCerrado,
                sucursal: sucManual,
            });
            return json(res, { ok: true, id, en_mes_cerrado: !!mesCerrado });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/erp/plan-cuentas',              area: 'finanzas', handler: planCuentas },
    { metodo: 'GET',  path: '/api/erp/integridad',                area: 'finanzas', handler: integridad },
    { metodo: 'GET',  path: '/api/erp/asientos',                  area: 'finanzas', handler: asientosGet },
    { metodo: 'POST', path: '/api/erp/asientos',                  area: 'finanzas', handler: asientosPost },
    { metodo: 'GET',  path: '/api/erp/libro-mayor',               area: 'finanzas', handler: libroMayor },
    { metodo: 'GET',  path: '/api/erp/rastro',                    area: 'finanzas', handler: rastro },
    { metodo: 'GET',  path: '/api/erp/periodo-cierre',            area: 'finanzas', handler: periodoCierreGet },
    { metodo: 'PUT',  path: '/api/erp/periodo-cierre',            area: 'finanzas', handler: periodoCierrePut },
    { metodo: 'POST', path: '/api/erp/cierre-anual',              area: 'finanzas', handler: cierreAnualPost },
    { metodo: 'POST', path: '/api/erp/gastos',                    area: 'finanzas', handler: gastosPost },
    { metodo: 'GET',  path: '/api/erp/gastos',                    area: 'finanzas', handler: gastosGet },
    { metodo: 'GET',  path: '/api/erp/impuestos',                 area: 'finanzas', handler: impuestos },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/erp/' });
