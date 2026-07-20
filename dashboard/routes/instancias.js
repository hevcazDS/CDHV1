'use strict';
// instancias.js — selector de tienda (una BD por tienda; multitienda demo).
// Cada archivo en instancias/*.db es una tienda completa e independiente
// (creada con scripts/crearInstanciaDemo.js). "Abrir" una tienda escribe el
// puntero dashboard/.instancia_activa y hace exit(0) limpio: pm2 reinicia el
// proceso (~3 s) y bot/db_connection.js abre ESA base. Los archivos de datos
// jamás se mueven ni se pisan (a diferencia del swap de restauración).
// Prime-only: cambiar de base es la operación más invasiva del panel.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');
const construirModulo = require('./_construirModulo');

const PM2_BIN = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
// Anti-DoS: cambiar de tienda tumba y levanta procesos — máximo 1 vez/minuto.
let _ultimoCambio = 0;

// Split-brain guard: el bot es OTRO proceso pm2 y también lee el puntero al
// arrancar — si está corriendo hay que reiniciarlo, o seguiría vendiendo
// contra la BD de la tienda ANTERIOR mientras el dashboard ya abrió la nueva.
// Solo restart si está online (pm2 restart sobre un stopped lo ARRANCARÍA,
// y el bot es bajo-demanda). Fire-and-forget: el exit(0) propio espera 2.5s.
function _reiniciarBotSiCorre(log) {
    const cmd = (args, cb) => process.platform === 'win32'
        ? execFile('cmd.exe', ['/d', '/s', '/c', `"${[PM2_BIN, ...args].map(a => `"${a}"`).join(' ')}"`], { timeout: 15000, windowsHide: true, windowsVerbatimArguments: true }, cb)
        : execFile(PM2_BIN, args, { timeout: 15000, windowsHide: true }, cb);
    cmd(['jlist'], (err, stdout) => {
        if (err) return log.warn('[instancia] No pude consultar pm2 (jlist): ' + err.message);
        let online = false;
        // recortar desde el primer '[' (pm2 antepone banners al JSON a veces)
        try { const s = String(stdout); online = JSON.parse(s.slice(s.indexOf('['))).some(p => p.name === 'bot-whatsapp' && p.pm2_env?.status === 'online'); } catch (_) {}
        if (!online) return;
        log.info('[instancia] Bot en línea → reiniciándolo para que abra la misma tienda');
        cmd(['restart', 'bot-whatsapp'], (e2) => { if (e2) log.warn('[instancia] restart del bot falló: ' + e2.message); });
    });
}

const DIR_INSTANCIAS = path.resolve(path.join(__dirname, '..', '..', 'instancias'));
const PUNTERO = path.join(__dirname, '..', '.instancia_activa');

function _instanciaActiva() {
    try {
        const r = fs.readFileSync(PUNTERO, 'utf8').trim();
        if (r && fs.existsSync(r)) return path.resolve(r);
    } catch (_) {}
    return null; // null = la BD principal del .env
}

// Nombre/giro de una BD sin abrirla en el pool principal (readonly, efímero)
function _metaDe(rutaDb) {
    let db;
    try {
        db = new Database(rutaDb, { readonly: true, fileMustExist: true });
        const cfg = (clave) => { try { return db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)?.valor || null; } catch (_) { return null; } };
        return { nombre: cfg('nombre_negocio'), giro: cfg('giro') };
    } catch (_) { return { nombre: null, giro: null }; }
    finally { try { db && db.close(); } catch (_) {} }
}

// GET /api/instancias — la principal + las de instancias/*.db (prime)
function listar(req, res, ctx) {
    const { json } = ctx;
    const activa = _instanciaActiva();
    const lista = [];
    const principal = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : null;
    if (principal && fs.existsSync(principal)) {
        lista.push({ clave: 'principal', archivo: path.basename(principal), ..._metaDe(principal), activa: activa === null });
    }
    try {
        for (const f of fs.readdirSync(DIR_INSTANCIAS).filter(x => x.endsWith('.db')).sort()) {
            const ruta = path.join(DIR_INSTANCIAS, f);
            lista.push({ clave: f, archivo: f, ..._metaDe(ruta), activa: activa === path.resolve(ruta) });
        }
    } catch (_) { /* sin carpeta instancias/ → solo la principal */ }
    return json(res, { instancias: lista, reinicio_segundos: 4 });
}

// POST /api/instancias/abrir { clave } — escribe el puntero y reinicia (prime)
function abrir(req, res, ctx, { ses }) {
    const { db, json, readBody, log } = ctx;
    return readBody(req, body => {
        try {
            const clave = String(JSON.parse(body || '{}').clave || '').trim();
            if (!clave) return json(res, { ok: false, error: 'Falta la tienda a abrir' }, 400);
            if (Date.now() - _ultimoCambio < 60000) {
                return json(res, { ok: false, error: 'Espera un minuto entre cambios de tienda (el sistema se reinicia en cada cambio)' }, 429);
            }
            if (clave === 'principal') {
                try { fs.unlinkSync(PUNTERO); } catch (_) {}
            } else {
                // Solo nombres de archivo planos dentro de instancias/ (sin rutas)
                if (clave !== path.basename(clave) || !clave.endsWith('.db')) {
                    return json(res, { ok: false, error: 'Tienda inválida' }, 400);
                }
                const ruta = path.join(DIR_INSTANCIAS, clave);
                if (!fs.existsSync(ruta)) return json(res, { ok: false, error: 'Esa tienda no existe en instancias/' }, 404);
                fs.writeFileSync(PUNTERO, path.resolve(ruta), 'utf8');
            }
            _ultimoCambio = Date.now();
            try { require('../../services/configAudit').logCambio(db, 'instancia_activa', clave, ses.username); } catch (_) {}
            log.info('[instancia] ' + ses.username + ' abre la tienda: ' + clave + ' — reiniciando dashboard' );
            _reiniciarBotSiCorre(log);
            json(res, { ok: true, reiniciando: true, clave });
            // Salida limpia diferida (pm2 autorestart nos levanta con la BD del
            // puntero); 2.5s dan tiempo a que el restart del bot se emita.
            setTimeout(() => process.exit(0), 2500);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

const RUTAS = [
    { metodo: 'GET',  path: '/api/instancias',       roles: ['prime'], handler: listar },
    { metodo: 'POST', path: '/api/instancias/abrir', roles: ['prime'], handler: abrir },
];

module.exports = construirModulo(RUTAS, { prefijo: '/api/instancias' });
