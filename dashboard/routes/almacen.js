'use strict';
// Almacén: inventario (lectura para compras), ubicaciones geoespaciales,
// traslados/salidas con PIN, conteo físico contra archivo de UPCs y kardex.
const kardexService = require('../../services/kardexService');
const autorizacion = require('../autorizacion');
const { rangoDe, permite } = require('../permisos');

module.exports = function almacenRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession, log } = ctx;
    if (!p.startsWith('/api/almacen/')) return next();

    const sesion = requireSession(req, res);
    if (!sesion) return;
    const lectura = permite(sesion.rol, 'almacen') || permite(sesion.rol, 'almacen_lectura');
    const escritura = permite(sesion.rol, 'almacen');
    if (!lectura) return json(res, { ok: false, error: 'Tu rol no tiene acceso a almacén' }, 403);

    // Inventario en lectura (almacén, compras, administrador+)
    if (p === '/api/almacen/inventario' && req.method === 'GET') {
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

    if (p === '/api/almacen/kardex' && req.method === 'GET') {
        const sp = (new URL(req.url, 'http://x')).searchParams;
        const idProd = parseInt(sp.get('producto'), 10);
        if (!idProd) return json(res, { ok: false, error: 'Falta producto' }, 400);
        return json(res, kardexService.kardex(idProd, sp.get('sucursal') || null));
    }

    if (!escritura && req.method !== 'GET') return json(res, { ok: false, error: 'Solo lectura para tu rol' }, 403);

    // Ubicación geoespacial del producto en la bodega
    if (p === '/api/almacen/ubicacion' && req.method === 'PUT') {
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

    // Traslado entre bodegas — requiere PIN (es salida de la bodega origen)
    if (p === '/api/almacen/traslado' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const err = autorizacion.exigirAutorizacion(db, sesion, d.pin, rangoDe);
                if (err) return json(res, { ok: false, error: err, pin_requerido: true }, 403);
                const cant = parseInt(d.cantidad, 10);
                if (!Number.isInteger(d.id_producto) || !(cant > 0) || !d.origen || !d.destino || d.origen === d.destino) {
                    return json(res, { ok: false, error: 'Datos de traslado inválidos' }, 400);
                }
                const stock = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(d.id_producto, d.origen)?.stock || 0;
                if (stock < cant) return json(res, { ok: false, error: `Stock insuficiente en ${d.origen} (hay ${stock})` }, 400);
                db.transaction(() => {
                    kardexService.movimiento({ id_producto: d.id_producto, sucursal: d.origen, tipo: 'traslado_salida', delta: -cant, motivo: 'Traslado → ' + d.destino, usuario: sesion.username });
                    kardexService.movimiento({ id_producto: d.id_producto, sucursal: d.destino, tipo: 'traslado_entrada', delta: cant, motivo: 'Traslado ← ' + d.origen, usuario: sesion.username });
                })();
                return json(res, { ok: true });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // Salida/baja de inventario — requiere PIN
    if (p === '/api/almacen/salida' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const err = autorizacion.exigirAutorizacion(db, sesion, d.pin, rangoDe);
                if (err) return json(res, { ok: false, error: err, pin_requerido: true }, 403);
                const cant = parseInt(d.cantidad, 10);
                if (!Number.isInteger(d.id_producto) || !(cant > 0) || !d.sucursal) return json(res, { ok: false, error: 'Datos inválidos' }, 400);
                kardexService.movimiento({ id_producto: d.id_producto, sucursal: d.sucursal, tipo: 'salida', delta: -cant, motivo: d.motivo || 'Salida de almacén', usuario: sesion.username });
                return json(res, { ok: true });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // Conteo físico contra archivo: lineas = [{upc, cantidad}] (o upc repetido
    // escaneado en lista — el front lo agrupa). Devuelve diferencias.
    if (p === '/api/almacen/conteo' && req.method === 'POST') {
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

    // Aplicar los ajustes del conteo — a la baja exige PIN
    if (p === '/api/almacen/conteo/aplicar' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const ajustes = (Array.isArray(d.ajustes) ? d.ajustes : []).filter(a => a.diferencia !== 0);
                if (!d.sucursal || !ajustes.length) return json(res, { ok: false, error: 'Nada que ajustar' }, 400);
                if (ajustes.some(a => a.diferencia < 0)) {
                    const err = autorizacion.exigirAutorizacion(db, sesion, d.pin, rangoDe);
                    if (err) return json(res, { ok: false, error: err, pin_requerido: true }, 403);
                }
                db.transaction(() => {
                    for (const a of ajustes) {
                        kardexService.movimiento({ id_producto: a.id_producto, sucursal: d.sucursal, tipo: 'ajuste_conteo', delta: a.diferencia, motivo: 'Conteo físico', usuario: sesion.username });
                    }
                })();
                return json(res, { ok: true, aplicados: ajustes.length });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    return next();
};
