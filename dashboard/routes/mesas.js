'use strict';
// Mesas de restaurante (módulo mesas_activo, giro restaurante). Abrir mesa,
// agregar platillos con comentario libre, preticket a cocina, y cerrar →
// cobro reusando la maquinaria del POS (_shared.insertarPedidoConCarrito).
const shared = require('../../bot/flows/_shared');
const { permite } = require('../permisos');

module.exports = function mesasRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession } = ctx;
    if (!p.startsWith('/api/mesas')) return next();

    const ses = requireSession(req, res);
    if (!ses) return;
    if (!permite(ses.rol, 'pos') && !permite(ses.rol, 'operacion')) {
        return json(res, { ok: false, error: 'Sin acceso a mesas' }, 403);
    }
    const activo = () => db.prepare("SELECT valor FROM configuracion WHERE clave='mesas_activo'").get()?.valor === '1';
    if (!activo()) return json(res, { ok: false, error: 'Activa el módulo Mesas en Módulos' }, 400);

    // GET /api/mesas — mesas abiertas con sus items y total
    if (p === '/api/mesas' && req.method === 'GET') {
        // Una mesa puede tener varios items; traigo mesas + items en 2 queries
        // (no N+1: un solo SELECT de items de TODAS las mesas abiertas).
        const mesas = db.prepare("SELECT * FROM mesas WHERE estatus='abierta' ORDER BY numero").all();
        if (!mesas.length) return json(res, []);
        const ids = mesas.map(m => m.id);
        const items = db.prepare(`SELECT * FROM mesa_items WHERE id_mesa IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids);
        const porMesa = items.reduce((m, i) => ((m[i.id_mesa] = m[i.id_mesa] || []).push(i), m), {});
        return json(res, mesas.map(m => {
            const its = porMesa[m.id] || [];
            return { ...m, items: its, total: Math.round(its.reduce((s, i) => s + i.precio * i.cantidad, 0) * 100) / 100 };
        }));
    }

    // POST /api/mesas — abrir una mesa (numero)
    if (p === '/api/mesas' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const numero = String(JSON.parse(body || '{}').numero || '').trim();
                if (!numero) return json(res, { ok: false, error: 'Falta el número/nombre de la mesa' }, 400);
                if (db.prepare("SELECT 1 FROM mesas WHERE numero=? AND estatus='abierta'").get(numero)) {
                    return json(res, { ok: false, error: 'Esa mesa ya está abierta' }, 400);
                }
                const r = db.prepare('INSERT INTO mesas (numero) VALUES (?)').run(numero);
                try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor) VALUES ('mesa_abierta','mostrador',?)").run(String(numero)); } catch (_) {}
                return json(res, { ok: true, id: r.lastInsertRowid, numero });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // POST /api/mesas/:id/item — agregar platillo con comentario libre
    if (req.method === 'POST' && p.match(/^\/api\/mesas\/\d+\/item$/)) {
        const idMesa = parseInt(p.split('/')[3]);
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const mesa = db.prepare("SELECT * FROM mesas WHERE id=? AND estatus='abierta'").get(idMesa);
                if (!mesa) return json(res, { ok: false, error: 'Mesa no abierta' }, 404);
                let nombre = String(d.nombre || '').trim(), precio = Number(d.precio) || 0, idProd = d.id_producto || null;
                if (idProd) {
                    const pr = db.prepare('SELECT id, name, price FROM productos WHERE id=?').get(idProd);
                    if (pr) { nombre = pr.name; precio = pr.price; idProd = pr.id; }
                }
                if (!nombre) return json(res, { ok: false, error: 'Falta el platillo' }, 400);
                const cantidad = Math.max(1, parseInt(d.cantidad, 10) || 1);
                db.prepare('INSERT INTO mesa_items (id_mesa, id_producto, nombre, precio, cantidad, comentario) VALUES (?,?,?,?,?,?)')
                  .run(idMesa, idProd, nombre, precio, cantidad, String(d.comentario || '').trim() || null);
                return json(res, { ok: true });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // DELETE /api/mesas/:id/item/:itemId — quitar un platillo no enviado
    if (req.method === 'DELETE' && p.match(/^\/api\/mesas\/\d+\/item\/\d+$/)) {
        const itemId = parseInt(p.split('/')[5]);
        db.prepare('DELETE FROM mesa_items WHERE id=? AND enviado_cocina=0').run(itemId);
        return json(res, { ok: true });
    }

    // POST /api/mesas/:id/cocina — preticket: marca items como enviados y los
    // devuelve para imprimir la comanda de cocina.
    if (req.method === 'POST' && p.match(/^\/api\/mesas\/\d+\/cocina$/)) {
        const idMesa = parseInt(p.split('/')[3]);
        const pend = db.prepare('SELECT * FROM mesa_items WHERE id_mesa=? AND enviado_cocina=0 ORDER BY id').all(idMesa);
        if (!pend.length) return json(res, { ok: false, error: 'No hay platillos nuevos que enviar' }, 400);
        db.prepare('UPDATE mesa_items SET enviado_cocina=1 WHERE id_mesa=? AND enviado_cocina=0').run(idMesa);
        const mesa = db.prepare('SELECT numero FROM mesas WHERE id=?').get(idMesa);
        return json(res, { ok: true, mesa: mesa?.numero, comanda: pend.map(i => ({ cantidad: i.cantidad, nombre: i.nombre, comentario: i.comentario })) });
    }

    // GET /api/mesas/:id/sugeridos — complementos para subir el ticket. En
    // restaurante el upsell NO es por similitud (sugeriría otro plato igual),
    // sino por CATEGORÍA de complemento (bebida/postre/entrada). Heurística de
    // keywords, configurable por 'mesas_complemento_cats'; excluye lo que ya
    // está en la mesa. Sin config usable = default de restaurante.
    if (req.method === 'GET' && p.match(/^\/api\/mesas\/\d+\/sugeridos$/)) {
        const idMesa = parseInt(p.split('/')[3]);
        const raw = db.prepare("SELECT valor FROM configuracion WHERE clave='mesas_complemento_cats'").get()?.valor
            || 'bebida,refresco,agua,cerveza,vino,cafe,café,jugo,postre,entrada,guarnici,botana,snack';
        const kw = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (!kw.length) return json(res, { items: [] });
        const enMesa = new Set(db.prepare('SELECT id_producto FROM mesa_items WHERE id_mesa=?').all(idMesa).map(r => r.id_producto).filter(Boolean));
        const like = kw.map(() => "LOWER(COALESCE(cat,'')) LIKE ?").join(' OR ');
        const rows = db.prepare(`SELECT id, name, price FROM productos WHERE tipo!='servicio' AND (${like}) ORDER BY price ASC LIMIT 12`).all(...kw.map(k => '%' + k + '%'));
        return json(res, { items: rows.filter(r => !enMesa.has(r.id)).slice(0, 4) });
    }

    // POST /api/mesas/:id/cerrar — cobrar la mesa (crea el pedido + pago) y
    // libera la mesa. Reusa la misma maquinaria que el POS de mostrador.
    if (req.method === 'POST' && p.match(/^\/api\/mesas\/\d+\/cerrar$/)) {
        const idMesa = parseInt(p.split('/')[3]);
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const mesa = db.prepare("SELECT * FROM mesas WHERE id=? AND estatus='abierta'").get(idMesa);
                if (!mesa) return json(res, { ok: false, error: 'Mesa no abierta' }, 404);
                const items = db.prepare('SELECT * FROM mesa_items WHERE id_mesa=?').all(idMesa);
                if (!items.length) return json(res, { ok: false, error: 'La mesa no tiene consumo' }, 400);
                const carrito = items.map(i => ({ id: i.id_producto, name: i.nombre, price: i.precio, cantidad: i.cantidad, tipo: 'consumible' }));
                const metodoPago = d.metodo_pago || 'efectivo';
                const sucursal = (() => {
                    const v = db.prepare("SELECT valor FROM configuracion WHERE clave='sucursal_facturacion_default'").get()?.valor;
                    if (!v) return '';
                    return db.prepare('SELECT nombre FROM sucursales WHERE id=?').get(Number(v))?.nombre
                        || db.prepare('SELECT nombre FROM sucursales WHERE nombre=?').get(v)?.nombre || '';
                })();
                const folio = shared.generarFolio('pedido');
                const r = db.transaction(() => {
                    const { pedidoRowid, subtotal } = shared.insertarPedidoConCarrito(
                        'Mesa ' + mesa.numero, carrito, '', 'entregado', sucursal, folio, null, 'mostrador');
                    db.prepare("UPDATE pedidos SET subtotal=?, total=?, metodo_pago=?, metodo_entrega='pickup', cobrado_por=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?")
                      .run(subtotal, subtotal, metodoPago, ses.username || null, pedidoRowid);
                    const met = db.prepare('SELECT id FROM metodos_pago WHERE nombre=?').get(metodoPago);
                    db.prepare("INSERT INTO links_pago (id_pedido, id_metodo, monto, moneda, estatus, pagado_en, creado_en) VALUES (?,?,?,'MXN','pagado',datetime('now','localtime'),datetime('now','localtime'))")
                      .run(pedidoRowid, met ? met.id : null, subtotal);
                    db.prepare("UPDATE mesas SET estatus='cobrada', id_pedido=?, cerrada_en=datetime('now','localtime') WHERE id=?").run(pedidoRowid, idMesa);
                    try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor) VALUES ('mesa_cobrada','mostrador',?)").run(String(subtotal)); } catch (_) {}
                    return { pedidoRowid, subtotal, folio };
                })();
                return json(res, { ok: true, folio: r.folio, total: r.subtotal });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    return next();
};
