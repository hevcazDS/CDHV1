'use strict';
// documentos.js — F5.2: cotizaciones, pagarés y contratos con plantillas
// estándar + plantilla propia por sucursal. Render = reemplazo de {{placeholders}}
// ({{n}} = salto de línea). El documento guarda su contenido inmutable para
// reimprimir. Módulo documentos_activo. Sin dependencias.
const construirModulo = require('./_construirModulo');
const { flagActivo } = require('../../services/configFlags');
const { sucursalDeSesion } = require('../../services/sucursalService');

const activo = (db) => flagActivo(db, 'documentos_activo');
const TIPOS = ['cotizacion', 'pagare', 'contrato'];

// Plantillas estándar (sucursal NULL). Se siembran si faltan (sin drift de schema).
const _PLANTILLAS_STD = [
    { tipo: 'cotizacion', nombre: 'Cotización estándar', cuerpo: 'COTIZACIÓN{{n}}{{negocio}} — {{sucursal}}{{n}}Fecha: {{fecha}}{{n}}{{n}}Cliente: {{contraparte}}{{n}}Referencia: {{ref}}{{n}}{{n}}Concepto: {{concepto}}{{n}}Total: {{monto}}{{n}}{{n}}Vigencia: 15 días. Precios en MXN. No es comprobante fiscal.' },
    { tipo: 'pagare', nombre: 'Pagaré estándar', cuerpo: 'PAGARÉ{{n}}{{negocio}} — {{sucursal}}{{n}}Fecha: {{fecha}}{{n}}{{n}}Debo y pagaré incondicionalmente a la orden de {{negocio}} la cantidad de {{monto}} ({{monto_letra}}).{{n}}{{n}}Deudor: {{contraparte}}{{n}}Referencia: {{ref}}{{n}}Concepto: {{concepto}}{{n}}{{n}}Este pagaré causa intereses moratorios en caso de incumplimiento.{{n}}{{n}}_______________________{{n}}Firma del deudor' },
    { tipo: 'contrato', nombre: 'Contrato de servicio estándar', cuerpo: 'CONTRATO DE PRESTACIÓN DE SERVICIOS{{n}}{{negocio}} — {{sucursal}}{{n}}Fecha: {{fecha}}{{n}}{{n}}Entre {{negocio}} y {{contraparte}} ({{ref}}).{{n}}{{n}}Objeto: {{concepto}}{{n}}Contraprestación: {{monto}}{{n}}{{n}}Ambas partes aceptan los términos aquí descritos.{{n}}{{n}}_______________________       _______________________{{n}}{{negocio}}                         {{contraparte}}' },
];
function _seedSiVacio(db) {
    try {
        if (db.prepare('SELECT 1 FROM plantillas_documento WHERE sucursal IS NULL LIMIT 1').get()) return;
        const ins = db.prepare('INSERT INTO plantillas_documento (tipo, nombre, cuerpo, sucursal) VALUES (?,?,?,NULL)');
        for (const p of _PLANTILLAS_STD) ins.run(p.tipo, p.nombre, p.cuerpo);
    } catch (_) {}
}

// Número a letras (pesos MXN) — compacto, cubre hasta millones.
function numeroALetras(n) {
    n = Math.round(Number(n) * 100) / 100;
    const ent = Math.floor(n), cent = Math.round((n - ent) * 100);
    const U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];
    const D = ['', '', 'veinti', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
    function centenas(x) {
        if (x === 0) return '';
        if (x === 100) return 'cien';
        let s = C[Math.floor(x / 100)];
        const d = x % 100;
        if (d) { s += (s ? ' ' : ''); if (d <= 20) s += U[d]; else { const dd = Math.floor(d / 10), uu = d % 10; s += (dd === 2 ? 'veinti' + (uu ? U[uu] : '') : D[dd] + (uu ? ' y ' + U[uu] : '')); } }
        return s.trim();
    }
    function seccion(x) {
        if (x === 0) return '';
        const millones = Math.floor(x / 1000000), miles = Math.floor((x % 1000000) / 1000), resto = x % 1000;
        let s = '';
        if (millones) s += (millones === 1 ? 'un millón' : centenas(millones) + ' millones') + ' ';
        if (miles) s += (miles === 1 ? 'mil' : centenas(miles) + ' mil') + ' ';
        if (resto) s += centenas(resto);
        return s.trim();
    }
    const letras = ent === 0 ? 'cero' : seccion(ent);
    return (letras.charAt(0).toUpperCase() + letras.slice(1)) + ' pesos ' + String(cent).padStart(2, '0') + '/100 M.N.';
}

function render(cuerpo, vars) {
    let s = String(cuerpo || '');
    for (const [k, v] of Object.entries(vars)) s = s.split('{{' + k + '}}').join(v == null ? '' : String(v));
    return s.split('{{n}}').join('\n');
}

function _cfg(db, k) { try { return db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(k)?.valor || ''; } catch (_) { return ''; } }

// ── Plantillas ──
function plantillasGet(req, res, ctx, { ses }) {
    const { db, json } = ctx;
    if (!activo(db)) return json(res, { ok: false, error: 'Módulo de documentos desactivado' }, 403);
    _seedSiVacio(db);
    const tipo = new URL(req.url, 'http://x').searchParams.get('tipo');
    const suc = sucursalDeSesion(db, ses);
    // estándar (NULL) + las de la sucursal de la sesión
    const rows = db.prepare(`SELECT id, tipo, nombre, cuerpo, sucursal FROM plantillas_documento
        WHERE (sucursal IS NULL OR sucursal=?) ${tipo ? 'AND tipo=?' : ''} ORDER BY tipo, sucursal IS NOT NULL, nombre`)
        .all(...(tipo ? [suc || '', tipo] : [suc || '']));
    return json(res, { ok: true, plantillas: rows });
}
function plantillaPost(req, res, ctx, { ses }) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, d => {
        if (!TIPOS.includes(d.tipo)) return json(res, { ok: false, error: 'Tipo inválido' }, 400);
        if (!String(d.nombre || '').trim() || !String(d.cuerpo || '').trim()) return json(res, { ok: false, error: 'Falta nombre o cuerpo' }, 400);
        const suc = sucursalDeSesion(db, ses) || null;   // la plantilla propia es de la sucursal de la sesión
        if (d.id) {
            db.prepare('UPDATE plantillas_documento SET nombre=?, cuerpo=? WHERE id=? AND sucursal IS NOT NULL').run(String(d.nombre).trim(), String(d.cuerpo), parseInt(d.id));
            return json(res, { ok: true, id: parseInt(d.id) });
        }
        const r = db.prepare('INSERT INTO plantillas_documento (tipo, nombre, cuerpo, sucursal, creado_por) VALUES (?,?,?,?,?)').run(d.tipo, String(d.nombre).trim(), String(d.cuerpo), suc, ses.username || null);
        return json(res, { ok: true, id: r.lastInsertRowid });
    });
}

// ── Documentos ──
function documentosGet(req, res, ctx) {
    const { db, json } = ctx;
    if (!activo(db)) return json(res, { ok: false, error: 'Módulo de documentos desactivado' }, 403);
    const tipo = new URL(req.url, 'http://x').searchParams.get('tipo');
    const rows = db.prepare(`SELECT id, tipo, contraparte_nombre, contraparte_ref, monto, estatus, folio, creado_en
        FROM documentos ${tipo ? 'WHERE tipo=?' : ''} ORDER BY id DESC LIMIT 300`).all(...(tipo ? [tipo] : []));
    return json(res, { ok: true, documentos: rows });
}
function documentoGet(req, res, ctx, { params }) {
    const { db, json } = ctx;
    const doc = db.prepare('SELECT * FROM documentos WHERE id=?').get(parseInt(params[0]));
    if (!doc) return json(res, { ok: false, error: 'Documento no encontrado' }, 404);
    return json(res, { ok: true, documento: doc });
}
function documentoPost(req, res, ctx, { ses }) {
    const { db, json, readJson } = ctx;
    if (!activo(db)) return json(res, { ok: false, error: 'Módulo de documentos desactivado' }, 403);
    return readJson(req, res, d => {
        if (!TIPOS.includes(d.tipo)) return json(res, { ok: false, error: 'Tipo inválido' }, 400);
        const pl = db.prepare('SELECT * FROM plantillas_documento WHERE id=?').get(parseInt(d.id_plantilla));
        if (!pl) return json(res, { ok: false, error: 'Elige una plantilla' }, 400);
        const suc = sucursalDeSesion(db, ses) || '';
        const monto = Number(d.monto) || 0;
        const vars = {
            negocio: _cfg(db, 'nombre_negocio') || 'Mi negocio',
            sucursal: suc || 'Matriz',
            fecha: new Date().toLocaleDateString('es-MX'),
            contraparte: String(d.contraparte_nombre || '').trim(),
            ref: String(d.contraparte_ref || '').trim(),
            concepto: String(d.concepto || '').trim(),
            monto: '$' + monto.toFixed(2) + ' MXN',
            monto_letra: numeroALetras(monto),
        };
        const contenido = render(pl.cuerpo, vars);
        const folio = 'DOC-' + Date.now().toString(36).toUpperCase();
        const r = db.prepare(`INSERT INTO documentos (tipo, id_plantilla, contraparte_tipo, contraparte_nombre, contraparte_ref, monto, contenido, estatus, folio, id_pedido, sucursal, creado_por)
            VALUES (?,?,?,?,?,?,?, 'emitido', ?, ?, ?, ?)`).run(
            d.tipo, pl.id, String(d.contraparte_tipo || 'cliente'), vars.contraparte, vars.ref, monto, contenido, folio, d.id_pedido || null, suc || null, ses.username || null);
        return json(res, { ok: true, id: r.lastInsertRowid, folio, contenido });
    });
}
function documentoPut(req, res, ctx, { params }) {
    const { db, json, readJson } = ctx;
    return readJson(req, res, d => {
        const id = parseInt(params[0]);
        const est = d.estatus;
        if (!['borrador', 'emitido', 'firmado', 'cancelado'].includes(est)) return json(res, { ok: false, error: 'Estatus inválido' }, 400);
        db.prepare('UPDATE documentos SET estatus=? WHERE id=?').run(est, id);
        return json(res, { ok: true, id, estatus: est });
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/documentos/plantillas',       area: 'operacion', handler: plantillasGet },
    { metodo: 'POST', path: '/api/documentos/plantillas',       roles: ['gerente'], handler: plantillaPost },
    { metodo: 'GET',  path: '/api/documentos',                  area: 'operacion', handler: documentosGet },
    { metodo: 'POST', path: '/api/documentos',                  area: 'operacion', handler: documentoPost },
    { metodo: 'GET',  path: /^\/api\/documentos\/(\d+)$/,       area: 'operacion', handler: documentoGet },
    { metodo: 'PUT',  path: /^\/api\/documentos\/(\d+)$/,       area: 'operacion', handler: documentoPut },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/documentos' });
module.exports.numeroALetras = numeroALetras; // export para test
