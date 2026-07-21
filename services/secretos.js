'use strict';
// secretos — cifrado en reposo de credenciales guardadas en `configuracion`
// (clave de aplicación de correo, y a futuro cualquier secreto por-instancia).
// Formato 'enc:' + AES (services/cryptoBackup) con clave derivada del secreto
// por-instancia (dashboard/.instancia_secret, 0600). descifrarSecreto es
// tolerante: un valor SIN prefijo 'enc:' se devuelve tal cual (claro/legacy),
// así los secretos guardados en texto plano antes siguen funcionando.
// ponytail: pacService/gatewayService tienen esta MISMA lógica duplicada; este
// es el hogar canónico — migrarlos aquí cuando se toquen (no antes del deploy).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cb = require('./cryptoBackup');

function _instSecret() {
    const p = process.env.INSTANCIA_SECRET_PATH || path.join(__dirname, '..', 'dashboard', '.instancia_secret');
    try { return fs.readFileSync(p, 'utf8').trim(); }
    catch (_) {
        try { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(p, s, { mode: 0o600 }); return s; }
        catch (_) { return null; }
    }
}
function _key() { const s = _instSecret(); return s ? crypto.createHash('sha256').update(s).digest() : null; }

function cifrarSecreto(texto) {
    const k = _key(); if (!k || texto == null || texto === '') return String(texto ?? '');
    try { return 'enc:' + cb.cifrar(Buffer.from(String(texto), 'utf8'), k).toString('base64'); } catch (_) { return String(texto); }
}
function descifrarSecreto(v) {
    if (typeof v !== 'string' || !v.startsWith('enc:')) return v; // claro / legacy
    const k = _key(); if (!k) return '';
    try { return cb.descifrar(Buffer.from(v.slice(4), 'base64'), k).toString('utf8'); } catch (_) { return ''; }
}

module.exports = { cifrarSecreto, descifrarSecreto };
