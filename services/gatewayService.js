'use strict';
// gatewayService.js — orquesta la pasarela de pago key-only (Ola 4 item 11).
// Doble-gate y fail-closed, igual que el PAC (pacService): módulo pago_link_activo
// ON **y** (credenciales completas **o** modo demo). El secreto se cifra at-rest
// con el mismo patrón del PAC (secreto de instancia, prefijo 'enc:').
//
// MODO DEMO (pago_demo=1): para presentarle el sistema a un cliente sin contratar
// aún la pasarela — NO llama a ningún proveedor, devuelve un link simulado con la
// referencia real y el envío del link ocurre normal (cola_notificaciones). Así la
// demostración "se ve real" sin cobrar nada de verdad. El pago se confirma a mano
// (marcar-pagado), como cualquier link.
const providers = require('./gatewayProviders');
// Cifrado at-rest: implementación canónica en services/secretos.js (antes
// estaba duplicada aquí y en pacService).
const { cifrarSecreto, descifrarSecreto } = require('./secretos');

function _cfg(db, clave, fb = '') { try { return db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)?.valor ?? fb; } catch (_) { return fb; } }
function proveedor(db) { return _cfg(db, 'pago_proveedor'); }
function demoActivo(db) { return _cfg(db, 'pago_demo') === '1'; }
function apiKey(db) { return descifrarSecreto(_cfg(db, 'pago_api_key')); }
// ¿Hay credenciales reales? (proveedor soportado + api_key)
function estaConfigurado(db) { return !!(providers.get(proveedor(db)) && apiKey(db)); }
// ¿Se puede generar un link? (real configurado o demo). El módulo pago_link_activo
// lo valida el llamador (pagoLinkService.pagoLinkActivo).
function disponible(db) { return estaConfigurado(db) || demoActivo(db); }

// Link simulado para la demo — plausible, con la referencia real, sin red.
function linkDemo(referencia) {
    return { ok: true, url: 'https://pago-demo.hevcaz.mx/link/' + encodeURIComponent(referencia), demo: true };
}

// Crea el link REAL (async, llama al proveedor) o el DEMO (sync-friendly).
// Devuelve { ok, url, id?, demo?, error? }. NO marca nada pagado.
async function crearLink(db, { monto, concepto, referencia }) {
    if (demoActivo(db)) return linkDemo(referencia);
    const prov = providers.get(proveedor(db));
    if (!prov) return { ok: false, error: 'Configura una pasarela (Stripe/Mercado Pago) o activa el modo demo en Prime > General' };
    const key = apiKey(db);
    if (!key) return { ok: false, error: 'Falta la llave (API key) de la pasarela' };
    try {
        return await prov.crearLink({ api_key: key, ambiente: _cfg(db, 'pago_ambiente', 'live'), return_url: _cfg(db, 'pago_return_url') }, { monto, concepto, referencia });
    } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { cifrarSecreto, descifrarSecreto, proveedor, demoActivo, estaConfigurado, disponible, linkDemo, crearLink, apiKey };
