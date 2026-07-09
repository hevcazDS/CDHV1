// Comprobante de facturación (Bloque 2B). No es CFDI timbrado: es un
// comprobante con datos fiscales + número de referencia (= folio del pedido)
// para que el cliente solicite su factura. Regla del negocio: solo se puede
// facturar dentro del mes contable en curso.
export const LEYENDA_FACTURACION =
  'COMPROBANTE — no es una factura fiscal (CFDI) timbrada. Para tu factura, ' +
  'solicítala con esta referencia dentro del mes contable en curso; no se ' +
  'podrá facturar en meses posteriores.';

// ¿El pedido/venta trae datos fiscales (= el cliente quiere factura)?
export function quiereFactura(p) {
  return !!((p?.razon_social && String(p.razon_social).trim()) || (p?.rfc && String(p.rfc).trim()));
}
