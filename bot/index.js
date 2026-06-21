// index.js — Bot WhatsApp Julio Cepeda Jugueterías
// Pipeline completo embebido: rate limiting, filtro contenido, quejas, imágenes
'use strict';

// ── Cargar .env antes que cualquier otro módulo ────────────────────────────
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
require('dotenv').config({ quiet: true });

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode         = require('qrcode-terminal');
const sessionManager = require('./sessionManager');
const botConfig = (() => { try { return require('./flows/_config'); } catch(_) { return { t:()=>'' , moduloActivo:()=>true }; } })();
const actionHandler  = require('./actionHandler');
const intentDetector = require('./intentDetector');
const log            = require('./logger')('bot');
const { validarEnv, validarMensajeWhatsApp } = require('./validators');

// Por defecto el bot debe correr en modo headless para no abrir Chrome visible.
// Solo si se fuerza explícitamente WHATSAPP_HEADLESS=false se mostrará la ventana.
const WHATSAPP_HEADLESS = process.env.WHATSAPP_HEADLESS !== 'false';

// Escapa una ruta para usarla dentro de un patrón -like de PowerShell: además
// de duplicar comillas simples (delimitador de la cadena), [ ] deben llevar
// backtick porque -like los interpreta como clase de caracteres — sin esto,
// una ruta de proyecto con corchetes (ej. "OneDrive [Trabajo]") haría que el
// filtro nunca matchee nada, regresando en silencio al bug que esto arregla.
function escaparParaPsLike(ruta) {
    return ruta.replace(/'/g, "''").replace(/([[\]])/g, '`$1');
}
let qrMostrado = false;
let dashboardAbierto = false;
let stockWatcherWorker = null;

// Devuelve una Promise que resuelve cuando el cierre terminó (+ un colchón
// breve) — antes esta función no se esperaba en ningún lado: se disparaba el
// taskkill y, sin pausa, seguía directo a client.initialize(), que lanza un
// Chrome nuevo casi al mismo tiempo que Windows todavía está liberando los
// handles del Chrome anterior recién matado. Eso es justo lo que reprodujo
// consistentemente "Failed to launch the browser process: Code: 1" en cada
// arranque/reinicio (vía start.bat, pm2 restart o un crash-restart), no solo
// como un caso raro — el reintento de client.initialize() (más abajo) lo
// disimulaba, pero el primer intento fallaba siempre por esta carrera.
//
// Antes mataba por nombre de imagen (chrome.exe/chromium.exe/msedge.exe/
// electron.exe) sin distinción: en cada reinicio del bot se llevaba por
// delante el navegador personal del usuario y la ventana de Electron del
// dashboard si estaban abiertos, dando la sensación de ventanas que se
// abren y cierran solas. Ahora solo apunta al chrome.exe que usa el
// user-data-dir de WhatsApp de este proyecto (.wwebjs_auth), identificado
// por su línea de comando — nunca toca otros procesos del sistema.
function intentarCerrarProcesosBrowser() {
    if (process.platform !== 'win32') return Promise.resolve();
    return new Promise(resolve => {
        const sessionDir = escaparParaPsLike(path.join(__dirname, '..', '.wwebjs_auth'));
        const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${sessionDir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
        try {
            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
                windowsHide: true,
            }, () => setTimeout(resolve, 1500));
        } catch (_) { resolve(); }
    });
}

function limpiarSesionLocalAuth() {
    const authRoot = path.join(__dirname, '..', '.wwebjs_auth');
    const sessionDir = path.join(authRoot, 'session');
    try {
        if (fs.existsSync(sessionDir)) {
            log.warn('Limpiando carpeta de sesión previa de WhatsApp para evitar bloqueos de navegador');
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    } catch (e) {
        log.warn('No se pudo limpiar la carpeta de sesión previa', e);
    }
}

function abrirDashboard() {
    if (dashboardAbierto) return;
    const root = path.join(__dirname, '..');
    // Se abre al arrancar el bot, no al quedar 'ready' (autenticado) — si no,
    // mientras WhatsApp no esté vinculado nunca aparece ninguna ventana desde
    // donde escanear el QR (el propio QR solo se ve dentro del dashboard que
    // esto abre), un punto muerto: para ver el QR había que esperar a estar
    // ya conectado. desktop/main.js ya reintenta loadURL ~20s por su cuenta
    // si el servidor del dashboard todavía no levantó.
    const lanzar = () => {
        dashboardAbierto = true;
        log.info('Abriendo dashboard...');
        if (process.platform === 'win32') {
            execFile('cmd.exe', ['/d', '/s', '/c', 'npx.cmd --prefix desktop electron desktop'], {
                cwd: root,
                windowsHide: true,
            }, (err) => {
                if (err) {
                    log.warn('No se pudo abrir el dashboard automáticamente', err.message);
                }
            });
            return;
        }
        execFile('npx', ['--prefix', 'desktop', 'electron', 'desktop'], {
            cwd: root,
            windowsHide: false,
        }, (err) => {
            if (err) {
                log.warn('No se pudo abrir el dashboard automáticamente', err.message);
            }
        });
    };
    // Antes esto se lanzaba sin comprobar nada: cada reinicio del bot (un
    // `disconnected` de WhatsApp, un crash, un click en "Reiniciar" del
    // widget de estatus) abría OTRA ventana de Electron encima de la que el
    // usuario ya tenía abierta — eso, sumado al taskkill de arriba matando
    // esa misma ventana vieja en cada arranque, es lo que se veía como
    // "se abre y cierra una ventana sola cada poco tiempo".
    if (process.platform === 'win32') {
        const desktopDir = escaparParaPsLike(path.join(root, 'desktop'));
        const ps = `(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${desktopDir}*' }).Count`;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err, stdout) => {
            const yaAbierta = !err && parseInt(String(stdout).trim(), 10) > 0;
            if (yaAbierta) {
                dashboardAbierto = true;
                log.info('Ventana del dashboard ya está abierta — no se abre otra');
                return;
            }
            lanzar();
        });
        return;
    }
    lanzar();
}

// ── Validar .env al arrancar ────────────────────────────────────
const _envCheck = validarEnv();
if (!_envCheck.ok) {
    log.error('❌ Bot detenido — faltan variables de entorno críticas: ' + _envCheck.faltantes.join(', '));
    process.exit(1);
}

// Sin esto, Node deja el proceso corriendo en un estado corrupto tras una
// excepción no capturada (con un listener registrado, Node ya no sale solo) —
// mejor un reinicio limpio vía pm2 que un bot zombie que parece vivo pero ya
// no procesa mensajes correctamente. shutdown() está definido más abajo.
process.on('uncaughtException',  e => { log.error('🔴 CRÍTICO', e); shutdown('uncaughtException'); });
process.on('unhandledRejection', e => log.error('🔴 PROMESA', e instanceof Error ? e : new Error(String(e))));

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS OPCIONALES — si no existen en carpeta, no rompen el bot
// ══════════════════════════════════════════════════════════════════
function tryRequire(mod) {
    try { return require(mod); } catch (_) { return null; }
}
const imageAnalyzer = tryRequire('./imageAnalyzer');

// ══════════════════════════════════════════════════════════════════
//  CUOTA DIARIA DE IMÁGENES GUARDADAS EN DISCO — el rate-limiter de abajo
//  ya frena ráfagas (3/min), pero no frena acumulación sostenida 24/7: un
//  solo número podría llenar bot/imagenes_clientes/ indefinidamente y tirar
//  el disco (bot + dashboard comparten volumen). Esto NO bloquea Vision ni
//  la búsqueda del cliente — solo deja de persistir el archivo en disco
//  pasado el tope diario.
// ══════════════════════════════════════════════════════════════════
const _imgDiario = new Map(); // userId → { fecha: 'YYYY-MM-DD', count }
const IMG_DIARIO_MAX = 30;
function permitirGuardarImagen(userId) {
    const hoy = new Date().toISOString().slice(0, 10);
    const d = _imgDiario.get(userId);
    if (!d || d.fecha !== hoy) { _imgDiario.set(userId, { fecha: hoy, count: 1 }); return true; }
    if (d.count >= IMG_DIARIO_MAX) return false;
    d.count++;
    return true;
}
// Limpiar entradas de días anteriores una vez al día — el Map nunca crece
// más allá del número de usuarios activos en las últimas ~24-48h.
setInterval(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    for (const [uid, d] of _imgDiario) if (d.fecha !== hoy) _imgDiario.delete(uid);
}, 6 * 3_600_000).unref();

// ══════════════════════════════════════════════════════════════════
//  RATE LIMITER — ventana deslizante en memoria, sin archivos extra
// ══════════════════════════════════════════════════════════════════
const _rl = new Map(); // userId → [timestamps]
const RL_LIMIT_MIN  = 10;   // máx mensajes por minuto
const RL_LIMIT_5MIN = 30;   // máx mensajes por 5 min
const RL_IMG_MIN    = 3;    // máx imágenes por minuto

// Limpiar usuarios inactivos cada 10 min + límite de tamaño
setInterval(() => {
    const now    = Date.now();
    const cutoff = now - 3_600_000;
    // Si el mapa crece demasiado, limpiar los más viejos primero
    if (_rl.size > 500) {
        // Antes comparaba a[1].msgs, que nunca existe (el objeto solo tiene
        // .ts/.img) — siempre evaluaba a [0] y el desalojo "más viejo primero"
        // en realidad borraba entradas casi al azar.
        const sorted = [..._rl.entries()].sort((a,b) => {
            const lastA = Math.max(0, ...a[1].ts, ...a[1].img);
            const lastB = Math.max(0, ...b[1].ts, ...b[1].img);
            return lastA - lastB;
        });
        sorted.slice(0, 200).forEach(([uid]) => _rl.delete(uid));
    }
    for (const [uid, d] of _rl) {
        if (!d.ts.length || d.ts[d.ts.length-1] < cutoff) _rl.delete(uid);
    }
    // ponytail: mismas pasadas para los Maps de moderación — sin esto crecen sin límite de por vida del proceso
    for (const [uid, d] of _blockCounts)  if (now - d.since > 600_000) _blockCounts.delete(uid);
    for (const [uid, until] of _blockTimeout) if (now > until) _blockTimeout.delete(uid);
    for (const [uid, q] of _quejas) if (!q.ts || now - q.ts > 1_800_000) _quejas.delete(uid);
}, 600_000).unref();

function rlCheck(userId, isImage) {
    const now = Date.now();
    if (!_rl.has(userId)) _rl.set(userId, { ts: [], img: [] });
    const d = _rl.get(userId);
    // Podar timestamps viejos
    d.ts  = d.ts.filter(t => t > now - 300_000);   // ventana 5 min
    d.img = d.img.filter(t => t > now - 60_000);

    const last60  = d.ts.filter(t => t > now - 60_000).length;
    const last5m  = d.ts.length;

    if (last60 >= RL_LIMIT_MIN) {
        const wait = Math.ceil((d.ts.find(t => t > now - 60_000) + 60_000 - now) / 1000);
        return { ok: false, msg: `⏳ Estás enviando mensajes muy rápido. Espera *${wait} segundos*.` };
    }
    if (last5m >= RL_LIMIT_5MIN) {
        return { ok: false, msg: `⏳ Demasiados mensajes. Espera un momento antes de continuar.` };
    }
    if (isImage && d.img.length >= RL_IMG_MIN) {
        return { ok: false, msg: `⏳ Límite de imágenes alcanzado. Espera un minuto. 📸` };
    }

    d.ts.push(now);
    if (isImage) d.img.push(now);
    return { ok: true };
}

// ══════════════════════════════════════════════════════════════════
//  FILTRO DE CONTENIDO — lista negra + puntuación de riesgo
// ══════════════════════════════════════════════════════════════════
const filtroPalabras = require('./filtroPalabras');
try { filtroPalabras.asegurarTabla(require('./db_connection')); } catch (_) {}

// Palabras BASE — viven en código, siguen aplicando aunque la tabla
// palabras_filtro no exista o la consulta a la BD falle.
// Palabras cortas: solo match como palabra completa
const _BW_WORD = new Set(filtroPalabras.BW_WORD_BASE);
// Palabras/frases largas: substring match
const _BW_LONG = new Set(filtroPalabras.BW_LONG_BASE);
// Alias para compatibilidad con cfCheck
const _BLOCKED_WORDS = _BW_LONG;
const _RISK_WORDS = filtroPalabras.RISK_WORDS_BASE;

// Palabras agregadas desde el dashboard (usuario prime) — se refrescan cada
// 60s desde la tabla `palabras_filtro`. Si la consulta falla se mantienen
// las últimas listas cargadas (o vacías al inicio) y el filtro BASE de
// arriba sigue funcionando igual — agregar/quitar una palabra personalizada
// nunca puede romper el bot ni dejar pasar contenido bloqueado.
let _customPalabras = { bwWord: [], bwLong: [], risk: {}, quejaL1: [], quejaL2: [] };
let _customPalabrasTs = 0;
function _refrescarPersonalizadas() {
    const now = Date.now();
    if (now - _customPalabrasTs < 60_000) return _customPalabras;
    _customPalabrasTs = now;
    try {
        _customPalabras = filtroPalabras.cargarPersonalizadas(require('./db_connection'));
    } catch (_) { /* se mantienen las últimas listas cargadas */ }
    return _customPalabras;
}

// Palabras de frustración legítima — no bloquear, detectar cliente alterado
const _FRUSTRATION_WORDS = new Set([
    'perra','perro','chingada','chingado','cabron','cabrona',
    'idiota','imbecil','estupido','estupida','pendejo','pendeja',
    'maldito','maldita','contesta','contestame','responde',
    'apurate','alguien',
]);
// 'bueno' y 'oye' son muletillas neutras muy comunes en español mexicano
// ("Bueno, ¿tienen envíos?", "Oye, ¿cuánto cuesta?") — no cuentan como
// frustración por sí solas, solo si el mensaje también trae puntuación de
// urgencia repetida (!!, ??, ?!, etc).
const _FRUSTRATION_WORDS_WEAK = new Set(['bueno', 'oye']);
const _URGENCIA_RE = /[!?\u00a1\u00bf]{2,}/;
function esFrustracion(text) {
    if (!text) return false;
    const n = _normalize(text);
    const words = n.split(/[\s,.:;!?\u00a1\u00bf'"()+]+/);
    if (words.some(w => _FRUSTRATION_WORDS.has(w))) return true;
    return _URGENCIA_RE.test(text) && words.some(w => _FRUSTRATION_WORDS_WEAK.has(w));
}

// Bloques de conteo por usuario: userId → { count, since }
const _blockCounts = new Map();
// Timeout post-bloqueo: userId → timestamp hasta cuando ignorar mensajes
const _blockTimeout = new Map();
const BLOCK_TIMEOUT_MS = 2 * 60_000; // 2 minutos de silencio tras bloqueo

function _normalize(s) {
    let out = s.toLowerCase()
        .replace(/[áéíóúüñ]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u',ü:'u',ñ:'n'}[c]||c));
    // Leetspeak: sustituir dígitos/símbolos comunes por la letra que imitan
    // ("p3n3" -> "pene", "s3x0" -> "sexo"), pero solo dentro de tokens que ya
    // tienen al menos una letra — así no se tocan números puros (precios,
    // teléfonos, códigos de pedido/ticket).
    out = out.replace(/[a-z0-9$@]+/g, tok => /[a-z]/.test(tok)
        ? tok.replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e')
              .replace(/4/g,'a').replace(/5/g,'s').replace(/7/g,'t')
              .replace(/\$/g,'s').replace(/@/g,'a')
        : tok);
    return out.replace(/\s+/g, ' ').trim();
}

function cfCheck(userId, text) {
    if (!text) return { blocked: false };
    const n = _normalize(text);
    const custom = _refrescarPersonalizadas();

    // Palabras cortas — solo palabra completa
    const _wn = n.split(/[\s,.:;!?\u00a1\u00bf'"()+]+/);
    for (const w of _BW_WORD) { if (_wn.includes(w)) return _cfBlock(userId); }
    for (const w of custom.bwWord) { if (_wn.includes(w)) return _cfBlock(userId); }
    // Palabras largas — substring
    for (const w of _BW_LONG) { if (n.includes(w)) return _cfBlock(userId); }
    for (const w of custom.bwLong) { if (n.includes(w)) return _cfBlock(userId); }
    // Puntuación de riesgo
    let score = 0;
    for (const [w, pts] of Object.entries(_RISK_WORDS)) {
        if (n.includes(w)) { score += pts; if (score >= 3) return _cfBlock(userId); }
    }
    for (const [w, pts] of Object.entries(custom.risk)) {
        if (n.includes(w)) { score += pts; if (score >= 3) return _cfBlock(userId); }
    }
    // Evasión: letras separadas "p e n e"
    if (/\b([a-z][\s._]{1,2}){3,}[a-z]\b/i.test(text)) return _cfBlock(userId);
    return { blocked: false };
}

function _cfBlock(userId) {
    const now  = Date.now();
    const data = _blockCounts.get(userId) || { count: 0, since: now };
    if (now - data.since > 600_000) { data.count = 0; data.since = now; }
    data.count++;
    _blockCounts.set(userId, data);
    // Activar timeout: ignorar mensajes siguientes por 2 minutos
    _blockTimeout.set(userId, now + BLOCK_TIMEOUT_MS);
    const enTimeout = data.count >= 2; // desde el 2do bloqueo ya pone en silencio
    return {
        blocked: true,
        escalate: data.count >= 3,
        enTimeout,
        msg: data.count === 1
            ? 'No puedo procesar esa consulta. \u00bfNecesitas ayuda con alg\u00fan producto? \uD83E\uDDF8'
            : '\u26A0\uFE0F Tus mensajes ser\u00e1n ignorados temporalmente. Escribe *hola* cuando quieras continuar.',
    };
}

// ══════════════════════════════════════════════════════════════════
//  DETECCIÓN DE QUEJAS — 3 niveles + flujo empático
// ══════════════════════════════════════════════════════════════════
const _QUEJA_L1 = filtroPalabras.QUEJA_L1_BASE;
const _QUEJA_L2 = filtroPalabras.QUEJA_L2_BASE;

// userId → { paso: 0|1|2, textos: [], motivo: string }
const _quejas = new Map();

const _RESP_VAL = [
    'Entiendo que estés molesto/a. Lamento lo que pasó. Cuéntame más para poder ayudarte.',
    'Tienes razón en sentirte así. Lo lamento de verdad. ¿Qué ocurrió exactamente?',
    'Lamento mucho esta situación. Quiero ayudarte. ¿Me cuentas qué pasó?',
];
const _RESP_ESC = [
    'Gracias por explicarme. He tomado nota. Tu caso no va a ser ignorado.',
    'Entiendo perfectamente. Ya lo tengo anotado. Esto se atenderá.',
];
let _rvi = 0, _rei = 0;

const _dbCaso = require('./db_connection');
_dbCaso.prepare(
    "CREATE TABLE IF NOT EXISTS contadores_caso (fecha TEXT PRIMARY KEY, ultimo_n INTEGER NOT NULL DEFAULT 0)"
).run();

function _fechaHoy() { return new Date().toISOString().slice(0,10).replace(/-/g,''); }

// Contador respaldado en DB (no en memoria) — antes _casoN se reseteaba a 0
// en cada restart del bot y podía repetir números de caso del mismo día.
function _generarCaso() {
    const fecha = _fechaHoy();
    try {
        _dbCaso.prepare(
            `INSERT INTO contadores_caso (fecha, ultimo_n) VALUES (?, 1)
             ON CONFLICT(fecha) DO UPDATE SET ultimo_n = ultimo_n + 1`
        ).run(fecha);
        const row = _dbCaso.prepare('SELECT ultimo_n FROM contadores_caso WHERE fecha=?').get(fecha);
        const n = row ? row.ultimo_n : 1;
        return `CASO-${fecha}-${String(n).padStart(3,'0')}`;
    } catch (e) {
        return `CASO-${fecha}-${String(Date.now()).slice(-3)}`;
    }
}

function _normQ(s) {
    return s.toLowerCase()
        .replace(/[áéíóúñ]/g, c=>({á:'a',é:'e',í:'i',ó:'o',ú:'u',ñ:'n'}[c]||c));
}

// Fuzzy matching de Fase JIUA 5 — alcance deliberadamente angosto: distancia
// de Levenshtein, sin librería externa (todo el bot es basado en reglas, ver
// CLAUDE.md), aplicada SOLO a palabras sueltas de _QUEJA_L1 (nunca a las
// frases de 2+ palabras como "no funciona" o "cobro indebido" — el riesgo de
// falso positivo combinatorio de "casi cualquier frase se parece a algo" es
// mayor que el typo puntual que resolvería). Una palabra fuzzy cuenta igual
// que una palabra exacta en hits1, así que sigue sujeta a la misma regla
// anti-falso-positivo de siempre: una sola palabra L1 (exacta o fuzzy) no
// escala por sí sola, necesita una segunda o "tono" — ver esQueja más abajo.
function _lev(a, b) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
    let prev = Array.from({ length: lb + 1 }, (_, i) => i);
    for (let i = 1; i <= la; i++) {
        const cur = [i];
        for (let j = 1; j <= lb; j++) {
            cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
        }
        prev = cur;
    }
    return prev[lb];
}

// Palabras de 4 letras o menos no entran al fuzzy match (ya las cubre el
// match exacto; tolerar 1 error en una palabra tan corta dispara demasiados
// falsos positivos contra palabras no relacionadas).
function _distanciaTolerada(largo) {
    if (largo <= 4) return 0;
    if (largo <= 7) return 1;
    return 2;
}

const QUEJA_FUZZY_BASE = filtroPalabras.QUEJA_L1_BASE.filter(p => !p.includes(' '));

function _fuzzyHitsQueja(palabrasMsg) {
    const hits = [];
    for (const palabra of QUEJA_FUZZY_BASE) {
        const np = _normQ(palabra);
        const tolerancia = _distanciaTolerada(np.length);
        if (tolerancia === 0) continue;
        for (const w of palabrasMsg) {
            if (w === np || Math.abs(w.length - np.length) > tolerancia) continue;
            if (_lev(w, np) <= tolerancia) { hits.push(palabra); break; }
        }
    }
    return hits;
}

function quejaCheck(userId, text, sessionData) {
    if (!text || text.length < 3) return { isQueja: false };
    const n  = _normQ(text);
    const q  = _quejas.get(userId);

    // Si ya hay flujo activo → continuar
    if (q && q.paso < 2) {
        q.textos.push(text);
        if (q.paso === 0) {
            q.paso = 1;
            q.ts = Date.now();
            _quejas.set(userId, q);
            return { isQueja: true, resp: _RESP_ESC[_rei++ % _RESP_ESC.length], escalate: false };
        }
        // paso 1 → generar caso
        const caso   = _generarCaso();
        const minWait = 5;
        _quejas.delete(userId);
        return {
            isQueja: true,
            escalate: true,
            caso,
            motivo: q.motivo,
            resp: `Tu caso *${caso}* está registrado. Un asesor te contactará en aprox. *${minWait} minutos*. ⏰ Horario: 11:00 am – 8:00 pm`,
        };
    }

    // Detectar nueva queja
    const custom = _refrescarPersonalizadas();
    const hits1 = _QUEJA_L1.concat(custom.quejaL1).filter(p => n.includes(_normQ(p)));
    const hits2 = _QUEJA_L2.concat(custom.quejaL2).filter(p => n.includes(_normQ(p)));
    const palabrasMsg = n.split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(Boolean);
    const hits1Fuzzy = _fuzzyHitsQueja(palabrasMsg).filter(p => !hits1.includes(p));
    const hits1Total = hits1.length + hits1Fuzzy.length;
    const excl  = (text.match(/[!¡]/g)||[]).length >= 3;
    const may   = text.length > 0 ? (text.match(/[A-ZÁÉÍÓÚÑ]/g)||[]).length / text.length : 0;
    const tono  = excl || may > 0.40;
    const esQueja = hits1Total >= 2 || hits2.length >= 1 || (hits1Total >= 1 && tono);

    if (!esQueja) return { isQueja: false };

    let motivo = 'Solicitud general';
    if (n.includes('defectuoso')||n.includes('roto')||n.includes('falla')) motivo = 'Producto defectuoso';
    else if (n.includes('devolucion')||n.includes('reembolso')) motivo = 'Devolución/reembolso';
    else if (n.includes('cobro')) motivo = 'Problema de cobro';
    else if (n.includes('envio')||n.includes('entrega')||n.includes('llego')) motivo = 'Problema de entrega';

    _quejas.set(userId, { paso: 0, textos: [text], motivo, ts: Date.now() });
    return { isQueja: true, resp: _RESP_VAL[_rvi++ % _RESP_VAL.length], escalate: false };
}

// ══════════════════════════════════════════════════════════════════
//  BURST GUARD — pico repentino > 20 req/segundo → 10s de silencio
// ══════════════════════════════════════════════════════════════════
let _burstWindow = [];
let _burstUntil  = 0;

function burstCheck() {
    const now = Date.now();
    _burstWindow = _burstWindow.filter(t => t > now - 1000);
    _burstWindow.push(now);
    if (_burstWindow.length > 20 && _burstUntil < now) {
        _burstUntil = now + 10_000;
        log.warn('Pico detectado — modo ráfaga 10s');
    }
    return now < _burstUntil;
}

// ══════════════════════════════════════════════════════════════════
//  CLIENTE WHATSAPP
// ══════════════════════════════════════════════════════════════════
// ── Regla fija: jamás escribir primero ────────────────────────────────────
// El bot solo responde a quien ya nos escribió — integración 100% orgánica,
// nunca outbound en frío. No es un flag de `configuracion` (no se puede
// apagar desde el dashboard): cualquier número sin fila en `clientes` se
// bloquea aquí, sin excepción, sin importar quién encoló la notificación.
function registrarContactoEntrante(telefono, textoPrimerMensaje) {
    if (!telefono) return;
    try {
        const _db = require('./db_connection');
        const existe = _db.prepare('SELECT id FROM clientes WHERE telefono=?').get(telefono);
        if (!existe) {
            const info = _db.prepare("INSERT INTO clientes (nombre,telefono,canal_origen,activo) VALUES (NULL,?,'whatsapp',1)").run(telefono);
            // Programa de referidos: este es el momento exacto de "cliente nuevo,
            // primer contacto, sin compra" — si el primer mensaje trae el código
            // de un referente, aquí solo se VINCULA (clientes.referido_por_id).
            // El código propio y los puntos del referente se otorgan después,
            // en su primera compra finalizada (ver otorgarPuntosPorPrimeraCompra).
            try {
                require('./handlers/referidosService').procesarReferidoSiAplica(info.lastInsertRowid, telefono, textoPrimerMensaje);
            } catch (e) { log.warn('Error procesando referido', e); }
        }
    } catch (e) { log.warn('Error registrando contacto entrante', e); }
}

function yaNosEscribioAntes(_db, telefono) {
    if (!telefono) return false;
    try {
        return !!_db.prepare('SELECT 1 FROM clientes WHERE telefono=?').get(telefono);
    } catch (_) { return false; }
}

// ── Procesador de cola_notificaciones ─────────────────────────────────────
function procesarColaNotificaciones() {
    try {
        const _db = require('./db_connection');
        const pendientes = _db.prepare(
            "SELECT * FROM cola_notificaciones WHERE tipo='whatsapp' AND intentos < 3 AND (estatus='pendiente' OR (estatus='programado' AND enviar_despues_de <= datetime('now','localtime'))) ORDER BY id LIMIT 10"
        ).all();
        // Espaciar los envíos en vez de dispararlos todos en el mismo instante:
        // ráfagas de mensajes sin pausa a destinatarios distintos son exactamente
        // el patrón que los sistemas antispam de WhatsApp usan para banear números.
        // 1.5-3s de jitter por mensaje deja ~15-27s para 10 mensajes, dentro del
        // ciclo de 30s del setInterval que llama a esta función.
        let _delayAcumulado = 0;
        for (const notif of pendientes) {
            const dest = (notif.destinatario || '').trim();
            if (!dest) continue;
            // Si el destinatario ya tiene @ (ej: 521XXX@c.us o 208XXX@lid)
            // usarlo directamente. Si no, construir con @c.us
            const chatId = dest.includes('@') ? dest : `${dest.replace(/[^0-9]/g,'')}@c.us`;
            if (!chatId.includes('@')) continue;
            // REGLA FIJA: nunca contactar primero — si este número no tiene
            // fila en `clientes` es que nunca nos ha escrito, así que se
            // bloquea sin importar de qué automatización venga la notificación.
            const telDest = chatId.replace(/@.*$/, '').replace(/[^0-9]/g, '');
            if (!yaNosEscribioAntes(_db, telDest)) {
                log.warn('Bloqueado — destinatario nunca nos escribió', { userId: telDest });
                _db.prepare("UPDATE cola_notificaciones SET estatus='bloqueado_sin_contacto_previo' WHERE id=?").run(notif.id);
                continue;
            }
            const delay = _delayAcumulado;
            _delayAcumulado += 1500 + Math.random() * 1500;
            setTimeout(() => {
                // Intentar envío — si falla con @c.us, reintentar con @lid
                client.sendMessage(chatId, notif.cuerpo)
                    .then(() => {
                        _db.prepare("UPDATE cola_notificaciones SET estatus='enviado' WHERE id=?").run(notif.id);
                    })
                    .catch(err => {
                        const _isLidErr = err.message && (err.message.includes('LID') || err.message.includes('lid'));
                        if (_isLidErr && chatId.endsWith('@c.us')) {
                            // Reintentar con formato @lid
                            const _lidId = chatId.replace('@c.us', '@lid');
                            client.sendMessage(_lidId, notif.cuerpo)
                                .then(() => {
                                    // Actualizar el destinatario en DB para futuras notificaciones
                                    _db.prepare("UPDATE cola_notificaciones SET estatus='enviado', destinatario=? WHERE id=?").run(_lidId.replace('@lid',''), notif.id);
                                    // También actualizar el registro del cliente
                                    try { _db.prepare("UPDATE clientes SET telefono=? WHERE telefono=?").run(_lidId.replace('@lid',''), chatId.replace('@c.us','')); } catch(e){ log.debug('No se pudo corregir teléfono LID: ' + e.message); }
                                })
                                .catch(() => {
                                    _db.prepare("UPDATE cola_notificaciones SET intentos=intentos+1 WHERE id=?").run(notif.id);
                                });
                        } else {
                            log.warn('Error enviando: ' + err.message, { userId: chatId });
                            _db.prepare("UPDATE cola_notificaciones SET intentos=intentos+1 WHERE id=?").run(notif.id);
                        }
                    });
            }, delay);
        }
    } catch(e) { log.warn('Error procesando cola', e); }
}

// En Windows hay una ruta default razonable; en Linux/NixOS no existe una
// ruta fija (los binarios de Nix viven en /nix/store/<hash>-...), así que
// hay que buscarlo en PATH o exigir CHROME_PATH en vez de fallar en silencio
// con una ruta de Windows que nunca va a existir.
function _resolveChromePath() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    if (process.platform === 'win32') {
        return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }
    const { execSync } = require('child_process');
    for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
        try {
            const found = execSync(`command -v ${bin}`, { shell: '/bin/sh' }).toString().trim();
            if (found) return found;
        } catch (_) {}
    }
    throw new Error('No se encontró Chrome/Chromium en PATH. Define CHROME_PATH en .env (ej. la salida de `which chromium`).');
}

const _cierreNavegadoresPrevios = intentarCerrarProcesosBrowser();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: WHATSAPP_HEADLESS,
        executablePath: _resolveChromePath(),
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
               '--no-first-run','--no-zygote','--disable-extensions'],
    },
});

abrirDashboard();

// stockWatcher: proceso hijo separado — si crashea no afecta al bot.
// Reintenta con backoff exponencial (10s→20s→40s→80s→160s, tope 300s) en vez
// de un solo reintento sin reattach del listener 'exit' (el bug original: a
// la segunda caída moría en silencio y para siempre). Un "timer de
// estabilidad" de 30s resetea el contador a 1 si el worker alcanzó a correr
// sano ese tiempo antes de volver a caer, y tras 8 intentos consecutivos sin
// estabilizarse se rinde con un log explícito en vez de seguir reintentando
// (o de morir callado).
const STOCKWATCHER_BACKOFF_BASE_MS = 10_000;
const STOCKWATCHER_BACKOFF_MAX_MS  = 300_000;
const STOCKWATCHER_ESTABLE_MS      = 30_000;
const STOCKWATCHER_MAX_INTENTOS    = 8;

// Persiste el modo activo en `configuracion` para que el dashboard (proceso
// separado) pueda mostrarlo en /api/bot/status sin IPC — mismo mecanismo que
// ya usa _config.js para tono/módulos.
function _setStockWatcherModo(modo) {
    try {
        const _db = require('./db_connection');
        _db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('stockwatcher_modo', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actualizado_en=datetime('now','localtime')").run(modo);
    } catch (e) { log.debug('No se pudo guardar stockwatcher_modo: ' + e.message); }
}

// Mismo mecanismo que _setStockWatcherModo: el dashboard (proceso separado)
// no tiene acceso directo al cliente de WhatsApp, así que el QR pendiente de
// escanear se publica en `configuracion` para que /api/bot/qr lo exponga y
// la página Inicio lo renderice — antes el único lugar donde aparecía era la
// terminal del proceso pm2, invisible para quien solo usa el dashboard.
// Vacío ('') significa "no hay QR pendiente" (ya autenticado o aún no llegó).
function _setWhatsAppQR(qr) {
    try {
        const _db = require('./db_connection');
        _db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('whatsapp_qr', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actualizado_en=datetime('now','localtime')").run(qr || '');
    } catch (e) { log.debug('No se pudo guardar whatsapp_qr: ' + e.message); }
}

function arrancarStockWatcherWorker(intentos = 1) {
    const { fork } = require('child_process');
    let swWorker;
    try {
        swWorker = fork(path.join(__dirname, '..', 'services', 'stockWatcher.worker.js'), [], {
            silent: false,
            env: process.env,
            windowsHide: true,  // no abrir ventana en Windows
        });
        stockWatcherWorker = swWorker;
    } catch (e) {
        if (intentos === 1) {
            // Fallback: correr en el mismo proceso si el primer fork falla síncronamente.
            // Es un modo degradado permanente (nadie reintenta el fork después de esto),
            // así que es error, no warn — semanas en este modo pasan inadvertidas si no.
            log.error('stockWatcher: fork falló, corriendo en proceso principal (modo degradado)', e);
            _setStockWatcherModo('in-process');
            const sw = tryRequire('../services/stockWatcher');
            if (sw) { sw.runAll(); setInterval(() => sw.runAll(), 60 * 60_000).unref(); }
        } else {
            log.error('stockWatcher: fork falló al reintentar (intento ' + intentos + ')', e);
        }
        return;
    }

    const inicio = Date.now();
    _setStockWatcherModo('fork');
    swWorker.on('exit', (code, signal) => {
        log.warn('stockWatcher proceso hijo terminó', { code, signal, intentos });
        const corrioEstable = Date.now() - inicio >= STOCKWATCHER_ESTABLE_MS;
        const proximoIntento = corrioEstable ? 1 : intentos + 1;
        if (!corrioEstable && proximoIntento > STOCKWATCHER_MAX_INTENTOS) {
            log.error('stockWatcher: ' + STOCKWATCHER_MAX_INTENTOS + ' intentos consecutivos sin estabilizarse — dejo de reintentar. Revisar manualmente.');
            _setStockWatcherModo('caido');
            return;
        }
        const espera = Math.min(STOCKWATCHER_BACKOFF_BASE_MS * 2 ** (proximoIntento - 1), STOCKWATCHER_BACKOFF_MAX_MS);
        log.warn('stockWatcher: relanzando proceso hijo en ' + Math.round(espera / 1000) + 's (intento ' + proximoIntento + ')');
        setTimeout(() => arrancarStockWatcherWorker(proximoIntento), espera);
    });
    swWorker.on('error', e => log.error('stockWatcher: error en proceso hijo', e));
    log.info('stockWatcher activo en proceso separado', { pid: swWorker.pid, intentos });
}

client.on('qr', qr => {
    // WhatsApp expira el QR cada ~20-30s y whatsapp-web.js emite uno nuevo
    // automáticamente mientras nadie escanea — antes este handler ignoraba
    // todo evento después del primero (`if (qrMostrado) return`), así que
    // ese QR único quedaba inválido en menos de un minuto sin forma de
    // refrescarlo salvo reiniciar el proceso entero. Ahora cada refresh se
    // publica en `configuracion` (ver _setWhatsAppQR) para que el dashboard
    // siempre muestre uno vigente; el dibujo ASCII en terminal y el log
    // solo se hacen la primera vez para no inundar el log cada 20s.
    _setWhatsAppQR(qr);
    if (!qrMostrado) {
        qrMostrado = true;
        qrcode.generate(qr, { small: true });
        log.info('QR de WhatsApp listo — escanéalo desde el dashboard (Inicio) o la terminal.');
    } else {
        log.debug('QR de WhatsApp actualizado (el anterior expiró)');
    }
});
client.on('authenticated', () => {
    log.info('WhatsApp autenticado correctamente');
    qrMostrado = false;
    _setWhatsAppQR('');
});
client.on('auth_failure', msg => {
    log.error('Falló la autenticación de WhatsApp', msg);
});
client.on('disconnected', reason => {
    // No se puede avisar por WhatsApp si WhatsApp es justo lo que se cayó —
    // se encola un correo (cola_emails la drena el propio proceso del bot,
    // y también el dashboard si éste sigue vivo, vía emailService.js).
    log.error('🔴 WhatsApp desconectado', { reason });
    try {
        const _db = require('./db_connection');
        const _dest = process.env.EMAIL_PERSONAL || process.env.EMAIL_CEDIS || process.env.EMAIL_USER;
        if (_dest) {
            _db.prepare("INSERT INTO cola_emails (destinatarios, asunto, html_body, estatus, tipo) VALUES (?, 'Bot de WhatsApp desconectado', ?, 'pendiente', 'alerta')")
                .run(JSON.stringify([_dest]), '<p>El bot de WhatsApp se desconectó.</p><p>Motivo: ' + String(reason) + '</p><p>' + new Date().toLocaleString('es-MX') + '</p>');
        }
    } catch (e) { log.warn('No se pudo encolar alerta de desconexión', e); }
    // whatsapp-web.js no se reconecta solo tras 'disconnected' (hay que
    // volver a llamar initialize()). Antes esto salía del proceso y dejaba
    // que pm2 lo relanzara — pero combinado con el taskkill/ventana de
    // Electron de abrirDashboard(), cada desconexión real terminaba
    // matando también el navegador/ventana del usuario, no solo el del bot
    // (ver intentarCerrarProcesosBrowser). Por defecto el bot ahora se
    // queda detenido sin reiniciarse solo — el correo de arriba avisa, y
    // hay que reiniciarlo manualmente desde el dashboard. Si se activa
    // 'reconexion_auto_activo' (rol prime, /api/prime/config), en vez de
    // quedarse detenido reintenta en el mismo proceso vía
    // reconexionAutomatica.js — útil cuando no hay nadie pendiente del bot,
    // a costa del riesgo de browser/page zombie que describía el comentario
    // original.
    if (botConfig.moduloActivo('reconexion_auto_activo')) {
        require('./reconexionAutomatica').intentarReconectar(client, log);
    } else {
        log.warn('Reconexión automática desactivada — el bot queda detenido hasta un reinicio manual desde el dashboard');
    }
});
client.on('ready', () => {
    log.info('Bot conectado y listo');
    qrMostrado = false;
    _setWhatsAppQR('');
    // Procesar cola de notificaciones cada 30 segundos
    setInterval(procesarColaNotificaciones, 30_000).unref();
    arrancarStockWatcherWorker();

    // ── Backup automático ───────────────────────────────────────────
    try {
        require('../scripts/backup').agendarBackup();
    } catch(_) { log.warn('backup: no se pudo iniciar automático'); }
});

// ══════════════════════════════════════════════════════════════════
//  HANDLER DE MENSAJES — pipeline completo
// ══════════════════════════════════════════════════════════════════
const _enProceso = new Set(); // mutex por userId

// Timeout wrapper para sendMessage — evita bloqueos si WhatsApp cuelga
async function sendSafe(to, msg, opts) {
    return Promise.race([
        opts ? client.sendMessage(to, msg, opts) : client.sendMessage(to, msg),
        new Promise((_, rej) => setTimeout(() => rej(new Error('sendMessage timeout 15s')), 15_000)),
    ]).catch(e => { log.warn('sendMessage falló: ' + e.message, { userId: to }); });
}

client.on('message', async msg => {
    // ── Validar mensaje entrante ────────────────────────────────
    const _valid = validarMensajeWhatsApp(msg);
    if (!_valid.ok) return;

    const userId  = msg.from;
    const bodyRaw = (msg.body || '').slice(0, 1000).trim(); // máx 1000 chars — protección DoS

    // Registrar que este número nos escribió primero — única fuente de verdad
    // para la regla fija de "solo integración orgánica" en procesarColaNotificaciones()
    // (también el único punto donde se detecta un código de referido: ver
    // bot/handlers/referidosService.js, solo aplica si el cliente es nuevo).
    registrarContactoEntrante(userId.replace(/@.*$/, ''), bodyRaw);

    // Mutex: ignorar mensaje si ya estamos procesando uno del mismo usuario
    if (_enProceso.has(userId)) {
        log.debug('Mensaje ignorado — procesando anterior', { userId });
        return;
    }
    _enProceso.add(userId);

    const isImage = msg.hasMedia && (msg.type === 'image' || msg.type === 'sticker');

    log.info('📩 mensaje recibido: ' + (bodyRaw ? bodyRaw.slice(0,80) : '[' + msg.type + ']'), { userId });

    if (bodyRaw) {
        try {
            require('../services/mensajeService').registrarMensaje(require('./db_connection'), userId.replace(/@.*$/, ''), 'cliente', bodyRaw, sessionManager.getSession(userId).paso_actual);
        } catch(_) {}
    }

    try {
        // ── 1. BURST GUARD ────────────────────────────────────────────────
        if (burstCheck()) {
            return await client.sendMessage(userId,
                '⏳ Muchos mensajes a la vez. Dame *10 segundos* y vuelve a escribir.');
        }

        // ── 1.5. TIMEOUT POST-BLOQUEO ─────────────────────────────────────
        // Si el usuario está en timeout por groserías, ignorar en silencio
        const _timeoutUntil = _blockTimeout.get(userId) || 0;
        if (Date.now() < _timeoutUntil) {
            // Silencio total — no responder nada para no premiar la interacción
            return;
        }

        // ── 2. RATE LIMITER ───────────────────────────────────────────────
        const rl = rlCheck(userId, isImage);
        if (!rl.ok) return await client.sendMessage(userId, rl.msg);

        // ── 3. FILTRO DE CONTENIDO (solo texto) ───────────────────────────
        if (bodyRaw && !isImage) {
            const cf = cfCheck(userId, bodyRaw);
            if (cf.blocked) {
                log.info('Bloqueado por filtro de contenido', { userId });
                // Auto-tag blacklist
                try { const _dbBl = require('./db_connection'); _dbBl.prepare("UPDATE clientes SET tags=CASE WHEN tags IS NULL OR tags='' THEN 'blacklist' WHEN tags NOT LIKE '%blacklist%' THEN tags||',blacklist' ELSE tags END WHERE telefono=?").run(userId.replace(/@.*$/,'')); } catch(e){ log.debug('No se pudo etiquetar blacklist: ' + e.message); }
                if (cf.escalate) {
                    // Escalar silenciosamente al asesor
                    sessionManager.updateSession(userId, 'ASESOR',
                        { modo: 'contenido_inapropiado', _notificado: false });
                }
                return await client.sendMessage(userId, cf.msg);
            }
        }

        // ── 3b. CLIENTE FRUSTRADO (no bloqueado, pero tono agresivo) ─────────
        // Aplica desde CUALQUIER estado — no solo MENU/ASESOR
        if (bodyRaw && !isImage && !cfCheck(userId, bodyRaw).blocked && esFrustracion(bodyRaw)) {
            const _sesF = sessionManager.getSession(userId);
            if (!_quejas.get(userId) && _sesF.paso_actual !== 'ASESOR') {
                log.info('Frustración detectada en estado ' + _sesF.paso_actual, { userId });
                sessionManager.updateSession(userId, 'ASESOR',
                    { modo: 'cliente_frustrado', _notificado: false });
                    // Auto-tag queja
                    try { const _dbTag = require('./db_connection'); _dbTag.prepare("UPDATE clientes SET tags=CASE WHEN tags IS NULL OR tags='' THEN 'queja' WHEN tags NOT LIKE '%queja%' THEN tags||',queja' ELSE tags END WHERE telefono=?").run(userId.replace(/@.*$/,'')); } catch(e){ log.debug('No se pudo etiquetar queja: ' + e.message); }
                    // Evento "frustracion" para analítica/ML
                    try { const _dbF = require('./db_connection'); _dbF.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('frustracion','whatsapp',?,?)").run(bodyRaw.slice(0,200), userId.replace(/@.*$/,'')); } catch(e){ log.debug('No se pudo registrar evento frustracion: ' + e.message); }
                return await client.sendMessage(userId,
                    'Entiendo que est\u00e1s frustrado/a. Lamento la espera. \uD83D\uDE4F\n\n' +
                    'Voy a conectarte con alguien del equipo ahora mismo.\n' +
                    '\u23F0 Horario de atenci\u00f3n: *11:00 am \u2013 8:00 pm*');
            }
        }

        // ── 4. PREPROCESSOR DE IMAGEN ─────────────────────────────────────
        let msgFinal = msg;

        if (isImage) {
            // Verificar si Vision API está habilitada en configuración
            let _visionActivo = true;
            try {
                const _db = require('./db_connection');
                const _cfg = _db.prepare("SELECT valor FROM configuracion WHERE clave='vision_activo' LIMIT 1").get();
                _visionActivo = !_cfg || _cfg.valor !== '0';
            } catch(e) { log.debug('No se pudo leer vision_activo: ' + e.message); }

            if (imageAnalyzer && imageAnalyzer.isConfigured() && _visionActivo) {
                // Intentar análisis con Vision API
                try {
                    const media = await msg.downloadMedia();
                    if (media) {
                        // ── Guardar imagen localmente para el dashboard ────────
                        try {
                            if (permitirGuardarImagen(userId)) {
                                const _fs   = require('fs');
                                const _path = require('path');
                                const _imgDir = _path.join(__dirname, 'imagenes_clientes');
                                if (!_fs.existsSync(_imgDir)) _fs.mkdirSync(_imgDir, { recursive: true });
                                // Mimetype viene del remitente de WhatsApp — nunca derivar la
                                // extensión directamente de ese string (riesgo de path traversal).
                                const _MIME_EXT = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif' };
                                const _ext  = _MIME_EXT[(media.mimetype || '').split(';')[0]] || 'jpg';
                                const _tel  = userId.replace(/@.*$/, '');
                                const _ts   = Date.now();
                                const _fname = `${_tel}_${_ts}.${_ext}`;
                                _fs.writeFileSync(_path.join(_imgDir, _fname),
                                    Buffer.from(media.data, 'base64'));
                            } else {
                                log.warn('Cuota diaria de imágenes alcanzada, no se guarda en disco', { userId });
                            }
                        } catch (_) {}

                        const result = await imageAnalyzer.analyzeImage(media);
                        if (result.ok && result.query) {
                            log.info(`Vision → "${result.query}" (cache:${result.fromCache})`, { userId });
                            // Evento "imagen" para analítica/ML
                            try { const _dbV = require('./db_connection'); _dbV.prepare("INSERT INTO log_eventos (tipo_evento, canal, valor, telefono) VALUES ('imagen','whatsapp',?,?)").run(result.query.slice(0,200), userId.replace(/@.*$/,'')); } catch(e){ log.debug('No se pudo registrar evento imagen: ' + e.message); }
                            msgFinal = { ...msg, body: result.query, _fromImage: true, _visionQuery: result.query };
                        } else {
                            return await client.sendMessage(userId,
                                imageAnalyzer.fallbackMessage(result.reason));
                        }
                    }
                } catch (e) {
                    log.warn('Error Vision: ' + e.message, { userId });
                    return await client.sendMessage(userId,
                        '📸 No pude analizar la imagen. ¿Puedes describir el producto con texto?');
                }
            } else {
                // Sin Vision API configurada
                return await client.sendMessage(userId,
                    '📸 Envíame el *nombre* del juguete por texto o el *link* de donde lo viste. ' +
                    'El análisis de imágenes estará listo pronto. 🔧');
            }
        }

        // ── 5. DETECCIÓN DE QUEJAS ────────────────────────────────────────
        const textFinal = (msgFinal.body || '').trim();
        if (textFinal) {
            // Si el mensaje contiene contenido bloqueado, no avanzar flujo de queja
            const _cfForQueja = cfCheck(userId, textFinal);
            const session  = sessionManager.getSession(userId);
            const qr       = !_cfForQueja.blocked ? quejaCheck(userId, textFinal, session.data || {}) : { isQueja: false };
            if (qr.isQueja) {
                await client.sendMessage(userId, qr.resp);
                if (qr.escalate) {
                    // Registrar en sistema y poner en modo ASESOR
                    try {
                        const { registrarEscalada } = actionHandler;
                        if (typeof registrarEscalada === 'function') {
                            registrarEscalada(userId, null,
                                `Queja — ${qr.motivo} | ${qr.caso}`,
                                userId.replace('@c.us',''), 'queja', qr.caso);
                        }
                    } catch (_) {}
                    sessionManager.updateSession(userId, 'ASESOR', {
                        modo: 'queja', caso: qr.caso, _notificado: true
                    });
                }
                return;
            }
        }

        // ── 5b. DETECTOR DE INTENCIÓN + BLACKLIST ─────────────────────────
        const _sesIntento = sessionManager.getSession(userId);
        const _stepActual = _sesIntento.paso_actual;
        const _textIntento = (msgFinal.body || '').trim();

        // Solo actuar en MENU o primera interacción (MENU es el estado inicial)
        if (_textIntento && !isImage && (_stepActual === 'MENU')) {

            const _intento = intentDetector.detectarIntento(_textIntento);

            if (_intento.esTroll) {
                log.info('Troll detectado: ' + _textIntento, { userId });
                // No bloquear, solo ignorar y dar respuesta neutra
                return await client.sendMessage(userId,
                    (botConfig.t('texto_libre') || 'Hola, soy el asistente de *Julio Cepeda Jugueterías*. ¿En qué juguete puedo ayudarte hoy? 🧸'));
            }

            if (_intento.intencion === 'busqueda_sin_producto') {
                // Solo stopwords — no hay producto identificable, ir al menú
                sessionManager.clearSession(userId);
                return await client.sendMessage(userId,
                    '🧸 ¿Qué juguete estás buscando? Escribe el nombre o descripción.');
            }

            if (_intento.intencion === 'busqueda_producto') {
                log.info('Intención detectada: ' + _intento.fraseDetectada + ' → producto: ' + _intento.palabrasProducto, { userId });

                // Inyectar como búsqueda directa — pasar _fromIntent para evitar loop
                sessionManager.updateSession(userId, 'SEARCHING', { carrito: _sesIntento.data?.carrito || [] });
                const _msgBusqueda = { ...msgFinal, body: _intento.query, _fromIntent: true };
                const _respBusq = await actionHandler.handleAction(userId,
                    { paso_actual: 'SEARCHING', data: { carrito: _sesIntento.data?.carrito || [] } },
                    _msgBusqueda, client);

                // Si el resultado activa flujo stock inteligente (contiene "Déjame verificar")
                // dividir en dos mensajes con 10 segundos de diferencia
                if (_respBusq && (_respBusq.includes('jame verificar') || _respBusq.includes('jame buscarlo'))) {
                    // Mensaje 1: "Déjame verificar..."
                    const _lineas = _respBusq.split('\n');
                    const _msg1 = _lineas[0]; // Solo la primera línea: "🔍 Déjame verificar..."
                    const _chat2 = await msg.getChat();
                    await sendWithTyping(_chat2, _msg1, 2000);
                    // Esperar 10 segundos simulando búsqueda en red
                    await _chat2.sendStateTyping();
                    await new Promise(r => setTimeout(r, 9_000));
                    await _chat2.clearState();
                    // Mensaje 2: el resto — reemplazar el texto de "No tenemos" por el nuevo
                    const _resto = _lineas.slice(1).join('\n').trim();
                    const _msg2 = _resto
                        .replace(
                            'No tenemos ese producto exacto en este momento, pero podemos ayudarte:',
                            '\u00a1Este juguete est\u00e1 volando! pero estamos por recibir m\u00e1s. \u00bfTe gustar\u00eda recibir un aviso exclusivo por WhatsApp en cuanto nos llegue?'
                        )
                        .replace('Av\u00edsame cuando llegue _(gratis, cancela cuando quieras)_', 'Av\u00edsame cuando llegue')
                        .replace('Avísame cuando llegue _(gratis, cancela cuando quieras)_', 'Avísame cuando llegue');
                    await client.sendMessage(userId, _msg2);
                } else if (_respBusq) {
                    await client.sendMessage(userId, _respBusq);
                }
                return;
            }
        }

        // ── 6. HANDLER PRINCIPAL ──────────────────────────────────────────
        const session   = sessionManager.getSession(userId);
        const respuesta = await actionHandler.handleAction(userId, session, msgFinal, client);
        if (respuesta) {
            const _chat = await msg.getChat();
            await sendWithTyping(_chat, respuesta);
        }

    } catch (err) {
        log.error('❌ Error procesando mensaje', err);
        try {
            await client.sendMessage(userId,
                (botConfig.t('error_generico') || '⚠️ Ocurrió un error. Escribe *hola* para reiniciar la conversación.'));
        } catch(_) {}
    } finally {
        _enProceso.delete(userId); // liberar mutex siempre
    }
});

// ── Helper: simular escritura antes de enviar ───────────────────────────────
async function sendWithTyping(chat, texto, delayMs = 4000) {
    try {
        await chat.sendStateTyping();                      // activa "escribiendo..."
        await new Promise(r => setTimeout(r, delayMs));   // espera natural
        await chat.clearState();                           // limpia el estado
    } catch (_) {}                                         // si falla, continúa igual
    await chat.sendMessage(texto);
    try {
        const _jid = (chat.id && chat.id._serialized) || '';
        const _tel = _jid.replace(/@.*$/, '');
        require('../services/mensajeService').registrarMensaje(require('./db_connection'), _tel, 'bot', texto, sessionManager.getSession(_jid).paso_actual);
    } catch(_) {}
}

// ── Cierre limpio al matar el proceso ─────────────────────────────────────
async function shutdown(signal) {
    log.info(`🛑 ${signal} recibido — cerrando WhatsApp limpiamente...`);
    try {
        await client.destroy();
        log.info('✅ WhatsApp cerrado correctamente.');
    } catch (e) {
        const msg = String(e && (e.message || e));
        log.warn('⚠️ Error al cerrar WhatsApp, intentando cierre forzado', e);
        if (/EBUSY|locked|already running|userDataDir|unlink/i.test(msg)) {
            await intentarCerrarProcesosBrowser();
            try {
                await client.destroy();
                log.info('✅ WhatsApp cerrado correctamente tras cierre forzado.');
            } catch (e2) {
                log.warn('⚠️ El cierre forzado también falló', e2);
            }
        }
    }
    if (stockWatcherWorker && !stockWatcherWorker.killed) {
        try {
            stockWatcherWorker.kill('SIGTERM');
        } catch (_) {}
    }
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('exit', () => {
    if (stockWatcherWorker && !stockWatcherWorker.killed) {
        try { stockWatcherWorker.kill('SIGTERM'); } catch (_) {}
    }
});

// Antes limpiarSesionLocalAuth() se llamaba incondicionalmente ANTES de
// construir el cliente, en cada arranque — eso borraba la sesión de
// WhatsApp ya autenticada en cada `pm2 restart`/crash-restart, forzando un
// QR nuevo cada vez (la causa real de quedar "desconectado" tras cualquier
// reinicio). Ahora la sesión guardada se intenta usar normalmente; solo si
// initialize() falla de verdad (perfil de Chrome bloqueado/corrupto) se
// limpia y se reintenta una vez — el caso que el comentario original
// describía ("evitar bloqueos de navegador") sin pagar el costo siempre.
//
// Se espera _cierreNavegadoresPrevios (ver intentarCerrarProcesosBrowser)
// antes de lanzar Chrome — sin esto, initialize() se disparaba casi al mismo
// tiempo que el taskkill de arriba, todavía liberando los handles del Chrome
// anterior, y "Failed to launch the browser process" salía en el primer
// intento de cada arranque/reinicio, no solo como caso raro.
_cierreNavegadoresPrevios.then(() => {
    client.initialize().catch(e => {
        log.error('Falló la inicialización de WhatsApp — limpiando sesión local y reintentando una vez', e);
        limpiarSesionLocalAuth();
        client.initialize().catch(e2 => log.error('🔴 El reintento de inicialización de WhatsApp también falló', e2));
    });
});
