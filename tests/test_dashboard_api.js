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
//
// dashboard/server.js nunca cierra su listener (es un entrypoint real), así
// que el proceso del test runner se queda vivo tras la última aserción —
// por eso el script npm de este archivo corre con `--test-force-exit`.
'use strict';
process.env.DB_PATH = ':memory:';
process.env.DASHBOARD_PORT = process.env.DASHBOARD_PORT || '39091';
process.env.DASHBOARD_USER = 'test_admin';
process.env.DASHBOARD_PASS = 'test_pass_' + Math.random().toString(36).slice(2);
const BASE = `http://127.0.0.1:${process.env.DASHBOARD_PORT}`;

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../bot/db_connection');

// Subset de tablas que las rutas bajo prueba necesitan — server.js ya crea
// configuracion/usuarios/bot_status_log/sesiones_dashboard/palabras_filtro
// por su cuenta al cargar.
db.exec(`
CREATE TABLE pedidos (id_pedido INTEGER PRIMARY KEY AUTOINCREMENT, folio TEXT, cliente TEXT,
    id_cliente INTEGER, a_credito INTEGER DEFAULT 0, cobrado_por TEXT,
    estatus TEXT NOT NULL DEFAULT 'generado', ciudad_envio TEXT, email_notificado INTEGER DEFAULT 0,
    metodo_entrega TEXT, metodo_pago TEXT, repartidor_nombre TEXT, repartidor_telefono TEXT,
    creado_en TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE links_pago (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER, monto REAL, estatus TEXT, url_link TEXT,
    pagado_en TEXT);
CREATE TABLE guias_estafeta (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER, numero_guia TEXT, estatus TEXT,
    fecha_envio_est TEXT, fecha_entrega_est TEXT);
CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, telefono TEXT, email TEXT,
    activo INTEGER DEFAULT 1, creado_en TEXT, ultima_actividad TEXT, codigo_referido TEXT, tags TEXT,
    marketing_opt_out INTEGER NOT NULL DEFAULT 0);
CREATE TABLE cola_atencion (id INTEGER PRIMARY KEY AUTOINCREMENT, estatus TEXT NOT NULL DEFAULT 'en_espera');
CREATE TABLE cola_emails (id INTEGER PRIMARY KEY AUTOINCREMENT, estatus TEXT NOT NULL DEFAULT 'pendiente');
CREATE TABLE promociones (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, tipo TEXT, valor REAL,
    id_producto INTEGER, fecha_inicio TEXT, fecha_fin TEXT, usos_max INTEGER DEFAULT 0, usos_actual INTEGER DEFAULT 0, activa INTEGER DEFAULT 1);
CREATE TABLE tickets_venta (id INTEGER PRIMARY KEY AUTOINCREMENT, id_promocion INTEGER);
CREATE TABLE cola_notificaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, estatus TEXT NOT NULL DEFAULT 'pendiente', intentos INTEGER NOT NULL DEFAULT 0);
`);

// Pedido de prueba para /api/pedidos
db.prepare("INSERT INTO pedidos (id_pedido, folio, cliente, estatus) VALUES (1, 'F-001', 'Cliente Test', 'generado')").run();

// Cupón de prueba para /api/cupon/validar
db.prepare("INSERT INTO promociones (codigo, tipo, valor, usos_max, usos_actual, activa) VALUES ('TEST10', 'porcentaje', 10, 1, 0, 1)").run();

let authHeaders;

before(async () => {
    require('../dashboard/server'); // entrypoint — no exporta nada, llama server.listen() al cargar
    await new Promise(r => setTimeout(r, 400)); // tiempo a que el listen() async termine
});

// ── 1. Sin sesión: /api/pedidos debe rechazar ───────────────────────
test('GET /api/pedidos sin cookie de sesión -> 401', async () => {
    const sinSesion = await fetch(BASE + '/api/pedidos');
    assert.strictEqual(sinSesion.status, 401);
});

// ── 2. Login ─────────────────────────────────────────────────────────
test('POST /api/login con password incorrecto -> 401', async () => {
    const loginMalo = await fetch(BASE + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: process.env.DASHBOARD_USER, password: 'incorrecta' }),
    });
    assert.strictEqual(loginMalo.status, 401);
});

test('POST /api/login con credenciales correctas -> 200 y cookie jc_session', async () => {
    const loginBueno = await fetch(BASE + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: process.env.DASHBOARD_USER, password: process.env.DASHBOARD_PASS }),
    });
    assert.strictEqual(loginBueno.status, 200);
    const setCookie = loginBueno.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0]; // "jc_session=<token>"
    assert.ok(cookie.startsWith('jc_session='), 'login devuelve cookie jc_session');
    authHeaders = { Cookie: cookie, 'Content-Type': 'application/json' };
});

// ── 3. /api/me con la cookie ya autenticado ─────────────────────────
test('GET /api/me refleja el usuario logueado', async () => {
    const me = await fetch(BASE + '/api/me', { headers: authHeaders });
    const meBody = await me.json();
    assert.strictEqual(me.status, 200);
    assert.strictEqual(meBody.username, process.env.DASHBOARD_USER);
});

// ── 4. /api/pedidos con sesión ───────────────────────────────────────
test('GET /api/pedidos con sesión devuelve el pedido de prueba', async () => {
    const pedidos = await fetch(BASE + '/api/pedidos', { headers: authHeaders });
    const pedidosBody = await pedidos.json();
    assert.strictEqual(pedidos.status, 200);
    assert.ok(Array.isArray(pedidosBody) && pedidosBody.length === 1);
});

// ── 5. /health no requiere sesión ────────────────────────────────────
test('GET /health no requiere sesión', async () => {
    const health = await fetch(BASE + '/health');
    assert.strictEqual(health.status, 200);
});

// ── 5b. /api/bot/qr — lo publica bot/index.js en `configuracion`. EXIGE
// sesión (contrato nuevo para despliegue en servidor): quien vea el QR
// puede vincular el WhatsApp del negocio a su teléfono, así que sin
// cookie debe responder 401. Flujo: login primero, QR después (App.jsx).
test('GET /api/bot/qr sin sesión -> 401 (ya no es pública)', async () => {
    const qrSinSesion = await fetch(BASE + '/api/bot/qr');
    assert.strictEqual(qrSinSesion.status, 401);
});

test('GET /api/bot/qr con sesión y sin QR pendiente devuelve null', async () => {
    const qrVacio = await (await fetch(BASE + '/api/bot/qr', { headers: authHeaders })).json();
    assert.strictEqual(qrVacio.qr, null);
});

test('GET /api/bot/qr con sesión refleja el QR publicado por el bot', async () => {
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('whatsapp_qr', 'dato-qr-de-prueba') ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run();
    const qrConDato = await (await fetch(BASE + '/api/bot/qr', { headers: authHeaders })).json();
    assert.strictEqual(qrConDato.qr, 'dato-qr-de-prueba');
});

// ── 6. /api/stats agrega correctamente ───────────────────────────────
test('GET /api/stats cuenta el pedido de prueba', async () => {
    const stats = await fetch(BASE + '/api/stats', { headers: authHeaders });
    const statsBody = await stats.json();
    assert.strictEqual(stats.status, 200);
    assert.strictEqual(statsBody.pedidos_total, 1);
});

test('GET /api/stats reporta 0 emails con error cuando no hay ninguno', async () => {
    const stats = await fetch(BASE + '/api/stats', { headers: authHeaders });
    const statsBody = await stats.json();
    assert.strictEqual(statsBody.emails_error, 0);
});

test('GET /api/stats refleja un email con estatus=error (antes invisible en el dashboard)', async () => {
    db.prepare("INSERT INTO cola_emails (estatus) VALUES ('error')").run();
    const statsConError = await (await fetch(BASE + '/api/stats', { headers: authHeaders })).json();
    assert.strictEqual(statsConError.emails_error, 1);
});

// ── 7. Cupón: validar (redimir se BORRÓ — el POS redime inline en /api/pos/venta) ──
test('GET /api/cupon/validar reconoce el cupón activo', async () => {
    const cuponValida = await fetch(BASE + '/api/cupon/validar?codigo=TEST10', { headers: authHeaders });
    const cuponVBody = await cuponValida.json();
    assert.strictEqual(cuponValida.status, 200);
    assert.strictEqual(cuponVBody.ok, true);
});

test('GET /api/cupon/validar rechaza código inexistente', async () => {
    const cuponInvalido = await fetch(BASE + '/api/cupon/validar?codigo=NOEXISTE', { headers: authHeaders });
    assert.strictEqual((await cuponInvalido.json()).ok, false);
});

// ── 8. Body malformado no tira el proceso (fase 1) ───────────────────
test('POST con JSON malformado responde error en vez de matar el proceso', async () => {
    const malformado = await fetch(BASE + '/api/tono', {
        method: 'POST', headers: authHeaders, body: '{esto no es json',
    });
    assert.ok(malformado.status >= 400);
});

test('el servidor sigue respondiendo después del body malformado', async () => {
    const sigueViva = await fetch(BASE + '/health');
    assert.strictEqual(sigueViva.status, 200);
});

// ── 9. Logout invalida la sesión ──────────────────────────────────────
test('tras logout, la misma cookie ya no es válida', async () => {
    await fetch(BASE + '/api/logout', { method: 'POST', headers: authHeaders });
    const trasLogout = await fetch(BASE + '/api/pedidos', { headers: authHeaders });
    assert.strictEqual(trasLogout.status, 401);
});
