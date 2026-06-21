// dashboard.js — Servidor HTTP del dashboard de operaciones
// Corre en: http://localhost:3001
// Inicio: node dashboard.js  (independiente del bot)
// Funciones:
//   - Ver pedidos y su estatus
//   - Ver guías Estafeta simuladas
//   - Enviar notificaciones de estatus a cliente por WhatsApp
//   - Envío masivo de promociones a clientes registrados

'use strict';
const http  = require('http');
const path  = require('path');
const fs    = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, VentaPreviaSchema, NegocioSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, UsuarioSchema, UsuarioUpdateSchema, safeEqual } = require('../bot/validators');
require('dotenv').config({ quiet: true });
const log = require('../bot/logger')('dashboard');

// Respaldo de último recurso para código fuera del try/catch de cada request
// (setInterval de limpieza, callbacks de pm2(), etc). El try/catch alrededor
// de handleRequest cubre el caso común; esto es para que NUNCA se caiga el
// proceso entero por una excepción que se nos escapó de cubrir.
process.on('uncaughtException',  e => log.error('🔴 CRÍTICO (dashboard)', e));
process.on('unhandledRejection', e => log.error('🔴 PROMESA (dashboard)', e instanceof Error ? e : new Error(String(e))));

// ── Control del bot vía PM2 — mismo mecanismo en Windows y NixOS/Linux,
// ya es lo que usan start:all/stop en package.json. No se reinventa nada,
// solo se expone por HTTP para que una ventana (navegador en modo app,
// Electron, lo que sea) pueda prender/apagar/monitorear sin terminal.
const ECOSYSTEM_PATH = path.join(__dirname, '..', 'ecosystem.config.js');
// pm2 global se instala como pm2.cmd en Windows. En ese caso, la forma
// confiable de ejecutar el comando es pasarle el shell de Windows y una
// cadena completa, porque execFile() no lanza correctamente archivos .cmd.
const PM2_BIN = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
function pm2(args, cb) {
    if (process.platform === 'win32') {
        const command = [PM2_BIN, ...args].map(arg => `"${String(arg).replace(/"/g, '\\"')}"`).join(' ');
        execFile('cmd.exe', ['/d', '/s', '/c', command], { timeout: 15000 }, (err, stdout, stderr) => cb(err, stdout, stderr));
        return;
    }
    execFile(PM2_BIN, args, { timeout: 15000 }, (err, stdout, stderr) => cb(err, stdout, stderr));
}

const PORT  = parseInt(process.env.DASHBOARD_PORT || '3001');
const DASH_USER = process.env.DASHBOARD_USER || 'admin';
const DASH_PASS = process.env.DASHBOARD_PASS || 'cambiar_esto';
const DASH_NOMBRE = process.env.DASHBOARD_NOMBRE || DASH_USER;

// Por defecto el dashboard escucha en 127.0.0.1 (un solo equipo por tienda vía
// Electron), así que la cookie sin "Secure" no viaja por red. Si el despliegue
// cambia (ej. detrás de un reverse proxy HTTPS, accesible por LAN), activar
// DASHBOARD_COOKIE_SECURE=true para que el navegador exija HTTPS en la cookie.
const COOKIE_SECURE = process.env.DASHBOARD_COOKIE_SECURE === 'true';
const COOKIE_SECURE_FLAG = COOKIE_SECURE ? '; Secure' : '';

// Usuario prime — tier separado, solo para encender las APIs reales
// (pago/Estafeta). Sin USER_PRIME/USER_PRIME_PASSWORD en .env, este tier
// queda inalcanzable (ninguna credencial puede pasar safeEqual contra '').
const USER_PRIME          = process.env.USER_PRIME || '';
const USER_PRIME_PASSWORD = process.env.USER_PRIME_PASSWORD || '';
const USER_PRIME_NOMBRE   = process.env.USER_PRIME_NOMBRE || USER_PRIME || '';

// ── Rate limiting por IP ──────────────────────────────────────────────────
const _rlMap = new Map();
function rateLimit(req, res, max = 30, windowMs = 60000) {
    const ip  = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const d   = _rlMap.get(ip) || { count: 0, reset: now + windowMs };
    if (now > d.reset) { d.count = 0; d.reset = now + windowMs; }
    d.count++;
    _rlMap.set(ip, d);
    if (d.count > max) {
        res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '60' });
        res.end('429 Too Many Requests');
        return false;
    }
    return true;
}
// Limpiar el mapa cada 5 minutos para no acumular IPs
setInterval(() => {
    const now = Date.now();
    for (const [ip, d] of _rlMap) if (d.reset < now) _rlMap.delete(ip);
}, 5 * 60_000).unref();

// ── Bloqueo de cuenta por intentos fallidos de login ────────────────────────
// El rate-limit por IP de arriba ya frena ráfagas (30 POST/min/IP), pero no
// evita que alguien pruebe ~30 contraseñas/min indefinidamente contra UNA
// cuenta concreta. Esto agrega un segundo límite, por username, independiente
// de la IP desde la que se intente.
const LOGIN_MAX_INTENTOS = 5;
const LOGIN_WINDOW_MS    = 15 * 60_000;
const LOGIN_LOCKOUT_MS   = 15 * 60_000;
const _loginAttempts = new Map(); // username -> { count, firstAttempt, lockedUntil }

function loginBloqueado(username) {
    const a = _loginAttempts.get(username);
    if (!a) return false;
    if (a.lockedUntil && a.lockedUntil > Date.now()) return true;
    if (a.lockedUntil && a.lockedUntil <= Date.now()) _loginAttempts.delete(username);
    return false;
}
function registrarIntentoFallido(username) {
    const now = Date.now();
    const a = _loginAttempts.get(username) || { count: 0, firstAttempt: now, lockedUntil: null };
    if (now - a.firstAttempt > LOGIN_WINDOW_MS) { a.count = 0; a.firstAttempt = now; }
    a.count++;
    if (a.count >= LOGIN_MAX_INTENTOS) a.lockedUntil = now + LOGIN_LOCKOUT_MS;
    _loginAttempts.set(username, a);
}
function limpiarIntentosLogin(username) { _loginAttempts.delete(username); }
setInterval(() => {
    const now = Date.now();
    for (const [username, a] of _loginAttempts) {
        if (a.lockedUntil ? a.lockedUntil < now : (now - a.firstAttempt > LOGIN_WINDOW_MS)) _loginAttempts.delete(username);
    }
}, 5 * 60_000).unref();

const db = require('../bot/db_connection');
const mensajeService = require('../services/mensajeService');
const ventaPreviaService = require('../services/ventaPreviaService');
const reporteService = require('../services/reporteService');
const { searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio } = require('../bot/flows/_shared');
const filtroPalabras = require('../bot/filtroPalabras');
db.prepare("CREATE TABLE IF NOT EXISTS configuracion (clave TEXT PRIMARY KEY, valor TEXT NOT NULL DEFAULT '1', descripcion TEXT, actualizado_en TEXT DEFAULT (datetime('now','localtime')))").run();
filtroPalabras.asegurarTabla(db);

// ── Usuarios + sesiones — login real en vez de pop-up de Basic Auth ────────
// "Prime" deja de ser una sección/realm aparte y pasa a ser un rol de usuario.
db.prepare(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('admin','prime')),
    creado_en TEXT DEFAULT (datetime('now','localtime'))
)`).run();

// CREATE TABLE IF NOT EXISTS no hace nada si ya existía una tabla `usuarios`
// con otra forma (instalaciones de antes de que existiera el login real).
// Sin esto, crearUsuarioSiNoExiste truena en el primer arranque con
// "no such column: username" y pm2 reinicia el proceso en bucle infinito.
// No se puede agregar username/rol como NOT NULL ni UNIQUE vía ALTER TABLE
// si la tabla ya tiene filas, así que se agregan sueltas y la unicidad de
// username se garantiza con un índice aparte en vez del constraint inline.
function _asegurarColumnasUsuarios(db) {
    try {
        const cols = db.prepare("PRAGMA table_info(usuarios)").all();
        if (!cols.length) return; // la tabla no existe todavía -- la crea el CREATE TABLE de arriba
        const nombres = cols.map(c => c.name);
        // SQLite no deja ALTER TABLE ADD COLUMN con un DEFAULT no constante
        // (como datetime('now')) si la tabla ya tiene filas, así que creado_en
        // se agrega en blanco y se rellena aparte con un UPDATE.
        const requeridas = ['username', 'nombre', 'email', 'password_hash', 'salt', 'rol', 'id_rol', 'creado_en'];
        for (const nombre of requeridas) {
            if (!nombres.includes(nombre)) {
                const sql = nombre === 'id_rol'
                    ? `ALTER TABLE usuarios ADD COLUMN ${nombre} INTEGER`
                    : `ALTER TABLE usuarios ADD COLUMN ${nombre} TEXT`;
                db.prepare(sql).run();
            }
        }
        db.prepare("UPDATE usuarios SET nombre = COALESCE(NULLIF(TRIM(nombre), ''), username, 'Usuario') WHERE nombre IS NULL OR TRIM(nombre) = ''").run();
        db.prepare("UPDATE usuarios SET email = CASE WHEN email IS NULL OR TRIM(email) = '' THEN COALESCE(NULLIF(TRIM(username), ''), 'usuario') || '@local' ELSE email END WHERE email IS NULL OR TRIM(email) = ''").run();
        db.prepare("UPDATE usuarios SET id_rol = CASE WHEN id_rol IS NULL THEN CASE WHEN rol = 'prime' THEN 2 ELSE 1 END ELSE id_rol END WHERE id_rol IS NULL").run();
        db.prepare("UPDATE usuarios SET creado_en = datetime('now','localtime') WHERE creado_en IS NULL").run();
        db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username)').run();
    } catch (e) {
        log.error('No se pudo verificar columnas de usuarios', e);
    }
}
_asegurarColumnasUsuarios(db);

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}
function crearUsuarioSiNoExiste(username, password, rol, nombreOverride = null) {
    if (!username || !password) return;
    const usernameNorm = String(username).trim();
    const nombre = String(nombreOverride || usernameNorm).trim() || usernameNorm;
    if (!usernameNorm || !nombre) return;
    if (db.prepare('SELECT id FROM usuarios WHERE username=?').get(usernameNorm)) return;
    const salt = crypto.randomBytes(16).toString('hex');
    const email = `${usernameNorm.toLowerCase()}@local`;
    const idRol = rol === 'prime' ? 2 : 1;
    db.prepare('INSERT INTO usuarios (username, nombre, email, password_hash, id_rol, salt, rol) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(usernameNorm, nombre, email, hashPassword(password, salt), idRol, salt, rol);
}
// Semilla única desde las credenciales que ya existían en .env — así no se
// necesita todavía una pantalla de gestión de usuarios para arrancar.
// En try/catch: una fila legada duplicada (mismo username en dos filas, de
// antes del índice único de _asegurarColumnasUsuarios) haría que el INSERT
// truene aquí, a nivel de módulo, y tirara el proceso en cada arranque.
try {
    crearUsuarioSiNoExiste(DASH_USER, DASH_PASS, 'admin', DASH_NOMBRE);
    if (USER_PRIME && USER_PRIME_PASSWORD) crearUsuarioSiNoExiste(USER_PRIME, USER_PRIME_PASSWORD, 'prime', USER_PRIME_NOMBRE);
} catch (e) {
    log.error('No se pudo crear/verificar el usuario semilla', e);
}

// ── Historial de estatus del bot — para que el widget del header no solo
// muestre "inactivo" sin contexto, sino cuándo y por qué cambió.
db.prepare(`CREATE TABLE IF NOT EXISTS bot_status_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estatus TEXT NOT NULL,
    motivo TEXT,
    registrado_en TEXT DEFAULT (datetime('now','localtime'))
)`).run();
let _ultimoEstatusBot = null;
function registrarCambioEstatusBot(estatus, motivo) {
    if (estatus === _ultimoEstatusBot) return;
    _ultimoEstatusBot = estatus;
    db.prepare('INSERT INTO bot_status_log (estatus, motivo) VALUES (?, ?)').run(estatus, motivo || null);
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h

// Persistencia de sesiones — el Map en memoria sigue siendo la ruta caliente
// (se consulta en cada request), pero se respalda en SQLite para que un
// restart del proceso (deploy, crash, pm2 restart) no desconecte a todos los
// usuarios logueados.
db.prepare(`CREATE TABLE IF NOT EXISTS sesiones_dashboard (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    rol TEXT NOT NULL,
    expira INTEGER NOT NULL
)`).run();

const _sesiones = new Map(); // token -> { username, rol, expira }
(function _cargarSesionesPersistidas() {
    try {
        const ahora = Date.now();
        const filas = db.prepare('SELECT token, username, rol, expira FROM sesiones_dashboard WHERE expira > ?').all(ahora);
        for (const f of filas) _sesiones.set(f.token, { username: f.username, rol: f.rol, expira: f.expira });
        db.prepare('DELETE FROM sesiones_dashboard WHERE expira <= ?').run(ahora);
    } catch (e) { log.warn('No se pudieron cargar sesiones persistidas', e); }
})();

function crearSesion(username, rol) {
    const token = crypto.randomBytes(32).toString('hex');
    const expira = Date.now() + SESSION_TTL_MS;
    _sesiones.set(token, { username, rol, expira });
    db.prepare('INSERT OR REPLACE INTO sesiones_dashboard (token, username, rol, expira) VALUES (?, ?, ?, ?)').run(token, username, rol, expira);
    return token;
}
function obtenerSesion(req) {
    const cookie = req.headers['cookie'] || '';
    const m = cookie.match(/(?:^|;\s*)jc_session=([a-f0-9]+)/);
    if (!m) return null;
    const s = _sesiones.get(m[1]);
    if (!s) return null;
    if (Date.now() > s.expira) {
        _sesiones.delete(m[1]);
        db.prepare('DELETE FROM sesiones_dashboard WHERE token=?').run(m[1]);
        return null;
    }
    return { token: m[1], username: s.username, rol: s.rol };
}
function eliminarSesion(token) {
    _sesiones.delete(token);
    db.prepare('DELETE FROM sesiones_dashboard WHERE token=?').run(token);
}
setInterval(() => {
    const now = Date.now();
    for (const [token, s] of _sesiones) if (now > s.expira) eliminarSesion(token);
}, 10 * 60_000).unref();

// Reemplaza requireAuth/requireAuthPrime: una sola sesión, el rol decide qué rutas alcanza.
function requireSession(req, res, rolesPermitidos) {
    const s = obtenerSesion(req);
    if (!s || (rolesPermitidos && !rolesPermitidos.includes(s.rol))) {
        json(res, { ok: false, error: 'No autorizado' }, 401);
        return null;
    }
    return s;
}

// ── Helper: respuesta JSON ─────────────────────────────────────────────────
// ── Headers de seguridad HTTP ─────────────────────────────────────────────
const SECURITY_HEADERS = {
    'X-Frame-Options':           'DENY',
    'X-Content-Type-Options':    'nosniff',
    'X-XSS-Protection':          '1; mode=block',
    'Referrer-Policy':           'no-referrer',
    'Content-Security-Policy':   "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    'Strict-Transport-Security': 'max-age=31536000',
    'Cache-Control':             'no-store, no-cache, must-revalidate',
};

function json(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': 'http://localhost:' + PORT, // solo origen local
        ...SECURITY_HEADERS,
    });
    res.end(JSON.stringify(data));
}

// ── Helper: acumular el body de la request y pasarlo a cb como string ──────
// Reemplaza el bloque `let body=''; req.on('data',...); req.on('end',...)`
// que se repetía copiado en cada endpoint POST/PUT/DELETE.
function readBody(req, cb) {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => cb(body));
}

// ── Helper: valida un objeto ya parseado contra un schema Zod. Si falla, ya
// escribe la respuesta 400 y regresa null (el caller solo necesita
// "if (!datos) return;") — reemplaza el bloque de 3 líneas que se repetía
// copiado en cada ruta POST/PUT (parsear -> safeParse -> 400 si falla).
function validar(parsed, schema, res) {
    const v = schema.safeParse(parsed);
    if (!v.success) { json(res, { ok: false, error: v.error }, 400); return null; }
    return v.data;
}

// Columnas permitidas por tabla para actualizarCampos() — defensa en
// profundidad: hoy `datos` ya viene validado por Zod (SucursalUpdateSchema/
// ProductoUpdateSchema, que no usan .passthrough() y por eso ya descartan
// claves desconocidas), pero esta lista explícita evita que un futuro cambio
// en el schema, o una nueva ruta que reutilice este helper sin pasar por
// Zod, pueda terminar escribiendo en una columna arbitraria de la tabla. Una
// tabla sin entrada aquí no acepta ningún campo — agrégala al usar este
// helper para un nuevo endpoint.
const TABLAS_ACTUALIZABLES = {
    sucursales: ['nombre', 'codigo', 'direccion', 'activa'],
    productos: ['name', 'cat', 'price', 'url_imagen', 'tags', 'seo_description',
        'edad_recomendada', 'edad_min', 'genero', 'stock_tienda', 'stock_cedis',
        'stock_san_luis_potosi', 'activo'],
    inventarios: ['stock_minimo'],
};

// ── Helper: UPDATE dinámico a partir de los campos presentes en `datos`,
// filtrados contra TABLAS_ACTUALIZABLES. Reemplaza el bloque de
// "campos/sets/valores" que se repetía en cada ruta PUT de edición parcial
// (sucursales, productos, ...).
function actualizarCampos(tabla, id, datos) {
    const permitidas = TABLAS_ACTUALIZABLES[tabla] || [];
    const campos = Object.keys(datos).filter(c => permitidas.includes(c));
    if (!campos.length) return false;
    const sets = campos.map(c => `${c}=?`).join(', ');
    const valores = campos.map(c => typeof datos[c] === 'boolean' ? (datos[c] ? 1 : 0) : datos[c]);
    db.prepare(`UPDATE ${tabla} SET ${sets} WHERE id=?`).run(...valores, id);
    return true;
}

// Construye la lista de clientes destinatarios de un envío masivo a partir
// de los mismos filtros que usa tanto la vista previa como el envío real,
// para que nunca puedan divergir entre sí. Vive a nivel de módulo (antes era
// una function declaration dentro de handleAPI, así que se redefinía en
// cada request) — solo depende de `db` y de sus parámetros explícitos.
function construirAudienciaMasivo({ soloConPedido, excluirTags, soloTags, sinActividad }) {
    const _tagsExcluir = ['troll','blacklist','devolucion','queja'].concat(
        Array.isArray(excluirTags) ? excluirTags : []
    );
    const _exclCond   = _tagsExcluir.map(() => "COALESCE(c.tags,'') NOT LIKE ?").join(' AND ');
    const _exclParams = _tagsExcluir.map(t => '%' + t + '%');

    let q, params;
    if (sinActividad) {
        q = `SELECT c.id, c.telefono, c.nombre, COALESCE(c.tags,'') AS tags
             FROM clientes c JOIN pedidos p ON p.id_cliente = c.id
             WHERE c.activo=1 AND c.telefono IS NOT NULL AND c.telefono != ''
               AND (${_exclCond})
             GROUP BY c.id
             HAVING datetime(MAX(p.creado_en), '+30 days') <= datetime('now','localtime')`;
        params = _exclParams;
    } else if (soloConPedido) {
        q = `SELECT DISTINCT c.id, c.telefono, c.nombre, COALESCE(c.tags,'') AS tags
             FROM clientes c JOIN pedidos p ON p.cliente = c.nombre
             WHERE c.activo=1 AND c.telefono IS NOT NULL AND c.telefono != ''
               AND (${_exclCond})`;
        params = _exclParams;
    } else {
        q = `SELECT c.id, c.telefono, c.nombre, COALESCE(c.tags,'') AS tags
             FROM clientes c
             WHERE c.activo=1 AND c.telefono IS NOT NULL AND c.telefono != ''
               AND (${_exclCond})`;
        params = _exclParams;
    }

    // Filtrar por tag específico
    if (soloTags && soloTags.length > 0) {
        const _tagCond = soloTags.map(() => "COALESCE(c.tags,'') LIKE ?").join(' OR ');
        q += ' AND (' + _tagCond + ')';
        params = params.concat(soloTags.map(t => '%' + t + '%'));
    }

    return db.prepare(q).all(...params);
}

// ── API ────────────────────────────────────────────────────────────────────
function handleAPI(req, res) {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const p = u.pathname;

    // POST /api/login {username, password} — reemplaza el pop-up de Basic Auth
    if (p === '/api/login' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { username, password } = JSON.parse(body || '{}');
                const uname = String(username || '');
                if (loginBloqueado(uname)) {
                    return json(res, { ok: false, error: 'Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intenta de nuevo en unos minutos.' }, 429);
                }
                const u2 = db.prepare('SELECT * FROM usuarios WHERE username=?').get(uname);
                if (!u2 || !safeEqual(hashPassword(String(password || ''), u2.salt), u2.password_hash)) {
                    registrarIntentoFallido(uname);
                    return json(res, { ok: false, error: 'Usuario o contraseña incorrectos' }, 401);
                }
                limpiarIntentosLogin(uname);
                const token = crearSesion(u2.username, u2.rol);
                res.setHeader('Set-Cookie', `jc_session=${token}; HttpOnly; SameSite=Lax${COOKIE_SECURE_FLAG}; Max-Age=${SESSION_TTL_MS / 1000}; Path=/`);
                return json(res, { ok: true, username: u2.username, rol: u2.rol });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // POST /api/logout
    if (p === '/api/logout' && req.method === 'POST') {
        const s = obtenerSesion(req);
        if (s) eliminarSesion(s.token);
        res.setHeader('Set-Cookie', `jc_session=; HttpOnly; SameSite=Lax${COOKIE_SECURE_FLAG}; Max-Age=0; Path=/`);
        return json(res, { ok: true });
    }

    // GET /api/me — quién soy / si mi sesión sigue viva (para el shell de React)
    if (p === '/api/me' && req.method === 'GET') {
        const s = obtenerSesion(req);
        if (!s) return json(res, { ok: false }, 401);
        return json(res, { ok: true, username: s.username, rol: s.rol });
    }

    // GET /api/pedidos
    if (p === '/api/pedidos' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT p.id_pedido, p.folio, p.cliente, p.estatus, p.ciudad_envio,
                   p.email_notificado, p.creado_en,
                   lp.id AS id_link_pago, lp.monto AS total, lp.estatus AS pago_estatus, lp.url_link,
                   g.numero_guia, g.estatus AS guia_estatus,
                   g.fecha_envio_est, g.fecha_entrega_est
            FROM pedidos p
            LEFT JOIN links_pago lp ON lp.id_pedido = p.id_pedido
            LEFT JOIN guias_estafeta g ON g.id_pedido = p.id_pedido
            ORDER BY p.id_pedido DESC LIMIT 100
        `).all();
        return json(res, rows);
    }

    // GET /api/clientes
    if (p === '/api/clientes' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const q   = (_u.searchParams.get('q')  ||'').trim();
        const tag = (_u.searchParams.get('tag') ||'').trim();
        let sql = "SELECT id, nombre, telefono, email, canal_origen, creado_en, ultima_actividad, codigo_referido, COALESCE(tags,'') AS tags FROM clientes WHERE activo=1";
        const params = [];
        if (q)   { sql += ' AND (nombre LIKE ? OR telefono LIKE ?)'; params.push('%'+q+'%','%'+q+'%'); }
        if (tag) { sql += " AND COALESCE(tags,'') LIKE ?"; params.push('%'+tag+'%'); }
        sql += ' ORDER BY ultima_actividad DESC, creado_en DESC LIMIT 300';
        const rows = db.prepare(sql).all(...params);
        // Backfill perezoso: clientes creados antes del programa de referidos
        // (o por una vía que no sea el primer-contacto) aún no tienen código —
        // se genera aquí mismo para que el asesor siempre tenga uno que mencionar.
        const { asegurarCodigoReferido } = require('../bot/handlers/referidosService');
        for (const r of rows) {
            if (!r.codigo_referido) r.codigo_referido = asegurarCodigoReferido(r.id);
        }
        return json(res, rows);
    }

    // GET /api/guias
    if (p === '/api/guias' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT g.*, p.cliente, p.ciudad_envio
            FROM guias_estafeta g
            JOIN pedidos p ON p.id_pedido = g.id_pedido
            ORDER BY g.id DESC LIMIT 100
        `).all();
        return json(res, rows);
    }

    // GET /api/stats
    if (p === '/api/stats' && req.method === 'GET') {
        const stats = {
            pedidos_hoy: db.prepare("SELECT COUNT(*) c FROM pedidos WHERE date(creado_en)=date('now','localtime')").get()?.c || 0,
            pedidos_total: db.prepare("SELECT COUNT(*) c FROM pedidos").get()?.c || 0,
            clientes_total: db.prepare("SELECT COUNT(*) c FROM clientes WHERE activo=1").get()?.c || 0,
            guias_total: db.prepare("SELECT COUNT(*) c FROM guias_estafeta").get()?.c || 0,
            pagos_pendientes: db.prepare("SELECT COUNT(*) c FROM links_pago WHERE estatus='generado'").get()?.c || 0,
            pagos_pagados: db.prepare("SELECT COUNT(*) c FROM links_pago WHERE estatus='pagado'").get()?.c || 0,
            cola_atencion: db.prepare("SELECT COUNT(*) c FROM cola_atencion WHERE estatus='en_espera'").get()?.c || 0,
        };
        return json(res, stats);
    }

    // GET /api/bot/status — estado real del proceso bot-whatsapp en PM2
    if (p === '/api/bot/status' && req.method === 'GET') {
        pm2(['jlist'], (err, stdout) => {
            if (err) return json(res, { ok:false, error:'pm2 no disponible: ' + err.message }, 500);
            try {
                const lista = JSON.parse(stdout);
                const proc = lista.find(p2 => p2.name === 'bot-whatsapp');
                if (!proc) {
                    registrarCambioEstatusBot('no_iniciado', null);
                    return json(res, { ok:true, registrado:false, estatus:'no_iniciado' });
                }
                const estatus = proc.pm2_env?.status || 'desconocido';
                registrarCambioEstatusBot(estatus, null);
                return json(res, {
                    ok:true, registrado:true,
                    estatus,
                    uptime_ms:  proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
                    reinicios:  proc.pm2_env?.restart_time || 0,
                    memoria_mb: proc.monit?.memory ? Math.round(proc.monit.memory / 1024 / 1024) : 0,
                });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
        return;
    }

    // GET /api/bot/status-history — últimos cambios de estatus, para el
    // widget del header (qué pasó, no solo "inactivo" a secas)
    if (p === '/api/bot/status-history' && req.method === 'GET') {
        const rows = db.prepare('SELECT estatus, motivo, registrado_en FROM bot_status_log ORDER BY id DESC LIMIT 50').all();
        return json(res, rows);
    }

    // POST /api/bot/start — enciende solo bot-whatsapp (no toca el dashboard)
    if (p === '/api/bot/start' && req.method === 'POST') {
        pm2(['start', ECOSYSTEM_PATH, '--only', 'bot-whatsapp'], (err, stdout, stderr) => {
            if (err) return json(res, { ok:false, error: stderr || err.message }, 500);
            registrarCambioEstatusBot('online', 'iniciado manualmente desde el dashboard');
            return json(res, { ok:true, estatus:'iniciado' });
        });
        return;
    }

    // POST /api/bot/stop
    if (p === '/api/bot/stop' && req.method === 'POST') {
        pm2(['stop', 'bot-whatsapp'], (err, stdout, stderr) => {
            if (err) return json(res, { ok:false, error: stderr || err.message }, 500);
            registrarCambioEstatusBot('stopped', 'detenido manualmente desde el dashboard');
            return json(res, { ok:true, estatus:'detenido' });
        });
        return;
    }

    // POST /api/bot/restart
    if (p === '/api/bot/restart' && req.method === 'POST') {
        pm2(['restart', 'bot-whatsapp'], (err, stdout, stderr) => {
            if (err) return json(res, { ok:false, error: stderr || err.message }, 500);
            registrarCambioEstatusBot('online', 'reiniciado manualmente desde el dashboard');
            return json(res, { ok:true, estatus:'reiniciado' });
        });
        return;
    }

    // POST /api/notificar — enviar mensaje de estatus a un cliente
    if (p === '/api/notificar' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), NotificarSchema, res);
                if (!datos) return;
                const { telefono, mensaje, idPedido } = datos;

                // Capitalizar nombre del cliente si usa {nombre}
                let mensajeFinal = mensaje;
                if (mensaje.includes('{nombre}')) {
                    const _cli = db.prepare('SELECT nombre FROM clientes WHERE telefono=? LIMIT 1').get(telefono);
                    const _n = (_cli?.nombre||'').split(' ')[0];
                    const _cap = _n ? _n.charAt(0).toUpperCase() + _n.slice(1).toLowerCase() : 'Cliente';
                    mensajeFinal = mensaje.replace(/\{nombre\}/gi, _cap);
                }

                // Registrar en cola_notificaciones para que el bot lo envíe
                db.prepare(`
                    INSERT INTO cola_notificaciones
                        (tipo, destinatario, asunto, cuerpo, id_pedido, estatus)
                    VALUES ('whatsapp', ?, 'Notificación manual', ?, ?, 'pendiente')
                `).run(telefono, mensajeFinal, idPedido || null);

                mensajeService.registrarMensaje(db, telefono, 'asesor', mensajeFinal);

                return json(res, { ok:true, msg:'Mensaje encolado para envío' });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/pos/buscar-producto?q=... — para que el asesor arme un carrito (POS)
    // reusando el mismo buscador/scoring que ya usa el bot, en vez de duplicarlo.
    if (p === '/api/pos/buscar-producto' && req.method === 'GET') {
        const q = (u.searchParams.get('q') || '').toString();
        if (!q.trim()) return json(res, { ok:false, error:'Falta q' }, 400);
        const { results } = searchProducts(q, 10);
        return json(res, results);
    }

    // POST /api/pos/venta-previa — el asesor cierra una "venta previa": arma el
    // carrito, se guarda y se le manda al cliente por WhatsApp para que la
    // confirme. Al responder, el bot lo mete directo a SHOW_CART y sigue el
    // flujo normal de carrito/envío/pago — no se reimplementa esa lógica aquí.
    if (p === '/api/pos/venta-previa' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), VentaPreviaSchema, res);
                if (!datos) return;
                const { telefono, items } = datos;

                let carrito = [];
                for (const it of items) {
                    const producto = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(it.id_producto);
                    if (!producto) return json(res, { ok:false, error:`Producto ${it.id_producto} no existe o no está activo` }, 400);
                    for (let i = 0; i < it.cantidad; i++) {
                        carrito = agregarAlCarrito(carrito, producto).carrito;
                    }
                }

                const folio = generarFolio('venta_previa');
                ventaPreviaService.crearVentaPrevia(db, telefono, carrito, folio);

                db.prepare(`
                    INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, estatus)
                    VALUES ('whatsapp', ?, 'Venta previa', ?, 'pendiente')
                `).run(telefono, `Tu asesor preparó este pedido para ti 👇\n\n${mostrarCarrito(carrito)}`);

                return json(res, { ok:true, folio, total: carrito.length });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/masivo/preview — misma audiencia que calculará el envío real,
    // de solo lectura, para que el admin vea antes de disparar.
    if (p === '/api/masivo/preview' && req.method === 'GET') {
        try {
            const soloConPedido = u.searchParams.get('soloConPedido') === '1' || u.searchParams.get('soloConPedido') === 'true';
            const sinActividad  = u.searchParams.get('sinActividad') === '1' || u.searchParams.get('sinActividad') === 'true';
            const soloTags      = (u.searchParams.get('soloTags') || '').split(',').filter(Boolean);
            const limite        = parseInt(u.searchParams.get('limite')) || 50;
            const clientes = construirAudienciaMasivo({ soloConPedido, soloTags, sinActividad });
            return json(res, { ok:true, total: clientes.length, clientes: clientes.slice(0, limite) });
        } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
    }

    // POST /api/masivo — envío masivo de WhatsApp a clientes registrados
    if (p === '/api/masivo' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), MasivoSchema, res);
                if (!datos) return;
                const { mensaje, soloConPedido, limite, excluirTags, soloTags, sinActividad } = datos;

                let clientes = construirAudienciaMasivo({ soloConPedido, excluirTags, soloTags, sinActividad });
                if (limite && limite > 0) clientes = clientes.slice(0, limite);

                // El destinatario es el campo telefono que contiene el userId de WhatsApp (@lid o @c.us)
                let encolados = 0;
                const { enviarEn } = datos;
                // Validar y normalizar la fecha programada
                let _enviarDespues = null;
                if (enviarEn) {
                    const _d = new Date(enviarEn);
                    if (isNaN(_d.getTime())) return json(res, { ok:false, error:'Fecha programada inválida' }, 400);
                    if (_d < new Date()) return json(res, { ok:false, error:'La hora programada ya pasó' }, 400);
                    // Formato SQLite: YYYY-MM-DD HH:MM:SS
                    _enviarDespues = _d.toISOString().replace('T',' ').slice(0,19);
                }

                const _estatus = _enviarDespues ? 'programado' : 'pendiente';
                // campana: tag fijo para poder medir conversión de envíos masivos en
                // /api/metricas/campanas — si la columna todavía no existe en
                // producción, cae al INSERT sin ella y el envío sigue funcionando igual.
                let stmt;
                try {
                    stmt = db.prepare(
                        "INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,enviar_despues_de,campana) VALUES ('whatsapp',?,'Promocion masiva',?,?,?,'promocion_masiva')"
                    );
                } catch (_) {
                    stmt = db.prepare(
                        "INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus,enviar_despues_de) VALUES ('whatsapp',?,'Promocion masiva',?,?,?)"
                    );
                }
                const encolarTodos = db.transaction((lista) => {
                    for (const cli of lista) {
                        if (!cli.telefono) continue;
                        const nombre = cli.nombre ? cli.nombre.split(' ')[0] : 'Cliente';
                        const nombreCap = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();
                        const msgP = mensaje.replace(/\{nombre\}/gi, nombreCap);
                        stmt.run(cli.telefono, msgP, _estatus, _enviarDespues);
                        encolados++;
                    }
                });
                encolarTodos(clientes);

                const _info = _enviarDespues
                    ? 'Programado para ' + _enviarDespues
                    : 'Enviando ahora';
                return json(res, { ok:true, encolados, total_clientes: clientes.length, programado: !!_enviarDespues, enviar_en: _enviarDespues, info: _info });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // PUT /api/pedidos/:id — cambiar estatus de un pedido
    if (req.method === 'PUT' && p.startsWith('/api/pedidos/')) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { estatus } = JSON.parse(body);
                const validos = ['pendiente','confirmado','preparando','enviado','entregado','cancelado'];
                if (!validos.includes(estatus)) return json(res, { ok:false, error:'Estatus inválido' }, 400);
                db.prepare("UPDATE pedidos SET estatus=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(estatus, id);
                // Notificar al cliente si tiene teléfono
                // id_cliente no estaba poblado en pedidos viejos — c.nombre=p.cliente es el join que sí funciona siempre.
                const ped = db.prepare('SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR c.nombre=p.cliente WHERE p.id_pedido=? LIMIT 1').get(id);
                if (ped?.telefono) {
                    const msgs = {
                        confirmado:  'Tu pedido ha sido *confirmado* ✅. Lo estamos preparando.',
                        preparando:  'Tu pedido está siendo *preparado* 📦. Pronto lo enviamos.',
                        enviado:     'Tu pedido ya fue *enviado* 🚚. Pronto recibirás tu guía de rastreo.',
                        entregado:   'Tu pedido fue *entregado* ✅. ¡Esperamos que lo disfrutes! 🧸',
                        cancelado:   'Tu pedido ha sido *cancelado*. Si tienes dudas escríbenos.',
                    };
                    if (msgs[estatus]) {
                        db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización pedido',?,'pendiente')")
                          .run(ped.telefono, 'Hola ' + (ped.cliente||'') + ' 👋\n\n' + msgs[estatus]);
                    }
                }
                return json(res, { ok:true, estatus });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/pagos/:id/marcar-pagado — cobro recibido fuera de PayPal
    // (efectivo, transferencia, etc). Antes de esto no había NINGÚN código
    // que moviera un links_pago de 'generado' a 'pagado'.
    if (req.method === 'POST' && p.match(/^\/api\/pagos\/\d+\/marcar-pagado$/)) {
        const id = parseInt(p.split('/')[3]);
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), PagoConfirmadoSchema, res);
                if (!datos) return;
                const { referencia_pago } = datos;

                const lp = db.prepare('SELECT * FROM links_pago WHERE id=?').get(id);
                if (!lp) return json(res, { ok:false, error:'Link de pago no encontrado' }, 404);
                db.prepare("UPDATE links_pago SET estatus='pagado', pagado_en=datetime('now','localtime'), referencia_pago=? WHERE id=?").run(referencia_pago, id);

                // Pago confirmado: descontar del inventario real lo vendido en este pedido.
                const items = db.prepare('SELECT id_producto, cantidad, sucursal_origen FROM pedido_detalle WHERE id_pedido=?').all(lp.id_pedido);
                for (const it of items) {
                    db.prepare('UPDATE inventarios SET stock = MAX(0, stock - ?) WHERE id_producto=? AND sucursal=?')
                      .run(it.cantidad, it.id_producto, it.sucursal_origen);
                }

                // Si el pedido seguía 'Pendiente', avanzarlo a 'confirmado' — ya hay dinero.
                const ped = db.prepare("SELECT p.*, c.telefono FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR c.nombre=p.cliente WHERE p.id_pedido=? LIMIT 1").get(lp.id_pedido);
                if (ped && /pendiente/i.test(ped.estatus || '')) {
                    db.prepare("UPDATE pedidos SET estatus='confirmado', actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(ped.id_pedido);
                    if (ped.telefono) {
                        db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización pedido',?,'pendiente')")
                          .run(ped.telefono, 'Hola ' + (ped.cliente||'') + ' 👋\n\nRecibimos tu pago ✅. Tu pedido ha sido *confirmado* y lo estamos preparando.');
                    }
                    // Único disparador del programa de referidos: primera compra finalizada.
                    try { require('../bot/handlers/referidosService').otorgarPuntosPorPrimeraCompra(ped.id_cliente); }
                    catch (e) { log.debug('No se pudo procesar otorgamiento de puntos por referido: ' + e.message); }
                }
                return json(res, { ok:true, id, estatus:'pagado', referencia_pago });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/pagos/:id/cancelar — cancelar un link de pago (no se va a cobrar)
    if (req.method === 'POST' && p.match(/^\/api\/pagos\/\d+\/cancelar$/)) {
        const id = parseInt(p.split('/')[3]);
        const lp = db.prepare('SELECT id FROM links_pago WHERE id=?').get(id);
        if (!lp) return json(res, { ok:false, error:'Link de pago no encontrado' }, 404);
        db.prepare("UPDATE links_pago SET estatus='cancelado' WHERE id=?").run(id);
        return json(res, { ok:true, id, estatus:'cancelado' });
    }

    // POST /api/pagos/:id/regenerar — revivir un link vencido/cancelado dándole
    // otras 48h (mismo plazo que insertarLinkPago usa al crearlo).
    if (req.method === 'POST' && p.match(/^\/api\/pagos\/\d+\/regenerar$/)) {
        const id = parseInt(p.split('/')[3]);
        const lp = db.prepare('SELECT id FROM links_pago WHERE id=?').get(id);
        if (!lp) return json(res, { ok:false, error:'Link de pago no encontrado' }, 404);
        const expira = new Date(Date.now() + 48*3600*1000).toISOString().replace('T',' ').substring(0,19);
        db.prepare("UPDATE links_pago SET estatus='generado', fecha_expiracion=? WHERE id=?").run(expira, id);
        return json(res, { ok:true, id, estatus:'generado', fecha_expiracion:expira });
    }

    // GET /api/pedidos/:id/ticket — comprobante de compra: pedido + productos
    // + envío + pago, todo junto (no es una tabla nueva, solo un join de lectura).
    if (req.method === 'GET' && p.match(/^\/api\/pedidos\/\d+\/ticket$/)) {
        const idPedido = parseInt(p.split('/')[3]);
        const ped = db.prepare(
            "SELECT p.*, c.telefono, c.email FROM pedidos p LEFT JOIN clientes c ON c.id=p.id_cliente OR c.nombre=p.cliente WHERE p.id_pedido=? LIMIT 1"
        ).get(idPedido);
        if (!ped) return json(res, { ok:false, error:'Pedido no encontrado' }, 404);
        const items = db.prepare(
            "SELECT pd.id_producto, pd.cantidad, pd.precio_unitario, pd.subtotal_linea, pd.sucursal_origen, pr.name FROM pedido_detalle pd LEFT JOIN productos pr ON pr.id = pd.id_producto WHERE pd.id_pedido=?"
        ).all(idPedido);
        const envio = db.prepare("SELECT costo_envio, estatus FROM envios WHERE id_pedido=? LIMIT 1").get(idPedido);
        const pago  = db.prepare("SELECT monto, estatus, referencia_pago, pagado_en FROM links_pago WHERE id_pedido=? LIMIT 1").get(idPedido);
        return json(res, { pedido: ped, items, envio: envio || null, pago: pago || null });
    }

    // GET /api/devoluciones — antes esta tabla no se veía desde ningún lado
    // del dashboard; el asesor solo se entera por el WhatsApp de la cola.
    if (p === '/api/devoluciones' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const estatusF = (_u.searchParams.get('estatus') || '').trim();
        let sql = `
            SELECT d.*, p.folio, p.cliente, c.telefono
            FROM devoluciones d
            LEFT JOIN pedidos p  ON p.id_pedido = d.id_pedido
            LEFT JOIN clientes c ON c.id = p.id_cliente OR c.nombre = p.cliente
        `;
        const params = [];
        if (estatusF) { sql += ' WHERE d.estatus = ?'; params.push(estatusF); }
        sql += ' ORDER BY d.creada_en DESC LIMIT 200';
        return json(res, db.prepare(sql).all(...params));
    }

    // PUT /api/devoluciones/:id — aprobar/rechazar/resolver y avisar al cliente
    if (req.method === 'PUT' && p.match(/^\/api\/devoluciones\/\d+$/)) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { estatus, notas } = JSON.parse(body);
                const validos = ['solicitada','aprobada','rechazada','resuelta'];
                if (!validos.includes(estatus)) return json(res, { ok:false, error:'Estatus inválido' }, 400);
                const terminal = estatus !== 'solicitada';
                db.prepare(
                    "UPDATE devoluciones SET estatus=?, notas=COALESCE(?,notas)" +
                    (terminal ? ", resuelta_en=datetime('now','localtime')" : "") +
                    " WHERE id=?"
                ).run(estatus, notas || null, id);

                const dev = db.prepare(`
                    SELECT d.*, p.folio, p.cliente, c.telefono
                    FROM devoluciones d
                    LEFT JOIN pedidos p  ON p.id_pedido = d.id_pedido
                    LEFT JOIN clientes c ON c.id = p.id_cliente OR c.nombre = p.cliente
                    WHERE d.id = ? LIMIT 1
                `).get(id);

                // Devolución resuelta: regresar la pieza al inventario real
                // (inverso del descuento que hace marcar-pagado).
                if (estatus === 'resuelta' && dev?.id_producto && dev?.cantidad) {
                    const det = db.prepare(
                        'SELECT sucursal_origen FROM pedido_detalle WHERE id_pedido=? AND id_producto=? LIMIT 1'
                    ).get(dev.id_pedido, dev.id_producto);
                    if (det) {
                        db.prepare('UPDATE inventarios SET stock = stock + ? WHERE id_producto=? AND sucursal=?')
                          .run(dev.cantidad, dev.id_producto, det.sucursal_origen);
                    }
                }

                if (dev?.telefono) {
                    const msgs = {
                        aprobada:  '✅ Tu devolución (pedido *' + (dev.folio||'') + '*) fue *aprobada*. Pronto te contactamos para el reembolso o cambio.',
                        rechazada: '❌ Revisamos tu devolución (pedido *' + (dev.folio||'') + '*) y no pudo ser aprobada' + (notas ? ': ' + notas : '.') + ' Si tienes dudas, escríbenos.',
                        resuelta:  '✅ Tu devolución (pedido *' + (dev.folio||'') + '*) quedó *resuelta*. ¡Gracias por tu paciencia!',
                    };
                    if (msgs[estatus]) {
                        db.prepare("INSERT INTO cola_notificaciones (tipo,destinatario,asunto,cuerpo,estatus) VALUES ('whatsapp',?,'Actualización devolución',?,'pendiente')")
                          .run(dev.telefono, msgs[estatus]);
                    }
                }
                return json(res, { ok:true, estatus });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/cola_atencion — antes solo se veía el conteo (/api/stats);
    // el asesor no tenía forma de ver QUIÉN espera ni por qué desde el dashboard.
    if (p === '/api/cola_atencion' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const estatusF = (_u.searchParams.get('estatus') || 'en_espera').trim();
        const rows = db.prepare(`
            SELECT ca.*, c.nombre AS cliente, c.telefono
            FROM cola_atencion ca
            LEFT JOIN clientes c ON c.id = ca.id_cliente
            WHERE ca.estatus = ?
            ORDER BY ca.prioridad ASC, ca.creada_en ASC LIMIT 200
        `).all(estatusF);
        return json(res, rows);
    }

    // PUT /api/cola_atencion/:id — el asesor marca que ya atendió/resolvió
    if (req.method === 'PUT' && p.match(/^\/api\/cola_atencion\/\d+$/)) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { estatus } = JSON.parse(body);
                const validos = ['en_espera','atendida','resuelta'];
                if (!validos.includes(estatus)) return json(res, { ok:false, error:'Estatus inválido' }, 400);
                const campoFecha = estatus === 'atendida' ? 'atendida_en' : estatus === 'resuelta' ? 'resuelta_en' : null;
                db.prepare(
                    'UPDATE cola_atencion SET estatus=?' + (campoFecha ? `, ${campoFecha}=datetime('now','localtime')` : '') + ' WHERE id=?'
                ).run(estatus, id);
                return json(res, { ok:true, estatus });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/pedidos/:id/mensajes — últimos mensajes del cliente con el bot
    if (req.method === 'GET' && p.match(/^\/api\/pedidos\/\d+\/mensajes$/)) {
        const idPed = parseInt(p.split('/')[3]);
        const ped = db.prepare('SELECT id_cliente, cliente FROM pedidos WHERE id_pedido=? LIMIT 1').get(idPed);
        if (!ped) return json(res, []);
        const rows = db.prepare('SELECT m.rol, m.contenido, m.enviado_en FROM mensajes m JOIN conversaciones cv ON cv.id=m.id_conversacion WHERE cv.id_cliente=? ORDER BY m.enviado_en DESC LIMIT 10').all(ped.id_cliente);
        return json(res, rows.reverse());
    }

    // GET /api/clientes/:id/mensajes — conversación de un cliente
    if (req.method === 'GET' && p.match(/^\/api\/clientes\/\d+\/mensajes$/)) {
        const idCli = parseInt(p.split('/')[3]);
        const rows = db.prepare('SELECT m.rol, m.contenido, m.enviado_en FROM mensajes m JOIN conversaciones cv ON cv.id=m.id_conversacion WHERE cv.id_cliente=? ORDER BY m.enviado_en DESC LIMIT 15').all(idCli);
        return json(res, rows.reverse());
    }

    // GET /api/buscar?q=texto — buscador global (pedidos + clientes + guías)
    if (p === '/api/buscar' && req.method === 'GET') {
        const q = (new URL('http://x'+req.url).searchParams.get('q')||'').trim();
        if (q.length < 2) return json(res, { pedidos:[], clientes:[], guias:[] });
        const like = '%'+q+'%';
        const pedidos = db.prepare('SELECT id_pedido, folio, cliente, estatus, total, creado_en FROM pedidos WHERE folio LIKE ? OR cliente LIKE ? LIMIT 5').all(like, like);
        const clientes = db.prepare('SELECT id, nombre, telefono, COALESCE(tags,\'\') AS tags FROM clientes WHERE nombre LIKE ? OR telefono LIKE ? LIMIT 5').all(like, like);
        const guias = db.prepare('SELECT numero_guia, estatus, dest_nombre, dest_ciudad FROM guias_estafeta WHERE numero_guia LIKE ? OR dest_nombre LIKE ? LIMIT 5').all(like, like);
        return json(res, { pedidos, clientes, guias });
    }

    // POST /api/actualizar_guia — actualizar estatus de guía manualmente
    if (p === '/api/actualizar_guia' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), GuiaSchema, res);
                if (!datos) return;
                const { numeroGuia, estatus, descripcion, ubicacion } = datos;

                const estafeta = require('../services/estafetaService');
                const ok = estafeta.actualizarEstatusGuia(numeroGuia, estatus, descripcion, ubicacion);
                return json(res, { ok, numeroGuia, estatus });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // ── PENDIENTE 3: Lista de espera ────────────────────────────────
    if (p === '/api/lista-espera' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT le.id, le.telefono, le.nombre_cliente, le.cantidad,
                   le.estatus, le.creada_en, le.notificado_en,
                   p.name AS producto, p.price, p.stock_tienda, p.stock_cedis
            FROM lista_espera le
            JOIN productos p ON p.id = le.id_producto
            ORDER BY le.creada_en DESC
            LIMIT 200
        `).all();
        // Agrupar por producto para el dashboard
        const porProducto = {};
        for (const r of rows) {
            if (!porProducto[r.producto]) {
                porProducto[r.producto] = {
                    nombre: r.producto, precio: r.price,
                    stock_tienda: r.stock_tienda, stock_cedis: r.stock_cedis,
                    esperas: []
                };
            }
            porProducto[r.producto].esperas.push(r);
        }
        return json(res, { lista: Object.values(porProducto), total: rows.length });
    }

    // ── PENDIENTE 3: Log de búsquedas ────────────────────────────────
    if (p === '/api/busquedas' && req.method === 'GET') {
        // `compra` (búsqueda -> pedido real, vía stockWatcher.actualizarComprasDesdeEventos)
        // todavía puede no existir en producción — cae a la query original sin ese dato.
        let rows;
        try {
            rows = db.prepare(`
                SELECT valor AS busqueda, COUNT(*) AS veces,
                       MAX(registrado_en) AS ultima_vez,
                       SUM(COALESCE(compro,0)) AS compras
                FROM log_eventos
                WHERE tipo_evento='busqueda'
                GROUP BY valor
                ORDER BY veces DESC
                LIMIT 50
            `).all();
        } catch (_) {
            rows = db.prepare(`
                SELECT valor AS busqueda, COUNT(*) AS veces,
                       MAX(registrado_en) AS ultima_vez
                FROM log_eventos
                WHERE tipo_evento='busqueda'
                GROUP BY valor
                ORDER BY veces DESC
                LIMIT 50
            `).all();
        }
        return json(res, rows);
    }

    // GET /api/metricas/campanas — conversión real (envío -> pedido dentro de
    // 7 días) por campaña de marketing (carrito abandonado, oferta por
    // vencer, reactivación de dormidos, etc.), via el tag `campana` en
    // cola_notificaciones. Defensivo: [] si la columna todavía no existe.
    if (p === '/api/metricas/campanas' && req.method === 'GET') {
        try {
            const rows = db.prepare(`
                SELECT cn.campana,
                       COUNT(DISTINCT cn.id) AS enviados,
                       COUNT(DISTINCT CASE WHEN p.id_pedido IS NOT NULL THEN cn.id END) AS convertidos
                FROM cola_notificaciones cn
                LEFT JOIN clientes c ON c.telefono = cn.destinatario
                LEFT JOIN pedidos p ON (p.id_cliente = c.id OR p.cliente = c.nombre)
                   AND p.creado_en BETWEEN cn.creada_en AND datetime(cn.creada_en, '+7 days')
                WHERE cn.campana IS NOT NULL AND cn.estatus='enviado'
                GROUP BY cn.campana ORDER BY convertidos DESC
            `).all();
            return json(res, rows);
        } catch (_) { return json(res, []); }
    }

    // GET /api/metricas/abandono-motivos — por qué los clientes no terminan
    // su compra (precio/envío/otro), capturado por bot/handlers/abandonoHandler.js.
    // Defensivo: [] si `carritos_abandonados.motivo` todavía no existe.
    if (p === '/api/metricas/abandono-motivos' && req.method === 'GET') {
        try {
            const rows = db.prepare(`
                SELECT motivo, COUNT(*) AS n
                FROM carritos_abandonados
                WHERE motivo IS NOT NULL
                GROUP BY motivo ORDER BY n DESC
            `).all();
            return json(res, rows);
        } catch (_) { return json(res, []); }
    }

    // ── Preventas ─────────────────────────────────────────────────────
    if (p === '/api/preventas' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT pv.*, pr.name AS nombre_producto, pr.price
            FROM preventas pv JOIN productos pr ON pr.id = pv.id_producto
            WHERE pv.activa=1 ORDER BY pv.id DESC
        `).all();
        return json(res, rows);
    }

    if (p === '/api/preventas' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), PreventaSchema, res);
                if (!datos) return;
                const { id_producto, nombre_preventa, fecha_llegada_est,
                        stock_maximo, precio_preventa, porcentaje_anticipo } = datos;
                if (!id_producto || !nombre_preventa || !fecha_llegada_est)
                    return json(res, { ok:false, error:'Faltan campos obligatorios' }, 400);
                const r = db.prepare(`
                    INSERT INTO preventas (id_producto, nombre_preventa, fecha_llegada_est,
                        stock_maximo, precio_preventa, porcentaje_anticipo, activa)
                    VALUES (?,?,?,?,?,?,1)
                `).run(id_producto, nombre_preventa, fecha_llegada_est,
                        stock_maximo||50, precio_preventa||0, porcentaje_anticipo||50);
                return json(res, { ok:true, id: r.lastInsertRowid });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // PUT /api/preventas/:id — marcar como llegada real
    if (req.method === 'PUT' && p.startsWith('/api/preventas/')) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { fecha_llegada_real } = JSON.parse(body);
                db.prepare('UPDATE preventas SET fecha_llegada_real=? WHERE id=?')
                  .run(fecha_llegada_real || new Date().toISOString().slice(0,10), id);
                return json(res, { ok:true, id });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/notificar-lista/:idProducto — notificar lista de espera manualmente
    if (req.method === 'POST' && p.startsWith('/api/notificar-lista/')) {
        const idProducto = parseInt(p.split('/').pop());
        try {
            const stockSvc = require('../services/stockService');
            const notificados = stockSvc.notificarListaEspera(idProducto);
            return json(res, { ok:true, notificados: notificados.length, telefonos: notificados });
        } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
    }

    // ── PENDIENTE 5: Validación stock al confirmar pago ───────────────
    // (GET de sustitutos para el dashboard)
    if (p.startsWith('/api/sustitutos/') && req.method === 'GET') {
        const idProd = parseInt(p.split('/').pop());
        const rows = db.prepare(`
            SELECT ps.id, ps.score, ps.tipo_relacion,
                   p.id AS id_sustituto, p.name, p.price, p.stock_tienda, p.stock_cedis
            FROM productos_similares ps JOIN productos p ON p.id = ps.id_sustituto
            WHERE ps.id_producto=? AND ps.activa=1
            ORDER BY ps.score DESC
        `).all(idProd);
        return json(res, rows);
    }

    // POST /api/sustitutos — agregar relación manual entre productos
    if (p === '/api/sustitutos' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { id_producto, id_sustituto, tipo_relacion, score } = JSON.parse(body);
                if (!id_producto || !id_sustituto) return json(res, { ok: false, error: 'Faltan ids' }, 400);
                db.prepare(`
                    INSERT OR REPLACE INTO productos_similares
                        (id_producto, id_sustituto, tipo_relacion, score, activa)
                    VALUES (?, ?, ?, ?, 1)
                `).run(id_producto, id_sustituto, tipo_relacion || 'similar', score || 8);
                // Relación bidireccional opcional
                db.prepare(`
                    INSERT OR IGNORE INTO productos_similares
                        (id_producto, id_sustituto, tipo_relacion, score, activa)
                    VALUES (?, ?, ?, ?, 1)
                `).run(id_sustituto, id_producto, tipo_relacion || 'similar', score || 8);
                return json(res, { ok: true });
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // DELETE /api/sustitutos/:id — eliminar relación por id de la tabla.
    // POST /api/sustitutos crea el par en ambas direcciones, así que aquí
    // desactivamos las dos para no dejar la reversa huérfana y activa.
    if (p.startsWith('/api/sustitutos/') && req.method === 'DELETE') {
        const id = parseInt(p.split('/').pop());
        const rel = db.prepare('SELECT id_producto, id_sustituto FROM productos_similares WHERE id=?').get(id);
        if (rel) {
            db.prepare('UPDATE productos_similares SET activa=0 WHERE id=? OR (id_producto=? AND id_sustituto=?)')
              .run(id, rel.id_sustituto, rel.id_producto);
        } else {
            db.prepare('UPDATE productos_similares SET activa=0 WHERE id=?').run(id);
        }
        return json(res, { ok: true });
    }

    // GET /api/productos/buscar?q=texto — buscar productos para vincular
    if (p === '/api/productos/buscar' && req.method === 'GET') {
        const q = '%' + (new URL('http://x' + req.url).searchParams.get('q') || '') + '%';
        const rows = db.prepare(`
            SELECT id, name, cat, price, stock_tienda, stock_cedis
            FROM productos WHERE activo=1 AND name LIKE ?
            ORDER BY name LIMIT 20
        `).all(q);
        return json(res, rows);
    }

    // GET /health — estado del bot y dashboard
    if (p === '/health' && req.method === 'GET') {
        const _cola = db.prepare("SELECT COUNT(*) AS n FROM cola_notificaciones WHERE estatus='pendiente'").get()?.n || 0;
        const _colaf = db.prepare("SELECT COUNT(*) AS n FROM cola_notificaciones WHERE intentos>=3 AND estatus='pendiente'").get()?.n || 0;
        const _pedidos = db.prepare("SELECT COUNT(*) AS n FROM pedidos").get()?.n || 0;
        const _uptime = Math.floor(process.uptime());
        return json(res, {
            ok: true,
            dashboard: 'online',
            uptime_seg: _uptime,
            cola_pendiente: _cola,
            cola_fallida: _colaf,
            total_pedidos: _pedidos,
            timestamp: new Date().toISOString(),
            alerta_cola: _cola > 50 ? 'COLA ALTA — revisar' : null,
        });
    }

    // GET /api/cola — ver cola de notificaciones pendientes y fallidas
    if (p === '/api/cola' && req.method === 'GET') {
        const pendientes = db.prepare(`
            SELECT id, tipo, destinatario, asunto, estatus, intentos, creada_en
            FROM cola_notificaciones
            WHERE estatus IN ('pendiente','error') OR intentos >= 3
            ORDER BY id DESC LIMIT 100
        `).all();
        const resumen = {
            pendientes: pendientes.filter(r => r.estatus === 'pendiente' && r.intentos < 3).length,
            fallidas:   pendientes.filter(r => r.intentos >= 3).length,
            total:      pendientes.length,
            items:      pendientes,
        };
        return json(res, resumen);
    }

    // POST /api/cola/reintentar — resetear intentos de mensajes fallidos
    if (p === '/api/cola/reintentar' && req.method === 'POST') {
        const r = db.prepare(`
            UPDATE cola_notificaciones SET intentos=0, estatus='pendiente'
            WHERE intentos >= 3 AND estatus='pendiente'
        `).run();
        return json(res, { ok: true, reactivados: r.changes });
    }

    // POST /api/cola/reintentar/:id — reintentar un mensaje específico
    if (req.method === 'POST' && p.startsWith('/api/cola/reintentar/')) {
        const id = parseInt(p.split('/').pop());
        db.prepare(`UPDATE cola_notificaciones SET intentos=0, estatus='pendiente' WHERE id=?`).run(id);
        return json(res, { ok: true, id });
    }

    // GET /api/cola/programados — mensajes programados agrupados por campaña
    if (p === '/api/cola/programados' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT asunto, enviar_despues_de, creada_en,
                   MIN(cuerpo) AS cuerpo_muestra,
                   COUNT(*) AS total
            FROM cola_notificaciones
            WHERE estatus = 'programado'
            GROUP BY asunto, enviar_despues_de
            ORDER BY enviar_despues_de ASC
        `).all();
        return json(res, rows);
    }

    // DELETE /api/cola/programados — cancelar campaña programada
    if (p === '/api/cola/programados' && req.method === 'DELETE') {
        return readBody(req, body => {
            try {
                const { asunto, enviar_despues_de } = JSON.parse(body);
                if (!enviar_despues_de) return json(res, { ok:false, error:'Falta enviar_despues_de' }, 400);
                const r = db.prepare(`
                    UPDATE cola_notificaciones SET estatus='cancelado'
                    WHERE estatus='programado' AND enviar_despues_de=?
                    ${asunto ? 'AND asunto=?' : ''}
                `).run(...(asunto ? [enviar_despues_de, asunto] : [enviar_despues_de]));
                return json(res, { ok:true, cancelados: r.changes });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/cola/historial — últimos 50 mensajes enviados o fallidos
    if (p === '/api/cola/historial' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT id, destinatario, asunto, estatus, intentos, creada_en, enviar_despues_de
            FROM cola_notificaciones
            WHERE estatus IN ('enviado','error','cancelado')
            ORDER BY creada_en DESC LIMIT 50
        `).all();
        return json(res, rows);
    }

    // POST /api/reporte — generar y enviar reporte por WhatsApp o email.
    // La lógica real vive en services/reporteService.js, compartida con el
    // envío automático programado de services/stockWatcher.js, para que
    // ambos caminos generen y encolen el reporte de forma idéntica.
    if (p === '/api/reporte' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { destino } = JSON.parse(body); // destino: 'whatsapp'|'email'
                const { status, ...payload } = reporteService.enviarReporte(destino);
                return json(res, payload, status);
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // POST /api/beta/limpiar
    // Código: variable de entorno BETA_RESET_CODE (ej: godzillatomacafedenoche)
    if (p === '/api/beta/limpiar' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { codigo, telefono } = JSON.parse(body);
                const BETA_CODE = process.env.BETA_RESET_CODE || '';
                if (!BETA_CODE || !safeEqual(codigo, BETA_CODE)) {
                    return json(res, { ok: false, error: 'Código incorrecto' }, 403);
                }
                if (!telefono) return json(res, { ok: false, error: 'Falta el teléfono' }, 400);

                // Limpiar SOLO datos relacionados con este teléfono/cliente específico
                const tel = telefono.replace(/[^0-9@.]/g, '');
                const borrado = {};

                // Sesión del bot
                borrado.sesion = db.prepare(`DELETE FROM sesiones_bot WHERE id_usuario LIKE ?`).run('%' + tel + '%').changes;
                // Cliente
                const cli = db.prepare(`SELECT id FROM clientes WHERE telefono LIKE ?`).get('%' + tel + '%');
                if (cli) {
                    borrado.lista_espera     = db.prepare(`DELETE FROM lista_espera WHERE id_cliente=? OR telefono LIKE ?`).run(cli.id, '%'+tel+'%').changes;
                    borrado.carritos         = db.prepare(`DELETE FROM carritos_abandonados WHERE telefono LIKE ?`).run('%'+tel+'%').changes;
                    borrado.alertas          = db.prepare(`DELETE FROM alertas_reabasto WHERE id_cliente=? OR telefono LIKE ?`).run(cli.id, '%'+tel+'%').changes;
                    borrado.valoraciones     = db.prepare(`DELETE FROM valoraciones WHERE id_cliente=?`).run(cli.id).changes;
                    borrado.cola_notif       = db.prepare(`DELETE FROM cola_notificaciones WHERE destinatario LIKE ?`).run('%'+tel+'%').changes;
                    borrado.cola_atencion    = db.prepare(`DELETE FROM cola_atencion WHERE id_cliente=?`).run(cli.id).changes;
                    borrado.preventa_cli     = db.prepare(`DELETE FROM preventa_clientes WHERE id_cliente=? OR telefono LIKE ?`).run(cli.id, '%'+tel+'%').changes;
                    // El cliente mismo — al final
                    borrado.cliente          = db.prepare(`DELETE FROM clientes WHERE id=?`).run(cli.id).changes;
                }
                // Log
                log.info('Reset betatestor: ' + JSON.stringify(borrado), { userId: tel });
                return json(res, { ok: true, telefono: tel, borrado });
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET /api/metricas — métricas completas del sistema
    if (p === '/api/metricas' && req.method === 'GET') {
        const hoy  = new Date().toISOString().slice(0,10);
        const ayer = new Date(Date.now()-86400000).toISOString().slice(0,10);
        const semana = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
        const mes    = new Date(Date.now()-30*86400000).toISOString().slice(0,10);

        // Pedidos
        const _pHoy   = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)=?").get(hoy);
        const _pAyer  = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)=?").get(ayer);
        const _pSem   = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=?").get(semana);
        const _pMes   = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=?").get(mes);
        const _pTotal = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos").get();

        // Clientes
        const _cHoy  = db.prepare("SELECT COUNT(*) n FROM clientes WHERE date(creado_en)=?").get(hoy)?.n || 0;
        const _cSem  = db.prepare("SELECT COUNT(*) n FROM clientes WHERE date(creado_en)>=?").get(semana)?.n || 0;
        const _cTotal= db.prepare("SELECT COUNT(*) n FROM clientes WHERE activo=1").get()?.n || 0;

        // Pagos
        const _pagPend= db.prepare("SELECT COUNT(*) n, COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='generado'").get();
        const _pagPag = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(monto),0) t FROM links_pago WHERE estatus='pagado'").get();

        // Escaladas
        const _escHoy = db.prepare("SELECT COUNT(*) n FROM cola_atencion WHERE date(creada_en)=?").get(hoy)?.n || 0;
        const _escSem = db.prepare("SELECT COUNT(*) n FROM cola_atencion WHERE date(creada_en)>=?").get(semana)?.n || 0;

        // Notificaciones enviadas hoy
        const _notifHoy = db.prepare("SELECT COUNT(*) n FROM cola_notificaciones WHERE estatus='enviado' AND date(creada_en)=?").get(hoy)?.n || 0;

        // Pedidos por estatus
        const _porEstatus = db.prepare("SELECT estatus, COUNT(*) n FROM pedidos GROUP BY estatus ORDER BY n DESC").all();

        // Pedidos por día últimos 7 días
        const _porDia = db.prepare("SELECT date(creado_en) AS dia, COUNT(*) n, COALESCE(SUM(total),0) t FROM pedidos WHERE date(creado_en)>=? GROUP BY dia ORDER BY dia").all(semana);

        // Puntos
        const _puntosTotal = db.prepare("SELECT COALESCE(SUM(puntos_ganados),0) n FROM puntos_cliente").get()?.n || 0;
        const _puntosClientes = db.prepare("SELECT COUNT(*) n FROM puntos_cliente WHERE puntos_ganados > 0").get()?.n || 0;

        return json(res, {
            pedidos: { hoy: _pHoy, ayer: _pAyer, semana: _pSem, mes: _pMes, total: _pTotal },
            clientes: { hoy: _cHoy, semana: _cSem, total: _cTotal },
            pagos: { pendientes: _pagPend, pagados: _pagPag },
            escaladas: { hoy: _escHoy, semana: _escSem },
            notificaciones_hoy: _notifHoy,
            por_estatus: _porEstatus,
            por_dia: _porDia,
            puntos: { total: _puntosTotal, clientes_con_puntos: _puntosClientes },
        });
    }

    // GET /api/conversion — tasa de conversión
    if (p === '/api/conversion' && req.method === 'GET') {
        const pedidos  = db.prepare("SELECT COUNT(*) n FROM pedidos WHERE estatus NOT IN ('cancelado','Cancelado')").get()?.n || 0;
        const clientes = db.prepare("SELECT COUNT(*) n FROM clientes WHERE activo=1").get()?.n || 0;
        const tasa = clientes > 0 ? ((pedidos / clientes) * 100).toFixed(1) : 0;
        const topBusquedas = db.prepare("SELECT valor AS busqueda, COUNT(*) AS veces FROM log_eventos WHERE tipo_evento='busqueda' GROUP BY valor ORDER BY veces DESC LIMIT 10").all();
        // Volumen/ingreso de pedidos agrupado por el tono que tenía el bot al
        // momento de generarse (columna tono_bot, ver migrations/0001_agregar_tono_bot.sql).
        // No es "tasa de conversión" en sentido estricto (no hay conteo de
        // sesiones/leads por tono en ningún lado todavía) — es la comparación
        // de volumen e ingreso que sí es posible con lo que hoy se registra;
        // pedidos anteriores a esta migración caen en 'sin_dato'.
        const porTono = db.prepare(`
            SELECT COALESCE(tono_bot, 'sin_dato') AS tono,
                   COUNT(*) AS pedidos,
                   COALESCE(SUM(total), 0) AS ingresos,
                   COALESCE(AVG(total), 0) AS ticket_promedio
            FROM pedidos
            WHERE estatus NOT IN ('cancelado','Cancelado')
            GROUP BY tono
            ORDER BY pedidos DESC
        `).all();
        return json(res, { busquedas_total: 0, pedidos_total: pedidos, clientes_total: clientes, tasa_conversion: tasa+'%', top_busquedas: topBusquedas, por_tono: porTono });
    }

    // GET /api/ofertas — ofertas activas con precio original y oferta
    if (p === '/api/ofertas' && req.method === 'GET') {
        const hoy = new Date().toISOString().slice(0, 10);
        const rows = db.prepare(`
            SELECT pr.id, pr.codigo, pr.tipo, pr.valor, pr.fecha_fin,
                   pr.usos_actual, pr.usos_max,
                   p.name AS nombre, p.price AS precio_original,
                   ROUND(CASE WHEN pr.tipo = 'monto'
                              THEN MAX(p.price - pr.valor, 0)
                              ELSE p.price * (1 - pr.valor/100.0)
                         END, 2) AS precio_oferta
            FROM promociones pr
            LEFT JOIN productos p ON p.id = pr.id_producto
            WHERE pr.activa = 1
              AND (pr.fecha_fin IS NULL OR pr.fecha_fin >= ?)
            ORDER BY pr.valor DESC LIMIT 100
        `).all(hoy);
        return json(res, rows);
    }

    // GET /api/cupon/validar?codigo=X — valida cualquier código de `promociones`
    // (incluye los LEAL-XXXXXX de lealtad y los VUELVE-XXXXX de carrito) para
    // que se pueda cobrar en tienda. Mismo contrato que aplicarCupon del bot.
    if (p === '/api/cupon/validar' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const codigo = (_u.searchParams.get('codigo') || '').trim();
        if (!codigo) return json(res, { ok:false, error:'Falta código' }, 400);
        const hoy = new Date().toISOString().slice(0, 10);
        const promo = db.prepare(`
            SELECT * FROM promociones
            WHERE UPPER(codigo) = UPPER(?)
              AND activa = 1
              AND (fecha_inicio IS NULL OR fecha_inicio <= ?)
              AND (fecha_fin IS NULL OR fecha_fin >= ?)
              AND (usos_max = 0 OR usos_actual < usos_max)
            LIMIT 1
        `).get(codigo, hoy, hoy);
        if (!promo) return json(res, { ok:false, error:'Código no válido o expirado' });
        return json(res, { ok:true, codigo:promo.codigo, tipo:promo.tipo, valor:promo.valor, id_producto:promo.id_producto });
    }

    // POST /api/cupon/redimir — el cajero confirma que ya cobró con el cupón.
    // Body: { codigo, idTicket? }. Marca el uso en promociones (no acumulable
    // si usos_max=1) y, si se manda idTicket, lo liga a tickets_venta.id_promocion.
    if (p === '/api/cupon/redimir' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { codigo, idTicket } = JSON.parse(body);
                if (!codigo) return json(res, { ok:false, error:'Falta código' }, 400);
                const hoy = new Date().toISOString().slice(0, 10);
                const promo = db.prepare(`
                    SELECT * FROM promociones
                    WHERE UPPER(codigo) = UPPER(?)
                      AND activa = 1
                      AND (fecha_inicio IS NULL OR fecha_inicio <= ?)
                      AND (fecha_fin IS NULL OR fecha_fin >= ?)
                      AND (usos_max = 0 OR usos_actual < usos_max)
                    LIMIT 1
                `).get(String(codigo).trim(), hoy, hoy);
                if (!promo) return json(res, { ok:false, error:'Código no válido o expirado' });
                // Guarda atómica: evita que dos canjes simultáneos (POS + WhatsApp,
                // o dos cajeros) pasen ambos cuando el cupón es de un solo uso.
                const _upd = db.prepare(
                    'UPDATE promociones SET usos_actual=usos_actual+1 WHERE id=? AND (usos_max=0 OR usos_actual<usos_max)'
                ).run(promo.id);
                if (_upd.changes === 0) return json(res, { ok:false, error:'Ese cupón ya alcanzó su límite de usos' });
                if (idTicket) db.prepare('UPDATE tickets_venta SET id_promocion=? WHERE id=?').run(promo.id, idTicket);
                return json(res, { ok:true, codigo:promo.codigo, tipo:promo.tipo, valor:promo.valor });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/promociones — admin completo (a diferencia de /api/ofertas,
    // que solo muestra las que tienen producto y están vigentes hoy).
    if (p === '/api/promociones' && req.method === 'GET') {
        const _u = new URL('http://x' + req.url);
        const soloActivas = _u.searchParams.get('activa');
        let sql = `
            SELECT pr.*, p.name AS nombre_producto
            FROM promociones pr
            LEFT JOIN productos p ON p.id = pr.id_producto
        `;
        const params = [];
        if (soloActivas !== null) { sql += ' WHERE pr.activa = ?'; params.push(soloActivas === '1' ? 1 : 0); }
        sql += ' ORDER BY pr.creada_en DESC LIMIT 300';
        return json(res, db.prepare(sql).all(...params));
    }

    // POST /api/promociones — crear un cupón manual desde el dashboard
    // Body: { codigo, descripcion?, tipo:'porcentaje'|'monto', valor, id_producto?, id_categoria?, fecha_inicio?, fecha_fin?, usos_max? }
    if (p === '/api/promociones' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const d = JSON.parse(body);
                if (!d.codigo || !['porcentaje','monto'].includes(d.tipo) || !d.valor) {
                    return json(res, { ok:false, error:'Faltan codigo, tipo (porcentaje|monto) o valor' }, 400);
                }
                const info = db.prepare(`
                    INSERT INTO promociones (codigo, descripcion, tipo, valor, id_producto, id_categoria,
                                              activa, fecha_inicio, fecha_fin, usos_max, usos_actual, creada_en)
                    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, datetime('now','localtime'))
                `).run(
                    String(d.codigo).trim().toUpperCase(), d.descripcion || null, d.tipo, Number(d.valor),
                    d.id_producto || null, d.id_categoria || null,
                    d.fecha_inicio || null, d.fecha_fin || null, d.usos_max || 0
                );
                return json(res, { ok:true, id: info.lastInsertRowid });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // PUT /api/promociones/:id — activar/desactivar un cupón
    // Body: { activa: true|false }
    if (req.method === 'PUT' && p.match(/^\/api\/promociones\/\d+$/)) {
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { activa } = JSON.parse(body);
                db.prepare('UPDATE promociones SET activa=? WHERE id=?').run(activa ? 1 : 0, id);
                return json(res, { ok:true, id, activa: !!activa });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/tono — tono actual del bot (A/B/C/D)
    if (p === '/api/tono' && req.method === 'GET') {
        try {
            const r = db.prepare("SELECT valor FROM configuracion WHERE clave='tono_bot' LIMIT 1").get();
            const tono = r && ['A','B','C','D'].includes(r.valor) ? r.valor : 'C';
            return json(res, { tono });
        } catch(_) { return json(res, { tono: 'C' }); }
    }

    // POST /api/tono — cambiar tono del bot {tono:'A'|'B'|'C'|'D'}
    if (p === '/api/tono' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const tono = String((JSON.parse(body || '{}')).tono || '').toUpperCase();
                if (!['A','B','C','D'].includes(tono)) return json(res, { ok: false, error: 'Tono inválido. Usa A, B, C o D.' }, 400);
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('tono_bot', ?, datetime('now','localtime'))").run(tono);
                return json(res, { ok: true, tono });
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET /api/modulo/:clave — estado de un módulo
    if (p.startsWith('/api/modulo/') && req.method === 'GET') {
        const clave = p.split('/').pop();
        try {
            const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
            // Por defecto activo excepto puntos_activo
            const defecto = clave === 'puntos_activo' ? false : true;
            return json(res, { clave, activo: r ? r.valor !== '0' : defecto });
        } catch(_) { return json(res, { clave, activo: true }); }
    }

    // ── Rutas exclusivas del usuario prime — encender APIs reales ──────────
    // (pago_real_activo / estafeta_real_activo). Invisibles/inalcanzables
    // para el usuario común: requieren credenciales propias desde .env.
    if (p === '/api/prime/config' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        const claves = ['pago_real_activo', 'estafeta_real_activo'];
        const out = {};
        for (const clave of claves) {
            const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
            out[clave] = r ? r.valor === '1' || r.valor === 'true' : false;
        }
        return json(res, out);
    }

    if (p === '/api/prime/config' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), PrimeConfigSchema, res);
                if (!datos) return;
                const { clave, activo } = datos;
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now','localtime'))").run(clave, activo ? '1' : '0');
                log.info('[prime] ' + clave + ': ' + (activo ? 'ACTIVADO' : 'DESACTIVADO'));
                return json(res, { ok: true, clave, activo });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // PUT /api/prime/envio/:id_pedido — editar el costo de envío de un pedido
    // ya creado (caso real: Estafeta cotizó distinto a la simulación). Solo
    // usuario prime: cambia el total que se le cobra al cliente.
    if (req.method === 'PUT' && p.match(/^\/api\/prime\/envio\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const idPedido = parseInt(p.split('/')[4]);
        return readBody(req, body => {
            try {
                const { costo_envio } = JSON.parse(body);
                const costo = Number(costo_envio);
                if (!Number.isFinite(costo) || costo < 0) return json(res, { ok:false, error:'costo_envio inválido' }, 400);

                const envio = db.prepare('SELECT id FROM envios WHERE id_pedido=? LIMIT 1').get(idPedido);
                if (!envio) return json(res, { ok:false, error:'Este pedido no tiene envío registrado' }, 404);
                db.prepare('UPDATE envios SET costo_envio=? WHERE id_pedido=?').run(costo, idPedido);

                const ped = db.prepare('SELECT subtotal, descuento FROM pedidos WHERE id_pedido=?').get(idPedido);
                if (ped) {
                    const nuevoTotal = (ped.subtotal || 0) - (ped.descuento || 0) + costo;
                    db.prepare("UPDATE pedidos SET total=?, actualizado_en=datetime('now','localtime') WHERE id_pedido=?").run(nuevoTotal, idPedido);
                }
                return json(res, { ok:true, id_pedido: idPedido, costo_envio: costo });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET/PUT /api/prime/envio-default — costo de envío default global, sin
    // amarrarlo a un pedido. El pedido sigue siendo opcional: si se quiere
    // corregir uno en concreto se usa /api/prime/envio/:id_pedido (arriba).
    if (p === '/api/prime/envio-default' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='costo_envio_default' LIMIT 1").get();
        return json(res, { costo_envio_default: r ? Number(r.valor) : 149 });
    }
    if (p === '/api/prime/envio-default' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const { costo_envio } = JSON.parse(body);
                const costo = Number(costo_envio);
                if (!Number.isFinite(costo) || costo < 0) return json(res, { ok:false, error:'costo_envio inválido' }, 400);
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('costo_envio_default', ?, datetime('now','localtime'))").run(String(costo));
                log.info('[prime] costo_envio_default actualizado: ' + costo);
                return json(res, { ok:true, costo_envio_default: costo });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET/PUT /api/prime/estafeta-dias-entrega — días hábiles que estafetaService.js
    // suma para estimar la fecha de entrega. Hardcodeado en 2 hasta ahora; en
    // fechas como navidad los pedidos se retrasan días extra y Estafeta no
    // confirma sábados de forma confiable, así que prime lo ajusta aquí sin tocar código.
    if (p === '/api/prime/estafeta-dias-entrega' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='estafeta_dias_entrega' LIMIT 1").get();
        return json(res, { dias_entrega: r ? Number(r.valor) : 2 });
    }
    if (p === '/api/prime/estafeta-dias-entrega' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const { dias_entrega } = JSON.parse(body);
                const dias = Number(dias_entrega);
                if (!Number.isInteger(dias) || dias < 1 || dias > 30) return json(res, { ok:false, error:'dias_entrega inválido (1-30)' }, 400);
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('estafeta_dias_entrega', ?, datetime('now','localtime'))").run(String(dias));
                log.info('[prime] estafeta_dias_entrega actualizado: ' + dias);
                return json(res, { ok:true, dias_entrega: dias });
            } catch(e) { return json(res, { ok:false, error:e.message }, 500); }
        });
    }

    // GET /api/negocio — nombre comercial mostrado en el sidebar. Cualquier
    // sesión logueada puede leerlo (lo necesita el shell de React al cargar);
    // solo prime puede cambiarlo (abajo) — pensado para revender el panel a
    // otra juguetería sin editar código.
    if (p === '/api/negocio' && req.method === 'GET') {
        if (!requireSession(req, res)) return;
        const r = db.prepare("SELECT valor FROM configuracion WHERE clave='nombre_negocio' LIMIT 1").get();
        return json(res, { nombre_negocio: r ? r.valor : 'Julio Cepeda' });
    }
    if (p === '/api/prime/negocio' && req.method === 'PUT') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), NegocioSchema, res);
                if (!datos) return;
                const { nombre_negocio } = datos;
                db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('nombre_negocio', ?, datetime('now','localtime'))").run(nombre_negocio);
                log.info('[prime] nombre_negocio actualizado: ' + nombre_negocio);
                return json(res, { ok: true, nombre_negocio });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET /api/prime/palabras-filtro — lista negra + frases de queja: las BASE
    // (fijas en código, no editables) más las agregadas desde este panel.
    if (p === '/api/prime/palabras-filtro' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            return json(res, { items: filtroPalabras.listarTodas(db) });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // POST /api/prime/palabras-filtro — agregar palabra/frase personalizada.
    if (p === '/api/prime/palabras-filtro' && req.method === 'POST') {
        const ses = requireSession(req, res, ['prime']);
        if (!ses) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), PalabraFiltroSchema, res);
                if (!datos) return;
                const id = filtroPalabras.agregarPalabra(db, { ...datos, creado_por: ses.username });
                return json(res, { ok: true, id });
            } catch (e) {
                if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Esa palabra ya está en la lista' }, 400);
                return json(res, { ok: false, error: e.message }, 500);
            }
        });
    }

    // PUT /api/prime/palabras-filtro/:id — activar/desactivar una palabra
    // agregada desde el panel (las de código fuente no se pueden tocar).
    if (req.method === 'PUT' && p.match(/^\/api\/prime\/palabras-filtro\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const { activo } = JSON.parse(body || '{}');
                const r = filtroPalabras.togglePalabra(db, id, !!activo);
                return json(res, r, r.ok ? 200 : 400);
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // DELETE /api/prime/palabras-filtro/:id
    if (req.method === 'DELETE' && p.match(/^\/api\/prime\/palabras-filtro\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        try {
            const r = filtroPalabras.eliminarPalabra(db, id);
            return json(res, r, r.ok ? 200 : 400);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // ── Sucursales (registro de tiendas/bodegas) — solo prime ──────────────
    if (p === '/api/prime/sucursales' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            return json(res, db.prepare('SELECT * FROM sucursales ORDER BY nombre').all());
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    if (p === '/api/prime/sucursales' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), SucursalSchema, res);
                if (!datos) return;
                const { nombre, codigo, direccion } = datos;
                const r = db.prepare('INSERT INTO sucursales (nombre, codigo, direccion) VALUES (?, ?, ?)').run(nombre, codigo || null, direccion || null);
                log.info('[prime] sucursal creada: ' + nombre);
                return json(res, { ok: true, id: r.lastInsertRowid });
            } catch (e) {
                if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Ya existe una sucursal con ese código' }, 400);
                return json(res, { ok: false, error: e.message }, 500);
            }
        });
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/sucursales\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), SucursalUpdateSchema, res);
                if (!datos) return;
                if (!db.prepare('SELECT id FROM sucursales WHERE id=?').get(id)) return json(res, { ok: false, error: 'Sucursal no encontrada' }, 404);
                if (!actualizarCampos('sucursales', id, datos)) return json(res, { ok: false, error: 'Nada que actualizar' }, 400);
                return json(res, { ok: true, id });
            } catch (e) {
                if (String(e.message).includes('UNIQUE')) return json(res, { ok: false, error: 'Ya existe una sucursal con ese código' }, 400);
                return json(res, { ok: false, error: e.message }, 500);
            }
        });
    }

    if (req.method === 'DELETE' && p.match(/^\/api\/prime\/sucursales\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        try {
            db.prepare('DELETE FROM sucursales WHERE id=?').run(id);
            return json(res, { ok: true });
        } catch (e) {
            if (String(e.message).includes('FOREIGN KEY')) return json(res, { ok: false, error: 'No se puede borrar: tiene movimientos de inventario asociados. Desactívala en vez de borrarla.' }, 400);
            return json(res, { ok: false, error: e.message }, 500);
        }
    }

    // ── Productos — alta y edición (solo prime; la carga masiva del catálogo
    // sigue siendo aparte, esto es para agregar/corregir productos puntuales) ──
    if (p === '/api/prime/productos' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const d = validar(JSON.parse(body || '{}'), ProductoSchema, res);
                if (!d) return;
                const r = db.prepare(`
                    INSERT INTO productos (name, cat, price, url_imagen, tags, seo_description, edad_recomendada, edad_min, genero, stock_tienda, stock_cedis, stock_san_luis_potosi)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(d.name, d.cat || null, d.price, d.url_imagen || null, d.tags || null, d.seo_description || null, d.edad_recomendada || null, d.edad_min ?? null, d.genero || null, d.stock_tienda, d.stock_cedis, d.stock_san_luis_potosi);
                log.info('[prime] producto creado: ' + d.name);
                return json(res, { ok: true, id: r.lastInsertRowid });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/productos\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), ProductoUpdateSchema, res);
                if (!datos) return;
                if (!db.prepare('SELECT id FROM productos WHERE id=?').get(id)) return json(res, { ok: false, error: 'Producto no encontrado' }, 404);
                if (!actualizarCampos('productos', id, datos)) return json(res, { ok: false, error: 'Nada que actualizar' }, 400);
                return json(res, { ok: true, id });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── Stock mínimo por producto+sucursal (tabla `inventarios`) — umbral que
    // dispara la alerta de services/stockWatcher.js:checkStockMinimo(). La
    // columna stock_minimo existe desde Fase JIUA 2 pero no tenía UI para
    // editarla (default 0 = alerta desactivada para esa fila). ──────────────
    if (p === '/api/prime/inventarios' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim();
            const rows = q
                ? db.prepare(`
                    SELECT i.id, i.id_producto, p.name AS producto, i.sucursal, i.stock, i.stock_minimo
                    FROM inventarios i JOIN productos p ON p.id = i.id_producto
                    WHERE p.name LIKE ? ORDER BY p.name, i.sucursal LIMIT 300
                  `).all('%' + q + '%')
                : db.prepare(`
                    SELECT i.id, i.id_producto, p.name AS producto, i.sucursal, i.stock, i.stock_minimo
                    FROM inventarios i JOIN productos p ON p.id = i.id_producto
                    ORDER BY p.name, i.sucursal LIMIT 300
                  `).all();
            return json(res, rows);
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/inventarios\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), InventarioMinimoSchema, res);
                if (!datos) return;
                if (!db.prepare('SELECT id FROM inventarios WHERE id=?').get(id)) return json(res, { ok: false, error: 'Registro de inventario no encontrado' }, 404);
                actualizarCampos('inventarios', id, datos);
                return json(res, { ok: true, id, stock_minimo: datos.stock_minimo });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // ── Usuarios del dashboard — alta/edición/baja, solo prime. No se puede
    // borrar la propia cuenta ni dejar al sistema sin ningún usuario 'prime'
    // (se quedaría sin nadie que pueda volver a entrar aquí). ──────────────
    if (p === '/api/prime/usuarios' && req.method === 'GET') {
        if (!requireSession(req, res, ['prime'])) return;
        try {
            return json(res, db.prepare('SELECT id, username, rol, creado_en FROM usuarios ORDER BY id').all());
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    if (p === '/api/prime/usuarios' && req.method === 'POST') {
        if (!requireSession(req, res, ['prime'])) return;
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), UsuarioSchema, res);
                if (!datos) return;
                const { username, password, rol, nombre: nombreInput } = datos;
                const nombre = String(nombreInput || username || '').trim();
                if (!nombre) return json(res, { ok: false, error: 'username es obligatorio' }, 400);
                if (db.prepare('SELECT id FROM usuarios WHERE username=?').get(username)) {
                    return json(res, { ok: false, error: 'Ese usuario ya existe' }, 400);
                }
                const salt = crypto.randomBytes(16).toString('hex');
                const email = `${String(username).trim().toLowerCase()}@local`;
                const idRol = rol === 'prime' ? 2 : 1;
                const r = db.prepare('INSERT INTO usuarios (username, nombre, email, password_hash, id_rol, salt, rol) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run(username, nombre, email, hashPassword(password, salt), idRol, salt, rol);
                log.info('[prime] usuario creado: ' + username + ' (' + rol + ')');
                return json(res, { ok: true, id: r.lastInsertRowid, username, nombre, rol });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    if (req.method === 'PUT' && p.match(/^\/api\/prime\/usuarios\/\d+$/)) {
        if (!requireSession(req, res, ['prime'])) return;
        const id = parseInt(p.split('/').pop());
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body || '{}'), UsuarioUpdateSchema, res);
                if (!datos) return;
                const existente = db.prepare('SELECT id, rol FROM usuarios WHERE id=?').get(id);
                if (!existente) return json(res, { ok: false, error: 'Usuario no encontrado' }, 404);
                if (datos.rol && datos.rol !== 'prime' && existente.rol === 'prime') {
                    const otrosPrime = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol='prime' AND id!=?").get(id).n;
                    if (otrosPrime === 0) return json(res, { ok: false, error: 'No puedes quitarle el rol prime al único usuario prime' }, 400);
                }
                if (datos.nombre !== undefined) {
                    const nombre = String(datos.nombre || '').trim();
                    if (!nombre) return json(res, { ok: false, error: 'nombre no puede estar vacío' }, 400);
                    db.prepare('UPDATE usuarios SET nombre=? WHERE id=?').run(nombre, id);
                }
                if (datos.rol) db.prepare('UPDATE usuarios SET rol=? WHERE id=?').run(datos.rol, id);
                if (datos.password) {
                    const salt = crypto.randomBytes(16).toString('hex');
                    db.prepare('UPDATE usuarios SET password_hash=?, salt=? WHERE id=?').run(hashPassword(datos.password, salt), salt, id);
                }
                return json(res, { ok: true, id });
            } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    if (req.method === 'DELETE' && p.match(/^\/api\/prime\/usuarios\/\d+$/)) {
        const ses = requireSession(req, res, ['prime']);
        if (!ses) return;
        const id = parseInt(p.split('/').pop());
        try {
            const existente = db.prepare('SELECT id, username, rol FROM usuarios WHERE id=?').get(id);
            if (!existente) return json(res, { ok: false, error: 'Usuario no encontrado' }, 404);
            if (existente.username === ses.username) return json(res, { ok: false, error: 'No puedes borrar tu propia cuenta' }, 400);
            if (existente.rol === 'prime') {
                const otrosPrime = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol='prime' AND id!=?").get(id).n;
                if (otrosPrime === 0) return json(res, { ok: false, error: 'No puedes borrar al único usuario prime' }, 400);
            }
            db.prepare('DELETE FROM usuarios WHERE id=?').run(id);
            return json(res, { ok: true });
        } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }

    // GET /api/puntos/ticket/:codigo — datos de un ticket específico
    if (p.startsWith('/api/puntos/ticket/') && req.method === 'GET') {
        const codigo = decodeURIComponent(p.split('/').pop()).toUpperCase();
        if (codigo === 'RANDOM') {
            // Ticket aleatorio disponible (no reclamado, no expirado)
            const t = db.prepare(`
                SELECT * FROM tickets_venta
                WHERE codigo_qr LIKE 'TK-%'
                  AND puntos_reclamados = 0
                  AND datetime(expira_reclamo_en) > datetime('now','localtime')
                ORDER BY RANDOM() LIMIT 1
            `).get();
            return json(res, t || {});
        }
        const t = db.prepare(`SELECT * FROM tickets_venta WHERE codigo_qr=? LIMIT 1`).get(codigo);
        // Agregar número del bot para el QR
        const telefonoBot = (process.env.ASESOR_WHATSAPP || '').replace(/[^0-9]/g, '');
        return json(res, t ? { ...t, telefono_bot: telefonoBot } : {});
    }

    // GET /api/puntos/usados — últimos 20 tickets reclamados
    if (p === '/api/puntos/usados' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT codigo_qr, total, puntos_otorgados, telefono_cliente, reclamado_en
            FROM tickets_venta
            WHERE puntos_reclamados = 1
            ORDER BY reclamado_en DESC LIMIT 20
        `).all();
        return json(res, rows);
    }

    // GET /api/puntos/config — ver estado del sistema de lealtad
    if (p === '/api/puntos/config' && req.method === 'GET') {
        let activo = true;
        try {
            const r = db.prepare("SELECT valor FROM configuracion WHERE clave='puntos_activo' LIMIT 1").get();
            activo = !r || r.valor !== '0';
        } catch(e) { log.debug('No se pudo leer puntos_activo: ' + e.message); }
        return json(res, { puntos_activo: activo });
    }

    // POST /api/puntos/config — habilitar o deshabilitar cualquier módulo
    // Body: { activo: true | false } o { clave: 'nombre_modulo', activo: true | false }
    if (p === '/api/puntos/config' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const datos = validar(JSON.parse(body), ModuloConfigSchema, res);
                if (!datos) return;
                const { clave, activo } = datos;
                db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime(\'now\',\'localtime\'))').run(clave, activo ? '1' : '0');
                log.info('Módulo ' + clave + ': ' + (activo ? 'ACTIVADO' : 'DESACTIVADO'));
                return json(res, { ok: true, clave, activo });
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    // GET /api/puntos/ranking — top clientes por puntos
    // (debe ir antes del catch-all /api/puntos/:telefono de abajo, que de
    // otro modo intercepta "ranking" como si fuera un número de teléfono)
    if (p === '/api/puntos/ranking' && req.method === 'GET') {
        const rows = db.prepare(`
            SELECT c.nombre, c.telefono,
                   pc.puntos_ganados, pc.puntos_canjeados,
                   (pc.puntos_ganados - pc.puntos_canjeados) AS disponibles,
                   pc.ultimo_movimiento
            FROM puntos_cliente pc JOIN clientes c ON c.id = pc.id_cliente
            ORDER BY disponibles DESC LIMIT 20
        `).all();
        return json(res, rows);
    }

    // GET /api/puntos/:telefono — consultar saldo de un cliente
    if (p.startsWith('/api/puntos/') && req.method === 'GET') {
        const tel = decodeURIComponent(p.split('/').pop());
        try {
            const puntosService = require('../bot/handlers/puntosService');
            const saldo = puntosService.consultarSaldo(tel);
            return json(res, saldo || { disponibles: 0, puntos: 0 });
        } catch(e) { return json(res, { error: e.message }, 500); }
    }

    // POST /api/puntos/preparar — asignar código QR a un ticket al cerrar venta
    // Body: { id_ticket, total, telefono_cliente }
    if (p === '/api/puntos/preparar' && req.method === 'POST') {
        return readBody(req, body => {
            try {
                const { id_ticket, total, telefono_cliente } = JSON.parse(body);
                if (!id_ticket || !total) return json(res, { ok: false, error: 'Faltan id_ticket y total' }, 400);
                const puntosService = require('../bot/handlers/puntosService');
                const r = puntosService.prepararTicket(id_ticket, total, telefono_cliente);
                return json(res, r);
            } catch(e) { return json(res, { ok: false, error: e.message }, 500); }
        });
    }

    json(res, { error: 'Ruta no encontrada' }, 404);
}

// ── Límite de tamaño de body — evita payloads gigantes en memoria ──────────
const MAX_BODY_BYTES = 1_000_000; // 1MB, de sobra para el JSON que maneja este dashboard
function capBodySize(req, res) {
    let size = 0, rejected = false;
    req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES && !rejected) {
            rejected = true;
            res.writeHead(413, { 'Content-Type': 'text/plain' });
            res.end('413 Payload Too Large');
            req.destroy();
        }
    });
}

// ── Mitigación CSRF — un <form> cross-site nunca puede fijar este Content-Type,
// así que cualquier POST/PUT/DELETE que lo traiga distinto se rechaza. No frena
// fetch cross-origin con credentials:include si el navegador ya envía Basic Auth,
// pero CORS abajo (origen fijo, sin '*') tampoco deja completar ese preflight.
function rejectCrossSiteForm(req, res) {
    const ct = req.headers['content-type'];
    if (ct && !ct.toLowerCase().startsWith('application/json')) {
        res.writeHead(415, { 'Content-Type': 'text/plain' });
        res.end('415 Unsupported Media Type — usa application/json');
        return true;
    }
    return false;
}

const DASHBOARD_ORIGIN = `http://localhost:${PORT}`;

// ── Servidor ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    try {
        return handleRequest(req, res);
    } catch (e) {
        // Cualquier ruta hace db.prepare(...).run()/.get()/.all() de forma
        // síncrona (better-sqlite3) y sin este try/catch, una sola consulta
        // mala (columna faltante en una BD vieja, SQLITE_BUSY transitorio,
        // etc.) tiraba TODO el proceso para todos los usuarios — el mismo
        // tipo de bug que dejó a `usuarios` en bucle de reinicio (ver
        // _asegurarColumnasUsuarios más arriba).
        log.error('🔴 Error no capturado en request', e);
        try {
            if (!res.headersSent) json(res, { ok: false, error: 'Error interno del servidor' }, 500);
            else res.end();
        } catch (_) {}
    }
});

function handleRequest(req, res) {
    const u = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': DASHBOARD_ORIGIN,
                             'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
                             'Access-Control-Allow-Headers':'Content-Type,Authorization' });
        return res.end();
    }

    // ── Rate limit: 60 req/min lectura, 30 POST/min (uso interno dashboard) ────────────
    if (!rateLimit(req, res, req.method === 'POST' ? 30 : 120)) return;

    // /health no requiere auth — para monitoreo externo
    if (req.method === 'GET' && u.pathname === '/health') {
        return handleAPI(req, res);
    }

    const esRutaApi = u.pathname.startsWith('/api/');
    // Estas tres rutas manejan la ausencia de sesión ellas mismas (login la crea,
    // /me y /logout responden algo razonable sin una) — el resto de /api/* exige
    // sesión válida aquí, antes de llegar a handleAPI.
    const esRutaPublica = (u.pathname === '/api/login' && req.method === 'POST')
        || (u.pathname === '/api/logout' && req.method === 'POST')
        || (u.pathname === '/api/me' && req.method === 'GET');

    if (esRutaApi && !esRutaPublica) {
        if (!requireSession(req, res)) return;
    }

    if (['POST','PUT','DELETE'].includes(req.method)) {
        if (rejectCrossSiteForm(req, res)) return;
        capBodySize(req, res);
    }

    if (esRutaApi) return handleAPI(req, res);

    // Estáticos: el build de React (dashboard-ui/dist) si existe, o el
    // dashboard.html legado mientras se completa la migración. Públicos a
    // propósito — la pantalla de login es parte de este mismo bundle.
    return serveStatic(req, res, u.pathname);
}

server.listen(PORT, '127.0.0.1', () => {
    log.info(`🧸 Dashboard corriendo en http://localhost:${PORT}`);
    log.info('Abre esa URL en el navegador del servidor.');
});

// ── Estáticos: build de React si existe, si no el dashboard.html legado ────
const DIST_DIR = path.join(__dirname, '..', 'dashboard-ui', 'dist');
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.woff2':'font/woff2',
};
function serveStatic(req, res, pathname) {
    if (fs.existsSync(DIST_DIR)) {
        const rel = pathname === '/' ? '/index.html' : pathname;
        let filePath = path.join(DIST_DIR, rel);
        if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            filePath = path.join(DIST_DIR, 'index.html'); // SPA fallback (React Router)
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', ...SECURITY_HEADERS });
        return res.end(fs.readFileSync(filePath));
    }
    if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(getDashboardHTML());
    }
    res.writeHead(404); res.end('Not found');
}
function getDashboardHTML() {
    const htmlFile = path.join(__dirname, 'dashboard.html');
    try {
        if (fs.existsSync(htmlFile)) return fs.readFileSync(htmlFile, 'utf8');
    } catch(_) {}
    return '<html><body><h1 style="font-family:sans-serif;padding:40px">Error: dashboard.html no encontrado en ' + __dirname + '</h1></body></html>';
}
