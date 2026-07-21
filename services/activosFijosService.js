'use strict';
// activosFijosService — alta, listado, depreciación lineal y baja de activos
// fijos (equipo/cómputo/vehículos/maquinaria/inmuebles). Se capitalizan en su
// cuenta 12x y se deprecian contra 129 (dep. acumulada) / 605 (gasto). Reusa el
// motor contable de partida doble (registrarAsiento). Ver AUDITORIA_GIMNASIOS_ACTIVOS.md.
let db = require('../bot/db_connection');
const conta = require('./contabilidadService');

const CUENTA_POR_CATEGORIA = {
    equipo: '120', computo: '121', vehiculos: '122', maquinaria: '123', inmuebles: '124', terrenos: '125',
};
// Los TERRENOS no se deprecian (no pierden valor con el tiempo).
const NO_DEPRECIABLES = new Set(['terrenos']);
const DEP_ACUM = '129';   // depreciación acumulada (contra-activo)
const GASTO_DEP = '605';  // gasto por depreciación
const SUPERAVIT_REVAL = '330';  // superávit por revaluación (capital)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const _mesDe = (fecha) => String(fecha || new Date().toISOString().slice(0, 10)).slice(0, 7);

// Alta = capitalizar: cargo a la cuenta 12x, abono a bancos/caja. NO toca inventario.
function comprarActivo({ nombre, categoria = 'equipo', costo, valor_residual = 0, vida_util_meses = 60, fecha = null, metodo = 'bancos', sucursal = null }) {
    const cuenta = CUENTA_POR_CATEGORIA[categoria];
    if (!cuenta) throw new Error('Categoría de activo inválida');
    const c = r2(costo);
    if (!(c > 0)) throw new Error('El costo debe ser mayor a 0');
    const vres = Math.max(0, Math.min(r2(valor_residual), c));
    const vida = Math.max(1, parseInt(vida_util_meses) || 60);
    const f = fecha || new Date().toISOString().slice(0, 10);
    const id = db.prepare(`INSERT INTO activos_fijos
        (nombre, categoria, costo, valor_residual, vida_util_meses, fecha_compra, sucursal)
        VALUES (?,?,?,?,?,?,?)`).run(String(nombre || '').slice(0, 120) || 'Activo', categoria, c, vres, vida, f, sucursal).lastInsertRowid;
    // Asiento de capitalización (si la contabilidad está encendida).
    try {
        if (conta.activo()) {
            conta.registrarAsiento({
                concepto: 'Compra de activo fijo: ' + (nombre || ''), referencia_tipo: 'activo_fijo', referencia_id: id,
                partidas: [{ cuenta, debe: c }, { cuenta: metodo === 'caja' ? '101' : '102', haber: c }],
                fecha: f, sucursal,
            });
        }
    } catch (_) { /* el activo queda registrado aunque el asiento falle */ }
    return { id, cuenta };
}

// Depreciación lineal del MES indicado (default: mes en curso). Idempotente: no
// re-deprecia un activo cuyo ultima_depreciacion ya sea ese mes. Devuelve cuántos.
function depreciarMes(fecha = null) {
    const mes = _mesDe(fecha);
    const finMes = mes + '-28';   // fecha del asiento dentro del mes
    // Los terrenos quedan fuera: nunca se deprecian.
    const activos = db.prepare("SELECT * FROM activos_fijos WHERE estatus='activo' AND categoria != 'terrenos' AND (ultima_depreciacion IS NULL OR ultima_depreciacion < ?)").all(mes);
    let n = 0;
    for (const a of activos) {
        const depreciable = r2(a.costo - a.valor_residual);
        const pendiente = r2(depreciable - a.depreciacion_acumulada);
        if (pendiente <= 0) { db.prepare("UPDATE activos_fijos SET ultima_depreciacion=? WHERE id=?").run(mes, a.id); continue; }
        const cuota = Math.min(pendiente, r2(depreciable / a.vida_util_meses));
        if (!(cuota > 0)) continue;
        const tx = db.transaction(() => {
            db.prepare("UPDATE activos_fijos SET depreciacion_acumulada = ROUND(depreciacion_acumulada + ?, 2), ultima_depreciacion=? WHERE id=?").run(cuota, mes, a.id);
            // Re-auditoría H3: con contabilidad ACTIVA, el asiento debe entrar o
            // la transacción entera se revierte (antes el catch tragaba el error
            // de mes cerrado y el subledger avanzaba SIN asiento — divergencia
            // permanente). Con contabilidad apagada, subledger-solo es a propósito.
            if (conta.activo()) conta.registrarAsiento({
                concepto: 'Depreciación ' + mes + ': ' + a.nombre, referencia_tipo: 'depreciacion', referencia_id: a.id,
                partidas: [{ cuenta: GASTO_DEP, debe: cuota }, { cuenta: DEP_ACUM, haber: cuota }], fecha: finMes, sucursal: a.sucursal,
            });
        });
        try { tx(); n++; }
        catch (_) { /* p.ej. mes cerrado: este activo se salta esta ronda, sin avanzar subledger */ }
    }
    return n;
}

// Baja/retiro (write-off): saca el activo de libros. Cargo 129 (dep. acumulada)
// + cargo 601 por el valor en libros restante (pérdida), abono la cuenta 12x.
function darDeBaja(id, motivo = '') {
    const a = db.prepare("SELECT * FROM activos_fijos WHERE id=? AND estatus='activo'").get(id);
    if (!a) throw new Error('Activo no encontrado o ya dado de baja');
    const cuenta = CUENTA_POR_CATEGORIA[a.categoria];
    const reval = r2(a.revaluacion_acumulada || 0);
    const valorBruto = r2(a.costo + reval);                    // saldo de la cuenta 12x del activo
    const enLibros = r2(valorBruto - a.depreciacion_acumulada);
    db.prepare("UPDATE activos_fijos SET estatus='baja' WHERE id=?").run(id);
    try {
        if (conta.activo()) {
            const partidas = [];
            if (a.depreciacion_acumulada > 0) partidas.push({ cuenta: DEP_ACUM, debe: r2(a.depreciacion_acumulada) });
            if (enLibros > 0) partidas.push({ cuenta: '601', debe: enLibros });   // pérdida por baja
            partidas.push({ cuenta, haber: valorBruto });
            // El superávit por revaluación se retira a capital (no a resultados).
            if (reval > 0) partidas.push({ cuenta: SUPERAVIT_REVAL, debe: reval }, { cuenta: '301', haber: reval });
            conta.registrarAsiento({ concepto: 'Baja de activo: ' + a.nombre + (motivo ? ' (' + motivo + ')' : ''), referencia_tipo: 'activo_baja', referencia_id: id, partidas, sucursal: a.sucursal });
        }
    } catch (_) {}
    return { id, valor_en_libros: enLibros };
}

// Revaluación al ALZA (comité: "los bienes inmuebles también suben de precio"):
// reconoce la plusvalía de un activo (típicamente inmueble/terreno) cargando su
// cuenta 12x y abonando el superávit por revaluación (capital, 330) — NO pasa por
// resultados. Solo al alza: una caída de valor es deterioro, otro tratamiento.
function revaluarActivo({ id, nuevo_valor, fecha = null }) {
    const a = db.prepare("SELECT * FROM activos_fijos WHERE id=? AND estatus='activo'").get(id);
    if (!a) throw new Error('Activo no encontrado o dado de baja');
    const cuenta = CUENTA_POR_CATEGORIA[a.categoria];
    const enLibros = r2(a.costo + (a.revaluacion_acumulada || 0) - a.depreciacion_acumulada);
    const nuevo = r2(nuevo_valor);
    const incremento = r2(nuevo - enLibros);
    if (!(incremento > 0)) throw new Error('La revaluación es solo al alza: el nuevo valor ($' + nuevo + ') debe ser mayor al valor en libros ($' + enLibros + ')');
    const f = fecha || new Date().toISOString().slice(0, 10);
    const tx = db.transaction(() => {
        db.prepare("UPDATE activos_fijos SET revaluacion_acumulada = ROUND(revaluacion_acumulada + ?, 2) WHERE id=?").run(incremento, id);
        try {
            if (conta.activo()) conta.registrarAsiento({
                concepto: 'Revaluación de activo: ' + a.nombre, referencia_tipo: 'revaluacion_activo', referencia_id: id,
                partidas: [{ cuenta, debe: incremento }, { cuenta: SUPERAVIT_REVAL, haber: incremento }], fecha: f, sucursal: a.sucursal,
            });
        } catch (_) {}
    });
    tx();
    return { id, incremento, valor_en_libros: nuevo };
}

// Listado con valor en libros = costo + revaluación − depreciación acumulada.
function listar({ incluirBajas = false } = {}) {
    const rows = db.prepare(`SELECT * FROM activos_fijos ${incluirBajas ? '' : "WHERE estatus='activo'"} ORDER BY id DESC`).all();
    return rows.map(a => ({ ...a, valor_en_libros: r2(a.costo + (a.revaluacion_acumulada || 0) - a.depreciacion_acumulada) }));
}

function _setDb(x) { db = x; }   // solo tests

module.exports = { comprarActivo, depreciarMes, darDeBaja, revaluarActivo, listar, CUENTA_POR_CATEGORIA, _setDb };
