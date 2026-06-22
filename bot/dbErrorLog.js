// dbErrorLog.js — registro de fallos en logs_error (tabla SQL consultable
// desde el dashboard), complemento de bot/logger.js (que solo escribe a
// archivo). Usado tanto por el bot como por dashboard/server.js, mismo
// patrón que db_connection.js (un módulo, dos procesos).
'use strict';
const db = require('./db_connection');

function registrarErrorDB(proceso, motivo, contexto) {
    try {
        db.prepare('INSERT INTO logs_error (proceso, motivo, contexto_json) VALUES (?, ?, ?)').run(
            String(proceso).slice(0, 100),
            String(motivo).slice(0, 500),
            contexto !== undefined ? JSON.stringify(contexto).slice(0, 2000) : null
        );
    } catch (_) { /* nunca debe tirar al caller — es un registro de mejor esfuerzo */ }
}

module.exports = { registrarErrorDB };
