'use strict';
// Almacén: inventario (lectura para compras), ubicaciones geoespaciales,
// traslados/salidas con PIN, conteo físico contra archivo de UPCs y kardex.
// Migrado al patrón declarativo del tronco:
//   - lectura (calendario/inventario/plantilla/kardex) → areas almacen||almacen_lectura
//   - escritura (ubicacion/traslado/salida/conteo) → area almacen
//   - traslado y salida usan pin:true (PIN incondicional por-ruta lo maneja el
//     tronco: valida + bitácora); conteo/aplicar tiene PIN CONDICIONAL (solo a
//     la baja) y se queda en el handler.
//   - kardex es de auditoría (administrador+ o auditor): check fino en el handler.
const kardexService = require('../../services/kardexService');
const autorizacion = require('../autorizacion');
const { rangoDe } = require('../permisos');
const construirModulo = require('./_construirModulo');

// GET /api/almacen/calendario — mercancía proyectada (entradas/salidas)
// + tareas/recordatorios con fecha del área almacén o del propio usuario.
function calendario(req, res, ctx, { ses }) {
    const { db, json } = ctx;
    const sp = new URL(req.url, 'http://x').searchParams;
    const desde = (sp.get('desde') || new Date().toISOString().slice(0, 8) + '01').slice(0, 10);
    const hasta = (sp.get('hasta') || new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10)).slice(0, 10);
    const entradas = db.prepare(`
        SELECT pv.fecha_llegada_est AS fecha, COALESCE(pr.name, pv.nombre_preventa) AS titulo, pv.cantidad
        FROM preventas pv LEFT JOIN productos pr ON pr.id = pv.id_producto
        WHERE pv.activa = 1 AND pv.fecha_llegada_real IS NULL AND pv.fecha_llegada_est BETWEEN ? AND ?`).all(desde, hasta);
    const ocs = db.prepare(`
        SELECT oc.fecha_llegada_est AS fecha, oc.folio, pv.nombre AS proveedor
        FROM ordenes_compra oc LEFT JOIN proveedores pv ON pv.id = oc.id_proveedor
        WHERE oc.estatus = 'abierta' AND oc.fecha_llegada_est BETWEEN ? AND ?`).all(desde, hasta);
    const salidas = db.prepare(`
        SELECT g.fecha_envio_est AS fecha, p.folio AS titulo, p.cliente
        FROM guias_estafeta g JOIN pedidos p ON p.id_pedido = g.id_pedido
        WHERE g.fecha_envio_est BETWEEN ? AND ? AND g.fecha_entrega_real IS NULL AND COALESCE(g.estatus_entrega,'') != 'entregada'`).all(desde, hasta);
    const tareas = db.prepare(`
        SELECT fecha, titulo, asignado_a FROM tareas
        WHERE estatus='pendiente' AND fecha BETWEEN ? AND ? AND (area='almacen' OR asignado_a=? OR creado_por=?)`)
        .all(desde, hasta, ses.username, ses.username);
    return json(res, {
        eventos: [
            ...entradas.map(e => ({ fecha: e.fecha, tipo: 'entrada', titulo: '📥 ' + e.titulo, sub: e.cantidad ? e.cantidad + ' pz' : '' })),
            ...ocs.map(o => ({ fecha: o.fecha, tipo: 'entrada', titulo: '📥 OC ' + o.folio, sub: o.proveedor || '' })),
            ...salidas.map(s => ({ fecha: s.fecha, tipo: 'salida', titulo: '📤 ' + s.titulo, sub: s.cliente || '' })),
            ...tareas.map(t => ({ fecha: t.fecha, tipo: 'tarea', titulo: '📌 ' + t.titulo, sub: t.asignado_a || '' })),
        ],
    });
}

// GET /api/almacen/inventario — inventario en lectura
function inventario(req, res, ctx) {
    const { db, json } = ctx;
    const q = ((new URL(req.url, 'http://x')).searchParams.get('q') || '').trim();
    const like = '%' + q + '%';
    return json(res, db.prepare(`
        SELECT p2.id, p2.name, p2.upc, p2.sku, p2.tipo, i.sucursal, i.stock, i.stock_minimo,
               ub.zona, ub.pasillo, ub.rack, ub.nivel
        FROM inventarios i JOIN productos p2 ON p2.id = i.id_producto
        LEFT JOIN ubicaciones_inventario ub ON ub.id_producto = i.id_producto AND ub.sucursal = i.sucursal
        WHERE p2.activo=1 AND (? = '' OR p2.name LIKE ? OR p2.upc LIKE ? OR p2.sku LIKE ?)
        ORDER BY p2.name LIMIT 300`).all(q, like, like, like));
}

// GET /api/almacen/plantilla-conteo — CSV del inventario actual para el conteo
function plantillaConteo(req, res, ctx) {
    const { db } = ctx;
    const suc = ((new URL(req.url, 'http://x')).searchParams.get('sucursal') || '').trim();
    const filas = db.prepare(`
        SELECT p2.upc, p2.sku, p2.name, i.sucursal, i.stock
        FROM inventarios i JOIN productos p2 ON p2.id = i.id_producto
        WHERE p2.activo=1 AND p2.tipo != 'servicio' AND (? = '' OR i.sucursal = ?)
        ORDER BY p2.name`).all(suc, suc);
    let csv = 'upc,nombre (referencia - no se importa),stock_sistema (referencia),cantidad\r\n';
    for (const f of filas) csv += `${f.upc || f.sku || ''},${(f.name || '').replace(/,/g, ' ')},${f.stock},\r\n`;
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="plantilla_conteo.csv"' });
    return res.end('﻿' + csv);
}

// GET /api/almacen/kardex — ledger de AUDITORÍA: administrador+ o auditor.
function kardex(req, res, ctx, { ses }) {
    const { json } = ctx;
    if (rangoDe(ses.rol) < 2 && ses.rol !== 'auditor') {
        return json(res, { ok: false, error: 'El kardex es de auditoría (administrador o auditor)' }, 403);
    }
    const sp = (new URL(req.url, 'http://x')).searchParams;
    const idProd = parseInt(sp.get('producto'), 10);
    if (!idProd) return json(res, { ok: false, error: 'Falta producto' }, 400);
    return json(res, kardexService.kardex(idProd, sp.get('sucursal') || null));
}

// PUT /api/almacen/ubicacion — ubicación geoespacial del producto
function ubicacion(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            if (!Number.isInteger(d.id_producto) || !String(d.sucursal || '').trim()) {
                return json(res, { ok: false, error: 'Faltan producto/sucursal' }, 400);
            }
            db.prepare(`INSERT INTO ubicaciones_inventario (id_producto, sucursal, zona, pasillo, rack, nivel)
                        VALUES (?,?,?,?,?,?)
                        ON CONFLICT(id_producto, sucursal) DO UPDATE SET zona=excluded.zona, pasillo=excluded.pasillo,
                        rack=excluded.rack, nivel=excluded.nivel, actualizado_en=datetime('now','localtime')`)
              .run(d.id_producto, d.sucursal.trim(), d.zona || null, d.pasillo || null, d.rack || null, d.nivel || null);
            return json(res, { ok: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/almacen/traslado — entre bodegas (salida de origen ⇒ pin:true).
// El tronco ya validó el PIN y dejó bitácora; recibimos el body parseado.
function traslado(req, res, ctx, { body, ses }) {
    const { db, json } = ctx;
    try {
        const d = body;
        const cant = parseInt(d.cantidad, 10);
        if (!Number.isInteger(d.id_producto) || !(cant > 0) || !d.origen || !d.destino || d.origen === d.destino) {
            return json(res, { ok: false, error: 'Datos de traslado inválidos' }, 400);
        }
        const stock = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(d.id_producto, d.origen)?.stock || 0;
        if (stock < cant) return json(res, { ok: false, error: `Stock insuficiente en ${d.origen} (hay ${stock})` }, 400);
        db.transaction(() => {
            kardexService.movimiento({ id_producto: d.id_producto, sucursal: d.origen, tipo: 'traslado_salida', delta: -cant, motivo: 'Traslado → ' + d.destino, usuario: ses.username });
            kardexService.movimiento({ id_producto: d.id_producto, sucursal: d.destino, tipo: 'traslado_entrada', delta: cant, motivo: 'Traslado ← ' + d.origen, usuario: ses.username });
        })();
        return json(res, { ok: true });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// POST /api/almacen/salida — salida/baja de inventario (pin:true).
function salida(req, res, ctx, { body, ses }) {
    const { db, json } = ctx;
    try {
        const d = body;
        const cant = parseInt(d.cantidad, 10);
        if (!Number.isInteger(d.id_producto) || !(cant > 0) || !d.sucursal) return json(res, { ok: false, error: 'Datos inválidos' }, 400);
        kardexService.movimiento({ id_producto: d.id_producto, sucursal: d.sucursal, tipo: 'salida', delta: -cant, motivo: d.motivo || 'Salida de almacén', usuario: ses.username });
        return json(res, { ok: true });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
}

// POST /api/almacen/conteo — conteo físico contra archivo: devuelve diferencias.
function conteo(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const sucursal = String(d.sucursal || '').trim();
            const lineas = Array.isArray(d.lineas) ? d.lineas : [];
            if (!sucursal || !lineas.length) return json(res, { ok: false, error: 'Faltan sucursal/líneas' }, 400);
            const buscar = db.prepare('SELECT id, name FROM productos WHERE upc=? OR sku=? OR CAST(id AS TEXT)=? LIMIT 1');
            const stockDe = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?');
            const resultado = [], noEncontrados = [];
            for (const l of lineas) {
                const codigo = String(l.upc || '').trim();
                const prod = codigo && buscar.get(codigo, codigo, codigo);
                if (!prod) { noEncontrados.push(codigo); continue; }
                const sistema = stockDe.get(prod.id, sucursal)?.stock || 0;
                const fisico = parseInt(l.cantidad, 10) || 0;
                resultado.push({ id_producto: prod.id, name: prod.name, upc: codigo, sistema, fisico, diferencia: fisico - sistema });
            }
            return json(res, { ok: true, sucursal, resultado, no_encontrados: noEncontrados });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/almacen/conteo/aplicar — aplica ajustes; a la BAJA exige PIN
// (CONDICIONAL por el body → se queda en el handler, no es pin:true).
function conteoAplicar(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const ajustes = (Array.isArray(d.ajustes) ? d.ajustes : []).filter(a => a.diferencia !== 0);
            if (!d.sucursal || !ajustes.length) return json(res, { ok: false, error: 'Nada que ajustar' }, 400);
            if (ajustes.some(a => a.diferencia < 0)) {
                const err = autorizacion.exigirAutorizacion(db, ses, d.pin, rangoDe);
                if (err) return json(res, { ok: false, error: err, pin_requerido: true }, 403);
            }
            db.transaction(() => {
                for (const a of ajustes) {
                    kardexService.movimiento({ id_producto: a.id_producto, sucursal: d.sucursal, tipo: 'ajuste_conteo', delta: a.diferencia, motivo: 'Conteo físico', usuario: ses.username });
                }
            })();
            return json(res, { ok: true, aplicados: ajustes.length });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/almacen/calendario',        areas: ['almacen', 'almacen_lectura'], handler: calendario },
    { metodo: 'GET',  path: '/api/almacen/inventario',        areas: ['almacen', 'almacen_lectura'], handler: inventario },
    { metodo: 'GET',  path: '/api/almacen/plantilla-conteo',  areas: ['almacen', 'almacen_lectura'], handler: plantillaConteo },
    { metodo: 'GET',  path: '/api/almacen/kardex',            areas: ['almacen', 'almacen_lectura'], handler: kardex },
    { metodo: 'PUT',  path: '/api/almacen/ubicacion',         area: 'almacen', handler: ubicacion },
    { metodo: 'POST', path: '/api/almacen/traslado',          area: 'almacen', pin: true, handler: traslado },
    { metodo: 'POST', path: '/api/almacen/salida',            area: 'almacen', pin: true, handler: salida },
    { metodo: 'POST', path: '/api/almacen/conteo',            area: 'almacen', handler: conteo },
    { metodo: 'POST', path: '/api/almacen/conteo/aplicar',    area: 'almacen', handler: conteoAplicar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/almacen/' });
