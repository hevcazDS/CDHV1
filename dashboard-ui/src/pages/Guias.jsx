import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table, Select, Button, TextInput } from '@mantine/core';
import { api } from '../api';
import Badge from '../components/Badge';
import { useTextoEmoji } from '../context/EmojiContext';

const ESTATUS_GUIA = ['generada', 'recolectada', 'en_camino', 'en_ciudad', 'intento_fallido', 'entregada'];

export default function Guias() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [numero, setNumero] = useState('');
  const [estatus, setEstatus] = useState('generada');
  const [descripcion, setDescripcion] = useState('');
  const [msg, setMsg] = useState(null);

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['guias'],
    queryFn: () => api.get('/api/guias'),
  });

  const actualizarMutation = useMutation({
    mutationFn: () => api.post('/api/actualizar_guia', { numeroGuia: numero, estatus, descripcion }),
    onSuccess: () => {
      setMsg({ ok: true, texto: `Guía ${numero} → "${estatus}"` });
      queryClient.invalidateQueries({ queryKey: ['guias'] });
    },
    onError: (e) => setMsg({ ok: false, texto: e.message }),
  });
  const actualizar = () => {
    if (!numero.trim()) { setMsg({ ok: false, texto: 'Escribe el número de guía' }); return; }
    actualizarMutation.mutate();
  };

  const editarRapido = (numeroGuia) => {
    setNumero(numeroGuia);
    setDescripcion('');
    setMsg(null);
  };

  return (
    <div>
      <div className="page-title">Guías Estafeta</div>
      <div className="page-sub">Rastreo y actualización de guías de envío</div>
      {error && <div className="login-error">No se pudieron cargar las guías: {error.message}</div>}

      <div className="kpi-grid" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb="md">
            <Title order={4}>{txt('🚚 Guías activas')}</Title>
            <ActionIcon variant="default" onClick={() => refetch()}>🔄</ActionIcon>
          </Group>
          <div className="table-wrap">
            <Table highlightOnHover verticalSpacing="xs">
              <thead><tr><th>Guía</th><th>Cliente</th><th>Destino</th><th>Estatus</th><th>Entrega est.</th><th></th></tr></thead>
              <tbody>
                {rows === undefined && <tr><td colSpan={6} className="empty">Cargando...</td></tr>}
                {rows?.length === 0 && <tr><td colSpan={6} className="empty">Sin guías</td></tr>}
                {rows?.map(r => (
                  <tr key={r.id}>
                    <td><code style={{ fontSize: 11 }}>{r.numero_guia}</code></td>
                    <td>{r.cliente || '-'}</td>
                    <td className="text-muted">{r.dest_ciudad || r.ciudad_envio || '-'}</td>
                    <td><Badge value={r.estatus} map="guia" /></td>
                    <td className="text-muted">{r.fecha_entrega_est || '-'}</td>
                    <td><ActionIcon variant="default" onClick={() => editarRapido(r.numero_guia)}>✏️</ActionIcon></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('✏️ Actualizar guía')}</Title>
          <TextInput label="Número de guía" placeholder="HVCZ-000001" value={numero} onChange={e => setNumero(e.target.value)} mb="sm" />
          <Select label="Nuevo estatus" data={ESTATUS_GUIA} value={estatus} onChange={v => setEstatus(v ?? estatus)} comboboxProps={{ withinPortal: true }} mb="sm" />
          <TextInput label="Descripción (opcional)" placeholder="Ej: En ruta de entrega" value={descripcion} onChange={e => setDescripcion(e.target.value)} mb="sm" />
          <Button onClick={actualizar}>Actualizar guía</Button>
          {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginTop: 14 }}>{txt(msg.texto)}</div>}
        </Card>
      </div>
    </div>
  );
}
