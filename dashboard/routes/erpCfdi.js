'use strict';
// ERP Fase 6 — fiscal/PAC/CFDI: timbrado, descarga/cancelación de CFDI,
// complemento de pago (REP), facturación pendiente, DIOT y contabilidad
// electrónica SAT. Split por dominio de erpContabilidad.js (ver PLAN_V3.md).
// Migrado al patrón declarativo del tronco: TODAS las rutas son
// area:'finanzas' (contabilidad/administrador/prime; el auditor pasa por su
// bypass de lectura). Bajo el prefijo /api/erp/.
const conta = require('../../services/contabilidadService');
const construirModulo = require('./_construirModulo');

function _rango(req) {
    const sp = new URL(req.url, 'http://x').searchParams;
    const hoy = new Date().toISOString().slice(0, 10);
    const mes = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return { desde: (sp.get('desde') || mes).slice(0, 10), hasta: (sp.get('hasta') || hoy).slice(0, 10) };
}

function facturacionPendiente(req, res, ctx) {
    const { db, json } = ctx;
    const { desde, hasta } = _rango(req);
    const filas = db.prepare(`
        SELECT p2.id_pedido, p2.folio, p2.razon_social, p2.rfc, p2.cfdi_uuid, p2.cfdi_estatus, p2.rep_uuid, p2.a_credito,
               COALESCE((SELECT SUM(monto) FROM links_pago lp WHERE lp.id_pedido=p2.id_pedido AND lp.estatus='pagado'), p2.total) monto, p2.creado_en
        FROM pedidos p2
        WHERE (p2.rfc IS NOT NULL AND p2.rfc != '') AND date(p2.creado_en) >= ? AND date(p2.creado_en) <= ?
        ORDER BY p2.id_pedido DESC LIMIT 500`).all(desde, hasta)
        // método de pago SAT: fiado = PPD (parcialidades/diferido, lleva REP al cobrar); contado = PUE
        .map(f => ({ ...f, metodo_sat: f.a_credito ? 'PPD' : 'PUE' }));
    // ¿El PAC ya está activo? (para que la UI ofrezca timbrar directo)
    const pacActivo = require('../../services/pacService').activo(db);
    return json(res, { desde, hasta, filas, pac_activo: pacActivo });
}

// POST /api/erp/timbrar/:id — timbra el CFDI vía el PAC (async, hoy inerte)
function timbrar(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const idP = parseInt(params[0]);
    return require('../../services/pacService').timbrar(db, idP)
        .then(r => {
            // F5.4: al timbrar, archiva el CFDI en el baúl local (best-effort, no bloquea).
            if (r.ok) { try { require('../../services/baulContable').archivar(db, idP).catch(() => {}); } catch (_) {} }
            return json(res, r.ok ? r : { ok: false, ...r }, r.ok ? 200 : 400);
        })
        .catch(e => json(res, { ok: false, error: e.message }, 500));
}

// POST /api/erp/cfdi/:id/cancelar — cancela el CFDI ante el SAT (motivo opcional)
function cfdiCancelar(req, res, ctx, { params }) {
    const { db, json, readBody } = ctx;
    return readBody(req, body => {
        let motivo = '02'; try { motivo = JSON.parse(body || '{}').motivo || '02'; } catch (_) {}
        return require('../../services/pacService').cancelarCFDI(db, parseInt(params[0]), motivo)
            .then(r => json(res, r, r.ok ? 200 : 400))
            .catch(e => json(res, { ok: false, error: e.message }, 500));
    });
}

// GET /api/erp/diot?mes=YYYY-MM — DIOT: operaciones con proveedores del mes,
// agrupadas por RFC, con base e IVA acreditable. ?formato=txt baja el archivo
// del SAT (batch pipe-delimitado). Usa la base/IVA EXACTOS del CFDI cuando la CxP
// los tiene (importación XML, 0058); para las CxP capturadas a mano sin CFDI cae
// al cálculo plano al iva_pct configurado. El contador valida antes de enviar.
function diot(req, res, ctx) {
    const { db, json } = ctx;
    const sp = new URL(req.url, 'http://x').searchParams;
    const mes = (sp.get('mes') || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const iva = (parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave='iva_pct'").get()?.valor) || 16) / 100;
    // Agrupa las CxP del mes (por creada_en) por proveedor con RFC. Separa lo que
    // trae base/IVA exactos del CFDI de lo que hay que derivar plano.
    const filas = db.prepare(`
        SELECT pr.rfc, pr.nombre,
               ROUND(SUM(cp.monto),2) total,
               ROUND(SUM(CASE WHEN cp.base IS NOT NULL THEN cp.base ELSE 0 END),2) base_real,
               ROUND(SUM(CASE WHEN cp.iva  IS NOT NULL THEN cp.iva  ELSE 0 END),2) iva_real,
               ROUND(SUM(CASE WHEN cp.base IS NULL THEN cp.monto ELSE 0 END),2) monto_sin_base
        FROM cuentas_pagar cp JOIN proveedores pr ON pr.id=cp.id_proveedor
        WHERE pr.rfc IS NOT NULL AND pr.rfc != '' AND strftime('%Y-%m', cp.creada_en)=?
        GROUP BY pr.rfc ORDER BY total DESC`).all(mes).map(r => {
        const baseFlat = Math.round((r.monto_sin_base / (1 + iva)) * 100) / 100;
        const base = Math.round((r.base_real + baseFlat) * 100) / 100;
        const ivaAcred = Math.round((r.iva_real + (r.monto_sin_base - baseFlat)) * 100) / 100;
        return { rfc: r.rfc, nombre: r.nombre, total: r.total, base, iva_acreditable: ivaAcred };
    });
    if (sp.get('formato') === 'txt') {
        // Formato batch DIOT (simplificado): tipo_tercero(04 nacional)|
        // tipo_operacion(85 otros)|RFC|||valor_actos_16|iva_acreditable_16
        const lineas = filas.map(f => ['04', '85', f.rfc, '', '', String(Math.round(f.base)), String(Math.round(f.iva_acreditable))].join('|'));
        const txt = lineas.join('\r\n') + (lineas.length ? '\r\n' : '');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="DIOT_${String(mes).replace(/[^0-9-]/g, '')}.txt"` });
        return res.end(txt);
    }
    const tot = filas.reduce((s, f) => ({ base: s.base + f.base, iva: s.iva + f.iva_acreditable }), { base: 0, iva: 0 });
    return json(res, { mes, iva_pct: iva * 100, filas, total_base: Math.round(tot.base * 100) / 100, total_iva_acreditable: Math.round(tot.iva * 100) / 100 });
}

// GET /api/erp/contabilidad-electronica?tipo=catalogo|balanza&mes=YYYY-MM
// Genera el XML del SAT (contabilidad electrónica). BORRADOR: el código
// agrupador SAT se mapea con una tabla base de las cuentas estándar; el
// contador debe revisar/ampliar el mapeo antes de enviar al SAT.
const _COD_AGRUPADOR = { // cuenta interna → código agrupador SAT (c_CuentaSAT, Anexo 24)
    '101': '101.01', '102': '102.01', '105': '105.01', '115': '115.01',
    '119': '118.01', '201': '201.01', '208': '208.01', '209': '209.01',
    '210': '216.01', '211': '213.01', '301': '301.01', '401': '401.01',
    '501': '501.01', '601': '601.84',
};
// Fallback por TIPO de cuenta → código agrupador SAT genérico VÁLIDO (no un
// inventado `codigo+.01`). Cubre cuentas custom que el negocio agregue sin
// mapeo explícito; el contador afina el código exacto en el borrador.
const _COD_AGRUPADOR_TIPO = { activo: '100', pasivo: '200', capital: '300', ingreso: '400', costo: '500', gasto: '600' };
function _codAgrupador(codigo, tipo, sinMapear) {
    if (_COD_AGRUPADOR[codigo]) return _COD_AGRUPADOR[codigo];
    if (sinMapear) sinMapear.add(codigo);
    return (_COD_AGRUPADOR_TIPO[tipo] || '600') + '.01'; // genérico por naturaleza
}
const _xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function contabilidadElectronica(req, res, ctx) {
    const { db, json } = ctx;
    const sp = new URL(req.url, 'http://x').searchParams;
    const tipo = sp.get('tipo') === 'balanza' ? 'balanza' : 'catalogo';
    const mes = (sp.get('mes') || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const rfc = db.prepare("SELECT valor FROM configuracion WHERE clave='pac_rfc'").get()?.valor
        || db.prepare("SELECT valor FROM configuracion WHERE clave='rfc'").get()?.valor || 'XAXX010101000';
    const [anio, m] = mes.split('-');
    const sinMapear = new Set();
    let xml;
    if (tipo === 'catalogo') {
        const cuentas = db.prepare('SELECT codigo, nombre, tipo FROM plan_cuentas ORDER BY codigo').all();
        const rows = cuentas.map(c => {
            const cod = _codAgrupador(c.codigo, c.tipo, sinMapear);
            const natur = ['activo', 'costo', 'gasto'].includes(c.tipo) ? 'D' : 'A';
            return `  <catalogocuentas:Ctas CodAgrup="${cod}" NumCta="${_xmlEsc(c.codigo)}" Desc="${_xmlEsc(c.nombre)}" Nivel="1" Natur="${natur}"/>`;
        }).join('\n');
        xml = `<?xml version="1.0" encoding="UTF-8"?>\n<catalogocuentas:Catalogo xmlns:catalogocuentas="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas" Version="1.3" RFC="${_xmlEsc(rfc)}" Mes="${m}" Anio="${anio}">\n${rows}\n</catalogocuentas:Catalogo>`;
    } else {
        // Balanza: saldo final por cuenta del mes (desde el libro mayor acumulado)
        const desde = mes + '-01';
        const hasta = mes + '-31';
        const mayor = conta.libroMayor('1900-01-01', hasta);
        const mayorMes = conta.libroMayor(desde, hasta);
        const _tipoDe = {}; for (const r of db.prepare('SELECT codigo, tipo FROM plan_cuentas').all()) _tipoDe[r.codigo] = r.tipo;
        const rows = mayor.map(c => {
            const cod = _codAgrupador(c.cuenta, _tipoDe[c.cuenta], sinMapear);
            const mm = mayorMes.find(x => x.cuenta === c.cuenta) || { debe: 0, haber: 0 };
            const saldoFin = Math.round((c.debe - c.haber) * 100) / 100;
            const saldoIni = Math.round((saldoFin - (mm.debe - mm.haber)) * 100) / 100;
            return `  <BCE:Ctas NumCta="${_xmlEsc(c.cuenta)}" SaldoIni="${saldoIni.toFixed(2)}" Debe="${(mm.debe || 0).toFixed(2)}" Haber="${(mm.haber || 0).toFixed(2)}" SaldoFin="${saldoFin.toFixed(2)}"/>`;
        }).join('\n');
        xml = `<?xml version="1.0" encoding="UTF-8"?>\n<BCE:Balanza xmlns:BCE="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion" Version="1.3" RFC="${_xmlEsc(rfc)}" Mes="${m}" Anio="${anio}" TipoEnvio="N">\n${rows}\n</BCE:Balanza>`;
    }
    if (sp.get('descargar') === '1') {
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${tipo}_${String(mes).replace(/[^0-9-]/g, '')}.xml"` });
        return res.end(xml);
    }
    const _sin = [...sinMapear];
    return json(res, {
        tipo, mes, rfc, xml,
        sin_mapear: _sin, // cuentas sin código SAT explícito (usaron el genérico por tipo)
        nota: 'Borrador: valida el código agrupador SAT con tu contador antes de enviar.'
            + (_sin.length ? ` ${_sin.length} cuenta(s) sin mapeo explícito usan un código genérico por naturaleza y DEBEN afinarse: ${_sin.join(', ')}.` : ' Todas las cuentas del catálogo tienen código agrupador asignado.'),
    });
}

// POST /api/erp/cfdi/:id/rep — timbra el complemento de pago (factura PPD pagada)
function cfdiREP(req, res, ctx, { params }) {
    const { db, json } = ctx;
    return require('../../services/pacService').timbrarREP(db, parseInt(params[0]))
        .then(r => json(res, r, r.ok ? 200 : 400))
        .catch(e => json(res, { ok: false, error: e.message }, 500));
}

// GET /api/erp/cfdi/:id/:formato — descarga el PDF/XML del CFDI ya timbrado.
function cfdiDescargar(req, res, ctx, { params }) {
    const { db, json } = ctx;
    return require('../../services/pacService').descargarCFDI(db, parseInt(params[0]), params[1])
        .then(r => {
            if (!r.ok) return json(res, r, 400);
            res.writeHead(200, {
                'Content-Type': r.contentType,
                'Content-Disposition': 'attachment; filename="' + r.filename + '"',
                'Content-Length': r.buffer.length,
            });
            res.end(r.buffer);
        })
        .catch(e => json(res, { ok: false, error: e.message }, 500));
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/erp/facturacion-pendiente',     area: 'finanzas', handler: facturacionPendiente },
    { metodo: 'POST', path: /^\/api\/erp\/timbrar\/(\d+)$/,       area: 'finanzas', handler: timbrar },
    { metodo: 'GET',  path: /^\/api\/erp\/cfdi\/(\d+)\/(pdf|xml)$/, area: 'finanzas', handler: cfdiDescargar },
    { metodo: 'POST', path: /^\/api\/erp\/cfdi\/(\d+)\/cancelar$/,  area: 'finanzas', handler: cfdiCancelar },
    { metodo: 'POST', path: /^\/api\/erp\/cfdi\/(\d+)\/rep$/,       area: 'finanzas', handler: cfdiREP },
    { metodo: 'GET',  path: '/api/erp/diot',                      area: 'finanzas', handler: diot },
    { metodo: 'GET',  path: '/api/erp/contabilidad-electronica',  area: 'finanzas', handler: contabilidadElectronica },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/erp/' });
