import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fdate } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import { useTextoEmoji } from '../context/EmojiContext';

const ESTATUS = ['solicitada', 'aprobada', 'rechazada', 'resuelta'];

export default function Devoluciones() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState('');
  const [rechazo, setRechazo] = useState(null);
  const [notas, setNotas] = useState('');

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['devoluciones', filtro],
    queryFn: () => api.get('/api/devoluciones' + (filtro ? '?estatus=' + filtro : '')),
  });

  const actualizarMutation = useMutation({
    mutationFn: ({ id, estatus, notasVal }) => api.put(`/api/devoluciones/${id}`, { estatus, notas: notasVal ?? null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devoluciones'] }),
    onError: (e) => { handleApiError(e); queryClient.invalidateQueries({ queryKey: ['devoluciones'] }); },
  });

  const cambiarEstatus = (id, estatus) => {
    if (estatus === 'rechazada') { setRechazo(id); setNotas(''); return; }
    actualizarMutation.mutate({ id, estatus });
  };

  const confirmarRechazo = () => {
    actualizarMutation.mutate({ id: rechazo, estatus: 'rechazada', notasVal: notas });
    setRechazo(null); setNotas('');
  };

  return (
    <div>
      <div className="page-title">Devoluciones</div>
      <div className="page-sub">Solicitudes de devolución de clientes</div>
      {error && <div className="login-error">No se pudieron cargar las devoluciones: {error.message}</div>}

      <div className="card">
        <div className="card-header">
          <h3>{txt('↩️ Devoluciones')}</h3>
          <div className="actions">
            <select value={filtro} onChange={e => setFiltro(e.target.value)}>
              <option value="">Todas</option>
              <option value="solicitada">Solicitadas</option>
              <option value="aprobada">Aprobadas</option>
              <option value="rechazada">Rechazadas</option>
              <option value="resuelta">Resueltas</option>
            </select>
            <button className="btn btn-secondary btn-sm" onClick={() => refetch()}>🔄</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Motivo</th><th>Estatus</th><th>Fecha</th><th>Cambiar estatus</th></tr></thead>
            <tbody>
              {rows === undefined && <tr><td colSpan={6} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={6} className="empty">Sin devoluciones</td></tr>}
              {rows?.map(r => (
                <tr key={r.id}>
                  <td><code>{r.folio || `#${r.id_pedido}`}</code></td>
                  <td>{r.cliente || '-'}</td>
                  <td style={{ fontSize: 12 }}>{r.motivo || '-'}</td>
                  <td><Badge value={r.estatus} map="devolucion" /></td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.creada_en)}</td>
                  <td>
                    <select value={r.estatus} onChange={e => cambiarEstatus(r.id, e.target.value)}>
                      {ESTATUS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {rechazo && (
        <Modal title="Motivo de rechazo" onClose={() => setRechazo(null)}
          actions={<>
            <button className="btn btn-secondary" onClick={() => setRechazo(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={confirmarRechazo}>Aceptar</button>
          </>}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>Explica brevemente por qué se rechaza (se le enviará al cliente)</p>
          <input autoFocus placeholder="Ej: producto fuera de garantía" value={notas} onChange={e => setNotas(e.target.value)} style={{ width: '100%' }} />
        </Modal>
      )}
    </div>
  );
}
