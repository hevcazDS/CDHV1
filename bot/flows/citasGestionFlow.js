// citasGestionFlow — reagendar / cancelar una cita por WhatsApp (P0-b de
// AUDITORIA_BOT_CRM.md). Antes citasFlow mandaba todo a "escribe asesor"; ahora el
// cliente cancela o mueve su cita SOLO, sin saturar la cola de atención ni dejar
// slots muertos. Reusa slotsLibres/diasDisponibles de citasFlow. Gated por
// citas_activo → Julio Cepeda (sin citas) byte-idéntico. Se registra por giro en
// giroFlows.js junto a citasFlow.
'use strict';
const db = require('../db_connection');
const sessionManager = require('../sessionManager');
const { S, moduloActivo, logEvento } = require('./_shared');
const citas = require('./citasFlow');
const log = require('../logger')('citas');

const STEPS = [S.CITA_GESTION, S.CITA_REAG_FECHA, S.CITA_REAG_HORA];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function _labelFecha(iso) {
    const d = new Date(iso + 'T12:00:00');
    return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

// Próxima cita activa (pendiente/confirmada) a futuro del cliente. null si no hay.
function _proximaCita(tel) {
    try {
        return db.prepare(`SELECT id, servicio, fecha, hora FROM citas
            WHERE telefono=? AND estatus IN ('pendiente','confirmada')
              AND fecha >= date('now','localtime') ORDER BY fecha, hora LIMIT 1`).get(tel);
    } catch (_) { return null; }
}

// Detecta la intención de gestionar/consultar "mi cita" en texto libre (entrada
// desde menuFlow). Cubre cancelar/reagendar/cambiar y también consultar el estado
// ("¿cómo va mi cita?", "cuándo es mi cita", "mi cita") — todas llevan al mismo
// resumen con opciones, así consultar y gestionar convergen (P2).
function esIntencionGestion(raw) {
    return /\b(cancel|reagend|reprogram)\w*\b.*\bcita\b|\bcita\b.*\b(cancel|reagend|reprogram|cambi|mov[eé])\w*\b|\b(cambiar|mover|modificar)\b.*\bcita\b|\b(mi|mis)\s+citas?\b|\bcu[aá]ndo\s+(es|tengo)\s+.*cita\b|\bc[oó]mo\s+va\s+mi\s+cita\b|\bestado\s+de\s+mi\s+cita\b/i.test(raw || '');
}

// Entrada desde menuFlow: muestra la próxima cita y las opciones.
function iniciar(userId, data, tel) {
    if (!moduloActivo('citas_activo')) { sessionManager.updateSession(userId, S.MENU, {}); return null; }
    const c = _proximaCita(tel);
    if (!c) {
        sessionManager.updateSession(userId, S.MENU, {});
        return 'No encontré ninguna cita próxima a tu nombre. Escribe *hola* para ver el menú si quieres agendar una nueva.';
    }
    sessionManager.updateSession(userId, S.CITA_GESTION, { ...data, gestion_cita_id: c.id });
    return `📅 Tu próxima cita:\n\n${c.servicio ? '💈 *' + c.servicio + '*\n' : ''}🗓️ *${_labelFecha(c.fecha)}* a las *${c.hora}*\n\n¿Qué deseas hacer?\n\n1️⃣  Reagendar (cambiar día u hora)\n2️⃣  Cancelar la cita\n3️⃣  Dejarla como está`;
}

async function handle(ctx) {
    const { userId, action, step, data, tel } = ctx;
    if (!moduloActivo('citas_activo')) { sessionManager.updateSession(userId, S.MENU, {}); return null; }

    if (step === S.CITA_GESTION) {
        if (action === '3' || action === 'menu') {
            sessionManager.updateSession(userId, S.MENU, {});
            return 'Perfecto, tu cita queda igual. Escribe *hola* para volver al menú.';
        }
        if (action === '2') {
            const c = db.prepare("SELECT id FROM citas WHERE id=? AND estatus IN ('pendiente','confirmada')").get(data.gestion_cita_id);
            if (!c) { sessionManager.updateSession(userId, S.MENU, {}); return 'Esa cita ya no está activa. Escribe *hola* para el menú.'; }
            db.prepare("UPDATE citas SET estatus='cancelada' WHERE id=?").run(data.gestion_cita_id);
            logEvento('cita_cancelada', String(data.gestion_cita_id), tel);
            log.info('Cita cancelada #' + data.gestion_cita_id, tel);
            sessionManager.updateSession(userId, S.MENU, {});
            return '✅ Tu cita fue *cancelada*. Cuando quieras agendar de nuevo, escribe *hola*. 🙌';
        }
        if (action === '1') {
            const dias = citas.diasDisponibles();
            if (!dias.length) { sessionManager.updateSession(userId, S.MENU, {}); return 'No hay días disponibles por ahora. Escribe *asesor* si necesitas ayuda.'; }
            sessionManager.updateSession(userId, S.CITA_REAG_FECHA, { ...data, cita_dias: dias });
            return '🗓️ ¿Para qué día la movemos?\n\n' + dias.map((d, i) => `${i + 1}️⃣  ${d.label}`).join('\n') + '\n\n_Escribe el número del día._';
        }
        return 'Escribe *1* para reagendar, *2* para cancelar o *3* para dejarla igual.';
    }

    if (step === S.CITA_REAG_FECHA) {
        const dias = data.cita_dias || citas.diasDisponibles();
        const i = parseInt(action, 10) - 1;
        if (!(i >= 0 && i < dias.length)) return 'Elige el número de uno de los días de la lista.';
        const fecha = dias[i].iso;
        const slots = citas.slotsLibres(fecha);
        if (!slots.length) {
            sessionManager.updateSession(userId, S.CITA_REAG_FECHA, { ...data, cita_dias: citas.diasDisponibles() });
            return 'Ese día se acaba de llenar. Elige otro de la lista.';
        }
        sessionManager.updateSession(userId, S.CITA_REAG_HORA, { ...data, reag_fecha: fecha, reag_label: dias[i].label, cita_slots: slots });
        return `🕐 *${dias[i].label}*. ¿A qué hora?\n\n` + slots.map((h, j) => `${j + 1}️⃣  ${h}`).join('\n') + '\n\n_Escribe el número de la hora._';
    }

    if (step === S.CITA_REAG_HORA) {
        const slots = data.cita_slots || citas.slotsLibres(data.reag_fecha);
        const j = parseInt(action, 10) - 1;
        if (!(j >= 0 && j < slots.length)) return 'Elige el número de una de las horas de la lista.';
        const hora = slots[j];
        // revalidar el slot (alguien pudo ganarlo) y que la cita siga viva
        if (!citas.slotsLibres(data.reag_fecha).includes(hora)) return '😕 Esa hora se acaba de ocupar. Elige otra de la lista.';
        const c = db.prepare("SELECT id FROM citas WHERE id=? AND estatus IN ('pendiente','confirmada')").get(data.gestion_cita_id);
        if (!c) { sessionManager.updateSession(userId, S.MENU, {}); return 'Tu cita ya no está activa. Escribe *hola* para el menú.'; }
        db.prepare('UPDATE citas SET fecha=?, hora=? WHERE id=?').run(data.reag_fecha, hora, data.gestion_cita_id);
        logEvento('cita_reagendada', data.reag_fecha + ' ' + hora, tel);
        log.info('Cita reagendada #' + data.gestion_cita_id + ' → ' + data.reag_fecha + ' ' + hora, tel);
        sessionManager.updateSession(userId, S.MENU, {});
        return `✅ ¡Listo! Tu cita quedó reagendada para *${data.reag_label}* a las *${hora}*. Te mando un recordatorio un día antes. 🙌\n\n_Escribe *menu* para volver al inicio._`;
    }

    return null;
}

module.exports = { STEPS, handle, iniciar, esIntencionGestion };
