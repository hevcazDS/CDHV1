// F5.3 — helper reusable de reportes imprimibles. Abre una ventana con encabezado
// del negocio/sucursal + tabla + totales y dispara print() del navegador (PDF sin
// dependencias). Cualquier reporte (corte de caja, libros, OC, entradas,
// transferencias) le pasa columnas + filas ya cargadas — no hay lógica nueva.
//
// columnas: [{ key, label, num?, render?(fila) }]  ó  ['col1','col2'] (key=label)
// totales: [{ label, valor, num? }] (pie, opcional)
const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function imprimirReporte({ titulo, subtitulo, columnas, filas, totales }) {
  const cols = columnas.map(c => (typeof c === 'string' ? { key: c, label: c } : c));
  const th = cols.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
  const trs = (filas || []).map(f => `<tr>${cols.map(c => {
    const v = typeof c.render === 'function' ? c.render(f) : f[c.key];
    return `<td${c.num ? ' class="num"' : ''}>${esc(v)}</td>`;
  }).join('')}</tr>`).join('');
  const pie = (totales && totales.length)
    ? `<tfoot>${totales.map(t => `<tr><td colspan="${cols.length - 1}" class="tot">${esc(t.label)}</td><td class="num tot">${esc(t.valor)}</td></tr>`).join('')}</tfoot>`
    : '';
  const w = window.open('', '_blank', 'width=900,height=900');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>
      body{font-family:system-ui,Arial,sans-serif;max-width:900px;margin:24px auto;color:#111;font-size:12px}
      h1{font-size:18px;margin:0 0 2px} .sub{color:#555;margin:0 0 14px;font-size:12px}
      table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left}
      th{border-bottom:2px solid #111;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
      .num{text-align:right;font-variant-numeric:tabular-nums} .tot{font-weight:700;border-top:2px solid #111}
      .foot{margin-top:18px;color:#777;font-size:10px}
      @media print{body{margin:0}}
    </style></head><body>
    <h1>${esc(titulo)}</h1><p class="sub">${esc(subtitulo || '')}</p>
    <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody>${pie}</table>
    <p class="foot">Generado ${esc(new Date().toLocaleString('es-MX'))} · documento interno, no es un comprobante fiscal.</p>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
