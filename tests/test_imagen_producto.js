'use strict';
// tests/test_imagen_producto.js — fotos de producto locales + WebP (P0 de
// AUDITORIA_FOTOS.md). Pinnea el resolvedor ambivalente (URL externa vs archivo
// local), el guardado desde base64, el anti-traversal del servido y que enviar
// por WhatsApp use la copia de transporte, no el webp (sticker). No depende de
// cwebp (en dev conserva el original; la lógica es la misma).
//   node tests/test_imagen_producto.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const imgP = require('../services/imagenProducto');
let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('✅ ' + n); };

// PNG 1x1 válido en base64
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const creados = [];

t('esExterna: http = externa; nombre local = no', () => {
    assert.strictEqual(imgP.esExterna('https://cdn.x/a.jpg'), true);
    assert.strictEqual(imgP.esExterna('http://x/a.png'), true);
    assert.strictEqual(imgP.esExterna('12_1699999999.webp'), false);
    assert.strictEqual(imgP.esExterna(''), false);
});

t('guardarBase64: escribe el archivo y devuelve un basename válido', () => {
    const nombre = imgP.guardarBase64(77, PNG_1x1, 'image/png');
    creados.push(nombre);
    assert(/^77_\d+\.(webp|png)$/.test(nombre), 'basename: ' + nombre);
    // el archivo de transporte (png) siempre existe; el webp solo si hay cwebp
    const base = nombre.replace(/\.[^.]+$/, '');
    const hayTransporte = fs.existsSync(path.join(imgP.DIR, base + '.png'));
    const hayWebp = fs.existsSync(path.join(imgP.DIR, base + '.webp'));
    assert(hayTransporte || hayWebp, 'debe existir al menos un archivo');
});

t('rutaLocal: valida nombre y bloquea traversal', () => {
    assert.strictEqual(imgP.rutaLocal('../../etc/passwd'), null);
    assert.strictEqual(imgP.rutaLocal('no_valido.txt'), null);
    assert.strictEqual(imgP.rutaLocal('12_1.exe'), null);
    // un archivo real recién creado sí resuelve
    assert(imgP.rutaLocal(creados[0]), 'el archivo creado debe resolver');
});

t('rutaWhatsapp: externa→null; local→copia de transporte (nunca sticker webp)', () => {
    assert.strictEqual(imgP.rutaWhatsapp('https://cdn.x/a.jpg'), null, 'externa usa fromUrl');
    // un local jpg/png resuelve a sí mismo
    const r = imgP.rutaWhatsapp(creados[0]);
    assert(r && fs.existsSync(r), 'transporte local existe: ' + r);
    // un webp huérfano (sin hermano jpg/png) → null (no mandar sticker)
    const huerfano = '99_' + Date.now() + '.webp';
    fs.writeFileSync(path.join(imgP.DIR, huerfano), Buffer.from('RIFF....WEBP'));
    creados.push(huerfano);
    assert.strictEqual(imgP.rutaWhatsapp(huerfano), null, 'webp sin transporte → null');
});

t('guardarBase64 rechaza vacío y basura', () => {
    assert.throws(() => imgP.guardarBase64(1, '', 'image/png'));
    assert.throws(() => imgP.guardarBase64(1, 'AA', 'image/png'));
});

t('borrar: elimina los archivos locales (no-op en externas)', () => {
    imgP.borrar('https://cdn.x/a.jpg'); // no revienta
    imgP.borrar(creados[0]);
    assert.strictEqual(imgP.rutaLocal(creados[0]), null, 'ya no existe tras borrar');
});

// limpieza
for (const n of creados) { try { imgP.borrar(n); } catch (_) {} }
console.log('\n' + ok + '/6 OK — fotos de producto: resolvedor ambivalente + WebP + anti-traversal + transporte WhatsApp.');
process.exit(ok === 6 ? 0 : 1);
