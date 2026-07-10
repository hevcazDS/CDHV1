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

// ── FISCAL (LFT) — funciones puras, aproximadas: valida con tu contador ──
// Antigüedad en años completos desde la fecha de alta.
function antiguedadAnios(fechaAlta, hasta) {
    if (!fechaAlta) return 0;
    const a = new Date(fechaAlta), b = hasta ? new Date(hasta) : new Date();
    let y = b.getFullYear() - a.getFullYear();
    if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y--;
    return Math.max(0, y);
}
// Días de vacaciones por ley (LFT 2023): 1er año 12, +2/año hasta 20 (5º),
// luego +2 cada 5 años.
function diasVacacionesLey(anios) {
    if (anios < 1) return 0;
    if (anios <= 5) return 10 + anios * 2;        // 1->12 ... 5->20
    return 20 + Math.floor((anios - 1) / 5) * 2;  // 6-10->22, 11-15->24...
}
// Aguinaldo: 15 días mínimos, proporcional a los días trabajados en el año.
function aguinaldo(salarioDiario, diasTrabajadosAnio, diasBase = 15) {
    return _r2(salarioDiario * diasBase * Math.min(1, diasTrabajadosAnio / 365));
}
// Prima vacacional: 25% sobre el salario de los días de vacaciones.
function primaVacacional(salarioDiario, diasVacaciones, pct = 0.25) {
    return _r2(salarioDiario * diasVacaciones * pct);
}
// Días del año en curso trabajados hasta 'hasta' (o desde el alta si entró
// este año). Base para las partes proporcionales del finiquito.
function _diasEnAnio(fechaAlta, hasta) {
    const fin = new Date(hasta);
    const inicioAnio = new Date(fin.getFullYear(), 0, 1);
    const alta = fechaAlta ? new Date(fechaAlta) : inicioAnio;
    const desde = alta > inicioAnio ? alta : inicioAnio;
    return Math.max(0, Math.round((fin - desde) / 86400000) + 1);
}
// Finiquito (partes proporcionales — NO incluye indemnización por despido
// injustificado, que es aparte). Devuelve el desglose.
function finiquito(empleado, fechaBaja, opts = {}) {
    const sd = Number(empleado.salario_diario) || 0;
    const anios = antiguedadAnios(empleado.fecha_alta, fechaBaja);
    const diasAnio = _diasEnAnio(empleado.fecha_alta, fechaBaja);
    const diasVac = diasVacacionesLey(Math.max(1, anios));
    const ag = aguinaldo(sd, diasAnio);
    const vacProp = _r2(sd * diasVac * Math.min(1, diasAnio / 365));
    const primaVac = _r2(vacProp * 0.25);
    const diasPend = _r2(sd * (Number(opts.dias_pendientes) || 0));
    let indemnizacion = 0;
    if (opts.despido_injustificado) {
        indemnizacion = _r2(sd * 90 + sd * 20 * anios); // 3 meses + 20 días/año
    }
    const total = _r2(diasPend + ag + vacProp + primaVac + indemnizacion);
    return { antiguedad_anios: anios, dias_aguinaldo: 15, aguinaldo: ag,
        dias_vacaciones: diasVac, vacaciones_proporcional: vacProp, prima_vacacional: primaVac,
        dias_pendientes: diasPend, indemnizacion, total };
}

// Calcula la nómina de TODOS los empleados activos en el rango [desde, hasta]
// usando horarios_empleado. Jornada = 8h → hora = salario_diario / 8.
function _fiscalActivo() {
    try { return db.prepare("SELECT valor FROM configuracion WHERE clave='nomina_fiscal_activo'").get()?.valor === '1'; }
    catch (_) { return false; }
}
function calcular(desde, hasta) {
    const dias = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1);
    const factorMes = 30 / dias;
    const fiscal = _fiscalActivo();
    const empleados = db.prepare('SELECT * FROM empleados WHERE activo=1').all();
    const horasDe = db.prepare('SELECT COALESCE(SUM(horas),0) h FROM horarios_empleado WHERE id_empleado=? AND fecha>=? AND fecha<=?');
    const porDia  = db.prepare('SELECT fecha, horas FROM horarios_empleado WHERE id_empleado=? AND fecha>=? AND fecha<=?');
    const resultados = [];

    for (const e of empleados) {
        const horasTot = horasDe.get(e.id, desde, hasta)?.h || 0;
        if (!(horasTot > 0)) continue;
        const tarifaHora = e.salario_diario / 8;
        let horasNormales = horasTot, horasExtra = 0, comisiones = 0;
        if (fiscal) {
            // horas extra = lo que pasa de 8h POR DÍA, pagadas al doble (LFT)
            horasNormales = 0;
            for (const d of porDia.all(e.id, desde, hasta)) {
                horasNormales += Math.min(d.horas, 8);
                horasExtra    += Math.max(0, d.horas - 8);
            }
            // comisiones = % sobre lo COBRADO por el empleado (liga por username)
            if (e.comision_pct > 0 && e.username) {
                const ventas = db.prepare("SELECT COALESCE(SUM(lp.monto),0) v FROM links_pago lp JOIN pedidos p ON p.id_pedido=lp.id_pedido WHERE lp.estatus='pagado' AND p.cobrado_por=? AND date(lp.pagado_en)>=? AND date(lp.pagado_en)<=?").get(e.username, desde, hasta)?.v || 0;
                comisiones = _r2(ventas * (e.comision_pct / 100));
            }
        }
        const bruto = _r2(horasNormales * tarifaHora + horasExtra * tarifaHora * 2 + comisiones);
        let isr = 0, imss = 0;
        if (e.con_impuestos) {
            isr = _r2(isrMensual(bruto * factorMes) / factorMes);
            imss = _r2(bruto * (IMSS_OBRERO_PCT / 100));
        }
        const neto = _r2(bruto - isr - imss);
        db.prepare(`INSERT INTO nominas (id_empleado, desde, hasta, horas, horas_extra, comisiones, bruto, isr, imss, neto)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(id_empleado, desde, hasta) DO UPDATE SET
                      horas=excluded.horas, horas_extra=excluded.horas_extra, comisiones=excluded.comisiones,
                      bruto=excluded.bruto, isr=excluded.isr, imss=excluded.imss, neto=excluded.neto`)
          .run(e.id, desde, hasta, horasTot, horasExtra, comisiones, bruto, isr, imss, neto);
        resultados.push({ id_empleado: e.id, nombre: e.nombre, horas: horasTot, horas_extra: horasExtra, comisiones, bruto, isr, imss, neto, con_impuestos: !!e.con_impuestos, metodo_pago: e.metodo_pago });
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

// Registra el PAGO de aguinaldo con asiento (601 Gasto / 102 Bancos) para que
// no quede fuera de libros. Idempotente por (empleado, año) vía la referencia
// del asiento. Requiere contabilidad activa (es donde vive el registro).
function pagarAguinaldo(empleado, anio, monto) {
    const conta = require('./contabilidadService');
    if (!conta.activo()) throw new Error('Activa el módulo Contabilidad para registrar el pago (si no llevas libros, el aguinaldo no se asienta)');
    if (!(monto > 0)) throw new Error('El aguinaldo calculado es cero');
    const ref = 'aguinaldo_' + empleado.id + '_' + anio;
    if (db.prepare("SELECT 1 FROM asientos WHERE referencia_tipo='aguinaldo' AND referencia_id=? LIMIT 1").get(ref))
        throw new Error('El aguinaldo ' + anio + ' de ' + empleado.nombre + ' ya está registrado');
    const id = conta.registrarAsiento({
        concepto: 'Aguinaldo ' + anio + ' — ' + empleado.nombre, referencia_tipo: 'aguinaldo', referencia_id: ref,
        partidas: [{ cuenta: '601', debe: _r2(monto) }, { cuenta: '102', haber: _r2(monto) }],
    });
    return { id_asiento: id, total: _r2(monto) };
}

// Registra el PAGO de finiquito con asiento y da de baja al empleado.
// Idempotente por empleado.
function pagarFiniquito(empleado, fechaBaja, fin) {
    const conta = require('./contabilidadService');
    if (!conta.activo()) throw new Error('Activa el módulo Contabilidad para registrar el pago (si no llevas libros, el finiquito no se asienta)');
    const total = _r2(fin.total || 0);
    if (!(total > 0)) throw new Error('El finiquito calculado es cero');
    const ref = 'finiquito_' + empleado.id;
    if (db.prepare("SELECT 1 FROM asientos WHERE referencia_tipo='finiquito' AND referencia_id=? LIMIT 1").get(ref))
        throw new Error('El finiquito de ' + empleado.nombre + ' ya está registrado');
    const id = conta.registrarAsiento({
        concepto: 'Finiquito ' + empleado.nombre + ' (baja ' + fechaBaja + ')', referencia_tipo: 'finiquito', referencia_id: ref,
        partidas: [{ cuenta: '601', debe: total }, { cuenta: '102', haber: total }],
    });
    db.prepare('UPDATE empleados SET activo=0 WHERE id=?').run(empleado.id);
    return { id_asiento: id, total };
}

function _setDb(x) { db = x; } // solo tests

module.exports = { calcular, pagar, isrMensual, antiguedadAnios, diasVacacionesLey, aguinaldo, primaVacacional, finiquito, pagarAguinaldo, pagarFiniquito, _setDb };
