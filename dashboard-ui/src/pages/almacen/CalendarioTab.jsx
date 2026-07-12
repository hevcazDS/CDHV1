import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Group, Text } from '@mantine/core';
import { api } from '../../api';
import Calendario from '../../components/Calendario';

// Calendario de mercancía proyectada: entradas (preventas por llegar) y
// salidas (envíos con guía por salir). Datos de /api/almacen/calendario.
export default function CalendarioTab() {
  const [rango, setRango] = useState({ desde: '', hasta: '' });
  const { data } = useQuery({
    queryKey: ['almacen-calendario', rango],
    queryFn: () => api.get(`/api/almacen/calendario?desde=${rango.desde}&hasta=${rango.hasta}`).catch(() => ({ eventos: [] })),
    enabled: !!rango.desde,
  });
  const eventos = (data?.eventos || []).map(e => ({ ...e, color: e.tipo === 'entrada' ? 'var(--green)' : e.tipo === 'tarea' ? '#e8a33d' : '#4aa8ff' }));

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <Group mb="sm" gap="lg">
        <Text size="sm"><span style={{ color: 'var(--green)' }}>●</span> Entradas (mercancía por llegar)</Text>
        <Text size="sm"><span style={{ color: '#4aa8ff' }}>●</span> Salidas (envíos por salir)</Text>
        <Text size="sm"><span style={{ color: '#e8a33d' }}>●</span> Tareas / recordatorios</Text>
      </Group>
      <Calendario eventos={eventos} onRango={(desde, hasta) => setRango({ desde, hasta })} />
      <Text size="xs" c="dimmed" mt="sm">Entradas = preventas con fecha estimada de llegada. Salidas = pedidos con guía y fecha de envío proyectada. Los recordatorios con fecha se capturan en Panel → Tareas.</Text>
    </Card>
  );
}
