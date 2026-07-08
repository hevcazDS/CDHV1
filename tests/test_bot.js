// test_bot.js
// Suite de pruebas del bot — ejecutar con: node test_bot.js
// No necesita WhatsApp conectado. Prueba la lógica directamente.
// Uso: node test_bot.js [--verbose] [--suite filtro]
//   --verbose   : muestra respuesta completa del bot
//   --suite X   : solo corre el grupo X (ej: --suite queja)

'use strict';

// ── Setup mínimo para que los módulos carguen ────────────────────────────
process.env.NODE_ENV = 'test';
// validarEnv() corre apenas se carga bot/index.js y hace process.exit(1) si
// faltan estas dos — sin un .env real en este checkout, hay que rellenarlas
// con valores dummy antes de compilar el código real (no se usan de verdad,
// db_connection queda interceptado por el mock de abajo).
if (!process.env.DB_PATH) process.env.DB_PATH = '/tmp/test_bot_dbpath_placeholder.db';
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

// Mock de db_connection para no necesitar la DB real en tests
// (solo aplica a las pruebas de lógica de index.js)
const Module = require('module');
const _origLoad = Module._load.bind(Module);
Module._load = function(req, parent, isMain) {
    if (req === './db_connection' || req === 'db_connection') {
        return _mockDB();
    }
    return _origLoad(req, parent, isMain);
};

function _mockDB() {
    const sessions = new Map();
    const db = {
        exec: () => {},
        pragma: () => {},
        prepare: (sql) => ({
            get: (...args) => {
                if (sql.includes('sesiones_bot')) {
                    return sessions.get(args[0]) || null;
                }
                return null;
            },
            run: (...args) => {
                // clearSession() pasa (id_usuario, version) -- el SQL trae
                // 'MENU'/'{}' inline y solo bindea esos dos. updateSession()
                // pasa los 4 (id_usuario, paso_actual, data_json, version).
                // Ver bot/sessionManager.js -- migrations/
                // 0010_sesiones_bot_version.sql agregó la columna version.
                if (sql.includes("VALUES (?, 'MENU', '{}'")) {
                    sessions.set(args[0], { id_usuario: args[0], paso_actual: 'MENU', data_json: '{}', version: args[1] });
                } else if (sql.includes('INSERT OR REPLACE INTO sesiones_bot')) {
                    sessions.set(args[0], { id_usuario: args[0], paso_actual: args[1], data_json: args[2], version: args[3] });
                }
                return { lastInsertRowid: 1 };
            },
            all: () => [],
        }),
        _sessions: sessions,
    };
    return db;
}

// ── Cargar módulos reales ─────────────────────────────────────────────────
// OJO: antes esto usaba `new Function('require', ...)` para evaluar el
// código de index.js. El `require` que recibe esa función resuelve rutas
// relativas (`./sessionManager`, `./validators`, etc.) contra el directorio
// de ESTE archivo (tests/), no contra bot/ — así que siempre tronaba con
// "Cannot find module './sessionManager'", el catch de abajo lo silenciaba,
// y la suite corría contra la réplica interna (líneas ~140 en adelante) sin
// que nadie lo notara. Es decir: el "100% passing" nunca probó el código
// real. Por eso ahora se usa un módulo real de Node (`new Module(...)`)
// con `mod.paths` apuntando al directorio de bot/, que sí resuelve los
// requires relativos correctamente — el único require interceptado a mano
// es './db_connection' (vía el parche global de Module._load de arriba).
let indexModule;
try {
    const fs   = require('fs');
    const path = require('path');
    const filename = path.join(__dirname, '..', 'bot', 'index.js');
    const src  = fs.readFileSync(filename, 'utf8');

    // Evaluamos hasta antes de "const client = new Client" para no iniciar
    // un cliente real de whatsapp-web.js/Puppeteer.
    const cutoff = src.indexOf('const client = new Client');
    if (cutoff === -1) throw new Error('marcador "const client = new Client" no encontrado — ¿cambió bot/index.js?');
    const logicSrc = src.slice(0, cutoff) +
        '\nmodule.exports = { rlCheck, cfCheck, quejaCheck, burstCheck, esFrustracion, _BW_WORD, _BW_LONG, _QUEJA_L1, _QUEJA_L2, _RISK_WORDS };\n';

    const mod = new Module(filename, null);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod._compile(logicSrc, filename);
    indexModule = mod.exports;
} catch(e) {
    console.error(`⚠️  No se pudo cargar la lógica real de bot/index.js (${e.message}).`);
    console.error('   Esta corrida usa la réplica interna de respaldo — no es una prueba del código real, revisa el error de arriba.');
    indexModule = null;
}

// ── Test runner ───────────────────────────────────────────────────────────
const VERDE  = '\x1b[32m';
const ROJO   = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

let passed = 0, failed = 0, skipped = 0;
const results = [];

const args    = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const SUITE   = args.find(a => a.startsWith('--suite='))?.slice(8) || null;

function test(suite, name, fn) {
    if (SUITE && !suite.toLowerCase().includes(SUITE.toLowerCase())) {
        skipped++;
        return;
    }
    try {
        fn();
        passed++;
        results.push({ ok: true, suite, name });
        if (VERBOSE) console.log(`  ${VERDE}✓${RESET} [${suite}] ${name}`);
    } catch(e) {
        failed++;
        results.push({ ok: false, suite, name, error: e.message });
        console.log(`  ${ROJO}✗${RESET} [${suite}] ${name}`);
        console.log(`    → ${ROJO}${e.message}${RESET}`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}
function assertContains(str, sub, msg) {
    assert(str && str.includes(sub), msg || `Expected "${sub}" in "${String(str).slice(0,80)}"`);
}
function assertNotContains(str, sub, msg) {
    assert(!str || !str.includes(sub), msg || `Did NOT expect "${sub}" in "${String(str).slice(0,80)}"`);
}

// ── Implementación interna para pruebas si index.js no cargó ─────────────
// (replica la lógica para que los tests pasen independientemente)
const _BW_LONG = new Set([  // substring match
    'vagina','clitoris','masturbacion','masturbarse','orgasmo','eyaculacion',
    'corrida','mamada','cogida','chingar','prostituta','prepago','encuerado',
    'pornografia','porno','hentai','onlyfans','chaturbate',
    'penis','pussy','cunt','boobs','tits','nude','naked','porn','blowjob','dildo','vibrator',
    'cocaina','heroina','metanfetamina',
]);
const _BW_WORD = new Set([  // word boundary match (exact word)
    'pene','pito','verga','polla','culo','ano','senos','nalgas','tetas','chichis','panocha',
    'follar','coger','puta','putona','escort','desnudo','desnuda','xxx','crack',
    'fuck','cock','sex','sexo',
]);
const _RW = { 'sexo':5,'sex':5,'follar':5,'coger':5,'mame':5,'chingar':4,
    'erotico':2,'erotica':2,'sensual':1,'sexy':1,'lenceria':1,'adulto':1 };
const _Q1 = ['queja','reclamo','exijo','inaceptable','terrible','pesimo','pésimo',
    'estafa','fraude','mentira','profeco','abogado','devolución','devolucion',
    'reembolso','devolver','defectuoso','roto','dañado','falla','no funciona',
    'no sirve','cobro','cobro indebido','cobro de mas','no llegó','no llego','harto','basta','nunca'];
const _Q2 = ['quiero hablar con','pasame con','pásame con','hablar con alguien',
    'quiero una persona','quiero un humano','persona real','gerente','supervisor',
    'encargado','no me resuelves','basta del robot','no sirves','no ayudas',
    'ponme con alguien','necesito hablar con alguien'];
const _SOLO = new Set(['profeco','queja','reclamo','estafa','fraude','reembolso',
    'devolución','devolucion','demanda','abogado']);

function _norm(s) {
    let out = s.toLowerCase()
        .replace(/[áéíóúüñ]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u',ü:'u',ñ:'n'}[c]||c));
    // Leetspeak — espejo del _normalize real de bot/index.js (la réplica
    // había quedado atrás y fallaba "pend3jo" cuando el módulo real no carga)
    out = out.replace(/[a-z0-9$@]+/g, tok => /[a-z]/.test(tok)
        ? tok.replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e')
              .replace(/4/g,'a').replace(/5/g,'s').replace(/7/g,'t')
              .replace(/\$/g,'s').replace(/@/g,'a')
        : tok);
    return out;
}

function _cfCheck(text) {
    if (!text) return false;
    const n = _norm(text);
    const words = n.split(/[\s,.:;!?¿¡']+/);
    for (const w of _BW_WORD) if (words.includes(w)) return true;
    for (const w of _BW_LONG) if (n.includes(w)) return true;
    let s = 0;
    for (const [w, p] of Object.entries(_RW)) { if (n.includes(w)) { s += p; if (s >= 3) return true; } }
    if (/p[3e][n][3e]/i.test(text) || /s[3e][x][0o]/i.test(text)) return true;
    if (/\b([a-záéíóú][\s._]{1,2}){3,}[a-záéíóú]\b/i.test(text)) return true;
    return false;
}

function _quejaCheck(text) {
    const n = _norm(text);
    const h1 = _Q1.filter(p => n.includes(_norm(p)));
    const h2 = _Q2.filter(p => n.includes(_norm(p)));
    const excl = (text.match(/[!¡]/g)||[]).length >= 3;
    const may  = text.length > 0 ? (text.match(/[A-ZÁÉÍÓÚÑ]/g)||[]).length / text.length : 0;
    const tono = excl || may > 0.40;
    const solo = h1.some(w => _SOLO.has(_norm(w)));
    return solo || h1.length >= 2 || h2.length >= 1 || (h1.length >= 1 && tono);
}

// Usar módulo real si cargó, sino usar implementación interna.
// cfCheck/quejaCheck son stateful POR USUARIO (bloqueos repetidos escalan,
// una queja activa hace que el SIGUIENTE mensaje del mismo usuario continúe
// el flujo sin importar su contenido) — por eso cada caso de prueba necesita
// su propio userId; reusar uno solo contaminaba los resultados según el
// orden en que corrieran los casos.
let _testUidCounter = 0;
const cf  = (t) => indexModule ? indexModule.cfCheck?.('cf_test_' + (_testUidCounter++), t)?.blocked : _cfCheck(t);
const qch = (t) => indexModule ? indexModule.quejaCheck?.('queja_test_' + (_testUidCounter++), t, {})?.isQueja : _quejaCheck(t);

// ═══════════════════════════════════════════════════════════════════════
//  SUITE 1: FILTRO DE CONTENIDO
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}── Filtro de Contenido ──${RESET}`);

const shouldBlock = [
    'pene', 'vagina', 'sexo', 'sex', 'fuck',
    'porno', 'verga', 'polla', 'culo', 'clitoris',
    'prostituta', 'escort', 'desnuda', 'xxx', 'hentai',
    'cocaina', 'heroina', 'dildo', 'blowjob', 'cock',
    'p e n e', 'v.a.g.i.n.a',
    'necesito droga heroina', 'quiero ver pornografia gratis',
    'p3n3', 's3x0', 'quiero ver porn',
];
// Gaps que existían en cfCheck real (bot/index.js) ya fueron cerrados:
// _normalize() ahora sustituye leetspeak de dígitos comunes (0->o, 1->i,
// 3->e, 4->a, 5->s, 7->t, $->s, @->a) dentro de tokens con al menos una
// letra, y "porn" (forma corta en inglés) se agregó a BW_WORD_BASE.

const shouldPass = [
    'hola', 'patines', 'muñeca barbie', 'juguete para niña',
    'quiero un carro hot wheels', 'busco algo educativo',
    'peluche de gato', 'lego star wars',
    'quiero hablar con un asesor', 'precio de bicicleta',
    'no llegó mi pedido', // queja pero no contenido bloqueado
    'un regalo para mi hijo', 'juego de mesa',
    'donde está la tienda', 'tienen patines en stock',
    'el precio es $1500', 'mi telefono es 5512345678',
    'codigo TK-12345678', '3 piezas de lego',
];

for (const text of shouldBlock) {
    test('contenido', `BLOQUEAR: "${text}"`, () => {
        assert(cf(text) === true, `"${text}" debería ser bloqueado`);
    });
}
for (const text of shouldPass) {
    test('contenido', `PERMITIR: "${text}"`, () => {
        assert(cf(text) === false || cf(text) === undefined,
            `"${text}" no debería ser bloqueado`);
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  SUITE 2: DETECTOR DE QUEJAS
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}── Detector de Quejas ──${RESET}`);

// quejaCheck real exige: 2+ frases L1 distintas, O 1+ frase L2, O 1 frase L1
// + "tono" (≥3 signos de exclamación o >40% mayúsculas) en un solo mensaje.
// Una sola palabra L1 suelta (ej. "profeco", "estafa") NO escala por sí sola
// — evita que un mensaje ambiguo dispare una escalada a asesor humano.
const shouldBeQueja = [
    'ESTAFA!!!',                      // 1 frase L1 + tono (mayúsculas+exclamación)
    'profeco abogado',                // 2 frases L1 distintas
    'quiero hablar con alguien',
    'pasame con un supervisor',
    'quiero hablar con un humano',
    'basta del robot quiero una persona',
    'el producto está defectuoso y exijo solución',
    'NO LLEGÓ MI PEDIDO!!!',         // MAYÚSCULAS + exclamaciones
    'esto es una estafa pésimo servicio',
    'quiero devolver el producto no funciona',
    'mi pedido llegó roto quiero reembolso',
    'hablar con el gerente',
    'necesito hablar con alguien urgente',
    'el servicio es terrible y pésimo',
];

const shouldNotBeQueja = [
    'hola',
    'patines',
    '1',
    'busco un juguete',
    'precio de bicicleta',
    'tienes hot wheels',
    'para niño de 5 años',
    'en que tienda están',
];

for (const text of shouldBeQueja) {
    test('queja', `DETECTAR: "${text}"`, () => {
        assert(qch(text) === true, `"${text}" debería detectarse como queja`);
    });
}
for (const text of shouldNotBeQueja) {
    test('queja', `IGNORAR: "${text}"`, () => {
        assert(qch(text) === false || qch(text) === undefined,
            `"${text}" no debería ser queja`);
    });
}

// ── Casos límite: typos y errores ortográficos reales ──────────────────
// _normalize() solo corrige acentos y leetspeak (0->o, 3->e, etc). Fase
// JIUA 5 agregó un fuzzy match (Levenshtein) angosto a propósito: SOLO
// contra palabras sueltas de _QUEJA_L1 (nunca frases de 2+ palabras como
// "no llegó" o frases en jerga sin palabra L1 cercana), y sigue sujeto a
// la misma regla de siempre — una sola palabra (exacta o fuzzy) no escala
// sin una segunda o sin "tono". Por eso estos 3 casos (el dataset de
// validación, son los mismos que documentaba el gap original) siguen sin
// detectarse, pero ya no por el límite genérico de "no hay fuzzy match" —
// dos son frases (fuzzy no aplica) y el tercero es jerga sin palabra L1
// reconocible ni de forma exacta ni fuzzy. Ver `typoConSegundaSenal` abajo
// para un caso que el fuzzy match SÍ resuelve (palabra mal escrita +
// segunda señal real, el patrón que sí estaba en alcance de Fase 5).
const typosQueNoSeDetectanHoy = [
    'no llgo mi pedido',     // "no llegó" es frase de 2 palabras, fuera del alcance del fuzzy match
    'es una estfa',          // "estafa" mal escrita, pero es 1 sola palabra sin tono ni segunda señal
    'kiero q me regresen mi dinero', // jerga sin palabra L1 reconocible (exacta o fuzzy)
];
for (const text of typosQueNoSeDetectanHoy) {
    test('queja', `GAP CONOCIDO (typo, no detecta hoy): "${text}"`, () => {
        assert(qch(text) === false || qch(text) === undefined,
            `"${text}" — si esto empieza a detectarse, actualizar el comentario de este test (ya no es un gap)`);
    });
}

// Caso que el fuzzy match de Fase JIUA 5 sí resuelve: palabra L1 mal
// escrita ("estfa") + una segunda palabra L1 exacta ("fraude") en el mismo
// mensaje — antes de Fase 5 ninguna fuzzy existía, así que esto contaba
// como 1 sola palabra exacta (no escalaba); ahora cuenta como 2 (exacta +
// fuzzy) y sí escala, sin tocar la regla anti-falso-positivo de "1 sola
// palabra no escala".
const typoConSegundaSenal = 'es una estfa, totalmente un fraude';
test('queja', `DETECTAR (Fase 5, typo + 2da señal): "${typoConSegundaSenal}"`, () => {
    assert(qch(typoConSegundaSenal) === true,
        `"${typoConSegundaSenal}" debería detectarse — typo fuzzy ("estfa"~"estafa") + palabra exacta ("fraude")`);
});

// ═══════════════════════════════════════════════════════════════════════
//  SUITE 2.5: DETECCIÓN DE FRUSTRACIÓN (esFrustracion)
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}── Detección de Frustración ──${RESET}`);

const _FRUSTRATION_WORDS_LOCAL = new Set([
    'perra','perro','chingada','chingado','cabron','cabrona',
    'idiota','imbecil','estupido','estupida','pendejo','pendeja',
    'maldito','maldita','contesta','contestame','responde',
    'apurate','alguien',
]);
const _FRUSTRATION_WORDS_WEAK_LOCAL = new Set(['bueno', 'oye']);
const _URGENCIA_RE_LOCAL = /[!?¿¡]{2,}/;
function _esFrustracionLocal(text) {
    if (!text) return false;
    const n = _norm(text);
    const words = n.split(/[\s,.:;!?¿¡'"()+]+/);
    if (words.some(w => _FRUSTRATION_WORDS_LOCAL.has(w))) return true;
    return _URGENCIA_RE_LOCAL.test(text) && words.some(w => _FRUSTRATION_WORDS_WEAK_LOCAL.has(w));
}
const frus = (t) => indexModule ? indexModule.esFrustracion?.(t) : _esFrustracionLocal(t);

const shouldBeFrustracion = [
    'eres un idiota', 'contestame ya', 'CONTESTA', 'responde porfavor',
    'apurate con mi pedido', 'pinche cabron', 'pend3jo no entiendes',
    'alguien que me ayude por favor',
    // palabra "débil" + puntuación de urgencia repetida sí debe detectarse
    'oye!! llevo media hora esperando', 'bueno?? alguien va a contestar??',
];
for (const text of shouldBeFrustracion) {
    test('frustracion', `DETECTAR: "${text}"`, () => {
        assert(frus(text) === true, `"${text}" debería detectarse como frustración`);
    });
}

const shouldNotBeFrustracion = [
    'hola', 'patines', 'quiero un peluche', 'precio de la bicicleta',
    'donde está la tienda', 'tienen envíos a querétaro',
    // hallazgo de auditoría (Fase JIUA 1, ya corregido): 'bueno'/'oye' solos
    // son muletillas neutras, no frustración — solo cuentan con puntuación
    // de urgencia repetida (ver shouldBeFrustracion arriba)
    'bueno, ¿tienen envíos?', 'oye, ¿cuánto cuesta esto?',
];
for (const text of shouldNotBeFrustracion) {
    test('frustracion', `IGNORAR: "${text}"`, () => {
        assert(frus(text) === false || frus(text) === undefined,
            `"${text}" no debería ser frustración`);
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  SUITE 3: DETECCIÓN DE URL/LINK
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}── Detección de Links ──${RESET}`);

function extractUrl(text) {
    const m = (text || '').match(/https?:\/\/[^\s]+/i);
    return m ? m[0] : null;
}
function extractPathProduct(url) {
    try {
        const p = new URL(url).pathname;
        const parts = p.split('/').filter(s => s && s !== 'products' && s !== 'p' && s !== 'item');
        const last = parts[parts.length - 1] || '';
        return last.replace(/[_-]/g,' ').replace(/[0-9]{5,}/g,'').replace(/\?.*$/,'').trim();
    } catch(_) { return ''; }
}

const linkTests = [
    { input: 'https://juliocepeda.com/products/fi-car?_pos=1', expected: 'fi car' },
    { input: 'https://amazon.com.mx/dp/B08N5WRWNW', expected: '' },   // no extraíble del path
    { input: 'https://juliocepeda.com/products/patines-glam-rush', expected: 'patines glam rush' },
    { input: 'https://juliocepeda.com/products/hot-wheels-speed', expected: 'hot wheels speed' },
    { input: 'https://juliocepeda.com/products/muneca-barbie-fashionista', expected: 'muneca barbie fashionista' },
    { input: 'no es un link de verdad', expected: null },
];

for (const { input, expected } of linkTests) {
    test('links', `URL path: "${input.slice(0,50)}"`, () => {
        const url = extractUrl(input);
        if (expected === null) {
            assert(url === null, `No debería detectar URL en "${input}"`);
        } else {
            assert(url !== null, `Debería detectar URL en "${input}"`);
            if (expected) {
                const extracted = extractPathProduct(url);
                assertContains(extracted, expected.split(' ')[0],
                    `Path extraído: "${extracted}" debe contener "${expected}"`);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  SUITE 4: RATE LIMITER
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}── Rate Limiter ──${RESET}`);

// Simulación independiente del rate limiter
{
    const _rl2 = new Map();
    function rlSim(userId, isImage = false, limit = 10) {
        const now = Date.now();
        if (!_rl2.has(userId)) _rl2.set(userId, { ts: [], img: [] });
        const d = _rl2.get(userId);
        d.ts  = d.ts.filter(t => t > now - 300_000);
        d.img = d.img.filter(t => t > now - 60_000);
        const last60 = d.ts.filter(t => t > now - 60_000).length;
        if (last60 >= limit) return false;
        if (isImage && d.img.length >= 3) return false;
        d.ts.push(now);
        if (isImage) d.img.push(now);
        return true;
    }

    test('rate', 'Primeros 10 mensajes pasan', () => {
        const uid = 'test_rate_1';
        let ok = 0;
        for (let i = 0; i < 10; i++) if (rlSim(uid)) ok++;
        assert(ok === 10, `Esperaba 10 pasaron, pasaron ${ok}`);
    });

    test('rate', 'Mensaje 11 es bloqueado', () => {
        const uid = 'test_rate_2';
        for (let i = 0; i < 10; i++) rlSim(uid);
        assert(!rlSim(uid), 'Mensaje 11 debería ser bloqueado');
    });

    test('rate', 'Imágenes: máx 3 por minuto', () => {
        const uid = 'test_rate_img';
        assert(rlSim(uid, true), '1ra imagen debe pasar');
        assert(rlSim(uid, true), '2da imagen debe pasar');
        assert(rlSim(uid, true), '3ra imagen debe pasar');
        assert(!rlSim(uid, true), '4ta imagen debe ser bloqueada');
    });

    test('rate', 'Usuarios distintos no se afectan', () => {
        const uid1 = 'rate_usr_a', uid2 = 'rate_usr_b';
        for (let i = 0; i < 10; i++) rlSim(uid1);
        assert(rlSim(uid2), 'Usuario distinto debe poder enviar');
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  SUITE 5: SESIONES
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}── Sesiones ──${RESET}`);

try {
    const sm = require('../bot/sessionManager');
    const testUser = `test_${Date.now()}`;

    test('sesion', 'Nueva sesión inicia en MENU', () => {
        const s = sm.getSession(testUser + '_new');
        assert(s.paso_actual === 'MENU', `paso_actual=${s.paso_actual}`);
    });

    test('sesion', 'updateSession guarda correctamente', () => {
        sm.updateSession(testUser, 'SEARCHING', { carrito: [], busqueda: 'patines' });
        const s = sm.getSession(testUser);
        assert(s.paso_actual === 'SEARCHING', `paso_actual=${s.paso_actual}`);
        assert(s.data.busqueda === 'patines', `busqueda=${s.data.busqueda}`);
    });

    test('sesion', 'clearSession regresa a MENU', () => {
        sm.clearSession(testUser);
        const s = sm.getSession(testUser);
        assert(s.paso_actual === 'MENU', `paso_actual=${s.paso_actual}`);
    });

} catch(e) {
    test('sesion', 'sessionManager cargable', () => {
        throw new Error('sessionManager no cargó: ' + e.message);
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  SUITE 6: IMAGEANALYZER (sin llamada real a API)
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}── imageAnalyzer ──${RESET}`);

try {
    const ia = require('../bot/imageAnalyzer');

    test('imagen', 'isConfigured retorna boolean', () => {
        const r = ia.isConfigured();
        assert(typeof r === 'boolean', `isConfigured() retornó ${typeof r}`);
    });

    test('imagen', 'fallbackMessage retorna string', () => {
        const r = ia.fallbackMessage('TIMEOUT');
        assert(typeof r === 'string' && r.length > 5, 'fallbackMessage vacío');
    });

    test('imagen', 'fallbackMessage para razón desconocida', () => {
        const r = ia.fallbackMessage('RAZON_RARA');
        assert(typeof r === 'string' && r.length > 5, 'Debería tener fallback por defecto');
    });

    test('imagen', 'cacheStats retorna objeto', () => {
        const s = ia.cacheStats();
        assert(typeof s === 'object' && 'entries' in s, 'cacheStats mal formado');
    });

    test('imagen', 'analyzeImage con data inválida retorna {ok:false}', async () => {
        // Sin creds reales debe fallar con NO_CONFIGURADO o similar
        const result = await ia.analyzeImage({ data: 'AAAA', mimetype: 'image/jpeg' });
        assert(result && 'ok' in result, 'Debe retornar objeto con ok');
        // Si no hay creds, ok debe ser false
        if (!ia.isConfigured()) {
            assert(result.ok === false, 'Sin credenciales ok debe ser false');
        }
    });

} catch(e) {
    test('imagen', 'imageAnalyzer cargable', () => {
        throw new Error('imageAnalyzer no cargó: ' + e.message);
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  SUITE 7: EDGE CASES
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}── Edge Cases ──${RESET}`);

test('edge', 'Texto vacío no bloquea', () => {
    assert(cf('') === false || cf('') == null || cf('') === undefined);
});
test('edge', 'Texto vacío no detecta queja', () => {
    assert(qch('') === false || qch('') == null || qch('') === undefined);
});
test('edge', 'Solo números no bloquea', () => {
    assert(cf('12345') === false || cf('12345') == null);
});
test('edge', 'Emoji solo no bloquea', () => {
    assert(cf('🧸🎉👶') === false || cf('🧸🎉👶') == null);
});
test('edge', 'URL de la tienda propia no bloquea', () => {
    assert(cf('https://juliocepeda.com/products/patines') === false || cf('https://juliocepeda.com/products/patines') == null);
});
test('edge', 'Texto muy largo no rompe', () => {
    const long = 'quiero un juguete '.repeat(100);
    assert(cf(long) !== undefined);  // no debe tirar excepción
});
test('edge', 'Mensaje con acento y tilde funciona', () => {
    assert(cf('juguete para niña') === false || cf('juguete para niña') == null);
});
test('edge', 'profeco + abogado en frase larga se detecta como queja (2 hits L1)', () => {
    assert(qch('voy a ir con un abogado y a profeco si no me resuelven') === true);
});
test('edge', 'Evasión con espacios detectada', () => {
    assert(cf('p e n e') === true, '"p e n e" debería ser bloqueado');
});

// ═══════════════════════════════════════════════════════════════════════
//  RESULTADO FINAL
// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(55));
const total = passed + failed;
const pct   = total > 0 ? Math.round(passed/total*100) : 0;
console.log(`${BOLD}RESULTADO: ${passed}/${total} pruebas pasaron (${pct}%)${RESET}`);
if (skipped) console.log(`${YELLOW}  Omitidas: ${skipped}${RESET}`);
if (failed === 0) {
    console.log(`${VERDE}${BOLD}✅ Todas las pruebas pasaron${RESET}`);
} else {
    console.log(`${ROJO}${BOLD}❌ ${failed} prueba(s) fallaron${RESET}`);
    console.log(`\nPruebas fallidas:`);
    results.filter(r => !r.ok).forEach(r => {
        console.log(`  ${ROJO}✗ [${r.suite}] ${r.name}${RESET}`);
        console.log(`    ${r.error}`);
    });
}
console.log('═'.repeat(55) + '\n');
process.exit(failed > 0 ? 1 : 0);
