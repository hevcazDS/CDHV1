// db_connection.js
'use strict';
const Database = require('better-sqlite3');
const path     = require('path');
require('dotenv').config({ quiet: true });

// ── Ruta de la DB desde .env — nunca hardcodeada ───────────────────────────
const DB_PATH = process.env.DB_PATH
    || path.join(__dirname, 'jugueteria.db'); // fallback: misma carpeta

// Restauración: si Prime dejó un archivo '<DB>.restore' validado, se hace
// el swap ANTES de abrir la BD (nunca se reemplaza un archivo abierto). El
// original se conserva como '.pre-restore-<ts>' por si acaso.
try {
    const fs = require('fs');
    const _stage = DB_PATH + '.restore';
    if (fs.existsSync(_stage)) {
        if (fs.existsSync(DB_PATH)) {
            const _ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
            try { fs.renameSync(DB_PATH, DB_PATH + '.pre-restore-' + _ts); } catch (_) {}
            // limpiar los WAL/SHM viejos para que no choquen con la BD nueva
            for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(DB_PATH + ext); } catch (_) {} }
        }
        fs.renameSync(_stage, DB_PATH);
        console.log('[restore] Base de datos restaurada desde respaldo. Original guardado como .pre-restore-*');
    }
} catch (e) { console.error('[restore] No se pudo aplicar la restauración: ' + e.message); }

let db;
try {
    db = new Database(DB_PATH, { readonly: false });
} catch (e) {
    // Log del código y RETHROW (no exit): pm2 registra el crash con el
    // código y los tests pueden interceptar el módulo como siempre
    console.error('[HS-101] Base de datos inaccesible (' + (process.env.DB_PATH || 'DB_PATH sin definir') + '): ' + e.message);
    throw e;
}

// WAL mode para mejor rendimiento concurrente
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');   // espera hasta 5s ante un lock en vez de tirar SQLITE_BUSY
db.pragma('foreign_keys = ON');

module.exports = db;
