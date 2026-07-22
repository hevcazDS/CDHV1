// smtpClient.js — Cliente SMTP STARTTLS compartido (sin nodemailer), extraído
// de la lógica que services/emailService.js, scripts/backup.js y
// services/datasetExport.js repetían casi idéntica (~90 líneas c/u).
//
// Solo cubre el handshake puro: conectar → EHLO → STARTTLS → EHLO → AUTH LOGIN
// → MAIL FROM → RCPT TO (todos, con contador de acks) → DATA → cuerpo → QUIT.
// El armado del MIME (headers, multipart/alternative vs mixed, adjuntos en
// base64) se queda en cada llamador — difiere demasiado entre los 3 sitios
// (emailService arma multipart con/sin adjuntos vía _construirMime; backup.js
// y datasetExport.js arman un multipart/mixed con un único adjunto .gz de
// forma manual) como para meterlo aquí sin arriesgar un cambio de formato.
//
// Contrato: sendMail(opts) → Promise<void>. Rechaza con Error en cualquier
// falla (socket/tls/timeout/código SMTP>=400); el Error trae `.stage`
// ('socket'|'tls'|'timeout'|'smtp') para que cada llamador pueda reconstruir
// su log previo si lo necesita (los 3 sitios registraban el error distinto).
'use strict';
const net = require('net');
const tls = require('tls');

/**
 * @param {object} opts
 * @param {string} opts.host        Servidor SMTP (también usado como TLS servername/SNI).
 * @param {number} opts.port        Puerto SMTP (587 típico, STARTTLS).
 * @param {string} opts.user        Usuario para AUTH LOGIN.
 * @param {string} opts.pass        Password/clave de aplicación para AUTH LOGIN.
 * @param {string} opts.mailFrom    Dirección para MAIL FROM (los 3 sitios usan el mismo `user`).
 * @param {string|string[]} opts.to Destinatario(s) — uno o varios RCPT TO.
 * @param {string} opts.rawBody     Mensaje MIME completo (headers+cuerpo), SIN el "\r\n." final de DATA.
 * @param {string} [opts.ehloName]  Dominio anunciado en EHLO (ambas veces). Default: opts.host.
 * @param {number} [opts.timeoutMs] Timeout de inactividad del socket. Default 30000.
 * @returns {Promise<void>}
 */
function sendMail({ host, port, user, pass, mailFrom, to, rawBody, ehloName, timeoutMs = 30000 }) {
    return new Promise((resolve, reject) => {
        const toList   = Array.isArray(to) ? to : [to];
        const heloName = ehloName || host;

        const socket = net.createConnection(port, host);
        let state    = 'greeting';
        let tlsSock  = null;
        let buf      = '';
        let rcptPend = 0;
        let settled  = false;

        const finReject = (stage, err) => {
            if (settled) return;
            settled = true;
            if (!(err instanceof Error)) err = new Error(String(err));
            err.stage = stage;
            try { (tlsSock || socket).destroy(); } catch (_) {}
            reject(err);
        };
        const finResolve = () => {
            if (settled) return;
            settled = true;
            try { (tlsSock || socket).destroy(); } catch (_) {}
            resolve();
        };

        const write = (s) => { (tlsSock || socket).write(s + '\r\n'); };

        const handleLine = (line) => {
            const code = parseInt(line.slice(0, 3));
            if (state === 'greeting'  && code === 220) { write(`EHLO ${heloName}`); state = 'ehlo'; return; }
            if (state === 'ehlo'      && code === 250) { write('STARTTLS');         state = 'starttls'; return; }
            if (state === 'starttls'  && code === 220) {
                tlsSock = tls.connect({ socket, servername: host }, () => {
                    tlsSock.on('data', d => { buf += d; processBuffer(); });
                    write(`EHLO ${heloName}`); state = 'ehlo2';
                });
                tlsSock.on('error', (e) => finReject('tls', e));
                return;
            }
            if (state === 'ehlo2'     && code === 250) { write('AUTH LOGIN'); state = 'auth_user'; return; }
            if (state === 'auth_user' && code === 334) { write(Buffer.from(user).toString('base64')); state = 'auth_pass'; return; }
            if (state === 'auth_pass' && code === 334) { write(Buffer.from(pass).toString('base64')); state = 'auth_ok'; return; }
            if (state === 'auth_ok'   && code === 235) { write(`MAIL FROM:<${mailFrom}>`); state = 'mail_from'; return; }
            if (state === 'mail_from' && code === 250) {
                // Enviar todos los RCPT TO; solo avanzar cuando TODOS respondieron.
                rcptPend = toList.length;
                for (const addr of toList) write(`RCPT TO:<${String(addr).trim()}>`);
                state = 'rcpt_to'; return;
            }
            if (state === 'rcpt_to'   && code === 250) {
                if (--rcptPend <= 0) { write('DATA'); state = 'data_cmd'; }
                return;
            }
            if (state === 'data_cmd'  && code === 354) { write(rawBody + '\r\n.'); state = 'data_body'; return; }
            if (state === 'data_body' && code === 250) { write('QUIT'); state = 'quit'; return; }
            if (state === 'quit'      && code === 221) { finResolve(); return; }
            if (code >= 400) { finReject('smtp', new Error(`SMTP ${code}: ${line}`)); }
        };

        const processBuffer = () => {
            const lines = buf.split('\r\n');
            buf = lines.pop();
            for (const line of lines) { if (line) handleLine(line); }
        };

        socket.on('data', d => { buf += d; processBuffer(); });
        socket.on('error', (e) => finReject('socket', e));
        socket.on('timeout', () => finReject('timeout', new Error('SMTP TIMEOUT')));
        socket.setTimeout(timeoutMs);
    });
}

module.exports = { sendMail };
