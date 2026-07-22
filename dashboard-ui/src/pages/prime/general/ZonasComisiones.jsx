// ZonasComisiones.jsx — Zonas de cobertura (ISP/servicio local) + % de
// comisión por vendedor. CPs uno por línea; vacío = sin restricción de zona
// en el bot. Extraído de GeneralTab.jsx (mismo comportamiento, sin cambios).
import { useEffect, useState } from 'react';
import { api } from '../../../api';

export function ZonasComisiones() {
  const [zonas, setZonas] = useState('');
  const [pct, setPct] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    api.get('/api/zonas-cobertura').then(z => Array.isArray(z) && setZonas(z.map(x => x.cp).join('\n'))).catch(() => {});
    api.get('/api/comisiones').then(c => c && setPct(String(c.comision_pct ?? 0))).catch(() => {});
  }, []);
  const guardar = async () => {
    try {
      const r = await api.post('/api/zonas-cobertura', { cps: zonas.split(/\s|,|;/).filter(Boolean) });
      const r2 = await api.post('/api/comisiones/config', { pct: Number(pct) || 0 });
      if (!r.ok || !r2.ok) throw new Error(r.error || r2.error);
      setMsg({ ok: true, t: `Guardado: ${r.zonas} CP(s) de cobertura · comisión ${r2.pct}%` });
    } catch (e) { setMsg({ ok: false, t: e.message }); }
  };
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Cobertura por zona y comisiones (ISP / venta por cambaceo)</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 10 }}>
        Si cargas CPs, el bot solo vende/agenda en esas zonas (vacío = sin restricción).
        La comisión se calcula sobre lo cobrado por cada vendedor (reporte en Métricas).
      </p>
      <textarea rows={4} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}
        placeholder={'78000\n78010\n78020  (un CP por línea)'} value={zonas} onChange={e => setZonas(e.target.value)} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <label style={{ fontSize: 12 }}>Comisión por venta (%):</label>
        <input type="number" min="0" max="50" step="0.5" value={pct} onChange={e => setPct(e.target.value)} style={{ width: 80 }} />
        <button className="btn btn-primary" onClick={guardar}>Guardar</button>
        {msg && <span style={{ fontSize: 12, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</span>}
      </div>
    </div>
  );
}
