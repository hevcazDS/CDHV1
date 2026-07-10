'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cb = require('./cryptoBackup');

// ── Cifrado at-rest de los secretos del PAC (TOGGLEABLE) ────────────────────
// pac_cifrado_activo (default ON) cifra password/.cer/.key/csd_pass con una
// clave derivada del secreto de instancia (transparente, sin maestra) —
// equivalente al modo 'bajo' de los respaldos. Cliente que NO quiera tanta
// seguridad lo apaga y se guardan en claro. Lectura tolerante: detecta el
// prefijo 'enc:' por valor, así conviven claros y cifrados (y cambiar el
// toggle no rompe lo ya guardado).
function _instSecret() {
    const p = path.join(__dirname, '..', 'dashboard', '.instancia_secret');
    try { return fs.readFileSync(p, 'utf8').trim(); }
    catch (_) {
        try { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(p, s, { mode: 0o600 }); return s; }
        catch (_) { return null; }
    }
}
function _key() { const s = _instSecret(); return s ? crypto.createHash('sha256').update(s).digest() : null; }
function cifrarSecreto(texto) {
    const k = _key(); if (!k || texto == null || texto === '') return String(texto ?? '');
    try { return 'enc:' + cb.cifrar(Buffer.from(String(texto), 'utf8'), k).toString('base64'); } catch (_) { return String(texto); }
}
function descifrarSecreto(v) {
    if (typeof v !== 'string' || !v.startsWith('enc:')) return v; // claro / legacy
    const k = _key(); if (!k) return '';
    try { return cb.descifrar(Buffer.from(v.slice(4), 'base64'), k).toString('utf8'); } catch (_) { return ''; }
}

// ── PUNTO ÚNICO de integración con el PAC (timbrado CFDI 4.0) ───────────────
// Hoy está INERTE: timbrar() devuelve { ok:false, pendiente:true } hasta que se
// complete la integración con el proveedor elegido (Facturama / Finkok /
// Interfactura / etc.). Se diseñó como los otros huecos (llmHandler,
// pagoLinkService): fail-closed y doble-gate, para que solo falte "rellenar".
//
// Cómo queda ARMADO para completarlo:
//   1. Prime configura credenciales en Prime > General → /api/prime/pac
//      (se guardan en `configuracion`: pac_proveedor, pac_rfc, pac_ambiente,
//       pac_usuario, pac_password, pac_csd_cer, pac_csd_key, pac_csd_pass,
//       pac_serie). Sensibles: cer/key/passwords no se devuelven en el GET.
//   2. Activar el módulo `facturacion_activo`.
//   3. En timbrar(): armar el CFDI 4.0 (emisor RFC + CSD, receptor razon_social
//      /rfc del pedido, conceptos desde pedido_detalle, IVA), llamar al SDK/API
//      del PAC según pac_proveedor, y guardar el UUID en pedidos.cfdi_uuid
//      (+ cfdi_estatus='timbrado'). El PDF/XML se puede adjuntar al correo.
//
// Doble-gate: módulo facturacion_activo ON **y** credenciales completas.

function _cfg(db, clave, fb = '') { try { return db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)?.valor ?? fb; } catch (_) { return fb; } }

function cifradoActivo(db) { return _cfg(db, 'pac_cifrado_activo', '1') === '1'; } // default ON
// Lee un secreto ya descifrado (para cuando se complete el timbrado real).
function secreto(db, clave) { return descifrarSecreto(_cfg(db, clave)); }

// ¿Están cargadas las credenciales mínimas para timbrar?
function estaConfigurado(db) {
    return !!(_cfg(db, 'pac_proveedor') && _cfg(db, 'pac_rfc') && _cfg(db, 'pac_usuario')
        && _cfg(db, 'pac_csd_cer') && _cfg(db, 'pac_csd_key'));
}

// ¿Se puede timbrar? (módulo + credenciales)
function activo(db) {
    return _cfg(db, 'facturacion_activo') === '1' && estaConfigurado(db);
}

// Timbra un pedido → CFDI. INERTE hasta completar la integración del PAC.
async function timbrar(db, idPedido) {
    if (_cfg(db, 'facturacion_activo') !== '1') return { ok: false, pendiente: true, motivo: 'Activa el módulo Facturación en Módulos' };
    if (!estaConfigurado(db)) return { ok: false, pendiente: true, motivo: 'Configura las credenciales del PAC en Prime > General' };
    // TODO: integración real con el PAC (pac_proveedor / pac_ambiente). Al
    // completar, guardar: UPDATE pedidos SET cfdi_uuid=?, cfdi_estatus='timbrado'.
    return { ok: false, pendiente: true, motivo: 'Credenciales del PAC guardadas; falta conectar el proveedor (integración pendiente).', proveedor: _cfg(db, 'pac_proveedor'), ambiente: _cfg(db, 'pac_ambiente', 'sandbox') };
}

module.exports = { estaConfigurado, activo, timbrar, cifrarSecreto, descifrarSecreto, cifradoActivo, secreto };
