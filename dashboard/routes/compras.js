'use strict';
// Rol Compras: solicitudes de adquisición (administrador aprueba → OC) e
// ingreso de facturas de proveedor sin OC (→ CxP directa + asiento).
const conta = require('../../services/contabilidadService');
const costeo = require('../../services/costeoService');
const kardexService = require('../../services/kardexService');
const { permite, rangoDe } = require('../permisos');

// Matchea un concepto de CFDI contra el catálogo: NoIdentificacion vs
// upc/sku, o descripción exacta vs nombre. null = no encontrado.
function _matchProducto(db, c) {
    if (c.no_identificacion) {
        const porCodigo = db.prepare('SELECT id, name FROM productos WHERE upc=? OR sku=? LIMIT 1')
            .get(c.no_identificacion, c.no_identificacion);
        if (porCodigo) return porCodigo;
    }
    return db.prepare('SELECT id, name FROM productos WHERE LOWER(name)=LOWER(?) LIMIT 1').get(c.descripcion) || null;
}

module.exports = function comprasRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession, log } = ctx;
    if (!p.startsWith('/api/compras/')) return next();

    const ses = requireSession(req, res);
    if (!ses) return;
    if (!permite(ses.rol, 'compras') && !permite(ses.rol, 'finanzas')) {
        return json(res, { ok: false, error: 'Tu rol no tiene acceso a compras' }, 403);
    }

    if (p === '/api/compras/solicitudes' && req.method === 'GET') {
        return json(res, db.prepare(`
            SELECT sc.*, p2.name AS producto FROM solicitudes_compra sc
            LEFT JOIN productos p2 ON p2.id = sc.id_producto
            ORDER BY sc.estatus='pendiente' DESC, sc.id DESC LIMIT 200`).all());
    }

    if (p === '/api/compras/solicitudes' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const desc = String(d.descripcion || '').trim();
                if (!desc) return json(res, { ok: false, error: 'Falta la descripción' }, 400);
                const r = db.prepare('INSERT INTO solicitudes_compra (descripcion, id_producto, cantidad, motivo, creada_por) VALUES (?,?,?,?,?)')
                    .run(desc, Number.isInteger(d.id_producto) ? d.id_producto : null,
                         parseInt(d.cantidad, 10) || null, String(d.motivo || '').trim() || null, ses.username);
                return json(res, { ok: true, id: r.lastInsertRowid });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // Aprobar/rechazar — solo administrador+ (separación de funciones)
    if (req.method === 'POST' && p.match(/^\/api\/compras\/solicitudes\/\d+\/(aprobar|rechazar)$/)) {
        if (rangoDe(ses.rol) < 2) return json(res, { ok: false, error: 'Aprobar solicitudes es del administrador' }, 403);
        const id = parseInt(p.split('/')[4]);
        const accion = p.endsWith('aprobar') ? 'aprobada' : 'rechazada';
        const sc = db.prepare("SELECT * FROM solicitudes_compra WHERE id=? AND estatus='pendiente'").get(id);
        if (!sc) return json(res, { ok: false, error: 'Solicitud no encontrada o ya resuelta' }, 404);
        db.prepare("UPDATE solicitudes_compra SET estatus=?, resuelta_por=?, resuelta_en=datetime('now','localtime') WHERE id=?")
          .run(accion, ses.username, id);
        return json(res, { ok: true, id, estatus: accion });
    }

    // Factura por XML (CFDI): parsea, da preview y al confirmar crea/matchea
    // proveedor por RFC + CxP + asiento — además del modo manual de abajo.
    if (p === '/api/compras/factura-xml' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const cfdi = require('../../services/cfdiService').parsearCFDI(d.xml);
                if (d.solo_preview) {
                    // Preview con matcheo de conceptos contra el catálogo
                    const conceptos = cfdi.conceptos.map(c => {
                        const prod = _matchProducto(db, c);
                        return { ...c, producto_id: prod?.id || null, producto: prod?.name || null };
                    });
                    return json(res, { ok: true, cfdi: { ...cfdi, conceptos } });
                }

                if (cfdi.uuid && db.prepare('SELECT id FROM cuentas_pagar WHERE referencia=?').get(cfdi.uuid)) {
                    return json(res, { ok: false, error: 'Esta factura (UUID) ya está registrada' }, 400);
                }
                let prov = cfdi.emisor_rfc && db.prepare('SELECT * FROM proveedores WHERE rfc=?').get(cfdi.emisor_rfc);
                if (!prov) {
                    const r = db.prepare('INSERT INTO proveedores (nombre, rfc, dias_credito) VALUES (?,?,0)')
                        .run(cfdi.emisor_nombre, cfdi.emisor_rfc || null);
                    prov = { id: r.lastInsertRowid, nombre: cfdi.emisor_nombre, dias_credito: 0 };
                }
                const dias = Number.isInteger(d.dias_credito) ? d.dias_credito : (prov.dias_credito || 0);
                const vence = db.prepare("SELECT date(COALESCE(?, date('now','localtime')), '+' || ? || ' days') v").get(cfdi.fecha, dias).v;
                const r = db.prepare('INSERT INTO cuentas_pagar (id_proveedor, monto, vence_en, referencia) VALUES (?,?,?,?)')
                    .run(prov.id, cfdi.total, vence, cfdi.uuid || [cfdi.serie, cfdi.folio].filter(Boolean).join('-') || null);
                try {
                    conta.registrarAsiento({
                        concepto: 'CFDI ' + (cfdi.serie || '') + (cfdi.folio || cfdi.uuid || '') + ' — ' + prov.nombre,
                        referencia_tipo: 'compra', referencia_id: 'cfdi:' + (cfdi.uuid || r.lastInsertRowid),
                        partidas: [{ cuenta: d.es_mercancia ? '115' : '601', debe: cfdi.total }, { cuenta: '201', haber: cfdi.total }],
                    });
                } catch (e) { if (conta.activo()) log.warn('Asiento CFDI falló: ' + e.message); }

                // Cargar los CONCEPTOS al inventario (opcional, solo mercancía):
                // match → entrada con kardex + costeo promedio; sin match → se
                // crea el producto INACTIVO (costo=unitario, para que el admin
                // le ponga precio y lo active). El asiento de arriba ya valuó
                // la compra — aquí NO se asienta doble.
                const carga = { entradas: 0, creados: 0, omitidos: [] };
                if (d.cargar_conceptos && d.es_mercancia) {
                    const suc = (() => {
                        const v = db.prepare("SELECT valor FROM configuracion WHERE clave='sucursal_facturacion_default'").get()?.valor;
                        if (!v) return null;
                        return db.prepare('SELECT nombre FROM sucursales WHERE id=?').get(Number(v))?.nombre
                            || db.prepare('SELECT nombre FROM sucursales WHERE nombre=?').get(v)?.nombre || null;
                    })();
                    if (!suc) return json(res, { ok: false, error: 'Configura la sucursal de facturación antes de cargar conceptos' }, 400);
                    db.transaction(() => {
                        for (const c of cfdi.conceptos) {
                            const cant = Math.round(c.cantidad);
                            if (!(cant > 0)) { carga.omitidos.push(c.descripcion + ' (cantidad no entera)'); continue; }
                            let prod = _matchProducto(db, c);
                            if (!prod) {
                                const nu = db.prepare(`INSERT INTO productos (tipo, name, price, costo, sku, activo, cat)
                                                       VALUES ('fisico', ?, ?, ?, ?, 0, '')`)
                                    .run(c.descripcion.slice(0, 120), c.valor_unitario, c.valor_unitario, c.no_identificacion || null);
                                prod = { id: nu.lastInsertRowid };
                                carga.creados++;
                            }
                            if (c.valor_unitario > 0) {
                                try { costeo.registrarEntrada(prod.id, cant, c.valor_unitario, 'cfdi:' + (cfdi.uuid || r.lastInsertRowid)); } catch (_) {}
                            }
                            kardexService.movimiento({ id_producto: prod.id, sucursal: suc, tipo: 'entrada', delta: cant, motivo: 'CFDI ' + (cfdi.uuid || cfdi.folio || ''), usuario: ses.username });
                            carga.entradas++;
                        }
                    })();
                }
                return json(res, { ok: true, id_cxp: r.lastInsertRowid, proveedor: prov.nombre, total: cfdi.total, vence_en: vence, conceptos: cfdi.conceptos.length, carga });
            } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
        });
    }

    // Factura de proveedor SIN OC → CxP directa + asiento (mercancía o gasto)
    if (p === '/api/compras/factura' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const monto = Number(d.monto);
                if (!Number.isInteger(d.id_proveedor) || !(monto > 0)) {
                    return json(res, { ok: false, error: 'Faltan proveedor/monto' }, 400);
                }
                const prov = db.prepare('SELECT * FROM proveedores WHERE id=?').get(d.id_proveedor);
                if (!prov) return json(res, { ok: false, error: 'Proveedor no encontrado' }, 404);
                const dias = Number.isInteger(d.dias_credito) ? d.dias_credito : (prov.dias_credito || 0);
                const vence = db.prepare("SELECT date('now', '+' || ? || ' days', 'localtime') v").get(dias).v;
                const r = db.prepare('INSERT INTO cuentas_pagar (id_proveedor, monto, vence_en, referencia) VALUES (?,?,?,?)')
                    .run(d.id_proveedor, Math.round(monto * 100) / 100, vence, String(d.referencia || '').trim() || null);
                try {
                    conta.registrarAsiento({
                        concepto: 'Factura ' + (d.referencia || r.lastInsertRowid) + ' — ' + prov.nombre,
                        referencia_tipo: 'compra', referencia_id: 'fact:' + r.lastInsertRowid,
                        partidas: [{ cuenta: d.es_mercancia ? '115' : '601', debe: monto }, { cuenta: '201', haber: monto }],
                    });
                } catch (e) { if (conta.activo()) log.warn('Asiento de factura falló: ' + e.message); }
                return json(res, { ok: true, id: r.lastInsertRowid, vence_en: vence });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    return next();
};
