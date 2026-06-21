// imageAnalyzer.js
// Análisis de imágenes via Google Cloud Vision API.
// Cache de resultados en SQLite (7 días) para no repetir llamadas.
// Fallback de texto si la API falla o no está configurada.
// Sin dependencias adicionales de NPM — solo https y fs nativos de Node.js.

'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const db     = require('./db_connection');
const log    = require('./logger')('imageAnalyzer');

// ── Config ─────────────────────────────────────────────────────────────────
const CACHE_TTL_DAYS  = 7;
const VISION_TIMEOUT  = 5000;   // ms — si Vision no responde en 5s, fallback
const MAX_LABELS      = 8;      // cuántas etiquetas pedirle a Vision
const MIN_CONFIDENCE  = 0.60;   // descartar etiquetas con score menor a esto
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;  // 4MB máximo (límite API gratuita)

// ── Ruta de credenciales Google Cloud Vision ──────────────────────────────
// Prioridad: 1) variable de entorno  2) ruta fija del servidor
// NUNCA subir este archivo a Git — agrégalo a .gitignore
const CREDS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || ''; // Configurar GOOGLE_APPLICATION_CREDENTIALS en .env

// Verificación temprana al arrancar (no bloquea, solo avisa en consola)
;(function _checkCredsOnStartup() {
    const fs_ = require('fs');
    if (!fs_.existsSync(CREDS_PATH)) {
        log.warn('⚠️  Credenciales no encontradas en: ' + CREDS_PATH);
        log.warn('El análisis de imágenes estará desactivado.');
        return;
    }
    try {
        const raw = JSON.parse(fs_.readFileSync(CREDS_PATH, 'utf8'));
        if (!raw.private_key || !raw.client_email) throw new Error('Estructura inválida');
        const projectId = raw.project_id || '(desconocido)';
        log.info(`✅ Credenciales cargadas. Proyecto: ${projectId}`);
        log.info(`Si la API no está activada, visita: https://console.developers.google.com/apis/api/vision.googleapis.com/overview?project=${raw.project_id || ''}`);
    } catch (e) {
        log.error('❌ Error leyendo credenciales', e);
    }
})();

// ── Crear tabla de cache si no existe ─────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS vision_cache (
        hash        TEXT PRIMARY KEY,
        labels_json TEXT NOT NULL,
        query_text  TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        hits        INTEGER NOT NULL DEFAULT 1
    )
`);

// ── Limpieza de cache expirado (al iniciar y cada 24h) ─────────────────────
function _limpiarCache() {
    try {
        db.prepare(
            `DELETE FROM vision_cache WHERE created_at < datetime('now','localtime','-${CACHE_TTL_DAYS} days')`
        ).run();
    } catch (e) { log.debug('No se pudo limpiar vision_cache: ' + e.message); }
}
_limpiarCache();
setInterval(_limpiarCache, 24 * 60 * 60_000).unref();

// ── Helpers ────────────────────────────────────────────────────────────────
function _hash(data) {
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
}

function _cacheGet(hash) {
    try {
        const row = db.prepare('SELECT labels_json, query_text FROM vision_cache WHERE hash = ?').get(hash);
        if (!row) return null;
        // Actualizar contador de hits
        db.prepare('UPDATE vision_cache SET hits = hits + 1 WHERE hash = ?').run(hash);
        return { labels: JSON.parse(row.labels_json), queryText: row.query_text };
    } catch (_) { return null; }
}

function _cacheSet(hash, labels, queryText) {
    try {
        db.prepare(
            'INSERT OR REPLACE INTO vision_cache (hash, labels_json, query_text) VALUES (?, ?, ?)'
        ).run(hash, JSON.stringify(labels), queryText);
    } catch (e) { log.debug('No se pudo guardar en vision_cache: ' + e.message); }
}

// ── Cargar credenciales ────────────────────────────────────────────────────
function _loadCreds() {
    try {
        if (!fs.existsSync(CREDS_PATH)) return null;
        return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
    } catch (_) { return null; }
}

// ── Obtener access token via JWT (sin googleapis SDK) ─────────────────────
// Google Cloud usa JWT firmado con la clave privada del service account.
// Implementado con el módulo crypto nativo de Node.js.
let _tokenCache = { token: null, expires: 0 };

async function _getAccessToken() {
    if (_tokenCache.token && Date.now() < _tokenCache.expires) {
        return _tokenCache.token;
    }

    const creds = _loadCreds();
    if (!creds || !creds.private_key || !creds.client_email) {
        throw new Error('NO_CREDENTIALS');
    }

    const now    = Math.floor(Date.now() / 1000);
    const claim  = {
        iss:   creds.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-vision',
        aud:   'https://oauth2.googleapis.com/token',
        iat:   now,
        exp:   now + 3600,
    };

    // Construir JWT manualmente
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
    const toSign  = `${header}.${payload}`;

    const sign    = crypto.createSign('RSA-SHA256');
    sign.update(toSign);
    const signature = sign.sign(creds.private_key, 'base64url');
    const jwt = `${toSign}.${signature}`;

    // Intercambiar JWT por access token
    const token = await _postJSON('https://oauth2.googleapis.com/token', {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
    }, { isForm: true });

    _tokenCache = {
        token:   token.access_token,
        expires: Date.now() + (token.expires_in - 60) * 1000,
    };
    return _tokenCache.token;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
function _postJSON(url, body, opts = {}) {
    return new Promise((resolve, reject) => {
        const parsed  = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const lib     = isHttps ? https : http;

        let postData;
        let contentType;
        if (opts.isForm) {
            postData    = Object.entries(body).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
            contentType = 'application/x-www-form-urlencoded';
        } else {
            postData    = JSON.stringify(body);
            contentType = 'application/json';
        }

        const options = {
            hostname: parsed.hostname,
            port:     parsed.port || (isHttps ? 443 : 80),
            path:     parsed.pathname + (parsed.search || ''),
            method:   'POST',
            headers: {
                'Content-Type':   contentType,
                'Content-Length': Buffer.byteLength(postData),
                ...(opts.headers || {}),
            },
            timeout: VISION_TIMEOUT,
        };

        const req = lib.request(options, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`JSON parse error: ${data.slice(0,200)}`)); }
            });
        });
        let _settled = false;
        const _settle = (fn, val) => { if (!_settled) { _settled = true; fn(val); } };
        req.on('error',   e  => _settle(reject, e));
        req.on('timeout', () => { req.destroy(); _settle(reject, new Error('TIMEOUT')); });
        req.write(postData);
        req.end();
    });
}

function _fetchUrl(url, timeoutMs = VISION_TIMEOUT) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib    = parsed.protocol === 'https:' ? https : http;
        const chunks = [];
        let totalBytes = 0;

        const req = lib.get(url, { timeout: timeoutMs }, res => {
            // Seguir redirect
            if (res.statusCode === 301 || res.statusCode === 302) {
                return _fetchUrl(res.headers.location, timeoutMs).then(resolve, reject);
            }
            res.on('data', chunk => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_IMAGE_BYTES) {
                    req.destroy();
                    return reject(new Error('IMAGE_TOO_LARGE'));
                }
                chunks.push(chunk);
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        let _s2 = false;
        const _r2 = (fn, v) => { if (!_s2) { _s2 = true; fn(v); } };
        req.on('error',   e  => _r2(reject, e));
        req.on('timeout', () => { req.destroy(); _r2(reject, new Error('TIMEOUT')); });
    });
}

// ── Llamada a Google Cloud Vision API ─────────────────────────────────────
async function _callVisionAPI(imageBase64) {
    const token = await _getAccessToken();
    const body  = {
        requests: [{
            image: { content: imageBase64 },
            features: [
                { type: 'LABEL_DETECTION',    maxResults: MAX_LABELS },
                { type: 'OBJECT_LOCALIZATION', maxResults: 5 },
                { type: 'TEXT_DETECTION',     maxResults: 1 },   // OCR — lee texto en la caja
                { type: 'LOGO_DETECTION',     maxResults: 3 },   // detecta marcas: LEGO, Barbie, etc.
            ],
        }],
    };
    const resp = await _postJSON(
        'https://vision.googleapis.com/v1/images:annotate',
        body,
        { headers: { Authorization: `Bearer ${token}` } }
    );

    if (resp.error) throw new Error(`Vision API error: ${resp.error.message}`);

    const response = resp.responses?.[0] || {};

    // Combinar labels + objects, deduplicar, filtrar por confianza
    const allLabels = new Map();

    for (const label of (response.labelAnnotations || [])) {
        if (label.score >= MIN_CONFIDENCE) {
            allLabels.set(label.description.toLowerCase(), label.score);
        }
    }
    for (const obj of (response.localizedObjectAnnotations || [])) {
        if (obj.score >= MIN_CONFIDENCE) {
            const key = obj.name.toLowerCase();
            if (!allLabels.has(key) || allLabels.get(key) < obj.score) {
                allLabels.set(key, obj.score);
            }
        }
    }

    // ── Logos detectados (marcas: LEGO, Barbie, Hot Wheels, etc.) ──
    for (const logo of (response.logoAnnotations || [])) {
        if (logo.score >= 0.4) {
            allLabels.set(logo.description.toLowerCase(), logo.score + 0.1); // boost a logos
        }
    }

    // ── Texto OCR — extraer palabras clave del texto en la imagen ──
    const fullText = response.textAnnotations?.[0]?.description || '';
    if (fullText) {
        // Extraer líneas con palabras relevantes (marcas, nombres, números de modelo)
        const lineas = fullText.split('\n')
            .map(l => l.trim())
            .filter(l => l.length >= 3 && l.length <= 50);

        for (const linea of lineas) {
            const lower = linea.toLowerCase();
            // Ignorar líneas genéricas o irrelevantes
            if (/^[0-9\s\.\$\%\+\-\/]+$/.test(linea)) continue; // solo números/símbolos
            if (/pcs|pzs|building|jouet|juguete|toy|for|ages|años|pieces/.test(lower)) continue;
            // Priorizar marcas y nombres de producto conocidos
            const isMarca = /lego|minecraft|barbie|hot wheels|mattel|fisher|playmobil|funko|hasbro|nerf|marvel|disney|pokemon|hatchimal|spin master|step2|apache/.test(lower);
            const score = isMarca ? 0.95 : 0.65;
            if (!allLabels.has(lower)) {
                allLabels.set(lower, score);
            }
        }
    }

    // Ordenar por score descendente
    return [...allLabels.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([desc, score]) => ({ desc, score }));
}

// ── Traducción de etiquetas Vision → términos de búsqueda en español ───────
const LABEL_TRANSLATIONS = {
    // Juguetes genéricos
    'toy':'juguete','toys':'juguete','plaything':'juguete',
    'doll':'muñeca','baby doll':'muñeca bebé',
    'stuffed animal':'peluche','stuffed toy':'peluche','plush':'peluche','plush toy':'peluche',
    'teddy bear':'oso peluche','bear':'oso peluche',
    'action figure':'figura acción','figurine':'figura','collectible':'coleccionable',
    'board game':'juego mesa','card game':'juego cartas','chess':'ajedrez','checkers':'damas',
    'puzzle':'puzzle','jigsaw puzzle':'puzzle',
    'lego':'lego','building blocks':'bloques','construction toy':'construcción',
    'block':'bloque','blocks':'bloques',
    // Vehículos
    'bicycle':'bicicleta','bike':'bicicleta','cycling':'bicicleta',
    'tricycle':'triciclo','balance bike':'bicicleta equilibrio',
    'scooter':'scooter','kick scooter':'scooter',
    'skateboard':'patineta','roller skate':'patines','rollerblade':'patines',
    'skate':'patines','inline skate':'patines',
    'remote control':'radio control','radio control':'radio control',
    'rc car':'carro radio control','remote control car':'carro rc',
    'car':'carro','toy car':'carro','die cast car':'carro coleccionable',
    'vehicle':'vehículo','truck':'camión','bus':'autobús',
    'train':'tren','railway':'tren','locomotive':'tren',
    'motorcycle':'moto','toy motorcycle':'moto',
    'ambulance':'ambulancia','police car':'carro policía','fire truck':'camión bomberos',
    // Vehículos montables
    'power wheels':'montable','ride on':'montable','electric car toy':'montable eléctrico',
    'quad':'cuatrimoto','atv':'cuatrimoto',
    // Deportes y actividad física
    'ball':'pelota','football':'balón','basketball':'baloncesto',
    'soccer ball':'balón fútbol','volleyball':'voleibol',
    'bat':'bate','racket':'raqueta','tennis':'tenis',
    'frisbee':'frisbee','hula hoop':'hula hoop',
    'jump rope':'cuerda saltar','yo-yo':'yoyo',
    'kite':'cometa','parachute toy':'paracaídas',
    // Educativos
    'book':'libro','educational':'educativo','learning':'educativo',
    'abacus':'ábaco','counting':'matemáticas',
    'alphabet':'alfabeto','letters':'letras',
    'musical instrument':'instrumento musical','keyboard':'teclado',
    'guitar':'guitarra','piano':'piano','drum':'tambor','xylophone':'xilófono',
    'microscope':'microscopio','telescope':'telescopio','science kit':'kit ciencia',
    'globe':'globo terráqueo','map':'mapa',
    // Arte y creatividad
    'paint':'pintura','painting':'pintura','crayon':'crayones','marker':'marcadores',
    'clay':'plastilina','slime':'slime','kinetic sand':'arena cinética',
    'drawing':'dibujo','sketch':'dibujo',
    'craft':'manualidades','arts and crafts':'manualidades',
    'sticker':'stickers','stamp':'sellos',
    'glitter':'glitter','foam':'foami',
    // Bebé / primera infancia
    'baby':'bebé','infant':'bebé','rattle':'sonajero','teether':'mordedor',
    'pacifier':'chupón','baby toy':'juguete bebé',
    'mobile':'móvil cuna','walker':'andadera',
    'baby gym':'gimnasio bebé','activity mat':'tapete actividades',
    'sensory toy':'juguete sensorial',
    // Tecnología y electrónico
    'robot':'robot','robotic':'robot','coding toy':'robot programación',
    'drone':'drone','quadcopter':'drone',
    'electronic':'electrónico','interactive':'interactivo',
    'tablet':'tablet infantil','gaming':'videojuego','console':'consola',
    // Juegos de rol / fantasía
    'superhero':'superhéroe','batman':'batman','spiderman':'spiderman',
    'princess':'princesa','fairy':'hada','mermaid':'sirena',
    'knight':'caballero','castle':'castillo',
    // Casa y cocina
    'kitchen':'cocina de juguete','cooking':'cocina','food toy':'comidita',
    'play kitchen':'cocina juguete','miniature':'miniatura',
    'dollhouse':'casa muñecas','playhouse':'casita',
    // Marcas comunes
    'barbie':'barbie','ken':'ken barbie',
    'hot wheels':'hot wheels',
    'nerf':'nerf','nerf gun':'nerf',
    'lego':'lego','duplo':'lego duplo',
    'playmobil':'playmobil',
    'fisher price':'fisher price','fisher-price':'fisher price',
    'play-doh':'play doh','playdoh':'play doh',
    'monopoly':'monopoly','uno':'uno cartas',
    'transformers':'transformers',
    'minecraft':'minecraft',
};

function _translateLabels(labels) {
    const translated = labels.map(l => {
        const key = l.desc.toLowerCase();
        return LABEL_TRANSLATIONS[key] || l.desc;
    });
    // Deduplicar
    return [...new Set(translated)];
}

// ── Normalización de query para búsqueda ──────────────────────────────────
// Palabras genéricas que Vision detecta pero no ayudan a buscar en el catálogo
const _VISION_STOPWORDS = new Set([
    'toy','toys','juguete','juguetes','plaything',
    'block','blocks','plastic','packaging','labeling','label',
    'orange','yellow','red','blue','green','purple','pink','white','black','brown','gray',
    'product','object','item','thing','game','play','fun',
    'cardboard','box','container','paper','material',
    'indoor','outdoor','recreation','leisure',
]);

function _buildSearchQuery(labels) {
    // Filtrar stopwords genéricas y tomar las primeras 5 palabras relevantes
    const filtradas = labels
        .map(l => l.toLowerCase().trim())
        .filter(l => l.length > 2 && !_VISION_STOPWORDS.has(l))
        .slice(0, 5);
    return filtradas.join(' ') || labels.slice(0, 2).join(' '); // fallback si todo es stopword
}

// ── API PÚBLICA ────────────────────────────────────────────────────────────

/**
 * Analiza una imagen recibida por WhatsApp.
 * media: objeto con { data: Buffer|string(base64), mimetype: string }
 *
 * Retorna:
 *   { ok: true,  query: string, labels: string[], fromCache: bool }
 *   { ok: false, reason: string }
 */
async function analyzeImage(media) {
    try {
        // Obtener base64
        let base64;
        if (Buffer.isBuffer(media.data)) {
            if (media.data.length > MAX_IMAGE_BYTES) {
                return { ok: false, reason: 'IMAGEN_MUY_GRANDE' };
            }
            base64 = media.data.toString('base64');
        } else {
            // Ya viene como string base64 (whatsapp-web.js lo entrega así)
            base64 = media.data;
            const bytes = Buffer.byteLength(base64, 'base64');
            if (bytes > MAX_IMAGE_BYTES) {
                return { ok: false, reason: 'IMAGEN_MUY_GRANDE' };
            }
        }

        // Cache por hash de la imagen
        const hash     = _hash(base64.slice(0, 1000) + base64.length);
        const cached   = _cacheGet(hash);
        if (cached) {
            return { ok: true, query: cached.queryText, labels: cached.labels, fromCache: true };
        }

        // Llamar a Vision API
        const rawLabels = await _callVisionAPI(base64);
        if (!rawLabels.length) {
            return { ok: false, reason: 'SIN_ETIQUETAS' };
        }

        const labels    = _translateLabels(rawLabels);
        const queryText = _buildSearchQuery(labels);

        _cacheSet(hash, labels, queryText);
        return { ok: true, query: queryText, labels, fromCache: false };

    } catch (err) {
        if (err.message === 'NO_CREDENTIALS') {
            return { ok: false, reason: 'NO_CONFIGURADO' };
        }
        if (err.message === 'TIMEOUT' || err.message === 'IMAGE_TOO_LARGE') {
            return { ok: false, reason: err.message };
        }
        // API desactivada en Google Cloud Console
        if (err.message && (
            err.message.includes('has not been used') ||
            err.message.includes('it is disabled') ||
            err.message.includes('SERVICE_DISABLED') ||
            err.message.includes('API_NOT_ACTIVATED')
        )) {
            // Extraer project ID del mensaje de error para el link directo
            const projectMatch = err.message.match(/project\s+([\d]+)/);
            const projectId = projectMatch ? projectMatch[1] : null;
            const enableUrl = projectId
                ? `https://console.developers.google.com/apis/api/vision.googleapis.com/overview?project=${projectId}`
                : 'https://console.cloud.google.com/apis/library/vision.googleapis.com';
            log.error(`⚠️  Vision API desactivada. Actívala en: ${enableUrl}`);
            return { ok: false, reason: 'API_DESACTIVADA', enableUrl };
        }
        log.error('Error', err);
        return { ok: false, reason: 'ERROR_API' };
    }
}

/**
 * Analiza una imagen desde URL (para el catálogo propio si se necesita).
 */
async function analyzeImageUrl(url) {
    try {
        const hash   = _hash(url);
        const cached = _cacheGet(hash);
        if (cached) return { ok: true, query: cached.queryText, labels: cached.labels, fromCache: true };

        const buf    = await _fetchUrl(url);
        const base64 = buf.toString('base64');
        return analyzeImage({ data: base64, mimetype: 'image/jpeg' });
    } catch (err) {
        return { ok: false, reason: 'URL_INACCESIBLE' };
    }
}

/**
 * Verifica si las credenciales están configuradas.
 */
function isConfigured() {
    return fs.existsSync(CREDS_PATH);
}

/**
 * Stats del cache para el monitor.
 */
function cacheStats() {
    try {
        const row = db.prepare('SELECT COUNT(*) as total, SUM(hits) as total_hits FROM vision_cache').get();
        return { entries: row.total, totalHits: row.total_hits || 0 };
    } catch (_) { return { entries: 0, totalHits: 0 }; }
}

// Mensajes de respuesta al usuario según el tipo de fallo
const FALLBACK_MSGS = {
    NO_CONFIGURADO:  '📸 El análisis de imágenes está en configuración. ¿Puedes describirme el producto con texto?',
    API_DESACTIVADA: '📸 El servicio de imágenes no está disponible en este momento. ¿Puedes describirme el producto con texto?',
    TIMEOUT:         '📸 El servicio de imágenes tardó demasiado. ¿Puedes describir el producto?',
    IMAGE_TOO_LARGE: '📸 La imagen es muy grande. ¿Puedes enviar una más pequeña o describir el producto?',
    SIN_ETIQUETAS:   '📸 No pude identificar el juguete en la imagen. ¿Puedes describirlo con palabras?',
    ERROR_API:       '📸 Hubo un problema analizando la imagen. ¿Puedes describir el producto?',
    DEFAULT:         '📸 No pude procesar la imagen. ¿Puedes describir el producto con texto?',
};

function fallbackMessage(reason) {
    return FALLBACK_MSGS[reason] || FALLBACK_MSGS.DEFAULT;
}

module.exports = {
    analyzeImage,
    analyzeImageUrl,
    isConfigured,
    cacheStats,
    fallbackMessage,
};
