import { useEffect, useState } from 'react';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Badge from '../components/Badge';

const TABS = [
  { key: 'en_espera', label: '🚨 En espera' },
  { key: 'atendida', label: '🗣️ Atendidas' },
  { key: 'resuelta', label: '✅ Resueltas' },
];

export default function ColaAtencion() {
  const [tab, setTab] = useState('en_espera');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const cargar = () => {
    api.get('/api/cola_atencion?estatus=' + tab).then(setRows).catch(e => setError(e.message));
  };
  useEffect(cargar, [tab]);

  const marcar = async (id, estatus) => {
    try { await api.put(`/api/cola_atencion/${id}`, { estatus }); cargar(); }
    catch (e) { handleApiError(e); }
  };

  return (
    <div>
      <div className="page-title">Cola de atención</div>
      <div className="page-sub">Clientes escalados a un asesor humano</div>
      {error && <div className="login-error">No se pudo cargar la cola: {error}</div>}

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>🚨 Cola de atención humana</h3>
          <div className="actions">
            <button className="btn btn-secondary btn-sm" onClick={cargar}>🔄</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th>Teléfono</th><th>Motivo</th><th>Prioridad</th><th>Estatus</th><th>Desde</th><th></th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} className="empty">Cargando...</td></tr>}
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
                      <button className="btn btn-secondary btn-sm" onClick={() => marcar(r.id, 'atendida')}>🗣️ Atender</button>
                    )}
                    {r.estatus === 'atendida' && (
                      <>
                        <button className="btn btn-success btn-sm" onClick={() => marcar(r.id, 'resuelta')}>✅ Resolver</button>{' '}
                        <button className="btn btn-secondary btn-sm" onClick={() => marcar(r.id, 'en_espera')}>↩️ Reabrir</button>
                      </>
                    )}
                    {r.estatus === 'resuelta' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => marcar(r.id, 'en_espera')}>↩️ Reabrir</button>
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
