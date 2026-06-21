// mensajeService.js
// Registro de mensajes de WhatsApp en conversaciones/mensajes, para que el
// dashboard pueda mostrarle a un humano el hilo real antes de responder.
// Recibe `db` por parámetro (no lo requiere internamente) para poder usarse
// tanto desde el bot como desde el dashboard sin acoplarse a cuál de los
// dos procesos lo llama, y para no interferir con el mock de DB de los tests.

'use strict';

// Bootstrap idempotente de la columna `outcome` en `conversaciones` — la
// tabla en sí no se crea aquí (vive en las migraciones ya corridas contra
// producción), solo se agrega la columna si falta. outcome resume en qué
// terminó la conversación ('venta'|'escalacion'|'queja'|'abandono') para no
// tener que reconciliar pedidos.estatus + conversaciones.estatus +
// log_eventos.tipo_evento cada vez que se quiera armar un dataset etiquetado.
// No se marca "ya revisado" hasta confirmar que la tabla existe y tiene la
// columna — si se marcara antes de eso, una tabla creada después (instalador
// que arma la BD en el primer arranque, tests con :memory:) se quedaría sin
// la columna para siempre, ya que esta función nunca volvería a intentarlo.
let _outcomeColOk = false;
function _asegurarColumnaOutcome(db) {
    if (_outcomeColOk) return;
    try {
        const cols = db.prepare("PRAGMA table_info(conversaciones)").all();
        if (!cols.length) return; // tabla no existe todavía — reintentar en la próxima llamada
        if (!cols.some(c => c.name === 'outcome')) {
            db.prepare('ALTER TABLE conversaciones ADD COLUMN outcome TEXT').run();
        }
        _outcomeColOk = true;
    } catch (_) { /* error de BD — reintentar en la próxima llamada */ }
}

// outcome: 'venta' | 'escalacion' | 'queja' | 'abandono'. Se aplica sobre la
// conversación más reciente de ese teléfono, sin importar su estatus actual.
function marcarOutcome(db, telefono, outcome) {
    if (!telefono) return;
    _asegurarColumnaOutcome(db);
    try {
        const conv = db.prepare(
            `SELECT id FROM conversaciones WHERE telefono=? ORDER BY iniciada_en DESC LIMIT 1`
        ).get(telefono);
        if (conv) db.prepare(`UPDATE conversaciones SET outcome=? WHERE id=?`).run(outcome, conv.id);
    } catch (_) { /* contexto, no crítico */ }
}

function obtenerOCrearConversacion(db, telefono, idCliente) {
    _asegurarColumnaOutcome(db);
    const conv = db.prepare(
        `SELECT id FROM conversaciones WHERE telefono=? AND estatus IN ('activa','escalada') ORDER BY iniciada_en DESC LIMIT 1`
    ).get(telefono);
    if (conv) return conv.id;
    const info = db.prepare(
        `INSERT INTO conversaciones (id_cliente, telefono, canal, estatus) VALUES (?,?,'whatsapp','activa')`
    ).run(idCliente || null, telefono);
    return info.lastInsertRowid;
}

// rol: 'cliente' | 'bot' | 'asesor'. pasoActual (opcional): paso_actual de
// la sesión del bot al momento del mensaje, para detectar en qué punto del
// flujo se queda una conversación (métricas de funnel/abandono). Nunca debe
// tumbar el envío/recepción real de WhatsApp, por eso se traga cualquier
// error de DB.
function registrarMensaje(db, telefono, rol, contenido, pasoActual) {
    if (!telefono || !contenido) return;
    try {
        const cli = db.prepare('SELECT id FROM clientes WHERE telefono=?').get(telefono);
        const idConv = obtenerOCrearConversacion(db, telefono, cli ? cli.id : null);
        db.prepare(
            `INSERT INTO mensajes (id_conversacion, rol, contenido, enviado_en) VALUES (?,?,?,datetime('now','localtime'))`
        ).run(idConv, rol, contenido);
        if (pasoActual) {
            db.prepare(`UPDATE conversaciones SET ultimo_paso=? WHERE id=?`).run(pasoActual, idConv);
        }
    } catch (_) { /* el hilo de conversación es contexto, no crítico */ }
}

module.exports = { registrarMensaje, obtenerOCrearConversacion, marcarOutcome };
