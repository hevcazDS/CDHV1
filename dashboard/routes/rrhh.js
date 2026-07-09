'use strict';
// RRHH (módulo rrhh_activo): empleados, horarios por plantilla CSV (Excel la
// abre/guarda nativo) y nómina. Acceso: rh, contabilidad, administrador+.
const nominaService = require('../../services/nominaService');
const autorizacion = require('../autorizacion');
const { permite, rangoDe } = require('../permisos');

module.exports = function rrhhRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession } = ctx;
    if (!p.startsWith('/api/rrhh/')) return next();

    const ses = requireSession(req, res);
    if (!ses) return;
    if (!permite(ses.rol, 'rrhh')) return json(res, { ok: false, error: 'Tu rol no tiene acceso a RRHH' }, 403);
    const activo = (() => { try { return db.prepare("SELECT valor FROM configuracion WHERE clave='rrhh_activo'").get()?.valor === '1'; } catch (_) { return false; } })();
    if (!activo) return json(res, { ok: false, error: 'El módulo RRHH está desactivado (actívalo en Módulos)' }, 403);

    if (p === '/api/rrhh/empleados' && req.method === 'GET') {
        const todos = new URL(req.url, 'http://x').searchParams.get('todos') === '1';
        return json(res, db.prepare(`SELECT * FROM empleados ${todos ? '' : 'WHERE activo=1'} ORDER BY activo DESC, nombre`).all());
    }
    if (p === '/api/rrhh/empleados' && req.method === 'POST') {
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

    // Editar/dar de baja empleado (salario, régimen, activo)
    if (req.method === 'PUT' && p.match(/^\/api\/rrhh\/empleados\/\d+$/)) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const e = db.prepare('SELECT id FROM empleados WHERE id=?').get(id);
                if (!e) return json(res, { ok: false, error: 'Empleado no encontrado' }, 404);
                if (d.salario_diario !== undefined && Number(d.salario_diario) > 0) {
                    // Antifraude: cambiar salario exige PIN para roles operativos
                    const errS = autorizacion.exigirAutorizacion(db, ses, d.pin, rangoDe);
                    if (errS) return json(res, { ok: false, error: errS, pin_requerido: true }, 403);
                    db.prepare('UPDATE empleados SET salario_diario=? WHERE id=?').run(Number(d.salario_diario), id);
                }
                if (d.con_impuestos !== undefined) db.prepare('UPDATE empleados SET con_impuestos=? WHERE id=?').run(d.con_impuestos ? 1 : 0, id);
                if (d.puesto !== undefined) db.prepare('UPDATE empleados SET puesto=? WHERE id=?').run(String(d.puesto).trim() || null, id);
                for (const [campo, col] of [['fecha_alta','fecha_alta'],['departamento','departamento'],['metodo_pago','metodo_pago'],['username','username'],['contacto_emergencia','contacto_emergencia']]) {
                    if (d[campo] !== undefined) db.prepare('UPDATE empleados SET ' + col + '=? WHERE id=?').run(String(d[campo]).trim() || null, id);
                }
                if (d.comision_pct !== undefined) db.prepare('UPDATE empleados SET comision_pct=? WHERE id=?').run(Math.max(0, Number(d.comision_pct) || 0), id);
                if (d.activo !== undefined) db.prepare('UPDATE empleados SET activo=? WHERE id=?').run(d.activo ? 1 : 0, id);
                return json(res, { ok: true, id });
            } catch (e2) { return json(res, { ok: false, error: e2.message }, 500); }
        });
    }

    // Plantilla CSV de horarios (descargable; Excel la abre directo)
    if (p === '/api/rrhh/plantilla-horarios' && req.method === 'GET') {
        const empleados = db.prepare('SELECT id, nombre FROM empleados WHERE activo=1 ORDER BY id').all();
        const hoy = new Date().toISOString().slice(0, 10);
        let csv = 'id_empleado,nombre (referencia - no se importa),fecha (AAAA-MM-DD),horas\r\n';
        for (const e of empleados) csv += `${e.id},${e.nombre.replace(/,/g, ' ')},${hoy},8\r\n`;
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="plantilla_horarios.csv"' });
        return res.end('﻿' + csv); // BOM: Excel respeta acentos
    }

    // Importar horarios: el front lee el archivo y manda el texto CSV.
    // Valida fila por fila y reporta errores sin abortar las válidas.
    if (p === '/api/rrhh/horarios/importar' && req.method === 'POST') {
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
                        if (i === 0 && /id_empleado/i.test(linea)) return; // encabezado
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

    // Nómina: calcular el periodo y consultarla; pagar (asiento si contabilidad)
    if (p === '/api/rrhh/nomina/calcular' && req.method === 'POST') {
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
    if (p === '/api/rrhh/nomina' && req.method === 'GET') {
        return json(res, db.prepare(`
            SELECT n.*, e.nombre, e.con_impuestos FROM nominas n JOIN empleados e ON e.id = n.id_empleado
            ORDER BY n.hasta DESC, e.nombre LIMIT 300`).all());
    }
    if (p === '/api/rrhh/nomina/pagar' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { desde, hasta, pin } = JSON.parse(body || '{}');
                // Antifraude: PAGAR nómina exige PIN del administrador para
                // roles operativos (RH no se paga a sí mismo sin autorización)
                const errN = autorizacion.exigirAutorizacion(db, ses, pin, rangoDe);
                if (errN) return json(res, { ok: false, error: errN, pin_requerido: true }, 403);
                return json(res, { ok: true, ...nominaService.pagar(desde, hasta) });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // Aguinaldo de un empleado para un año (proporcional a días trabajados)
    if (req.method === 'GET' && p.match(/^\/api\/rrhh\/aguinaldo\/\d+$/)) {
        const id = parseInt(p.split('/').pop());
        const e = db.prepare('SELECT * FROM empleados WHERE id=?').get(id);
        if (!e) return json(res, { ok: false, error: 'Empleado no encontrado' }, 404);
        const anio = parseInt(new URL(req.url, 'http://x').searchParams.get('anio'), 10) || new Date().getFullYear();
        // días trabajados = días con horario registrado en el año (aprox)
        const dias = db.prepare("SELECT COUNT(DISTINCT fecha) n FROM horarios_empleado WHERE id_empleado=? AND fecha>=? AND fecha<=?").get(id, anio + '-01-01', anio + '-12-31')?.n || 0;
        return json(res, { ok: true, empleado: e.nombre, anio, dias_trabajados: dias, aguinaldo: nominaService.aguinaldo(e.salario_diario, dias) });
    }
    // Finiquito de un empleado a una fecha de baja
    if (req.method === 'POST' && p.match(/^\/api\/rrhh\/finiquito\/\d+$/)) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const e = db.prepare('SELECT * FROM empleados WHERE id=?').get(id);
                if (!e) return json(res, { ok: false, error: 'Empleado no encontrado' }, 404);
                const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha_baja || '') ? d.fecha_baja : new Date().toISOString().slice(0, 10);
                const fin = nominaService.finiquito(e, fecha, { dias_pendientes: d.dias_pendientes, despido_injustificado: !!d.despido_injustificado });
                return json(res, { ok: true, empleado: e.nombre, fecha_baja: fecha, ...fin });
            } catch (e2) { return json(res, { ok: false, error: e2.message }, 500); }
        });
    }

    return next();
};
