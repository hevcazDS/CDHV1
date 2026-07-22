'use strict';
// correoInbox — bandeja de ENTRADA (Fase B). Baja el correo del buzón de la
// tienda por IMAP (imapflow) y lo guarda en la tabla `correos` (direccion=
// 'entrante'), deduplicado por uid. La UI lee de SQLite, nunca habla IMAP.
// Credenciales: las MISMAS de la tienda en la BD (bot_email_usuario/password,
// Prime > General) — la misma clave de aplicación de Gmail que usa el envío.
// Falla cerrado: sin credenciales / sin red / sin dep → { ok:false, error }.
const { simpleParser } = require('mailparser');

const IMAP_HOST = process.env.IMAP_HOST || 'imap.gmail.com';
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);
const MAX_CUERPO = 60000;   // no guardamos correos gigantes enteros en SQLite

function _cfg(db, clave) {
    try {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        return (r && r.valor) ? r.valor : '';
    } catch (_) { return ''; }
}

function credenciales(db) {
    const { descifrarSecreto } = require('./secretos');
    return {
        user: _cfg(db, 'bot_email_usuario') || process.env.EMAIL_USER || '',
        // la clave se guarda cifrada; descifrarSecreto deja pasar lo que sea claro/legacy
        pass: descifrarSecreto(_cfg(db, 'bot_email_password') || process.env.EMAIL_PASS || ''),
    };
}
function configurado(db) { const c = credenciales(db); return !!(c.user && c.pass); }

// Baja los mensajes nuevos (uid mayor al último guardado; primera vez: últimos
// `limite`) y los inserta. Devuelve { ok, nuevos } o { ok:false, error }.
async function sincronizar(db, { limite = 40 } = {}) {
    const { user, pass } = credenciales(db);
    if (!user || !pass) return { ok: false, error: 'Configura el correo de la tienda (usuario + clave de aplicación) en Prime > General' };

    let ImapFlow;
    try { ({ ImapFlow } = require('imapflow')); }
    catch (_) { return { ok: false, error: 'Falta la dependencia imapflow (npm install imapflow mailparser)' }; }

    const cli = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true, auth: { user, pass }, logger: false });
    let nuevos = 0;
    try {
        await cli.connect();
        const lock = await cli.getMailboxLock('INBOX');
        try {
            // CAST a entero: `uid` es columna TEXT y algunos valores viejos quedaron
            // guardados como "99.0"/"100.0" (ver insert de abajo) — sin el CAST, MAX()
            // compara como STRING y "99.0" > "117.0" (el '9' inicial gana), así que el
            // sync se quedaba pegado desde uid 99 para siempre, re-bajando de más y sin
            // avanzar nunca al correo real más nuevo (bug reportado: "no baja los
            // últimos correos de hoy").
            const ultimo = db.prepare("SELECT MAX(CAST(uid AS INTEGER)) u FROM correos WHERE direccion='entrante'").get();
            const desde = ultimo && ultimo.u ? Number(ultimo.u) + 1 : null;
            // primera vez: los últimos `limite` por NÚMERO DE SECUENCIA (no UID:
            // en un buzón con huecos de UID, total-39:* en espacio UID bajaría
            // cientos — re-auditoría H7); después: lo nuevo por UID.
            let rango, porUid;
            if (desde) { rango = `${desde}:*`; porUid = true; }
            else { const total = cli.mailbox.exists || 0; rango = `${Math.max(1, total - limite + 1)}:*`; porUid = false; }

            const ins = db.prepare(`INSERT OR IGNORE INTO correos
                (direccion, uid, de, para, asunto, cuerpo, adjuntos_json, leido, fecha)
                VALUES ('entrante', ?,?,?,?,?,?, 0, ?)`);

            for await (const msg of cli.fetch(rango, { uid: true, source: true }, porUid ? { uid: true } : undefined)) {
                if (desde && Number(msg.uid) < desde) continue;
                let p;
                try { p = await simpleParser(msg.source); } catch (_) { continue; }
                const de = (p.from && p.from.text) || '';
                const para = (p.to && p.to.text) || user;
                const asunto = p.subject || '(sin asunto)';
                const cuerpo = (p.html || (p.textAsHtml || '') || (p.text ? '<pre>' + esc(p.text) + '</pre>' : '')).slice(0, MAX_CUERPO);
                const adj = (p.attachments || []).map(a => ({ nombre: a.filename || 'adjunto', tipo: a.contentType || '', tamano: a.size || 0 }));
                const fecha = (p.date instanceof Date ? p.date : new Date()).toISOString().slice(0, 19).replace('T', ' ');
                // Math.trunc (no solo Number()): imapflow puede traer el uid como valor
                // no estrictamente entero (BigInt/float) — sin truncar, better-sqlite3 lo
                // bindea como REAL y la columna TEXT lo guarda con sufijo ".0" (raíz del
                // bug de MAX(uid) de arriba). Truncado, siempre se guarda "99", no "99.0".
                const r = ins.run(Math.trunc(Number(msg.uid)), de.slice(0, 300), para.slice(0, 300), asunto.slice(0, 500), cuerpo, JSON.stringify(adj), fecha);
                if (r.changes) nuevos++;
            }
        } finally { lock.release(); }
        return { ok: true, nuevos };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    } finally {
        try { await cli.logout(); } catch (_) {}
    }
}

// Descarga UN adjunto ON-DEMAND (no lo guardamos nunca en el servidor): re-baja
// el mensaje por uid, lo parsea y devuelve el buffer del adjunto `idx`. El caller
// lo entrega al operador forzado como descarga (tipo neutro) — ver ruta.
async function descargarAdjunto(db, uid, idx) {
    const { user, pass } = credenciales(db);
    if (!user || !pass) return { ok: false, error: 'Sin credenciales de correo' };
    let ImapFlow;
    try { ({ ImapFlow } = require('imapflow')); }
    catch (_) { return { ok: false, error: 'Falta la dependencia imapflow' }; }
    const cli = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true, auth: { user, pass }, logger: false });
    try {
        await cli.connect();
        const lock = await cli.getMailboxLock('INBOX');
        try {
            // Trunca por si el uid quedó guardado con sufijo ".0" (correos sincronizados
            // antes del fix de arriba) — "117.0" no es un UID válido para IMAP, "117" sí.
            const msg = await cli.fetchOne(String(Math.trunc(Number(uid))), { uid: true, source: true }, { uid: true });
            if (!msg || !msg.source) return { ok: false, error: 'Correo no encontrado en el buzón' };
            const p = await simpleParser(msg.source);
            const a = (p.attachments || [])[Number(idx)];
            if (!a || !a.content) return { ok: false, error: 'Adjunto no encontrado' };
            const nombre = String(a.filename || 'adjunto').replace(/[\r\n"\\/]/g, '_').slice(0, 120);
            return { ok: true, nombre, contenido: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content) };
        } finally { lock.release(); }
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    } finally { try { await cli.logout(); } catch (_) {} }
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Sync con doble-gate (módulo ON + cuenta configurada) y fail-closed. Lo llaman
// el worker del bot y el proceso del dashboard; corren ambos si ambos están
// arriba (sin problema: INSERT OR IGNORE por uid deduplica). `log` es opcional.
async function syncSiActivo(db, log) {
    try {
        const on = db.prepare("SELECT valor FROM configuracion WHERE clave='correo_activo'").get()?.valor === '1';
        if (!on || !configurado(db)) return;
        const r = await sincronizar(db);
        if (r.ok && r.nuevos) log && log.info('correo: ' + r.nuevos + ' nuevo(s) en la bandeja');
        else if (!r.ok) log && log.debug('correo sync: ' + r.error);
    } catch (e) { log && log.debug('correo sync: ' + e.message); }
}

module.exports = { sincronizar, configurado, credenciales, descargarAdjunto, syncSiActivo };
