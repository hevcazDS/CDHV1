import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Text, Group, Badge, Button, Select } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import MotorCanvas from './MotorCanvas';

// Editor del motor de flujo (prime). Lienzo visual (MotorCanvas, React Flow) del
// grafo ACTIVO + selector para SUSTITUIRLO por una plantilla congelada. El
// servidor lintea y aplica la frontera de seguridad antes de persistir cualquier
// cambio; guardar crea una VERSIÓN nueva (la anterior queda para revertir).
export default function MotorTab() {
  const qc = useQueryClient();
  const [sel, setSel] = useState(null);

  const { data } = useQuery({ queryKey: ['prime-motor'], queryFn: () => api.get('/api/prime/motor') });
  const { data: plas } = useQuery({ queryKey: ['prime-motor-plantillas'], queryFn: () => api.get('/api/prime/motor/plantillas') });

  const activar = useMutation({
    mutationFn: (plantilla) => api.post('/api/prime/motor/activar', { plantilla }),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.errs ? r.error + ': ' + r.errs.join('; ') : r.error));
      qc.invalidateQueries({ queryKey: ['prime-motor'] });
    },
    onError: handleApiError,
  });

  if (!data) return <div className="empty">Cargando motor de flujo...</div>;
  const opciones = (plas?.plantillas || []).map(p => ({ value: p, label: p }));

  return (
    <div>
      <Card withBorder radius="md" p="md" className="card" mb="lg">
        <Group justify="space-between" mb={6}>
          <Text size="sm" fw={600}>Flujo del bot (motor)</Text>
          <Badge color={data.motor_activo ? 'green' : 'gray'}>{data.motor_activo ? 'motor ON' : 'motor OFF'}</Badge>
        </Group>
        {data.activo
          ? <Text size="sm">Grafo activo: <strong>{data.giro_base}</strong> · {data.nodos.length} nodos.</Text>
          : <Text size="sm" c="dimmed">No hay un grafo activo. Elige una plantilla congelada y actívala para ver y editar el flujo.</Text>}
        <Text size="xs" c="dimmed" mt={6}>
          {data.motor_activo
            ? 'El bot está usando este grafo.'
            : 'El grafo puede estar activo aunque el motor esté apagado: se enciende en Módulos. Apagado, el bot corre el flujo base en código.'}
        </Text>
        <Group gap="xs" mt="sm" align="flex-end">
          <Select label="Plantilla congelada" placeholder="Elige una" data={opciones} value={sel} onChange={setSel} style={{ width: 240 }} size="xs" />
          <Button size="xs" loading={activar.isPending} disabled={!sel} onClick={() => activar.mutate(sel)}>
            {data.activo ? 'Sustituir por esta' : 'Activar esta plantilla'}
          </Button>
        </Group>
      </Card>

      {data.activo
        ? <MotorCanvas key={data.id + ':' + data.nodos.length} data={data} />
        : (
          <Card withBorder radius="md" p="lg" className="card">
            <Text size="sm" c="dimmed">Activa una plantilla arriba para abrir el lienzo del flujo.</Text>
          </Card>
        )}
    </div>
  );
}
