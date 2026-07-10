'use strict';
// ERP Fase 6: plan de cuentas, asientos (diario) y libro mayor.
// Consultas gerente+; asiento manual solo prime.
const conta = require('../../services/contabilidadService');
const { permite, esAdminOMas } = require('../permisos');

module.exports = function erpContabilidadRoutes(req, res, p, u, ctx, next) {
    const { db, json, readBody, requireSession } = ctx;
    if (!p.startsWith('/api/erp/')) return next();
    if (p.startsWith('/api/erp/plan-cuentas') || p.startsWith('/api/erp/asientos') || p.startsWith('/api/erp/libro-mayor')
        || p.startsWith('/api/erp/gastos') || p.startsWith('/api/erp/impuestos') || p.startsWith('/api/erp/periodo-cierre') || p.startsWith('/api/erp/tablero') || p.startsWith('/api/erp/facturacion-pendiente') || p.startsWith('/api/erp/productos-vendidos') || p.startsWith('/api/erp/rentabilidad-clientes') || p.startsWith('/api/erp/rentabilidad-vendedores')) {
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

    // PRODUCTOS VENDIDOS (dueño): qué se vendió, cuánto y en cuánto — sirve
    // aunque el negocio NO lleve inventario (la venta se graba igual). Base
    // para ir formalizando.
    if (p === '/api/erp/productos-vendidos' && req.method === 'GET') {
        const { desde, hasta } = _rango();
        const filas = db.prepare(`
            SELECT COALESCE(pr.name, d.id_producto) producto, pr.sku,
                   ROUND(SUM(d.cantidad),3) unidades,
                   ROUND(SUM(d.precio_unitario * d.cantidad),2) total
            FROM pedido_detalle d
            JOIN pedidos p2 ON p2.id_pedido = d.id_pedido
            JOIN links_pago lp ON lp.id_pedido = p2.id_pedido AND lp.estatus='pagado'
            LEFT JOIN productos pr ON pr.id = d.id_producto
            WHERE date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ?
            GROUP BY d.id_producto ORDER BY total DESC LIMIT 500`).all(desde, hasta);
        const totalGeneral = filas.reduce((s, f) => s + (f.total || 0), 0);
        return json(res, { desde, hasta, filas, total: Math.round(totalGeneral * 100) / 100 });
    }

    // FACTURACIÓN PENDIENTE (dueño): pedidos con datos fiscales capturados,
    // exportable para que un PAC/tercero los timbre externamente. El enganche
    // del PAC va aquí cuando se contrate. NO es CFDI timbrado.
    if (p === '/api/erp/facturacion-pendiente' && req.method === 'GET') {
        const { desde, hasta } = _rango();
        const filas = db.prepare(`
            SELECT p2.folio, p2.razon_social, p2.rfc,
                   COALESCE((SELECT SUM(monto) FROM links_pago lp WHERE lp.id_pedido=p2.id_pedido AND lp.estatus='pagado'), p2.total) monto,
                   p2.creado_en
            FROM pedidos p2
            WHERE (p2.rfc IS NOT NULL AND p2.rfc != '') AND date(p2.creado_en) >= ? AND date(p2.creado_en) <= ?
            ORDER BY p2.id_pedido DESC LIMIT 500`).all(desde, hasta);
        return json(res, { desde, hasta, filas });
    }

    // TABLERO DE DIRECCIÓN (comité: Harvard+LSE+Oxford) — estado de
    // resultados, balance, aging CxC, rotación de inventario, margen por
    // categoría y ticket vs período anterior. Todo desde datos existentes.
    if (p === '/api/erp/tablero' && req.method === 'GET') {
        const { desde, hasta } = _rango();
        const r2 = (n) => Math.round((n || 0) * 100) / 100;

        // — Estado de resultados (del período) —
        const may = conta.libroMayor(desde, hasta);
        const cta = (c) => may.find(x => x.cuenta === c) || { debe: 0, haber: 0 };
        const ingresos = r2(cta('401').haber - cta('401').debe);
        const cogs = r2(cta('501').debe - cta('501').haber);
        const gastos = r2(cta('601').debe - cta('601').haber);
        const utilidad_bruta = r2(ingresos - cogs);
        const utilidad_operativa = r2(utilidad_bruta - gastos);
        const pyl = { ingresos, cogs, utilidad_bruta, gastos, utilidad_operativa,
            margen_bruto_pct: ingresos ? r2(utilidad_bruta / ingresos * 100) : 0,
            margen_neto_pct: ingresos ? r2(utilidad_operativa / ingresos * 100) : 0 };

        // — Punto de equilibrio (en $ de venta) — trata los gastos operativos
        // (601) como FIJOS y el COGS como variable (simplificación documentada):
        // ventas_equilibrio = gastos_fijos / margen_de_contribución.
        const margenContrib = ingresos > 0 ? (ingresos - cogs) / ingresos : 0;
        const puntoEquilibrio = {
            gastos_fijos: gastos,
            margen_contribucion_pct: r2(margenContrib * 100),
            ventas_equilibrio: margenContrib > 0 ? r2(gastos / margenContrib) : null,
            ventas_periodo: ingresos,
            // cuánto por encima (o debajo) del equilibrio va el período
            holgura: margenContrib > 0 ? r2(ingresos - gastos / margenContrib) : null,
        };

        // — Balance general (acumulado hasta 'hasta') —
        const acum = conta.libroMayor('1900-01-01', hasta);
        const porTipo = { activo: 0, pasivo: 0, capital: 0, ingreso: 0, costo: 0, gasto: 0 };
        for (const c of acum) {
            const t = c.tipo || '';
            if (t === 'activo' || t === 'costo' || t === 'gasto') porTipo[t] = (porTipo[t] || 0) + (c.debe - c.haber);
            else porTipo[t] = (porTipo[t] || 0) + (c.haber - c.debe);
        }
        const utilidad_acumulada = r2(porTipo.ingreso - porTipo.costo - porTipo.gasto);
        const balance = {
            activos: r2(porTipo.activo),
            pasivos: r2(porTipo.pasivo),
            capital: r2(porTipo.capital + utilidad_acumulada),
            cuadra: Math.abs(porTipo.activo - (porTipo.pasivo + porTipo.capital + utilidad_acumulada)) < 0.5,
        };

        // — Aging de CxC (pedidos con pago generado no pagado) —
        let aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
        try {
            const cxc = db.prepare(`
                SELECT lp.monto, CAST(julianday('now','localtime') - julianday(p2.creado_en) AS INT) dias
                FROM links_pago lp JOIN pedidos p2 ON p2.id_pedido = lp.id_pedido
                WHERE lp.estatus != 'pagado' AND p2.estatus NOT IN ('cancelado')`).all();
            for (const x of cxc) {
                const b = x.dias <= 30 ? '0-30' : x.dias <= 60 ? '31-60' : x.dias <= 90 ? '61-90' : '90+';
                aging[b] = r2(aging[b] + (x.monto || 0));
            }
        } catch (_) {}

        // — Rotación de inventario —
        let inventario = {};
        try {
            const valorInv = db.prepare('SELECT COALESCE(SUM(i.stock * COALESCE(pr.costo,0)),0) v FROM inventarios i JOIN productos pr ON pr.id = i.id_producto').get().v;
            const diasPeriodo = Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1);
            const cogsDiario = cogs / diasPeriodo;
            inventario = {
                valor: r2(valorInv),
                cogs_periodo: cogs,
                dias_inventario: cogsDiario > 0 ? Math.round(valorInv / cogsDiario) : null, // cuántos días dura el stock al ritmo actual
                rotacion_anual: valorInv > 0 ? r2(cogs / diasPeriodo * 365 / valorInv) : null,
            };
        } catch (_) {}

        // — Margen por categoría (ventas pagadas del período) —
        let categorias = [];
        try {
            categorias = db.prepare(`
                SELECT COALESCE(NULLIF(pr.cat,''), 'Sin categoría') categoria,
                       ROUND(SUM(d.precio_unitario * d.cantidad),2) ventas,
                       ROUND(SUM(COALESCE(pr.costo,0) * d.cantidad),2) costo
                FROM pedido_detalle d
                JOIN pedidos p2 ON p2.id_pedido = d.id_pedido
                JOIN productos pr ON pr.id = d.id_producto
                JOIN links_pago lp ON lp.id_pedido = p2.id_pedido AND lp.estatus='pagado'
                WHERE date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ?
                GROUP BY categoria ORDER BY ventas DESC LIMIT 20`).all(desde, hasta)
                .map(c => ({ ...c, margen: r2(c.ventas - c.costo), margen_pct: c.ventas ? r2((c.ventas - c.costo) / c.ventas * 100) : 0 }));
        } catch (_) {}

        // — Ticket promedio vs período anterior —
        let ticket = {};
        try {
            const dias = Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1);
            const prevHasta = new Date(Date.parse(desde) - 86400000).toISOString().slice(0, 10);
            const prevDesde = new Date(Date.parse(desde) - dias * 86400000).toISOString().slice(0, 10);
            const q = (d1, d2) => db.prepare(`SELECT COALESCE(SUM(monto),0) t, COUNT(DISTINCT id_pedido) n FROM links_pago WHERE estatus='pagado' AND date(pagado_en)>=? AND date(pagado_en)<=?`).get(d1, d2);
            const act = q(desde, hasta), prev = q(prevDesde, prevHasta);
            const tAct = act.n ? act.t / act.n : 0, tPrev = prev.n ? prev.t / prev.n : 0;
            ticket = { actual: r2(tAct), anterior: r2(tPrev), pedidos: act.n,
                variacion_pct: tPrev ? r2((tAct - tPrev) / tPrev * 100) : null };
        } catch (_) {}

        // El P&L/balance salen de asientos; sin el módulo Contabilidad no se
        // asienta nada y todo da $0 — la UI muestra un aviso para que no se
        // lea como "no vendí" (Harvard/PO del re-review).
        return json(res, { desde, hasta, pyl, punto_equilibrio: puntoEquilibrio, balance, aging, inventario, categorias, ticket, conta_activa: conta.activo() });
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

    // GET /api/erp/rentabilidad-clientes — quién deja más margen (ventas
    // pagadas − costo) y cuánto te debe en fiado. Identifica el 20% que da el
    // 80% y a los "tóxicos" (mucho volumen, bajo margen o mucha deuda).
    if (p === '/api/erp/rentabilidad-clientes' && req.method === 'GET') {
        const { desde, hasta } = _rango();
        let filas = [];
        try {
            filas = db.prepare(`
                SELECT COALESCE(c.id, p2.cliente) AS id_cliente, COALESCE(c.nombre, p2.cliente) AS nombre, c.telefono,
                       COUNT(DISTINCT p2.id_pedido) AS pedidos,
                       ROUND(SUM(d.precio_unitario * d.cantidad), 2) AS ventas,
                       ROUND(SUM(COALESCE(pr.costo, 0) * d.cantidad), 2) AS costo
                FROM pedido_detalle d
                JOIN pedidos p2 ON p2.id_pedido = d.id_pedido
                JOIN productos pr ON pr.id = d.id_producto
                JOIN links_pago lp ON lp.id_pedido = p2.id_pedido AND lp.estatus='pagado'
                LEFT JOIN clientes c ON c.id = p2.id_cliente
                WHERE date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ?
                GROUP BY COALESCE(c.id, p2.cliente)
                ORDER BY (SUM(d.precio_unitario * d.cantidad) - SUM(COALESCE(pr.costo,0) * d.cantidad)) DESC
                LIMIT 100`).all(desde, hasta)
                .map(r => ({ ...r, margen: r2(r.ventas - r.costo), margen_pct: r.ventas ? r2((r.ventas - r.costo) / r.ventas * 100) : 0 }));
            // Adeudo de fiado por cliente (independiente del período)
            const deuda = db.prepare("SELECT p.id_cliente, ROUND(SUM(lp.monto),2) adeudo FROM pedidos p JOIN links_pago lp ON lp.id_pedido=p.id_pedido AND lp.estatus='generado' WHERE p.a_credito=1 GROUP BY p.id_cliente").all();
            const mapDeuda = {}; deuda.forEach(x => { mapDeuda[x.id_cliente] = x.adeudo; });
            filas.forEach(f => { f.adeudo_fiado = mapDeuda[f.id_cliente] || 0; });
        } catch (_) {}
        return json(res, { desde, hasta, clientes: filas });
    }

    // GET /api/erp/rentabilidad-vendedores — más allá de la comisión: quién
    // vende con margen sano vs quién deja fiado sin cobrar. Por cobrado_por.
    if (p === '/api/erp/rentabilidad-vendedores' && req.method === 'GET') {
        const { desde, hasta } = _rango();
        let filas = [];
        try {
            const pct = parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='comision_pct'").get()?.valor || '0') || 0;
            filas = db.prepare(`
                SELECT p2.cobrado_por AS vendedor,
                       COUNT(DISTINCT p2.id_pedido) AS pedidos,
                       ROUND(SUM(d.precio_unitario * d.cantidad), 2) AS ventas,
                       ROUND(SUM(COALESCE(pr.costo, 0) * d.cantidad), 2) AS costo
                FROM pedido_detalle d
                JOIN pedidos p2 ON p2.id_pedido = d.id_pedido
                JOIN productos pr ON pr.id = d.id_producto
                JOIN links_pago lp ON lp.id_pedido = p2.id_pedido AND lp.estatus='pagado'
                WHERE date(lp.pagado_en) >= ? AND date(lp.pagado_en) <= ? AND p2.cobrado_por IS NOT NULL
                GROUP BY p2.cobrado_por
                ORDER BY (SUM(d.precio_unitario * d.cantidad) - SUM(COALESCE(pr.costo,0) * d.cantidad)) DESC`).all(desde, hasta)
                .map(r => ({ ...r, margen: r2(r.ventas - r.costo), margen_pct: r.ventas ? r2((r.ventas - r.costo) / r.ventas * 100) : 0, comision: r2(r.ventas * pct / 100) }));
            // Fiado pendiente que dejó cada vendedor (a_credito sin cobrar)
            const fiado = db.prepare("SELECT p.cobrado_por, ROUND(SUM(lp.monto),2) fiado FROM pedidos p JOIN links_pago lp ON lp.id_pedido=p.id_pedido AND lp.estatus='generado' WHERE p.a_credito=1 AND p.cobrado_por IS NOT NULL GROUP BY p.cobrado_por").all();
            const mapF = {}; fiado.forEach(x => { mapF[x.cobrado_por] = x.fiado; });
            filas.forEach(f => { f.fiado_pendiente = mapF[f.vendedor] || 0; });
        } catch (_) {}
        return json(res, { desde, hasta, comision_pct: parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='comision_pct'").get()?.valor || '0') || 0, vendedores: filas });
    }

    // Registro de GASTOS directos (renta, luz, papelería) → asiento 601
    // (+119 si trae IVA) contra Caja/Bancos. Requiere módulo contabilidad ON.
    if (p === '/api/erp/gastos' && req.method === 'POST') {
        const sesG = requireSession(req, res);
        if (!sesG) return;
        return readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const monto = Number(d.monto);
                if (!String(d.concepto || '').trim() || !(monto > 0)) return json(res, { ok: false, error: 'Faltan concepto o monto' }, 400);
                if (!conta.activo()) return json(res, { ok: false, error: 'Activa el módulo Contabilidad en Módulos para registrar gastos' }, 400);
                // Fecha opcional (capturar en meses pasados). Si el mes está
                // cerrado, solo Administrador/Prime puede, y queda la huella.
                const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : null;
                const mesCerrado = conta.mesCerradoDe(fecha);
                if (mesCerrado) {
                    if (!esAdminOMas(sesG.rol)) {
                        return json(res, { ok: false, error: 'El período ' + mesCerrado + ' está cerrado. Solo un Administrador o Prime puede autorizar la captura en meses cerrados.', mes_cerrado: mesCerrado }, 409);
                    }
                    require('../../services/configAudit').logCambio(db, 'gasto_mes_cerrado', (fecha || '').slice(0, 7) + ' · ' + String(d.concepto).trim() + ' $' + monto, sesG.username);
                }
                const id = conta.asientoGasto(String(d.concepto).trim(), monto, d.metodo === 'bancos' ? 'bancos' : 'caja', !!d.con_iva, { fecha, override: !!mesCerrado });
                return json(res, { ok: true, id_asiento: id, en_mes_cerrado: !!mesCerrado });
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
