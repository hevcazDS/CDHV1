// Link de pago — punto ÚNICO de integración de pasarela (como el hook del
// LLM). Toggleable con `pago_link_activo` desde Prime. Fail-closed.
//
// Prioridad al generar el link:
//   1. Gateway dinámico configurado (STRIPE/MERCADOPAGO/CONEKTA/CLIP env) →
//      _gateway() crea un link por-pedido. HOY stub: es la "puerta abierta".
//   2. `configuracion.pago_url_base` (el link estático que el negocio YA
//      tiene: su Clip/Mercado Pago/PayPal.me) → se envía con la referencia.
//   3. Nada configurado → error claro (no inventa un link falso).
'use strict';
const db = require('../bot/db_connection');

function pagoLinkActivo() {
    try { return db.prepare("SELECT valor FROM configuracion WHERE clave='pago_link_activo'").get()?.valor === '1'; }
    catch (_) { return false; }
}
function _cfg(clave) {
    try { return db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)?.valor || ''; }
    catch (_) { return ''; }
}

const gateway = require('./gatewayService');

// Link estático que el negocio YA tiene (su Clip/MP/PayPal.me), con la referencia.
function _staticBase(referencia) {
    const base = _cfg('pago_url_base').trim();
    if (!base) return null;
    return base.includes('?') ? base + '&ref=' + encodeURIComponent(referencia) : base + '?ref=' + encodeURIComponent(referencia);
}

// SÍNCRONO (usado por el bot en checkout): modo demo o link estático — sin red.
// El gateway REAL (llamada a Stripe/MP) es async: se envía desde el panel.
function generarLink({ idPedido, folio, monto }) {
    const referencia = folio || ('PED-' + idPedido);
    if (gateway.demoActivo(db)) return { url: gateway.linkDemo(referencia).url, referencia, demo: true };
    const est = _staticBase(referencia);
    if (est) return { url: est, referencia };
    if (gateway.estaConfigurado(db)) throw new Error('Pasarela configurada: envía el link desde el panel (Pedidos → enviar link).');
    throw new Error('Configura tu link de pago en Prime > General (o activa el modo demo) antes de enviar links');
}

// ASÍNCRONO (usado por el panel, enviar-link): demo → gateway real → estático.
// Devuelve { url, referencia, demo? } o lanza con mensaje claro. NO marca pagado.
async function generarLinkAsync({ idPedido, folio, monto }) {
    const referencia = folio || ('PED-' + idPedido);
    if (gateway.demoActivo(db)) return { url: gateway.linkDemo(referencia).url, referencia, demo: true };
    if (gateway.estaConfigurado(db)) {
        const r = await gateway.crearLink(db, { monto, concepto: 'Pedido ' + referencia, referencia });
        if (r.ok) return { url: r.url, referencia };
        throw new Error(r.error);
    }
    return generarLink({ idPedido, folio, monto }); // estático o error claro
}

module.exports = { pagoLinkActivo, generarLink, generarLinkAsync };
