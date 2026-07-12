'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Backfill contable: reconstruye los asientos de partida doble de los pedidos
// YA cobrados/vendidos, para instancias donde Contabilidad estuvo APAGADA
// mientras el negocio operaba (el tablero mostraba $0 sobre ventas reales).
//
//   node scripts/backfill_contable.js            → DRY-RUN (no escribe, reporta)
//   node scripts/backfill_contable.js --aplicar  → escribe los asientos
//
// Seguro de correr:
//   · IDEMPOTENTE — cada asiento function salta si ya existe (por referencia).
//     Re-correr no duplica.
//   · FECHA CORRECTA — cada asiento se fecha con la fecha REAL del pedido
//     (venta = creado_en/pagado_en, cobro = pagado_en), no "hoy" → el P&L cae
//     en el período correcto, no todo amontonado en el mes actual.
//   · Reconstruye la MISMA lógica que el flujo vivo (marcar-pagado / POS):
//     contado pagado → venta + costo; crédito → venta_credito + costo (+ cobro
//     si ya se cobró); contado NO pagado → no se reconoce (igual que en vivo).
// ─────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const db = require('../bot/db_connection');
const conta = require('../services/contabilidadService');

const APLICAR = process.argv.includes('--aplicar');
// El backfill asienta EXPLÍCITAMENTE (es su trabajo); no depende del flag.
conta._setActivo(() => true);

const dia = (ts) => (ts ? String(ts).slice(0, 10) : null);

const filas = db.prepare(`
    SELECT p.id_pedido, p.a_credito, p.metodo_pago, p.creado_en,
           lp.monto, lp.estatus AS pago_estatus, lp.pagado_en
    FROM pedidos p
    JOIN links_pago lp ON lp.id_pedido = p.id_pedido
    WHERE lp.estatus IN ('pagado', 'generado')
    ORDER BY p.id_pedido
`).all();

const cnt = { procesados: 0, venta: 0, venta_credito: 0, cobro_credito: 0, costo: 0, saltados_no_pagado: 0, errores: 0 };
let monto_total = 0;

for (const f of filas) {
    cnt.procesados++;
    const esCred = f.a_credito == 1;
    const monto = Number(f.monto || 0);
    const fVenta = dia(f.creado_en);
    const fCobro = dia(f.pagado_en) || fVenta;
    try {
        if (esCred) {
            // Ingreso devengado al vender + costo; cobro solo si ya se cobró.
            if (APLICAR) { conta.asientoVentaCredito(f.id_pedido, monto, fVenta); conta.asientoCostoVenta(f.id_pedido, fVenta); }
            cnt.venta_credito++; cnt.costo++; monto_total += monto;
            if (f.pago_estatus === 'pagado') { if (APLICAR) conta.asientoCobroCredito(f.id_pedido, monto, f.metodo_pago, fCobro); cnt.cobro_credito++; }
        } else if (f.pago_estatus === 'pagado') {
            if (APLICAR) { conta.asientoVenta(f.id_pedido, monto, f.metodo_pago, fCobro); conta.asientoCostoVenta(f.id_pedido, fCobro); }
            cnt.venta++; cnt.costo++; monto_total += monto;
        } else {
            cnt.saltados_no_pagado++; // contado sin cobrar → no se reconoce (igual que en vivo)
        }
    } catch (e) {
        cnt.errores++;
        console.error('  ⚠️ pedido ' + f.id_pedido + ': ' + e.message);
    }
}

console.log('');
console.log((APLICAR ? '✅ APLICADO' : '🔎 DRY-RUN (no se escribió nada — corre con --aplicar)'));
console.log('  pedidos procesados: ' + cnt.procesados);
console.log('  ventas de contado:  ' + cnt.venta);
console.log('  ventas a crédito:   ' + cnt.venta_credito + ' (de ellas cobradas: ' + cnt.cobro_credito + ')');
console.log('  costos de venta:    ' + cnt.costo + ' (los que tengan costo capturado)');
console.log('  saltados (contado sin cobrar): ' + cnt.saltados_no_pagado);
console.log('  monto de ingreso reconstruido: $' + monto_total.toLocaleString('es-MX', { minimumFractionDigits: 2 }));
if (cnt.errores) console.log('  ⚠️ errores: ' + cnt.errores + ' (revisa arriba)');
