import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table, Select, Button, TextInput } from '@mantine/core';
import { api } from '../api';
import { fmt, fdate } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import { useTextoEmoji } from '../context/EmojiContext';

const ESTATUS = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'];

export default function Pedidos() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [ticket, setTicket] = useState(null);
  const [pagoModal, setPagoModal] = useState(null);
  const [referencia, setReferencia] = useState('');

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['pedidos'],
    queryFn: () => api.get('/api/pedidos'),
  });

  const cambiarEstatusMutation = useMutation({
    mutationFn: ({ id, estatus }) => api.put(`/api/pedidos/${id}`, { estatus }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pedidos'] }),
    onError: (e) => { handleApiError(e); queryClient.invalidateQueries({ queryKey: ['pedidos'] }); },
  });
  const cambiarEstatus = (id, estatus) => {
    if (estatus === 'cancelado' && !window.confirm('¿Cancelar este pedido? Se notificará al cliente.')) { refetch(); return; }
    cambiarEstatusMutation.mutate({ id, estatus });
  };

  const abrirTicket = async (idPedido) => {
    try { setTicket(await api.get(`/api/pedidos/${idPedido}/ticket`)); }
    catch (e) { handleApiError(e, 'No se pudo cargar el ticket'); }
  };

  const confirmarPagoMutation = useMutation({
    mutationFn: () => api.post(`/api/pagos/${pagoModal}/marcar-pagado`, { referencia_pago: referencia }),
    onSuccess: () => {
      setPagoModal(null); setReferencia('');
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    },
    onError: (e) => handleApiError(e),
  });
  const confirmarPago = () => {
    if (!referencia.trim()) return;
    confirmarPagoMutation.mutate();
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
      {error && <div className="login-error">No se pudieron cargar los pedidos: {error.message}</div>}

      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('📦 Pedidos recientes')}</Title>
          <Group gap="xs">
            <Button variant="default" size="xs" onClick={exportarCSV}>{txt('⬇️ CSV')}</Button>
            <ActionIcon variant="default" onClick={() => refetch()}>🔄</ActionIcon>
          </Group>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead>
              <tr><th>Folio</th><th>Cliente</th><th>Total</th><th>Pago</th><th>Estatus</th><th>Guía</th><th>Entrega est.</th><th></th></tr>
            </thead>
            <tbody>
              {rows === undefined && <tr><td colSpan={8} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={8} className="empty">Sin pedidos</td></tr>}
              {rows?.map(r => (
                <tr key={r.id_pedido}>
                  <td><code>{r.folio || `#${r.id_pedido}`}</code></td>
                  <td>{r.cliente || '-'}</td>
                  <td><strong>${fmt(r.total)}</strong></td>
                  <td><Badge value={r.pago_estatus} map="pago" /></td>
                  <td>
                    <Select size="xs" data={ESTATUS} value={r.estatus} onChange={v => v && cambiarEstatus(r.id_pedido, v)} comboboxProps={{ withinPortal: true }} />
                  </td>
                  <td style={{ fontSize: 11 }}>{r.numero_guia ? <code>{r.numero_guia}</code> : '-'}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{r.fecha_entrega_est || '-'}</td>
                  <td>
                    <Group gap={4} wrap="nowrap">
                      {r.pago_estatus === 'generado' && r.id_link_pago && (
                        <ActionIcon variant="light" color="teal" title="Confirmar pago recibido" onClick={() => setPagoModal(r.id_link_pago)}>✅</ActionIcon>
                      )}
                      <ActionIcon variant="default" title="Ver ticket" onClick={() => abrirTicket(r.id_pedido)}>🧾</ActionIcon>
                    </Group>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      {ticket && (
        <Modal title={`Ticket — ${ticket.pedido.folio || '#' + ticket.pedido.id_pedido}`} onClose={() => setTicket(null)}
          actions={<Button onClick={() => setTicket(null)}>Cerrar</Button>}>
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
            <Button variant="default" onClick={() => { setPagoModal(null); setReferencia(''); }}>Cancelar</Button>
            <Button onClick={confirmarPago}>Confirmar</Button>
          </>}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>Captura la referencia del pago (efectivo, transferencia, etc.)</p>
          <TextInput autoFocus placeholder="Ej: TRANSF-00123" value={referencia} onChange={e => setReferencia(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
