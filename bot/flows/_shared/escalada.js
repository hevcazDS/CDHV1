// ═══════════════════════════════════════════════════════
//  escalada.js — escalada a asesor (cola de atención + notificación).
//  Extraído mecánicamente de bot/flows/_shared.js, sin cambio de lógica.
// ═══════════════════════════════════════════════════════
const { db, log, getValor, registrarErrorDB, mensajeService } = require('./_base');
const { tagCliente } = require('./tagging');

function registrarEscalada(userId, idPedido, motivo, telefono, tipo, caso) {
    const esQuejaMotivo = /queja|molest|frustrad|inconforme|enojad/i.test(motivo||'');
    const outcome = esQuejaMotivo ? 'queja' : 'escalacion';
    // Auto-tag según el motivo de la escalada
    if (telefono) {
        if (esQuejaMotivo) tagCliente(telefono, 'queja');
    }
    try {
        let conv = db.prepare(
            `SELECT id FROM conversaciones WHERE telefono=? AND estatus IN ('activa','escalada') ORDER BY iniciada_en DESC LIMIT 1`
        ).get(telefono);
        if (!conv) {
            const cli = db.prepare('SELECT id FROM clientes WHERE telefono=?').get(telefono);
            const infoC = db.prepare(
                `INSERT INTO conversaciones (id_cliente, telefono, canal, estatus, id_pedido) VALUES (?,?,'whatsapp','escalada',?)`
            ).run(cli ? cli.id : null, telefono, idPedido || null);
            conv = { id: infoC.lastInsertRowid };
        } else {
            db.prepare(`UPDATE conversaciones SET estatus='escalada' WHERE id=?`).run(conv.id);
        }
        mensajeService.marcarOutcome(db, telefono, outcome);
        const cli2 = db.prepare('SELECT id FROM clientes WHERE telefono=?').get(telefono);
        db.prepare(
            `INSERT INTO cola_atencion (id_conversacion, id_cliente, motivo_escalada, prioridad, estatus, tipo, caso) VALUES (?,?,?,1,'en_espera',?,?)`
        ).run(conv.id, cli2 ? cli2.id : null, motivo || 'Sin motivo', tipo || 'otro', caso || null);

        const ahora = new Date();
        const minActual = ahora.getHours() * 60 + ahora.getMinutes();
        const cuerpo = JSON.stringify({
            evento: 'escalada_asesor', telefono, motivo: motivo || 'Sin especificar',
            fuera_horario: !(minActual >= 660 && minActual < 1200),
            hora: ahora.toISOString(),
        });
        db.prepare(
            `INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, id_pedido, estatus) VALUES ('dashboard','asesor','Cliente esperando atención',?,?,'pendiente')`
        ).run(cuerpo, idPedido || null);
        // Notificacion WhatsApp al asesor
        const _asesorTel = getValor('operador_telefono', process.env.ASESOR_WHATSAPP);
        if (_asesorTel) {
            const _hh = (new Date().getUTCHours() - 6 + 24) % 24;
            const _msgA = '⚠️ *Cliente esperando atencion*\n\nTel: ' + telefono + '\nMotivo: ' + (motivo || 'Sin especificar') + '\nHorario: ' + (_hh >= 11 && _hh < 20 ? 'En horario' : 'Fuera de horario') + '\n\nResponde directamente a *' + telefono + '*';
            try { db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,?,?,'pendiente')").run(_asesorTel, 'Escalada asesor', _msgA); } catch(e) { log.debug('No se pudo notificar al asesor: ' + e.message); registrarErrorDB('_shared:registrarEscalada:notificarAsesor', e.message, { telefono }); }
        }
    } catch(e) {
        log.error('registrarEscalada error', e);
        registrarErrorDB('_shared:registrarEscalada', e.message, { telefono, motivo });
    }
}

module.exports = {
    registrarEscalada,
};
