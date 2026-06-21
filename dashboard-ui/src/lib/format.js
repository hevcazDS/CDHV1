export function fmt(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fdate(s) {
  return s ? String(s).slice(0, 16).replace('T', ' ') : '-';
}

export function soloTelefono(s) {
  return (s || '').replace(/@.*/, '');
}
