'use strict';
// saludNegocioService — unit economics (CAC / LTV / Ratio LTV:CAC) para el ERP.
// Ver AUDITORIA_SALUD_NEGOCIO.md. Reutiliza el libro mayor (401/501/601) para
// ingresos/COGS/gastos y consultas directas para clientes/ticket/frecuencia.
//
// El "gasto de adquisición" (publicidad + sueldos de venta + comisiones) es un
// INPUT MANUAL — muchos negocios no pautan, así que NO se asume ni se infla con
// la operación. Casos:
//   · gasto_adquisicion = null (no capturado)      → status 'sin_datos'
//   · gasto_adquisicion = 0  (adquisición orgánica) → CAC 0, ratio "infinito" → 'escalable'
//   · gasto_adquisicion > 0                          → CAC = gasto / clientes_nuevos
// db se inyecta (tests). Degrada con honestidad si contabilidad está OFF.

let db = require('../bot/db_connection');
const conta = require('./contabilidadService');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function _diasEntre(desde, hasta) {
    const a = new Date(desde + 'T00:00:00'), b = new Date(hasta + 'T00:00:00');
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

// Gasto de publicidad (602) del período — sale SOLO del libro mayor (finanzas P1).
function _gastoMarketingLibro(desde, hasta) {
    try {
        const r = db.prepare("SELECT COALESCE(SUM(dd.debe - dd.haber),0) g FROM asientos a JOIN asientos_detalle dd ON dd.id_asiento=a.id WHERE dd.cuenta='602' AND a.fecha BETWEEN ? AND ?").get(desde, hasta);
        return Math.round((r.g || 0) * 100) / 100;
    } catch (_) { return 0; }
}

// Lee el gasto de adquisición. Prioridad: (1) parámetro explícito; (2) publicidad
// registrada en 602 del período (automático, del libro mayor); (3)
// configuracion.gasto_marketing_mensual; si nada → null. Devuelve { valor, auto }.
function _gastoAdquisicion(gastoParam, desde, hasta) {
    if (gastoParam !== null && gastoParam !== undefined && gastoParam !== '') {
        const n = Number(gastoParam);
        return { valor: Number.isFinite(n) && n >= 0 ? n : null, auto: false };
    }
    const m602 = _gastoMarketingLibro(desde, hasta);
    if (m602 > 0) return { valor: m602, auto: true };   // publicidad contable → CAC solo
    try {
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='gasto_marketing_mensual'").get();
        if (r && r.valor !== '' && r.valor != null) { const n = Number(r.valor); if (Number.isFinite(n) && n >= 0) return { valor: n, auto: false }; }
    } catch (_) {}
    return { valor: null, auto: false };
}

function calcularSaludNegocio({ desde, hasta, gastoAdquisicion = null } = {}) {
    const dias = _diasEntre(desde, hasta);
    const factorAnual = 365 / dias;
    const contaOn = (() => { try { return conta.activo(); } catch (_) { return false; } })();

    // Ingresos / COGS / gastos_op: del libro mayor si hay contabilidad; si no,
    // aproximación bruta desde pedidos/pagos (margen quedaría solo bruto).
    let ingresos = 0, cogs = 0, gastosOp = 0;
    if (contaOn) {
        const may = conta.libroMayor(desde, hasta);
        const cta = (c) => may.find(x => x.cuenta === c) || { debe: 0, haber: 0 };
        ingresos = r2(cta('401').haber - cta('401').debe);
        cogs = r2(cta('501').debe - cta('501').haber);
        gastosOp = r2(cta('601').debe - cta('601').haber);
    } else {
        try {
            const p = db.prepare("SELECT COALESCE(SUM(monto),0) ing FROM links_pago WHERE estatus='pagado' AND date(pagado_en) BETWEEN ? AND ?").get(desde, hasta);
            ingresos = r2(p.ing);
        } catch (_) {}
    }

    // Clientes / pedidos / ticket / frecuencia (salen solos).
    let clientesNuevos = 0, numPedidos = 0, clientesActivos = 0, ticket = 0;
    try {
        clientesNuevos = db.prepare("SELECT COUNT(*) n FROM clientes WHERE date(creado_en) BETWEEN ? AND ?").get(desde, hasta).n;
        const pg = db.prepare("SELECT COALESCE(SUM(monto),0) suma, COUNT(DISTINCT id_pedido) n FROM links_pago WHERE estatus='pagado' AND date(pagado_en) BETWEEN ? AND ?").get(desde, hasta);
        numPedidos = pg.n;
        ticket = numPedidos > 0 ? r2(pg.suma / numPedidos) : 0;
        clientesActivos = db.prepare("SELECT COUNT(DISTINCT id_cliente) n FROM pedidos WHERE date(creado_en) BETWEEN ? AND ? AND id_cliente IS NOT NULL").get(desde, hasta).n;
    } catch (_) {}

    const margenNeto = ingresos > 0 ? r2((ingresos - cogs - gastosOp) / ingresos) : 0;
    const frecuencia = clientesActivos > 0 ? r2((numPedidos / clientesActivos) * factorAnual) : 0;
    const ltv = r2(ticket * frecuencia * margenNeto);

    const ga = _gastoAdquisicion(gastoAdquisicion, desde, hasta);
    const gastoAdq = ga.valor;
    const insumos = {
        clientes_nuevos: clientesNuevos, num_pedidos: numPedidos, clientes_activos: clientesActivos,
        ingresos, cogs, gastos_op: gastosOp, margen_neto: margenNeto,
        gasto_adquisicion: gastoAdq, gasto_adquisicion_es_input_manual: !ga.auto,
    };

    // Sin base para el ratio → sin_datos (honesto, nunca NaN/Infinity).
    if (gastoAdq === null || clientesNuevos === 0 || ingresos === 0) {
        const falta = [];
        if (gastoAdq === null) falta.push('captura el gasto de adquisición (publicidad/ventas) del período');
        if (clientesNuevos === 0) falta.push('no hubo clientes nuevos en el período');
        if (ingresos === 0) falta.push('no hay ingresos registrados en el período');
        return { conta_activa: contaOn, desde, hasta, dias, insumos,
            metricas: { cac: null, ticket_promedio: ticket, frecuencia_compra_anual: frecuencia, margen_neto: margenNeto, ltv, ratio_ltv_cac: null },
            status: 'sin_datos', status_label: 'Sin datos suficientes', objetivo_ratio: 3.0, notas: falta };
    }

    const cac = r2(gastoAdq / clientesNuevos);
    // Adquisición orgánica: gasto 0 con clientes nuevos → CAC 0, ratio "infinito".
    const organico = cac === 0;
    const ratio = organico ? null : r2(ltv / cac);

    let status, label;
    if (organico)          { status = 'escalable'; label = 'Adquisición orgánica (sin costo de captación)'; }
    else if (ratio > 5)    { status = 'escalable'; label = 'Listo para escalar'; }
    else if (ratio >= 3)   { status = 'saludable'; label = 'Saludable'; }
    else                   { status = 'alerta';    label = 'Alerta: quemando dinero'; }

    const notas = [];
    notas.push('El gasto de adquisición se captura manual (no incluye renta/nómina fija de operación).');
    if (organico) notas.push('Sin gasto de captación en el período: adquisición 100% orgánica.');
    if (!contaOn) notas.push('Contabilidad apagada: el margen es solo bruto (sin gastos de operación).');

    return { conta_activa: contaOn, desde, hasta, dias, insumos,
        adquisicion_organica: organico,   // CAC 0 con clientes nuevos → ratio "infinito"
        metricas: { cac, ticket_promedio: ticket, frecuencia_compra_anual: frecuencia, margen_neto: margenNeto, ltv,
            ratio_ltv_cac: ratio },        // null si orgánico (no dividir por cero); status ya dice 'escalable'
        status, status_label: label, objetivo_ratio: 3.0, notas };
}

function _setDb(x) { db = x; }   // solo tests

module.exports = { calcularSaludNegocio, _setDb };
