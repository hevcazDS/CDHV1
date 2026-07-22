'use strict';
// Mesas de restaurante (módulo mesas_activo, giro restaurante). Abrir mesa,
// agregar platillos con comentario libre, preticket a cocina, y cerrar →
// cobro reusando la maquinaria del POS (_shared.insertarPedidoConCarrito).
// Migrado al patrón declarativo del tronco (paso 3): rutas como datos con gate
// explícito (áreas pos||operacion) y precondición de módulo (mesas_activo).
const shared = require('../../bot/flows/_shared');
const kardexService = require('../../services/kardexService');
const { flagActivo } = require('../../services/configFlags');
const { sucursalFacturacionDefault, sucursalDeSesion } = require('../../services/sucursalService');
const { rangoDe } = require('../permisos');
const construirModulo = require('./_construirModulo');

// Precondición: el módulo Mesas debe estar activo (corre tras el gate de auth).
const mesasActivo = construirModulo.precondModulo('mesas_activo', 'Activa el módulo Mesas en Módulos', 400);

// GET /api/mesas — mesas abiertas con sus items y total
function listarMesas(req, res, ctx, { ses }) {
    const { db, json } = ctx;
    // Un solo SELECT de items de TODAS las mesas abiertas (no N+1).
    // multitienda 0050: el mesero ve las mesas de SU local (+ las sin local,
    // que son todas las previas a la migración → local único idéntico);
    // gerente+ ve todos los locales.
    const mesas = rangoDe(ses?.rol) >= 2
        ? db.prepare("SELECT * FROM mesas WHERE estatus='abierta' ORDER BY numero").all()
        : db.prepare("SELECT * FROM mesas WHERE estatus='abierta' AND (sucursal IS NULL OR sucursal=?) ORDER BY numero").all(sucursalDeSesion(db, ses) || '');
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
function abrirMesa(req, res, ctx, { ses }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const numero = String(JSON.parse(body || '{}').numero || '').trim();
            if (!numero) return json(res, { ok: false, error: 'Falta el número/nombre de la mesa' }, 400);
            if (db.prepare("SELECT 1 FROM mesas WHERE numero=? AND estatus='abierta'").get(numero)) {
                return json(res, { ok: false, error: 'Esa mesa ya está abierta' }, 400);
            }
            // multitienda 0050: la mesa nace en el local de quien la abre
            const r = db.prepare('INSERT INTO mesas (numero, sucursal) VALUES (?,?)').run(numero, sucursalDeSesion(db, ses));
            try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor) VALUES ('mesa_abierta','mostrador',?)").run(String(numero)); } catch (_) {}
            return json(res, { ok: true, id: r.lastInsertRowid, numero });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// POST /api/mesas/:id/item — agregar platillo con comentario libre
function agregarItem(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    const idMesa = parseInt(params[0]);
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
function quitarItem(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const idMesa = parseInt(params[0]);
    const itemId = parseInt(params[1]);
    db.prepare('DELETE FROM mesa_items WHERE id=? AND id_mesa=? AND enviado_cocina=0').run(itemId, idMesa);
    return json(res, { ok: true });
}

// POST /api/mesas/:id/cocina — preticket: marca items como enviados y los
// devuelve para imprimir la comanda de cocina.
function enviarCocina(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const idMesa = parseInt(params[0]);
    const pend = db.prepare('SELECT * FROM mesa_items WHERE id_mesa=? AND enviado_cocina=0 ORDER BY id').all(idMesa);
    if (!pend.length) return json(res, { ok: false, error: 'No hay platillos nuevos que enviar' }, 400);
    db.prepare('UPDATE mesa_items SET enviado_cocina=1 WHERE id_mesa=? AND enviado_cocina=0').run(idMesa);
    const mesa = db.prepare('SELECT numero FROM mesas WHERE id=?').get(idMesa);
    return json(res, { ok: true, mesa: mesa?.numero, comanda: pend.map(i => ({ cantidad: i.cantidad, nombre: i.nombre, comentario: i.comentario })) });
}

// GET /api/mesas/:id/sugeridos — complementos (upsell por categoría, no similitud).
function sugeridos(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const idMesa = parseInt(params[0]);
    const raw = db.prepare("SELECT valor FROM configuracion WHERE clave='mesas_complemento_cats'").get()?.valor
        || 'bebida,refresco,agua,cerveza,vino,cafe,café,jugo,postre,entrada,guarnici,botana,snack';
    const kw = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!kw.length) return json(res, { items: [] });
    const enMesa = new Set(db.prepare('SELECT id_producto FROM mesa_items WHERE id_mesa=?').all(idMesa).map(r => r.id_producto).filter(Boolean));
    const like = kw.map(() => "LOWER(COALESCE(cat,'')) LIKE ?").join(' OR ');
    const rows = db.prepare(`SELECT id, name, price FROM productos WHERE tipo!='servicio' AND (${like}) ORDER BY price ASC LIMIT 12`).all(...kw.map(k => '%' + k + '%'));
    return json(res, { items: rows.filter(r => !enMesa.has(r.id)).slice(0, 4) });
}

// POST /api/mesas/:id/cerrar — cobrar la mesa (crea el pedido + pago) y libera
// la mesa. Reusa la misma maquinaria que el POS de mostrador.
function cerrarMesa(req, res, ctx, { params, ses }) {
    const { db, json, readBody } = ctx;
    const idMesa = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const mesa = db.prepare("SELECT * FROM mesas WHERE id=? AND estatus='abierta'").get(idMesa);
            if (!mesa) return json(res, { ok: false, error: 'Mesa no abierta' }, 404);
            const items = db.prepare('SELECT * FROM mesa_items WHERE id_mesa=?').all(idMesa);
            if (!items.length) return json(res, { ok: false, error: 'La mesa no tiene consumo' }, 400);
            const carrito = items.map(i => ({ id: i.id_producto, name: i.nombre, price: i.precio, cantidad: i.cantidad, tipo: 'consumible' }));
            const metodoPago = d.metodo_pago || 'efectivo';
            // Propina: se cobra APARTE del subtotal (no es venta gravada), se suma
            // al total del pago y se guarda en la mesa para el reparto a meseros.
            const propina = Math.max(0, Math.round((Number(d.propina) || 0) * 100) / 100);
            // multitienda 0050: cobra e inventaría en el local de la MESA (las
            // viejas sin local caen a la tienda de la sesión = default)
            const sucursal = mesa.sucursal || sucursalDeSesion(db, ses) || '';
            const folio = shared.generarFolio('pedido');
            const r = db.transaction(() => {
                const { pedidoRowid, subtotal } = shared.insertarPedidoConCarrito(
                    'Mesa ' + mesa.numero, carrito, '', 'entregado', sucursal, folio, null, 'mostrador');
                const totalConPropina = Math.round((subtotal + propina) * 100) / 100;
                db.prepare("UPDATE pedidos SET subtotal=?, total=?, metodo_pago=?, metodo_entrega='pickup', cobrado_por=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?")
                  .run(subtotal, totalConPropina, metodoPago, ses.username || null, pedidoRowid);
                const met = db.prepare('SELECT id FROM metodos_pago WHERE nombre=?').get(metodoPago);
                db.prepare("INSERT INTO links_pago (id_pedido, id_metodo, url_link, monto, moneda, estatus, pagado_en, creado_en) VALUES (?,?,'',?,'MXN','pagado',datetime('now','localtime'),datetime('now','localtime'))")
                  .run(pedidoRowid, met ? met.id : null, totalConPropina);
                db.prepare("UPDATE mesas SET estatus='cobrada', id_pedido=?, propina=?, cerrada_en=datetime('now','localtime') WHERE id=?").run(pedidoRowid, propina, idMesa);
                // Descontar inventario (igual que el POS): platillos del catálogo
                // con id_producto y sucursal; texto libre (sin id) y servicios no.
                const invActivo = flagActivo(db, 'inventario_activo', true);
                if (invActivo && sucursal) for (const it of items) {
                    if (!it.id_producto) continue;
                    if (db.prepare('SELECT tipo FROM productos WHERE id=?').get(it.id_producto)?.tipo === 'servicio') continue;
                    try { if (!require('../../services/recetasService').descontarVenta(db, { id_producto: it.id_producto, cantidad: it.cantidad, sucursal, motivo: 'Mesa ' + mesa.numero, usuario: ses.username })) kardexService.movimiento({ id_producto: it.id_producto, sucursal, tipo: 'venta', delta: -it.cantidad, motivo: 'Mesa ' + mesa.numero, usuario: ses.username }); } catch (_) {}
                }
                try { db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor) VALUES ('mesa_cobrada','mostrador',?)").run(String(subtotal)); } catch (_) {}
                return { pedidoRowid, subtotal, folio };
            })();
            // Asientos FUERA de la transacción (registrarAsiento abre la suya y
            // better-sqlite3 no anida). Igual que el POS — sin esto no entran al mayor.
            try {
                const _conta = require('../../services/contabilidadService');
                _conta.asientoVenta(r.pedidoRowid, r.subtotal, metodoPago);
                _conta.asientoCostoVenta(r.pedidoRowid);
            } catch (e) { /* el asiento no bloquea el cobro de la mesa */ }
            return json(res, { ok: true, folio: r.folio, total: r.subtotal });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Vista cocina / KDS (P3): comandas enviadas y no listas ─────────────────
function cocina(req, res, ctx) {
    const { db, json } = ctx;
    const items = db.prepare(`
        SELECT mi.id, mi.nombre, mi.cantidad, mi.comentario, mi.creado_en, m.numero AS mesa
        FROM mesa_items mi JOIN mesas m ON m.id = mi.id_mesa
        WHERE mi.enviado_cocina = 1 AND mi.listo = 0 AND m.estatus = 'abierta'
        ORDER BY mi.creado_en`).all();
    return json(res, { items });
}
function itemListo(req, res, ctx, { params }) {
    const { db, json } = ctx;
    db.prepare('UPDATE mesa_items SET listo=1 WHERE id=?').run(parseInt(params[0]));
    return json(res, { ok: true });
}

const RUTAS = [
    { metodo: 'GET',    path: '/api/mesas',                         areas: ['pos', 'operacion'], handler: listarMesas },
    { metodo: 'GET',    path: '/api/mesas/cocina',                  areas: ['pos', 'operacion'], handler: cocina },
    { metodo: 'POST',   path: /^\/api\/mesas\/item\/(\d+)\/listo$/, areas: ['pos', 'operacion'], handler: itemListo },
    { metodo: 'POST',   path: '/api/mesas',                         areas: ['pos', 'operacion'], handler: abrirMesa },
    { metodo: 'POST',   path: /^\/api\/mesas\/(\d+)\/item$/,        areas: ['pos', 'operacion'], handler: agregarItem },
    { metodo: 'DELETE', path: /^\/api\/mesas\/(\d+)\/item\/(\d+)$/, areas: ['pos', 'operacion'], handler: quitarItem },
    { metodo: 'POST',   path: /^\/api\/mesas\/(\d+)\/cocina$/,      areas: ['pos', 'operacion'], handler: enviarCocina },
    { metodo: 'GET',    path: /^\/api\/mesas\/(\d+)\/sugeridos$/,   areas: ['pos', 'operacion'], handler: sugeridos },
    { metodo: 'POST',   path: /^\/api\/mesas\/(\d+)\/cerrar$/,      areas: ['pos', 'operacion'], handler: cerrarMesa },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/mesas', precondicion: mesasActivo });
