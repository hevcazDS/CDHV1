'use strict';
// ─────────────────────────────────────────────────────────────────────────
// SMOKE TEST DE RUTAS — la red de seguridad del refactor del tronco.
//
//   node tests/test_rutas_smoke.js
//
// Consume el índice canónico (scripts/rutas/inventario.js) y, contra un
// dashboard levantado sobre una BD demo/real, verifica:
//   1. Gate global intacto: una ruta no-pública SIN sesión → 401.
//      Una ruta pública SIN sesión → NO 401.
//   2. Ninguna ruta GET truena (status < 500) CON sesión (prime/123).
//
// Es el paso 2 del tronco: antes de migrar hojas a un registro de rutas, esto
// detecta si el ruteo/auth se rompe. No invoca rutas que mutan (POST/PUT/DELETE)
// para no tener efectos secundarios.
//
// Si no hay una BD utilizable (demo/*.db o DB_PATH), se salta con exit 0
// (mismo criterio que otros tests que requieren BD real).
// ─────────────────────────────────────────────────────────────────────────

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { extraer } = require('../scripts/rutas/inventario');

const RAIZ = path.join(__dirname, '..');
const PORT = 4095;
const HOST = '127.0.0.1';

// BD: preferir un clon demo (seguro, GET es de solo lectura), si no la real.
require('dotenv').config({ quiet: true });
function elegirDB() {
    const demo = path.join(RAIZ, 'demo');
    if (fs.existsSync(demo)) { const f = fs.readdirSync(demo).find(x => x.endsWith('.db')); if (f) return path.join(demo, f); }
    if (process.env.DB_PATH && fs.existsSync(process.env.DB_PATH)) return process.env.DB_PATH;
    return null;
}

function req(metodo, ruta, cookie) {
    return new Promise((resolve) => {
        const r = http.request({ host: HOST, port: PORT, path: ruta, method: metodo, headers: cookie ? { Cookie: cookie } : {} }, (res) => {
            let body = ''; res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
        });
        r.on('error', () => resolve({ status: 0, body: '' }));
        r.setTimeout(8000, () => { r.destroy(); resolve({ status: 0, body: 'timeout' }); });
        r.end();
    });
}

function esperarPuerto(cb, intentos = 40) {
    const s = require('net').connect(PORT, HOST);
    s.on('connect', () => { s.destroy(); cb(true); });
    s.on('error', () => { s.destroy(); if (intentos <= 0) return cb(false); setTimeout(() => esperarPuerto(cb, intentos - 1), 250); });
}

function urlDe(r) {
    if (r.tipo === 'exacta') return r.ruta;
    if (r.tipo === 'prefijo') return r.ruta.slice(0, -1) + '1'; // '/api/x/*' → '/api/x/1'
    return r.ruta.replace(/\\d\+/g, '1').replace(/\\\w/g, '').replace(/[()?]/g, ''); // patrón
}

async function main() {
    const db = elegirDB();
    if (!db) { console.log('⚠️  Sin BD utilizable (demo/*.db o DB_PATH) — smoke test omitido (exit 0).'); process.exit(0); }
    console.log('[smoke] BD: ' + db);
    // Si es un clon demo, aplicar migraciones (idempotente) para que el smoke
    // corra contra el esquema completo. NO se migra la BD real automáticamente.
    if (db.replace(/\\/g, '/').includes('/demo/')) {
        try { execFileSync('node', [path.join(RAIZ, 'scripts', 'migrate.js')], { cwd: RAIZ, env: { ...process.env, DB_PATH: db }, stdio: 'ignore' }); }
        catch (_) { console.log('[smoke] aviso: no se pudo migrar el clon demo (sigue de todos modos).'); }
    }

    const rutas = extraer();
    const srv = spawn('node', [path.join(RAIZ, 'dashboard', 'server.js')], {
        cwd: RAIZ, stdio: 'ignore',
        env: { ...process.env, DB_PATH: db, DASHBOARD_PORT: String(PORT), DASHBOARD_HOST: HOST },
    });
    const cerrar = (code) => { try { srv.kill(); } catch (_) {} process.exit(code); };

    const arriba = await new Promise(res => esperarPuerto(res));
    if (!arriba) { console.error('❌ El dashboard no levantó en el puerto ' + PORT); cerrar(1); }

    let fallos = 0, ok = 0;
    const fail = (msg) => { console.error('  ❌ ' + msg); fallos++; };

    // 1. Gate global. /api/me es pública (sin gate global) pero su handler
    // responde 401 si no hay sesión — eso es correcto (es el "¿quién soy?").
    // Lo que NO debe pasar es que truene (500).
    const publica = await req('GET', '/api/me');
    if (publica.status >= 500) fail('GET /api/me (pública) devolvió ' + publica.status); else ok++;
    const protegida = await req('GET', '/api/stats');
    if (protegida.status !== 401) fail('GET /api/stats SIN sesión devolvió ' + protegida.status + ' (esperado 401) — gate global roto'); else ok++;

    // Login prime/123
    const login = await new Promise((resolve) => {
        const data = JSON.stringify({ username: 'prime', password: '123' });
        const r = http.request({ host: HOST, port: PORT, path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
            let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, cookie: (res.headers['set-cookie'] || [])[0] }));
        });
        r.on('error', () => resolve({ status: 0 })); r.end(data);
    });
    if (!login.cookie) { console.error('❌ No se pudo iniciar sesión prime/123 (status ' + login.status + '). ¿Es una BD demo? Genera con npm run demo:generar.'); cerrar(1); }
    const cookie = login.cookie.split(';')[0];

    // 2. Rutas GET no truenan (con sesión)
    const gets = rutas.filter(r => r.metodo === 'GET');
    for (const r of gets) {
        const res = await req('GET', urlDe(r), cookie);
        if (res.status >= 500 || res.status === 0) fail('GET ' + urlDe(r) + ' → ' + (res.status || 'sin respuesta') + '  (' + r.archivo + ':' + r.linea + ')');
        else ok++;
    }

    console.log('\n' + '═'.repeat(55));
    console.log('SMOKE RUTAS: ' + ok + ' ok, ' + fallos + ' fallo(s)  (' + gets.length + ' GET probadas + gate global)');
    console.log('═'.repeat(55));
    cerrar(fallos ? 1 : 0);
}

main();
