'use strict';
// verificarRespaldo — comprueba que un respaldo de BD es RESTAURABLE (comité #12):
// lo descomprime/descifra a un archivo scratch, lo abre y corre integrity_check,
// foreign_key_check, presencia de tablas críticas y el invariante contable
// (SUM(debe)=SUM(haber)). Es la diferencia entre "mandé un .gz" y "tengo un
// respaldo que sí restaura".
//
// Uso CLI:  node scripts/verificarRespaldo.js <archivo.db|.gz|.gz.enc>
//           (para .gz.enc usa la clave del modo 'bajo': backup_key_wrapped +
//            .instancia_secret, o BACKUP_KEY_HEX del modo alto)
// Uso desde backup.js: verificarBufferGz(gzBuf) antes de enviar.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

const TABLAS_CRITICAS = ['configuracion', 'clientes', 'pedidos', 'productos', 'usuarios', 'asientos', 'asientos_detalle', 'links_pago'];

// Verifica un buffer con el contenido CRUDO de la BD (ya descomprimido).
function verificarBufferDb(dbBuf) {
    const Database = require('better-sqlite3');
    const scratch = path.join(os.tmpdir(), 'verif_respaldo_' + process.pid + '_' + Date.now() + '.db');
    try {
        fs.writeFileSync(scratch, dbBuf);
        const d = new Database(scratch, { readonly: true });
        try {
            const integ = d.pragma('integrity_check', { simple: true });
            if (integ !== 'ok') return { ok: false, error: 'integrity_check: ' + integ };
            const fk = d.pragma('foreign_key_check').length;
            const faltantes = TABLAS_CRITICAS.filter(t =>
                !d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
            if (faltantes.length) return { ok: false, error: 'tablas críticas faltantes: ' + faltantes.join(', ') };
            // invariante contable: el mayor cuadra (si hay asientos)
            const m = d.prepare('SELECT ROUND(COALESCE(SUM(debe),0),2) de, ROUND(COALESCE(SUM(haber),0),2) ha FROM asientos_detalle').get();
            if (Math.abs(m.de - m.ha) > 0.02) return { ok: false, error: 'mayor descuadrado en el respaldo: debe ' + m.de + ' vs haber ' + m.ha };
            const pedidos = d.prepare('SELECT COUNT(*) n FROM pedidos').get().n;
            return { ok: true, fk_violaciones: fk, pedidos, debe: m.de, haber: m.ha };
        } finally { try { d.close(); } catch (_) {} }
    } catch (e) {
        return { ok: false, error: e.message };
    } finally {
        for (const s of ['', '-wal', '-shm']) { try { fs.rmSync(scratch + s, { force: true }); } catch (_) {} }
    }
}

// Verifica el artefacto que backup.js envía: un gzip de la BD.
function verificarBufferGz(gzBuf) {
    try { return verificarBufferDb(zlib.gunzipSync(gzBuf)); }
    catch (e) { return { ok: false, error: 'gunzip falló (¿archivo corrupto?): ' + e.message }; }
}

// Resuelve la clave de descifrado igual que backup.js (modo bajo/alto).
function _claveDescifrado() {
    try {
        if (process.env.BACKUP_KEY_HEX) return Buffer.from(process.env.BACKUP_KEY_HEX, 'hex');
        const db = require('../bot/db_connection');
        const wrapped = db.prepare("SELECT valor FROM configuracion WHERE clave='backup_key_wrapped'").get()?.valor;
        if (!wrapped) return null;
        const secreto = fs.readFileSync(process.env.INSTANCIA_SECRET_PATH || path.join(__dirname, '..', 'dashboard', '.instancia_secret'), 'utf8').trim();
        return require('../services/cryptoBackup').desenvolverConSecreto(wrapped, secreto);
    } catch (_) { return null; }
}

function verificarArchivo(ruta) {
    let buf = fs.readFileSync(ruta);
    if (ruta.endsWith('.gz.enc') || ruta.endsWith('.enc')) {
        const key = _claveDescifrado();
        if (!key) return { ok: false, error: 'respaldo cifrado y sin clave (BACKUP_KEY_HEX o backup_key_wrapped)' };
        try { buf = require('../services/cryptoBackup').descifrar(buf, key); }
        catch (e) { return { ok: false, error: 'descifrado falló: ' + e.message }; }
    }
    // tras descifrar, un .gz.enc queda como .gz; un .gz se descomprime directo
    if (ruta.endsWith('.gz') || ruta.endsWith('.enc')) return verificarBufferGz(buf);
    return verificarBufferDb(buf);
}

module.exports = { verificarBufferDb, verificarBufferGz, verificarArchivo, TABLAS_CRITICAS };

// ── CLI ──────────────────────────────────────────────────────────────
if (require.main === module) {
    const ruta = process.argv[2];
    if (!ruta || !fs.existsSync(ruta)) {
        console.error('Uso: node scripts/verificarRespaldo.js <archivo.db|.gz|.gz.enc>');
        process.exit(2);
    }
    const r = verificarArchivo(path.resolve(ruta));
    if (r.ok) {
        console.log('✅ Respaldo RESTAURABLE — integrity ok, tablas críticas presentes, mayor cuadra'
            + ' (' + r.pedidos + ' pedidos, FK violaciones: ' + r.fk_violaciones + ')');
        process.exit(0);
    }
    console.error('❌ Respaldo NO restaurable: ' + r.error);
    process.exit(1);
}
