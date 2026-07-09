'use strict';
// ERP Fase 6: plan de cuentas, asientos (diario) y libro mayor.
// Consultas gerente+; asiento manual solo prime.
const conta = require('../../services/contabilidadService');
const { permite } = require('../permisos');

module.exports = function erpContabilidadRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession } = ctx;
    if (!p.startsWith('/api/erp/')) return next();
    if (p.startsWith('/api/erp/plan-cuentas') || p.startsWith('/api/erp/asientos') || p.startsWith('/api/erp/libro-mayor')
        || p.startsWith('/api/erp/gastos') || p.startsWith('/api/erp/impuestos') || p.startsWith('/api/erp/periodo-cierre')) {
        const ses = requireSession(req, res);
        if (!ses) return;
        if (!permite(ses.rol, 'finanzas')) return json(res, { ok: false, error: 'Sin acceso a contabilidad' }, 403);
    }

    const _rango = () => {
        const sp = new URL(req.url, 'http://x').searchParams;
        const hoy = new Date().toISOString().slice(0, 10);
        const mes = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        return { desde: (sp.get('desde') || mes).slice(0, 10), hasta: (sp.get('hasta') || hoy).slice(0, 10) };
    };

    if (p === '/api/erp/plan-cuentas' && req.method === 'GET') {
        return json(res, db.prepare('SELECT * FROM plan_cuentas ORDER BY codigo').all());
    }

    if (p === '/api/erp/asientos' && req.method === 'GET') {
        const { desde, hasta } = _rango();
        const asientos = db.prepare(
            'SELECT * FROM asientos WHERE fecha >= ? AND fecha <= ? ORDER BY id DESC LIMIT 200'
        ).all(desde, hasta);
        const det = db.prepare(`
            SELECT d.cuenta, pc.nombre, d.debe, d.haber FROM asientos_detalle d
            LEFT JOIN plan_cuentas pc ON pc.codigo = d.cuenta WHERE d.id_asiento=?`);
        return json(res, asientos.map(a => ({ ...a, partidas: det.all(a.id) })));
    }

    if (p === '/api/erp/libro-mayor' && req.method === 'GET') {
        const { desde, hasta } = _rango();
        return json(res, { desde, hasta, cuentas: conta.libroMayor(desde, hasta) });
    }

    // RASTRO DE DOCUMENTO (idea SAP): desde un folio, toda la cadena —
    // pedido → detalle → pagos → kardex → asientos → devoluciones. Área
    // finanzas (el auditor pasa por su bypass de lectura).
    if (p === '/api/erp/rastro' && req.method === 'GET') {
        const sesR = requireSession(req, res);
        if (!sesR) return;
        if (!permite(sesR.rol, 'finanzas')) return json(res, { ok: false, error: 'Sin acceso' }, 403);
        const q = ((new URL(req.url, 'http://x')).searchParams.get('folio') || '').trim();
        if (!q) return json(res, { ok: false, error: 'Falta folio' }, 400);
        const ped = db.prepare('SELECT * FROM pedidos WHERE folio=? OR id_pedido=? LIMIT 1').get(q, parseInt(q.replace(/\D/g, ''), 10) || -1);
        if (!ped) return json(res, { ok: false, error: 'No encontré pedido con folio ' + q }, 404);
        const id = ped.id_pedido, folio = ped.folio || ('#' + id);
        const like1 = '%' + folio + '%', like2 = '%pedido ' + id + '%';
        return json(res, {
            ok: true,
            pedido: ped,
            detalle: db.prepare('SELECT d.*, pr.name FROM pedido_detalle d LEFT JOIN productos pr ON pr.id=d.id_producto WHERE d.id_pedido=?').all(id),
            pagos: db.prepare('SELECT * FROM links_pago WHERE id_pedido=?').all(id),
            kardex: db.prepare('SELECT * FROM inventario_movimientos WHERE motivo LIKE ? OR motivo LIKE ? ORDER BY id').all(like1, like2),
            asientos: db.prepare(`SELECT a.*, (SELECT GROUP_CONCAT(d2.cuenta || ' $' || COALESCE(NULLIF(d2.debe,0), d2.haber), ' · ') FROM asientos_detalle d2 WHERE d2.id_asiento=a.id) partidas_txt
                                  FROM asientos a WHERE a.referencia_id=? OR a.concepto LIKE ? OR a.concepto LIKE ? ORDER BY a.id`).all(String(id), like1, like2),
            devoluciones: db.prepare('SELECT * FROM devoluciones WHERE id_pedido=?').all(id),
        });
    }

    // Cierre de período contable (idea SAP): 'YYYY-MM' — nada se asienta en
    // meses <= cerrado. Reabrir = borrar el valor (queda en el log de quién).
    if (p === '/api/erp/periodo-cierre' && req.method === 'GET') {
        return json(res, { cerrado: db.prepare("SELECT valor FROM configuracion WHERE clave='periodo_cerrado'").get()?.valor || null });
    }
    if (p === '/api/erp/periodo-cierre' && req.method === 'PUT') {
        const sesP = requireSession(req, res);
        if (!sesP) return;
        if (!permite(sesP.rol, 'finanzas')) return json(res, { ok: false, error: 'Sin acceso a contabilidad' }, 403);
        return readBody(req, body => {
            try {
                const v = String(JSON.parse(body || '{}').cerrado || '').trim();
                if (v && !/^\d{4}-\d{2}$/.test(v)) return json(res, { ok: false, error: 'Formato YYYY-MM (o vacío para reabrir)' }, 400);
                require('../../services/configAudit').logCambio(db, 'periodo_cerrado', v || null, sesP.username);
                if (v) db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('periodo_cerrado', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(v);
                else db.prepare("DELETE FROM configuracion WHERE clave='periodo_cerrado'").run();
                ctx.log.info('[contable] período ' + (v ? 'cerrado hasta ' + v : 'REABIERTO') + ' por ' + sesP.username);
                return json(res, { ok: true, cerrado: v || null });
            } catch (e2) { return json(res, { ok: false, error: e2.message }, 500); }
        });
    }

    // Registro de GASTOS directos (renta, luz, papelería) → asiento 601
    // (+119 si trae IVA) contra Caja/Bancos. Requiere módulo contabilidad ON.
    if (p === '/api/erp/gastos' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const monto = Number(d.monto);
                if (!String(d.concepto || '').trim() || !(monto > 0)) return json(res, { ok: false, error: 'Faltan concepto o monto' }, 400);
                if (!conta.activo()) return json(res, { ok: false, error: 'Activa el módulo Contabilidad en Módulos para registrar gastos' }, 400);
                const id = conta.asientoGasto(String(d.concepto).trim(), monto, d.metodo === 'bancos' ? 'bancos' : 'caja', !!d.con_iva);
                return json(res, { ok: true, id_asiento: id });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }
    if (p === '/api/erp/gastos' && req.method === 'GET') {
        const { desde, hasta } = _rango();
        const gastos = db.prepare(`
            SELECT a.id, a.fecha, a.concepto, COALESCE(SUM(d.haber), 0) total
            FROM asientos a JOIN asientos_detalle d ON d.id_asiento = a.id
            WHERE a.referencia_tipo='gasto' AND a.fecha >= ? AND a.fecha <= ?
            GROUP BY a.id ORDER BY a.id DESC LIMIT 200`).all(desde, hasta);
        return json(res, gastos);
    }

    // Reporte de IMPUESTOS del periodo: IVA trasladado (209, cobrado en
    // ventas) vs acreditable (119, pagado en compras/gastos) = por pagar/favor
    if (p === '/api/erp/impuestos' && req.method === 'GET') {
        const { desde, hasta } = _rango();
        const cuentas = conta.libroMayor(desde, hasta);
        const de = (cod) => cuentas.find(c => c.cuenta === cod) || { debe: 0, haber: 0 };
        const trasladado = Math.round((de('209').haber - de('209').debe) * 100) / 100;
        const acreditable = Math.round((de('119').debe - de('119').haber) * 100) / 100;
        return json(res, {
            desde, hasta,
            ventas_base: Math.round((de('401').haber - de('401').debe) * 100) / 100,
            gastos: Math.round((de('601').debe - de('601').haber) * 100) / 100,
            iva_trasladado: trasladado,
            iva_acreditable: acreditable,
            iva_resultado: Math.round((trasladado - acreditable) * 100) / 100, // >0 = por pagar, <0 = a favor
        });
    }

    // Asiento manual (ajustes, capital inicial, gastos) — es la herramienta
    // diaria del contador: área finanzas (contabilidad/administrador/prime)
    if (p === '/api/erp/asientos' && req.method === 'POST') {
        const sesA = requireSession(req, res);
        if (!sesA) return;
        if (!permite(sesA.rol, 'finanzas')) return json(res, { ok: false, error: 'Sin acceso a contabilidad' }, 403);
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const id = conta.registrarAsiento({
                    concepto: String(d.concepto || '').trim() || 'Asiento manual',
                    referencia_tipo: 'manual',
                    partidas: Array.isArray(d.partidas) ? d.partidas : [],
                });
                return json(res, { ok: true, id });
            } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
        });
    }

    return next();
};
