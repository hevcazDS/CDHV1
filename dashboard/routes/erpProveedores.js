'use strict';
// ERP Fase 6: proveedores, órdenes de compra (recepción aumenta inventario
// con costeo promedio) y cuentas por pagar. Migrado al patrón declarativo:
// gate por área explícito por ruta (compras crea, almacén recibe, finanzas
// paga; administrador+ pasa vía permite()). Nota: 'cancelar OC' antes solo
// exigía sesión (hueco latente); ahora exige area:'compras' — la intención
// que el propio comentario documentaba ("compras o administrador+").
const costeo = require('../../services/costeoService');
const { permite, rangoDe } = require('../permisos');
const conta = require('../../services/contabilidadService');
const { sucursalFacturacionDefault: _sucursalDefault, sucursalDeSesion } = require('../../services/sucursalService');
const construirModulo = require('./_construirModulo');

// ── Proveedores ──────────────────────────────────────────────────────────
function proveedoresGet(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, db.prepare('SELECT * FROM proveedores WHERE activo=1 ORDER BY nombre').all());
}
function proveedoresPost(req, res, ctx) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const nombre = String(d.nombre || '').trim();
            if (!nombre) return json(res, { ok: false, error: 'Falta el nombre' }, 400);
            const r = db.prepare('INSERT INTO proveedores (nombre, rfc, telefono, email, dias_credito) VALUES (?,?,?,?,?)')
                .run(nombre, String(d.rfc || '').trim() || null, String(d.telefono || '').trim() || null,
                     String(d.email || '').trim() || null, Math.max(0, parseInt(d.dias_credito, 10) || 0));
            return json(res, { ok: true, id: r.lastInsertRowid });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Órdenes de compra ──────────────────────────────────────────────────────
function ocGet(req, res, ctx) {
    const { db, json } = ctx;
    const ocs = db.prepare(`
        SELECT oc.*, pr.nombre AS proveedor FROM ordenes_compra oc
        JOIN proveedores pr ON pr.id = oc.id_proveedor
        ORDER BY oc.id DESC LIMIT 100`).all();
    const det = db.prepare('SELECT d.*, p2.name FROM ordenes_compra_detalle d JOIN productos p2 ON p2.id=d.id_producto WHERE d.id_oc=?');
    return json(res, ocs.map(oc => ({ ...oc, items: det.all(oc.id) })));
}
function ocPost(req, res, ctx, { ses }) {
    const { db, json, readBody, generarFolio } = ctx;
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const items = Array.isArray(d.items) ? d.items : [];
            if (!Number.isInteger(d.id_proveedor)) return json(res, { ok: false, error: 'Falta proveedor' }, 400);
            if (!items.length) return json(res, { ok: false, error: 'Agrega al menos un producto' }, 400);
            for (const it of items) {
                if (!Number.isInteger(it.id_producto) || !(parseInt(it.cantidad, 10) > 0) || !(Number(it.costo_unitario) >= 0)) {
                    return json(res, { ok: false, error: 'Item inválido (producto/cantidad/costo)' }, 400);
                }
            }
            // multitienda 0050: destino explícito (validado) o la tienda de la sesión
            let sucDestino = String(d.sucursal_destino || '').trim() || null;
            if (sucDestino && !db.prepare('SELECT 1 FROM sucursales WHERE nombre=?').get(sucDestino)) {
                return json(res, { ok: false, error: 'Esa sucursal destino no existe en el catálogo' }, 400);
            }
            if (!sucDestino) sucDestino = sucursalDeSesion(db, ses);
            const total = items.reduce((s, it) => s + parseInt(it.cantidad, 10) * Number(it.costo_unitario), 0);
            const folio = generarFolio('oc');
            const r = db.transaction(() => {
                const _lleg = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha_llegada_est || '') ? d.fecha_llegada_est : null;
                const oc = db.prepare('INSERT INTO ordenes_compra (folio, id_proveedor, total, notas, fecha_llegada_est, sucursal_destino) VALUES (?,?,?,?,?,?)')
                    .run(folio, d.id_proveedor, Math.round(total * 100) / 100, String(d.notas || '').trim() || null, _lleg, sucDestino);
                const ins = db.prepare('INSERT INTO ordenes_compra_detalle (id_oc, id_producto, cantidad, costo_unitario) VALUES (?,?,?,?)');
                for (const it of items) ins.run(oc.lastInsertRowid, it.id_producto, parseInt(it.cantidad, 10), Number(it.costo_unitario));
                return oc.lastInsertRowid;
            })();
            return json(res, { ok: true, id: r, folio });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// Reordenar: OC NUEVA copiando items de una previa. Gate por recompra_activo.
function ocReordenar(req, res, ctx, { params }) {
    const { db, json, generarFolio } = ctx;
    if (db.prepare("SELECT valor FROM configuracion WHERE clave='recompra_activo'").get()?.valor !== '1') {
        return json(res, { ok: false, error: 'Activa el módulo Recompra en Módulos' }, 400);
    }
    const idOrig = parseInt(params[0]);
    const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(idOrig);
    if (!oc) return json(res, { ok: false, error: 'OC no encontrada' }, 404);
    const items = db.prepare('SELECT id_producto, cantidad, costo_unitario FROM ordenes_compra_detalle WHERE id_oc=?').all(idOrig);
    if (!items.length) return json(res, { ok: false, error: 'La OC no tiene items' }, 400);
    const total = items.reduce((s, it) => s + it.cantidad * it.costo_unitario, 0);
    const folio = generarFolio('oc');
    const nuevaId = db.transaction(() => {
        const r = db.prepare('INSERT INTO ordenes_compra (folio, id_proveedor, total, notas, sucursal_destino) VALUES (?,?,?,?,?)')
            .run(folio, oc.id_proveedor, Math.round(total * 100) / 100, 'Recompra de ' + (oc.folio || '#' + idOrig), oc.sucursal_destino || null);
        const ins = db.prepare('INSERT INTO ordenes_compra_detalle (id_oc, id_producto, cantidad, costo_unitario) VALUES (?,?,?,?)');
        for (const it of items) ins.run(r.lastInsertRowid, it.id_producto, it.cantidad, it.costo_unitario);
        return r.lastInsertRowid;
    })();
    return json(res, { ok: true, id: nuevaId, folio });
}

// Cancelar una OC ABIERTA creada por error. Recibidas no se cancelan.
function ocCancelar(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const idOC = parseInt(params[0]);
    const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(idOC);
    if (!oc) return json(res, { ok: false, error: 'OC no encontrada' }, 404);
    if (oc.estatus !== 'abierta') return json(res, { ok: false, error: 'Solo se cancelan OC abiertas (esta está ' + oc.estatus + ')' }, 400);
    db.prepare("UPDATE ordenes_compra SET estatus='cancelada' WHERE id=?").run(idOC);
    return json(res, { ok: true, id: idOC });
}

// Recepción (PARCIAL o total): aumenta inventario + costeo + CxP + asiento por
// LO RECIBIDO. Body opcional { items:[{id_detalle, cantidad}] }; sin body recibe
// todo el pendiente (compat). La OC queda 'parcial' hasta recibir todas las
// líneas completas; entonces pasa a 'recibida'. Recibe ALMACÉN (o admin+).
function ocRecibir(req, res, ctx, { params, ses }) {
    const { db, json, log, readBody } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            let recib = null; try { const b = JSON.parse(body || '{}'); if (Array.isArray(b.items)) recib = b.items; } catch (_) {}
            const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(id);
            if (!oc) return json(res, { ok: false, error: 'OC no encontrada' }, 404);
            if (!['abierta', 'parcial'].includes(oc.estatus)) return json(res, { ok: false, error: 'La OC no está abierta' }, 400);
            const sucursal = oc.sucursal_destino || sucursalDeSesion(db, ses);
            if (!sucursal) return json(res, { ok: false, error: 'Configura la sucursal de facturación antes de recibir' }, 400);
            const items = db.prepare('SELECT * FROM ordenes_compra_detalle WHERE id_oc=?').all(id);
            const prov = db.prepare('SELECT * FROM proveedores WHERE id=?').get(oc.id_proveedor);
            // cuánto se recibe de cada línea en ESTA recepción
            const _pedirDe = (it) => {
                const pend = (it.cantidad || 0) - (it.cantidad_recibida || 0);
                if (!recib) return pend; // sin body → todo el pendiente
                const m = recib.find(r => Number(r.id_detalle) === it.id);
                return m ? Math.max(0, Math.min(pend, Number(m.cantidad) || 0)) : 0;
            };
            let montoRecibido = 0, algoRecibido = false;
            db.transaction(() => {
                for (const it of items) {
                    const q = _pedirDe(it);
                    if (q <= 0) continue;
                    algoRecibido = true;
                    montoRecibido += q * it.costo_unitario;
                    costeo.registrarEntrada(it.id_producto, q, it.costo_unitario, 'oc:' + oc.folio);
                    const anterior = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(it.id_producto, sucursal)?.stock ?? null;
                    if (anterior !== null) db.prepare('UPDATE inventarios SET stock = stock + ? WHERE id_producto=? AND sucursal=?').run(q, it.id_producto, sucursal);
                    else db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock) VALUES (?,?,?)').run(it.id_producto, sucursal, q);
                    db.prepare('UPDATE ordenes_compra_detalle SET cantidad_recibida = cantidad_recibida + ? WHERE id=?').run(q, it.id);
                    try { db.prepare('INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo) VALUES (?,?,?,?,?,?)')
                        .run(it.id_producto, sucursal, 'entrada', anterior ?? 0, (anterior ?? 0) + q, 'OC ' + oc.folio); } catch (_) {}
                }
                if (!algoRecibido) throw new Error('No se recibió ninguna cantidad');
                const vence = prov?.dias_credito > 0
                    ? db.prepare("SELECT date('now', '+' || ? || ' days', 'localtime') v").get(prov.dias_credito).v
                    : db.prepare("SELECT date('now','localtime') v").get().v;
                db.prepare('INSERT INTO cuentas_pagar (id_proveedor, id_oc, monto, vence_en) VALUES (?,?,?,?)').run(oc.id_proveedor, id, Math.round(montoRecibido * 100) / 100, vence);
                // ¿todo recibido? (releer líneas ya actualizadas)
                const pendiente = db.prepare('SELECT COALESCE(SUM(cantidad - cantidad_recibida),0) p FROM ordenes_compra_detalle WHERE id_oc=?').get(id).p;
                const nuevoEstatus = pendiente <= 0.0001 ? 'recibida' : 'parcial';
                db.prepare("UPDATE ordenes_compra SET estatus=?, recibida_en=CASE WHEN ?='recibida' THEN datetime('now','localtime') ELSE recibida_en END WHERE id=?").run(nuevoEstatus, nuevoEstatus, id);
            })();
            try { conta.asientoCompra(oc.folio, Math.round(montoRecibido * 100) / 100, { sucursal }); } catch (e) { log.warn('Asiento de compra falló: ' + e.message); }
            const pendiente = db.prepare('SELECT COALESCE(SUM(cantidad - cantidad_recibida),0) p FROM ordenes_compra_detalle WHERE id_oc=?').get(id).p;
            return json(res, { ok: true, id, estatus: pendiente <= 0.0001 ? 'recibida' : 'parcial', recibido: Math.round(montoRecibido * 100) / 100 });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Cuentas por pagar ──────────────────────────────────────────────────────
function cxpGet(req, res, ctx) {
    const { db, json } = ctx;
    return json(res, db.prepare(`
        SELECT cp.*, pr.nombre AS proveedor, oc.folio AS folio_oc,
               CAST(julianday(cp.vence_en) - julianday(date('now','localtime')) AS INTEGER) AS dias_para_vencer
        FROM cuentas_pagar cp
        JOIN proveedores pr ON pr.id = cp.id_proveedor
        LEFT JOIN ordenes_compra oc ON oc.id = cp.id_oc
        ORDER BY cp.estatus = 'pagada', cp.vence_en LIMIT 200`).all());
}
// Paga CONTABILIDAD (o administrador+), no quien compró.
function cxpPagar(req, res, ctx, { params }) {
    const { db, json, readBody, log } = ctx;
    const id = parseInt(params[0]);
    return readBody(req, body => {
        try {
            const d = JSON.parse(body || '{}');
            const cxp = db.prepare('SELECT * FROM cuentas_pagar WHERE id=?').get(id);
            if (!cxp) return json(res, { ok: false, error: 'CxP no encontrada' }, 404);
            if (cxp.estatus === 'pagada') return json(res, { ok: false, error: 'Ya está pagada' }, 400);
            db.prepare("UPDATE cuentas_pagar SET estatus='pagada', pagada_en=datetime('now','localtime'), referencia=? WHERE id=?")
              .run(String(d.referencia || '').trim() || null, id);
            try { conta.asientoPagoCxP(id, cxp.monto); } catch (e) { log.warn('Asiento de pago CxP falló: ' + e.message); }
            return json(res, { ok: true, id, estatus: 'pagada' });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/erp/proveedores',                              areas: ['compras', 'finanzas'], handler: proveedoresGet },
    { metodo: 'POST', path: '/api/erp/proveedores',                              area: 'compras', handler: proveedoresPost },
    { metodo: 'GET',  path: '/api/erp/ordenes-compra',                           areas: ['compras', 'finanzas', 'almacen'], handler: ocGet },
    { metodo: 'POST', path: '/api/erp/ordenes-compra',                           area: 'compras', handler: ocPost },
    { metodo: 'POST', path: /^\/api\/erp\/ordenes-compra\/(\d+)\/reordenar$/,    area: 'compras', handler: ocReordenar },
    { metodo: 'POST', path: /^\/api\/erp\/ordenes-compra\/(\d+)\/cancelar$/,     area: 'compras', handler: ocCancelar },
    { metodo: 'POST', path: /^\/api\/erp\/ordenes-compra\/(\d+)\/recibir$/,      area: 'almacen', handler: ocRecibir },
    { metodo: 'GET',  path: '/api/erp/cxp',                                      areas: ['finanzas', 'compras'], handler: cxpGet },
    { metodo: 'POST', path: /^\/api\/erp\/cxp\/(\d+)\/pagar$/,                   area: 'finanzas', handler: cxpPagar },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/erp/' });
