// ═══════════════════════════════════════════════════════
//  pagos.js — instrucciones de pago (multi-método) y selección interactiva
//  de método. Extraído mecánicamente de bot/flows/_shared.js, sin cambio
//  de lógica.
// ═══════════════════════════════════════════════════════
const { db, moduloActivo, log } = require('./_base');

// ═══════════════════════════════════════════════════════
//  INSTRUCCIONES DE PAGO (multi-método, gateado)
// ═══════════════════════════════════════════════════════
// Cuando pago_multimetodo_activo está OFF (default), el call site usa el texto
// histórico de link y este helper no se invoca → Julio Cepeda no cambia.
// Cuando está ON, arma el bloque con los métodos activos de `metodos_pago`:
// los de requiere_link=1 muestran el link; transferencia muestra la CLABE
// (guardada en metodos_pago.configuracion JSON); efectivo = contra entrega.
function instruccionesPagoMulti(linkUrl) {
    let metodos = [];
    try { metodos = db.prepare('SELECT nombre, requiere_link, configuracion FROM metodos_pago WHERE activo=1 ORDER BY id').all(); }
    catch (_) { metodos = []; }
    if (!metodos.length) return '💳 *Paga aquí _(link válido 48 hrs)_:*\n' + linkUrl;

    const cap = s => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
    const lineas = ['💳 *Opciones de pago:*'];
    let n = 1;
    for (const m of metodos) {
        if (m.requiere_link) {
            lineas.push(`${n++}. ${cap(m.nombre)} — paga en línea _(link válido 48 hrs)_:\n${linkUrl}`);
        } else if (m.nombre === 'transferencia') {
            let clabe = '';
            try { clabe = (JSON.parse(m.configuracion || '{}').clabe) || ''; } catch (_) {}
            lineas.push(`${n++}. Transferencia${clabe ? ` a CLABE *${clabe}*` : ''} — envía tu comprobante por aquí.`);
        } else if (m.nombre === 'efectivo') {
            lineas.push(`${n++}. Efectivo — pago contra entrega / al recoger.`);
        } else if (m.nombre === 'oxxo') {
            lineas.push(`${n++}. Pago en OXXO — pídenos la referencia.`);
        } else {
            lineas.push(`${n++}. ${cap(m.nombre)}`);
        }
    }
    return lineas.join('\n');
}

// Devuelve el bloque de pago correcto según el flag: histórico (solo link) o
// multi-método. `etiqueta` permite respetar el texto exacto de cada call site
// cuando el flag está OFF (Julio Cepeda no cambia ni una palabra).
function bloquePago(linkUrl, etiquetaOff) {
    if (moduloActivo('pago_multimetodo_activo')) return instruccionesPagoMulti(linkUrl);
    return etiquetaOff;
}

// ── Selección INTERACTIVA de método de pago (modular) ──────────────────
// Cuando pago_multimetodo_activo está ON y hay 2+ métodos activos, el bot le
// pregunta al cliente cómo va a pagar (en vez de solo mostrar el link). Para
// contra entrega: efectivo o tarjeta (terminal). Modular: solo aparecen los
// métodos que el negocio prendió en `metodos_pago`.
function pagoMetodosActivos() {
    try { return db.prepare('SELECT nombre, requiere_link, configuracion FROM metodos_pago WHERE activo=1 ORDER BY id').all(); }
    catch (_) { return []; }
}
const _PAGO_LABEL = {
    efectivo:      'Efectivo (pagas al recibir o recoger)',
    tarjeta:       'Tarjeta al recibir (terminal)',
    transferencia: 'Transferencia bancaria',
    paypal:        'Pago en línea (PayPal)',
    mercadopago:   'Pago en línea (Mercado Pago)',
    oxxo:          'Pago en OXXO',
};
function _pagoLabel(nombre) {
    return _PAGO_LABEL[nombre] || (nombre.charAt(0).toUpperCase() + nombre.slice(1));
}
function menuPago(metodos) {
    const lineas = metodos.map((m, i) => (i + 1) + ') ' + _pagoLabel(m.nombre));
    return '💳 *¿Cómo vas a pagar?*\n\n' + lineas.join('\n') + '\n\n_Responde con el número._';
}
// Instrucción concreta una vez elegido el método. `pedidos` = [{folio,linkUrl}]
function instruccionPago(metodoRow, pedidos) {
    const nombre = metodoRow.nombre;
    const links = (pedidos || []).map(p => p.linkUrl).filter(Boolean);
    if (metodoRow.requiere_link) {
        return '💳 *Paga en línea* _(link válido 48 hrs)_:\n' + (links.join('\n') || '(link no disponible)');
    }
    if (nombre === 'transferencia') {
        let clabe = ''; try { clabe = (JSON.parse(metodoRow.configuracion || '{}').clabe) || ''; } catch (_) {}
        return '🏦 *Transferencia*' + (clabe ? (' a CLABE *' + clabe + '*') : '') + ' — envía tu comprobante por aquí cuando la realices.';
    }
    if (nombre === 'efectivo') return '💵 Pagas en *efectivo* al recibir o recoger tu pedido.';
    if (nombre === 'tarjeta')  return '💳 Pagas con *tarjeta* al recibir — nuestro repartidor lleva terminal.';
    if (nombre === 'oxxo')     return '🏪 Pago en *OXXO* — escríbenos y te damos la referencia.';
    return 'Forma de pago registrada: ' + _pagoLabel(nombre);
}
// Registra el método elegido en cada pedido (por folio) — no rompe si falla.
function registrarMetodoPago(pedidos, nombreMetodo) {
    for (const ped of (pedidos || [])) {
        try { db.prepare('UPDATE pedidos SET metodo_pago=? WHERE folio=?').run(nombreMetodo, ped.folio); }
        catch (e) { log.debug('No se pudo registrar metodo_pago: ' + e.message); }
    }
}
// ¿Debe el bot pedir al cliente que elija método? (ON + 2+ métodos activos)
function debePreguntarMetodoPago() {
    return moduloActivo('pago_multimetodo_activo') && pagoMetodosActivos().length > 1;
}

module.exports = {
    instruccionesPagoMulti,
    bloquePago,
    pagoMetodosActivos,
    menuPago,
    instruccionPago,
    registrarMetodoPago,
    debePreguntarMetodoPago,
};
