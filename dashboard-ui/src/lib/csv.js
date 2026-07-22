// Exportar cualquier tabla ya cargada en la página a CSV (Excel lo abre
// directo por el BOM). filas = array de objetos o arrays.
export function exportarCSV(nombre, encabezados, filas) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    // Mitigación de inyección de fórmulas CSV: si el valor (p.ej. el nombre
    // de un cliente, texto libre desde WhatsApp) empieza con =, +, - o @,
    // Excel/Sheets lo interpreta como fórmula al abrir el export. Un `'`
    // inicial fuerza texto literal sin alterar el valor visible.
    if (/^[=+\-@]/.test(s.trim())) s = "'" + s;
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
