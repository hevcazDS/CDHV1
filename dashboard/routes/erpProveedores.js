'use strict';
// ERP Fase 6: proveedores, órdenes de compra (recepción aumenta inventario
// con costeo promedio) y cuentas por pagar. Todo gerente+.
const costeo = require('../../services/costeoService');
const conta = require('../../services/contabilidadService');

module.exports = function erpProveedoresRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession, log, generarFolio } = ctx;
    if (!p.startsWith('/api/erp/')) return next();

    const _sucursalDefault = () => {
        try { return db.prepare("SELECT valor FROM configuracion WHERE clave='sucursal_facturacion_default'").get()?.valor || null; }
        catch (_) { return null; }
    };

    // ── Proveedores ────────────────────────────────────────────────────
    if (p === '/api/erp/proveedores' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        return json(res, db.prepare('SELECT * FROM proveedores WHERE activo=1 ORDER BY nombre').all());
    }
    if (p === '/api/erp/proveedores' && req.method === 'POST') {
        if (!requireSession(req, res, ['gerente'])) return;
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

    // ── Órdenes de compra ──────────────────────────────────────────────
    if (p === '/api/erp/ordenes-compra' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        const ocs = db.prepare(`
            SELECT oc.*, pr.nombre AS proveedor FROM ordenes_compra oc
            JOIN proveedores pr ON pr.id = oc.id_proveedor
            ORDER BY oc.id DESC LIMIT 100`).all();
        const det = db.prepare('SELECT d.*, p2.name FROM ordenes_compra_detalle d JOIN productos p2 ON p2.id=d.id_producto WHERE d.id_oc=?');
        return json(res, ocs.map(oc => ({ ...oc, items: det.all(oc.id) })));
    }
    if (p === '/api/erp/ordenes-compra' && req.method === 'POST') {
        if (!requireSession(req, res, ['gerente'])) return;
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
                const total = items.reduce((s, it) => s + parseInt(it.cantidad, 10) * Number(it.costo_unitario), 0);
                const folio = generarFolio('oc');
                const r = db.transaction(() => {
                    const oc = db.prepare('INSERT INTO ordenes_compra (folio, id_proveedor, total, notas) VALUES (?,?,?,?)')
                        .run(folio, d.id_proveedor, Math.round(total * 100) / 100, String(d.notas || '').trim() || null);
                    const ins = db.prepare('INSERT INTO ordenes_compra_detalle (id_oc, id_producto, cantidad, costo_unitario) VALUES (?,?,?,?)');
                    for (const it of items) ins.run(oc.lastInsertRowid, it.id_producto, parseInt(it.cantidad, 10), Number(it.costo_unitario));
                    return oc.lastInsertRowid;
                })();
                return json(res, { ok: true, id: r, folio });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // Recepción: aumenta inventario + costeo promedio + CxP + asiento compra
    if (req.method === 'POST' && p.match(/^\/api\/erp\/ordenes-compra\/\d+\/recibir$/)) {
        if (!requireSession(req, res, ['gerente'])) return;
        const id = parseInt(p.split('/')[4]);
        const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(id);
        if (!oc) return json(res, { ok: false, error: 'OC no encontrada' }, 404);
        if (oc.estatus !== 'abierta') return json(res, { ok: false, error: 'La OC no está abierta' }, 400);
        const sucursal = _sucursalDefault();
        if (!sucursal) return json(res, { ok: false, error: 'Configura la sucursal de facturación (Prime > General) antes de recibir' }, 400);
        try {
            const items = db.prepare('SELECT * FROM ordenes_compra_detalle WHERE id_oc=?').all(id);
            const prov = db.prepare('SELECT * FROM proveedores WHERE id=?').get(oc.id_proveedor);
            db.transaction(() => {
                for (const it of items) {
                    costeo.registrarEntrada(it.id_producto, it.cantidad, it.costo_unitario, 'oc:' + oc.folio);
                    const anterior = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(it.id_producto, sucursal)?.stock ?? null;
                    if (anterior !== null) {
                        db.prepare('UPDATE inventarios SET stock = stock + ? WHERE id_producto=? AND sucursal=?')
                          .run(it.cantidad, it.id_producto, sucursal);
                    } else {
                        db.prepare('INSERT INTO inventarios (id_producto, sucursal, stock) VALUES (?,?,?)')
                          .run(it.id_producto, sucursal, it.cantidad);
                    }
                    try {
                        db.prepare('INSERT INTO inventario_movimientos (id_producto, sucursal, tipo, cantidad_anterior, cantidad_nueva, motivo) VALUES (?,?,?,?,?,?)')
                          .run(it.id_producto, sucursal, 'entrada', anterior ?? 0, (anterior ?? 0) + it.cantidad, 'OC ' + oc.folio);
                    } catch (_) {}
                }
                const vence = prov?.dias_credito > 0
                    ? db.prepare("SELECT date('now', '+' || ? || ' days', 'localtime') v").get(prov.dias_credito).v
                    : db.prepare("SELECT date('now','localtime') v").get().v;
                db.prepare('INSERT INTO cuentas_pagar (id_proveedor, id_oc, monto, vence_en) VALUES (?,?,?,?)')
                  .run(oc.id_proveedor, id, oc.total, vence);
                db.prepare("UPDATE ordenes_compra SET estatus='recibida', recibida_en=datetime('now','localtime') WHERE id=?").run(id);
            })();
            try { conta.asientoCompra(oc.folio, oc.total); } catch (e) { log.warn('Asiento de compra falló: ' + e.message); }
            return json(res, { ok: true, id, estatus: 'recibida' });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // ── Cuentas por pagar ──────────────────────────────────────────────
    if (p === '/api/erp/cxp' && req.method === 'GET') {
        if (!requireSession(req, res, ['gerente'])) return;
        return json(res, db.prepare(`
            SELECT cp.*, pr.nombre AS proveedor, oc.folio AS folio_oc,
                   CAST(julianday(cp.vence_en) - julianday(date('now','localtime')) AS INTEGER) AS dias_para_vencer
            FROM cuentas_pagar cp
            JOIN proveedores pr ON pr.id = cp.id_proveedor
            LEFT JOIN ordenes_compra oc ON oc.id = cp.id_oc
            ORDER BY cp.estatus = 'pagada', cp.vence_en LIMIT 200`).all());
    }
    if (req.method === 'POST' && p.match(/^\/api\/erp\/cxp\/\d+\/pagar$/)) {
        if (!requireSession(req, res, ['gerente'])) return;
        const id = parseInt(p.split('/')[4]);
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

    return next();
};
