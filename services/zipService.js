'use strict';
// zipService.js — ZIP mínimo en modo STORE (sin compresión), sin dependencias.
// Usa el CRC32 nativo de Node (zlib.crc32, Node ≥ 20/22). Suficiente para
// empaquetar los CFDI del baúl contable en un .zip descargable. No comprime
// (los XML son chicos y así el código queda diminuto y verificable).
const zlib = require('zlib');

function _u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0, 0); return b; }
function _u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

// archivos: [{ nombre: 'a.xml', contenido: Buffer|string }] → Buffer (.zip)
function crearZip(archivos) {
    const locales = [];
    const centrales = [];
    let offset = 0;
    for (const a of archivos) {
        const nombre = Buffer.from(String(a.nombre), 'utf8');
        const datos = Buffer.isBuffer(a.contenido) ? a.contenido : Buffer.from(String(a.contenido), 'utf8');
        const crc = zlib.crc32 ? zlib.crc32(datos) : 0;
        // Local file header (0x04034b50)
        const lh = Buffer.concat([
            _u32(0x04034b50), _u16(20), _u16(0), _u16(0) /*store*/, _u16(0), _u16(0),
            _u32(crc), _u32(datos.length), _u32(datos.length), _u16(nombre.length), _u16(0), nombre,
        ]);
        locales.push(lh, datos);
        // Central directory record (0x02014b50)
        centrales.push(Buffer.concat([
            _u32(0x02014b50), _u16(20), _u16(20), _u16(0), _u16(0) /*store*/, _u16(0), _u16(0),
            _u32(crc), _u32(datos.length), _u32(datos.length), _u16(nombre.length), _u16(0), _u16(0),
            _u16(0), _u16(0), _u32(0), _u32(offset), nombre,
        ]));
        offset += lh.length + datos.length;
    }
    const cd = Buffer.concat(centrales);
    const eocd = Buffer.concat([
        _u32(0x06054b50), _u16(0), _u16(0), _u16(archivos.length), _u16(archivos.length),
        _u32(cd.length), _u32(offset), _u16(0),
    ]);
    return Buffer.concat([...locales, cd, eocd]);
}

module.exports = { crearZip };
