// Convierte una imagen recién guardada a WebP con el binario `cwebp` del
// sistema (paquete apt `webp` en el Dockerfile — cero dependencias npm).
// En Windows de desarrollo normalmente no hay cwebp: se conserva el archivo
// original y no pasa nada — el ahorro de espacio importa en el servidor.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CALIDAD = '78'; // calidad visual alta con ~60-80% menos peso que JPEG

// Recibe la ruta absoluta del archivo recién escrito. Si convierte, borra el
// original y devuelve el nombre nuevo (basename .webp); si no, null.
function convertirAWebp(rutaOriginal) {
    const ext = path.extname(rutaOriginal).toLowerCase();
    if (ext === '.webp' || ext === '.gif') return null; // ya óptimo / animado
    const rutaWebp = rutaOriginal.replace(/\.[^.]+$/, '.webp');
    try {
        execFileSync('cwebp', ['-quiet', '-q', CALIDAD, rutaOriginal, '-o', rutaWebp], { timeout: 15000 });
        if (fs.existsSync(rutaWebp) && fs.statSync(rutaWebp).size > 0) {
            fs.unlinkSync(rutaOriginal);
            return path.basename(rutaWebp);
        }
    } catch (_) {
        try { if (fs.existsSync(rutaWebp)) fs.unlinkSync(rutaWebp); } catch (_) {}
    }
    return null;
}

module.exports = { convertirAWebp };
