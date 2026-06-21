import { useState } from 'react';
import { api } from '../api';
import { useTextoEmoji } from '../context/EmojiContext';

export default function Beta() {
  const txt = useTextoEmoji();
  const [codigo, setCodigo] = useState('');
  const [telefono, setTelefono] = useState('');
  const [msg, setMsg] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(false);

  const resetBeta = async () => {
    if (!codigo || !telefono) { setMsg({ ok: false, texto: 'Completa código y teléfono' }); return; }
    if (!window.confirm('¿Eliminar todos los datos de prueba de este número?')) return;
    try {
      const r = await api.post('/api/beta/limpiar', { codigo, telefono });
      setMsg(r.ok ? { ok: true, texto: '✅ Datos eliminados correctamente' } : { ok: false, texto: '❌ ' + r.error });
    } catch (e) { setMsg({ ok: false, texto: '❌ ' + e.message }); }
  };

  const verHealth = async () => {
    try { setHealth(await api.get('/health')); setHealthError(false); }
    catch (_) { setHealth(null); setHealthError(true); }
  };

  return (
    <div>
      <div className="page-title">Beta / Pruebas</div>
      <div className="page-sub">Herramientas de prueba y diagnóstico del sistema</div>

      <div className="kpi-grid">
        <div className="card">
          <div className="card-header"><h3>{txt('🧪 Reset betatestor')}</h3></div>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 14 }}>Limpia datos de prueba de un número específico.</p>
          <div className="login-field">
            <label>Código de reset</label>
            <input type="password" placeholder="Código secreto" value={codigo} onChange={e => setCodigo(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Teléfono del betatestor</label>
            <input placeholder="5214441234567" value={telefono} onChange={e => setTelefono(e.target.value)} />
          </div>
          <button className="btn btn-danger" onClick={resetBeta}>{txt('🗑️ Limpiar datos de prueba')}</button>
          {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginTop: 14 }}>{txt(msg.texto)}</div>}
        </div>

        <div className="card">
          <div className="card-header"><h3>{txt('🔍 Diagnóstico del sistema')}</h3></div>
          <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 10 }} onClick={verHealth}>Verificar /health</button>
          {!health && !healthError && <div className="empty">Presiona el botón para verificar</div>}
          {healthError && <div className="login-error">No se pudo conectar</div>}
          {health && <pre style={{ fontSize: 11, background: 'var(--panel-2)', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(health, null, 2)}</pre>}
        </div>
      </div>
    </div>
  );
}
