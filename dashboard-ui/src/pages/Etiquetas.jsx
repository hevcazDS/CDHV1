import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Select, Button, TextInput, SimpleGrid, Badge, Text } from '@mantine/core';
import { api } from '../api';
import { fdate } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Modal from '../components/Modal';
import { useTextoEmoji } from '../context/EmojiContext';
import { ETIQUETAS_PENDIENTES_QUERY_KEY } from '../components/NotificationBell';

const ESTADO_OPTS = [
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'aceptada', label: 'Aceptadas' },
  { value: 'corregida', label: 'Corregidas' },
  { value: 'todas', label: 'Todas' },
];

export default function Etiquetas() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState('pendiente');
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [etiquetaNueva, setEtiquetaNueva] = useState('');

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['etiquetas', estado],
    queryFn: () => api.get('/api/etiquetas?estado=' + estado),
  });

  const revisarMutation = useMutation({
    mutationFn: ({ id, accion, etiqueta_corregida }) => api.put(`/api/etiquetas/${id}`, { accion, etiqueta_corregida }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['etiquetas'] });
      queryClient.invalidateQueries({ queryKey: ETIQUETAS_PENDIENTES_QUERY_KEY });
      setCorrigiendo(null);
      setEtiquetaNueva('');
    },
    onError: (e) => handleApiError(e),
  });

  const aceptar = (id) => revisarMutation.mutate({ id, accion: 'aceptar' });
  const abrirCorregir = (id) => { setCorrigiendo(id); setEtiquetaNueva(''); };
  const confirmarCorregir = () => {
    if (!etiquetaNueva.trim()) return;
    revisarMutation.mutate({ id: corrigiendo, accion: 'corregir', etiqueta_corregida: etiquetaNueva.trim() });
  };

  return (
    <div className="sin-scroll">
      <div className="page-title">Etiquetas</div>
      <div className="page-sub">Revisión humana de las etiquetas que Vision le puso a fotos de clientes</div>
      <div className="page-scrollable">
      {error && <div className="login-error">No se pudieron cargar las etiquetas: {error.message}</div>}

      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('🏷️ Fotos por revisar')}</Title>
          <Group gap="xs">
            <Select size="xs" w={140} data={ESTADO_OPTS} value={estado} onChange={v => setEstado(v ?? estado)} comboboxProps={{ withinPortal: true }} />
            <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
          </Group>
        </Group>

        {rows === undefined && <div className="empty">Cargando...</div>}
        {rows?.length === 0 && <div className="empty">Sin fotos en este estado</div>}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {rows?.map(r => (
            <Card withBorder radius="md" p="sm" key={r.id}>
              <img
                src={`/api/imagenes_clientes/${encodeURIComponent(r.archivo_imagen)}`}
                alt="Foto de cliente"
                style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 'var(--radius)', marginBottom: 8 }}
              />
              <Group gap={4} mb={6} wrap="wrap">
                {(r.labels || []).slice(0, 6).map((l, i) => <Badge key={i} size="sm" variant="light">{l}</Badge>)}
              </Group>
              {r.etiqueta_corregida && <Text size="xs" c="dimmed" mb={4}>Corregida a: <strong>{r.etiqueta_corregida}</strong></Text>}
              <Text size="xs" c="dimmed">{fdate(r.registrado_en)}</Text>
              {r.estado === 'pendiente' ? (
                <Group gap={6} mt={8}>
                  <Button size="xs" variant="light" color="teal" onClick={() => aceptar(r.id)} disabled={revisarMutation.isPending}>{txt('✅ Aceptar')}</Button>
                  <Button size="xs" variant="default" onClick={() => abrirCorregir(r.id)} disabled={revisarMutation.isPending}>{txt('✏️ Corregir')}</Button>
                </Group>
              ) : (
                <Badge mt={8} color={r.estado === 'aceptada' ? 'teal' : 'blue'}>{r.estado}</Badge>
              )}
            </Card>
          ))}
        </SimpleGrid>
      </Card>

      {corrigiendo && (
        <Modal title="Corregir etiqueta" onClose={() => setCorrigiendo(null)}
          actions={<>
            <Button variant="default" onClick={() => setCorrigiendo(null)}>Cancelar</Button>
            <Button onClick={confirmarCorregir} disabled={revisarMutation.isPending}>Guardar</Button>
          </>}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>Escribe la etiqueta correcta para esta foto</p>
          <TextInput autoFocus placeholder="Ej: lego duplo" value={etiquetaNueva} onChange={e => setEtiquetaNueva(e.target.value)} />
        </Modal>
      )}
      </div>
    </div>
  );
}
