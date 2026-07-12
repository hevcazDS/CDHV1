// citasFlow — agendar cita por WhatsApp (giros de servicio: barbería,
// tatuajes, estética, uñas, mantenimiento, servicios). Se registra por giro
// en giroFlows.js y su opción de menú solo aparece con citas_activo ON, así
// que Julio Cepeda queda byte-idéntico.
//
// Config (tabla configuracion, editable sin reiniciar):
//   citas_hora_inicio (def 10) · citas_hora_fin (def 19)
//   citas_duracion_min (def 60) · citas_capacidad (def 1 por slot)
'use strict';
const db = require('../db_connection');
const sessionManager = require('../sessionManager');
const { S, getValor, vocab, moduloActivo, logEvento } = require('./_shared');
const log = require('../logger');

const STEPS = [S.CITA_SERVICIO, S.CITA_FECHA, S.CITA_HORA, S.CITA_CONFIRMA];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Servicios del catálogo (productos tipo 'servicio') para elegir al agendar.
// Si no hay ninguno, el flujo salta directo a fecha (compatible hacia atrás).
function serviciosDisponibles() {
    try { return db.prepare("SELECT id, name, price FROM productos WHERE tipo='servicio' AND activo=1 ORDER BY name LIMIT 9").all(); }
    catch (_) { return []; }
}

function _cfg(clave, def) {
    const v = parseInt(getValor(clave, ''), 10);
    return Number.isFinite(v) && v > 0 ? v : def;
}

// Slots HH:MM del día según horario/duración, menos los ya llenos
function slotsLibres(fecha) {
    const inicio = _cfg('citas_hora_inicio', 10), fin = _cfg('citas_hora_fin', 19);
    const dur = _cfg('citas_duracion_min', 60), cap = _cfg('citas_capacidad', 1);
    const ocupadas = db.prepare(
        "SELECT hora, COUNT(*) n FROM citas WHERE fecha=? AND estatus IN ('pendiente','confirmada') GROUP BY hora"
    ).all(fecha).reduce((m, r) => (m[r.hora] = r.n, m), {});
    const slots = [];
    for (let min = inicio * 60; min + dur <= fin * 60; min += dur) {
        const hora = String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
        if ((ocupadas[hora] || 0) < cap) slots.push(hora);
    }
    // hoy: solo horas futuras
    const hoy = new Date();
    const hoyISO = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (fecha === hoyISO) {
        const ahora = hoy.getHours() * 60 + hoy.getMinutes();
        return slots.filter(h => (parseInt(h) * 60 + parseInt(h.slice(3))) > ahora + 30);
    }
    return slots;
}

// Próximos días (hasta 6) que aún tienen algún slot libre
function diasDisponibles() {
    const dias = [];
    for (let d = 0; dias.length < 6 && d < 14; d++) {
        const f = new Date(Date.now() + d * 86400000);
        const iso = new Date(f.getTime() - f.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        if (slotsLibres(iso).length) {
            dias.push({ iso, label: (d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : DIAS[f.getDay()]) + ' ' + iso.slice(8) + '/' + iso.slice(5, 7) });
        }
    }
    return dias;
}

// Muestra la lista de días (paso fecha)
function _pedirFecha(userId, data) {
    const dias = diasDisponibles();
    if (!dias.length) return '📅 Por ahora no tengo fechas disponibles. Escribe *asesor* y te atendemos directo.';
    sessionManager.updateSession(userId, S.CITA_FECHA, { ...data, cita_dias: dias });
    return '📅 ¿Qué día te queda?\n\n' +
        dias.map((d, i) => `${i + 1}️⃣  ${d.label}`).join('\n') +
        '\n\n_Escribe el número del día._';
}

// Entrada desde el menú (opción "citas") — menuFlow nos delega aquí. Si el
// negocio tiene servicios en el catálogo, primero pregunta cuál; si no, va
// directo a la fecha (barbería sin catálogo = comportamiento anterior).
function iniciar(userId, data) {
    const servicios = serviciosDisponibles();
    if (servicios.length) {
        sessionManager.updateSession(userId, S.CITA_SERVICIO, { ...data, cita_servicios: servicios });
        return '💈 ¡Agendemos tu cita! ¿Qué servicio quieres?\n\n' +
            servicios.map((s, i) => `${i + 1}️⃣  ${s.name}${s.price > 0 ? ' — $' + Number(s.price).toFixed(0) : ''}`).join('\n') +
            '\n\n_Escribe el número del servicio._';
    }
    return _pedirFecha(userId, data);
}

async function handle(ctx) {
    const { userId, action, step, data, tel } = ctx;
    if (!moduloActivo('citas_activo')) { // fail closed → menú
        sessionManager.updateSession(userId, S.MENU, {});
        return null;
    }

    if (step === S.CITA_SERVICIO) {
        const servicios = data.cita_servicios || serviciosDisponibles();
        const i = parseInt(action, 10) - 1;
        if (!(i >= 0 && i < servicios.length)) return 'Elige el número de uno de los servicios de la lista, o escribe *menu* para regresar.';
        const sv = servicios[i];
        return _pedirFecha(userId, { ...data, cita_servicio: sv.name, cita_servicio_id: sv.id, cita_servicio_precio: sv.price });
    }

    if (step === S.CITA_FECHA) {
        const dias = data.cita_dias || diasDisponibles();
        const i = parseInt(action, 10) - 1;
        if (!(i >= 0 && i < dias.length)) {
            return 'Elige el número de uno de los días de la lista, o escribe *menu* para regresar.';
        }
        const fecha = dias[i].iso;
        const slots = slotsLibres(fecha);
        if (!slots.length) return iniciar(userId, data); // se llenó mientras elegía
        sessionManager.updateSession(userId, S.CITA_HORA, { ...data, cita_fecha: fecha, cita_label: dias[i].label, cita_slots: slots });
        return `🕐 Perfecto, *${dias[i].label}*. ¿A qué hora?\n\n` +
            slots.map((h, j) => `${j + 1}️⃣  ${h}`).join('\n') +
            '\n\n_Escribe el número de la hora._';
    }

    if (step === S.CITA_HORA) {
        const slots = data.cita_slots || slotsLibres(data.cita_fecha);
        const j = parseInt(action, 10) - 1;
        if (!(j >= 0 && j < slots.length)) return 'Elige el número de una de las horas de la lista.';
        sessionManager.updateSession(userId, S.CITA_CONFIRMA, { ...data, cita_hora: slots[j] });
        const _sv = data.cita_servicio ? `💈 *${data.cita_servicio}*${data.cita_servicio_precio > 0 ? ' — $' + Number(data.cita_servicio_precio).toFixed(0) : ''}\n` : '';
        return `✅ Quedaría así:\n\n${_sv}📅 *${data.cita_label}* a las *${slots[j]}*\n\n1️⃣  Confirmar cita\n2️⃣  Cambiar el día`;
    }

    if (step === S.CITA_CONFIRMA) {
        if (action === '2') return iniciar(userId, data);
        if (action !== '1') return 'Escribe *1* para confirmar tu cita o *2* para cambiar el día.';
        // revalidar el slot al confirmar (alguien pudo ganarlo)
        if (!slotsLibres(data.cita_fecha).includes(data.cita_hora)) {
            return '😕 Esa hora se acaba de ocupar. ' + iniciar(userId, data);
        }
        const nombre = (() => {
            try { return db.prepare('SELECT nombre FROM clientes WHERE telefono=?').get(tel)?.nombre || null; }
            catch (_) { return null; }
        })();
        db.prepare('INSERT INTO citas (telefono, nombre, servicio, fecha, hora) VALUES (?,?,?,?,?)')
          .run(tel, nombre, data.cita_servicio || null, data.cita_fecha, data.cita_hora);
        logEvento('cita_agendada', (data.cita_fecha || '') + ' ' + (data.cita_hora || '') + (data.cita_servicio ? ' · ' + data.cita_servicio : ''), tel);
        log.info(`Cita agendada ${data.cita_fecha} ${data.cita_hora}`, tel);
        sessionManager.updateSession(userId, S.MENU, {});
        const V = vocab();
        return `🎉 ¡Listo! Tu cita quedó agendada:\n\n${data.cita_servicio ? '💈 *' + data.cita_servicio + '*\n' : ''}📅 *${data.cita_label}* a las *${data.cita_hora}*\n\n` +
            `Te mandaré un recordatorio un día antes. Si necesitas cambiarla, escribe *asesor*.\n\n_Escribe *menu* para volver al inicio._`;
    }

    return null;
}

module.exports = { STEPS, handle, iniciar, slotsLibres, diasDisponibles };
