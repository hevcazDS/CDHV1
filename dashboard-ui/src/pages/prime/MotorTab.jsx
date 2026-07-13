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
          ? <Text size="sm">Flujo actual: <strong>{data.giro_base}</strong> · {data.nodos.length} piezas.</Text>
          : <Text size="sm" c="dimmed">Aún no hay un flujo cargado. Elige un diseño listo abajo y actívalo para verlo y editarlo.</Text>}
        <Text size="xs" c="dimmed" mt={6}>
          {data.motor_activo
            ? 'El bot está usando este flujo para conversar.'
            : 'Puedes ver y editar el flujo aunque el motor esté apagado (se enciende en Módulos). Apagado, el bot responde con el flujo base de siempre.'}
        </Text>
        <Group gap="xs" mt="sm" align="flex-end">
          <Select label="Diseños listos para usar" placeholder="Elige uno" data={opciones} value={sel} onChange={setSel} style={{ width: 240 }} size="xs" />
          <Button size="xs" loading={activar.isPending} disabled={!sel} onClick={() => activar.mutate(sel)}>
            {data.activo ? 'Cambiar a este diseño' : 'Usar este diseño'}
          </Button>
        </Group>
      </Card>

      {data.activo
        ? <MotorCanvas key={data.id + ':' + data.nodos.length} data={data} />
        : (
          <Card withBorder radius="md" p="lg" className="card">
            <Text size="sm" c="dimmed">Activa un diseño arriba para abrir el editor visual del flujo.</Text>
          </Card>
        )}
    </div>
  );
}
