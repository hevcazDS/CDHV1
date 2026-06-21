import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmt, fdate } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Badge from '../components/Badge';
import Modal from '../components/Modal';

const ESTATUS = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'];

export default function Pedidos() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [ticket, setTicket] = useState(null);
  const [pagoModal, setPagoModal] = useState(null);
  const [referencia, setReferencia] = useState('');

  const cargar = () => {
    api.get('/api/pedidos').then(setRows).catch(e => setError(e.message));
  };
  useEffect(cargar, []);

  const cambiarEstatus = async (id, estatus) => {
    if (estatus === 'cancelado' && !window.confirm('¿Cancelar este pedido? Se notificará al cliente.')) { cargar(); return; }
    try { await api.put(`/api/pedidos/${id}`, { estatus }); cargar(); }
    catch (e) { handleApiError(e); cargar(); }
  };

  const abrirTicket = async (idPedido) => {
    try { setTicket(await api.get(`/api/pedidos/${idPedido}/ticket`)); }
    catch (e) { handleApiError(e, 'No se pudo cargar el ticket'); }
  };

  const confirmarPago = async () => {
    if (!referencia.trim()) return;
    try {
      await api.post(`/api/pagos/${pagoModal}/marcar-pagado`, { referencia_pago: referencia });
      setPagoModal(null); setReferencia(''); cargar();
    } catch (e) { handleApiError(e); }
  };

  const exportarCSV = () => {
    if (!rows?.length) return;
    const filas = rows.map(r => [
      r.folio || `#${r.id_pedido}`, r.cliente || '-', fmt(r.total), r.pago_estatus || '-',
      r.estatus, r.numero_guia || '-', r.fecha_entrega_est || '-',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = 'Folio,Cliente,Total,Pago,Estatus,Guia,Entrega\n' + filas.join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `pedidos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div>
      <div className="page-title">Pedidos</div>
      <div className="page-sub">Pedidos recientes (últimos 100)</div>
      {error && <div className="login-error">No se pudieron cargar los pedidos: {error}</div>}

      <div className="card">
        <div className="card-header">
          <h3>📦 Pedidos recientes</h3>
          <div className="actions">
            <button className="btn btn-secondary btn-sm" onClick={exportarCSV}>⬇️ CSV</button>
            <button className="btn btn-secondary btn-sm" onClick={cargar}>🔄</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Folio</th><th>Cliente</th><th>Total</th><th>Pago</th><th>Estatus</th><th>Guía</th><th>Entrega est.</th><th></th></tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={8} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={8} className="empty">Sin pedidos</td></tr>}
              {rows?.map(r => (
                <tr key={r.id_pedido}>
                  <td><code>{r.folio || `#${r.id_pedido}`}</code></td>
                  <td>{r.cliente || '-'}</td>
                  <td><strong>${fmt(r.total)}</strong></td>
                  <td><Badge value={r.pago_estatus} map="pago" /></td>
                  <td>
                    <select value={r.estatus} onChange={e => cambiarEstatus(r.id_pedido, e.target.value)}>
                      {ESTATUS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ fontSize: 11 }}>{r.numero_guia ? <code>{r.numero_guia}</code> : '-'}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{r.fecha_entrega_est || '-'}</td>
                  <td>
                    {r.pago_estatus === 'generado' && r.id_link_pago && (
                      <button className="btn btn-success btn-sm" title="Confirmar pago recibido" onClick={() => setPagoModal(r.id_link_pago)}>✅</button>
                    )}
                    <button className="btn btn-secondary btn-sm" title="Ver ticket" onClick={() => abrirTicket(r.id_pedido)}>🧾</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {ticket && (
        <Modal title={`Ticket — ${ticket.pedido.folio || '#' + ticket.pedido.id_pedido}`} onClose={() => setTicket(null)}
          actions={<button className="btn btn-primary" onClick={() => setTicket(null)}>Cerrar</button>}>
          <div style={{ fontSize: 12, marginBottom: 8 }}><strong>Cliente:</strong> {ticket.pedido.cliente || '-'}</div>
          {(ticket.items || []).length
            ? ticket.items.map((it, i) => (
                <div className="modal-row" key={i}>
                  <span>{it.name || `Producto #${it.id_producto}`} x{it.cantidad}</span>
                  <span>${fmt(it.subtotal_linea)}</span>
                </div>
              ))
            : <div className="text-muted">Sin productos</div>}
          <div className="modal-row"><span>Envío</span><span>${fmt(ticket.envio ? ticket.envio.costo_envio : 0)}</span></div>
          <div className="modal-row total"><span>Total</span><span>${fmt(ticket.pedido.total)}</span></div>
          {ticket.pago?.referencia_pago && (
            <div className="text-muted" style={{ marginTop: 6 }}>Referencia de pago: {ticket.pago.referencia_pago}</div>
          )}
        </Modal>
      )}

      {pagoModal && (
        <Modal title="Confirmar pago recibido" onClose={() => { setPagoModal(null); setReferencia(''); }}
          actions={<>
            <button className="btn btn-secondary" onClick={() => { setPagoModal(null); setReferencia(''); }}>Cancelar</button>
            <button className="btn btn-primary" onClick={confirmarPago}>Confirmar</button>
          </>}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>Captura la referencia del pago (efectivo, transferencia, etc.)</p>
          <input autoFocus placeholder="Ej: TRANSF-00123" value={referencia} onChange={e => setReferencia(e.target.value)} style={{ width: '100%' }} />
        </Modal>
      )}
    </div>
  );
}
