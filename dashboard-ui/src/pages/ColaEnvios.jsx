import { useEffect, useState } from 'react';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Badge from '../components/Badge';

const TABS = [
  { key: 'pendientes', label: '⏳ Pendientes' },
  { key: 'programados', label: '🗓️ Programados' },
  { key: 'historial', label: '📋 Historial' },
];

export default function ColaEnvios() {
  const [tab, setTab] = useState('pendientes');
  const [cola, setCola] = useState(null);
  const [programados, setProgramados] = useState(null);
  const [historial, setHistorial] = useState(null);

  const cargarCola = () => api.get('/api/cola').then(setCola).catch(() => setCola({ items: [] }));
  const cargarProgramados = () => api.get('/api/cola/programados').then(setProgramados).catch(() => setProgramados([]));
  const cargarHistorial = () => api.get('/api/cola/historial').then(setHistorial).catch(() => setHistorial([]));

  useEffect(() => {
    if (tab === 'pendientes') cargarCola();
    if (tab === 'programados') cargarProgramados();
    if (tab === 'historial') cargarHistorial();
  }, [tab]);

  const reintentarTodo = async () => {
    try {
      const r = await api.post('/api/cola/reintentar', {});
      window.alert(`✅ ${r.reactivados || 0} mensajes reactivados`);
      cargarCola();
    } catch (e) { handleApiError(e); }
  };

  const reintentarUno = async (id) => {
    try { await api.post(`/api/cola/reintentar/${id}`, {}); cargarCola(); }
    catch (e) { handleApiError(e); }
  };

  const cancelarCampana = async (asunto, enviar_despues_de) => {
    if (!window.confirm('¿Cancelar esta campaña? Los mensajes pendientes no se enviarán.')) return;
    try {
      const r = await api.del('/api/cola/programados', { asunto, enviar_despues_de });
      window.alert(`✅ ${r.cancelados || 0} mensajes cancelados`);
      cargarProgramados();
    } catch (e) { handleApiError(e); }
  };

  return (
    <div>
      <div className="page-title">Cola de envíos</div>
      <div className="page-sub">Mensajes pendientes, campañas programadas e historial de notificaciones</div>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pendientes' && (
        <div className="card">
          <div className="card-header">
            <h3>⏳ Mensajes en cola</h3>
            <div className="actions">
              <button className="btn btn-secondary btn-sm" onClick={cargarCola}>🔄</button>
              <button className="btn btn-danger btn-sm" onClick={reintentarTodo}>♻️ Reintentar</button>
            </div>
          </div>
          {cola && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="badge badge-amarillo">⏳ {cola.pendientes || 0} pendientes</span>
              <span className="badge badge-rojo">❌ {cola.fallidas || 0} fallidas</span>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Destinatario</th><th>Asunto</th><th>Estatus</th><th>Intentos</th><th>Fecha</th><th></th></tr></thead>
              <tbody>
                {cola === null && <tr><td colSpan={7} className="empty">Cargando...</td></tr>}
                {cola?.items?.length === 0 && <tr><td colSpan={7} className="empty">Cola vacía</td></tr>}
                {cola?.items?.map(r => (
                  <tr key={r.id}>
                    <td><code>{r.id}</code></td>
                    <td><code style={{ fontSize: 11 }}>{soloTelefono(r.destinatario).slice(0, 15)}</code></td>
                    <td style={{ fontSize: 12 }}>{r.asunto || '-'}</td>
                    <td><Badge value={r.estatus} map="notif" /></td>
                    <td style={{ textAlign: 'center' }}>{r.intentos || 0}</td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.creada_en)}</td>
                    <td><button className="btn btn-secondary btn-sm" onClick={() => reintentarUno(r.id)}>♻️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'programados' && (
        <div className="card">
          <div className="card-header"><h3>🗓️ Campañas programadas</h3><div className="actions"><button className="btn btn-secondary btn-sm" onClick={cargarProgramados}>🔄</button></div></div>
          {programados === null && <div className="empty">Cargando...</div>}
          {programados?.length === 0 && <div className="empty">No hay campañas programadas</div>}
          {programados?.map((r, i) => (
            <div key={i} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 7, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.asunto || 'Sin asunto'}</div>
                  <div className="text-muted">📅 {r.enviar_despues_de ? fdate(r.enviar_despues_de) : '-'} · 👥 {r.total || 0} mensajes</div>
                  <div style={{ fontSize: 12, background: 'var(--panel-2)', padding: 6, borderRadius: 5, marginTop: 6, fontFamily: 'monospace' }}>
                    {(r.cuerpo_muestra || '').slice(0, 80)}
                  </div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => cancelarCampana(r.asunto, r.enviar_despues_de)}>🗑️ Cancelar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'historial' && (
        <div className="card">
          <div className="card-header"><h3>📋 Historial</h3><div className="actions"><button className="btn btn-secondary btn-sm" onClick={cargarHistorial}>🔄</button></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Destinatario</th><th>Asunto</th><th>Estatus</th><th>Intentos</th><th>Fecha</th></tr></thead>
              <tbody>
                {historial === null && <tr><td colSpan={5} className="empty">Cargando...</td></tr>}
                {historial?.length === 0 && <tr><td colSpan={5} className="empty">Sin historial</td></tr>}
                {historial?.map((r, i) => (
                  <tr key={i}>
                    <td><code style={{ fontSize: 11 }}>{soloTelefono(r.destinatario).slice(0, 15)}</code></td>
                    <td style={{ fontSize: 12 }}>{r.asunto || '-'}</td>
                    <td><Badge value={r.estatus} map="notif" /></td>
                    <td style={{ textAlign: 'center' }}>{r.intentos || 0}</td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.creada_en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
