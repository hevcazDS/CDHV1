import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Badge from '../components/Badge';
import { useTextoEmoji } from '../context/EmojiContext';

const TABS = [
  { key: 'en_espera', label: '🚨 En espera' },
  { key: 'atendida', label: '🗣️ Atendidas' },
  { key: 'resuelta', label: '✅ Resueltas' },
];

export default function ColaAtencion() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('en_espera');

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['cola-atencion', tab],
    queryFn: () => api.get('/api/cola_atencion?estatus=' + tab),
  });

  const marcarMutation = useMutation({
    mutationFn: ({ id, estatus }) => api.put(`/api/cola_atencion/${id}`, { estatus }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cola-atencion'] }),
    onError: (e) => handleApiError(e),
  });
  const marcar = (id, estatus) => marcarMutation.mutate({ id, estatus });

  return (
    <div>
      <div className="page-title">Cola de atención</div>
      <div className="page-sub">Clientes escalados a un asesor humano</div>
      {error && <div className="login-error">No se pudo cargar la cola: {error.message}</div>}

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.key)}>
            {txt(t.label)}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{txt('🚨 Cola de atención humana')}</h3>
          <div className="actions">
            <button className="btn btn-secondary btn-sm" onClick={() => refetch()}>🔄</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th>Teléfono</th><th>Motivo</th><th>Prioridad</th><th>Estatus</th><th>Desde</th><th></th></tr></thead>
            <tbody>
              {rows === undefined && <tr><td colSpan={7} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={7} className="empty">Sin clientes en este estatus</td></tr>}
              {rows?.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.cliente || '-'}</strong></td>
                  <td><code style={{ fontSize: 11 }}>{soloTelefono(r.telefono)}</code></td>
                  <td style={{ fontSize: 12 }}>{r.motivo_escalada || '-'}</td>
                  <td>{r.prioridad || 0}</td>
                  <td><Badge value={r.estatus} map="cola" /></td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.creada_en)}</td>
                  <td>
                    {r.estatus === 'en_espera' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => marcar(r.id, 'atendida')}>{txt('🗣️ Atender')}</button>
                    )}
                    {r.estatus === 'atendida' && (
                      <>
                        <button className="btn btn-success btn-sm" onClick={() => marcar(r.id, 'resuelta')}>{txt('✅ Resolver')}</button>{' '}
                        <button className="btn btn-secondary btn-sm" onClick={() => marcar(r.id, 'en_espera')}>{txt('↩️ Reabrir')}</button>
                      </>
                    )}
                    {r.estatus === 'resuelta' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => marcar(r.id, 'en_espera')}>{txt('↩️ Reabrir')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
