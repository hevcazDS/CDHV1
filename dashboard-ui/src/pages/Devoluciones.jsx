import { useEffect, useState } from 'react';
import { api } from '../api';
import { fdate } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Badge from '../components/Badge';
import Modal from '../components/Modal';

const ESTATUS = ['solicitada', 'aprobada', 'rechazada', 'resuelta'];

export default function Devoluciones() {
  const [filtro, setFiltro] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [rechazo, setRechazo] = useState(null);
  const [notas, setNotas] = useState('');

  const cargar = (f) => {
    const q = f ?? filtro;
    api.get('/api/devoluciones' + (q ? '?estatus=' + q : '')).then(setRows).catch(e => setError(e.message));
  };
  useEffect(() => { cargar(''); }, []);

  const actualizar = async (id, estatus, notasVal) => {
    try { await api.put(`/api/devoluciones/${id}`, { estatus, notas: notasVal ?? null }); cargar(); }
    catch (e) { handleApiError(e); cargar(); }
  };

  const cambiarEstatus = (id, estatus) => {
    if (estatus === 'rechazada') { setRechazo(id); setNotas(''); return; }
    actualizar(id, estatus);
  };

  const confirmarRechazo = () => {
    actualizar(rechazo, 'rechazada', notas);
    setRechazo(null); setNotas('');
  };

  return (
    <div>
      <div className="page-title">Devoluciones</div>
      <div className="page-sub">Solicitudes de devolución de clientes</div>
      {error && <div className="login-error">No se pudieron cargar las devoluciones: {error}</div>}

      <div className="card">
        <div className="card-header">
          <h3>↩️ Devoluciones</h3>
          <div className="actions">
            <select value={filtro} onChange={e => { setFiltro(e.target.value); cargar(e.target.value); }}>
              <option value="">Todas</option>
              <option value="solicitada">Solicitadas</option>
              <option value="aprobada">Aprobadas</option>
              <option value="rechazada">Rechazadas</option>
              <option value="resuelta">Resueltas</option>
            </select>
            <button className="btn btn-secondary btn-sm" onClick={() => cargar()}>🔄</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Motivo</th><th>Estatus</th><th>Fecha</th><th>Cambiar estatus</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="empty">Cargando...</td></tr>}
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
