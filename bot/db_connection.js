// db_connection.js
'use strict';
const Database = require('better-sqlite3');
const path     = require('path');
require('dotenv').config({ quiet: true });

// ── Ruta de la DB desde .env — nunca hardcodeada ───────────────────────────
const DB_PATH = process.env.DB_PATH
    || path.join(__dirname, 'jugueteria.db'); // fallback: misma carpeta

let db;
try {
    db = new Database(DB_PATH, { readonly: false });
} catch (e) {
    console.error('[HS-101] Base de datos inaccesible (' + (process.env.DB_PATH || 'DB_PATH sin definir') + '): ' + e.message);
    process.exit(1);
}

// WAL mode para mejor rendimiento concurrente
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');   // espera hasta 5s ante un lock en vez de tirar SQLITE_BUSY
db.pragma('foreign_keys = ON');

module.exports = db;
