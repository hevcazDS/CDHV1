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

// Anti-fuerza-bruta del PIN (REVISION_SEGURIDAD M2): un PIN de 4-12 dígitos sin
// bloqueo es brute-forceable por un rol operativo autenticado. Se bloquea por
// usuario tras 5 fallos, con backoff creciente (30s × fallos-sobre-5, tope 5min).
const _fallos = new Map(); // username → { n, hasta }
const MAX_INTENTOS = 5;
// Poda horaria: sin esto el mapa crecería sin límite (una entrada por cada
// usuario que falle alguna vez el PIN). Se descartan las entradas ya expiradas
// hace >1h. unref() para no mantener vivo el proceso por este timer.
setInterval(() => {
    const ahora = Date.now();
    for (const [user, f] of _fallos) {
        if (!f.hasta || ahora > f.hasta + 3600_000) _fallos.delete(user);
    }
}, 3600_000).unref();
function _bloqueoRestante(user) {
    const f = _fallos.get(user);
    if (!f || !f.hasta) return 0;
    return Math.max(0, f.hasta - Date.now());
}
function _registrarFallo(user) {
    const f = _fallos.get(user) || { n: 0, hasta: 0 };
    f.n += 1;
    if (f.n >= MAX_INTENTOS) f.hasta = Date.now() + Math.min(300_000, 30_000 * (f.n - MAX_INTENTOS + 1));
    _fallos.set(user, f);
}

// Regla central: administrador+ opera sin PIN; especialistas lo requieren.
// Devuelve null si puede proceder, o un mensaje de error si no.
function exigirAutorizacion(db, ses, pin, rangoDe) {
    if (rangoDe(ses?.rol) >= 2) return null;
    if (!hayPin(db)) return 'Operación restringida: pide al administrador configurar el PIN de autorización (Módulos)';
    const user = ses?.username || '?';
    const restante = _bloqueoRestante(user);
    if (restante > 0) return `Demasiados intentos de PIN. Espera ${Math.ceil(restante / 1000)}s antes de reintentar.`;
    if (!validarPin(db, pin)) {
        _registrarFallo(user);
        return 'PIN de autorización incorrecto';
    }
    _fallos.delete(user); // éxito → limpia el contador
    return null;
}

module.exports = { setPin, hayPin, validarPin, exigirAutorizacion };
