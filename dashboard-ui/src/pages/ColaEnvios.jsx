import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Badge from '../components/Badge';
import { Emoji, useTextoEmoji } from '../context/EmojiContext';

const TABS = [
  { key: 'pendientes', label: '⏳ Pendientes' },
  { key: 'programados', label: '🗓️ Programados' },
  { key: 'historial', label: '📋 Historial' },
];

export default function ColaEnvios() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('pendientes');

  const { data: cola, refetch: refetchCola } = useQuery({
    queryKey: ['cola-envios'],
    queryFn: () => api.get('/api/cola'),
    enabled: tab === 'pendientes',
  });
  const { data: programados, refetch: refetchProgramados } = useQuery({
    queryKey: ['cola-programados'],
    queryFn: () => api.get('/api/cola/programados'),
    enabled: tab === 'programados',
  });
  const { data: historial, refetch: refetchHistorial } = useQuery({
    queryKey: ['cola-historial'],
    queryFn: () => api.get('/api/cola/historial'),
    enabled: tab === 'historial',
  });

  const reintentarTodoMutation = useMutation({
    mutationFn: () => api.post('/api/cola/reintentar', {}),
    onSuccess: (r) => {
      window.alert(txt(`✅ ${r.reactivados || 0} mensajes reactivados`));
      queryClient.invalidateQueries({ queryKey: ['cola-envios'] });
    },
    onError: (e) => handleApiError(e),
  });

  const reintentarUnoMutation = useMutation({
    mutationFn: (id) => api.post(`/api/cola/reintentar/${id}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cola-envios'] }),
    onError: (e) => handleApiError(e),
  });

  const cancelarCampanaMutation = useMutation({
    mutationFn: ({ asunto, enviar_despues_de }) => api.del('/api/cola/programados', { asunto, enviar_despues_de }),
    onSuccess: (r) => {
      window.alert(txt(`✅ ${r.cancelados || 0} mensajes cancelados`));
      queryClient.invalidateQueries({ queryKey: ['cola-programados'] });
    },
    onError: (e) => handleApiError(e),
  });
  const cancelarCampana = (asunto, enviar_despues_de) => {
    if (!window.confirm('¿Cancelar esta campaña? Los mensajes pendientes no se enviarán.')) return;
    cancelarCampanaMutation.mutate({ asunto, enviar_despues_de });
  };

  return (
    <div>
      <div className="page-title">Cola de envíos</div>
      <div className="page-sub">Mensajes pendientes, campañas programadas e historial de notificaciones</div>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.key)}>
            {txt(t.label)}
          </button>
        ))}
      </div>

      {tab === 'pendientes' && (
        <div className="card">
          <div className="card-header">
            <h3>{txt('⏳ Mensajes en cola')}</h3>
            <div className="actions">
              <button className="btn btn-secondary btn-sm" onClick={() => refetchCola()}>🔄</button>
              <button className="btn btn-danger btn-sm" onClick={() => reintentarTodoMutation.mutate()}>{txt('♻️ Reintentar')}</button>
            </div>
          </div>
          {cola && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="badge badge-amarillo"><Emoji>⏳ </Emoji>{cola.pendientes || 0} pendientes</span>
              <span className="badge badge-rojo"><Emoji>❌ </Emoji>{cola.fallidas || 0} fallidas</span>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Destinatario</th><th>Asunto</th><th>Estatus</th><th>Intentos</th><th>Fecha</th><th></th></tr></thead>
              <tbody>
                {cola === undefined && <tr><td colSpan={7} className="empty">Cargando...</td></tr>}
                {cola?.items?.length === 0 && <tr><td colSpan={7} className="empty">Cola vacía</td></tr>}
                {cola?.items?.map(r => (
                  <tr key={r.id}>
                    <td><code>{r.id}</code></td>
                    <td><code style={{ fontSize: 11 }}>{soloTelefono(r.destinatario).slice(0, 15)}</code></td>
                    <td style={{ fontSize: 12 }}>{r.asunto || '-'}</td>
                    <td><Badge value={r.estatus} map="notif" /></td>
                    <td style={{ textAlign: 'center' }}>{r.intentos || 0}</td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.creada_en)}</td>
                    <td><button className="btn btn-secondary btn-sm" onClick={() => reintentarUnoMutation.mutate(r.id)}>♻️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'programados' && (
        <div className="card">
          <div className="card-header"><h3>{txt('🗓️ Campañas programadas')}</h3><div className="actions"><button className="btn btn-secondary btn-sm" onClick={() => refetchProgramados()}>🔄</button></div></div>
          {programados === undefined && <div className="empty">Cargando...</div>}
          {programados?.length === 0 && <div className="empty">No hay campañas programadas</div>}
          {programados?.map((r, i) => (
            <div key={i} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 7, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.asunto || 'Sin asunto'}</div>
                  <div className="text-muted"><Emoji>📅 </Emoji>{r.enviar_despues_de ? fdate(r.enviar_despues_de) : '-'} · <Emoji>👥 </Emoji>{r.total || 0} mensajes</div>
                  <div style={{ fontSize: 12, background: 'var(--panel-2)', padding: 6, borderRadius: 5, marginTop: 6, fontFamily: 'monospace' }}>
                    {(r.cuerpo_muestra || '').slice(0, 80)}
                  </div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => cancelarCampana(r.asunto, r.enviar_despues_de)}>{txt('🗑️ Cancelar')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'historial' && (
        <div className="card">
          <div className="card-header"><h3>{txt('📋 Historial')}</h3><div className="actions"><button className="btn btn-secondary btn-sm" onClick={() => refetchHistorial()}>🔄</button></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Destinatario</th><th>Asunto</th><th>Estatus</th><th>Intentos</th><th>Fecha</th></tr></thead>
              <tbody>
                {historial === undefined && <tr><td colSpan={5} className="empty">Cargando...</td></tr>}
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
