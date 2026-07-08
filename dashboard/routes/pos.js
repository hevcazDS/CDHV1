'use strict';
// pos.js — Punto de venta de mostrador (Bloque 2B). Cobrar ventas presenciales
// y corte de caja. Gateado por el módulo pos_activo. La VENTA la puede hacer
// cualquier sesión (usuario/cajero); el CORTE es gerente+ (es un reporte).
//
// Reusa la maquinaria de pedidos (_shared.insertarPedidoConCarrito) y el
// chokepoint de puntos (puntosService.otorgarPuntosPorCompra) para que una
// venta de mostrador sea consistente con una de WhatsApp: mismo folio, mismo
// descuento de inventario, mismos puntos.
const shared = require('../../bot/flows/_shared');
const puntosService = require('../../bot/handlers/puntosService');

module.exports = function posRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession } = ctx;

    function posActivo() {
        try {
            const r = db.prepare("SELECT valor FROM configuracion WHERE clave='pos_activo' LIMIT 1").get();
            return !!r && (r.valor === '1' || r.valor === 'true');
        } catch (_) { return false; }
    }
    function sucursalDefault() {
        try {
            const row = db.prepare("SELECT valor FROM configuracion WHERE clave='sucursal_facturacion_default' LIMIT 1").get();
            if (!row) return null;
            const s = db.prepare('SELECT nombre FROM sucursales WHERE id=?').get(Number(row.valor));
            return s ? s.nombre : null;
        } catch (_) { return null; }
    }

    // ── GET /api/pos/config — datos que el mostrador necesita (cualquier
    // sesión / cajero): sucursal y métodos de pago activos. ────────────────
    if (p === '/api/pos/config' && req.method === 'GET') {
        if (!posActivo()) return json(res, { ok: false, error: 'El módulo de punto de venta está desactivado' }, 403);
        let metodos = [];
        try { metodos = db.prepare('SELECT nombre FROM metodos_pago WHERE activo=1 ORDER BY id').all().map(m => m.nombre); } catch (_) {}
        let facturacion = false;
        try { const r = db.prepare("SELECT valor FROM configuracion WHERE clave='facturacion_activo' LIMIT 1").get(); facturacion = !!r && (r.valor === '1' || r.valor === 'true'); } catch (_) {}
        return json(res, { sucursal: sucursalDefault(), metodos, facturacion });
    }

    // ── GET /api/pos/productos?q= — búsqueda ligera para el mostrador ──────
    if (p === '/api/pos/productos' && req.method === 'GET') {
        if (!posActivo()) return json(res, { ok: false, error: 'El módulo de punto de venta está desactivado' }, 403);
        const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim();
        const suc = sucursalDefault();
        const rows = db.prepare(`
            SELECT p.id, p.name, p.price, p.sku,
                   COALESCE((SELECT stock FROM inventarios WHERE id_producto=p.id AND sucursal=?), 0) AS stock
            FROM productos p
            WHERE p.activo=1 AND (? = '' OR p.name LIKE ? OR p.sku LIKE ?)
            ORDER BY p.name LIMIT 25
        `).all(suc || '', q, '%' + q + '%', '%' + q + '%');
        return json(res, { items: rows, sucursal: suc });
    }

    // ── POST /api/pos/venta — cobrar una venta presencial ─────────────────
    // Body: { items:[{id_producto,cantidad,precio?}], metodo_pago, sucursal?,
    //         cliente?:{nombre,telefono}, efectivo_recibido? }
    if (p === '/api/pos/venta' && req.method === 'POST') {
        if (!posActivo()) return json(res, { ok: false, error: 'El módulo de punto de venta está desactivado' }, 403);
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const items = Array.isArray(d.items) ? d.items : [];
                if (!items.length) return json(res, { ok: false, error: 'Agrega al menos un producto' }, 400);
                const metodoPago = String(d.metodo_pago || 'efectivo').trim();
                const sucursal = String(d.sucursal || '').trim() || sucursalDefault();
                if (!sucursal) return json(res, { ok: false, error: 'No hay sucursal de facturación configurada (Prime > General)' }, 400);

                // Armar carrito desde los productos reales (precio del producto,
                // salvo override explícito desde el mostrador).
                const carrito = [];
                for (const it of items) {
                    const prod = db.prepare('SELECT id, name, price FROM productos WHERE id=?').get(Number(it.id_producto));
                    if (!prod) return json(res, { ok: false, error: 'Producto no encontrado: ' + it.id_producto }, 400);
                    const cantidad = Math.max(1, parseInt(it.cantidad, 10) || 1);
                    let price = prod.price;
                    if (it.precio !== undefined && it.precio !== null && it.precio !== '') {
                        price = Number(it.precio);
                        // Antifraude de caja: el override solo puede descontar
                        // hasta 50% del precio de lista, nunca $0 ni sobreprecio
                        if (!Number.isFinite(price) || price < prod.price * 0.5 || price > prod.price) {
                            return json(res, { ok: false, error: `Precio fuera de rango para ${prod.name} (permitido: $${(prod.price * 0.5).toFixed(2)} a $${Number(prod.price).toFixed(2)})` }, 400);
                        }
                    }
                    carrito.push({ id: prod.id, name: prod.name, price, cantidad });
                }

                // Cliente opcional (para acumular puntos). Walk-in = sin cliente.
                let idCliente = null, nombreCliente = 'Mostrador';
                if (d.cliente && (d.cliente.telefono || d.cliente.nombre)) {
                    if (d.cliente.telefono) {
                        const c = shared.upsertCliente(String(d.cliente.telefono).trim(), d.cliente.nombre || null);
                        idCliente = c.id; nombreCliente = c.nombre || d.cliente.nombre || 'Mostrador';
                    } else { nombreCliente = String(d.cliente.nombre).trim(); }
                }

                const folio = shared.generarFolio('pedido');
                const resultado = db.transaction(() => {
                    const { pedidoRowid, subtotal } = shared.insertarPedidoConCarrito(
                        nombreCliente, carrito, '', 'entregado', sucursal, folio, idCliente, 'mostrador'
                    );
                    db.prepare("UPDATE pedidos SET subtotal=?, total=?, metodo_pago=?, metodo_entrega='pickup', actualizado_en=datetime('now','localtime') WHERE id_pedido=?")
                      .run(subtotal, subtotal, metodoPago, pedidoRowid);
                    // Datos fiscales opcionales (comprobante de facturación).
                    const rs = String(d.razon_social || '').trim();
                    const rfc = String(d.rfc || '').trim();
                    if (rs || rfc) db.prepare('UPDATE pedidos SET razon_social=?, rfc=? WHERE id_pedido=?').run(rs || null, rfc || null, pedidoRowid);
                    // Pago ya cobrado en el mostrador → links_pago pagado.
                    const met = db.prepare('SELECT id FROM metodos_pago WHERE nombre=?').get(metodoPago);
                    db.prepare("INSERT INTO links_pago (id_pedido, id_metodo, monto, moneda, estatus, pagado_en, creado_en) VALUES (?,?,?,'MXN','pagado',datetime('now','localtime'),datetime('now','localtime'))")
                      .run(pedidoRowid, met ? met.id : null, subtotal);
                    // Descontar inventario de la sucursal (mismo patrón que marcar-pagado).
                    for (const it of carrito) {
                        db.prepare('UPDATE inventarios SET stock = MAX(0, stock - ?) WHERE id_producto=? AND sucursal=?')
                          .run(it.cantidad, it.id, sucursal);
                    }
                    return { pedidoRowid, subtotal };
                })();
                try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('pago_confirmado','mostrador',?,?)").run(String(resultado.subtotal), (d.cliente && d.cliente.telefono) || null); } catch (_) {}

                // Puntos por la compra (si hay cliente y el módulo está activo).
                try { puntosService.otorgarPuntosPorCompra(resultado.pedidoRowid); } catch (_) {}

                const total = resultado.subtotal;
                const efectivo = (d.efectivo_recibido !== undefined && d.efectivo_recibido !== null && d.efectivo_recibido !== '') ? Number(d.efectivo_recibido) : null;
                const cambio = (efectivo !== null && metodoPago === 'efectivo') ? Math.max(0, efectivo - total) : null;
                return json(res, {
                    ok: true, folio, id_pedido: resultado.pedidoRowid, total, metodo_pago: metodoPago,
                    sucursal, efectivo_recibido: efectivo, cambio,
                    razon_social: String(d.razon_social || '').trim() || null,
                    rfc: String(d.rfc || '').trim() || null,
                    items: carrito.map(i => ({ name: i.name, cantidad: i.cantidad, price: i.price, subtotal: i.price * i.cantidad })),
                });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── POST /api/pos/venta/:id/cancelar — anular venta de mostrador ──────
    // (gerente+: la anulación es supervisión, no operación de cajero).
    // Repone inventario, cancela el pago y marca el pedido — el corte de
    // caja del día deja de contarla automáticamente (suma solo 'pagado').
    if (req.method === 'POST' && p.match(/^\/api\/pos\/venta\/\d+\/cancelar$/)) {
        if (!requireSession(req, res, ['gerente'])) return;
        const idPedido = parseInt(p.split('/')[4]);
        const ped = db.prepare("SELECT * FROM pedidos WHERE id_pedido=? AND canal_creacion='mostrador'").get(idPedido);
        if (!ped) return json(res, { ok: false, error: 'Venta de mostrador no encontrada' }, 404);
        if (/cancelado/i.test(ped.estatus || '')) return json(res, { ok: false, error: 'Esa venta ya está cancelada' }, 400);
        try {
            const r = require('../../services/reversionService').revertirCobro(idPedido, { sucursalDefault: sucursalDefault() });
            if (!r.ok) return json(res, r, 400);
            return json(res, { ok: true, id_pedido: idPedido, estatus: 'cancelado', puntos_revertidos: r.puntos_revertidos });
        } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    }

    // ── GET /api/pos/corte?fecha=YYYY-MM-DD — resumen del día (gerente+) ───
    if (p === '/api/pos/corte' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        const fecha = (new URL(req.url, 'http://x').searchParams.get('fecha') || new Date().toISOString().slice(0, 10)).trim();
        const porMetodo = db.prepare(`
            SELECT COALESCE(p.metodo_pago,'(sin método)') AS metodo, COUNT(*) AS n, COALESCE(SUM(lp.monto),0) AS total
            FROM links_pago lp JOIN pedidos p ON p.id_pedido = lp.id_pedido
            WHERE lp.estatus='pagado' AND DATE(lp.pagado_en) = ?
            GROUP BY p.metodo_pago ORDER BY total DESC
        `).all(fecha);
        const total_sistema = porMetodo.reduce((s, r) => s + (r.total || 0), 0);
        const efectivo_sistema = porMetodo.filter(r => r.metodo === 'efectivo').reduce((s, r) => s + (r.total || 0), 0);
        const cortes = db.prepare('SELECT * FROM cortes_caja WHERE fecha=? ORDER BY id DESC').all(fecha);
        return json(res, { fecha, por_metodo: porMetodo, total_sistema, efectivo_sistema, cortes });
    }

    // ── POST /api/pos/corte — cerrar caja del día (gerente+) ──────────────
    if (p === '/api/pos/corte' && req.method === 'POST') {
        const ses = requireSession(req, res, ['gerente']);
        if (!ses) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const fecha = String(d.fecha || new Date().toISOString().slice(0, 10)).trim();
                const porMetodo = db.prepare(`
                    SELECT COALESCE(p.metodo_pago,'(sin método)') AS metodo, COUNT(*) AS n, COALESCE(SUM(lp.monto),0) AS total
                    FROM links_pago lp JOIN pedidos p ON p.id_pedido = lp.id_pedido
                    WHERE lp.estatus='pagado' AND DATE(lp.pagado_en) = ?
                    GROUP BY p.metodo_pago
                `).all(fecha);
                const total_sistema = porMetodo.reduce((s, r) => s + (r.total || 0), 0);
                const efectivo_sistema = porMetodo.filter(r => r.metodo === 'efectivo').reduce((s, r) => s + (r.total || 0), 0);
                const efectivo_contado = (d.efectivo_contado !== undefined && d.efectivo_contado !== null && d.efectivo_contado !== '') ? Number(d.efectivo_contado) : null;
                const diferencia = efectivo_contado !== null ? parseFloat((efectivo_contado - efectivo_sistema).toFixed(2)) : null;
                const r = db.prepare(`
                    INSERT INTO cortes_caja (fecha, usuario, total_sistema, efectivo_sistema, efectivo_contado, diferencia, detalle_json)
                    VALUES (?,?,?,?,?,?,?)
                `).run(fecha, ses.username, total_sistema, efectivo_sistema, efectivo_contado, diferencia, JSON.stringify(porMetodo));
                return json(res, { ok: true, id: r.lastInsertRowid, total_sistema, efectivo_sistema, efectivo_contado, diferencia });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    return next();
};
