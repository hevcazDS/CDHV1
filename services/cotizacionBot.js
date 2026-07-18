'use strict';
// cotizacionBot — persiste y consulta las cotizaciones que el bot arma en el chat
// (acción 'cotizar' del motor). Antes eran efímeras; ahora se guardan para que el
// cliente pueda consultarlas ("¿cómo va mi cotización?") y para que, al pagar, se
// marquen 'convertida'. Solo informativas: NUNCA cobran ni crean pedidos (el dinero
// sigue por marcar-pagado). Fail-soft: un error aquí jamás rompe el flujo.
//
// Vigencia: VALIDEZ_DIAS. Folio de referencia = COT-<id> (derivado, sin columna).

const VALIDEZ_DIAS = 7;

// Guarda una cotización y devuelve { id, folio } (o null si falla / sin tel).
function guardar(db, tel, { subtotal = 0, envio = 0, total = 0, n = 0, items = [] } = {}) {
    const telefono = String(tel || '').replace(/@.*$/, '');
    if (!telefono) return null;
    try {
        const r = db.prepare(`INSERT INTO cotizaciones_bot
            (telefono, subtotal, envio, total, n_items, items_json, vence_en)
            VALUES (?,?,?,?,?,?, datetime('now','localtime','+' || ? || ' days'))`)
            .run(telefono, subtotal, envio, total, n, JSON.stringify(items || []), VALIDEZ_DIAS);
        return { id: r.lastInsertRowid, folio: 'COT-' + String(r.lastInsertRowid).padStart(5, '0') };
    } catch (_) { return null; }
}

// Última cotización VIGENTE (no vencida) del cliente, o null. Marca de paso las que
// ya vencieron (mantenimiento perezoso, sin cron).
function ultimaVigente(db, tel) {
    const telefono = String(tel || '').replace(/@.*$/, '');
    if (!telefono) return null;
    try {
        db.prepare("UPDATE cotizaciones_bot SET estatus='vencida' WHERE telefono=? AND estatus='vigente' AND vence_en < datetime('now','localtime')").run(telefono);
        return db.prepare("SELECT * FROM cotizaciones_bot WHERE telefono=? AND estatus='vigente' ORDER BY id DESC LIMIT 1").get(telefono) || null;
    } catch (_) { return null; }
}

// Al pagar: marca la última cotización vigente del cliente como 'convertida'.
function marcarConvertida(db, tel) {
    const telefono = String(tel || '').replace(/@.*$/, '');
    if (!telefono) return false;
    try {
        const c = db.prepare("SELECT id FROM cotizaciones_bot WHERE telefono=? AND estatus='vigente' ORDER BY id DESC LIMIT 1").get(telefono);
        if (!c) return false;
        db.prepare("UPDATE cotizaciones_bot SET estatus='convertida' WHERE id=?").run(c.id);
        return true;
    } catch (_) { return false; }
}

// Detecta la intención "consultar mi cotización" en texto libre (entrada menuFlow).
function esConsulta(raw) {
    return /\b(mi|mis)\s+cotizaci[oó]n\w*\b|\bc[oó]mo\s+va\s+mi\s+cotizaci[oó]n\b|\bestado\s+de\s+mi\s+cotizaci[oó]n\b|\bmi\s+presupuesto\b/i.test(raw || '');
}

// Mensaje de estado de una cotización (o de "no tienes ninguna").
function mensaje(cot) {
    if (!cot) return 'No tengo una cotización guardada a tu nombre. Si quieres una, dime qué {item} te interesa y con gusto te la armo. Escribe *hola* para el menú.';
    const envio = cot.envio === 0 ? 'gratis' : ('$' + Number(cot.envio).toFixed(2));
    const vence = String(cot.vence_en || '').slice(0, 10);
    const folio = 'COT-' + String(cot.id).padStart(5, '0');
    return `🧾 Tu cotización *${folio}* sigue vigente:\n\n` +
        `🛒 ${cot.n_items} artículo${cot.n_items === 1 ? '' : 's'}\n` +
        `Subtotal: *$${Number(cot.subtotal).toFixed(2)}*\n` +
        `Envío: *${envio}*\n` +
        `💰 *Total: $${Number(cot.total).toFixed(2)}*\n\n` +
        (vence ? `_Válida hasta el ${vence}._ ` : '') +
        `Escribe *hola* si quieres continuar tu compra.`;
}

module.exports = { guardar, ultimaVigente, marcarConvertida, esConsulta, mensaje, VALIDEZ_DIAS };
