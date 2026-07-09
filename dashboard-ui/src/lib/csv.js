// Exportar cualquier tabla ya cargada en la página a CSV (Excel lo abre
// directo por el BOM). filas = array de objetos o arrays.
export function exportarCSV(nombre, encabezados, filas) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [encabezados.map(esc).join(',')];
  for (const f of filas) lineas.push((Array.isArray(f) ? f : Object.values(f)).map(esc).join(','));
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre.endsWith('.csv') ? nombre : nombre + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
