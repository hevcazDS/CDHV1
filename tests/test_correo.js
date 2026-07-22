'use strict';
// tests/test_correo.js — módulo de correo (Fase A: envío con adjuntos). Pinnea la
// construcción del MIME (multipart/mixed con adjuntos base64; multipart/alternative
// sin ellos) y el flujo de la ruta (gate por módulo, registro en 'enviados',
// stub de envío para no mandar correo real).  node --test tests/test_correo.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearFixture } = require('./fixture_min');
process.env.DB_PATH = crearFixture();
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';

const db = require('../bot/db_connection');
const email = require('../services/emailService');

test('MIME sin adjuntos = multipart/alternative (texto + html)', () => {
    const { body } = email._construirMime({ from: 'a@x', to: 'b@y', subject: 'Hola', html: '<b>hi</b>', adjuntos: [] });
    assert(/Content-Type: multipart\/alternative/.test(body));
    assert(!/multipart\/mixed/.test(body));
    assert(/Content-Type: text\/html/.test(body) && /Content-Type: text\/plain/.test(body));
    // asunto en base64 RFC2047
    assert(body.includes('Subject: =?UTF-8?B?' + Buffer.from('Hola').toString('base64')));
});

test('MIME con adjuntos = multipart/mixed { alternative, adjunto }', () => {
    const data = Buffer.from('archivo binario de prueba');
    const { body } = email._construirMime({ from: 'a@x', to: 'b@y', subject: 'Con PDF', html: '<b>hi</b>',
        adjuntos: [{ nombre: 'cotizacion.pdf', tipo: 'application/pdf', data }] });
    assert(/Content-Type: multipart\/mixed/.test(body), 'mixed en el exterior');
    assert(/Content-Type: multipart\/alternative/.test(body), 'alternative anidado');
    assert(/Content-Disposition: attachment; filename="cotizacion.pdf"/.test(body));
    assert(body.includes(data.toString('base64')), 'el adjunto va en base64');
});

test('MIME: nombre de adjunto no permite inyección de headers (CRLF)', () => {
    const { body } = email._construirMime({ from: 'a@x', to: 'b@y', subject: 's', html: 'h',
        adjuntos: [{ nombre: 'malo"\r\nBcc: hacker@x', tipo: 'text/plain', data: Buffer.from('x') }] });
    // el CRLF se quita → NO se puede crear una línea de header nueva 'Bcc:'
    assert(!/^Bcc:/m.test(body), 'sin header Bcc inyectado (CRLF removido)');
    assert(!/\r\nBcc:/.test(body), 'sin salto que abra un header');
});

test('ruta: módulo apagado → 403', () => {
    const { enviarPost } = require('../dashboard/routes/correo')._test;
    const out = {};
    const ctx = { db, json: (r, d, c) => { out.d = d; out.code = c || 200; }, readJson: (req, res, cb) => cb(req._body), log: { debug() {} } };
    enviarPost({ _body: { to: 'x@y', asunto: 'a', cuerpo: 'b' } }, null, ctx, { ses: { username: 'g' } });
    assert.strictEqual(out.code, 403);
});

test('ruta: módulo ON + envío OK (stub) → registra en enviados con meta de adjunto', async () => {
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('correo_activo','1')").run();
    // stub del envío real y de isConfigured (no tocar SMTP en el test)
    const _envReal = email.enviarCorreo, _cfgReal = email.isConfigured;
    let enviado = null;
    email.enviarCorreo = async (o) => { enviado = o; return { ok: true }; };
    email.isConfigured = () => true;
    try {
        const { enviarPost } = require('../dashboard/routes/correo')._test;
        const out = {};
        const ctx = { db, json: (r, d, c) => { out.d = d; out.code = c || 200; }, readJson: (req, res, cb) => cb(req._body), log: { debug() {} } };
        await enviarPost({ _body: { to: 'cliente@x.com', asunto: 'Tu cotización', cuerpo: 'Adjunto va',
            adjuntos_manuales: [{ nombre: 'nota.txt', tipo: 'text/plain', base64: Buffer.from('hola').toString('base64') }] } }, null, ctx, { ses: { username: 'gerente1' } });
        assert(out.d.ok && out.d.adjuntos === 1, JSON.stringify(out.d));
        assert(enviado && enviado.to === 'cliente@x.com' && enviado.adjuntos.length === 1);
        const fila = db.prepare("SELECT para, asunto, adjuntos_json FROM correos WHERE direccion='saliente' ORDER BY id DESC LIMIT 1").get();
        assert(fila.para === 'cliente@x.com' && /nota\.txt/.test(fila.adjuntos_json));
    } finally { email.enviarCorreo = _envReal; email.isConfigured = _cfgReal; }
});

test('ruta: sincronizar con módulo apagado → 403', () => {
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('correo_activo','0')").run();
    const { sincronizarPost } = require('../dashboard/routes/correo')._test;
    const out = {};
    const ctx = { db, json: (r, d, c) => { out.d = d; out.code = c || 200; } };
    sincronizarPost({}, null, ctx, {});
    assert.strictEqual(out.code, 403);
});

test('bandeja: lista entrantes y config cuenta los no leídos', () => {
    db.prepare("INSERT INTO correos (direccion, uid, de, asunto, cuerpo, adjuntos_json, leido, fecha) VALUES ('entrante', 7, 'x@y', 'Hola', '<p>hi</p>', '[]', 0, datetime('now'))").run();
    const { bandejaGet, configGet } = require('../dashboard/routes/correo')._test;
    let bandeja, cfg;
    bandejaGet(null, null, { db, json: (r, d) => { bandeja = d; } });
    configGet(null, null, { db, json: (r, d) => { cfg = d; } });
    assert(bandeja.length >= 1 && bandeja[0].asunto === 'Hola');
    assert(cfg.sin_leer >= 1, 'config reporta no leídos');
});

test('secretos: cifra/descifra round-trip y deja pasar texto plano', () => {
    const s = require('../services/secretos');
    const clave = 'abcd efgh ijkl mnop';
    const cif = s.cifrarSecreto(clave);
    assert(cif.startsWith('enc:'), 'se cifra con prefijo enc:');
    assert.strictEqual(s.descifrarSecreto(cif), clave, 'descifra al original');
    assert.strictEqual(s.descifrarSecreto('texto plano'), 'texto plano', 'legacy/claro pasa igual');
});

test('ruta: descargar adjunto con módulo apagado → 403', () => {
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('correo_activo','0')").run();
    const { adjuntoGet } = require('../dashboard/routes/correo')._test;
    const out = {};
    adjuntoGet({}, null, { db, json: (r, d, c) => { out.code = c || 200; } }, { params: ['1', '0'] });
    assert.strictEqual(out.code, 403);
});

after(() => {
    try { require('fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
});
