'use strict';
// RRHH (módulo rrhh_activo): empleados, horarios por plantilla CSV (Excel la
// abre/guarda nativo) y nómina. Acceso: rh, contabilidad, administrador+.
const nominaService = require('../../services/nominaService');
const { permite } = require('../permisos');

module.exports = function rrhhRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession } = ctx;
    if (!p.startsWith('/api/rrhh/')) return next();

    const ses = requireSession(req, res);
    if (!ses) return;
    if (!permite(ses.rol, 'rrhh')) return json(res, { ok: false, error: 'Tu rol no tiene acceso a RRHH' }, 403);
    const activo = (() => { try { return db.prepare("SELECT valor FROM configuracion WHERE clave='rrhh_activo'").get()?.valor === '1'; } catch (_) { return false; } })();
    if (!activo) return json(res, { ok: false, error: 'El módulo RRHH está desactivado (actívalo en Módulos)' }, 403);

    if (p === '/api/rrhh/empleados' && req.method === 'GET') {
        return json(res, db.prepare('SELECT * FROM empleados WHERE activo=1 ORDER BY nombre').all());
    }
    if (p === '/api/rrhh/empleados' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const nombre = String(d.nombre || '').trim();
                const salario = Number(d.salario_diario);
                if (!nombre || !(salario > 0)) return json(res, { ok: false, error: 'Nombre y salario diario (>0) son obligatorios' }, 400);
                const r = db.prepare('INSERT INTO empleados (nombre, puesto, salario_diario, con_impuestos, rfc, curp, nss) VALUES (?,?,?,?,?,?,?)')
                    .run(nombre, String(d.puesto || '').trim() || null, salario, d.con_impuestos ? 1 : 0,
                         String(d.rfc || '').trim() || null, String(d.curp || '').trim() || null, String(d.nss || '').trim() || null);
                return json(res, { ok: true, id: r.lastInsertRowid });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
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
                const { desde, hasta } = JSON.parse(body || '{}');
                return json(res, { ok: true, ...nominaService.pagar(desde, hasta) });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    return next();
};
