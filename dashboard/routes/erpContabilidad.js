'use strict';
// ERP Fase 6: plan de cuentas, asientos (diario), libro mayor, tablero de
// dirección, reportes de rentabilidad, flujo de caja, salud financiera, gastos,
// impuestos y timbrado. Migrado al patrón declarativo del tronco: TODAS las
// rutas son area:'finanzas' (contabilidad/administrador/prime; el auditor pasa
// por su bypass de lectura). Bajo el prefijo /api/erp/ (convive con
// erpProveedores, que atiende proveedores/OC/CxP).
const conta = require('../../services/contabilidadService');
const { esAdminOMas } = require('../permisos');
const construirModulo = require('./_construirModulo');

// Redondeo a 2 decimales a nivel de MÓDULO (flujo-caja y salud-financiera lo
// usan; el tablero mantiene su const local, shadow inocuo).
const r2 = (n) => Math.round((n || 0) * 100) / 100;

function _rango(req) {
    const sp = new URL(req.url, 'http://x').searchParams;
    const hoy = new Date().toISOString().slice(0, 10);
    const mes = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return { desde: (sp.get('desde') || mes).slice(0, 10), hasta: (sp.get('hasta') || hoy).slice(0, 10) };
}

function planCuentas(req, res, ctx) {
    return ctx.json(res, ctx.db.prepare('SELECT * FROM plan_cuentas ORDER BY codigo').all());
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

function productosVendidos(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    const suc = _sucursalParam(req, db);   // multitienda 0051: qué vendió CADA tienda
    const filas = db.prepare(`
        SELECT COALESCE(pr.name, d.id_producto) producto, pr.sku,
               ROUND(SUM(d.cantidad),3) unidades, ROUND(SUM(d.precio_unitario * d.cantidad),2) total
        FROM pedido_detalle d
        JOIN pedidos p2 ON p2.id_pedido = d.id_pedido
        JOIN links_pago lp ON lp.id_pedido = p2.id_pedido AND lp.estatus='pagado'
        LEFT JOIN productos pr ON pr.id = d.id_producto
        WHERE date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ? AND (? = '' OR d.sucursal_origen = ?)
        GROUP BY d.id_producto ORDER BY total DESC LIMIT 500`).all(desde, hasta, suc, suc);
    const totalGeneral = filas.reduce((s, f) => s + (f.total || 0), 0);
    return json(res, { desde, hasta, sucursal: suc || null, filas, total: Math.round(totalGeneral * 100) / 100 });
}

function facturacionPendiente(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    const filas = db.prepare(`
        SELECT p2.id_pedido, p2.folio, p2.razon_social, p2.rfc, p2.cfdi_uuid, p2.cfdi_estatus,
               COALESCE((SELECT SUM(monto) FROM links_pago lp WHERE lp.id_pedido=p2.id_pedido AND lp.estatus='pagado'), p2.total) monto, p2.creado_en
        FROM pedidos p2
        WHERE (p2.rfc IS NOT NULL AND p2.rfc != '') AND date(p2.creado_en) >= ? AND date(p2.creado_en) <= ?
        ORDER BY p2.id_pedido DESC LIMIT 500`).all(desde, hasta);
    // ¿El PAC ya está activo? (para que la UI ofrezca timbrar directo)
    const pacActivo = require('../../services/pacService').activo(db);
    return json(res, { desde, hasta, filas, pac_activo: pacActivo });
}

// GET /api/erp/tablero — estado de resultados, balance, aging, rotación, etc.
function tablero(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    // multitienda 0051: con ?sucursal= el P&L/punto de equilibrio/categorías/
    // ticket se acotan a esa tienda; balance y aging siguen siendo del negocio
    // completo (no hay balance por tienda sin contabilidad segmentada plena).
    const suc = _sucursalParam(req, db);
    const may = conta.libroMayor(desde, hasta, suc || null);
    const cta = (c) => may.find(x => x.cuenta === c) || { debe: 0, haber: 0 };
    const ingresos = r2(cta('401').haber - cta('401').debe);
    const cogs = r2(cta('501').debe - cta('501').haber);
    const gastos = r2(cta('601').debe - cta('601').haber);
    const utilidad_bruta = r2(ingresos - cogs);
    const utilidad_operativa = r2(utilidad_bruta - gastos);
    const pyl = { ingresos, cogs, utilidad_bruta, gastos, utilidad_operativa,
        margen_bruto_pct: ingresos ? r2(utilidad_bruta / ingresos * 100) : 0,
        margen_neto_pct: ingresos ? r2(utilidad_operativa / ingresos * 100) : 0 };
    const margenContrib = ingresos > 0 ? (ingresos - cogs) / ingresos : 0;
    const puntoEquilibrio = {
        gastos_fijos: gastos, margen_contribucion_pct: r2(margenContrib * 100),
        ventas_equilibrio: margenContrib > 0 ? r2(gastos / margenContrib) : null,
        ventas_periodo: ingresos, holgura: margenContrib > 0 ? r2(ingresos - gastos / margenContrib) : null,
    };
    const acum = conta.libroMayor('1900-01-01', hasta);
    const porTipo = { activo: 0, pasivo: 0, capital: 0, ingreso: 0, costo: 0, gasto: 0 };
    for (const c of acum) {
        const t = c.tipo || '';
        if (t === 'activo' || t === 'costo' || t === 'gasto') porTipo[t] = (porTipo[t] || 0) + (c.debe - c.haber);
        else porTipo[t] = (porTipo[t] || 0) + (c.haber - c.debe);
    }
    const utilidad_acumulada = r2(porTipo.ingreso - porTipo.costo - porTipo.gasto);
    const cAcum = (c) => acum.find(x => x.cuenta === c) || { debe: 0, haber: 0 };
    const saldoDeudor = (c) => cAcum(c).debe - cAcum(c).haber;
    const caja = r2(saldoDeudor('101') + saldoDeudor('102'));
    const atado = r2(Math.max(0, saldoDeudor('115')) + Math.max(0, saldoDeudor('105')));
    const balance = {
        activos: r2(porTipo.activo), pasivos: r2(porTipo.pasivo),
        capital: r2(porTipo.capital + utilidad_acumulada), caja, utilidad_acumulada, atado,
        cuadra: Math.abs(porTipo.activo - (porTipo.pasivo + porTipo.capital + utilidad_acumulada)) < 0.5,
    };
    let aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    try {
        const cxc = db.prepare(`
            SELECT lp.monto, CAST(julianday('now','localtime') - julianday(p2.creado_en) AS INT) dias
            FROM links_pago lp JOIN pedidos p2 ON p2.id_pedido = lp.id_pedido
            WHERE lp.estatus != 'pagado' AND p2.estatus NOT IN ('cancelado')`).all();
        for (const x of cxc) {
            const b = x.dias <= 30 ? '0-30' : x.dias <= 60 ? '31-60' : x.dias <= 90 ? '61-90' : '90+';
            aging[b] = r2(aging[b] + (x.monto || 0));
        }
    } catch (_) {}
    let inventario = {};
    try {
        const valorInv = db.prepare("SELECT COALESCE(SUM(i.stock * COALESCE(pr.costo,0)),0) v FROM inventarios i JOIN productos pr ON pr.id = i.id_producto WHERE (? = '' OR i.sucursal = ?)").get(suc, suc).v;
        const diasPeriodo = Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1);
        const cogsDiario = cogs / diasPeriodo;
        inventario = {
            valor: r2(valorInv), cogs_periodo: cogs,
            dias_inventario: cogsDiario > 0 ? Math.round(valorInv / cogsDiario) : null,
            rotacion_anual: valorInv > 0 ? r2(cogs / diasPeriodo * 365 / valorInv) : null,
        };
    } catch (_) {}
    let categorias = [];
    try {
        categorias = db.prepare(`
            SELECT COALESCE(NULLIF(pr.cat,''), 'Sin categoría') categoria,
                   ROUND(SUM(d.precio_unitario * d.cantidad),2) ventas, ROUND(SUM(COALESCE(pr.costo,0) * d.cantidad),2) costo
            FROM pedido_detalle d
            JOIN pedidos p2 ON p2.id_pedido = d.id_pedido
            JOIN productos pr ON pr.id = d.id_producto
            JOIN links_pago lp ON lp.id_pedido = p2.id_pedido AND lp.estatus='pagado'
            WHERE date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ? AND (? = '' OR d.sucursal_origen = ?)
            GROUP BY categoria ORDER BY ventas DESC LIMIT 20`).all(desde, hasta, suc, suc)
            .map(c => ({ ...c, margen: r2(c.ventas - c.costo), margen_pct: c.ventas ? r2((c.ventas - c.costo) / c.ventas * 100) : 0 }));
    } catch (_) {}
    let ticket = {};
    try {
        const dias = Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1);
        const prevHasta = new Date(Date.parse(desde) - 86400000).toISOString().slice(0, 10);
        const prevDesde = new Date(Date.parse(desde) - dias * 86400000).toISOString().slice(0, 10);
        const q = (d1, d2) => db.prepare(`SELECT COALESCE(SUM(monto),0) t, COUNT(DISTINCT id_pedido) n FROM links_pago WHERE estatus='pagado' AND date(pagado_en)>=? AND date(pagado_en)<=? AND (? = '' OR id_pedido IN (SELECT id_pedido FROM pedido_detalle WHERE sucursal_origen=?))`).get(d1, d2, suc, suc);
        const act = q(desde, hasta), prev = q(prevDesde, prevHasta);
        const tAct = act.n ? act.t / act.n : 0, tPrev = prev.n ? prev.t / prev.n : 0;
        ticket = { actual: r2(tAct), anterior: r2(tPrev), pedidos: act.n, variacion_pct: tPrev ? r2((tAct - tPrev) / tPrev * 100) : null };
    } catch (_) {}
    let comparativo = null;
    try {
        const diasP = Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1);
        const prevH = new Date(Date.parse(desde) - 86400000).toISOString().slice(0, 10);
        const prevD = new Date(Date.parse(desde) - diasP * 86400000).toISOString().slice(0, 10);
        const mayP = conta.libroMayor(prevD, prevH, suc || null);
        const ctaP = (c) => mayP.find(x => x.cuenta === c) || { debe: 0, haber: 0 };
        const ingP = r2(ctaP('401').haber - ctaP('401').debe);
        const cogsP = r2(ctaP('501').debe - ctaP('501').haber);
        const gasP = r2(ctaP('601').debe - ctaP('601').haber);
        const utopP = r2(ingP - cogsP - gasP);
        const varPct = (a, b) => b ? r2((a - b) / Math.abs(b) * 100) : null;
        comparativo = {
            desde: prevD, hasta: prevH, ingresos: ingP, utilidad_operativa: utopP,
            margen_neto_pct: ingP ? r2(utopP / ingP * 100) : 0,
            var_ingresos_pct: varPct(ingresos, ingP), var_utilidad_pct: varPct(utilidad_operativa, utopP),
        };
    } catch (_) {}
    return json(res, { desde, hasta, sucursal: suc || null, pyl, comparativo, punto_equilibrio: puntoEquilibrio, balance, aging, inventario, categorias, ticket, conta_activa: conta.activo(),
        ...(suc ? { nota_sucursal: 'Balance y antigüedad de CxC son del negocio completo; P&L, categorías, ticket e inventario están acotados a ' + suc } : {}) });
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

function rentabilidadClientes(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    let filas = [];
    try {
        filas = db.prepare(`
            SELECT COALESCE(c.id, p2.cliente) AS id_cliente, COALESCE(c.nombre, p2.cliente) AS nombre, c.telefono,
                   COUNT(DISTINCT p2.id_pedido) AS pedidos, ROUND(SUM(d.precio_unitario * d.cantidad), 2) AS ventas,
                   ROUND(SUM(COALESCE(pr.costo, 0) * d.cantidad), 2) AS costo
            FROM pedido_detalle d
            JOIN pedidos p2 ON p2.id_pedido = d.id_pedido
            JOIN productos pr ON pr.id = d.id_producto
            JOIN links_pago lp ON lp.id_pedido = p2.id_pedido AND lp.estatus='pagado'
            LEFT JOIN clientes c ON c.id = p2.id_cliente
            WHERE date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ?
            GROUP BY COALESCE(c.id, p2.cliente)
            ORDER BY (SUM(d.precio_unitario * d.cantidad) - SUM(COALESCE(pr.costo,0) * d.cantidad)) DESC LIMIT 100`).all(desde, hasta)
            .map(r => ({ ...r, margen: r2(r.ventas - r.costo), margen_pct: r.ventas ? r2((r.ventas - r.costo) / r.ventas * 100) : 0 }));
        const deuda = db.prepare("SELECT p.id_cliente, ROUND(SUM(lp.monto),2) adeudo FROM pedidos p JOIN links_pago lp ON lp.id_pedido=p.id_pedido AND lp.estatus='generado' WHERE p.a_credito=1 GROUP BY p.id_cliente").all();
        const mapDeuda = {}; deuda.forEach(x => { mapDeuda[x.id_cliente] = x.adeudo; });
        filas.forEach(f => { f.adeudo_fiado = mapDeuda[f.id_cliente] || 0; });
    } catch (_) {}
    return json(res, { desde, hasta, clientes: filas });
}

function rentabilidadVendedores(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    let filas = [];
    try {
        const pct = parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='comision_pct'").get()?.valor || '0') || 0;
        filas = db.prepare(`
            SELECT p2.cobrado_por AS vendedor, COUNT(DISTINCT p2.id_pedido) AS pedidos,
                   ROUND(SUM(d.precio_unitario * d.cantidad), 2) AS ventas, ROUND(SUM(COALESCE(pr.costo, 0) * d.cantidad), 2) AS costo
            FROM pedido_detalle d
            JOIN pedidos p2 ON p2.id_pedido = d.id_pedido
            JOIN productos pr ON pr.id = d.id_producto
            JOIN links_pago lp ON lp.id_pedido = p2.id_pedido AND lp.estatus='pagado'
            WHERE date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ? AND p2.cobrado_por IS NOT NULL
            GROUP BY p2.cobrado_por
            ORDER BY (SUM(d.precio_unitario * d.cantidad) - SUM(COALESCE(pr.costo,0) * d.cantidad)) DESC`).all(desde, hasta)
            .map(r => ({ ...r, margen: r2(r.ventas - r.costo), margen_pct: r.ventas ? r2((r.ventas - r.costo) / r.ventas * 100) : 0, comision: r2(r.ventas * pct / 100) }));
        const fiado = db.prepare("SELECT p.cobrado_por, ROUND(SUM(lp.monto),2) fiado FROM pedidos p JOIN links_pago lp ON lp.id_pedido=p.id_pedido AND lp.estatus='generado' WHERE p.a_credito=1 AND p.cobrado_por IS NOT NULL GROUP BY p.cobrado_por").all();
        const mapF = {}; fiado.forEach(x => { mapF[x.cobrado_por] = x.fiado; });
        filas.forEach(f => { f.fiado_pendiente = mapF[f.vendedor] || 0; });
    } catch (_) {}
    return json(res, { desde, hasta, comision_pct: parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='comision_pct'").get()?.valor || '0') || 0, vendedores: filas });
}

// POST /api/erp/timbrar/:id — timbra el CFDI vía el PAC (async, hoy inerte)
function timbrar(req, res, ctx, { params }) {
    const { db, json } = ctx;
    return require('../../services/pacService').timbrar(db, parseInt(params[0]))
        .then(r => json(res, r.ok ? r : { ok: false, ...r }, r.ok ? 200 : 400))
        .catch(e => json(res, { ok: false, error: e.message }, 500));
}

// POST /api/erp/cfdi/:id/cancelar — cancela el CFDI ante el SAT (motivo opcional)
function cfdiCancelar(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        let motivo = '02'; try { motivo = JSON.parse(body || '{}').motivo || '02'; } catch (_) {}
        return require('../../services/pacService').cancelarCFDI(db, parseInt(params[0]), motivo)
            .then(r => json(res, r, r.ok ? 200 : 400))
            .catch(e => json(res, { ok: false, error: e.message }, 500));
    });
}

// POST /api/erp/cfdi/:id/rep — timbra el complemento de pago (factura PPD pagada)
function cfdiREP(req, res, ctx, { params }) {
    const { db, json } = ctx;
    return require('../../services/pacService').timbrarREP(db, parseInt(params[0]))
        .then(r => json(res, r, r.ok ? 200 : 400))
        .catch(e => json(res, { ok: false, error: e.message }, 500));
}

// GET /api/erp/cfdi/:id/:formato — descarga el PDF/XML del CFDI ya timbrado.
function cfdiDescargar(req, res, ctx, { params }) {
    const { db, json } = ctx;
    return require('../../services/pacService').descargarCFDI(db, parseInt(params[0]), params[1])
        .then(r => {
            if (!r.ok) return json(res, r, 400);
            res.writeHead(200, {
                'Content-Type': r.contentType,
                'Content-Disposition': 'attachment; filename="' + r.filename + '"',
                'Content-Length': r.buffer.length,
            });
            res.end(r.buffer);
        })
        .catch(e => json(res, { ok: false, error: e.message }, 500));
}

function saludFinanciera(req, res, ctx) {
    const { json } = ctx;
    if (!conta.activo()) return json(res, { conta_activa: false });
    const { desde, hasta } = _rango(req);
    const dias = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1);
    const per = conta.libroMayor(desde, hasta);
    const pc = (code) => { const r = per.find(x => x.cuenta === code); return r || { debe: 0, haber: 0 }; };
    const ventas = r2(pc('401').haber - pc('401').debe);
    const cogs = r2(pc('501').debe - pc('501').haber);
    const acum = conta.libroMayor('1900-01-01', hasta);
    const s = (code) => { const r = acum.find(x => x.cuenta === code); return r ? r.saldo : 0; };
    const caja = r2(s('101') + s('102'));
    const cxc = r2(s('105'));
    const inv = r2(s('115'));
    const cxp = r2(-s('201'));
    const ivaPorPagar = r2(-s('209'));
    const dio = cogs > 0 ? r2(inv / (cogs / dias)) : null;
    const dso = ventas > 0 ? r2(cxc / (ventas / dias)) : null;
    const dpo = cogs > 0 ? r2(cxp / (cogs / dias)) : null;
    const ccc = (dio != null && dso != null && dpo != null) ? r2(dio + dso - dpo) : null;
    const activoCirc = r2(caja + cxc + inv);
    const nominaPorPagar = r2(Math.max(0, -s('210')) + Math.max(0, -s('211')));
    const pasivoCirc = r2(cxp + Math.max(0, ivaPorPagar) + nominaPorPagar);
    return json(res, {
        desde, hasta, dias, conta_activa: true,
        dias_inventario: dio, dias_cobro: dso, dias_pago: dpo, ciclo_efectivo: ccc,
        activo_circulante: activoCirc, pasivo_circulante: pasivoCirc,
        razon_corriente: pasivoCirc > 0 ? r2(activoCirc / pasivoCirc) : null,
        prueba_acida: pasivoCirc > 0 ? r2((activoCirc - inv) / pasivoCirc) : null,
    });
}

function flujoCaja(req, res, ctx) {
    const { db, json } = ctx;
    const bucket = (col) => `CASE WHEN ${col} IS NULL THEN 'sin_fecha'
        WHEN ${col} < date('now','localtime') THEN 'vencido'
        WHEN ${col} <= date('now','localtime','+30 days') THEN 'd0_30'
        WHEN ${col} <= date('now','localtime','+60 days') THEN 'd31_60'
        ELSE 'd61mas' END`;
    const vacio = () => ({ vencido: 0, d0_30: 0, d31_60: 0, d61mas: 0, sin_fecha: 0 });
    const llenar = (rows) => { const o = vacio(); rows.forEach(r => { o[r.bucket] = r.monto || 0; }); o.total = r2(o.vencido + o.d0_30 + o.d31_60 + o.d61mas + o.sin_fecha); return o; };
    let saldo_actual = null, por_cobrar = vacio(), por_pagar = vacio();
    try {
        if (conta.activo()) {
            const may = conta.libroMayor('1900-01-01', new Date().toISOString().slice(0, 10));
            const s = (c) => { const r = may.find(x => x.cuenta === c); return r ? r.saldo : 0; };
            saldo_actual = r2(s('101') + s('102'));
        }
        por_cobrar = llenar(db.prepare(`
            SELECT ${bucket('p.fiado_vence_en')} AS bucket, ROUND(SUM(lp.monto),2) AS monto
            FROM pedidos p JOIN links_pago lp ON lp.id_pedido=p.id_pedido AND lp.estatus='generado'
            WHERE p.a_credito=1 GROUP BY bucket`).all());
        por_pagar = llenar(db.prepare(`
            SELECT ${bucket('vence_en')} AS bucket, ROUND(SUM(monto),2) AS monto
            FROM cuentas_pagar WHERE estatus='pendiente' GROUP BY bucket`).all());
        if (saldo_actual != null) {
            const mayN = conta.libroMayor('1900-01-01', new Date().toISOString().slice(0, 10));
            const sN = (c) => { const r = mayN.find(x => x.cuenta === c); return r ? r.saldo : 0; };
            const oblNom = r2(Math.max(0, -sN('210')) + Math.max(0, -sN('211')));
            if (oblNom > 0) { por_pagar.d0_30 = r2((por_pagar.d0_30 || 0) + oblNom); por_pagar.total = r2((por_pagar.total || 0) + oblNom); }
        }
    } catch (_) {}
    const base = saldo_actual || 0;
    const neto = (b) => r2((por_cobrar[b] || 0) - (por_pagar[b] || 0));
    const proyeccion = {
        hoy: saldo_actual,
        en_30d: r2(base + neto('vencido') + neto('d0_30')),
        en_60d: r2(base + neto('vencido') + neto('d0_30') + neto('d31_60')),
        en_90d: r2(base + neto('vencido') + neto('d0_30') + neto('d31_60') + neto('d61mas')),
    };
    return json(res, { saldo_actual, por_cobrar, por_pagar, proyeccion, conta_activa: conta.activo() });
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
function asientosPost(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            // Fecha malformada pasaría el candado lexicográfico de mes cerrado y
            // dejaría el asiento invisible en los rangos BETWEEN de los reportes.
            const fecha = String(d.fecha || '').slice(0, 10);
            if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json(res, { ok: false, error: 'Fecha inválida (YYYY-MM-DD)' }, 400);
            // multitienda 0051: póliza atribuible a una tienda (opcional)
            let sucManual = String(d.sucursal || '').trim() || null;
            if (sucManual && !db.prepare('SELECT 1 FROM sucursales WHERE nombre=?').get(sucManual)) sucManual = null;
            const id = conta.registrarAsiento({
                concepto: String(d.concepto || '').trim() || 'Asiento manual',
                referencia_tipo: 'manual',
                partidas: Array.isArray(d.partidas) ? d.partidas : [],
                fecha: fecha || null,
                sucursal: sucManual,
            });
            return json(res, { ok: true, id });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/erp/plan-cuentas',              area: 'finanzas', handler: planCuentas },
    { metodo: 'GET',  path: '/api/erp/asientos',                  area: 'finanzas', handler: asientosGet },
    { metodo: 'POST', path: '/api/erp/asientos',                  area: 'finanzas', handler: asientosPost },
    { metodo: 'GET',  path: '/api/erp/libro-mayor',               area: 'finanzas', handler: libroMayor },
    { metodo: 'GET',  path: '/api/erp/rastro',                    area: 'finanzas', handler: rastro },
    { metodo: 'GET',  path: '/api/erp/productos-vendidos',        area: 'finanzas', handler: productosVendidos },
    { metodo: 'GET',  path: '/api/erp/facturacion-pendiente',     area: 'finanzas', handler: facturacionPendiente },
    { metodo: 'GET',  path: '/api/erp/tablero',                   area: 'finanzas', handler: tablero },
    { metodo: 'GET',  path: '/api/erp/periodo-cierre',            area: 'finanzas', handler: periodoCierreGet },
    { metodo: 'PUT',  path: '/api/erp/periodo-cierre',            area: 'finanzas', handler: periodoCierrePut },
    { metodo: 'GET',  path: '/api/erp/rentabilidad-clientes',     area: 'finanzas', handler: rentabilidadClientes },
    { metodo: 'GET',  path: '/api/erp/rentabilidad-vendedores',   area: 'finanzas', handler: rentabilidadVendedores },
    { metodo: 'POST', path: /^\/api\/erp\/timbrar\/(\d+)$/,       area: 'finanzas', handler: timbrar },
    { metodo: 'GET',  path: /^\/api\/erp\/cfdi\/(\d+)\/(pdf|xml)$/, area: 'finanzas', handler: cfdiDescargar },
    { metodo: 'POST', path: /^\/api\/erp\/cfdi\/(\d+)\/cancelar$/,  area: 'finanzas', handler: cfdiCancelar },
    { metodo: 'POST', path: /^\/api\/erp\/cfdi\/(\d+)\/rep$/,       area: 'finanzas', handler: cfdiREP },
    { metodo: 'GET',  path: '/api/erp/salud-financiera',          area: 'finanzas', handler: saludFinanciera },
    { metodo: 'GET',  path: '/api/erp/flujo-caja',                area: 'finanzas', handler: flujoCaja },
    { metodo: 'POST', path: '/api/erp/gastos',                    area: 'finanzas', handler: gastosPost },
    { metodo: 'GET',  path: '/api/erp/gastos',                    area: 'finanzas', handler: gastosGet },
    { metodo: 'GET',  path: '/api/erp/impuestos',                 area: 'finanzas', handler: impuestos },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/erp/' });
