// emailService.js
// Servicio de correo para notificaciones de pedido.
// Usa Node.js nativo (no nodemailer) — solo https/net + SMTP manual.
// Configuración via .env — NUNCA hardcodear credenciales.
//
// Para activar: crea un archivo .env en la carpeta del bot con:
//
//   EMAIL_HOST=smtp.gmail.com
//   EMAIL_PORT=587
//   EMAIL_USER=tucorreo@gmail.com
//   EMAIL_PASS=xxxx xxxx xxxx xxxx   <- Contraseña de aplicación Gmail (16 chars)
//   EMAIL_FROM=Julio Cepeda Jugueterías <tucorreo@gmail.com>
//   EMAIL_CEDIS=correo-cedis-monterrey@dominio.com
//   EMAIL_PERSONAL=tu-correo-personal@gmail.com
//   EMAIL_EXTRA=otro-correo@dominio.com
//
// PASOS PARA GMAIL:
//   1. myaccount.google.com → Seguridad → Verificación en 2 pasos (activar)
//   2. Verificación en 2 pasos → Contraseñas de aplicación
//   3. Selecciona "Correo" y "Windows" → Genera → copia 16 chars al .env
//
// Para Outlook/Hotmail: EMAIL_HOST=smtp-mail.outlook.com EMAIL_PORT=587

'use strict';

const crypto     = require('crypto');
const db         = require('../bot/db_connection');
const log        = require('../bot/logger')('emailService');
const smtpClient = require('./smtpClient');
require('dotenv').config({ quiet: true });

// ── Config ────────────────────────────────────────────────────────────────
// SMTP_USER/PASS se leen de `configuracion` (bot_email_usuario/password) en
// cada envío, no una sola vez al cargar el módulo -- así prime puede cambiar
// el correo+contraseña de aplicación del bot desde el dashboard (Prime >
// General) sin reiniciar el proceso, igual que tono_bot/módulos. Si nunca se
// han escrito esas claves, cae a las env vars de siempre (instalaciones que
// solo usan .env siguen funcionando igual).
const SMTP_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.EMAIL_PORT || '587');

function _cfg(clave, fallback) {
    try {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        return (r && r.valor) ? r.valor : fallback;
    } catch (_) { return fallback; }
}

function _smtpUser() { return _cfg('bot_email_usuario', process.env.EMAIL_USER || ''); }
// La clave se guarda cifrada en la BD (secretos.js). descifrarSecreto deja pasar
// tal cual lo que no tenga prefijo 'enc:' (claro/legacy o el EMAIL_PASS del .env).
function _smtpPass() { return require('./secretos').descifrarSecreto(_cfg('bot_email_password', process.env.EMAIL_PASS || '')); }
function _fromAddr() {
    const user = _smtpUser();
    return process.env.EMAIL_FROM || `Julio Cepeda Jugueterías <${user}>`;
}

// Destinatarios fijos de notificaciones de pedido
const DEST_CEDIS    = process.env.EMAIL_CEDIS    || '';
const DEST_PERSONAL = process.env.EMAIL_PERSONAL || '';
const DEST_EXTRA    = process.env.EMAIL_EXTRA    || '';

function isConfigured() {
    return !!(_smtpUser() && _smtpPass());
}

// ── SMTP client básico (STARTTLS) ─────────────────────────────────────────
// Construye el MIME (headers + cuerpo). Sin adjuntos = multipart/alternative
// (idéntico al de siempre); con adjuntos = multipart/mixed{ alternative, adjuntos }.
// Puro y testeable (no envía). Devuelve { body, msgId, toList }.
function _construirMime({ from, to, subject, html, adjuntos = [] }) {
    const boundary = `----=_Part_${crypto.randomBytes(8).toString('hex')}`;
    const toList   = Array.isArray(to) ? to : [to];
    const toHeader = toList.join(', ');
    const msgId    = `<${Date.now()}.${crypto.randomBytes(4).toString('hex')}@juliocepeda.bot>`;
    const date     = new Date().toUTCString();
    const altB = adjuntos.length ? `----=_Alt_${crypto.randomBytes(8).toString('hex')}` : boundary;
    const alt = [
        `--${altB}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
        Buffer.from(_htmlToText(html)).toString('base64'), '',
        `--${altB}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
        Buffer.from(html).toString('base64'), '',
        `--${altB}--`,
    ];
    const cabecera = [
        `From: ${from}`, `To: ${toHeader}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
        `Date: ${date}`, `Message-ID: ${msgId}`, `MIME-Version: 1.0`,
    ];
    let body;
    if (!adjuntos.length) {
        body = [...cabecera, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', ...alt].join('\r\n');
    } else {
        const partes = [...cabecera, `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
            `--${boundary}`, `Content-Type: multipart/alternative; boundary="${altB}"`, '', ...alt];
        for (const a of adjuntos) {
            const b64 = Buffer.isBuffer(a.data) ? a.data.toString('base64') : String(a.data || '');
            const chunked = (b64.match(/.{1,76}/g) || []).join('\r\n');
            const nombre = String(a.nombre || 'adjunto').replace(/[\r\n"]/g, '');
            partes.push('', `--${boundary}`,
                `Content-Type: ${a.tipo || 'application/octet-stream'}; name="${nombre}"`,
                'Content-Transfer-Encoding: base64',
                `Content-Disposition: attachment; filename="${nombre}"`, '', chunked);
        }
        partes.push('', `--${boundary}--`);
        body = partes.join('\r\n');
    }
    return { body, msgId, toList };
}

function _smtpSend(opts) {
    const { host, port, user, pass } = opts;
    const { body, msgId, toList } = _construirMime(opts);
    return smtpClient.sendMail({
        host, port, user, pass,
        mailFrom: user, to: toList, rawBody: body,
        ehloName: host, timeoutMs: 15000,
    }).then(() => ({ ok: true, messageId: msgId }));
}

// ── Simplificar HTML a texto plano ────────────────────────────────────────
function _htmlToText(html) {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/td>/gi, ' | ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ── Escapar HTML para evitar inyección en campos provenientes del cliente ──
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Templates HTML ────────────────────────────────────────────────────────
function _templatePedido(pedido) {
    const {
        folio, cliente, total, ciudad, estado, calle, colonia, cp,
        productos, linkPago, codigoRetiro, tipoEntrega, guia,
        fechaCreacion,
    } = pedido;

    const esEnvio = tipoEntrega === 'envio';

    const rowsProductos = (productos || []).map(p =>
        `<tr>
            <td style="padding:8px;border-bottom:1px solid #eee">${esc(p.nombre)}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${Number(p.cantidad)}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${Number(p.precio).toFixed(2)}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">$${(p.precio*p.cantidad).toFixed(2)}</td>
        </tr>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Pedido ${esc(folio)}</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4">
<div style="max-width:620px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">

  <!-- Header -->
  <div style="background:#e85d04;padding:24px 32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:24px">🧸 Julio Cepeda Jugueterías</h1>
    <p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px">Nuevo pedido registrado</p>
  </div>

  <!-- Folio y fecha -->
  <div style="padding:20px 32px;background:#fff7f2;border-bottom:3px solid #e85d04">
    <table width="100%"><tr>
      <td><span style="font-size:12px;color:#888">FOLIO</span><br>
          <strong style="font-size:20px;color:#e85d04">${esc(folio)}</strong></td>
      <td style="text-align:right"><span style="font-size:12px;color:#888">FECHA</span><br>
          <strong style="font-size:14px">${esc(fechaCreacion)}</strong></td>
    </tr></table>
  </div>

  <!-- Cliente -->
  <div style="padding:20px 32px;border-bottom:1px solid #eee">
    <h3 style="margin:0 0 12px;color:#333;font-size:14px;text-transform:uppercase;letter-spacing:.05em">📋 Datos del cliente</h3>
    <p style="margin:4px 0"><strong>Nombre:</strong> ${esc(cliente)}</p>
    ${esEnvio ? `
    <p style="margin:4px 0"><strong>Dirección:</strong> ${esc(calle)}, ${esc(colonia)}</p>
    <p style="margin:4px 0"><strong>Ciudad:</strong> ${esc(ciudad)}, ${esc(estado)} CP ${esc(cp)}</p>` : `
    <p style="margin:4px 0"><strong>Tipo:</strong> 🏪 Pick Up en sucursal</p>
    ${codigoRetiro ? `<p style="margin:4px 0"><strong>Código de retiro:</strong> <code style="background:#f0f0f0;padding:2px 8px;border-radius:4px">${esc(codigoRetiro)}</code></p>` : ''}`}
  </div>

  <!-- Productos -->
  <div style="padding:20px 32px;border-bottom:1px solid #eee">
    <h3 style="margin:0 0 12px;color:#333;font-size:14px;text-transform:uppercase;letter-spacing:.05em">🧸 Productos</h3>
    <table width="100%" style="border-collapse:collapse">
      <thead>
        <tr style="background:#f9f9f9">
          <th style="padding:8px;text-align:left;font-size:12px;color:#666">Producto</th>
          <th style="padding:8px;text-align:center;font-size:12px;color:#666">Cant.</th>
          <th style="padding:8px;text-align:right;font-size:12px;color:#666">Precio</th>
          <th style="padding:8px;text-align:right;font-size:12px;color:#666">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rowsProductos}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="padding:12px 8px;text-align:right;font-weight:bold">TOTAL:</td>
          <td style="padding:12px 8px;text-align:right;font-weight:bold;color:#e85d04;font-size:18px">$${Number(total).toFixed(2)} MXN</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Envío / Guía -->
  ${esEnvio && guia ? `
  <div style="padding:20px 32px;border-bottom:1px solid #eee;background:#f0f9ff">
    <h3 style="margin:0 0 12px;color:#333;font-size:14px;text-transform:uppercase;letter-spacing:.05em">📦 Guía de envío</h3>
    <p style="margin:4px 0"><strong>Número de guía:</strong> <code style="background:#e0f0ff;padding:2px 8px;border-radius:4px;font-size:16px">${esc(guia.numeroGuia)}</code></p>
    <p style="margin:4px 0"><strong>Sale:</strong> ${esc(guia.fechaEnvioHuman)}</p>
    <p style="margin:4px 0"><strong>Entrega estimada:</strong> ${esc(guia.fechaEntregaHuman)}</p>
    <p style="margin:4px 0;font-size:12px;color:#888">⚠️ Guía simulada — se actualizará con número real al integrar Estafeta API</p>
  </div>` : ''}

  <!-- Link de pago -->
  ${linkPago ? `
  <div style="padding:20px 32px;text-align:center;border-bottom:1px solid #eee">
    <a href="${esc(linkPago)}" style="display:inline-block;background:#e85d04;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">
      💳 Link de pago — $${Number(total).toFixed(2)} MXN
    </a>
    <p style="font-size:12px;color:#888;margin-top:8px">Link válido 48 horas</p>
  </div>` : ''}

  <!-- Footer -->
  <div style="padding:16px 32px;background:#f9f9f9;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa">Julio Cepeda Jugueterías — Bot de ventas WhatsApp<br>
    Este es un mensaje automático. Para soporte: responde a este correo.</p>
  </div>
</div>
</body>
</html>`;
}

// ── Enviar notificación de pedido ─────────────────────────────────────────
/**
 * Envía correo de notificación a los 3 destinos configurados.
 * Si el correo no está configurado, encola en cola_emails para reintento.
 */
async function notificarPedido(pedidoData) {
    const { folio, idPedido } = pedidoData;

    const destinatarios = [DEST_CEDIS, DEST_PERSONAL, DEST_EXTRA]
        .filter(Boolean)
        .filter(e => e.includes('@'));

    if (!destinatarios.length) {
        log.warn('No hay destinatarios configurados en .env');
        return { ok: false, reason: 'NO_DESTINATARIOS' };
    }

    const html    = _templatePedido(pedidoData);
    // El nombre del cliente NO va en el asunto (los proveedores de correo
    // registran asuntos en logs). El nombre completo va en el cuerpo.
    const asunto  = `Nuevo pedido ${folio} — $${Number(pedidoData.total).toFixed(2)} MXN`;

    // Siempre encolar primero (para historial)
    try {
        db.prepare(`
            INSERT INTO cola_emails (id_pedido, destinatarios, asunto, html_body, estatus)
            VALUES (?, ?, ?, ?, 'pendiente')
        `).run(idPedido || null, JSON.stringify(destinatarios), asunto, html);
    } catch(e) { log.debug('No se pudo encolar email en cola_emails: ' + e.message); }

    if (!isConfigured()) {
        log.warn('EMAIL_USER o EMAIL_PASS no configurados en .env');
        return { ok: false, reason: 'NO_CONFIGURADO' };
    }

    try {
        const result = await _smtpSend({
            host: SMTP_HOST, port: SMTP_PORT,
            user: _smtpUser(), pass: _smtpPass(),
            from: _fromAddr(),
            to: destinatarios,
            subject: asunto,
            html,
        });

        // Marcar como enviado en cola
        db.prepare(`
            UPDATE cola_emails SET estatus='enviado', enviado_en=datetime('now','localtime')
            WHERE id_pedido=? AND estatus='pendiente'
            ORDER BY id DESC LIMIT 1
        `).run(idPedido || null);

        // Marcar pedido como notificado
        if (idPedido) {
            db.prepare("UPDATE pedidos SET email_notificado=1 WHERE id_pedido=?").run(idPedido);
        }

        log.info(`Pedido ${folio} notificado a ${destinatarios.join(', ')}`);
        return { ok: true, ...result };

    } catch(e) {
        log.error('Error enviando', e);
        // Actualizar intentos
        db.prepare(`
            UPDATE cola_emails SET intentos=intentos+1, estatus='error'
            WHERE id_pedido=? AND estatus='pendiente'
            ORDER BY id DESC LIMIT 1
        `).run(idPedido || null);
        return { ok: false, reason: e.message };
    }
}

// ── Reintentar emails fallidos (llamar periódicamente) ────────────────────
async function reintentarPendientes() {
    if (!isConfigured()) return;
    const pendientes = db.prepare(
        "SELECT * FROM cola_emails WHERE estatus IN ('pendiente','error') AND intentos < 5 ORDER BY id LIMIT 5"
    ).all();

    for (const email of pendientes) {
        // Backoff exponencial: intento 1=0s, 2=2min, 3=8min, 4=30min, 5=2h
        const backoffMin = [0, 2, 8, 30, 120][email.intentos] || 120;
        if (email.intentos > 0) {
            const ultimoIntento = new Date(email.actualizado_en || email.creada_en).getTime();
            const minutosEspera = (Date.now() - ultimoIntento) / 60_000;
            if (minutosEspera < backoffMin) continue; // aún no es momento
        }
        try {
            const dests = JSON.parse(email.destinatarios);
            await _smtpSend({
                host: SMTP_HOST, port: SMTP_PORT,
                user: _smtpUser(), pass: _smtpPass(),
                from: _fromAddr(), to: dests,
                subject: email.asunto, html: email.html_body,
            });
            db.prepare("UPDATE cola_emails SET estatus='enviado', enviado_en=datetime('now','localtime') WHERE id=?").run(email.id);
            log.info('Correo enviado: ' + email.asunto);
        } catch(e) {
            db.prepare("UPDATE cola_emails SET intentos=intentos+1, estatus='error', actualizado_en=datetime('now','localtime') WHERE id=?").run(email.id);
            log.warn('Reintento fallido: ' + email.asunto + ' — intento ' + (email.intentos + 1));
        }
    }
}

// Reintento automático cada 5 minutos (el backoff decide si actúa)
setInterval(reintentarPendientes, 5 * 60_000).unref();

// Envío genérico con adjuntos (módulo de correo). adjuntos: [{nombre, tipo, data:Buffer}].
// Usa la misma credencial/SMTP (clave de aplicación) que las notificaciones.
async function enviarCorreo({ to, subject, html, adjuntos = [] }) {
    if (!isConfigured()) throw new Error('Correo no configurado (falta usuario/clave de aplicación)');
    const destinos = (Array.isArray(to) ? to : String(to || '').split(/[,;]/)).map(s => String(s).trim()).filter(Boolean);
    if (!destinos.length) throw new Error('Falta el destinatario');
    return _smtpSend({
        host: SMTP_HOST, port: SMTP_PORT, user: _smtpUser(), pass: _smtpPass(), from: _fromAddr(),
        to: destinos, subject: String(subject || '(sin asunto)').slice(0, 200), html: String(html || ''), adjuntos,
    });
}

module.exports = { notificarPedido, reintentarPendientes, isConfigured, enviarCorreo, esc, _templatePedido, _construirMime };
