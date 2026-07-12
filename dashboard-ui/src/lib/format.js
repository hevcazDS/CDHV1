export function fmt(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Monto con símbolo — fuente única (antes había ~10 `const money` locales
// idénticos + fmtMoneda). Usa fmt (es-MX, 2 decimales) para el formato.
export function money(n) {
  return '$' + fmt(n);
}

export function fdate(s) {
  return s ? String(s).slice(0, 16).replace('T', ' ') : '-';
}

export function soloTelefono(s) {
  return (s || '').replace(/@.*/, '');
}
