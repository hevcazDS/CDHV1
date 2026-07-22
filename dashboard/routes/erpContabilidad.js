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
// POST /api/erp/cierre-anual — { anio } cierra el ejercicio (resultados → capital).
function cierreAnualPost(req, res, ctx) {
    const { json, readJson } = ctx;
    return readJson(req, res, d => {
        try { const r = conta.cierreAnual(d.anio); return json(res, r, r && r.ok === false ? 400 : 200); }
        catch (e) { return json(res, { ok: false, error: e.message }, 400); }
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
        SELECT p2.id_pedido, p2.folio, p2.razon_social, p2.rfc, p2.cfdi_uuid, p2.cfdi_estatus, p2.rep_uuid, p2.a_credito,
               COALESCE((SELECT SUM(monto) FROM links_pago lp WHERE lp.id_pedido=p2.id_pedido AND lp.estatus='pagado'), p2.total) monto, p2.creado_en
        FROM pedidos p2
        WHERE (p2.rfc IS NOT NULL AND p2.rfc != '') AND date(p2.creado_en) >= ? AND date(p2.creado_en) <= ?
        ORDER BY p2.id_pedido DESC LIMIT 500`).all(desde, hasta)
        // método de pago SAT: fiado = PPD (parcialidades/diferido, lleva REP al cobrar); contado = PUE
        .map(f => ({ ...f, metodo_sat: f.a_credito ? 'PPD' : 'PUE' }));
    // ¿El PAC ya está activo? (para que la UI ofrezca timbrar directo)
    const pacActivo = require('../../services/pacService').activo(db);
    return json(res, { desde, hasta, filas, pac_activo: pacActivo });
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
    const idP = parseInt(params[0]);
    return require('../../services/pacService').timbrar(db, idP)
        .then(r => {
            // F5.4: al timbrar, archiva el CFDI en el baúl local (best-effort, no bloquea).
            if (r.ok) { try { require('../../services/baulContable').archivar(db, idP).catch(() => {}); } catch (_) {} }
            return json(res, r.ok ? r : { ok: false, ...r }, r.ok ? 200 : 400);
        })
        .catch(e => json(res, { ok: false, error: e.message }, 500));
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

// GET /api/erp/diot?mes=YYYY-MM — DIOT: operaciones con proveedores del mes,
// agrupadas por RFC, con base e IVA acreditable. ?formato=txt baja el archivo
// del SAT (batch pipe-delimitado). Usa la base/IVA EXACTOS del CFDI cuando la CxP
// los tiene (importación XML, 0058); para las CxP capturadas a mano sin CFDI cae
// al cálculo plano al iva_pct configurado. El contador valida antes de enviar.
function diot(req, res, ctx) {
    const { db, json } = ctx;
    const sp = new URL(req.url, 'http://x').searchParams;
    const mes = (sp.get('mes') || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const iva = (parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='iva_pct'").get()?.valor) || 16) / 100;
    // Agrupa las CxP del mes (por creada_en) por proveedor con RFC. Separa lo que
    // trae base/IVA exactos del CFDI de lo que hay que derivar plano.
    const filas = db.prepare(`
        SELECT pr.rfc, pr.nombre,
               ROUND(SUM(cp.monto),2) total,
               ROUND(SUM(CASE WHEN cp.base IS NOT NULL THEN cp.base ELSE 0 END),2) base_real,
               ROUND(SUM(CASE WHEN cp.iva  IS NOT NULL THEN cp.iva  ELSE 0 END),2) iva_real,
               ROUND(SUM(CASE WHEN cp.base IS NULL THEN cp.monto ELSE 0 END),2) monto_sin_base
        FROM cuentas_pagar cp JOIN proveedores pr ON pr.id=cp.id_proveedor
        WHERE pr.rfc IS NOT NULL AND pr.rfc != '' AND strftime('%Y-%m', cp.creada_en)=?
        GROUP BY pr.rfc ORDER BY total DESC`).all(mes).map(r => {
        const baseFlat = Math.round((r.monto_sin_base / (1 + iva)) * 100) / 100;
        const base = Math.round((r.base_real + baseFlat) * 100) / 100;
        const ivaAcred = Math.round((r.iva_real + (r.monto_sin_base - baseFlat)) * 100) / 100;
        return { rfc: r.rfc, nombre: r.nombre, total: r.total, base, iva_acreditable: ivaAcred };
    });
    if (sp.get('formato') === 'txt') {
        // Formato batch DIOT (simplificado): tipo_tercero(04 nacional)|
        // tipo_operacion(85 otros)|RFC|||valor_actos_16|iva_acreditable_16
        const lineas = filas.map(f => ['04', '85', f.rfc, '', '', String(Math.round(f.base)), String(Math.round(f.iva_acreditable))].join('|'));
        const txt = lineas.join('\r\n') + (lineas.length ? '\r\n' : '');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="DIOT_${String(mes).replace(/[^0-9-]/g, '')}.txt"` });
        return res.end(txt);
    }
    const tot = filas.reduce((s, f) => ({ base: s.base + f.base, iva: s.iva + f.iva_acreditable }), { base: 0, iva: 0 });
    return json(res, { mes, iva_pct: iva * 100, filas, total_base: Math.round(tot.base * 100) / 100, total_iva_acreditable: Math.round(tot.iva * 100) / 100 });
}

// GET /api/erp/contabilidad-electronica?tipo=catalogo|balanza&mes=YYYY-MM
// Genera el XML del SAT (contabilidad electrónica). BORRADOR: el código
// agrupador SAT se mapea con una tabla base de las cuentas estándar; el
// contador debe revisar/ampliar el mapeo antes de enviar al SAT.
const _COD_AGRUPADOR = { // cuenta interna → código agrupador SAT (c_CuentaSAT, Anexo 24)
    '101': '101.01', '102': '102.01', '105': '105.01', '115': '115.01',
    '119': '118.01', '201': '201.01', '208': '208.01', '209': '209.01',
    '210': '216.01', '211': '213.01', '301': '301.01', '401': '401.01',
    '501': '501.01', '601': '601.84',
};
// Fallback por TIPO de cuenta → código agrupador SAT genérico VÁLIDO (no un
// inventado `codigo+.01`). Cubre cuentas custom que el negocio agregue sin
// mapeo explícito; el contador afina el código exacto en el borrador.
const _COD_AGRUPADOR_TIPO = { activo: '100', pasivo: '200', capital: '300', ingreso: '400', costo: '500', gasto: '600' };
function _codAgrupador(codigo, tipo, sinMapear) {
    if (_COD_AGRUPADOR[codigo]) return _COD_AGRUPADOR[codigo];
    if (sinMapear) sinMapear.add(codigo);
    return (_COD_AGRUPADOR_TIPO[tipo] || '600') + '.01'; // genérico por naturaleza
}
const _xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function contabilidadElectronica(req, res, ctx) {
    const { db, json } = ctx;
    const sp = new URL(req.url, 'http://x').searchParams;
    const tipo = sp.get('tipo') === 'balanza' ? 'balanza' : 'catalogo';
    const mes = (sp.get('mes') || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const rfc = db.prepare("SELECT valor FROM configuracion WHERE clave='pac_rfc'").get()?.valor
        || db.prepare("SELECT valor FROM configuracion WHERE clave='rfc'").get()?.valor || 'XAXX010101000';
    const [anio, m] = mes.split('-');
    const sinMapear = new Set();
    let xml;
    if (tipo === 'catalogo') {
        const cuentas = db.prepare('SELECT codigo, nombre, tipo FROM plan_cuentas ORDER BY codigo').all();
        const rows = cuentas.map(c => {
            const cod = _codAgrupador(c.codigo, c.tipo, sinMapear);
            const natur = ['activo', 'costo', 'gasto'].includes(c.tipo) ? 'D' : 'A';
            return `  <catalogocuentas:Ctas CodAgrup="${cod}" NumCta="${_xmlEsc(c.codigo)}" Desc="${_xmlEsc(c.nombre)}" Nivel="1" Natur="${natur}"/>`;
        }).join('\n');
        xml = `<?xml version="1.0" encoding="UTF-8"?>\n<catalogocuentas:Catalogo xmlns:catalogocuentas="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas" Version="1.3" RFC="${_xmlEsc(rfc)}" Mes="${m}" Anio="${anio}">\n${rows}\n</catalogocuentas:Catalogo>`;
    } else {
        // Balanza: saldo final por cuenta del mes (desde el libro mayor acumulado)
        const desde = mes + '-01';
        const hasta = mes + '-31';
        const mayor = conta.libroMayor('1900-01-01', hasta);
        const mayorMes = conta.libroMayor(desde, hasta);
        const _tipoDe = {}; for (const r of db.prepare('SELECT codigo, tipo FROM plan_cuentas').all()) _tipoDe[r.codigo] = r.tipo;
        const rows = mayor.map(c => {
            const cod = _codAgrupador(c.cuenta, _tipoDe[c.cuenta], sinMapear);
            const mm = mayorMes.find(x => x.cuenta === c.cuenta) || { debe: 0, haber: 0 };
            const saldoFin = Math.round((c.debe - c.haber) * 100) / 100;
            const saldoIni = Math.round((saldoFin - (mm.debe - mm.haber)) * 100) / 100;
            return `  <BCE:Ctas NumCta="${_xmlEsc(c.cuenta)}" SaldoIni="${saldoIni.toFixed(2)}" Debe="${(mm.debe || 0).toFixed(2)}" Haber="${(mm.haber || 0).toFixed(2)}" SaldoFin="${saldoFin.toFixed(2)}"/>`;
        }).join('\n');
        xml = `<?xml version="1.0" encoding="UTF-8"?>\n<BCE:Balanza xmlns:BCE="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion" Version="1.3" RFC="${_xmlEsc(rfc)}" Mes="${m}" Anio="${anio}" TipoEnvio="N">\n${rows}\n</BCE:Balanza>`;
    }
    if (sp.get('descargar') === '1') {
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${tipo}_${String(mes).replace(/[^0-9-]/g, '')}.xml"` });
        return res.end(xml);
    }
    const _sin = [...sinMapear];
    return json(res, {
        tipo, mes, rfc, xml,
        sin_mapear: _sin, // cuentas sin código SAT explícito (usaron el genérico por tipo)
        nota: 'Borrador: valida el código agrupador SAT con tu contador antes de enviar.'
            + (_sin.length ? ` ${_sin.length} cuenta(s) sin mapeo explícito usan un código genérico por naturaleza y DEBEN afinarse: ${_sin.join(', ')}.` : ' Todas las cuentas del catálogo tienen código agrupador asignado.'),
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

// ── Conciliación bancaria (Ola 4) ────────────────────────────────────────────
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

const RUTAS = [
    { metodo: 'GET',  path: '/api/erp/plan-cuentas',              area: 'finanzas', handler: planCuentas },
    { metodo: 'GET',  path: '/api/erp/integridad',                area: 'finanzas', handler: integridad },
    { metodo: 'GET',  path: '/api/erp/asientos',                  area: 'finanzas', handler: asientosGet },
    { metodo: 'POST', path: '/api/erp/asientos',                  area: 'finanzas', handler: asientosPost },
    { metodo: 'GET',  path: '/api/erp/libro-mayor',               area: 'finanzas', handler: libroMayor },
    { metodo: 'GET',  path: '/api/erp/rastro',                    area: 'finanzas', handler: rastro },
    { metodo: 'GET',  path: '/api/erp/productos-vendidos',        area: 'finanzas', handler: productosVendidos },
    { metodo: 'GET',  path: '/api/erp/facturacion-pendiente',     area: 'finanzas', handler: facturacionPendiente },
    { metodo: 'GET',  path: '/api/erp/tablero',                   area: 'finanzas', handler: tablero },
    { metodo: 'GET',  path: '/api/erp/unit-economics',            area: 'finanzas', handler: unitEconomics },
    { metodo: 'GET',  path: '/api/erp/gasto-marketing',           area: 'finanzas', handler: gastoMarketingGet },
    { metodo: 'POST', path: '/api/erp/gasto-marketing',           area: 'finanzas', handler: gastoMarketingPost },
    { metodo: 'GET',  path: '/api/erp/activos',                   area: 'finanzas', handler: activosGet },
    { metodo: 'POST', path: '/api/erp/activos',                   area: 'finanzas', handler: activosPost },
    { metodo: 'POST', path: /^\/api\/erp\/activos\/(\d+)\/baja$/, area: 'finanzas', handler: activosBaja },
    { metodo: 'POST', path: '/api/erp/activos/depreciar',         area: 'finanzas', handler: activosDepreciar },
    { metodo: 'POST', path: /^\/api\/erp\/activos\/(\d+)\/revaluar$/, area: 'finanzas', handler: activosRevaluar },
    { metodo: 'GET',  path: '/api/erp/periodo-cierre',            area: 'finanzas', handler: periodoCierreGet },
    { metodo: 'PUT',  path: '/api/erp/periodo-cierre',            area: 'finanzas', handler: periodoCierrePut },
    { metodo: 'POST', path: '/api/erp/cierre-anual',              area: 'finanzas', handler: cierreAnualPost },
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
    { metodo: 'GET',  path: '/api/erp/diot',                      area: 'finanzas', handler: diot },
    { metodo: 'GET',  path: '/api/erp/contabilidad-electronica',  area: 'finanzas', handler: contabilidadElectronica },
    { metodo: 'POST', path: '/api/erp/conciliacion/importar',     area: 'finanzas', handler: conciliacionImportar },
    { metodo: 'GET',  path: '/api/erp/conciliacion',              area: 'finanzas', handler: conciliacionGet },
    { metodo: 'POST', path: /^\/api\/erp\/conciliacion\/(\d+)$/,  area: 'finanzas', handler: conciliacionConciliar },
    { metodo: 'GET',  path: '/api/erp/baul',                      area: 'finanzas', handler: baulGet },
    { metodo: 'GET',  path: '/api/erp/baul/exportar',             area: 'finanzas', handler: baulExportar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/erp/' });
