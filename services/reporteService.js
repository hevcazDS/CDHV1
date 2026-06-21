// reporteService.js — Reporte diario de operación (pedidos, cobranza, cola de atención)
// Compartido por dashboard/server.js (botón manual en el panel) y
// services/stockWatcher.js (envío automático programado) para que ambos
// produzcan exactamente el mismo texto y usen la misma lógica de envío —
// antes stockWatcher llamaba a /api/reporte por HTTP con Basic Auth, que
// dejó de funcionar cuando el dashboard migró su auth a sesiones por cookie
// (requireSession solo lee la cookie jc_session, nunca el header
// Authorization), dejando el reporte automático roto en silencio.
'use strict';
const db = require('../bot/db_connection');

function generarReporte() {
    const hoy    = new Date().toISOString().slice(0, 10);
    const semana = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const _pHoy    = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)=?").get(hoy);
    const _pSem    = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=?").get(semana);
    const _cTotal  = db.prepare("SELECT COUNT(*) n FROM clientes WHERE activo=1").get()?.n || 0;
    const _pagPend = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='generado'").get();
    const _escPend = db.prepare("SELECT COUNT(*) n FROM cola_atencion WHERE estatus='en_espera'").get()?.n || 0;
    const _porEst  = db.prepare("SELECT estatus, COUNT(*) n FROM pedidos GROUP BY estatus ORDER BY n DESC LIMIT 5").all();

    const fecha = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return '\u{1F4CA} *Reporte Julio Cepeda Jugueter\u{00ED}as*\n'
        + '_' + fecha + '_\n\n'
        + '━━━━━━━━━━━━━━━━\n'
        + '\u{1F4E6} *PEDIDOS HOY*\n'
        + '  Cantidad: *' + (_pHoy?.n || 0) + '* pedidos\n'
        + '  Ingresos: *$' + Number(_pHoy?.t || 0).toFixed(2) + ' MXN*\n\n'
        + '\u{1F4C5} *ESTA SEMANA*\n'
        + '  Cantidad: *' + (_pSem?.n || 0) + '* pedidos\n'
        + '  Ingresos: *$' + Number(_pSem?.t || 0).toFixed(2) + ' MXN*\n\n'
        + '\u{1F465} *CLIENTES*\n'
        + '  Total registrados: *' + _cTotal + '*\n\n'
        + '\u{1F4B3} *PAGOS PENDIENTES*\n'
        + '  ' + (_pagPend?.n || 0) + ' pedidos · $' + Number(_pagPend?.t || 0).toFixed(2) + ' MXN\n\n'
        + (_escPend > 0 ? '⚠️ *ATENCION: ' + _escPend + ' cliente' + (_escPend > 1 ? 's' : '') + ' en cola de asesor*\n\n' : '')
        + '\u{1F4CB} *POR ESTATUS*\n'
        + _porEst.map(e => '  · ' + e.estatus + ': ' + e.n).join('\n')
        + '\n━━━━━━━━━━━━━━━━\n'
        + '_Generado automáticamente_';
}

// destino: 'whatsapp' | 'email' | (cualquier otro valor solo regresa el texto, sin encolar envío)
function enviarReporte(destino) {
    const reporte = generarReporte();

    if (destino === 'whatsapp') {
        const supervisor = process.env.ASESOR_WHATSAPP;
        if (!supervisor) return { ok: false, status: 400, error: 'ASESOR_WHATSAPP no configurado en .env' };
        db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Reporte diario',?,'pendiente')").run(supervisor, reporte);
        return { ok: true, status: 200, msg: 'Reporte encolado para WhatsApp', preview: reporte };
    }

    if (destino === 'email') {
        const emailDest = process.env.EMAIL_PERSONAL || process.env.EMAIL_CEDIS;
        if (!emailDest) return { ok: false, status: 400, error: 'EMAIL_PERSONAL no configurado en .env' };
        db.prepare("INSERT INTO cola_emails (destinatarios,asunto,html_body,estatus,tipo) VALUES (?,'Reporte diario Julio Cepeda',?,'pendiente','reporte')").run(JSON.stringify([emailDest]), '<pre>' + reporte.replace(/\*/g, '').replace(/_/g, '') + '</pre>');
        return { ok: true, status: 200, msg: 'Reporte encolado para email', preview: reporte };
    }

    return { ok: true, status: 200, reporte, preview: reporte };
}

module.exports = { generarReporte, enviarReporte };
