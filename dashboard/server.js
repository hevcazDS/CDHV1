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
const { NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, ConfigContactoSchema, ConfigEmailBotSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, CategoriaSchema, UsuarioSchema, UsuarioUpdateSchema, safeEqual } = require('../bot/validators');
require('dotenv').config({ quiet: true });
const log = require('../bot/logger')('dashboard');
const { registrarErrorDB } = require('../bot/dbErrorLog');

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
// pm2 global se instala como pm2.cmd en Windows. Node 20+ ya no deja que
// execFile() lance un .cmd directamente (EINVAL) sin spawnear cmd.exe, así
// que hay que armar la línea de comando a mano — pero eso choca con una
// regla específica de cmd.exe /c: si recibe varios tokens entre comillas en
// vez de UNA sola cadena entre comillas, los toma literalmente como parte
// del nombre del programa ("\"pm2.cmd\"" no se reconoce...) en vez de
// despojar las comillas. La solución verificada es envolver TODO el
// comando en un par extra de comillas (cmd.exe sí sabe despojar ese par
// externo) y pasar windowsVerbatimArguments:true para que Node no vuelva a
// escapar esa cadena ya armada — sin esto último, Node duplica las
// comillas y se rompe igual. windowsHide:true evita que parpadee una
// ventana de consola en cada poll de estatus (cada 15s desde el dashboard).
const PM2_BIN = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';

// Mismo patrón que bot/index.js (escaparParaPsLike + filtro por línea de
// comando, nunca por nombre de proceso a secas). bot/index.js ya reabre
// Electron solo en cada arranque del bot (abrirDashboard(), incondicional,
// no detrás de ningún evento de WhatsApp) — esta función SOLO cierra la
// ventana vieja antes de pedirle a pm2 que reinicie, para que la que
// reabra el bot sea una fresca y no quede una mostrando el estado de
// antes del reinicio. Si esta función también la reabriera, compite con
// abrirDashboard() y se duplica la ventana (confirmado al probarlo).
function escaparParaPsLike(ruta) {
    return ruta.replace(/'/g, "''").replace(/([[\]])/g, '`$1');
}
function cerrarElectronSiAbierto(cb) {
    if (process.platform !== 'win32') return cb();
    const desktopDir = escaparParaPsLike(path.join(__dirname, '..', 'desktop'));
    const ps = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${desktopDir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => setTimeout(cb, 1500));
}

function pm2(args, cb) {
    if (process.platform === 'win32') {
        const inner = [PM2_BIN, ...args].map(arg => `"${String(arg).replace(/"/g, '\\"')}"`).join(' ');
        const command = `"${inner}"`;
        execFile('cmd.exe', ['/d', '/s', '/c', command], { timeout: 15000, windowsHide: true, windowsVerbatimArguments: true }, (err, stdout, stderr) => cb(err, stdout, stderr));
        return;
    }
    execFile(PM2_BIN, args, { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => cb(err, stdout, stderr));
}

const APP_VERSION = (() => { try { return require('../package.json').version; } catch (_) { return '0'; } })();
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
    // Detrás de Caddy (TRUST_PROXY=1) la IP real viene en X-Forwarded-For;
    // sin proxy se IGNORA el header (spoofeable) y se usa el socket.
    const ip = (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())
        || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const d   = _rlMap.get(ip) || { count: 0, reset: now + windowMs };
    if (now > d.reset) { d.count = 0; d.reset = now + windowMs; }
    d.count++;
    _rlMap.set(ip, d);
    if (d.count > max) {
        // JSON en vez de texto plano: antes un 429 plano no se distinguía de
        // un error de red en el frontend (api.js espera JSON) y el operador
        // reportó 429 confusos durante uso normal -- con esto al menos el
        // mensaje es legible y consistente con el resto de la API.
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' });
        res.end(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes. Espera un minuto e intenta de nuevo.' }));
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
const { searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, iniciarCapturaDireccion, S: SESION_S } = require('../bot/flows/_shared');
const sessionManagerBot = require('../bot/sessionManager');
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
    rol TEXT NOT NULL CHECK(rol IN ('cajero','operador','almacen','compras','rh','contabilidad','usuario','gerente','admin','prime')),
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
    crearUsuarioSiNoExiste(DASH_USER, DASH_PASS, 'gerente', DASH_NOMBRE);
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
// "Recordar sesión" en el login: en vez de las 8h fijas de siempre, una
// sesión de 30 días -- el checkbox lo pide explícitamente el operador, así
// que es una decisión consciente por sesión, no un cambio del default global.
const SESSION_TTL_MS_RECORDAR = 30 * 24 * 60 * 60 * 1000; // 30 días

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

// ── Secreto de instancia (archivo local, NO viaja en la BD ni en backups) ──
// El token de sesión va FIRMADO (HMAC) con este secreto: una fila de sesión
// migrada de otra instancia o inyectada directo en sqlite no valida. Si el
// archivo no existe (proyecto recién levantado) se genera uno nuevo y todas
// las sesiones anteriores mueren — el token no se migra, se ejecuta nuevo.
const _SECRET_PATH = path.join(__dirname, '.instancia_secret');
const _INSTANCIA_SECRET = (() => {
    try {
        const v = fs.readFileSync(_SECRET_PATH, 'utf8').trim();
        if (v.length >= 32) return v;
        log.error('[HS-402] Secreto de instancia INVÁLIDO/corrupto (' + _SECRET_PATH + ') — se regenera; todas las sesiones quedan invalidadas');
    } catch (e) {
        if (e.code !== 'ENOENT') log.error('[HS-402] No se pudo leer el secreto de instancia: ' + e.message + ' — se regenera');
    }
    const nuevo = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(_SECRET_PATH, nuevo, { mode: 0o600 }); } catch (e) { log.warn('No se pudo persistir el secreto de instancia: ' + e.message); }
    log.info('Secreto de instancia NUEVO generado — las sesiones previas quedan invalidadas');
    return nuevo;
})();
function _firmar(token) {
    return crypto.createHmac('sha256', _INSTANCIA_SECRET).update(token).digest('hex').slice(0, 24);
}

function crearSesion(username, rol, ttlMs = SESSION_TTL_MS) {
    // Un login nuevo invalida las sesiones previas del mismo usuario (un
    // token robado muere en cuanto el dueño vuelve a entrar)
    for (const [tok, ses] of _sesiones) {
        if (ses.username === username) _sesiones.delete(tok);
    }
    try { db.prepare('DELETE FROM sesiones_dashboard WHERE username=?').run(username); } catch (_) {}
    const token = crypto.randomBytes(32).toString('hex');
    const expira = Date.now() + ttlMs;
    _sesiones.set(token, { username, rol, expira });
    db.prepare('INSERT OR REPLACE INTO sesiones_dashboard (token, username, rol, expira) VALUES (?, ?, ?, ?)').run(token, username, rol, expira);
    // la cookie lleva token.FIRMA — la firma solo la produce ESTE servidor
    return token + '.' + _firmar(token);
}
function obtenerSesion(req) {
    const cookie = req.headers['cookie'] || '';
    const m = cookie.match(/(?:^|;\s*)jc_session=([a-f0-9]+)\.([a-f0-9]+)/);
    if (!m) return null;
    // verificar la FIRMA antes de siquiera buscar la sesión (anti-migración
    // y anti-inyección directa en la BD)
    let firmaOk = false;
    try { firmaOk = crypto.timingSafeEqual(Buffer.from(_firmar(m[1])), Buffer.from(m[2])); } catch (_) {}
    if (!firmaOk) return null;
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

// Reemplaza requireAuth/requireAuthPrime: una sola sesión, el rol decide qué
// rutas alcanza. La jerarquía + áreas por rol especialista viven en
// dashboard/permisos.js (fuente única, espejo en dashboard-ui/src/lib/).
const permisos = require('./permisos');
const { RANGO_ROL, permite } = permisos;
function rangoDe(rol) { return RANGO_ROL[rol] || 0; }

// requireSession(req, res, rolesPermitidos?) — si se pasa rolesPermitidos, el
// array indica el rol MÍNIMO: cualquier sesión de rango >= al menor de la lista
// pasa (así ['prime'] sigue siendo solo prime, y ['gerente'] deja entrar a
// gerente Y prime sin tener que enumerarlos).
function requireSession(req, res, rolesPermitidos) {
    const s = obtenerSesion(req);
    let autorizado = !!s;
    if (s && rolesPermitidos && rolesPermitidos.length) {
        const minRango = Math.min(...rolesPermitidos.map(rangoDe));
        autorizado = rangoDe(s.rol) >= minRango;
        // Auditor = lectura total por diseño (permite() ya le da true en las
        // rutas por-área; el gate global de server.js le bloquea toda escritura).
        // Sin esto los GET gateados por rango (roles:['gerente'|'prime'] —
        // métricas/reportes/config) le daban 401 pese a verse en su menú.
        // TECHO: solo hasta rango gerente — las superficies prime-only
        // (instancias, credenciales/integraciones) NO son de auditoría.
        if (!autorizado && permisos.esAuditor(s.rol) && req.method === 'GET' && minRango <= rangoDe('gerente')) autorizado = true;
    }
    if (!autorizado) {
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

// ── Helper: lee el body, parsea JSON y ejecuta cb(obj) con try/catch — reemplaza
// el boilerplate `readBody(req, body => { try { const d = JSON.parse(body||'{}');
// ...logica } catch(e){ json(res,{ok:false,error:e.message},500) } })` repetido
// ~105 veces en 23 archivos (arquitecto MEDIO #5). Body inválido → 400; error en
// el handler → 500 con el mismo shape que antes. Toda ruta nueva usa readJson.
function readJson(req, res, cb) {
    return readBody(req, body => {
        let d;
        try { d = JSON.parse(body || '{}'); }
        catch (_) { return json(res, { ok: false, error: 'JSON inválido' }, 400); }
        try { return cb(d); }
        catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    });
}

// ── Helper: valida un objeto ya parseado contra un schema Zod. Si falla, ya
// escribe la respuesta 400 y regresa null (el caller solo necesita
// "if (!datos) return;") — reemplaza el bloque de 3 líneas que se repetía
// copiado en cada ruta POST/PUT (parsear -> safeParse -> 400 si falla).
// `ruta` (4to parámetro, la `p` de cada módulo de dashboard/routes/*.js) es
// opcional para no romper otros callers, pero cada ruta nueva debe pasarla
// — sin ella el fallo queda en logs_error con proceso genérico, sin decir
// cuál endpoint fue. `v.error` ya es un string "campo: mensaje, ..." (ver
// zodError() en bot/validators.js, que envuelve safeParse para nunca
// exponer un ZodError crudo) — nunca incluye el valor recibido, solo
// nombre de campo + mensaje, así que es seguro guardarlo tal cual.
function validar(parsed, schema, res, ruta) {
    const v = schema.safeParse(parsed);
    if (!v.success) {
        registrarErrorDB('dashboard:validar' + (ruta ? ' ' + ruta : ''), 'Validación fallida', { detalle: v.error });
        json(res, { ok: false, error: v.error }, 400);
        return null;
    }
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
    sucursales: ['nombre', 'codigo', 'direccion', 'codigo_postal', 'activa'],
    productos: ['name', 'cat', 'price', 'costo', 'sku', 'upc', 'brand', 'handle', 'description',
        'url_imagen', 'tags', 'seo_description', 'material', 'color', 'target_audience',
        'tipo_juguete', 'edad_recomendada', 'edad_min', 'edad_max', 'genero', 'id_categoria',
        'peso_kg', 'alto_cm', 'ancho_cm', 'largo_cm', 'stock_tienda', 'stock_cedis',
        'stock_san_luis_potosi', 'stock_exhibicion', 'stock_queretaro', 'stock_monterrey',
        'stock_cdmx_centro', 'stock_base', 'activo'],
    inventarios: ['stock_minimo'],
    categorias: ['nombre', 'descripcion', 'activa'],
};

// ── Helper: UPDATE dinámico a partir de los campos presentes en `datos`,
// filtrados contra TABLAS_ACTUALIZABLES. Reemplaza el bloque de
// "campos/sets/valores" que se repetía en cada ruta PUT de edición parcial
// (sucursales, productos, ...).
// pkColumna es configurable porque `inventarios` tiene drift real entre
// instalaciones: db/schema.sql declara `id` como PK autoincrement, pero la
// base de producción real tiene `id_inventory` como PK verdadero y un `id`
// separado que quedó NULL en las 13,926 filas existentes (ver
// dashboard/routes/primeCatalogo.js's pkInventarios()). Todas las demás
// tablas siguen usando el default 'id'.
function actualizarCampos(tabla, id, datos, pkColumna = 'id') {
    const permitidas = TABLAS_ACTUALIZABLES[tabla] || [];
    const campos = Object.keys(datos).filter(c => permitidas.includes(c));
    if (!campos.length) return false;
    const sets = campos.map(c => `${c}=?`).join(', ');
    const valores = campos.map(c => typeof datos[c] === 'boolean' ? (datos[c] ? 1 : 0) : datos[c]);
    db.prepare(`UPDATE ${tabla} SET ${sets} WHERE ${pkColumna}=?`).run(...valores, id);
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
    const _exclCond   = "COALESCE(c.marketing_opt_out,0)=0 AND " +
        _tagsExcluir.map(() => "COALESCE(c.tags,'') NOT LIKE ?").join(' AND ');
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
// handleAPI vivía como una sola función de ~1620 líneas con 94 rutas en
// bloques  planos — partido mecánicamente en dashboard/routes/*.js sin
// tocar ninguna línea de lógica de ruta (verificado: el cuerpo de cada
// módulo es textualmente idéntico al rango de líneas que ocupaba en este
// archivo antes de este cambio), solo agrupado en archivos más chicos y
// auditables. ctx empaqueta lo que esos módulos necesitan del scope de este
// archivo; next() encadena al siguiente módulo (o al 404 final), preservando
// el mismo fallthrough secuencial del  original — ningún módulo sabe si
// "matcheó" salvo por no llamar a next().
const ctx = {
    db, json, readBody, readJson, validar, requireSession, log, pm2, APP_VERSION, cerrarElectronSiAbierto, registrarCambioEstatusBot, crearSesion, obtenerSesion, eliminarSesion, hashPassword, safeEqual, loginBloqueado, registrarIntentoFallido, limpiarIntentosLogin, COOKIE_SECURE_FLAG, SESSION_TTL_MS, SESSION_TTL_MS_RECORDAR, PORT, ECOSYSTEM_PATH, crypto, mensajeService, ventaPreviaService, reporteService, searchProducts, agregarAlCarrito, mostrarCarrito, generarFolio, iniciarCapturaDireccion, SESION_S, sessionManagerBot, filtroPalabras, TABLAS_ACTUALIZABLES, actualizarCampos, construirAudienciaMasivo, registrarErrorDB, SECURITY_HEADERS, NotificarSchema, MasivoSchema, GuiaSchema, PreventaSchema, ModuloConfigSchema, PrimeConfigSchema, PagoConfirmadoSchema, CostoEnvioSchema, CuponRedimirSchema, VentaPreviaSchema, NegocioSchema, ConfigContactoSchema, ConfigEmailBotSchema, PalabraFiltroSchema, InventarioMinimoSchema, SucursalSchema, SucursalUpdateSchema, ProductoSchema, ProductoUpdateSchema, CategoriaSchema, UsuarioSchema, UsuarioUpdateSchema,
    permisos, permite, autorizacion: require('./autorizacion'),
};

const ROUTE_MODULES = [
    require('./routes/core'),
    require('./routes/negocioOnboarding'),
    require('./routes/pos'),
    require('./routes/comunicacionPedidos'),
    require('./routes/atencionCliente'),
    require('./routes/catalogoCola'),
    require('./routes/marketing'),
    require('./routes/etiquetas'),
    require('./routes/primeConfig'),
    require('./routes/primeCatalogo'),
    require('./routes/primeUsuariosPuntos'),
    require('./routes/erpProveedores'),
    require('./routes/erpContabilidad'),
    require('./routes/seguridadOperativa'),
    require('./routes/almacen'),
    require('./routes/compras'),
    require('./routes/rrhh'),
    require('./routes/citas'),
    require('./routes/suscripciones'),
    require('./routes/documentos'),
    require('./routes/mesas'),
    require('./routes/tareas'),
    require('./routes/instancias'),
    require('./routes/flota'),
];

function handleAPI(req, res) {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const p = u.pathname;
    let i = 0;
    const next = () => {
        if (i >= ROUTE_MODULES.length) return json(res, { error: 'Ruta no encontrada' }, 404);
        const mod = ROUTE_MODULES[i++];
        return mod(req, res, p, u, ctx, next);
    };
    return next();
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

    // Rate limit solo para /api/* (los estáticos del bundle no cuentan — la
    // SPA carga decenas de chunks y agotaba el contador de la API, dejando
    // el panel en blanco). GET amplio: la SPA pollea QR/status/campana por
    // diseño. /api/login tiene su propio candado por username (5/15min).
    const esLogin = u.pathname === '/api/login' && req.method === 'POST';
    if (u.pathname.startsWith('/api/') && !esLogin && !rateLimit(req, res, req.method === 'POST' ? 80 : 600)) return;

    // /health no requiere auth — para monitoreo externo
    if (req.method === 'GET' && u.pathname === '/health') {
        return handleAPI(req, res);
    }

    const esRutaApi = u.pathname.startsWith('/api/');
    // Estas rutas manejan la ausencia de sesión ellas mismas (login la crea,
    // /me y /logout responden algo razonable sin una) — el resto de /api/* exige
    // sesión válida aquí, antes de llegar a handleAPI.
    const esRutaPublica = (u.pathname === '/api/login' && req.method === 'POST')
        || (u.pathname === '/api/logout' && req.method === 'POST')
        || (u.pathname === '/api/me' && req.method === 'GET')
        // /api/bot/qr NO es pública: ver el QR = poder vincular el WhatsApp.
        // Onboarding sí (instancia recién clonada sin sesión; se auto-bloquea
        // con 409 una vez configurado el negocio).
        || (u.pathname === '/api/onboarding/estado' && req.method === 'GET')
        || (u.pathname === '/api/onboarding' && req.method === 'POST')
        // Hub de flota: máquina-a-máquina, su propio token (no la sesión del
        // dashboard). El handler valida el token; sin token configurado da 404.
        || (u.pathname === '/api/flota/status' && req.method === 'GET');

    if (esRutaApi && !esRutaPublica) {
        const _sesGlobal = requireSession(req, res);
        if (!_sesGlobal) return;
        // AUDITOR = solo lectura de TODO: cualquier escritura muere aquí
        // (punto único; logout sí se permite para poder salir)
        if (permisos.esAuditor(_sesGlobal.rol) && req.method !== 'GET' && u.pathname !== '/api/logout') {
            return json(res, { ok: false, error: 'El rol Auditor es de solo lectura' }, 403);
        }
    }

    if (['POST','PUT','DELETE'].includes(req.method)) {
        if (rejectCrossSiteForm(req, res)) return;
        // La restauración de BD sube un archivo grande — usa su propio tope.
        if (u.pathname !== '/api/prime/restaurar-bd') capBodySize(req, res);
    }

    if (esRutaApi) return handleAPI(req, res);

    // Estáticos: el build de React (dashboard-ui/dist) si existe, o el
    // dashboard.html legado mientras se completa la migración. Públicos a
    // propósito — la pantalla de login es parte de este mismo bundle.
    return serveStatic(req, res, u.pathname);
}

// En Docker debe ser 0.0.0.0 (el mapeo de puertos entra por eth0); en Windows
// local se queda en 127.0.0.1. Se configura con DASHBOARD_HOST.
server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
        log.error('[HS-201] El dashboard NO pudo tomar el puerto ' + PORT + ' (ocupado). pm2 list / matar el proceso viejo.');
        process.exit(1);
    }
    log.error('[HS-201] Error del servidor http: ' + (e && e.message));
});
server.listen(PORT, process.env.DASHBOARD_HOST || '127.0.0.1', () => {
    log.info(`🧸 Dashboard corriendo en http://localhost:${PORT}`);
    log.info('Abre esa URL en el navegador del servidor.');
});

// ── Regla anti-zombie (HS-502): el dash SIEMPRE arranca primero; si la BD
// dice que el bot debía estar activo pero pm2 lo reporta caído/ausente
// (típico tras reload del contenedor), se reinicia el bridge UNA sola vez.
// Nunca en loop: si la sesión está corrupta el remedio es HS-503 (purga).
setTimeout(() => {
    try {
        const deseado = db.prepare("SELECT valor FROM configuracion WHERE clave='bot_estado_deseado'").get()?.valor === '1';
        if (!deseado) return;
        pm2(['jlist'], (err, stdout) => {
            if (err) return;
            try {
                const lista = JSON.parse(String(stdout).slice(String(stdout).indexOf('[')) || '[]');
                const bot = lista.find(x => x.name === 'bot-whatsapp');
                const online = bot && bot.pm2_env && bot.pm2_env.status === 'online';
                if (online) return;
                log.warn('[HS-502] El bot debía estar activo y pm2 lo reporta ' + (bot ? bot.pm2_env.status : 'ausente') + ' — reinicio único del bridge');
                pm2(bot ? ['restart', 'bot-whatsapp'] : ['start', ECOSYSTEM_PATH, '--only', 'bot-whatsapp'], (e2) => {
                    if (e2) log.error('[HS-502] El reinicio automático falló — si persiste, purga la sesión (HS-503) desde Prime');
                    else registrarCambioEstatusBot('online', '[HS-502] bridge reiniciado automáticamente al arrancar el dashboard');
                });
            } catch (_) {}
        });
    } catch (_) {}
}, 5000);

// ── Estáticos: build de React (dashboard-ui/dist) ──────────────────────────
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
        return res.end('<html><body><h1 style="font-family:sans-serif;padding:40px">Falta el build del dashboard: ejecuta "npm run build:dashboard-ui"</h1></body></html>');
    }
    res.writeHead(404); res.end('Not found');
}
