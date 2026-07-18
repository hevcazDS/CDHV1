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
    return {
        user: _cfg(db, 'bot_email_usuario') || process.env.EMAIL_USER || '',
        pass: _cfg(db, 'bot_email_password') || process.env.EMAIL_PASS || '',
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
            const ultimo = db.prepare("SELECT MAX(uid) u FROM correos WHERE direccion='entrante'").get();
            const desde = ultimo && ultimo.u ? Number(ultimo.u) + 1 : null;
            // primera vez: solo los últimos `limite`; después: lo nuevo por uid
            let rango;
            if (desde) rango = `${desde}:*`;
            else { const total = cli.mailbox.exists || 0; rango = `${Math.max(1, total - limite + 1)}:*`; }

            const ins = db.prepare(`INSERT OR IGNORE INTO correos
                (direccion, uid, de, para, asunto, cuerpo, adjuntos_json, leido, fecha)
                VALUES ('entrante', ?,?,?,?,?,?, 0, ?)`);

            for await (const msg of cli.fetch(rango, { uid: true, source: true }, { uid: true })) {
                if (desde && Number(msg.uid) < desde) continue;
                let p;
                try { p = await simpleParser(msg.source); } catch (_) { continue; }
                const de = (p.from && p.from.text) || '';
                const para = (p.to && p.to.text) || user;
                const asunto = p.subject || '(sin asunto)';
                const cuerpo = (p.html || (p.textAsHtml || '') || (p.text ? '<pre>' + esc(p.text) + '</pre>' : '')).slice(0, MAX_CUERPO);
                const adj = (p.attachments || []).map(a => ({ nombre: a.filename || 'adjunto', tipo: a.contentType || '', tamano: a.size || 0 }));
                const fecha = (p.date instanceof Date ? p.date : new Date()).toISOString().slice(0, 19).replace('T', ' ');
                const r = ins.run(Number(msg.uid), de.slice(0, 300), para.slice(0, 300), asunto.slice(0, 500), cuerpo, JSON.stringify(adj), fecha);
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

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

module.exports = { sincronizar, configurado, credenciales };
