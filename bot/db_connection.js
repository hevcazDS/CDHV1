// db_connection.js
'use strict';
const Database = require('better-sqlite3');
const path     = require('path');
require('dotenv').config({ quiet: true });

// ── Ruta de la DB desde .env — nunca hardcodeada ───────────────────────────
let DB_PATH = process.env.DB_PATH
    || path.join(__dirname, 'jugueteria.db'); // fallback: misma carpeta

// ── Selector de instancia (multitienda demo / una BD por tienda) ──────────
// Si Prime dejó un puntero en dashboard/.instancia_activa (ruta absoluta a un
// .db dentro de instancias/), TODOS los procesos abren ESA base al arrancar.
// Nunca se tocan los archivos de datos: cambiar de tienda = reescribir el
// puntero + reinicio limpio (pm2). Sin puntero (o roto) → la BD del .env,
// comportamiento de siempre. Ver dashboard/routes/instancias.js.
try {
    const fs = require('fs');
    const _ptr = path.join(__dirname, '..', 'dashboard', '.instancia_activa');
    if (fs.existsSync(_ptr)) {
        const _ruta = fs.readFileSync(_ptr, 'utf8').trim();
        const _dirInstancias = path.resolve(path.join(__dirname, '..', 'instancias'));
        // Solo se honran rutas DENTRO de instancias/ (el puntero no puede
        // apuntar a un archivo arbitrario del sistema).
        if (_ruta && path.resolve(_ruta).startsWith(_dirInstancias) && fs.existsSync(_ruta)) {
            DB_PATH = _ruta;
            console.log('[instancia] Abriendo la tienda: ' + path.basename(_ruta));
        }
    }
} catch (e) { console.error('[instancia] Puntero ilegible, se usa la BD del .env: ' + e.message); }

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

// ── Zona horaria del negocio ───────────────────────────────────────────────
// SIEMPRE por defecto MÉXICO CENTRO (America/Mexico_City), aunque el servidor
// (Docker/Ubuntu) corra en UTC — así datetime('now','localtime') de SQLite y
// new Date() de Node coinciden con la hora local del negocio. Precedencia:
//   env TZ (deploy)  >  configuracion.zona_horaria (solo Prime)  >  México Centro.
// Se fija aquí (dependencia común de todos los procesos) antes de cualquier
// operación de fecha. Cambiar la config requiere reiniciar para tomar efecto.
if (!process.env.TZ) {
    let _zona = 'America/Mexico_City';
    try { _zona = db.prepare("SELECT valor FROM configuracion WHERE clave='zona_horaria'").get()?.valor || _zona; } catch (_) {}
    process.env.TZ = _zona;
}

module.exports = db;
