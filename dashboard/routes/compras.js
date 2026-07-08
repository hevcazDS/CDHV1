'use strict';
// Rol Compras: solicitudes de adquisición (administrador aprueba → OC) e
// ingreso de facturas de proveedor sin OC (→ CxP directa + asiento).
const conta = require('../../services/contabilidadService');
const { permite, rangoDe } = require('../permisos');

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
                if (d.solo_preview) return json(res, { ok: true, cfdi });

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
                return json(res, { ok: true, id_cxp: r.lastInsertRowid, proveedor: prov.nombre, total: cfdi.total, vence_en: vence, conceptos: cfdi.conceptos.length });
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
