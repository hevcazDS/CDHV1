'use strict';
// tests/test_salud_negocio.js — unit economics CAC/LTV/Ratio (calcular_salud_negocio).
// DB en memoria con asientos 401/501/601 + clientes + pagos. Pinnea la fórmula
// corregida, el orden de umbrales (>5 antes que >=3), la adquisición ORGÁNICA
// (gasto 0 → escalable, no error) y sin_datos (sin captura). Sin dividir por cero.
//   node tests/test_salud_negocio.js

const assert = require('assert');
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE plan_cuentas (codigo TEXT PRIMARY KEY, nombre TEXT, tipo TEXT);
  CREATE TABLE asientos (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, sucursal TEXT);
  CREATE TABLE asientos_detalle (id INTEGER PRIMARY KEY AUTOINCREMENT, id_asiento INT, cuenta TEXT, debe REAL DEFAULT 0, haber REAL DEFAULT 0);
  CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, creado_en TEXT);
  CREATE TABLE pedidos (id_pedido INTEGER PRIMARY KEY AUTOINCREMENT, id_cliente INT, creado_en TEXT);
  CREATE TABLE links_pago (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INT, monto REAL, estatus TEXT, pagado_en TEXT);
  CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT);
`);

const salud = require('../services/saludNegocioService');
const conta = require('../services/contabilidadService');
conta._setDb(db); conta._setActivo(() => true);
salud._setDb(db);

// Periodo: mes en curso (usamos fechas "de hoy" para que creado_en/pagado_en caigan dentro)
const hoy = new Date().toISOString().slice(0, 10);
const desde = hoy.slice(0, 8) + '01';
const hasta = hoy;

// Libro mayor: ingresos 401=100000, COGS 501=60000, gastos_op 601=20000 → margen neto 0.20
function asiento(cuenta, debe, haber) {
    const a = db.prepare("INSERT INTO asientos (fecha) VALUES (?)").run(hoy).lastInsertRowid;
    db.prepare("INSERT INTO asientos_detalle (id_asiento, cuenta, debe, haber) VALUES (?,?,?,?)").run(a, cuenta, debe, haber);
}
asiento('401', 0, 100000);  // ingresos
asiento('501', 60000, 0);   // COGS
asiento('601', 20000, 0);   // gastos operación

// 50 clientes nuevos, 100 pedidos pagados de $1000 (ticket 1000), 50 clientes activos
for (let i = 0; i < 50; i++) db.prepare("INSERT INTO clientes (creado_en) VALUES (?)").run(hoy + ' 10:00');
for (let i = 0; i < 100; i++) {
    const ped = db.prepare("INSERT INTO pedidos (id_cliente, creado_en) VALUES (?,?)").run((i % 50) + 1, hoy + ' 11:00').lastInsertRowid;
    db.prepare("INSERT INTO links_pago (id_pedido, monto, estatus, pagado_en) VALUES (?,?, 'pagado', ?)").run(ped, 1000, hoy + ' 11:05');
}

let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

t('insumos base correctos (margen neto = 0.20, ticket 1000)', () => {
    const r = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: 5000 });
    assert.strictEqual(r.insumos.clientes_nuevos, 50);
    assert.strictEqual(r.insumos.num_pedidos, 100);
    assert.strictEqual(r.insumos.margen_neto, 0.20);
    assert.strictEqual(r.metricas.ticket_promedio, 1000);
});

t('CAC = gasto/clientes_nuevos; LTV y ratio con la fórmula corregida', () => {
    // gasto 5000 / 50 = CAC 100. frecuencia = 100/50 *  (365/dias) → anualizada.
    // LTV = ticket(1000) * frecuencia * margen(0.20). ratio = LTV/CAC.
    const r = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: 5000 });
    assert.strictEqual(r.metricas.cac, 100);
    assert(r.metricas.ltv > 0);
    assert(r.metricas.ratio_ltv_cac > 0);
    // con estos números el ratio es enorme → escalable
    assert.strictEqual(r.status, 'escalable');
});

t('umbrales: >5 escalable ANTES que >=3 (un ratio ~4 es saludable, ~6 escalable)', () => {
    // forzamos el ratio ajustando el gasto de adquisición.
    const base = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: 1 });
    const ltv = base.metricas.ltv;   // fijo
    // gasto tal que CAC = LTV/4 → ratio 4 (saludable); CAC = LTV/6 → ratio 6 (escalable)
    const g4 = (ltv / 4) * 50;  // CAC = g/50 = LTV/4
    const g6 = (ltv / 6) * 50;
    const r4 = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: g4 });
    const r6 = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: g6 });
    assert(Math.abs(r4.metricas.ratio_ltv_cac - 4) < 0.2, 'ratio ~4: ' + r4.metricas.ratio_ltv_cac);
    assert.strictEqual(r4.status, 'saludable');
    assert.strictEqual(r6.status, 'escalable');
});

t('ratio < 3 → alerta (quemando dinero)', () => {
    const base = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: 1 });
    const g2 = (base.metricas.ltv / 2) * 50;   // ratio 2
    const r = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: g2 });
    assert(r.metricas.ratio_ltv_cac < 3);
    assert.strictEqual(r.status, 'alerta');
});

t('adquisición ORGÁNICA: gasto 0 con clientes nuevos → escalable, sin dividir por cero', () => {
    const r = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: 0 });
    assert.strictEqual(r.metricas.cac, 0);
    assert.strictEqual(r.metricas.ratio_ltv_cac, null, 'no Infinity/NaN');
    assert.strictEqual(r.adquisicion_organica, true);
    assert.strictEqual(r.status, 'escalable');
});

t('sin captura de gasto → sin_datos (no inventa CAC)', () => {
    const r = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: null });
    assert.strictEqual(r.status, 'sin_datos');
    assert.strictEqual(r.metricas.cac, null);
});

t('lee configuracion.gasto_marketing_mensual si no se pasa el parámetro', () => {
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('gasto_marketing_mensual','5000')").run();
    const r = salud.calcularSaludNegocio({ desde, hasta });   // sin gastoAdquisicion
    assert.strictEqual(r.metricas.cac, 100);   // 5000/50
    db.prepare("DELETE FROM configuracion WHERE clave='gasto_marketing_mensual'").run();
});

t('sin clientes nuevos → sin_datos', () => {
    db.prepare("DELETE FROM clientes").run();
    const r = salud.calcularSaludNegocio({ desde, hasta, gastoAdquisicion: 5000 });
    assert.strictEqual(r.status, 'sin_datos');
});

console.log('\n' + ok + '/8 OK — salud del negocio: CAC/LTV/ratio, umbrales, orgánico y sin_datos.');
process.exit(ok === 8 ? 0 : 1);
