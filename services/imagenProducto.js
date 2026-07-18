'use strict';
// Fotos de PRODUCTO guardadas en el sistema (P0 de AUDITORIA_FOTOS.md).
// AMBIVALENTE: productos.url_imagen puede ser una URL externa (http…, las ligas
// que ya usa Julio Cepeda) O el basename de un archivo local en
// bot/imagenes_productos/. Se distingue por el valor → aditivo, JC intacto.
//
// Al subir un jpg/png se guardan DOS archivos con el mismo base:
//   · <base>.webp    → fuente ligera (panel/POS/catálogo; el navegador lo muestra
//                       nativo). Es lo que se guarda en url_imagen.
//   · <base>.jpg|png → copia de TRANSPORTE para WhatsApp: WhatsApp muestra un
//                       .webp como STICKER, no como foto con caption, así que al
//                       cliente se le manda el jpg/png.
// Sin cwebp (Windows dev) no hay webp: url_imagen apunta al jpg/png y todo sigue.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'bot', 'imagenes_productos');
// Mismo formato de nombre que imagenes_clientes: <numero>_<numero>.<ext>
const _RE_ARCHIVO = /^[0-9]+_[0-9]+\.(jpg|jpeg|png|webp)$/i;
const MAX_BYTES = 12 * 1024 * 1024;

function _asegurarDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) {} }

function esExterna(url) { return /^https?:\/\//i.test(String(url || '')); }

// Ruta local absoluta de un archivo de producto (valida nombre, anti-traversal).
// null si el nombre es inválido o el archivo no existe.
function rutaLocal(nombre) {
    if (!_RE_ARCHIVO.test(String(nombre || ''))) return null;
    const p = path.join(DIR, nombre);
    if (!p.startsWith(DIR) || !fs.existsSync(p)) return null;
    return p;
}

// Guarda una imagen de producto desde base64 (jpg/png). Devuelve el basename a
// almacenar en url_imagen (.webp si cwebp está disponible; si no, el original).
function guardarBase64(idProducto, base64, mimetype) {
    _asegurarDir();
    const ext = /png/i.test(mimetype || '') ? 'png' : 'jpg';
    const base = `${Number(idProducto) || 0}_${Date.now()}`;
    const rutaOrig = path.join(DIR, `${base}.${ext}`);
    const blob = Buffer.from(String(base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
    if (blob.length < 32) throw new Error('Imagen vacía o inválida');
    if (blob.length > MAX_BYTES) throw new Error('Imagen demasiado grande (máx 12 MB)');
    fs.writeFileSync(rutaOrig, blob);
    // Convertir a webp SIN borrar el original (el original es el transporte de WhatsApp).
    const rutaWebp = path.join(DIR, `${base}.webp`);
    try {
        execFileSync('cwebp', ['-quiet', '-q', '78', rutaOrig, '-o', rutaWebp], { timeout: 15000 });
        if (fs.existsSync(rutaWebp) && fs.statSync(rutaWebp).size > 0) return `${base}.webp`;
    } catch (_) {
        try { if (fs.existsSync(rutaWebp)) fs.unlinkSync(rutaWebp); } catch (_) {}
    }
    return `${base}.${ext}`; // sin cwebp: url_imagen apunta al original jpg/png
}

// Para enviar por WhatsApp: URL externa → null (el caller usa fromUrl); local →
// la copia jpg/png de transporte (NUNCA el webp, que se vería como sticker).
function rutaWhatsapp(url_imagen) {
    if (!url_imagen || esExterna(url_imagen)) return null;
    const ext = String(url_imagen).split('.').pop().toLowerCase();
    if (ext !== 'webp') return rutaLocal(url_imagen);       // ya es jpg/png local
    const base = String(url_imagen).replace(/\.[^.]+$/, '');
    for (const e of ['jpg', 'jpeg', 'png']) { const r = rutaLocal(`${base}.${e}`); if (r) return r; }
    return null;                                            // solo webp → no mandar sticker
}

// Construye el MessageMedia de whatsapp-web.js para una url_imagen (local o
// externa), listo para client.sendMessage. Local → fromFilePath (jpg/png de
// transporte); externa → fromUrl. null si no hay imagen enviable. Centraliza la
// resolución que usan menuFlow/cartFlow y las cotizaciones.
async function construirMedia(MessageMedia, url_imagen) {
    if (!MessageMedia || !url_imagen) return null;
    const local = rutaWhatsapp(url_imagen);
    if (local) return MessageMedia.fromFilePath(local);
    if (esExterna(url_imagen)) return await MessageMedia.fromUrl(url_imagen, { unsafeMime: true });
    return null;
}

// Borra los archivos (webp + transporte) de una imagen local. No-op si es URL.
function borrar(url_imagen) {
    if (!url_imagen || esExterna(url_imagen)) return;
    const base = String(url_imagen).replace(/\.[^.]+$/, '');
    for (const e of ['webp', 'jpg', 'jpeg', 'png']) {
        try { const r = path.join(DIR, `${base}.${e}`); if (r.startsWith(DIR) && fs.existsSync(r)) fs.unlinkSync(r); } catch (_) {}
    }
}

module.exports = { DIR, guardarBase64, esExterna, rutaLocal, rutaWhatsapp, construirMedia, borrar, _RE_ARCHIVO };
