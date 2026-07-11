'use strict';
// ─────────────────────────────────────────────────────────────────────────
// HUB DEMO — la "parte antes de iniciar sesión" que pide el giro.
//
//   node scripts/demo/servir.js            (hub en http://127.0.0.1:4000)
//
// Muestra una landing "DEMO — escoge el giro". Al elegir uno, levanta (una
// sola vez, perezoso) una instancia del dashboard apuntando a demo/<giro>.db
// en su propio puerto y redirige ahí. Reusa el proceso si ya está arriba.
// Requiere haber corrido antes:  node scripts/demo/generar.js
// y tener construido el frontend: npm run build:dashboard-ui
// ─────────────────────────────────────────────────────────────────────────

require('dotenv').config({ quiet: true });
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..');
const DEMO_DIR = path.join(RAIZ, 'demo');
const HUB_PORT = parseInt(process.env.DEMO_PORT || '4000');
const BASE_PORT = 4001;

const GIROS_LABEL = {
    jugueteria: '🧸 Juguetería (Julio Cepeda — datos reales)', restaurante: '🍽️ Restaurante', abarrotes: '🛒 Abarrotes',
    carniceria: '🥩 Carnicería', ferreteria: '🔧 Ferretería', barberia: '💈 Barbería', estetica: '💅 Estética',
    servicios: '🛠️ Servicios', retail: '🛍️ Retail', tatuajes: '🎨 Tatuajes', unas: '💅 Uñas',
    mantenimiento: '🧰 Mantenimiento', isp: '📡 Internet/ISP', custom: '⚙️ Personalizado',
};

function girosDisponibles() {
    try { return JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'giros.json'), 'utf8')); }
    catch (_) { return fs.existsSync(DEMO_DIR) ? fs.readdirSync(DEMO_DIR).filter(f => f.endsWith('.db')).map(f => f.replace('.db', '')) : []; }
}

const procesos = {}; // giro → { port, child }

function esperarPuerto(port, cb, intentos = 40) {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); cb(true); });
    s.on('error', () => { s.destroy(); if (intentos <= 0) return cb(false); setTimeout(() => esperarPuerto(port, cb, intentos - 1), 250); });
}

function levantarGiro(giro, cb) {
    if (procesos[giro]) return cb(procesos[giro].port);
    const dbFile = path.join(DEMO_DIR, giro + '.db');
    if (!fs.existsSync(dbFile)) return cb(null);
    const giros = girosDisponibles();
    const port = BASE_PORT + Math.max(0, giros.indexOf(giro));
    const child = spawn('node', [path.join(RAIZ, 'dashboard', 'server.js')], {
        cwd: RAIZ,
        env: { ...process.env, DB_PATH: dbFile, DASHBOARD_PORT: String(port), DASHBOARD_HOST: '127.0.0.1' },
        stdio: 'ignore',
    });
    child.on('exit', () => { delete procesos[giro]; });
    procesos[giro] = { port, child };
    esperarPuerto(port, ok => cb(ok ? port : null));
}

const USUARIOS = ['prime', 'gerente', 'caja', 'almacen', 'rh', 'conta', 'compras', 'auditor'];

function landing() {
    const giros = girosDisponibles();
    const cards = giros.map(g => `<a class="card" href="/entrar?giro=${g}"><span class="lbl">${GIROS_LABEL[g] || g}</span><span class="go">Entrar →</span></a>`).join('');
    return `<!doctype html><html lang="es"><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo — escoge el giro</title><style>
body{font-family:system-ui,Segoe UI,sans-serif;background:#f3f4f6;color:#111;margin:0;padding:40px 20px}
.wrap{max-width:920px;margin:0 auto}h1{font-size:26px;margin:0 0 6px}p.sub{color:#666;margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.card{display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px 16px;text-decoration:none;color:#111;transition:.15s;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.card:hover{border-color:#111;transform:translateY(-2px)}.lbl{font-weight:600;font-size:15px}.go{color:#888;font-size:13px}
.cred{margin-top:28px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px}
.cred code{background:#f3f4f6;padding:2px 7px;border-radius:5px;font-size:13px}
.badge{display:inline-block;background:#111;color:#fff;font-size:11px;padding:3px 9px;border-radius:20px;margin-bottom:14px}
</style></head><body><div class="wrap">
<span class="badge">MODO DEMO · Hevcaz Solutions</span>
<h1>Escoge el giro para revisar</h1>
<p class="sub">Cada giro abre su propia tienda con un año de operación simulada. La juguetería conserva los datos reales de Julio Cepeda.</p>
<div class="grid">${cards || '<p>No hay giros generados. Corre <code>node scripts/demo/generar.js</code>.</p>'}</div>
<div class="cred"><strong>Usuarios para revisar</strong> (todos con clave <code>123</code>):<br><br>
${USUARIOS.map(u => `<code>${u}</code>`).join(' &nbsp; ')}<br><br>
<span style="color:#666;font-size:13px">prime = dueño (todo) · gerente = tienda · caja = cajero · almacen · rh · conta · compras · auditor (solo lectura)</span>
</div></div></body></html>`;
}

const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf8' }); return res.end(landing()); }
    if (u.pathname === '/entrar') {
        const giro = (u.searchParams.get('giro') || '').replace(/[^a-z]/g, '');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf8' });
        res.write('<!doctype html><meta charset="utf8"><body style="font-family:system-ui;padding:40px;color:#111">Levantando la tienda demo de <b>' + giro + '</b>…');
        levantarGiro(giro, port => {
            if (!port) return res.end('<p style="color:#b00">No se pudo levantar el giro. ¿Corriste <code>node scripts/demo/generar.js</code> y <code>npm run build:dashboard-ui</code>?</p>');
            res.end('<script>location.href="http://127.0.0.1:' + port + '/";</script><p>Redirigiendo… si no, abre <a href="http://127.0.0.1:' + port + '/">http://127.0.0.1:' + port + '</a></p>');
        });
        return;
    }
    res.writeHead(404); res.end('404');
});
server.listen(HUB_PORT, '127.0.0.1', () => console.log('[demo] Hub en http://127.0.0.1:' + HUB_PORT + '  (Ctrl+C para salir)'));
process.on('SIGINT', () => { for (const g in procesos) { try { procesos[g].child.kill(); } catch (_) {} } process.exit(0); });
