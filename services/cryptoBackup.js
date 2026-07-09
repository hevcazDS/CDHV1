// Núcleo de cifrado de respaldos (portable Node — corre en server, Electron
// y el futuro paquete móvil). Master Password → PBKDF2 → clave AES-256-GCM.
//
// DOS MODOS (togglable por el dueño, ver configuracion.backup_cifrado_modo):
//   'alto': la maestra NO se guarda. Se deriva la clave (PBKDF2 + salt) y se
//           MUESTRA una vez para que el dueño la apunte/fotografíe; la clave
//           vive solo en memoria (armar()) y se re-deriva con la maestra al
//           reiniciar. Si se pierde la maestra Y la clave impresa → los
//           respaldos son irrecuperables (por diseño).
//   'bajo': una clave aleatoria se guarda en la BD (cifrada con el secreto de
//           instancia). Recuperable, menos seguro, y cifra sin intervención.
//
// El almacén seguro nativo (Android Keystore / iOS Keychain / Secure Enclave)
// es el enganche para cuando se empaquete a móvil — hoy la clave 'alto' vive
// en la RAM del proceso, que es su equivalente portable.
'use strict';
const crypto = require('crypto');

const PBKDF2_ITER = 210000;      // OWASP 2023 para SHA-256
const KEYLEN = 32;               // AES-256

// Deriva una clave de 32 bytes desde la maestra + salt.
function derivar(masterPassword, saltHex) {
    const salt = Buffer.from(saltHex, 'hex');
    return crypto.pbkdf2Sync(String(masterPassword), salt, PBKDF2_ITER, KEYLEN, 'sha256');
}
function nuevoSalt() { return crypto.randomBytes(16).toString('hex'); }
function nuevaClave() { return crypto.randomBytes(KEYLEN); }

// Cifra un Buffer con AES-256-GCM. Salida: [iv(12)][tag(16)][cipher].
function cifrar(buf, key) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]);
}
function descifrar(blob, key) {
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const enc = blob.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]); // lanza si la clave/tag no cuadran
}

// Envolver/desenvolver la clave del modo 'bajo' con el secreto de instancia
// (así la clave guardada en la BD no viaja utilizable a otro servidor).
function envolverConSecreto(keyBuf, instanciaSecret) {
    const k = crypto.createHash('sha256').update(String(instanciaSecret)).digest();
    return cifrar(keyBuf, k).toString('base64');
}
function desenvolverConSecreto(b64, instanciaSecret) {
    const k = crypto.createHash('sha256').update(String(instanciaSecret)).digest();
    return descifrar(Buffer.from(b64, 'base64'), k);
}

// Clave armada en memoria (modo 'alto') — vive solo en el proceso del
// dashboard y se borra al reiniciar (hay que re-armar con la maestra).
let _armada = null;
function armar(keyBuf) { _armada = keyBuf; }
function claveArmada() { return _armada; }
function desarmar() { _armada = null; }

module.exports = { derivar, nuevoSalt, nuevaClave, cifrar, descifrar, envolverConSecreto, desenvolverConSecreto, armar, claveArmada, desarmar, PBKDF2_ITER };
