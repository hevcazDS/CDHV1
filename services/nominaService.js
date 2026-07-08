// Nómina MX (módulo rrhh_activo): cálculo por horas del periodo, con o sin
// impuestos por empleado. CON impuestos = ISR retenido (tarifa mensual SAT
// Art. 96 vigente 2025, prorrateada al periodo) + IMSS obrero aproximado.
// ⚠ Aproximado para operación diaria — el timbrado CFDI de nómina y el
// cálculo fiscal definitivo son de tu contador/PAC.
'use strict';
let db = require('../bot/db_connection');

const _r2 = (n) => Math.round(Number(n) * 100) / 100;

// Tarifa ISR MENSUAL (límite inferior, cuota fija, % excedente)
const TARIFA_ISR_MENSUAL = [
    [0.01, 0, 1.92], [746.05, 14.32, 6.40], [6332.06, 371.83, 10.88],
    [11128.02, 893.63, 16.00], [12935.83, 1182.88, 17.92], [15487.72, 1640.18, 21.36],
    [31236.50, 5004.12, 23.52], [49233.01, 9236.89, 30.00], [93993.91, 22665.17, 32.00],
    [125325.21, 32691.18, 34.00], [375975.62, 117912.32, 35.00],
];
const IMSS_OBRERO_PCT = 2.775; // aprox. cuota obrera sobre salario base

function isrMensual(baseMensual) {
    let fila = TARIFA_ISR_MENSUAL[0];
    for (const f of TARIFA_ISR_MENSUAL) { if (baseMensual >= f[0]) fila = f; else break; }
    return _r2(fila[1] + (baseMensual - fila[0]) * (fila[2] / 100));
}

// Calcula la nómina de TODOS los empleados activos en el rango [desde, hasta]
// usando horarios_empleado. Jornada = 8h → hora = salario_diario / 8.
function calcular(desde, hasta) {
    const dias = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1);
    const factorMes = 30 / dias; // prorrateo del periodo a base mensual
    const empleados = db.prepare('SELECT * FROM empleados WHERE activo=1').all();
    const horasDe = db.prepare('SELECT COALESCE(SUM(horas),0) h FROM horarios_empleado WHERE id_empleado=? AND fecha>=? AND fecha<=?');
    const resultados = [];

    for (const e of empleados) {
        const horas = horasDe.get(e.id, desde, hasta)?.h || 0;
        if (!(horas > 0)) continue;
        const bruto = _r2(horas * (e.salario_diario / 8));
        let isr = 0, imss = 0;
        if (e.con_impuestos) {
            isr = _r2(isrMensual(bruto * factorMes) / factorMes);
            imss = _r2(bruto * (IMSS_OBRERO_PCT / 100));
        }
        const neto = _r2(bruto - isr - imss);
        db.prepare(`INSERT INTO nominas (id_empleado, desde, hasta, horas, bruto, isr, imss, neto)
                    VALUES (?,?,?,?,?,?,?,?)
                    ON CONFLICT(id_empleado, desde, hasta) DO UPDATE SET
                      horas=excluded.horas, bruto=excluded.bruto, isr=excluded.isr,
                      imss=excluded.imss, neto=excluded.neto`)
          .run(e.id, desde, hasta, horas, bruto, isr, imss, neto);
        resultados.push({ id_empleado: e.id, nombre: e.nombre, horas, bruto, isr, imss, neto, con_impuestos: !!e.con_impuestos });
    }
    return resultados;
}

// Marca pagada la nómina del periodo y (si contabilidad activa) asienta:
// cargo Gastos generales, abono Bancos por el neto total + retenciones como
// pasivo no modelado (van al gasto — simplificación documentada).
function pagar(desde, hasta) {
    const filas = db.prepare("SELECT * FROM nominas WHERE desde=? AND hasta=? AND estatus='calculada'").all(desde, hasta);
    if (!filas.length) return { pagadas: 0, total: 0 };
    const total = _r2(filas.reduce((s, f) => s + f.bruto, 0));
    db.prepare("UPDATE nominas SET estatus='pagada', pagada_en=datetime('now','localtime') WHERE desde=? AND hasta=? AND estatus='calculada'")
      .run(desde, hasta);
    try {
        const conta = require('./contabilidadService');
        conta.registrarAsiento && conta.activo() && conta.registrarAsiento({
            concepto: `Nómina ${desde} a ${hasta} (${filas.length} empleados)`,
            referencia_tipo: 'nomina', referencia_id: desde + '_' + hasta,
            partidas: [{ cuenta: '601', debe: total }, { cuenta: '102', haber: total }],
        });
    } catch (_) {}
    return { pagadas: filas.length, total };
}

function _setDb(x) { db = x; } // solo tests

module.exports = { calcular, pagar, isrMensual, _setDb };
