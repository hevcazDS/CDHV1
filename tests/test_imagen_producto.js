'use strict';
// tests/test_imagen_producto.js — fotos de producto locales + WebP (P0 de
// AUDITORIA_FOTOS.md). Pinnea el resolvedor ambivalente (URL externa vs archivo
// local), el guardado desde base64, el anti-traversal del servido y que enviar
// por WhatsApp use la copia de transporte, no el webp (sticker). No depende de
// cwebp (en dev conserva el original; la lógica es la misma).
//   node --test tests/test_imagen_producto.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const imgP = require('../services/imagenProducto');

// PNG 1x1 válido en base64
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const creados = [];

test('esExterna: http = externa; nombre local = no', () => {
    assert.strictEqual(imgP.esExterna('https://cdn.x/a.jpg'), true);
    assert.strictEqual(imgP.esExterna('http://x/a.png'), true);
    assert.strictEqual(imgP.esExterna('12_1699999999.webp'), false);
    assert.strictEqual(imgP.esExterna(''), false);
});

test('guardarBase64: escribe el archivo y devuelve un basename válido', async () => {
    const nombre = await imgP.guardarBase64(77, PNG_1x1, 'image/png');
    creados.push(nombre);
    assert(/^77_\d+\.(webp|png)$/.test(nombre), 'basename: ' + nombre);
    // el archivo de transporte (png) siempre existe; el webp solo si sharp convirtió
    const base = nombre.replace(/\.[^.]+$/, '');
    const hayTransporte = fs.existsSync(path.join(imgP.DIR, base + '.png'));
    const hayWebp = fs.existsSync(path.join(imgP.DIR, base + '.webp'));
    assert(hayTransporte || hayWebp, 'debe existir al menos un archivo');
});

test('rutaLocal: valida nombre y bloquea traversal', () => {
    assert.strictEqual(imgP.rutaLocal('../../etc/passwd'), null);
    assert.strictEqual(imgP.rutaLocal('no_valido.txt'), null);
    assert.strictEqual(imgP.rutaLocal('12_1.exe'), null);
    // un archivo real recién creado sí resuelve
    assert(imgP.rutaLocal(creados[0]), 'el archivo creado debe resolver');
});

test('rutaWhatsapp: externa→null; local→copia de transporte (nunca sticker webp)', () => {
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

test('guardarBase64 rechaza vacío y basura', async () => {
    // guardarBase64 es async ahora (sharp) -- un throw síncrono adentro se
    // vuelve un rechazo de la promesa, no un throw síncrono de la llamada.
    await assert.rejects(() => imgP.guardarBase64(1, '', 'image/png'));
    await assert.rejects(() => imgP.guardarBase64(1, 'AA', 'image/png'));
});

test('construirMedia: local→fromFilePath, externa→fromUrl, vacío→null', async () => {
    const MM = { fromFilePath: (p) => ({ via: 'file', p }), fromUrl: async (u) => ({ via: 'url', u }) };
    assert.strictEqual(await imgP.construirMedia(MM, ''), null);
    assert.strictEqual(await imgP.construirMedia(MM, null), null);
    const ext = await imgP.construirMedia(MM, 'https://cdn.x/a.jpg');
    assert(ext && ext.via === 'url', 'externa por fromUrl');
    const loc = await imgP.construirMedia(MM, creados[0]);
    assert(loc && loc.via === 'file', 'local por fromFilePath');
});

test('cotización: enviarFotos manda las fotos de los ítems (hasta 3, salta sin foto)', async () => {
    const cotBot = require('../services/cotizacionBot');
    const mockDb = { prepare: () => ({ get: (id) => id === 5 ? { name: 'Peluche', url_imagen: 'https://x/a.jpg' } : (id === 6 ? { name: 'Bici', url_imagen: '' } : null) }) };
    const enviadas = [];
    const mockClient = { sendMessage: async (u, m, o) => enviadas.push(o.caption) };
    const MM = { fromUrl: async (u) => ({ url: u }), fromFilePath: (p) => ({ p }) };
    const cot = { items_json: JSON.stringify([{ id: 5, name: 'Peluche' }, { id: 6 }, { id: 99 }]) };
    const n = await cotBot.enviarFotos(cot, mockClient, 'u@c.us', mockDb, MM);
    assert.strictEqual(n, 1, 'solo el ítem con foto');
    assert(/Peluche/.test(enviadas[0]));
    // sin client o sin MessageMedia → 0, no revienta
    assert.strictEqual(await cotBot.enviarFotos(cot, null, 'u', mockDb, MM), 0);
});

test('borrar: elimina los archivos locales (no-op en externas)', () => {
    imgP.borrar('https://cdn.x/a.jpg'); // no revienta
    imgP.borrar(creados[0]);
    assert.strictEqual(imgP.rutaLocal(creados[0]), null, 'ya no existe tras borrar');
});

test.after(() => {
    for (const n of creados) { try { imgP.borrar(n); } catch (_) {} }   // limpieza
});
