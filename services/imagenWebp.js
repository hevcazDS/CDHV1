// Convierte una imagen recién guardada a WebP con `sharp` (bundlea libvips,
// sin binario externo del sistema — antes usaba el `cwebp` de apt vía
// execFileSync, que bloqueaba el event loop del bot hasta 15s por conversión
// y dependía de un binario frágil). De paso, redimensiona a un máximo
// razonable (el bot antes guardaba fotos de cliente a resolución completa
// de cámara sin ninguna necesidad).
'use strict';
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const CALIDAD = 78; // calidad visual alta con ~60-80% menos peso que JPEG
const MAX_LADO = 1600; // px — tope razonable para ver en panel/WhatsApp, no cámara completa

// Recibe la ruta absoluta del archivo recién escrito. Si convierte, borra el
// original y devuelve el nombre nuevo (basename .webp); si no, null.
async function convertirAWebp(rutaOriginal) {
    const ext = path.extname(rutaOriginal).toLowerCase();
    if (ext === '.webp' || ext === '.gif') return null; // ya óptimo / animado
    const rutaWebp = rutaOriginal.replace(/\.[^.]+$/, '.webp');
    try {
        await sharp(rutaOriginal)
            .resize({ width: MAX_LADO, height: MAX_LADO, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: CALIDAD })
            .toFile(rutaWebp);
        const st = await fs.promises.stat(rutaWebp).catch(() => null);
        if (st && st.size > 0) {
            await fs.promises.unlink(rutaOriginal).catch(() => {});
            return path.basename(rutaWebp);
        }
    } catch (_) {
        try { await fs.promises.unlink(rutaWebp); } catch (_) {}
    }
    return null;
}

module.exports = { convertirAWebp };
