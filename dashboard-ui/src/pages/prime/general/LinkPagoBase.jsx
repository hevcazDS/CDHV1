// LinkPagoBase.jsx — Link de pago base del negocio (su Clip/Mercado
// Pago/PayPal.me) que el bot y el POS envían por WhatsApp cuando el módulo
// Link de pago está activo. Extraído de GeneralTab.jsx, sin cambios de comportamiento.
import { useEffect, useState } from 'react';
import { api } from '../../../api';

export function LinkPagoBase() {
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.get('/api/prime/pago-url').then(d => setUrl(d.pago_url_base || '')).catch(() => {}); }, []);
  const guardar = async () => {
    try { const r = await api.put('/api/prime/pago-url', { pago_url_base: url }); if (!r.ok) throw new Error(r.error); setMsg({ ok: true, t: 'Guardado' }); }
    catch (e) { setMsg({ ok: false, t: e.message }); }
  };
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Link de pago</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 8 }}>
        Pega aquí tu link de cobro (Clip, Mercado Pago, PayPal.me…). El bot y el POS lo enviarán al cliente por WhatsApp con la referencia del pedido.
        Cuando integres un gateway con API, este campo se reemplaza por links dinámicos por pedido.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="url" placeholder="https://mpago.la/tu-link" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={guardar}>Guardar</button>
      </div>
      {msg && <p style={{ fontSize: 12, marginTop: 6, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </div>
  );
}
