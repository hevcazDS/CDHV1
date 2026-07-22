'use strict';
// ERP Fase 6 — tablero de dirección, reportes de rentabilidad, flujo de caja,
// salud financiera, unit economics y gasto de marketing. Split por dominio de
// erpContabilidad.js (ver PLAN_V3.md). Migrado al patrón declarativo del
// tronco: TODAS las rutas son area:'finanzas' (contabilidad/administrador/
// prime; el auditor pasa por su bypass de lectura). Bajo el prefijo /api/erp/.
const conta = require('../../services/contabilidadService');
const construirModulo = require('./_construirModulo');

// Redondeo a 2 decimales a nivel de MÓDULO (flujo-caja, salud-financiera y los
// helpers del tablero lo usan).
const r2 = (n) => Math.round((n || 0) * 100) / 100;

function _rango(req) {
    const sp = new URL(req.url, 'http://x').searchParams;
    const hoy = new Date().toISOString().slice(0, 10);
    const mes = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return { desde: (sp.get('desde') || mes).slice(0, 10), hasta: (sp.get('hasta') || hoy).slice(0, 10) };
}

// multitienda 0051: ?sucursal= validada contra el catálogo ('' = todo el negocio)
function _sucursalParam(req, db) {
    const s = ((new URL(req.url, 'http://x')).searchParams.get('sucursal') || '').trim();
    if (!s) return '';
    try { return db.prepare('SELECT 1 FROM sucursales WHERE nombre=?').get(s) ? s : ''; } catch (_) { return ''; }
}

// POST /api/erp/gasto-marketing { monto, fecha, concepto, metodo } — registra un
// gasto de PUBLICIDAD en la subcuenta 602 (finanzas P1) → alimenta el CAC solo.
function gastoMarketingPost(req, res, ctx) {
    const { json, readJson } = ctx;
    return readJson(req, res, d => {
        const monto = Number(d.monto);
        if (!(monto > 0)) return json(res, { ok: false, error: 'El monto debe ser mayor a 0' }, 400);
        if (!conta.activo()) return json(res, { ok: false, error: 'Enciende Contabilidad para registrar el gasto' }, 400);
        try {
            conta.asientoGasto(String(d.concepto || 'Publicidad').slice(0, 120), monto, d.metodo === 'caja' ? 'caja' : 'bancos', !!d.con_iva,
                { cuentaCargo: '602', fecha: d.fecha || null });
            return json(res, { ok: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    });
}
// GET /api/erp/gasto-marketing?desde&hasta — total de publicidad (602) del período.
function gastoMarketingGet(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    let total = 0;
    try {
        const r = db.prepare(`SELECT COALESCE(SUM(dd.debe - dd.haber),0) g FROM asientos a JOIN asientos_detalle dd ON dd.id_asiento=a.id WHERE dd.cuenta='602' AND a.fecha BETWEEN ? AND ?`).get(desde, hasta);
        total = Math.round((r.g || 0) * 100) / 100;
    } catch (_) {}
    return json(res, { desde, hasta, gasto_marketing: total });
}

// GET /api/erp/unit-economics?desde&hasta&gasto_adquisicion — CAC/LTV/Ratio.
// gasto_adquisicion (publicidad + ventas) es opcional: sin él usa
// configuracion.gasto_marketing_mensual; sin ninguno → sin_datos. 0 = orgánico.
function unitEconomics(req, res, ctx) {
    const { desde, hasta } = _rango(req);
    const g = new URL(req.url, 'http://x').searchParams.get('gasto_adquisicion');
    const salud = require('../../services/saludNegocioService')
        .calcularSaludNegocio({ desde, hasta, gastoAdquisicion: g });
    return ctx.json(res, salud);
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

// Fecha del período previo (misma duración, inmediatamente anterior a `desde`).
// Compartido por _tableroComparativo y _tableroTicket: ambos derivaban este
// mismo rango de forma independiente (mismo cálculo, variables con nombre
// distinto) — se centraliza aquí para no tener la lógica duplicada.
function _periodoAnterior(desde, hasta) {
    const dias = Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1);
    const prevHasta = new Date(Date.parse(desde) - 86400000).toISOString().slice(0, 10);
    const prevDesde = new Date(Date.parse(desde) - dias * 86400000).toISOString().slice(0, 10);
    return { prevDesde, prevHasta };
}

// Estado de resultados + punto de equilibrio (comparten el mismo libro mayor
// del período, por eso van juntos en un solo helper en vez de dos).
function _tableroPL(desde, hasta, suc) {
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
    return { pyl, puntoEquilibrio, ingresos, cogs, gastos, utilidad_operativa };
}

// Balance general acumulado (siempre negocio completo, sin acotar a sucursal
// — no hay contabilidad segmentada plena por tienda, ver comentario en tablero()).
function _tableroBalance(hasta) {
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
    return {
        activos: r2(porTipo.activo), pasivos: r2(porTipo.pasivo),
        capital: r2(porTipo.capital + utilidad_acumulada), caja, utilidad_acumulada, atado,
        cuadra: Math.abs(porTipo.activo - (porTipo.pasivo + porTipo.capital + utilidad_acumulada)) < 0.5,
    };
}

// Antigüedad de cuentas por cobrar vencidas (links de pago no pagados).
function _tableroAging(db) {
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
    return aging;
}

// Valor de inventario + rotación (usa el `cogs` del P&L del mismo período, no
// lo recalcula).
function _tableroInventario(db, desde, hasta, suc, cogs) {
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
    return inventario;
}

// Ventas/margen por categoría del período.
function _tableroMargenes(db, desde, hasta, suc) {
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
    return categorias;
}

// Ticket promedio actual vs. período anterior.
function _tableroTicket(db, desde, hasta, suc) {
    let ticket = {};
    try {
        const { prevDesde, prevHasta } = _periodoAnterior(desde, hasta);
        const q = (d1, d2) => db.prepare(`SELECT COALESCE(SUM(monto),0) t, COUNT(DISTINCT id_pedido) n FROM links_pago WHERE estatus='pagado' AND date(pagado_en)>=? AND date(pagado_en)<=? AND (? = '' OR id_pedido IN (SELECT id_pedido FROM pedido_detalle WHERE sucursal_origen=?))`).get(d1, d2, suc, suc);
        const act = q(desde, hasta), prev = q(prevDesde, prevHasta);
        const tAct = act.n ? act.t / act.n : 0, tPrev = prev.n ? prev.t / prev.n : 0;
        ticket = { actual: r2(tAct), anterior: r2(tPrev), pedidos: act.n, variacion_pct: tPrev ? r2((tAct - tPrev) / tPrev * 100) : null };
    } catch (_) {}
    return ticket;
}

// Ingresos/utilidad del período anterior + variación % vs. el actual.
function _tableroComparativo(desde, hasta, suc, ingresos, utilidad_operativa) {
    let comparativo = null;
    try {
        const { prevDesde, prevHasta } = _periodoAnterior(desde, hasta);
        const mayP = conta.libroMayor(prevDesde, prevHasta, suc || null);
        const ctaP = (c) => mayP.find(x => x.cuenta === c) || { debe: 0, haber: 0 };
        const ingP = r2(ctaP('401').haber - ctaP('401').debe);
        const cogsP = r2(ctaP('501').debe - ctaP('501').haber);
        const gasP = r2(ctaP('601').debe - ctaP('601').haber);
        const utopP = r2(ingP - cogsP - gasP);
        const varPct = (a, b) => b ? r2((a - b) / Math.abs(b) * 100) : null;
        comparativo = {
            desde: prevDesde, hasta: prevHasta, ingresos: ingP, utilidad_operativa: utopP,
            margen_neto_pct: ingP ? r2(utopP / ingP * 100) : 0,
            var_ingresos_pct: varPct(ingresos, ingP), var_utilidad_pct: varPct(utilidad_operativa, utopP),
        };
    } catch (_) {}
    return comparativo;
}

// GET /api/erp/tablero — estado de resultados, balance, aging, rotación, etc.
function tablero(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    // multitienda 0051: con ?sucursal= el P&L/punto de equilibrio/categorías/
    // ticket se acotan a esa tienda; balance y aging siguen siendo del negocio
    // completo (no hay balance por tienda sin contabilidad segmentada plena).
    const suc = _sucursalParam(req, db);
    const { pyl, puntoEquilibrio, ingresos, cogs, utilidad_operativa } = _tableroPL(desde, hasta, suc);
    const balance = _tableroBalance(hasta);
    const aging = _tableroAging(db);
    const inventario = _tableroInventario(db, desde, hasta, suc, cogs);
    const categorias = _tableroMargenes(db, desde, hasta, suc);
    const ticket = _tableroTicket(db, desde, hasta, suc);
    const comparativo = _tableroComparativo(desde, hasta, suc, ingresos, utilidad_operativa);
    return json(res, { desde, hasta, sucursal: suc || null, pyl, comparativo, punto_equilibrio: puntoEquilibrio, balance, aging, inventario, categorias, ticket, conta_activa: conta.activo(),
        ...(suc ? { nota_sucursal: 'Balance y antigüedad de CxC son del negocio completo; P&L, categorías, ticket e inventario están acotados a ' + suc } : {}) });
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

const RUTAS = [
    { metodo: 'GET',  path: '/api/erp/productos-vendidos',        area: 'finanzas', handler: productosVendidos },
    { metodo: 'GET',  path: '/api/erp/tablero',                   area: 'finanzas', handler: tablero },
    { metodo: 'GET',  path: '/api/erp/unit-economics',            area: 'finanzas', handler: unitEconomics },
    { metodo: 'GET',  path: '/api/erp/gasto-marketing',           area: 'finanzas', handler: gastoMarketingGet },
    { metodo: 'POST', path: '/api/erp/gasto-marketing',           area: 'finanzas', handler: gastoMarketingPost },
    { metodo: 'GET',  path: '/api/erp/rentabilidad-clientes',     area: 'finanzas', handler: rentabilidadClientes },
    { metodo: 'GET',  path: '/api/erp/rentabilidad-vendedores',   area: 'finanzas', handler: rentabilidadVendedores },
    { metodo: 'GET',  path: '/api/erp/salud-financiera',          area: 'finanzas', handler: saludFinanciera },
    { metodo: 'GET',  path: '/api/erp/flujo-caja',                area: 'finanzas', handler: flujoCaja },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/erp/' });
