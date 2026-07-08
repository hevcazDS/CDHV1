// PIN de autorización de operaciones sensibles (cancelar venta, devolver,
// sacar/trasladar inventario). Lo configuran Administrador o Prime; los
// roles con rango menor deben teclearlo. PUNTO ÚNICO de validación: la
// futura autorización remota (bot → WhatsApp del administrador) se enchufa
// aquí sin tocar ninguna ruta.
'use strict';
const crypto = require('crypto');

const CLAVE_CFG = 'pin_autorizacion'; // configuracion: "salt:hash"

function setPin(db, pin) {
    const limpio = String(pin || '').trim();
    if (limpio.length < 4 || limpio.length > 12) throw new Error('El PIN debe tener entre 4 y 12 caracteres');
    const salt = crypto.randomBytes(8).toString('hex');
    const hash = crypto.scryptSync(limpio, salt, 32).toString('hex');
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now','localtime'))")
      .run(CLAVE_CFG, salt + ':' + hash);
}

function hayPin(db) {
    try { return !!db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(CLAVE_CFG)?.valor; }
    catch (_) { return false; }
}

function validarPin(db, pin) {
    const row = db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(CLAVE_CFG);
    if (!row?.valor) return false; // sin PIN configurado = nadie autoriza
    const [salt, hash] = row.valor.split(':');
    if (!salt || !hash) return false;
    const intento = crypto.scryptSync(String(pin || '').trim(), salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(intento), Buffer.from(hash));
}

// Regla central: administrador+ opera sin PIN; especialistas lo requieren.
// Devuelve null si puede proceder, o un mensaje de error si no.
function exigirAutorizacion(db, ses, pin, rangoDe) {
    if (rangoDe(ses?.rol) >= 2) return null;
    if (!hayPin(db)) return 'Operación restringida: pide al administrador configurar el PIN de autorización (Módulos)';
    if (!validarPin(db, pin)) return 'PIN de autorización incorrecto';
    return null;
}

module.exports = { setPin, hayPin, validarPin, exigirAutorizacion };
