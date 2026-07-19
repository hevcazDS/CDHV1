// stockWatcher.worker.js — Proceso hijo independiente para stockWatcher
// Se lanza desde index.js con child_process.fork()
// Si crashea, el bot principal sigue vivo
'use strict';

// Cargar .env
require('dotenv').config({ quiet: true });

const log = require('../bot/logger')('stockWatcher.worker');
const stockWatcher = require('./stockWatcher');

// Ejecutar inmediatamente al arrancar
stockWatcher.runAll();

// Repetir cada hora
setInterval(() => {
    stockWatcher.runAll();
}, 60 * 60_000);

// Bandeja de correo: bajar lo nuevo cada 5 min si el módulo está ON y hay cuenta
// configurada. Doble-gate + fail-closed: sin módulo/credenciales no hace nada.
// ponytail: poll cada 5 min; IMAP IDLE (push) solo si hace falta tiempo real.
const _dbCorreo = require('../bot/db_connection');
const _correoInbox = require('./correoInbox');
async function _syncCorreo() {
    try {
        const on = _dbCorreo.prepare("SELECT valor FROM configuracion WHERE clave='correo_activo'").get()?.valor === '1';
        if (!on || !_correoInbox.configurado(_dbCorreo)) return;
        const r = await _correoInbox.sincronizar(_dbCorreo);
        if (r.ok && r.nuevos) log.info('correo: ' + r.nuevos + ' nuevo(s) en la bandeja');
        else if (!r.ok) log.debug('correo sync: ' + r.error);
    } catch (e) { log.debug('correo sync: ' + e.message); }
}
setInterval(_syncCorreo, 5 * 60_000);
_syncCorreo();

// Comunicación con proceso padre
process.on('message', (msg) => {
    if (msg === 'run') stockWatcher.runAll();
    if (msg === 'ping') process.send('pong');
});

process.on('uncaughtException', (e) => {
    log.error('Error no capturado', e);
    // No morir — seguir corriendo
});

process.on('unhandledRejection', (e) => {
    log.error('Promesa rechazada', e instanceof Error ? e : new Error(String(e)));
});

log.info('Proceso iniciado', { pid: process.pid });
