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

// Enganche del gateway real. Cuando el cliente contrate Stripe/MP/Conekta/
// Clip y ponga sus credenciales (env), aquí se crea el link por-pedido.
function _gateway(pedido) {
    const proveedor = process.env.PAGO_GATEWAY; // 'stripe' | 'mercadopago' | 'conekta' | 'clip'
    const key = process.env.PAGO_GATEWAY_KEY;
    if (!proveedor || !key) return null; // sin credenciales → no hay gateway dinámico
    // TODO: llamada real a la API del proveedor con { monto, folio, referencia }.
    throw new Error('PAGO_GATEWAY=' + proveedor + ' configurado pero la integración real aún no está implementada');
}

// Genera (o reusa) el link de pago de un pedido. Devuelve { url, referencia }
// o lanza con un mensaje claro. NO marca nada como pagado — el cobro real se
// confirma en el chokepoint marcar-pagado, igual que hoy.
function generarLink({ idPedido, folio, monto }) {
    const referencia = folio || ('PED-' + idPedido);
    const dinamico = _gateway({ idPedido, folio, monto });
    let url;
    if (dinamico) {
        url = dinamico;
    } else {
        const base = _cfg('pago_url_base').trim();
        if (!base) throw new Error('Configura tu link de pago en Prime > General (o un gateway) antes de enviar links');
        // Anexar la referencia si el link lo admite (query), si no, va en el mensaje.
        url = base.includes('?') ? base + '&ref=' + encodeURIComponent(referencia) : base + '?ref=' + encodeURIComponent(referencia);
    }
    return { url, referencia };
}

module.exports = { pagoLinkActivo, generarLink };
