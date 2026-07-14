import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table, Tabs, Button } from '@mantine/core';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { confirmar, toastOk } from '../lib/ui';
import Badge from '../components/Badge';
import { Emoji, useTextoEmoji } from '../context/EmojiContext';

const TABS = [
  { key: 'pendientes', label: '⏳ Pendientes' },
  { key: 'programados', label: 'Programados' },
  { key: 'historial', label: 'Historial' },
];

export default function ColaEnvios() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('pendientes');

  const { data: cola, refetch: refetchCola } = useQuery({
    queryKey: ['cola-envios'],
    queryFn: () => api.get('/api/cola'),
    enabled: tab === 'pendientes',
  });
  const { data: programados, refetch: refetchProgramados } = useQuery({
    queryKey: ['cola-programados'],
    queryFn: () => api.get('/api/cola/programados'),
    enabled: tab === 'programados',
  });
  const { data: historial, refetch: refetchHistorial } = useQuery({
    queryKey: ['cola-historial'],
    queryFn: () => api.get('/api/cola/historial'),
    enabled: tab === 'historial',
  });

  const reintentarTodoMutation = useMutation({
    mutationFn: () => api.post('/api/cola/reintentar', {}),
    onSuccess: (r) => {
      toastOk(txt(`✅ ${r.reactivados || 0} mensajes reactivados`));
      queryClient.invalidateQueries({ queryKey: ['cola-envios'] });
    },
    onError: (e) => handleApiError(e),
  });

  const reintentarUnoMutation = useMutation({
    mutationFn: (id) => api.post(`/api/cola/reintentar/${id}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cola-envios'] }),
    onError: (e) => handleApiError(e),
  });

  const cancelarCampanaMutation = useMutation({
    mutationFn: ({ asunto, enviar_despues_de }) => api.del('/api/cola/programados', { asunto, enviar_despues_de }),
    onSuccess: (r) => {
      toastOk(txt(`✅ ${r.cancelados || 0} mensajes cancelados`));
      queryClient.invalidateQueries({ queryKey: ['cola-programados'] });
    },
    onError: (e) => handleApiError(e),
  });
  const cancelarCampana = async (asunto, enviar_despues_de) => {
    if (!await confirmar({ mensaje: '¿Cancelar esta campaña? Los mensajes pendientes no se enviarán.', peligro: true, textoOk: 'Cancelar campaña' })) return;
    cancelarCampanaMutation.mutate({ asunto, enviar_despues_de });
  };

  return (
    <div className="sin-scroll">
      <div className="page-title">Cola de envíos</div>
      <div className="page-sub">Mensajes pendientes, campañas programadas e historial de notificaciones</div>
      <div className="page-scrollable">

      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          {TABS.map(t => <Tabs.Tab key={t.key} value={t.key}>{txt(t.label)}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>

      {tab === 'pendientes' && (
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb="md">
            <Title order={4}>{txt('⏳ Mensajes en cola')}</Title>
            <Group gap="xs">
              <ActionIcon variant="default" onClick={() => refetchCola()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
              <Button variant="light" color="red" size="xs" onClick={() => reintentarTodoMutation.mutate()}>{txt('♻️ Reintentar')}</Button>
            </Group>
          </Group>
          {cola && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="badge badge-amarillo"><Emoji>⏳ </Emoji>{cola.pendientes || 0} pendientes</span>
              <span className="badge badge-rojo"><Emoji></Emoji>{cola.fallidas || 0} fallidas</span>
            </div>
          )}
          <div className="table-wrap">
            <Table highlightOnHover verticalSpacing="xs">
              <thead><tr><th>ID</th><th>Destinatario</th><th>Asunto</th><th>Estatus</th><th>Intentos</th><th>Fecha</th><th></th></tr></thead>
              <tbody>
                {cola === undefined && <tr><td colSpan={7} className="empty cargando">Cargando...</td></tr>}
                {cola?.items?.length === 0 && <tr><td colSpan={7} className="empty">Cola vacía</td></tr>}
                {cola?.items?.map(r => (
                  <tr key={r.id}>
                    <td><code>{r.id}</code></td>
                    <td><code style={{ fontSize: 11 }}>{soloTelefono(r.destinatario).slice(0, 15)}</code></td>
                    <td style={{ fontSize: 12 }}>{r.asunto || '-'}</td>
                    <td><Badge value={r.estatus} map="notif" /></td>
                    <td style={{ textAlign: 'center' }}>{r.intentos || 0}</td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.creada_en)}</td>
                    <td><ActionIcon variant="default" onClick={() => reintentarUnoMutation.mutate(r.id)}></ActionIcon></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}

      {tab === 'programados' && (
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb="md">
            <Title order={4}>{txt('🗓️ Campañas programadas')}</Title>
            <ActionIcon variant="default" onClick={() => refetchProgramados()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
          </Group>
          {programados === undefined && <div className="empty cargando">Cargando...</div>}
          {programados?.length === 0 && <div className="empty">No hay campañas programadas</div>}
          {programados?.map((r, i) => (
            <div key={i} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 7, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.asunto || 'Sin asunto'}</div>
                  <div className="text-muted"><Emoji></Emoji>{r.enviar_despues_de ? fdate(r.enviar_despues_de) : '-'} · <Emoji></Emoji>{r.total || 0} mensajes</div>
                  <div style={{ fontSize: 12, background: 'var(--panel-2)', padding: 6, borderRadius: 5, marginTop: 6, fontFamily: 'monospace' }}>
                    {(r.cuerpo_muestra || '').slice(0, 80)}
                  </div>
                </div>
                <Button variant="light" color="red" size="xs" onClick={() => cancelarCampana(r.asunto, r.enviar_despues_de)}>{txt('🗑️ Cancelar')}</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {tab === 'historial' && (
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb="md">
            <Title order={4}>{txt('📋 Historial')}</Title>
            <ActionIcon variant="default" onClick={() => refetchHistorial()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
          </Group>
          <div className="table-wrap">
            <Table highlightOnHover verticalSpacing="xs">
              <thead><tr><th>Destinatario</th><th>Asunto</th><th>Estatus</th><th>Intentos</th><th>Fecha</th></tr></thead>
              <tbody>
                {historial === undefined && <tr><td colSpan={5} className="empty cargando">Cargando...</td></tr>}
                {historial?.length === 0 && <tr><td colSpan={5} className="empty">Sin historial</td></tr>}
                {historial?.map((r, i) => (
                  <tr key={i}>
                    <td><code style={{ fontSize: 11 }}>{soloTelefono(r.destinatario).slice(0, 15)}</code></td>
                    <td style={{ fontSize: 12 }}>{r.asunto || '-'}</td>
                    <td><Badge value={r.estatus} map="notif" /></td>
                    <td style={{ textAlign: 'center' }}>{r.intentos || 0}</td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.creada_en)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
      </div>
    </div>
  );
}
