// tests/test_dashboard_api.js — Contrato HTTP de dashboard/server.js.
// Antes el único "test" del dashboard era tests/test_dashboard.html (manual,
// clic por clic contra un servidor corriendo) — bot/index.js sí tiene 100/100
// tests automatizados (test_bot.js) pero el backend del dashboard, con 2100+
// líneas y 65 rutas, no tenía ninguno que corriera con `node`.
//
// Mismo patrón de DB que test_marketing.js/test_carrito.js: DB_PATH=':memory:'
// con un subset de columnas hand-copiado de la base real (PRAGMA table_info,
// no db/schema.sql — está desactualizado, ver CLAUDE.md). A diferencia de
// esos, aquí SÍ se levanta el servidor HTTP real (dashboard/server.js es un
// entrypoint, no exporta nada) en un puerto fijo de prueba y se le pega con
// fetch real — es la única forma de probar requireSession/cookies/Zod tal
// cual los ve un cliente real.
'use strict';
process.env.DB_PATH = ':memory:';
process.env.DASHBOARD_PORT = process.env.DASHBOARD_PORT || '39091';
process.env.DASHBOARD_USER = 'test_admin';
process.env.DASHBOARD_PASS = 'test_pass_' + Math.random().toString(36).slice(2);
const BASE = `http://127.0.0.1:${process.env.DASHBOARD_PORT}`;

const db = require('../bot/db_connection');

// Subset de tablas que las rutas bajo prueba necesitan — server.js ya crea
// configuracion/usuarios/bot_status_log/sesiones_dashboard/palabras_filtro
// por su cuenta al cargar.
db.exec(`
CREATE TABLE pedidos (id_pedido INTEGER PRIMARY KEY AUTOINCREMENT, folio TEXT, cliente TEXT,
    estatus TEXT NOT NULL DEFAULT 'generado', ciudad_envio TEXT, email_notificado INTEGER DEFAULT 0,
    creado_en TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE links_pago (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER, monto REAL, estatus TEXT, url_link TEXT);
CREATE TABLE guias_estafeta (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER, numero_guia TEXT, estatus TEXT,
    fecha_envio_est TEXT, fecha_entrega_est TEXT);
CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, telefono TEXT, email TEXT,
    activo INTEGER DEFAULT 1, creado_en TEXT, ultima_actividad TEXT, codigo_referido TEXT, tags TEXT);
CREATE TABLE cola_atencion (id INTEGER PRIMARY KEY AUTOINCREMENT, estatus TEXT NOT NULL DEFAULT 'en_espera');
CREATE TABLE cola_emails (id INTEGER PRIMARY KEY AUTOINCREMENT, estatus TEXT NOT NULL DEFAULT 'pendiente');
CREATE TABLE promociones (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, tipo TEXT, valor REAL,
    id_producto INTEGER, fecha_inicio TEXT, fecha_fin TEXT, usos_max INTEGER DEFAULT 0, usos_actual INTEGER DEFAULT 0, activa INTEGER DEFAULT 1);
CREATE TABLE tickets_venta (id INTEGER PRIMARY KEY AUTOINCREMENT, id_promocion INTEGER);
CREATE TABLE cola_notificaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, estatus TEXT NOT NULL DEFAULT 'pendiente', intentos INTEGER NOT NULL DEFAULT 0);
`);

// Pedido de prueba para /api/pedidos
db.prepare("INSERT INTO pedidos (id_pedido, folio, cliente, estatus) VALUES (1, 'F-001', 'Cliente Test', 'generado')").run();

// Cupón de prueba para /api/cupon/redimir
db.prepare("INSERT INTO promociones (codigo, tipo, valor, usos_max, usos_actual, activa) VALUES ('TEST10', 'porcentaje', 10, 1, 0, 1)").run();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

async function main() {
    require('../dashboard/server'); // entrypoint — no exporta nada, llama server.listen() al cargar
    await new Promise(r => setTimeout(r, 400)); // tiempo a que el listen() async termine

    console.log('\nSuite: dashboard/server.js — contrato HTTP\n');

    // ── 1. Sin sesión: /api/pedidos debe rechazar ───────────────────────
    const sinSesion = await fetch(BASE + '/api/pedidos');
    ok(sinSesion.status === 401, 'GET /api/pedidos sin cookie de sesión -> 401');

    // ── 2. Login ─────────────────────────────────────────────────────────
    const loginMalo = await fetch(BASE + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: process.env.DASHBOARD_USER, password: 'incorrecta' }),
    });
    ok(loginMalo.status === 401, 'POST /api/login con password incorrecto -> 401');

    const loginBueno = await fetch(BASE + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: process.env.DASHBOARD_USER, password: process.env.DASHBOARD_PASS }),
    });
    ok(loginBueno.status === 200, 'POST /api/login con credenciales correctas -> 200');
    const setCookie = loginBueno.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0]; // "jc_session=<token>"
    ok(cookie.startsWith('jc_session='), 'login devuelve cookie jc_session');
    const authHeaders = { Cookie: cookie, 'Content-Type': 'application/json' };

    // ── 3. /api/me con la cookie ya autenticado ─────────────────────────
    const me = await fetch(BASE + '/api/me', { headers: authHeaders });
    const meBody = await me.json();
    ok(me.status === 200 && meBody.username === process.env.DASHBOARD_USER, 'GET /api/me refleja el usuario logueado');

    // ── 4. /api/pedidos con sesión ───────────────────────────────────────
    const pedidos = await fetch(BASE + '/api/pedidos', { headers: authHeaders });
    const pedidosBody = await pedidos.json();
    ok(pedidos.status === 200 && Array.isArray(pedidosBody) && pedidosBody.length === 1, 'GET /api/pedidos con sesión devuelve el pedido de prueba');

    // ── 5. /health no requiere sesión ────────────────────────────────────
    const health = await fetch(BASE + '/health');
    ok(health.status === 200, 'GET /health no requiere sesión');

    // ── 5b. /api/bot/qr — lo publica bot/index.js en `configuracion`, y es
    // pública A PROPÓSITO: tiene que verse ANTES de loguearse al dashboard
    // (App.jsx la usa para decidir si muestra el QR o la pantalla de login),
    // así que se prueba explícitamente SIN cookie de sesión.
    const qrSinSesion = await fetch(BASE + '/api/bot/qr');
    ok(qrSinSesion.status === 200, 'GET /api/bot/qr sin sesión -> 200 (pública a propósito, no 401)');
    const qrVacio = await qrSinSesion.json();
    ok(qrVacio.qr === null, 'GET /api/bot/qr sin QR pendiente devuelve null');
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('whatsapp_qr', 'dato-qr-de-prueba') ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run();
    const qrConDato = await (await fetch(BASE + '/api/bot/qr')).json();
    ok(qrConDato.qr === 'dato-qr-de-prueba', 'GET /api/bot/qr refleja el QR publicado por el bot, también sin sesión');

    // ── 6. /api/stats agrega correctamente ───────────────────────────────
    const stats = await fetch(BASE + '/api/stats', { headers: authHeaders });
    const statsBody = await stats.json();
    ok(stats.status === 200 && statsBody.pedidos_total === 1, 'GET /api/stats cuenta el pedido de prueba');
    ok(statsBody.emails_error === 0, 'GET /api/stats reporta 0 emails con error cuando no hay ninguno');
    db.prepare("INSERT INTO cola_emails (estatus) VALUES ('error')").run();
    const statsConError = await (await fetch(BASE + '/api/stats', { headers: authHeaders })).json();
    ok(statsConError.emails_error === 1, 'GET /api/stats refleja un email con estatus=error (antes invisible en el dashboard)');

    // ── 7. Validación Zod nueva (fase 3) en /api/cupon/redimir ──────────
    const cuponMalo = await fetch(BASE + '/api/cupon/redimir', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ codigo: 'TEST10', idTicket: 'no-es-numero' }),
    });
    ok(cuponMalo.status === 400, 'POST /api/cupon/redimir con idTicket no numérico -> 400 (antes pasaba silencioso)');

    const cuponBueno = await fetch(BASE + '/api/cupon/redimir', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ codigo: 'TEST10' }),
    });
    const cuponBody = await cuponBueno.json();
    ok(cuponBueno.status === 200 && cuponBody.ok === true, 'POST /api/cupon/redimir con código válido lo redime');

    const cuponRepetido = await fetch(BASE + '/api/cupon/redimir', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ codigo: 'TEST10' }),
    });
    const cuponRepetidoBody = await cuponRepetido.json();
    ok(cuponRepetidoBody.ok === false, 'el mismo cupón de un solo uso no se puede redimir dos veces');

    // ── 8. Body malformado no tira el proceso (fase 1) ───────────────────
    const malformado = await fetch(BASE + '/api/cupon/redimir', {
        method: 'POST', headers: authHeaders, body: '{esto no es json',
    });
    ok(malformado.status === 500, 'POST con JSON malformado responde 500 en vez de matar el proceso');
    const sigueViva = await fetch(BASE + '/health');
    ok(sigueViva.status === 200, 'el servidor sigue respondiendo después del body malformado');

    // ── 9. Logout invalida la sesión ──────────────────────────────────────
    await fetch(BASE + '/api/logout', { method: 'POST', headers: authHeaders });
    const trasLogout = await fetch(BASE + '/api/pedidos', { headers: authHeaders });
    ok(trasLogout.status === 401, 'tras logout, la misma cookie ya no es válida');

    console.log(`\n${pass}/${pass + fail} pruebas pasaron\n`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Error inesperado en la suite:', e); process.exit(1); });
