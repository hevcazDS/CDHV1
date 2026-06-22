import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table, Tabs, Button } from '@mantine/core';
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
  const navigate = useNavigate();
  const [tab, setTab] = useState('en_espera');
  const chatear = (idCliente) => navigate(`/notificaciones?cliente=${idCliente}`);

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

      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          {TABS.map(t => <Tabs.Tab key={t.key} value={t.key}>{txt(t.label)}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>

      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('🚨 Cola de atención humana')}</Title>
          <ActionIcon variant="default" onClick={() => refetch()}>🔄</ActionIcon>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
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
                    <Group gap={6} wrap="nowrap">
                      {r.id_cliente && (
                        <Button variant="default" size="xs" onClick={() => chatear(r.id_cliente)}>{txt('💬 Chatear')}</Button>
                      )}
                      {r.estatus === 'en_espera' && (
                        <Button variant="default" size="xs" onClick={() => marcar(r.id, 'atendida')}>{txt('🗣️ Atender')}</Button>
                      )}
                      {r.estatus === 'atendida' && (
                        <>
                          <Button variant="light" color="teal" size="xs" onClick={() => marcar(r.id, 'resuelta')}>{txt('✅ Resolver')}</Button>
                          <Button variant="default" size="xs" onClick={() => marcar(r.id, 'en_espera')}>{txt('↩️ Reabrir')}</Button>
                        </>
                      )}
                      {r.estatus === 'resuelta' && (
                        <Button variant="default" size="xs" onClick={() => marcar(r.id, 'en_espera')}>{txt('↩️ Reabrir')}</Button>
                      )}
                    </Group>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
