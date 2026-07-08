'use strict';
// ERP Fase 6: plan de cuentas, asientos (diario) y libro mayor.
// Consultas gerente+; asiento manual solo prime.
const conta = require('../../services/contabilidadService');
const { permite } = require('../permisos');

module.exports = function erpContabilidadRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession } = ctx;
    if (!p.startsWith('/api/erp/')) return next();
    if (p.startsWith('/api/erp/plan-cuentas') || p.startsWith('/api/erp/asientos') || p.startsWith('/api/erp/libro-mayor')) {
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

    // Asiento manual (ajustes, capital inicial, gastos) — prime
    if (p === '/api/erp/asientos' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
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
