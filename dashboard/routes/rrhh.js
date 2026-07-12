'use strict';
// RRHH (módulo rrhh_activo): empleados, horarios por plantilla CSV, nómina,
// aguinaldo y finiquito. Acceso: rh, contabilidad, administrador+.
// Migrado al patrón declarativo del tronco: area:'rrhh' + precondición de
// módulo (rrhh_activo). Los tres PAGOS con PIN incondicional (nómina/aguinaldo/
// finiquito) usan pin:true (el tronco valida + audita); editar salario tiene PIN
// CONDICIONAL (solo si cambia) y se queda en el handler.
const nominaService = require('../../services/nominaService');
const autorizacion = require('../autorizacion');
const { rangoDe } = require('../permisos');
const construirModulo = require('./_construirModulo');

// Precondición: el módulo RRHH debe estar activo (corre tras el gate de área).
const rrhhActivo = construirModulo.precondModulo('rrhh_activo', 'El módulo RRHH está desactivado (actívalo en Módulos)', 403);

function empleadosGet(req, res, ctx) {
    const { db, json } = ctx;
    const todos = new URL(req.url, 'http://x').searchParams.get('todos') === '1';
    return json(res, db.prepare(`SELECT * FROM empleados ${todos ? '' : 'WHERE activo=1'} ORDER BY activo DESC, nombre`).all());
}
function empleadosPost(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const nombre = String(d.nombre || '').trim();
            const salario = Number(d.salario_diario);
            if (!nombre || !(salario > 0)) return json(res, { ok: false, error: 'Nombre y salario diario (>0) son obligatorios' }, 400);
            const r = db.prepare(`INSERT INTO empleados (nombre, puesto, salario_diario, con_impuestos, rfc, curp, nss, fecha_alta, departamento, comision_pct, metodo_pago, username, contacto_emergencia) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                .run(nombre, String(d.puesto || '').trim() || null, salario, d.con_impuestos ? 1 : 0,
                     String(d.rfc || '').trim() || null, String(d.curp || '').trim() || null, String(d.nss || '').trim() || null,
                     String(d.fecha_alta || '').trim() || null, String(d.departamento || '').trim() || null,
                     Math.max(0, Number(d.comision_pct) || 0), (d.metodo_pago === 'efectivo' ? 'efectivo' : 'transferencia'),
                     String(d.username || '').trim() || null, String(d.contacto_emergencia || '').trim() || null);
            return json(res, { ok: true, id: r.lastInsertRowid });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// PUT /api/rrhh/empleados/:id — editar/baja. Cambiar salario exige PIN (CONDICIONAL).
function empleadosPut(req, res, ctx, { params, ses }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const e = db.prepare('SELECT id FROM empleados WHERE id=?').get(id);
            if (!e) return json(res, { ok: false, error: 'Empleado no encontrado' }, 404);
            if (d.salario_diario !== undefined && Number(d.salario_diario) > 0) {
                const errS = autorizacion.exigirAutorizacion(db, ses, d.pin, rangoDe);
                if (errS) return json(res, { ok: false, error: errS, pin_requerido: true }, 403);
                db.prepare('UPDATE empleados SET salario_diario=? WHERE id=?').run(Number(d.salario_diario), id);
            }
            if (d.con_impuestos !== undefined) db.prepare('UPDATE empleados SET con_impuestos=? WHERE id=?').run(d.con_impuestos ? 1 : 0, id);
            if (d.puesto !== undefined) db.prepare('UPDATE empleados SET puesto=? WHERE id=?').run(String(d.puesto).trim() || null, id);
            for (const [campo, col] of [['fecha_alta', 'fecha_alta'], ['departamento', 'departamento'], ['metodo_pago', 'metodo_pago'], ['username', 'username'], ['contacto_emergencia', 'contacto_emergencia']]) {
                if (d[campo] !== undefined) db.prepare('UPDATE empleados SET ' + col + '=? WHERE id=?').run(String(d[campo]).trim() || null, id);
            }
            if (d.comision_pct !== undefined) db.prepare('UPDATE empleados SET comision_pct=? WHERE id=?').run(Math.max(0, Number(d.comision_pct) || 0), id);
            if (d.activo !== undefined) db.prepare('UPDATE empleados SET activo=? WHERE id=?').run(d.activo ? 1 : 0, id);
            return json(res, { ok: true, id });
        } catch (e2) { return json(res, { ok: false, error: e2.message }, 500); }
    });
}

// GET /api/rrhh/plantilla-horarios — CSV descargable (Excel lo abre directo)
function plantillaHorarios(req, res, ctx) {
    const { db } = ctx;
    const empleados = db.prepare('SELECT id, nombre FROM empleados WHERE activo=1 ORDER BY id').all();
    const hoy = new Date().toISOString().slice(0, 10);
    let csv = 'id_empleado,nombre (referencia - no se importa),fecha (AAAA-MM-DD),horas\r\n';
    for (const e of empleados) csv += `${e.id},${e.nombre.replace(/,/g, ' ')},${hoy},8\r\n`;
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="plantilla_horarios.csv"' });
    return res.end('﻿' + csv);
}

// POST /api/rrhh/horarios/importar — CSV de horarios, valida fila por fila.
function horariosImportar(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const { csv } = JSON.parse(body || '{}');
            const lineas = String(csv || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
            const existe = db.prepare('SELECT id FROM empleados WHERE id=? AND activo=1');
            const upsert = db.prepare(`INSERT INTO horarios_empleado (id_empleado, fecha, horas) VALUES (?,?,?)
                                       ON CONFLICT(id_empleado, fecha) DO UPDATE SET horas=excluded.horas`);
            let ok = 0; const errores = [];
            db.transaction(() => {
                lineas.forEach((linea, i) => {
                    if (i === 0 && /id_empleado/i.test(linea)) return;
                    const c = linea.split(',');
                    const id = parseInt(c[0], 10);
                    const fecha = String(c[2] || '').trim();
                    const horas = parseFloat(c[3]);
                    if (!existe.get(id)) return errores.push(`Fila ${i + 1}: empleado ${c[0]} no existe`);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return errores.push(`Fila ${i + 1}: fecha inválida "${fecha}" (usa AAAA-MM-DD)`);
                    if (!(horas >= 0 && horas <= 24)) return errores.push(`Fila ${i + 1}: horas inválidas "${c[3]}"`);
                    upsert.run(id, fecha, horas); ok++;
                });
            })();
            return json(res, { ok: true, importadas: ok, errores });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// Incapacidades IMSS
function incapacidadesGet(req, res, ctx) {
    const { db, json } = ctx;
    const idEmp = parseInt(new URL(req.url, 'http://x').searchParams.get('id_empleado'), 10);
    const rows = idEmp
        ? db.prepare('SELECT * FROM incapacidades_empleado WHERE id_empleado=? ORDER BY desde DESC').all(idEmp)
        : db.prepare('SELECT i.*, e.nombre FROM incapacidades_empleado i JOIN empleados e ON e.id=i.id_empleado ORDER BY i.desde DESC LIMIT 200').all();
    return json(res, rows);
}
function incapacidadesPost(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            if (!Number.isInteger(d.id_empleado)) return json(res, { ok: false, error: 'Falta empleado' }, 400);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d.desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(d.hasta || '')) return json(res, { ok: false, error: 'Fechas inválidas (AAAA-MM-DD)' }, 400);
            if (d.hasta < d.desde) return json(res, { ok: false, error: 'La fecha final es anterior a la inicial' }, 400);
            const r = db.prepare('INSERT INTO incapacidades_empleado (id_empleado, tipo, desde, hasta, folio_imss) VALUES (?,?,?,?,?)')
                .run(d.id_empleado, String(d.tipo || 'enfermedad_general'), d.desde, d.hasta, String(d.folio_imss || '').trim() || null);
            return json(res, { ok: true, id: r.lastInsertRowid });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}
function incapacidadesDelete(req, res, ctx, { params }) {
    const { db, json } = ctx;
    db.prepare('DELETE FROM incapacidades_empleado WHERE id=?').run(parseInt(params[0]));
    return json(res, { ok: true });
}

// Nómina
function nominaCalcular(req, res, ctx) {
    const { json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const { desde, hasta } = JSON.parse(body || '{}');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(hasta || '')) {
                return json(res, { ok: false, error: 'Rango de fechas inválido' }, 400);
            }
            return json(res, { ok: true, nominas: nominaService.calcular(desde, hasta) });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}
function nominaGet(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, db.prepare(`
        SELECT n.*, e.nombre, e.con_impuestos FROM nominas n JOIN empleados e ON e.id = n.id_empleado
        ORDER BY n.hasta DESC, e.nombre LIMIT 300`).all());
}
// POST /api/rrhh/nomina/pagar — pin:true (el tronco validó el PIN y auditó).
function nominaPagar(req, res, ctx, { body }) {
    const { json } = ctx;
    try {
        const { desde, hasta } = body;
        return json(res, { ok: true, ...nominaService.pagar(desde, hasta) });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// GET /api/rrhh/aguinaldo/:id — cálculo (proporcional a días trabajados)
function aguinaldoGet(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const id = parseInt(params[0]);
    const e = db.prepare('SELECT * FROM empleados WHERE id=?').get(id);
    if (!e) return json(res, { ok: false, error: 'Empleado no encontrado' }, 404);
    const anio = parseInt(new URL(req.url, 'http://x').searchParams.get('anio'), 10) || new Date().getFullYear();
    const dias = db.prepare("SELECT COUNT(DISTINCT fecha) n FROM horarios_empleado WHERE id_empleado=? AND fecha>=? AND fecha<=?").get(id, anio + '-01-01', anio + '-12-31')?.n || 0;
    const pagado = !!db.prepare('SELECT 1 FROM nomina_extraordinaria WHERE referencia=?').get('aguinaldo_' + id + '_' + anio);
    return json(res, { ok: true, empleado: e.nombre, anio, dias_trabajados: dias, aguinaldo: nominaService.aguinaldo(e.salario_diario, dias), pagado });
}
// POST /api/rrhh/aguinaldo/:id/pagar — pin:true + asiento + huella.
function aguinaldoPagar(req, res, ctx, { params, body, ses }) {
    const { db, json } = ctx;
    try {
        const id = parseInt(params[0]);
        const e = db.prepare('SELECT * FROM empleados WHERE id=?').get(id);
        if (!e) return json(res, { ok: false, error: 'Empleado no encontrado' }, 404);
        const anio = parseInt(body.anio, 10) || new Date().getFullYear();
        const dias = db.prepare("SELECT COUNT(DISTINCT fecha) n FROM horarios_empleado WHERE id_empleado=? AND fecha>=? AND fecha<=?").get(id, anio + '-01-01', anio + '-12-31')?.n || 0;
        const monto = nominaService.aguinaldo(e.salario_diario, dias);
        const r = nominaService.pagarAguinaldo(e, anio, monto, ses.username);
        require('../../services/configAudit').logCambio(db, 'aguinaldo_pagado', e.nombre + ' ' + anio + ' $' + r.total, ses.username);
        return json(res, { ok: true, empleado: e.nombre, anio, ...r });
    } catch (e2) { return json(res, { ok: false, error: e2.message }, 500); }
}

// POST /api/rrhh/finiquito/:id — preview (sin PIN)
function finiquitoPreview(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const e = db.prepare('SELECT * FROM empleados WHERE id=?').get(id);
            if (!e) return json(res, { ok: false, error: 'Empleado no encontrado' }, 404);
            const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha_baja || '') ? d.fecha_baja : new Date().toISOString().slice(0, 10);
            const fin = nominaService.finiquito(e, fecha, { dias_pendientes: d.dias_pendientes, tipo_baja: d.tipo_baja, despido_injustificado: !!d.despido_injustificado });
            const pagado = !!db.prepare('SELECT 1 FROM nomina_extraordinaria WHERE referencia=?').get('finiquito_' + id);
            return json(res, { ok: true, empleado: e.nombre, fecha_baja: fecha, pagado, ...fin });
        } catch (e2) { return json(res, { ok: false, error: e2.message }, 500); }
    });
}
// POST /api/rrhh/finiquito/:id/pagar — pin:true + asiento + baja + huella.
function finiquitoPagar(req, res, ctx, { params, body, ses }) {
    const { db, json } = ctx;
    try {
        const id = parseInt(params[0]);
        const e = db.prepare('SELECT * FROM empleados WHERE id=?').get(id);
        if (!e) return json(res, { ok: false, error: 'Empleado no encontrado' }, 404);
        const d = body;
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha_baja || '') ? d.fecha_baja : new Date().toISOString().slice(0, 10);
        const fin = nominaService.finiquito(e, fecha, { dias_pendientes: d.dias_pendientes, tipo_baja: d.tipo_baja, despido_injustificado: !!d.despido_injustificado });
        const r = nominaService.pagarFiniquito(e, fecha, fin, ses.username);
        require('../../services/configAudit').logCambio(db, 'finiquito_pagado', e.nombre + ' baja ' + fecha + ' $' + r.total, ses.username);
        return json(res, { ok: true, empleado: e.nombre, fecha_baja: fecha, ...fin, ...r });
    } catch (e2) { return json(res, { ok: false, error: e2.message }, 500); }
}

// POST /api/rrhh/nomina/:id/timbrar — timbra el recibo CFDI de nómina vía el PAC
function nominaTimbrar(req, res, ctx, { params }) {
    const { db, json } = ctx;
    return require('../../services/pacService').timbrarNomina(db, parseInt(params[0]))
        .then(r => json(res, r, r.ok ? 200 : (r.pendiente ? 200 : 400)))
        .catch(e => json(res, { ok: false, error: e.message }, 500));
}

const RUTAS = [
    { metodo: 'GET',    path: '/api/rrhh/empleados',                        area: 'rrhh', handler: empleadosGet },
    { metodo: 'POST',   path: '/api/rrhh/empleados',                        area: 'rrhh', handler: empleadosPost },
    { metodo: 'PUT',    path: /^\/api\/rrhh\/empleados\/(\d+)$/,            area: 'rrhh', handler: empleadosPut },
    { metodo: 'GET',    path: '/api/rrhh/plantilla-horarios',               area: 'rrhh', handler: plantillaHorarios },
    { metodo: 'POST',   path: '/api/rrhh/horarios/importar',                area: 'rrhh', handler: horariosImportar },
    { metodo: 'GET',    path: '/api/rrhh/incapacidades',                    area: 'rrhh', handler: incapacidadesGet },
    { metodo: 'POST',   path: '/api/rrhh/incapacidades',                    area: 'rrhh', handler: incapacidadesPost },
    { metodo: 'DELETE', path: /^\/api\/rrhh\/incapacidades\/(\d+)$/,        area: 'rrhh', handler: incapacidadesDelete },
    { metodo: 'POST',   path: '/api/rrhh/nomina/calcular',                  area: 'rrhh', handler: nominaCalcular },
    { metodo: 'GET',    path: '/api/rrhh/nomina',                           area: 'rrhh', handler: nominaGet },
    { metodo: 'POST',   path: '/api/rrhh/nomina/pagar',                     area: 'rrhh', pin: true, handler: nominaPagar },
    { metodo: 'GET',    path: /^\/api\/rrhh\/aguinaldo\/(\d+)$/,            area: 'rrhh', handler: aguinaldoGet },
    { metodo: 'POST',   path: /^\/api\/rrhh\/aguinaldo\/(\d+)\/pagar$/,     area: 'rrhh', pin: true, handler: aguinaldoPagar },
    { metodo: 'POST',   path: /^\/api\/rrhh\/finiquito\/(\d+)$/,            area: 'rrhh', handler: finiquitoPreview },
    { metodo: 'POST',   path: /^\/api\/rrhh\/finiquito\/(\d+)\/pagar$/,     area: 'rrhh', pin: true, handler: finiquitoPagar },
    { metodo: 'POST',   path: /^\/api\/rrhh\/nomina\/(\d+)\/timbrar$/,      area: 'rrhh', handler: nominaTimbrar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/rrhh/', precondicion: rrhhActivo });
