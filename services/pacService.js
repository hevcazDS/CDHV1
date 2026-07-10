'use strict';
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

module.exports = { estaConfigurado, activo, timbrar };
