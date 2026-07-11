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
const kardexService = require('../../services/kardexService');
const autorizacion = require('../autorizacion');
const { permite, rangoDe } = require('../permisos');

module.exports = function posRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession } = ctx;
    // Área POS: cajero/operador/administrador/prime
    if (p.startsWith('/api/pos/') && !p.startsWith('/api/pos/buscar-producto') && !p.startsWith('/api/pos/venta-previa')) {
        const _s = requireSession(req, res);
        if (!_s) return;
        // Corte y la LECTURA de fiados (cartera CxC) son financieros: los ve
        // finanzas/cortes aunque no tengan 'pos' (ver ≠ editar — la venta, el
        // límite de crédito y la cancelación siguen exigiendo 'pos'/gerente).
        const _esCorte = p.startsWith('/api/pos/corte');
        const _esFiadosLectura = req.method === 'GET' && p.endsWith('/pos/fiados'); // endsWith: no confundir al índice canónico con una ruta
        const _finanzas = permite(_s.rol, 'cortes') || permite(_s.rol, 'finanzas');
        if (!permite(_s.rol, 'pos') && !((_esCorte || _esFiadosLectura) && _finanzas)) {
            return json(res, { ok: false, error: 'Tu rol no tiene acceso al punto de venta' }, 403);
        }
        req._ses = _s;
    }

    function posActivo() {
        try {
            const r = db.prepare("SELECT valor FROM configuracion WHERE clave='pos_activo' LIMIT 1").get();
            return !!r && (r.valor === '1' || r.valor === 'true');
        } catch (_) { return false; }
    }
    // Negocios que SOLO venden (sin control de inventario): default ON, pero
    // si el dueño lo apaga, el POS no valida ni descuenta stock — puede
    // vender por código aunque no haya existencias registradas.
    function inventarioActivo() {
        try {
            const r = db.prepare("SELECT valor FROM configuracion WHERE clave='inventario_activo' LIMIT 1").get();
            return !r || r.valor !== '0'; // default ON
        } catch (_) { return true; }
    }
    function creditoActivo() {
        try { return db.prepare("SELECT valor FROM configuracion WHERE clave='ventas_credito_activo' LIMIT 1").get()?.valor === '1'; }
        catch (_) { return false; }
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
        return json(res, { sucursal: sucursalDefault(), metodos, facturacion, credito: creditoActivo(), inventario: inventarioActivo() });
    }

    // ── GET /api/pos/productos?q= — búsqueda ligera para el mostrador ──────
    if (p === '/api/pos/productos' && req.method === 'GET') {
        {
            const q0 = ((new URL(req.url, 'http://x')).searchParams.get('q') || '').trim();
            const vv = q0 && require('../../services/variantesService').porCodigo(q0);
            if (vv) {
                return json(res, { items: [{ id: vv.id_producto, name: vv.name + ' (' + [vv.talla, vv.color].filter(Boolean).join(' / ') + ')', price: vv.price, tipo: vv.tipo, upc: q0, sku: q0, id_variante: vv.id_variante }] });
            }
        }
        if (!posActivo()) return json(res, { ok: false, error: 'El módulo de punto de venta está desactivado' }, 403);
        const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim();
        const suc = sucursalDefault();
        const rows = db.prepare(`
            SELECT p.id, p.name, p.price, p.sku, p.upc, p.tipo,
                   COALESCE((SELECT stock FROM inventarios WHERE id_producto=p.id AND sucursal=?), 0) AS stock
            FROM productos p
            WHERE p.activo=1 AND (? = '' OR p.name LIKE ? OR p.sku LIKE ? OR p.upc = ?)
            ORDER BY p.name LIMIT 25
        `).all(suc || '', q, '%' + q + '%', '%' + q + '%', q);
        return json(res, { items: rows, sucursal: suc });
    }

    // ── GET /api/pos/sugeridos?id= — complemento para subir el ticket ─────
    // (Ventas + CRO): reutiliza sustitutos/relacionados del catálogo.
    if (p === '/api/pos/sugeridos' && req.method === 'GET') {
        if (!posActivo()) return json(res, { items: [] });
        const idP = parseInt(new URL(req.url, 'http://x').searchParams.get('id'), 10);
        if (!idP) return json(res, { items: [] });
        try {
            const items = require('../../services/stockService').buscarSustitutosAuto(idP, 0.6, 3)
                .filter(x => x.id !== idP)
                .map(x => ({ id: x.id, name: x.name, price: x.price }))
                .slice(0, 3);
            return json(res, { items });
        } catch (_) { return json(res, { items: [] }); }
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
                const esCredito = !!d.a_credito && creditoActivo();
                const sucursal = String(d.sucursal || '').trim() || sucursalDefault();
                if (!sucursal) return json(res, { ok: false, error: 'No hay sucursal de facturación configurada (Prime > General)' }, 400);
                // Fiado: sin cliente no sabemos a quién cobrarle después.
                if (esCredito && !(d.cliente && (d.cliente.telefono || d.cliente.nombre))) {
                    return json(res, { ok: false, error: 'Una venta a crédito (fiado) requiere identificar al cliente' }, 400);
                }

                // Armar carrito desde los productos reales (precio del producto,
                // salvo override explícito desde el mostrador).
                const carrito = [];
                for (const it of items) {
                    const prod = db.prepare('SELECT id, name, price, tipo FROM productos WHERE id=?').get(Number(it.id_producto));
                    if (!prod) return json(res, { ok: false, error: 'Producto no encontrado: ' + it.id_producto }, 400);
                    // granel/volumen (abarrotes, construcción): cantidad decimal permitida
                    const cantidad = Math.max(0.001, Math.round((parseFloat(it.cantidad) || 1) * 1000) / 1000);
                    let price = prod.price;
                    if (it.precio !== undefined && it.precio !== null && it.precio !== '' && Number(it.precio) !== prod.price) {
                        // Antifraude: cambiar el precio de lista requiere PIN
                        const errP = autorizacion.exigirAutorizacion(db, req._ses, d.pin, rangoDe);
                        if (errP) return json(res, { ok: false, error: 'Cambiar el precio requiere PIN de autorización', pin_requerido: true }, 403);
                        price = Number(it.precio);
                        // Antifraude de caja: el override solo puede descontar
                        // hasta 50% del precio de lista, nunca $0 ni sobreprecio
                        if (!Number.isFinite(price) || price < prod.price * 0.5 || price > prod.price) {
                            return json(res, { ok: false, error: `Precio fuera de rango para ${prod.name} (permitido: $${(prod.price * 0.5).toFixed(2)} a $${Number(prod.price).toFixed(2)})` }, 400);
                        }
                    }
                    carrito.push({ id: prod.id, name: prod.name, price, cantidad, tipo: prod.tipo || 'fisico', id_variante: it.id_variante || null, variante: it.variante || null });
                }

                // Antisobreventa (hallazgo del cajero): NO cobrar más de lo que
                // hay. Físico/consumible se valida contra inventarios; servicios
                // no llevan stock. Vender en negativo (sobre pedido) exige PIN —
                // admin pasa, cajero lo teclea.
                const _faltantes = [];
                if (inventarioActivo()) for (const it of carrito) {
                    if (it.tipo === 'servicio') continue;
                    const stk = db.prepare('SELECT COALESCE(stock,0) s FROM inventarios WHERE id_producto=? AND sucursal=?').get(it.id, sucursal)?.s ?? 0;
                    if (stk < it.cantidad) _faltantes.push(it.name + ' (hay ' + stk + ', pides ' + it.cantidad + ')');
                }
                if (_faltantes.length) {
                    const errStk = autorizacion.exigirAutorizacion(db, req._ses, d.pin, rangoDe);
                    if (errStk) return json(res, { ok: false, error: 'Stock insuficiente: ' + _faltantes.join(', ') + '. Requiere PIN para vender sobre pedido.', pin_requerido: true }, 409);
                }

                // Cliente opcional (para acumular puntos). Walk-in = sin cliente.
                let idCliente = null, nombreCliente = 'Mostrador';
                if (d.cliente && (d.cliente.telefono || d.cliente.nombre)) {
                    if (d.cliente.telefono) {
                        const c = shared.upsertCliente(String(d.cliente.telefono).trim(), d.cliente.nombre || null);
                        idCliente = c.id; nombreCliente = c.nombre || d.cliente.nombre || 'Mostrador';
                    } else { nombreCliente = String(d.cliente.nombre).trim(); }
                }

                // Fiado: respetar el límite de crédito del cliente (0 = sin límite).
                if (esCredito && idCliente) {
                    const limite = Number(db.prepare('SELECT limite_credito FROM clientes WHERE id=?').get(idCliente)?.limite_credito) || 0;
                    if (limite > 0) {
                        const _totalVenta = carrito.reduce((s, i) => s + i.price * i.cantidad, 0);
                        const saldo = db.prepare("SELECT COALESCE(SUM(lp.monto),0) s FROM pedidos p JOIN links_pago lp ON lp.id_pedido=p.id_pedido WHERE p.id_cliente=? AND p.a_credito=1 AND lp.estatus='generado'").get(idCliente).s;
                        if (saldo + _totalVenta > limite + 0.005) {
                            return json(res, { ok: false, error: `El cliente supera su límite de crédito ($${limite.toFixed(2)}). Ya debe $${saldo.toFixed(2)} y esta venta suma $${_totalVenta.toFixed(2)}. Regístrale un abono, o pide a un Administrador que suba el límite en Fiados.`, limite_credito: limite, saldo_fiado: saldo }, 409);
                        }
                    }
                }
                // Cupón/descuento en mostrador (mismo catálogo `promociones` y
                // misma validación de alcance que el bot). Se valida ANTES de
                // cobrar para fallar claro; se redime (usos++) recién al cerrar
                // la venta. total = subtotal neto; el bruto queda en subtotal.
                let _cupon = null;
                if (d.cupon && String(d.cupon).trim()) {
                    _cupon = shared.aplicarCupon(String(d.cupon).trim(), carrito);
                    if (!_cupon.ok) return json(res, { ok: false, error: 'Cupón: ' + _cupon.error }, 409);
                }
                const _plazoFiado = parseInt(db.prepare("SELECT valor FROM configuracion WHERE clave='fiado_dias_plazo'").get()?.valor, 10) || 30;
                const folio = shared.generarFolio('pedido');
                const resultado = db.transaction(() => {
                    const { pedidoRowid, subtotal } = shared.insertarPedidoConCarrito(
                        nombreCliente, carrito, '', 'entregado', sucursal, folio, idCliente, 'mostrador'
                    );
                    const descuento = _cupon ? _cupon.descuento : 0;
                    const totalNeto = Math.round((subtotal - descuento) * 100) / 100;
                    db.prepare("UPDATE pedidos SET subtotal=?, total=?, metodo_pago=?, metodo_entrega='pickup', actualizado_en=datetime('now','localtime') WHERE id_pedido=?")
                      .run(subtotal, totalNeto, metodoPago, pedidoRowid);
                    // Datos fiscales opcionales (comprobante de facturación).
                    const rs = String(d.razon_social || '').trim();
                    const rfc = String(d.rfc || '').trim();
                    if (rs || rfc) db.prepare('UPDATE pedidos SET razon_social=?, rfc=? WHERE id_pedido=?').run(rs || null, rfc || null, pedidoRowid);
                    // Contado → links_pago pagado. Fiado (crédito) → 'generado'
                    // (queda como CxC; se salda luego con marcar-pagado).
                    const met = db.prepare('SELECT id FROM metodos_pago WHERE nombre=?').get(metodoPago);
                    if (esCredito) {
                        db.prepare("UPDATE pedidos SET a_credito=1, fiado_vence_en=date('now','localtime','+'||?||' days') WHERE id_pedido=?").run(_plazoFiado, pedidoRowid);
                        db.prepare("INSERT INTO links_pago (id_pedido, id_metodo, monto, moneda, estatus, fecha_expiracion, creado_en) VALUES (?,?,?,'MXN','generado',NULL,datetime('now','localtime'))")
                          .run(pedidoRowid, met ? met.id : null, totalNeto);
                    } else {
                        db.prepare("INSERT INTO links_pago (id_pedido, id_metodo, monto, moneda, estatus, pagado_en, creado_en) VALUES (?,?,?,'MXN','pagado',datetime('now','localtime'),datetime('now','localtime'))")
                          .run(pedidoRowid, met ? met.id : null, totalNeto);
                    }
                    // Descontar inventario con KARDEX; los servicios no llevan
                    // stock; y si el negocio no controla inventario, tampoco.
                    for (const it of carrito) {
                        if (it.tipo === 'servicio' || !inventarioActivo()) continue;
                        // Un tropiezo del kardex (producto sin fila de inventario, etc.)
                        // no debe tumbar un cobro físico que ya ocurrió. Igual que mesas.js.
                        try {
                            kardexService.movimiento({ id_producto: it.id, sucursal, tipo: 'venta', delta: -it.cantidad, motivo: 'Venta ' + folio, usuario: req._ses?.username });
                            if (it.id_variante) require('../../services/variantesService').descontarVariante(it.id_variante, sucursal, it.cantidad);
                        } catch (e) { log.warn('Kardex POS no aplicado para producto ' + it.id + ': ' + e.message); }
                    }
                    db.prepare('UPDATE pedidos SET cobrado_por=? WHERE id_pedido=?').run(req._ses?.username || null, pedidoRowid);
                    return { pedidoRowid, subtotal, total: totalNeto };
                })();
                // Cupón cobrado → redimir (usos++) recién ahora, atómico igual
                // que /api/cupon/redimir (no acumulable si es de un solo uso).
                if (_cupon && _cupon.promo) {
                    try { db.prepare('UPDATE promociones SET usos_actual=usos_actual+1 WHERE id=? AND (usos_max=0 OR usos_actual<usos_max)').run(_cupon.promo.id); } catch (_) {}
                }
                try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES (?,'mostrador',?,?)").run(esCredito ? 'venta_credito' : 'pago_confirmado', String(resultado.total), (d.cliente && d.cliente.telefono) || null); } catch (_) {}
                try {
                    const _conta = require('../../services/contabilidadService');
                    // Fiado: devengado (105/401/208) + costo al entregar. Contado:
                    // asiento de venta normal (caja/401/209) + costo.
                    if (esCredito) _conta.asientoVentaCredito(resultado.pedidoRowid, resultado.total);
                    else _conta.asientoVenta(resultado.pedidoRowid, resultado.total, metodoPago);
                    _conta.asientoCostoVenta(resultado.pedidoRowid);
                } catch (e) { log.debug('Asientos de venta POS no registrados: ' + e.message); }

                // Puntos: contado ahora; fiado hasta que se cobre (marcar-pagado).
                if (!esCredito) { try { puntosService.otorgarPuntosPorCompra(resultado.pedidoRowid); } catch (_) {} }

                const total = resultado.total;
                const efectivo = (d.efectivo_recibido !== undefined && d.efectivo_recibido !== null && d.efectivo_recibido !== '') ? Number(d.efectivo_recibido) : null;
                const cambio = (efectivo !== null && metodoPago === 'efectivo') ? Math.max(0, efectivo - total) : null;
                return json(res, {
                    ok: true, folio, id_pedido: resultado.pedidoRowid, total, metodo_pago: metodoPago,
                    sucursal, efectivo_recibido: efectivo, cambio,
                    subtotal: resultado.subtotal,
                    descuento: _cupon ? _cupon.descuento : 0,
                    cupon: _cupon ? { codigo: _cupon.promo.codigo, descripcion: _cupon.descripcion } : null,
                    razon_social: String(d.razon_social || '').trim() || null,
                    rfc: String(d.rfc || '').trim() || null,
                    items: carrito.map(i => ({ name: i.name, cantidad: i.cantidad, price: i.price, subtotal: i.price * i.cantidad })),
                    a_credito: esCredito,
                });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── POST /api/pos/venta/:id/cancelar — anular venta de mostrador ──────
    // (gerente+: la anulación es supervisión, no operación de cajero).
    // Repone inventario, cancela el pago y marca el pedido — el corte de
    // caja del día deja de contarla automáticamente (suma solo 'pagado').
    // Cancelar venta: administrador+ directo; cajero/operador con PIN de
    // autorización (punto único — futuro: autorización remota del admin)
    if (req.method === 'POST' && p.match(/^\/api\/pos\/venta\/\d+\/cancelar$/)) {
        const idPedido = parseInt(p.split('/')[4]);
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const err = autorizacion.exigirAutorizacion(db, req._ses, d.pin, rangoDe);
                if (err) return json(res, { ok: false, error: err, pin_requerido: true }, 403);
                const ped = db.prepare("SELECT * FROM pedidos WHERE id_pedido=? AND canal_creacion='mostrador'").get(idPedido);
                if (!ped) return json(res, { ok: false, error: 'Venta de mostrador no encontrada' }, 404);
                if (/cancelado/i.test(ped.estatus || '')) return json(res, { ok: false, error: 'Esa venta ya está cancelada' }, 400);
                const r = require('../../services/reversionService').revertirCobro(idPedido, { sucursalDefault: sucursalDefault() });
                if (!r.ok) return json(res, r, 400);
                // rastro antifraude: quién canceló y cuándo (migración 0028)
                try { db.prepare("UPDATE pedidos SET cancelado_por=?, cancelado_en=datetime('now','localtime') WHERE id_pedido=?").run(req._ses?.username || null, idPedido); } catch (_) {}
                return json(res, { ok: true, id_pedido: idPedido, estatus: 'cancelado', puntos_revertidos: r.puntos_revertidos });
            } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
        });
    }

    // Corte de caja: quien cobra, corta — pero SOLO su caja (sus ventas del
    // día) y UNA sola vez al día. Administrador/Contabilidad ven y cierran
    // el corte GLOBAL (todas las cajas + WhatsApp).
    const _ventasDelDia = (fecha, soloDe) => {
        const filtro = soloDe ? ' AND p.cobrado_por = ?' : '';
        const args = soloDe ? [fecha, soloDe] : [fecha];
        return db.prepare(`
            SELECT COALESCE(p.metodo_pago,'(sin método)') AS metodo, COUNT(*) AS n, COALESCE(SUM(lp.monto),0) AS total
            FROM links_pago lp JOIN pedidos p ON p.id_pedido = lp.id_pedido
            WHERE lp.estatus='pagado' AND DATE(lp.pagado_en) = ?${filtro}
            GROUP BY p.metodo_pago ORDER BY total DESC`).all(...args);
    };

    if (p === '/api/pos/corte' && req.method === 'GET') {
        const ses = req._ses;
        const esGlobal = rangoDe(ses.rol) >= 2 || permite(ses.rol, 'cortes');
        const fecha = (new URL(req.url, 'http://x').searchParams.get('fecha') || new Date().toISOString().slice(0, 10)).trim();
        const porMetodo = _ventasDelDia(fecha, esGlobal ? null : ses.username);
        const total_sistema = porMetodo.reduce((s, r) => s + (r.total || 0), 0);
        const efectivo_sistema = porMetodo.filter(r => r.metodo === 'efectivo').reduce((s, r) => s + (r.total || 0), 0);
        const cortes = esGlobal
            ? db.prepare('SELECT * FROM cortes_caja WHERE fecha=? ORDER BY id DESC').all(fecha)
            : db.prepare('SELECT * FROM cortes_caja WHERE fecha=? AND usuario=? ORDER BY id DESC').all(fecha, ses.username);
        return json(res, { fecha, alcance: esGlobal ? 'global' : 'propio', por_metodo: porMetodo, total_sistema, efectivo_sistema, cortes });
    }

    if (p === '/api/pos/corte' && req.method === 'POST') {
        const ses = req._ses;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const fecha = String(d.fecha || new Date().toISOString().slice(0, 10)).trim();
                const esGlobal = rangoDe(ses.rol) >= 2 || permite(ses.rol, 'cortes');
                if (db.prepare('SELECT id FROM cortes_caja WHERE fecha=? AND usuario=?').get(fecha, ses.username)) {
                    return json(res, { ok: false, error: 'Ya cerraste tu corte de hoy — un corte por usuario por día' }, 400);
                }
                const porMetodo = _ventasDelDia(fecha, esGlobal ? null : ses.username);
                const total_sistema = porMetodo.reduce((s, r) => s + (r.total || 0), 0);
                const efectivo_sistema = porMetodo.filter(r => r.metodo === 'efectivo').reduce((s, r) => s + (r.total || 0), 0);
                const efectivo_contado = (d.efectivo_contado !== undefined && d.efectivo_contado !== null && d.efectivo_contado !== '') ? Number(d.efectivo_contado) : null;
                const diferencia = efectivo_contado !== null ? parseFloat((efectivo_contado - efectivo_sistema).toFixed(2)) : null;
                const r = db.prepare(`
                    INSERT INTO cortes_caja (fecha, usuario, total_sistema, efectivo_sistema, efectivo_contado, diferencia, detalle_json)
                    VALUES (?,?,?,?,?,?,?)
                `).run(fecha, ses.username, total_sistema, efectivo_sistema, efectivo_contado, diferencia, JSON.stringify(porMetodo));
                return json(res, { ok: true, id: r.lastInsertRowid, alcance: esGlobal ? 'global' : 'propio', total_sistema, efectivo_sistema, efectivo_contado, diferencia });
            } catch (e) {
                if (/UNIQUE/.test(e.message)) return json(res, { ok: false, error: 'Ya cerraste tu corte de hoy — un corte por usuario por día' }, 400);
                return json(res, { ok: false, error: e.message }, 500);
            }
        });
    }

    // ── GET /api/pos/fiados — cartera de crédito (cuentas por cobrar del
    // mostrador) por cliente, con adeudo, próximo vencimiento y morosidad ──
    if (p === '/api/pos/fiados' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT c.id AS id_cliente, COALESCE(c.nombre, p.cliente) AS nombre, c.telefono,
                   COALESCE(c.limite_credito, 0) AS limite_credito,
                   COUNT(p.id_pedido) AS pedidos,
                   ROUND(COALESCE(SUM(lp.monto), 0), 2) AS adeudo,
                   MIN(p.fiado_vence_en) AS proximo_vence,
                   CAST(MAX(julianday('now','localtime') - julianday(p.fiado_vence_en)) AS INT) AS dias_vencido_max
            FROM pedidos p
            JOIN links_pago lp ON lp.id_pedido = p.id_pedido AND lp.estatus='generado'
            LEFT JOIN clientes c ON c.id = p.id_cliente
            WHERE p.a_credito = 1
            GROUP BY COALESCE(c.id, p.cliente)
            ORDER BY dias_vencido_max DESC, adeudo DESC
        `).all();
        const total = rows.reduce((s, r) => s + r.adeudo, 0);
        return json(res, { fiados: rows, total_por_cobrar: Math.round(total * 100) / 100 });
    }

    // ── PUT /api/pos/cliente/:id/limite — fijar límite de crédito (gerente+) ──
    if (req.method === 'PUT' && p.match(/^\/api\/pos\/cliente\/\d+\/limite$/)) {
        if (rangoDe(req._ses.rol) < 2) return json(res, { ok: false, error: 'Solo un Administrador o Prime puede fijar límites de crédito' }, 403);
        const idc = parseInt(p.split('/')[4]);
        return readBody(req, body => {
            try {
                const limite = Math.max(0, Number(JSON.parse(body || '{}').limite_credito) || 0);
                db.prepare('UPDATE clientes SET limite_credito=? WHERE id=?').run(limite, idc);
                return json(res, { ok: true, id_cliente: idc, limite_credito: limite });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    return next();
};
