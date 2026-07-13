'use strict';
// services/suscripcionCobro.js — lógica de cobro de suscripciones, compartida por
// la ruta (POST manual) y el tick automático de stockWatcher (F6). Genera el cargo
// de un período REUSANDO la ruta de dinero sellada (pedido canal 'suscripcion' +
// links_pago 'generado'); el cobro real se confirma en marcar-pagado, igual que todo.

function _sumarMes(fechaISO) {
    const [y, m, d] = fechaISO.split('-').map(Number);
    const f = new Date(y, (m - 1) + 1, Math.min(d, 28));
    return f.toISOString().slice(0, 10);
}

// Producto-servicio genérico "Suscripción" (find-or-create). pedido_detalle.id_producto
// es NOT NULL, así que la línea de la suscripción debe referenciar un producto real;
// un servicio oculto del catálogo (activo=0) cumple el FK sin ensuciar búsqueda/inventario.
function _productoSuscripcion(db) {
    const existe = db.prepare("SELECT id FROM productos WHERE tipo='servicio' AND cat='suscripcion' LIMIT 1").get();
    if (existe) return existe.id;
    return db.prepare("INSERT INTO productos (tipo, name, cat, price, activo) VALUES ('servicio','Suscripción','suscripcion',0,0)").run().lastInsertRowid;
}

// Genera el cargo de UN período y avanza proximo_cobro un mes. Devuelve
// { pedidoRowid, subtotal, folio, proximo }.
function generarCargo(db, s, ses) {
    const shared = require('../bot/flows/_shared');
    const { sucursalDeSesion } = require('./sucursalService');
    const sucursal = s.sucursal || sucursalDeSesion(db, ses) || '';
    const folio = shared.generarFolio('pedido');
    const carrito = [{ id: _productoSuscripcion(db), name: s.concepto || 'Suscripción', price: s.monto, cantidad: 1, tipo: 'servicio' }];
    let idCliente = s.id_cliente || null;
    if (!idCliente && s.telefono) { try { idCliente = shared.upsertCliente(s.telefono, s.nombre)?.id || null; } catch (_) {} }
    return db.transaction(() => {
        const { pedidoRowid, subtotal } = shared.insertarPedidoConCarrito(s.nombre, carrito, '', 'pendiente', sucursal, folio, idCliente, 'suscripcion');
        db.prepare("UPDATE pedidos SET subtotal=?, total=?, metodo_entrega='pickup' WHERE id_pedido=?").run(subtotal, subtotal, pedidoRowid);
        db.prepare("INSERT INTO links_pago (id_pedido, monto, moneda, estatus, creado_en) VALUES (?,?,'MXN','generado',datetime('now','localtime'))").run(pedidoRowid, subtotal);
        const nuevo = _sumarMes(s.proximo_cobro || new Date().toISOString().slice(0, 10));
        db.prepare('UPDATE suscripciones SET proximo_cobro=? WHERE id=?').run(nuevo, s.id);
        return { pedidoRowid, subtotal, folio, proximo: nuevo };
    })();
}

// Cobra TODAS las activas vencidas (hoy o antes). Devuelve { generados, total,
// cargos } donde cargos = [{ telefono, nombre, folio, subtotal }] (para notificar).
function generarCobrosVencidos(db, ses) {
    const hoy = new Date().toISOString().slice(0, 10);
    const pend = db.prepare("SELECT * FROM suscripciones WHERE estatus='activa' AND proximo_cobro IS NOT NULL AND proximo_cobro<=?").all(hoy);
    let generados = 0, total = 0; const cargos = [];
    for (const s of pend) {
        try {
            const r = generarCargo(db, s, ses);
            generados++; total += r.subtotal;
            cargos.push({ telefono: s.telefono, nombre: s.nombre, folio: r.folio, subtotal: r.subtotal });
        } catch (_) { /* una suscripción mala no frena las demás */ }
    }
    return { generados, total: Math.round(total * 100) / 100, cargos };
}

module.exports = { generarCargo, generarCobrosVencidos };
