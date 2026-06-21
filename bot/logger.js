// logger.js — Sistema de logging estructurado
// Reemplaza console.log/warn/error con niveles, timestamps y userId
// Uso: const log = require('./logger')('modulo')
//      log.info('mensaje', { userId, extra })
//      log.warn('advertencia')
//      log.error('error crítico', error)
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Configuración ──────────────────────────────────────────────
const LOG_DIR   = path.join(__dirname, 'logs');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // debug|info|warn|error
const LOG_FILE  = process.env.LOG_FILE  || path.join(LOG_DIR, 'bot.log');
const IS_PROD   = process.env.NODE_ENV === 'production';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
    debug: '\x1b[36m', info: '\x1b[32m',
    warn:  '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m'
};

// Crear carpeta de logs si no existe
try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch(_) {}

// Stream de archivo (append)
let _stream = null;
try {
    _stream = fs.createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' });
    _stream.on('error', () => { _stream = null; });
} catch(_) {}

// Redacta cualquier corrida de 10-13 dígitos sueltos en texto libre (no solo
// meta.userId) — antes solo se redactaba el teléfono cuando venía en ese
// campo; un número de teléfono dentro de `msg` o de `extra` (ej. el mensaje
// de un Error que incluye el dato que lo disparó) pasaba sin filtrar.
function _redactarTelefonos(texto) {
    return typeof texto === 'string'
        ? texto.replace(/\d{10,13}/g, m => m.slice(0, 3) + '***' + m.slice(-4))
        : texto;
}

function formatMsg(level, modulo, msg, meta) {
    const ts   = new Date().toISOString();
    const tel  = meta?.userId ? meta.userId.replace(/(\d{3})\d+(\d{4})/, '$1***$2') : '';
    const extra = meta && Object.keys(meta).filter(k => k !== 'userId').length
        ? ' ' + _redactarTelefonos(JSON.stringify(Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'userId'))))
        : '';
    return `${ts} [${level.toUpperCase()}] [${modulo}]${tel ? ' ' + tel : ''} ${_redactarTelefonos(String(msg))}${extra}`;
}

function write(level, modulo, msg, meta) {
    if (LEVELS[level] < LEVELS[LOG_LEVEL]) return;

    const line = formatMsg(level, modulo, msg, meta);

    const stack = meta instanceof Error ? _redactarTelefonos(meta.stack) : null;

    // Consola con colores
    const color = COLORS[level] || '';
    if (level === 'error') {
        console.error(color + line + COLORS.reset);
        if (stack) console.error(stack);
    } else if (level === 'warn') {
        console.warn(color + line + COLORS.reset);
    } else {
        console.log(color + line + COLORS.reset);
    }

    // Archivo sin colores
    if (_stream) {
        const fileLine = stack ? line + '\n  ' + stack : line;
        _stream.write(fileLine + '\n');
    }
}

// ── Factory — devuelve un logger por módulo ────────────────────
function createLogger(modulo) {
    return {
        debug: (msg, meta) => write('debug', modulo, msg, meta),
        info:  (msg, meta) => write('info',  modulo, msg, meta),
        warn:  (msg, meta) => write('warn',  modulo, msg, meta),
        error: (msg, meta) => write('error', modulo, msg, meta),
    };
}

// Logger global para uso directo
createLogger.root = createLogger('app');

module.exports = createLogger;
