// Lector de CFDI (factura electrónica MX, XML 3.3/4.0): extrae emisor,
// total, conceptos y UUID para cargar la factura al sistema (proveedor +
// CxP + asiento) sin captura manual. Sin dependencias: el CFDI trae los
// datos como ATRIBUTOS XML y se extraen directo.
'use strict';

function _attr(bloque, nombre) {
    // \s antes del nombre: que "Total" no matchee dentro de "SubTotal"
    const m = bloque.match(new RegExp('[\\s]' + nombre + '\\s*=\\s*"([^"]*)"', 'i'));
    return m ? m[1] : null;
}
function _bloque(xml, tag) {
    const m = xml.match(new RegExp('<[a-zA-Z0-9]*:?' + tag + '\\b[^>]*>', 'i'));
    return m ? m[0] : '';
}

function parsearCFDI(xml) {
    const s = String(xml || '');
    // Anti-DoS (auditoría de seguridad): tope de tamaño, sin DOCTYPE/ENTITY
    // (XXE / billion-laughs) y tope de conceptos (ReDoS del regex global).
    if (s.length > 5 * 1024 * 1024) throw new Error('XML demasiado grande (>5MB)');
    if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw new Error('XML con DOCTYPE/ENTITY no permitido');
    if (!/Comprobante/i.test(s)) throw new Error('El archivo no parece un CFDI (falta nodo Comprobante)');
    const comprobante = _bloque(s, 'Comprobante');
    const emisor = _bloque(s, 'Emisor');
    const timbre = _bloque(s, 'TimbreFiscalDigital');

    const conceptos = [];
    const reConcepto = /<[a-zA-Z0-9]*:?Concepto\b[^>]*>/gi;
    let m;
    while ((m = reConcepto.exec(s)) !== null) {
        if (conceptos.length >= 1000) throw new Error('CFDI con demasiados conceptos (>1000)');
        conceptos.push({
            descripcion: _attr(m[0], 'Descripcion') || '',
            cantidad: parseFloat(_attr(m[0], 'Cantidad')) || 1,
            valor_unitario: parseFloat(_attr(m[0], 'ValorUnitario')) || 0,
            importe: parseFloat(_attr(m[0], 'Importe')) || 0,
            clave_prod_serv: _attr(m[0], 'ClaveProdServ') || null,
            no_identificacion: _attr(m[0], 'NoIdentificacion') || null, // SKU/UPC del proveedor
        });
    }

    const total = parseFloat(_attr(comprobante, 'Total'));
    if (!(total > 0)) throw new Error('CFDI sin Total válido');

    return {
        uuid: _attr(timbre, 'UUID'),
        fecha: (_attr(comprobante, 'Fecha') || '').slice(0, 10) || null,
        folio: _attr(comprobante, 'Folio'),
        serie: _attr(comprobante, 'Serie'),
        subtotal: parseFloat(_attr(comprobante, 'SubTotal')) || null,
        total,
        moneda: _attr(comprobante, 'Moneda') || 'MXN',
        emisor_rfc: _attr(emisor, 'Rfc'),
        emisor_nombre: _attr(emisor, 'Nombre') || _attr(emisor, 'nombre') || 'Proveedor CFDI',
        conceptos,
    };
}

module.exports = { parsearCFDI };
