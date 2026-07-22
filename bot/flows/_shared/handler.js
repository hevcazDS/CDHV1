// ═══════════════════════════════════════════════════════
//  handler.js — helpers finales usados por el router principal
//  (evento de funnel + render del carrito). Extraído mecánicamente de
//  bot/flows/_shared.js, sin cambio de lógica.
// ═══════════════════════════════════════════════════════
const { db, UMBRAL_ENVIO_GRA } = require('./_base');
const { totalCarrito, formatCarrito } = require('./carrito');

// Evento de funnel en log_eventos — nunca truena el flujo si falla
function logEvento(tipo, valor, tel) {
    try {
        db.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES (?,'whatsapp',?,?)")
          .run(tipo, String(valor ?? '').slice(0, 200), tel || null);
    } catch (_) {}
}

function mostrarCarrito(carrito) {
    const _total = totalCarrito(carrito);
    const _falta = UMBRAL_ENVIO_GRA - _total;
    const _hintEnvio = (_falta > 0 && _falta <= 250)
        ? `\n💡 _Te faltan solo $${_falta.toFixed(0)} para *envío gratis*._\n`
        : '';
    return (
        `🛒 *Tu carrito* (${carrito.length} producto${carrito.length>1?'s distintos':''}):\n\n` +
        `${formatCarrito(carrito)}\n` + _hintEnvio + `\n` +
        `¿Qué quieres hacer?\n\n` +
        `1️⃣  🔍 Seguir buscando\n` +
        `2️⃣  ✅ Proceder al pago\n` +
        `3️⃣  🗑️ Vaciar carrito\n\n` +
        `_¿Dudas de algún producto? Escribe *asesor* y te ayudamos._`
    );
}

module.exports = {
    logEvento,
    mostrarCarrito,
};
