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

// Bandeja de correo: bajar lo nuevo cada 5 min (doble-gate + fail-closed dentro
// de syncSiActivo). El mismo sync corre en el dashboard, por si el bot no está.
// ponytail: poll cada 5 min; IMAP IDLE (push) solo si hace falta tiempo real.
const _dbCorreo = require('../bot/db_connection');
const _correoInbox = require('./correoInbox');
setInterval(() => _correoInbox.syncSiActivo(_dbCorreo, log), 5 * 60_000);
_correoInbox.syncSiActivo(_dbCorreo, log);

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
