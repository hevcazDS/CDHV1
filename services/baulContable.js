'use strict';
// baulContable.js — F5.4: archivero fiscal. Guarda los CFDI que devuelve el PAC
// en carpetas locales por mes (contabilidad/cfdi/<YYYY-MM>/) y permite exportar
// el mes por lote (.zip) para el contador. Reusa pacService.descargarCFDI para
// bajar el XML del PAC y zipService (nativo) para el paquete. Módulo
// baul_contable_activo; fail-closed (nunca tumba el timbrado si el archivo falla).
const fs = require('fs');
const path = require('path');

function activo(db) { try { return db.prepare("SELECT valor FROM configuracion WHERE clave='baul_contable_activo'").get()?.valor === '1'; } catch (_) { return false; } }
function _root() { return path.join(__dirname, '..', 'contabilidad', 'cfdi'); }
function _dirMes(mes) { return path.join(_root(), String(mes).slice(0, 7)); }
function _slug(s) { return String(s || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60); }

// Guarda el XML (y PDF best-effort) de un pedido timbrado en la carpeta del mes.
// Best-effort: si falla la descarga o el disco, no lanza (el timbrado ya ocurrió).
async function archivar(db, idPedido) {
    try {
        if (!activo(db)) return { ok: false, motivo: 'modulo_off' };
        const ped = db.prepare("SELECT folio, cfdi_uuid, creado_en FROM pedidos WHERE id_pedido=?").get(idPedido);
        if (!ped?.cfdi_uuid) return { ok: false, motivo: 'sin_uuid' };
        const mes = (ped.creado_en || new Date().toISOString()).slice(0, 7);
        const dir = _dirMes(mes);
        fs.mkdirSync(dir, { recursive: true });
        const pac = require('./pacService');
        const base = _slug(ped.folio || idPedido) + '_' + _slug(ped.cfdi_uuid);
        const rx = await pac.descargarCFDI(db, idPedido, 'xml');
        if (rx.ok && rx.buffer) fs.writeFileSync(path.join(dir, base + '.xml'), rx.buffer);
        // PDF opcional (no bloquea): algunos no lo quieren, lo bajamos igual.
        try { const rp = await pac.descargarCFDI(db, idPedido, 'pdf'); if (rp.ok && rp.buffer) fs.writeFileSync(path.join(dir, base + '.pdf'), rp.buffer); } catch (_) {}
        return { ok: true, ruta: path.join(mes, base + '.xml') };
    } catch (_) { return { ok: false, motivo: 'error' }; }
}

// Lista los CFDI timbrados del mes (desde la BD) + si ya están archivados en disco.
function listar(db, mes) {
    const m = String(mes || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const dir = _dirMes(m);
    let enDisco = new Set();
    try { enDisco = new Set(fs.readdirSync(dir)); } catch (_) {}
    const rows = db.prepare(`
        SELECT id_pedido, folio, cfdi_uuid, rfc, razon_social, total, creado_en, cfdi_estatus
        FROM pedidos WHERE cfdi_uuid IS NOT NULL AND cfdi_uuid != '' AND strftime('%Y-%m', creado_en)=?
        ORDER BY creado_en DESC`).all(m);
    const items = rows.map(r => ({ ...r, archivado: enDisco.has(_slug(r.folio || r.id_pedido) + '_' + _slug(r.cfdi_uuid) + '.xml') }));
    const r2 = n => Math.round(n * 100) / 100;
    return { mes: m, total: items.length, monto: r2(items.reduce((s, x) => s + (x.total || 0), 0)), archivados: items.filter(i => i.archivado).length, items };
}

// Arma el .zip del mes con los XML (baja del PAC los que falten en disco).
async function exportarZip(db, mes) {
    const m = String(mes || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const dir = _dirMes(m);
    const rows = db.prepare(`SELECT id_pedido, folio, cfdi_uuid FROM pedidos WHERE cfdi_uuid IS NOT NULL AND cfdi_uuid != '' AND strftime('%Y-%m', creado_en)=?`).all(m);
    const pac = require('./pacService');
    const archivos = [];
    for (const r of rows) {
        const base = _slug(r.folio || r.id_pedido) + '_' + _slug(r.cfdi_uuid);
        const local = path.join(dir, base + '.xml');
        let contenido = null;
        try { contenido = fs.readFileSync(local); } catch (_) {}
        if (!contenido) { try { const rx = await pac.descargarCFDI(db, r.id_pedido, 'xml'); if (rx.ok && rx.buffer) { contenido = rx.buffer; try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(local, contenido); } catch (_) {} } } catch (_) {} }
        if (contenido) archivos.push({ nombre: base + '.xml', contenido });
    }
    if (!archivos.length) return { ok: false, error: 'No hay CFDI timbrados para ' + m };
    const { crearZip } = require('./zipService');
    return { ok: true, zip: crearZip(archivos), nombre: 'CFDI_' + String(m).replace(/[^0-9-]/g, '') + '.zip', count: archivos.length };
}

module.exports = { activo, archivar, listar, exportarZip };
