// datasetExport.js — Exporta el dataset conversacional (para entrenar un LLM
// APARTE, fuera de producción) y lo manda por correo como respaldo.
// ═══════════════════════════════════════════════════════════════
// El bot genera, por diseño (ver bloque de extensibilidad), un dataset
// etiquetado: cada mensaje con su paso_actual + intención, cada conversación
// con su outcome (venta/escalacion/queja/abandono) y los eventos 'fallback'
// (justo el texto que las reglas NO entendieron = lo que el LLM debería
// resolver). Este módulo lo serializa a JSONL, lo comprime y lo envía al
// mismo correo de backups (Prime > General → email_backup_destino).
//
// NO entrena nada aquí ni llama a ningún LLM: el entrenamiento/fine-tuning es
// un proceso externo y manual. Esto solo SACA la información del servidor de
// producción de forma segura (solo prime puede dispararlo) y deja una copia
// fuera del equipo, igual que scripts/backup.js hace con la BD.
//
// El teléfono del cliente se enmascara (mismo patrón que bot/logger.js):
// para entrenar un asistente de ventas la señal está en el texto/flujo, no en
// el número, y así el archivo exportado lleva menos PII.
'use strict';

const zlib       = require('zlib');
const crypto     = require('crypto');
const db         = require('../bot/db_connection');
const log        = require('../bot/logger')('datasetExport');
const smtpClient = require('./smtpClient');

const SMTP_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.EMAIL_PORT || '587');

// Lee de `configuracion` (prime las edita desde el dashboard) y cae a env.
function _cfg(clave, fallback) {
    try {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        return (r && r.valor) ? r.valor : fallback;
    } catch (_) { return fallback; }
}

// Enmascara el teléfono igual que el logger: 521***1234
function _maskTel(tel) {
    if (!tel) return null;
    return String(tel).replace(/(\d{3})\d+(\d{4})/, '$1***$2');
}

// ── Construir el dataset en JSONL ─────────────────────────────────
// Devuelve { jsonl, stats }. Una línea por registro: una de metadatos, luego
// una por conversación (con sus turnos) y una por evento de fallback.
function construirDatasetJSONL() {
    const lineas = [];
    const stats = { conversaciones: 0, mensajes: 0, fallbacks: 0 };

    const negocio = _cfg('nombre_negocio', 'Julio Cepeda Jugueterías');
    const giro    = _cfg('giro', 'jugueteria');

    const stmtMsgs = db.prepare(
        `SELECT rol, contenido, paso_actual, intencion, confianza, enviado_en
           FROM mensajes WHERE id_conversacion=? ORDER BY id ASC`
    );

    const convs = db.prepare(
        `SELECT id, telefono, outcome, ultimo_paso, estatus, iniciada_en, cerrada_en
           FROM conversaciones ORDER BY id ASC`
    ).all();

    for (const c of convs) {
        const msgs = stmtMsgs.all(c.id);
        if (!msgs.length) continue; // conversación sin mensajes = sin señal
        stats.conversaciones++;
        stats.mensajes += msgs.length;
        lineas.push(JSON.stringify({
            tipo: 'conversacion',
            id: c.id,
            cliente: _maskTel(c.telefono),
            outcome: c.outcome || null,
            ultimo_paso: c.ultimo_paso || null,
            estatus: c.estatus || null,
            iniciada_en: c.iniciada_en || null,
            cerrada_en: c.cerrada_en || null,
            turnos: msgs.map(m => ({
                rol: m.rol,                       // cliente | bot | asesor
                paso: m.paso_actual || null,      // estado del flujo en ese turno
                intencion: m.intencion || null,   // clasificada por el LLM (futuro)
                confianza: m.confianza != null ? m.confianza : null,
                texto: m.contenido,
                ts: m.enviado_en || null,
            })),
        }));
    }

    // Eventos 'fallback' = el texto literal que el motor de reglas no supo
    // rutear. Es el corpus más valioso: "lo que el LLM debería resolver".
    let fallbacks = [];
    try {
        fallbacks = db.prepare(
            `SELECT valor, telefono, registrado_en
               FROM log_eventos WHERE tipo_evento='fallback' ORDER BY id DESC LIMIT 20000`
        ).all();
    } catch (e) { log.debug('No se pudieron leer fallbacks: ' + e.message); }
    for (const f of fallbacks) {
        stats.fallbacks++;
        lineas.push(JSON.stringify({
            tipo: 'fallback',
            cliente: _maskTel(f.telefono),
            texto: f.valor,
            ts: f.registrado_en || null,
        }));
    }

    // Metadatos al frente (línea 0) para que el consumidor sepa qué trae.
    const meta = JSON.stringify({
        tipo: 'meta',
        generado_en: new Date().toISOString(),
        negocio, giro,
        conversaciones: stats.conversaciones,
        mensajes: stats.mensajes,
        fallbacks: stats.fallbacks,
        esquema: 'mensajes(paso_actual,intencion)+conversaciones.outcome+log_eventos.fallback',
    });

    const jsonl = [meta, ...lineas].join('\n') + '\n';
    return { jsonl, stats };
}

// ── Envío SMTP con adjunto (mismo patrón probado de scripts/backup.js) ──────
function _enviarConAdjunto({ user, pass, dest, asunto, cuerpo, adjunto }) {
    const destList = String(dest).split(',').map(d => d.trim()).filter(Boolean);
    const boundary = '----DatasetBnd' + crypto.randomBytes(8).toString('hex');
    const b64 = adjunto.data.toString('base64').match(/.{1,76}/g).join('\r\n');

    let body = [
        'From: Dataset ' + (_cfg('nombre_negocio', 'Bot')) + ' <' + user + '>',
        'To: ' + destList.join(', '),
        'Subject: ' + asunto,
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="' + boundary + '"',
        '',
        '--' + boundary,
        'Content-Type: text/plain; charset=utf-8',
        '',
        cuerpo,
        '',
        '--' + boundary,
        'Content-Type: application/gzip; name="' + adjunto.nombre + '"',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="' + adjunto.nombre + '"',
        '',
        b64,
        '--' + boundary + '--',
        '',
    ].join('\r\n');

    return smtpClient.sendMail({
        host: SMTP_HOST, port: SMTP_PORT, user, pass,
        mailFrom: user, to: destList, rawBody: body,
        ehloName: 'dataset.bot', timeoutMs: 30000,
    }).then(() => ({ ok: true })).catch((e) => ({
        ok: false,
        err: e.stage === 'tls' ? 'tls: ' + e.message
            : e.stage === 'socket' ? 'socket: ' + e.message
            : e.stage === 'timeout' ? 'timeout'
            : e.message, // stage 'smtp' → e.message ya trae "SMTP <code>: ..."
    }));
}

// ── API pública: construir + comprimir + enviar ──────────────────
async function exportarPorCorreo() {
    const user = _cfg('bot_email_usuario', process.env.EMAIL_USER || '');
    const pass = _cfg('bot_email_password', process.env.EMAIL_PASS || '');
    const dest = _cfg('email_backup_destino', process.env.BACKUP_DEST || user || '');

    if (!user || !pass) {
        return { ok: false, error: 'Falta el correo del bot (Prime > General → Correo del bot).' };
    }
    if (!dest) {
        return { ok: false, error: 'Falta el correo destino de backups (Prime > General → Contacto y backups).' };
    }

    const { jsonl, stats } = construirDatasetJSONL();
    if (stats.conversaciones === 0 && stats.fallbacks === 0) {
        return { ok: false, error: 'Todavía no hay conversaciones ni eventos para exportar.' };
    }

    const buf = await new Promise((resolve, reject) =>
        zlib.gzip(Buffer.from(jsonl, 'utf8'), (e, b) => e ? reject(e) : resolve(b)));

    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = 'dataset_llm_' + fecha + '.jsonl.gz';
    const cuerpo =
        'Exportación del dataset conversacional para entrenar un LLM (proceso aparte, fuera de producción).\n' +
        'Fecha: ' + new Date().toLocaleString('es-MX') + '\n\n' +
        'Conversaciones: ' + stats.conversaciones + '\n' +
        'Mensajes: ' + stats.mensajes + '\n' +
        'Eventos fallback (lo que el bot no entendió): ' + stats.fallbacks + '\n\n' +
        'Formato: JSONL comprimido (gzip). Una línea de metadatos, luego una por\n' +
        'conversación (con sus turnos etiquetados con paso/intención/outcome) y una\n' +
        'por evento de fallback. El teléfono va enmascarado.\n';

    const r = await _enviarConAdjunto({
        user, pass, dest,
        asunto: 'Dataset LLM ' + _cfg('nombre_negocio', 'Bot') + ' — ' + fecha,
        cuerpo,
        adjunto: { nombre, data: buf },
    });

    if (!r.ok) {
        log.warn('Export dataset LLM falló: ' + (r.err || 'desconocido'));
        return { ok: false, error: 'No se pudo enviar el correo: ' + (r.err || 'error SMTP') };
    }
    log.info('Dataset LLM exportado a ' + dest + ' (' + (buf.length / 1024).toFixed(0) + ' KB, ' +
        stats.conversaciones + ' conv / ' + stats.fallbacks + ' fallback)');
    return {
        ok: true,
        destino: dest,
        archivo: nombre,
        bytes: buf.length,
        ...stats,
    };
}

module.exports = { exportarPorCorreo, construirDatasetJSONL };
