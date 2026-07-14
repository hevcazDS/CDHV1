import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table, Select, Button, TextInput } from '@mantine/core';
import { api } from '../api';
import { fdate } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import { useTextoEmoji } from '../context/EmojiContext';

const FILTRO_OPTS = [
  { value: '', label: 'Todas' },
  { value: 'solicitada', label: 'Solicitadas' },
  { value: 'aprobada', label: 'Aprobadas' },
  { value: 'rechazada', label: 'Rechazadas' },
  { value: 'resuelta', label: 'Resueltas' },
];

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
    <div className="sin-scroll">
      <div className="page-title">Devoluciones</div>
      <div className="page-sub">Solicitudes de devolución de clientes</div>
      {error && <div className="login-error">No se pudieron cargar las devoluciones: {error.message}</div>}

      <Card withBorder radius="md" p="lg" className="sin-scroll-card">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('↩️ Devoluciones')}</Title>
          <Group gap="xs">
            <Select size="xs" w={140} data={FILTRO_OPTS} value={filtro} onChange={v => setFiltro(v ?? '')} comboboxProps={{ withinPortal: true }} />
            <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
          </Group>
        </Group>
        <div className="table-wrap page-scrollable">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Motivo</th><th>Foto</th><th>Estatus</th><th>Fecha</th><th>Decisión del asesor</th></tr></thead>
            <tbody>
              {rows === undefined && <tr><td colSpan={7} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={7} className="empty">Sin devoluciones</td></tr>}
              {rows?.map(r => (
                <tr key={r.id}>
                  <td><code>{r.folio || `#${r.id_pedido}`}</code></td>
                  <td>{r.cliente || '-'}</td>
                  <td style={{ fontSize: 12 }}>{r.motivo || '-'}</td>
                  <td>{r.evidencia_url
                    ? <a href={'/api/imagenes_clientes/' + encodeURIComponent(r.evidencia_url)} target="_blank" rel="noreferrer" className="btn btn-sm">Ver foto</a>
                    : <span className="text-muted" style={{ fontSize: 11 }}>—</span>}</td>
                  <td><Badge value={r.estatus} map="devolucion" />
                    {r.autorizada_por && <div className="text-muted" style={{ fontSize: 10 }}>por {r.autorizada_por}</div>}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.creada_en)}</td>
                  <td>
                    <Select size="xs" data={ESTATUS} value={r.estatus} onChange={v => v && cambiarEstatus(r.id, v)} comboboxProps={{ withinPortal: true }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      {rechazo && (
        <Modal title="Motivo de rechazo" onClose={() => setRechazo(null)}
          actions={<>
            <Button variant="default" onClick={() => setRechazo(null)}>Cancelar</Button>
            <Button onClick={confirmarRechazo}>Aceptar</Button>
          </>}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>Explica brevemente por qué se rechaza (se le enviará al cliente)</p>
          <TextInput autoFocus placeholder="Ej: producto fuera de garantía" value={notas} onChange={e => setNotas(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
