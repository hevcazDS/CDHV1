'use strict';
// activosFijosService — alta, listado, depreciación lineal y baja de activos
// fijos (equipo/cómputo/vehículos/maquinaria/inmuebles). Se capitalizan en su
// cuenta 12x y se deprecian contra 129 (dep. acumulada) / 605 (gasto). Reusa el
// motor contable de partida doble (registrarAsiento). Ver AUDITORIA_GIMNASIOS_ACTIVOS.md.
let db = require('../bot/db_connection');
const conta = require('./contabilidadService');

const CUENTA_POR_CATEGORIA = {
    equipo: '120', computo: '121', vehiculos: '122', maquinaria: '123', inmuebles: '124',
};
const DEP_ACUM = '129';   // depreciación acumulada (contra-activo)
const GASTO_DEP = '605';  // gasto por depreciación
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
    const activos = db.prepare("SELECT * FROM activos_fijos WHERE estatus='activo' AND (ultima_depreciacion IS NULL OR ultima_depreciacion < ?)").all(mes);
    let n = 0;
    for (const a of activos) {
        const depreciable = r2(a.costo - a.valor_residual);
        const pendiente = r2(depreciable - a.depreciacion_acumulada);
        if (pendiente <= 0) { db.prepare("UPDATE activos_fijos SET ultima_depreciacion=? WHERE id=?").run(mes, a.id); continue; }
        const cuota = Math.min(pendiente, r2(depreciable / a.vida_util_meses));
        if (!(cuota > 0)) continue;
        const tx = db.transaction(() => {
            db.prepare("UPDATE activos_fijos SET depreciacion_acumulada = ROUND(depreciacion_acumulada + ?, 2), ultima_depreciacion=? WHERE id=?").run(cuota, mes, a.id);
            try {
                if (conta.activo()) conta.registrarAsiento({
                    concepto: 'Depreciación ' + mes + ': ' + a.nombre, referencia_tipo: 'depreciacion', referencia_id: a.id,
                    partidas: [{ cuenta: GASTO_DEP, debe: cuota }, { cuenta: DEP_ACUM, haber: cuota }], fecha: finMes, sucursal: a.sucursal,
                });
            } catch (_) {}
        });
        tx(); n++;
    }
    return n;
}

// Baja/retiro (write-off): saca el activo de libros. Cargo 129 (dep. acumulada)
// + cargo 601 por el valor en libros restante (pérdida), abono la cuenta 12x.
function darDeBaja(id, motivo = '') {
    const a = db.prepare("SELECT * FROM activos_fijos WHERE id=? AND estatus='activo'").get(id);
    if (!a) throw new Error('Activo no encontrado o ya dado de baja');
    const cuenta = CUENTA_POR_CATEGORIA[a.categoria];
    const enLibros = r2(a.costo - a.depreciacion_acumulada);
    db.prepare("UPDATE activos_fijos SET estatus='baja' WHERE id=?").run(id);
    try {
        if (conta.activo()) {
            const partidas = [];
            if (a.depreciacion_acumulada > 0) partidas.push({ cuenta: DEP_ACUM, debe: r2(a.depreciacion_acumulada) });
            if (enLibros > 0) partidas.push({ cuenta: '601', debe: enLibros });   // pérdida por baja
            partidas.push({ cuenta, haber: r2(a.costo) });
            conta.registrarAsiento({ concepto: 'Baja de activo: ' + a.nombre + (motivo ? ' (' + motivo + ')' : ''), referencia_tipo: 'activo_baja', referencia_id: id, partidas, sucursal: a.sucursal });
        }
    } catch (_) {}
    return { id, valor_en_libros: enLibros };
}

// Listado con valor en libros = costo − depreciación acumulada.
function listar({ incluirBajas = false } = {}) {
    const rows = db.prepare(`SELECT * FROM activos_fijos ${incluirBajas ? '' : "WHERE estatus='activo'"} ORDER BY id DESC`).all();
    return rows.map(a => ({ ...a, valor_en_libros: r2(a.costo - a.depreciacion_acumulada) }));
}

function _setDb(x) { db = x; }   // solo tests

module.exports = { comprarActivo, depreciarMes, darDeBaja, listar, CUENTA_POR_CATEGORIA, _setDb };
