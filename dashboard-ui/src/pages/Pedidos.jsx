import { useState } from 'react';
import { Bike, Check, History, Link2, ReceiptText, RefreshCw, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table, Select, Button, TextInput } from '@mantine/core';
import { api } from '../api';
import { fmt, fdate } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { confirmar, toastOk } from '../lib/ui';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import { useTextoEmoji } from '../context/EmojiContext';
import { useAuth } from '../context/AuthContext';
import { LEYENDA_FACTURACION } from '../lib/factura';
import { SkelRows } from '../components/Skeleton';

const ESTATUS = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'];

export default function Pedidos() {
  const txt = useTextoEmoji();
  const { user } = useAuth();
  // Filtros que se RECUERDAN solos por usuario (idea NetSuite, versión lean)
  const _fkey = 'jc-filtros-pedidos-' + (user?.username || 'x');
  const [filtros, setFiltros] = useState(() => {
    try { return JSON.parse(localStorage.getItem(_fkey)) || { estatus: '', q: '' }; }
    catch (_) { return { estatus: '', q: '' }; }
  });
  const setF = (nf) => { setFiltros(nf); try { localStorage.setItem(_fkey, JSON.stringify(nf)); } catch (_) {} };
  const [historial, setHistorial] = useState(null);
  const verHistorial = async (id) => {
    try { const h = await api.get(`/api/pedidos/${id}/historial`); if (!h.ok) throw new Error(h.error); setHistorial(h); }
    catch (e) { handleApiError(e); }
  };
  const queryClient = useQueryClient();
  const [ticket, setTicket] = useState(null);
  const [pagoModal, setPagoModal] = useState(null);
  const [referencia, setReferencia] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [rfc, setRfc] = useState('');
  const [msgFacturacion, setMsgFacturacion] = useState('');

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['pedidos'],
    queryFn: () => api.get('/api/pedidos'),
  });
  const { data: facturaActivo } = useQuery({
    queryKey: ['modulo', 'facturacion_activo'],
    queryFn: () => api.get('/api/modulo/facturacion_activo').then(r => !!r.activo).catch(() => false),
  });

  const cambiarEstatusMutation = useMutation({
    mutationFn: ({ id, estatus }) => api.put(`/api/pedidos/${id}`, { estatus }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pedidos'] }),
    onError: (e) => { handleApiError(e); queryClient.invalidateQueries({ queryKey: ['pedidos'] }); },
  });
  const cambiarEstatus = async (id, estatus) => {
    if (estatus === 'cancelado' && !await confirmar({ titulo: 'Cancelar pedido', mensaje: '¿Cancelar este pedido? Se notificará al cliente.', peligro: true, textoOk: 'Cancelar pedido' })) { refetch(); return; }
    cambiarEstatusMutation.mutate({ id, estatus });
  };

  const rowsFiltrados = (rows || []).filter(r =>
    (!filtros.estatus || r.estatus === filtros.estatus) &&
    (!filtros.q || ((r.folio || '') + ' ' + (r.cliente || '')).toLowerCase().includes(filtros.q.toLowerCase()))
  );

  const abrirTicket = async (idPedido) => {
    try {
      const t = await api.get(`/api/pedidos/${idPedido}/ticket`);
      setTicket(t);
      setRazonSocial(t.pedido.razon_social || '');
      setRfc(t.pedido.rfc || '');
      setMsgFacturacion('');
    }
    catch (e) { handleApiError(e, 'No se pudo cargar el ticket'); }
  };

  const guardarFacturacionMutation = useMutation({
    mutationFn: ({ id, razon_social, rfc: rfcVal }) => api.put(`/api/pedidos/${id}`, { razon_social, rfc: rfcVal }),
    onSuccess: () => { setMsgFacturacion('Guardado.'); queryClient.invalidateQueries({ queryKey: ['pedidos'] }); },
    onError: (e) => setMsgFacturacion(e.message),
  });
  const guardarFacturacion = () => {
    setMsgFacturacion('');
    guardarFacturacionMutation.mutate({ id: ticket.pedido.id_pedido, razon_social: razonSocial || null, rfc: rfc || null });
  };

  const confirmarPagoMutation = useMutation({
    mutationFn: () => api.post(`/api/pagos/${pagoModal.id_link_pago}/marcar-pagado`, { referencia_pago: referencia }),
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

  // ── Repartidor (Bloque 2) — solo si el módulo está activo ──────────────
  const { data: repartidorActivo } = useQuery({
    queryKey: ['modulo', 'entrega_repartidor_activo'],
    queryFn: () => api.get('/api/modulo/entrega_repartidor_activo').then(r => !!r.activo).catch(() => false),
  });
  const { data: repartidores } = useQuery({
    queryKey: ['repartidores'],
    queryFn: () => api.get('/api/repartidores').catch(() => []),
    enabled: !!repartidorActivo,
  });
  const [repModal, setRepModal] = useState(null); // pedido en gestión
  const [repNombre, setRepNombre] = useState('');
  const [repTel, setRepTel] = useState('');
  const repMutation = useMutation({
    mutationFn: ({ id, body }) => api.post(`/api/pedidos/${id}/repartidor`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['pedidos'] }); queryClient.invalidateQueries({ queryKey: ['repartidores'] }); },
    onError: (e) => handleApiError(e),
  });
  const abrirRepartidor = (r) => { setRepModal(r); setRepNombre(r.repartidor_nombre || ''); setRepTel(r.repartidor_telefono || ''); };
  const asignarRepartidor = () => {
    if (!repNombre.trim()) return;
    repMutation.mutate({ id: repModal.id_pedido, body: { accion: 'asignar', nombre: repNombre.trim(), telefono: repTel.trim() } });
    setRepModal({ ...repModal, repartidor_nombre: repNombre.trim(), repartidor_telefono: repTel.trim() });
  };
  const repAccion = (accion) => {
    repMutation.mutate({ id: repModal.id_pedido, body: { accion } });
    setRepModal(null);
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
            <Select size="xs" w={130} placeholder="Estatus" clearable value={filtros.estatus || null}
              onChange={v => setF({ ...filtros, estatus: v || '' })} data={ESTATUS} />
            <TextInput size="xs" w={180} placeholder="Filtrar folio o cliente..." value={filtros.q}
              onChange={e => setF({ ...filtros, q: e.target.value })} />
            <Button variant="default" size="xs" onClick={exportarCSV}>{txt('⬇️ CSV')}</Button>
            <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
          </Group>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead>
              <tr><th>Folio</th><th>Cliente</th><th>Total</th><th>Pago</th><th>Estatus</th><th>Guía</th><th>Entrega est.</th><th></th></tr>
            </thead>
            <tbody>
              {rows === undefined && <SkelRows cols={8} rows={6} />}
              {rows !== undefined && rowsFiltrados.length === 0 && <tr><td colSpan={8} className="empty">Sin pedidos con ese filtro</td></tr>}
              {rowsFiltrados.map(r => (
                <tr key={r.id_pedido}>
                  <td><span className="folio">{r.folio || `#${r.id_pedido}`}</span></td>
                  <td>{r.cliente || '-'}</td>
                  <td className="num"><strong>${fmt(r.total)}</strong></td>
                  <td>
                    <Badge value={r.pago_estatus} map="pago" />
                    {!!r.a_credito && r.pago_estatus === 'generado' && <span className="chip" style={{ marginLeft: 4, background: 'var(--yellow)', color: '#000' }} title={r.cobrado_por ? 'Vendió: ' + r.cobrado_por : ''}>fiado</span>}
                  </td>
                  <td>
                    <Select size="xs" data={ESTATUS} value={r.estatus} onChange={v => v && cambiarEstatus(r.id_pedido, v)} comboboxProps={{ withinPortal: true }} />
                  </td>
                  <td style={{ fontSize: 11 }}>{r.numero_guia ? <code>{r.numero_guia}</code> : '-'}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{r.fecha_entrega_est || '-'}</td>
                  <td className="row-actions">
                    <Group gap={4} wrap="nowrap">
                      {r.pago_estatus === 'generado' && r.id_link_pago && (
                        <ActionIcon variant="light" color="teal" title="Confirmar pago recibido" onClick={() => setPagoModal(r)}><Check size={16} strokeWidth={1.75} /></ActionIcon>
                      )}
                      {repartidorActivo && (
                        <ActionIcon variant="light" color="orange" title={r.repartidor_nombre ? `Repartidor: ${r.repartidor_nombre}` : 'Asignar repartidor'} onClick={() => abrirRepartidor(r)}><Bike size={16} strokeWidth={1.75} /></ActionIcon>
                      )}
                      <ActionIcon variant="default" title="Ver ticket" onClick={() => abrirTicket(r.id_pedido)}><ReceiptText size={16} strokeWidth={1.75} /></ActionIcon>
                      <ActionIcon variant="default" title="Historial del pedido" onClick={() => verHistorial(r.id_pedido)}><History size={16} strokeWidth={1.75} /></ActionIcon>
                      {r.pago_estatus !== 'pagado' && (
                        <ActionIcon variant="default" title="Enviar link de pago por WhatsApp" onClick={async () => {
                          const rr = await api.post(`/api/pagos/${r.id_pedido}/enviar-link`).catch(e => ({ ok: false, error: e.message }));
                          if (rr.ok) toastOk('Link de pago enviado al cliente por WhatsApp'); else handleApiError(new Error(rr.error || 'No se pudo'));
                        }}><Link2 size={16} strokeWidth={1.75} /></ActionIcon>
                      )}
                      {r.id_link_pago && (r.pago_estatus === 'generado' || r.pago_estatus === 'pagado') && (
                        <ActionIcon variant="default" color="red" title={r.pago_estatus === 'pagado' ? 'Cancelar y revertir el cobro' : 'Cancelar link de pago'} onClick={async () => {
                          if (!await confirmar({ titulo: 'Cancelar pago', mensaje: r.pago_estatus === 'pagado' ? '¿Cancelar el cobro? Se revierte inventario y puntos.' : '¿Cancelar el link de pago?', peligro: true, textoOk: 'Cancelar' })) return;
                          const rr = await api.post(`/api/pagos/${r.id_link_pago}/cancelar`).catch(e => ({ ok: false, error: e.message }));
                          if (rr.ok) { toastOk(rr.cobro_revertido ? 'Cobro revertido' : 'Link cancelado'); queryClient.invalidateQueries({ queryKey: ['pedidos'] }); } else handleApiError(new Error(rr.error || 'No se pudo'));
                        }}><X size={16} strokeWidth={1.75} /></ActionIcon>
                      )}
                      {r.id_link_pago && (r.pago_estatus === 'cancelado' || r.pago_estatus === 'expirado') && (
                        <ActionIcon variant="default" title="Regenerar link de pago (48h)" onClick={async () => {
                          const rr = await api.post(`/api/pagos/${r.id_link_pago}/regenerar`).catch(e => ({ ok: false, error: e.message }));
                          if (rr.ok) { toastOk('Link regenerado (vence en 48h)'); queryClient.invalidateQueries({ queryKey: ['pedidos'] }); } else handleApiError(new Error(rr.error || 'No se pudo'));
                        }}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
                      )}
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
          <div style={{ fontSize: 12, marginBottom: 4 }}><strong>Cliente:</strong> {ticket.pedido.cliente || '-'}</div>
          <div style={{ fontSize: 12, marginBottom: 4 }}><strong>Fecha de compra:</strong> {fdate(ticket.pedido.creado_en)}</div>
          {ticket.pedido.ciudad_envio && (
            <div style={{ fontSize: 12, marginBottom: 8 }}><strong>Ciudad:</strong> {ticket.pedido.ciudad_envio}{ticket.pedido.cp ? ` (CP ${ticket.pedido.cp})` : ''}</div>
          )}
          {(ticket.items || []).length
            ? ticket.items.map((it, i) => (
                <div className="modal-row" key={i}>
                  <span>
                    {it.name || `Producto #${it.id_producto}`} x{it.cantidad}
                    {it.sucursal_origen && <span className="text-muted" style={{ fontSize: 11 }}> — {it.sucursal_origen}</span>}
                  </span>
                  <span>${fmt(it.subtotal_linea)}</span>
                </div>
              ))
            : <div className="text-muted">Sin productos</div>}
          <div className="modal-row"><span>Envío</span><span>${fmt(ticket.envio ? ticket.envio.costo_envio : 0)}</span></div>
          <div className="modal-row total"><span>Total</span><span>${fmt(ticket.pedido.total)}</span></div>
          {ticket.pago?.referencia_pago && (
            <div className="text-muted" style={{ marginTop: 6 }}>Referencia de pago: {ticket.pago.referencia_pago}</div>
          )}

          {facturaActivo && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 8, textTransform: 'uppercase' }}>Datos de facturación (opcional)</div>
              {msgFacturacion && <div className={msgFacturacion === 'Guardado.' ? 'card' : 'login-error'} style={{ marginBottom: 8, fontSize: 12 }}>{msgFacturacion}</div>}
              <TextInput placeholder="Razón social" value={razonSocial} onChange={e => setRazonSocial(e.target.value)} mb="sm" size="xs" />
              <TextInput placeholder="RFC" value={rfc} onChange={e => setRfc(e.target.value)} mb="sm" size="xs" />
              <Button size="xs" disabled={guardarFacturacionMutation.isPending} onClick={guardarFacturacion}>Guardar</Button>
              {(razonSocial.trim() || rfc.trim()) && (
                <div style={{ marginTop: 12, padding: 10, border: '1px dashed var(--border)', borderRadius: 6, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Comprobante para facturación</div>
                  <div>Referencia: <strong>{ticket.pedido.folio || '#' + ticket.pedido.id_pedido}</strong></div>
                  {razonSocial.trim() && <div>Razón social: {razonSocial}</div>}
                  {rfc.trim() && <div>RFC: {rfc}</div>}
                  <div style={{ marginTop: 6, color: 'var(--text-mute)' }}>{LEYENDA_FACTURACION}</div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {repModal && (
        <Modal title={`Repartidor — ${repModal.folio || '#' + repModal.id_pedido}`} onClose={() => setRepModal(null)}
          actions={<Button variant="default" onClick={() => setRepModal(null)}>Cerrar</Button>}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>Asigna al repartidor y avisa al cliente desde el WhatsApp del negocio.</p>
          <TextInput label="Nombre del repartidor" placeholder="Ej. Juan" value={repNombre} onChange={e => setRepNombre(e.target.value)}
            list="repartidores-frec" mb="sm" size="xs" />
          <datalist id="repartidores-frec">
            {(repartidores || []).map(rp => <option key={rp.id} value={rp.nombre} />)}
          </datalist>
          <TextInput label="Teléfono (opcional)" placeholder="Para referencia del negocio" value={repTel} onChange={e => setRepTel(e.target.value)} mb="sm" size="xs" />
          <Group gap="xs" mt="xs">
            <Button size="xs" variant="default" disabled={!repNombre.trim() || repMutation.isPending} onClick={asignarRepartidor}>Guardar repartidor</Button>
          </Group>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
            <Button size="xs" color="orange" disabled={repMutation.isPending} onClick={() => repAccion('en_camino')}>En camino</Button>
            <Button size="xs" color="teal" disabled={repMutation.isPending} onClick={() => repAccion('entregado')}>Entregado</Button>
          </div>
          <p className="text-muted" style={{ fontSize: 11, marginTop: 10 }}>El cliente recibe el aviso por el WhatsApp del negocio (no hace falta otro número).</p>
        </Modal>
      )}

      {pagoModal && (
        <Modal title="Confirmar pago recibido" onClose={() => { setPagoModal(null); setReferencia(''); }}
          actions={<>
            <Button variant="default" onClick={() => { setPagoModal(null); setReferencia(''); }}>Cancelar</Button>
            <Button onClick={confirmarPago}>Confirmar</Button>
          </>}>
          <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
            <div><strong>{pagoModal.cliente || '—'}</strong> · {pagoModal.folio || '#' + pagoModal.id_pedido}</div>
            <div>Monto: <strong>${fmt(pagoModal.total)}</strong>{!!pagoModal.a_credito && <span> · fiado{pagoModal.fiado_vence_en ? ' vence ' + pagoModal.fiado_vence_en : ''}</span>}</div>
          </div>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>Captura la referencia del pago (efectivo, transferencia, etc.)</p>
          <TextInput autoFocus placeholder="Ej: TRANSF-00123" value={referencia} onChange={e => setReferencia(e.target.value)} />
        </Modal>
      )}
      {historial && (
        <Modal title={`Historial — ${historial.folio}`} onClose={() => setHistorial(null)}
          actions={<Button variant="default" onClick={() => setHistorial(null)}>Cerrar</Button>}>
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {historial.eventos.map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap', minWidth: 118 }}>{fdate(ev.ts)}</span>
                <span className="chip">{ev.tipo}</span>
                <span>{ev.txt}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
