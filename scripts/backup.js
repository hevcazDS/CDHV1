// backup.js — Backup automatico: DB a las 11:00 AM, imagenes a las 11:30 AM
// Uso: node backup.js           -> ambos backups inmediatos
//      node backup.js db        -> solo DB
//      node backup.js imagenes  -> solo imagenes nuevas
'use strict';

const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');
const net    = require('net');
const tls    = require('tls');
const crypto = require('crypto');

// ── Cargar .env PRIMERO ────────────────────────────────────────────
require('dotenv').config({ quiet: true });

// ── Configuracion ──────────────────────────────────────────────────
// El backup debe respaldar la TIENDA ACTIVA, no siempre la del .env
// (REVISION_ARQUITECTURA H2): si hay puntero de instancia (mismo mecanismo
// que bot/db_connection.js), se respalda ESE .db. Sin puntero → el del env.
function _dbPathEfectivo() {
    const base = process.env.DB_PATH || path.join(__dirname, 'jugueteria.db');
    try {
        const ptr = path.join(__dirname, '..', 'dashboard', '.instancia_activa');
        if (fs.existsSync(ptr)) {
            const ruta = fs.readFileSync(ptr, 'utf8').trim();
            const dirInst = path.resolve(path.join(__dirname, '..', 'instancias'));
            if (ruta && path.resolve(ruta).startsWith(dirInst + path.sep) && fs.existsSync(ruta)) return ruta;
        }
    } catch (_) {}
    return base;
}
const DB_PATH   = _dbPathEfectivo();
const IMG_DIR   = path.join(__dirname, 'imagenes_clientes');
const SMTP_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.EMAIL_PORT || '587');

// Los RESPALDOS usan SIEMPRE la cuenta de correo del .env (EMAIL_USER/PASS) --
// es la cuenta de operaciones/proveedor, independiente del correo que cada
// tienda configura para sí en la BD (bot_email_*, Prime > General). Así el
// respaldo no depende de que la tienda haya configurado su buzón.
function _cfg(clave, fallback) {
    try {
        const db = require('../bot/db_connection');
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        return (r && r.valor) ? r.valor : fallback;
    } catch (_) { return fallback; }
}

const SMTP_USER = process.env.EMAIL_USER || '';
const SMTP_PASS = process.env.EMAIL_PASS || '';

// DESTINO: por default la misma cuenta de respaldos (SMTP_USER). Sobreescribible
// desde Prime > General (email_backup_destino, admite varios separados por
// coma) o, si nunca se configuró ahí, con BACKUP_DEST en .env.
const DEST_MAIL = _cfg('email_backup_destino', process.env.BACKUP_DEST || SMTP_USER || '');
const FROM_MAIL = 'Backup Julio Cepeda <' + SMTP_USER + '>';
const MAX_IMG_BYTES = 15 * 1024 * 1024; // 15MB maximo por correo de imagenes

// ── Registro de imagenes ya enviadas ──────────────────────────────
const REGISTRO_PATH = path.join(__dirname, '.backup_registro.json');

function cargarRegistro() {
    try {
        if (fs.existsSync(REGISTRO_PATH))
            return JSON.parse(fs.readFileSync(REGISTRO_PATH, 'utf8'));
    } catch(e) { console.warn('[backup] No se pudo leer registro:', e.message); }
    return { enviados: [], ultimo_backup: null };
}

function guardarRegistro(reg) {
    try { fs.writeFileSync(REGISTRO_PATH, JSON.stringify(reg, null, 2), 'utf8'); }
    catch(e) { console.warn('[backup] No se pudo guardar registro:', e.message); }
}

// ── Cifrado opcional del respaldo (modo configurado por Prime) ──────
// off → gz en claro; bajo → clave envuelta en la BD (auto); alto → clave
// pasada por env BACKUP_KEY_HEX desde el respaldo manual (dashboard armado).
function cifrarSiAplica(buf) {
    try {
        const db = require('../bot/db_connection');
        const modo = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_cifrado_modo'").get()?.valor || 'off';
        if (modo === 'off') return { buf, ext: '.gz' };
        const cb = require('../services/cryptoBackup');
        let key = null;
        if (modo === 'bajo') {
            const wrapped = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_key_wrapped'").get()?.valor;
            const secreto = fs.readFileSync(path.join(__dirname, '..', 'dashboard', '.instancia_secret'), 'utf8').trim();
            if (wrapped) key = cb.desenvolverConSecreto(wrapped, secreto);
        } else if (modo === 'alto') {
            if (process.env.BACKUP_KEY_HEX) key = Buffer.from(process.env.BACKUP_KEY_HEX, 'hex');
        }
        // FAIL-CLOSED: si el usuario pidió cifrado y no hay clave, NO se envía
        // en claro (la BD trae datos personales). En modo 'alto' la clave no
        // se guarda a propósito, así que el respaldo automático NO puede
        // cifrar — hay que usar el respaldo manual del panel (donde se teclea
        // la maestra) o cambiar a modo 'bajo'.
        if (!key) {
            const motivo = 'cifrado "' + modo + '" activo pero sin clave disponible'
                + (modo === 'alto' ? ' — el modo alto no guarda la clave; el respaldo automático no puede cifrar. Usa el respaldo manual del panel o cambia a modo bajo.' : ' (revisa backup_key_wrapped / .instancia_secret).');
            return { omitir: true, motivo };
        }
        return { buf: cb.cifrar(buf, key), ext: '.gz.enc' };
    } catch (e) { return { omitir: true, motivo: 'error al cifrar el respaldo: ' + e.message }; }
}

// Encola un aviso (dedup por día) cuando el respaldo se OMITE por no poder
// cifrar — para que Prime se entere el mismo día, no solo por el aviso de
// >36h de checkBackupReciente.
function _alertarCifradoBackup(motivo) {
    try {
        const db = require('../bot/db_connection');
        const ya = db.prepare("SELECT id FROM cola_emails WHERE tipo='alerta_cifrado_backup' AND date(creada_en)=date('now','localtime') LIMIT 1").get();
        if (ya) return;
        const dest = process.env.EMAIL_PERSONAL || process.env.EMAIL_CEDIS || process.env.EMAIL_USER;
        if (!dest) { console.error('[backup] sin EMAIL_* para alertar del cifrado omitido'); return; }
        db.prepare("INSERT INTO cola_emails (destinatarios, asunto, html_body, estatus, tipo) VALUES (?, 'Respaldo NO enviado: no se pudo cifrar', ?, 'pendiente', 'alerta_cifrado_backup')")
            .run(JSON.stringify([dest]), '<p>El respaldo automático de la base de datos <b>no se envió</b> porque el cifrado está activo pero no había clave disponible.</p><p>' + motivo + '</p>');
    } catch (e) { console.warn('[backup] no se pudo encolar alerta de cifrado: ' + e.message); }
}

// ── Comprimir un archivo a gzip ────────────────────────────────────
function comprimirArchivo(srcPath) {
    return new Promise((resolve, reject) => {
        zlib.gzip(fs.readFileSync(srcPath), (err, buf) => err ? reject(err) : resolve(buf));
    });
}

// ── Snapshot CONSISTENTE de una BD en WAL + gzip (comité #12) ──────
// readFileSync sobre una BD viva en WAL puede capturar el archivo principal sin
// las transacciones que aún viven en el -wal → respaldo potencialmente corrupto
// o incompleto. La API .backup() de SQLite produce un snapshot transaccional.
async function comprimirDbConsistente(ruta) {
    const Database = require('better-sqlite3');
    const tmp = path.join(require('os').tmpdir(), 'bk_' + process.pid + '_' + Date.now() + '.db');
    const db = new Database(ruta, { readonly: true });
    try {
        await db.backup(tmp);
    } finally { try { db.close(); } catch (_) {} }
    try {
        return await comprimirArchivo(tmp);
    } finally {
        for (const s of ['', '-wal', '-shm']) { try { fs.rmSync(tmp + s, { force: true }); } catch (_) {} }
    }
}

// ── Comprimir solo imagenes NUEVAS ────────────────────────────────
async function comprimirImagenesNuevas() {
    if (!fs.existsSync(IMG_DIR)) return null;
    const registro   = cargarRegistro();
    const yaEnviados = new Set(registro.enviados || []);
    const nuevos     = fs.readdirSync(IMG_DIR)
        .filter(f => !f.startsWith('.') && !yaEnviados.has(f))
        .map(f => ({ nombre: f, path: path.join(IMG_DIR, f), mtime: fs.statSync(path.join(IMG_DIR, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime); // mas antiguos primero

    if (!nuevos.length) return { buffer: null, archivosIncluidos: [], registro };

    const partes = [];
    const incluidos = [];
    let acum = 0;

    for (const arch of nuevos) {
        try {
            const data = fs.readFileSync(arch.path);
            if (acum + data.length > MAX_IMG_BYTES) continue; // deja los grandes para manana
            const header = Buffer.alloc(120, 0);
            Buffer.from(arch.nombre).copy(header, 0, 0, Math.min(arch.nombre.length, 99));
            Buffer.from(String(data.length).padStart(19, '0')).copy(header, 100);
            partes.push(header, data);
            incluidos.push(arch.nombre);
            acum += data.length;
        } catch(e) { console.warn('[backup] No se pudo leer imagen ' + arch.nombre + ':', e.message); }
    }

    if (!partes.length) return { buffer: null, archivosIncluidos: [], registro };

    const buffer = await new Promise((resolve, reject) => {
        zlib.gzip(Buffer.concat(partes), (err, buf) => err ? reject(err) : resolve(buf));
    });

    return { buffer, archivosIncluidos: incluidos, registro };
}

// ── Enviar email con adjuntos via SMTP STARTTLS ────────────────────
function enviarBackup(adjuntos, asunto) {
    if (!SMTP_USER || !SMTP_PASS) {
        console.error('[backup] Sin credenciales SMTP — configura EMAIL_USER/EMAIL_PASS en .env (cuenta de respaldos, independiente del correo de la tienda)');
        return Promise.resolve(false);
    }
    if (!DEST_MAIL) {
        console.error('[backup] Sin destinatario — agrega email_backup_destino en Prime > General o BACKUP_DEST en .env');
        return Promise.resolve(false);
    }
    const destList = DEST_MAIL.split(',').map(d => d.trim()).filter(Boolean);

    const boundary = '----BackupBnd' + crypto.randomBytes(8).toString('hex');
    let body = [
        'From: ' + FROM_MAIL,
        'To: ' + destList.join(', '),
        'Subject: ' + asunto,
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="' + boundary + '"',
        '',
        '--' + boundary,
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Backup automático del sistema Julio Cepeda Jugueterías.',
        'Fecha: ' + new Date().toLocaleString('es-MX'),
        'Destino: ' + DEST_MAIL,
        '',
        'Este correo fue generado automáticamente.',
    ].join('\r\n');

    for (const adj of adjuntos) {
        const b64 = adj.data.toString('base64').match(/.{1,76}/g).join('\r\n');
        body += '\r\n\r\n--' + boundary + '\r\n' +
            'Content-Type: application/gzip; name="' + adj.nombre + '"\r\n' +
            'Content-Transfer-Encoding: base64\r\n' +
            'Content-Disposition: attachment; filename="' + adj.nombre + '"\r\n\r\n' +
            b64;
    }
    body += '\r\n--' + boundary + '--\r\n';

    return new Promise((resolve) => {
        const sock = net.createConnection(SMTP_PORT, SMTP_HOST);
        let tlsSock = null;
        let step = 0;
        let rcptPendientes = 0;

        function send(s) { (tlsSock || sock).write(s + '\r\n'); }

        function onData(data) {
            const code = parseInt((data.toString()).slice(0, 3));
            if (step === 0 && code === 220) { send('EHLO backup.bot'); step = 1; }
            else if (step === 1 && code === 250) { send('STARTTLS'); step = 2; }
            else if (step === 2 && code === 220) {
                tlsSock = tls.connect({ socket: sock, host: SMTP_HOST, servername: SMTP_HOST }, () => {
                    tlsSock.on('data', onData);
                    send('EHLO backup.bot'); step = 3;
                });
            }
            else if (step === 3 && code === 250) { send('AUTH LOGIN'); step = 4; }
            else if (step === 4 && code === 334) { send(Buffer.from(SMTP_USER).toString('base64')); step = 5; }
            else if (step === 5 && code === 334) { send(Buffer.from(SMTP_PASS).toString('base64')); step = 6; }
            else if (step === 6 && code === 235) { send('MAIL FROM:<' + SMTP_USER + '>'); step = 7; }
            else if (step === 7 && code === 250) {
                rcptPendientes = destList.length;
                for (const dest of destList) send('RCPT TO:<' + dest + '>');
                step = 8;
            }
            else if (step === 8 && code === 250) {
                rcptPendientes--;
                if (rcptPendientes <= 0) { send('DATA'); step = 9; }
            }
            else if (step === 9 && code === 354) { send(body + '\r\n.'); step = 10; }
            else if (step === 10 && code === 250) {
                send('QUIT');
                console.log('[backup] Correo enviado a: ' + destList.join(', '));
                resolve(true);
                (tlsSock || sock).destroy();
            }
            else if (code >= 400) {
                console.error('[backup] Error SMTP ' + code + ': ' + data.toString().trim());
                resolve(false);
                (tlsSock || sock).destroy();
            }
        }

        sock.on('data', onData);
        sock.on('error', (e) => { console.error('[backup] Socket error:', e.message); resolve(false); });
        sock.on('timeout', ()  => { console.error('[backup] Timeout SMTP'); resolve(false); (tlsSock||sock).destroy(); });
        sock.setTimeout(30000);
    });
}

// TODAS las bases a respaldar (AUDITORIA_ERP_COMPLETITUD P5): antes solo se
// respaldaba la BD ACTIVA (puntero o .env) — las instancias NO activas
// (barberia.db, restaurante.db…) quedaban SIN copia fuera del servidor, nunca.
// Ahora: la activa + la principal del .env + instancias/*.db, deduplicadas.
function _basesARespaldar() {
    const bases = new Map();   // ruta resuelta → etiqueta (dedup)
    const agregar = (ruta) => {
        try { const r = path.resolve(ruta); if (fs.existsSync(r)) bases.set(r, path.basename(r, '.db')); } catch (_) {}
    };
    agregar(DB_PATH);                                       // la activa (puntero o env)
    if (process.env.DB_PATH) agregar(process.env.DB_PATH);  // la principal SIEMPRE
    try {
        const dir = path.join(__dirname, '..', 'instancias');
        for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.db'))) agregar(path.join(dir, f));
    } catch (_) { /* sin carpeta instancias/ → solo la principal */ }
    return [...bases.entries()];   // [[ruta, etiqueta], ...]
}

// ── Backup DB (11:00 AM) — multi-instancia ──────────────────────────
async function runBackupDB() {
    const fecha = new Date().toISOString().slice(0, 10);
    const bases = _basesARespaldar();
    console.log('[backup] Iniciando backup de ' + bases.length + ' base(s) -> ' + DEST_MAIL);
    if (!bases.length) { console.error('[backup] Ninguna DB encontrada'); return false; }
    try {
        const adjuntos = [];
        for (const [ruta, etiqueta] of bases) {
            const _gz = await comprimirDbConsistente(ruta);
            // VERIFICACIÓN DE RESTAURACIÓN (comité #12): probar que el artefacto
            // que vamos a enviar realmente restaura (integrity + tablas críticas
            // + mayor cuadra) ANTES de darlo por bueno. Un respaldo no verificado
            // no es un respaldo.
            const verif = require('./verificarRespaldo').verificarBufferGz(_gz);
            if (!verif.ok) {
                console.error('[backup] ' + etiqueta + ': respaldo NO restaurable — ' + verif.error);
                const registro = cargarRegistro();
                registro.ultimo_backup_db = new Date().toISOString();
                registro.ultimo_backup_db_ok = false;
                guardarRegistro(registro);
                return false;   // checkBackupReciente alertará; mejor no enviar basura
            }
            const cif = cifrarSiAplica(_gz);
            if (cif.omitir) {
                // Fail-closed: no mandamos NINGUNA BD en claro. Registramos el fallo
                // (checkBackupReciente alertará por >36h) y encolamos aviso YA.
                console.error('[backup] DBs NO enviadas (cifrado requerido): ' + cif.motivo);
                _alertarCifradoBackup(cif.motivo);
                const registro = cargarRegistro();
                registro.ultimo_backup_db = new Date().toISOString();
                registro.ultimo_backup_db_ok = false;
                guardarRegistro(registro);
                return false;
            }
            adjuntos.push({ nombre: etiqueta + '_' + fecha + '.db' + cif.ext, data: cif.buf });
            console.log('[backup] ' + etiqueta + ' comprimida' + (cif.ext === '.gz.enc' ? ' + CIFRADA' : '') + ': ' + (cif.buf.length / 1024).toFixed(0) + ' KB');
        }
        const ok = await enviarBackup(adjuntos, 'Backup DB (' + adjuntos.length + ' tienda' + (adjuntos.length > 1 ? 's' : '') + ') - ' + fecha);
        console.log(ok ? '[backup] OK ' + adjuntos.length + ' DB(s) enviadas a ' + DEST_MAIL : '[backup] ERROR DB fallo');
        // Antes no había ningún registro persistido de si el backup de DB
        // (el más importante — es la única copia fuera del servidor) corrió
        // o falló; stockWatcher.checkBackupReciente() depende de este campo
        // para alertar si pasan >36h sin un backup exitoso.
        const registro = cargarRegistro();
        registro.ultimo_backup_db = new Date().toISOString();
        registro.ultimo_backup_db_ok = ok;
        guardarRegistro(registro);
        return ok;
    } catch(e) { console.error('[backup] Error DB:', e.message); return false; }
}

// ── Backup imagenes nuevas (11:30 AM) ─────────────────────────────
async function runBackupImagenes() {
    const fecha = new Date().toISOString().slice(0, 10);
    console.log('[backup] Iniciando backup imagenes -> ' + DEST_MAIL);
    try {
        const res = await comprimirImagenesNuevas();
        if (!res || !res.buffer) { console.log('[backup] Sin imagenes nuevas hoy'); return true; }
        const { buffer, archivosIncluidos, registro } = res;
        console.log('[backup] ' + archivosIncluidos.length + ' imagenes nuevas, ' + (buffer.length/1024).toFixed(0) + ' KB');
        const ok = await enviarBackup(
            [{ nombre: 'imagenes_clientes_' + fecha + '.gz', data: buffer }],
            'Backup Imagenes Julio Cepeda - ' + fecha + ' (' + archivosIncluidos.length + ' nuevas)'
        );
        if (ok) {
            registro.enviados = [...new Set([...(registro.enviados || []), ...archivosIncluidos])];
            registro.ultimo_backup = new Date().toISOString();
            if (fs.existsSync(IMG_DIR)) {
                const enDisco = new Set(fs.readdirSync(IMG_DIR));
                registro.enviados = registro.enviados.filter(f => enDisco.has(f));
            }
            guardarRegistro(registro);
            console.log('[backup] OK imagenes enviadas a ' + DEST_MAIL + ' --- ' + registro.enviados.length + ' en registro');
        } else {
            console.error('[backup] ERROR imagenes --- se reintentara manana');
        }
        return ok;
    } catch(e) { console.error('[backup] Error imagenes:', e.message); return false; }
}

// ── runBackup: ambos (para backup manual) ─────────────────────────
async function runBackup() {
    const okDB = await runBackupDB();
    console.log('[backup] Esperando 30s antes de enviar imagenes...');
    await new Promise(r => setTimeout(r, 30_000));
    const okImg = await runBackupImagenes();
    return okDB && okImg;
}

// ── Scheduler: DB a las 11:00, imagenes a las 11:30 ───────────────
function msPara(hora, minuto) {
    const ahora = new Date();
    const obj   = new Date(ahora);
    obj.setHours(hora, minuto, 0, 0);
    if (obj <= ahora) obj.setDate(obj.getDate() + 1);
    return obj.getTime() - ahora.getTime();
}

function agendarBackup() {
    const msDB  = msPara(11, 0);
    const msImg = msPara(11, 30);

    setTimeout(() => {
        runBackupDB().catch(e => console.error('[backup] Error DB:', e.message));
        setInterval(() => runBackupDB().catch(e => console.error('[backup]', e.message)), 24*60*60_000);
    }, msDB);

    setTimeout(() => {
        runBackupImagenes().catch(e => console.error('[backup] Error img:', e.message));
        setInterval(() => runBackupImagenes().catch(e => console.error('[backup]', e.message)), 24*60*60_000);
    }, msImg);

    console.log('[backup] DB programada en ' + Math.round(msDB/60_000) + ' min (11:00 AM) -> ' + DEST_MAIL);
    console.log('[backup] Imagenes programadas en ' + Math.round(msImg/60_000) + ' min (11:30 AM) -> ' + DEST_MAIL);
}

// ── Ejecucion ──────────────────────────────────────────────────────
if (require.main === module) {
    const arg = process.argv[2];
    if      (arg === 'db')       runBackupDB().then(ok => process.exit(ok ? 0 : 1));
    else if (arg === 'imagenes') runBackupImagenes().then(ok => process.exit(ok ? 0 : 1));
    else                         runBackup().then(ok => process.exit(ok ? 0 : 1));
} else {
    agendarBackup();
}

module.exports = { runBackup, runBackupDB, runBackupImagenes, agendarBackup };
