// sessionManager.js — Map en memoria + TTL 30 min + persistencia SQLite
'use strict';
const db = require('./db_connection');
const log = require('./logger')('sessionManager');
const mensajeService = (() => { try { return require('../services/mensajeService'); } catch(_) { return { marcarOutcome: () => {} }; } })();

// ── Crear tabla si no existe ───────────────────────────────────────────────
// `version` requiere haber corrido `node scripts/migrate.js`
// (migrations/0010_sesiones_bot_version.sql) en instalaciones que ya tenían
// esta tabla -- CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla
// que ya existe. Ver CLAUDE.md: las migraciones son la fuente de verdad
// para cambios de esquema, no un ALTER TABLE inline más en este archivo.
db.exec(`
    CREATE TABLE IF NOT EXISTS sesiones_bot (
        id_usuario  TEXT PRIMARY KEY,
        paso_actual TEXT NOT NULL DEFAULT 'MENU',
        data_json   TEXT NOT NULL DEFAULT '{}',
        version     INTEGER NOT NULL DEFAULT 0
    )
`);

// ── Cache en memoria ───────────────────────────────────────────────────────
// Estructura: Map<userId, { paso_actual, data, updatedAt }>
const _cache    = new Map();
const TTL_MS    = 30 * 60 * 1000;   // 30 minutos sin actividad
const MAX_SES   = 500;               // máx sesiones activas en memoria

// Antes esta persistencia (carrito → carritos_abandonados, lo que hace que
// checkCarritosAbandonados() en services/stockWatcher.js le avise al cliente
// 2h después que su carrito sigue ahí) solo corría en la eviction por TTL —
// la eviction por tamaño (abajo, cuando el Map crece más de MAX_SES) borraba
// la sesión sin pasar por aquí, perdiendo el carrito sin aviso ni
// recuperación posible. Ahora ambas rutas usan la misma función.
function _expirarSesion(uid, ses) {
    const tel = uid.replace('@c.us', '');

    // Persistir carrito antes de expirar (para recuperación de abandono)
    if (ses && ses.data && (ses.data.carrito || []).length > 0) {
        try {
            db.prepare(`
                INSERT OR IGNORE INTO carritos_abandonados
                    (telefono, carrito_json, ultimo_paso)
                VALUES (?, ?, ?)
            `).run(
                tel,
                JSON.stringify(ses.data.carrito),
                ses.paso_actual
            );
        } catch (e) { log.debug('No se pudo persistir carrito abandonado: ' + e.message, { uid }); }
        mensajeService.marcarOutcome(db, tel, 'abandono');
    } else {
        // Sin carrito al expirar — si lo último que hizo el cliente fue
        // una búsqueda con 0 resultados, eso es un "callejón sin salida"
        // invisible hoy (no genera fila en carritos_abandonados porque
        // nunca hubo carrito). Se registra como evento adicional en
        // log_eventos — insumo para medir búsquedas que terminan en
        // abandono silencioso, sin tocar el esquema ni el flujo del bot.
        try {
            const ultimaBusqueda = db.prepare(`
                SELECT id, resultados FROM log_eventos
                WHERE telefono = ? AND tipo_evento = 'busqueda'
                ORDER BY id DESC LIMIT 1
            `).get(tel);
            if (ultimaBusqueda && ultimaBusqueda.resultados === 0) {
                const yaMarcado = db.prepare(`
                    SELECT id FROM log_eventos WHERE tipo_evento='busqueda_abandonada' AND valor=?
                `).get(String(ultimaBusqueda.id));
                if (!yaMarcado) {
                    db.prepare(`
                        INSERT INTO log_eventos (tipo_evento, canal, valor, telefono)
                        VALUES ('busqueda_abandonada', 'whatsapp', ?, ?)
                    `).run(String(ultimaBusqueda.id), tel);
                }
            }
        } catch (e) { log.debug('No se pudo registrar busqueda_abandonada: ' + e.message, { uid }); }
    }
}

// ── Limpieza periódica cada 5 min ──────────────────────────────────────────
setInterval(() => {
    const now    = Date.now();
    const cutoff = now - TTL_MS;
    const expired = [];

    for (const [uid, ses] of _cache) {
        if (ses.updatedAt < cutoff) expired.push(uid);
    }

    for (const uid of expired) {
        _expirarSesion(uid, _cache.get(uid));
        _cache.delete(uid);
    }

    // Si el cache sigue muy grande (burst de usuarios), limpiar los más viejos.
    // Mismo tratamiento que la expiración por TTL — antes se borraba sin
    // persistir el carrito (ver _expirarSesion arriba).
    if (_cache.size > MAX_SES) {
        const sorted = [..._cache.entries()]
            .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        const toDelete = sorted.slice(0, _cache.size - MAX_SES);
        for (const [uid, ses] of toDelete) {
            _expirarSesion(uid, ses);
            _cache.delete(uid);
        }
    }
}, 5 * 60 * 1000).unref();

// ── API pública ────────────────────────────────────────────────────────────

function getSession(userId) {
    const now = Date.now();

    // 1. Buscar en cache -- pero antes de confiar en él, un SELECT barato
    // (PK, prácticamente gratis) de solo `version` detecta si algo afuera de
    // este proceso (el dashboard, ej. /api/clientes/:id/reanudar-bot o
    // marketing.js's /api/beta/limpiar) escribió esta fila directo en SQLite
    // desde la última vez que se cacheó. Sin esto, ese cambio se ignoraba
    // hasta los 30 min de TTL del cache (bug real, ver migrations/
    // 0010_sesiones_bot_version.sql).
    if (_cache.has(userId)) {
        const ses = _cache.get(userId);
        if (ses.updatedAt < now - TTL_MS) {
            _cache.delete(userId);
        } else {
            let staleCache = false;
            try {
                const v = db.prepare('SELECT version FROM sesiones_bot WHERE id_usuario=?').get(userId);
                staleCache = !!v && v.version !== ses.version;
            } catch (e) { log.debug('No se pudo verificar version de sesion: ' + e.message, { userId }); }
            if (!staleCache) {
                ses.updatedAt = now;
                return { paso_actual: ses.paso_actual, data: ses.data };
            }
            _cache.delete(userId); // cae a recargar desde SQLite abajo
        }
    }

    // 2. Cargar desde SQLite
    try {
        const row = db.prepare('SELECT * FROM sesiones_bot WHERE id_usuario=?').get(userId);
        if (!row) return { paso_actual: 'MENU', data: {} };
        let data = {};
        try { data = JSON.parse(row.data_json); } catch (e) { log.debug('data_json corrupto en sesiones_bot: ' + e.message, { userId }); }
        _cache.set(userId, { paso_actual: row.paso_actual, data, version: row.version, updatedAt: now });
        return { paso_actual: row.paso_actual, data };
    } catch (err) {
        log.error('getSession error: ' + err.message, { userId });
        return { paso_actual: 'MENU', data: {} };
    }
}

function updateSession(userId, step, data = {}) {
    const now = Date.now();
    // `version` es simplemente Date.now() del proceso que escribe -- no
    // necesita ser un contador atómico de SQL (no se usa para concurrencia,
    // solo para que OTRO proceso detecte "esto cambió después de lo que
    // tengo cacheado"). Evita un round-trip extra de lectura antes de escribir.
    _cache.set(userId, { paso_actual: step, data, version: now, updatedAt: now });
    try {
        db.prepare('INSERT OR REPLACE INTO sesiones_bot (id_usuario, paso_actual, data_json, version) VALUES (?, ?, ?, ?)')
          .run(userId, step, JSON.stringify(data), now);
    } catch (err) {
        log.error('updateSession error: ' + err.message, { userId });
    }
}

function clearSession(userId) {
    const now = Date.now();
    _cache.set(userId, { paso_actual: 'MENU', data: {}, version: now, updatedAt: now });
    try {
        db.prepare("INSERT OR REPLACE INTO sesiones_bot (id_usuario, paso_actual, data_json, version) VALUES (?, 'MENU', '{}', ?)")
          .run(userId, now);
    } catch (err) {
        log.error('clearSession error: ' + err.message, { userId });
    }
}

module.exports = { getSession, updateSession, clearSession };
