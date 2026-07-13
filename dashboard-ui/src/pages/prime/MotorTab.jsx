import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Text, Group, Badge, Button, NumberInput } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';

// Editor del motor de flujo (prime, Fase 5). Muestra el grafo ACTIVO de esta
// instancia y permite ajustar los PARÁMETROS de un nodo (ej. % de anticipo) sin
// deploy; el servidor re-corre el linter y rechaza un cambio que rompería el flujo.
// La topología y la lógica sellada NO se editan aquí (frontera de seguridad).
export default function MotorTab() {
  const qc = useQueryClient();
  const [edits, setEdits] = useState({}); // paso → params en edición

  const { data } = useQuery({ queryKey: ['prime-motor'], queryFn: () => api.get('/api/prime/motor') });

  const guardar = useMutation({
    mutationFn: ({ paso, params }) => api.put('/api/prime/motor/nodo', { paso, params }),
    onSuccess: (r, { paso }) => {
      if (!r.ok) return handleApiError(new Error(r.errs ? r.error + ': ' + r.errs.join('; ') : r.error));
      setEdits(e => { const n = { ...e }; delete n[paso]; return n; });
      qc.invalidateQueries({ queryKey: ['prime-motor'] });
    },
    onError: handleApiError,
  });

  if (!data) return <div className="empty">Cargando motor de flujo...</div>;

  if (!data.activo) {
    return (
      <Card withBorder radius="md" p="lg" className="card">
        <Text size="sm">Esta instancia no tiene un grafo de flujo activo. Se siembra al configurar el negocio (onboarding) según el giro.</Text>
      </Card>
    );
  }

  return (
    <div>
      <Card withBorder radius="md" p="md" className="card" mb="lg">
        <Group justify="space-between">
          <Text size="sm">
            Flujo del giro <strong>{data.giro_base}</strong> · {data.nodos.length} nodos.
            El motor {data.motor_activo ? 'está ENCENDIDO' : 'está apagado (se enciende en Módulos)'}.
          </Text>
          <Badge color={data.motor_activo ? 'green' : 'gray'}>{data.motor_activo ? 'motor ON' : 'motor OFF'}</Badge>
        </Group>
        <Text size="xs" c="dimmed" mt={6}>
          Los nodos <em>delegados</em> corren el flujo de código base (no editables aquí). Los nodos con parámetros
          (ej. % de anticipo) se ajustan abajo; el servidor valida el flujo antes de aplicar.
        </Text>
      </Card>

      {data.nodos.map(n => {
        const tienePct = n.params && typeof n.params.porcentaje === 'number';
        const enEd = edits[n.paso] !== undefined;
        const valPct = enEd ? edits[n.paso].porcentaje : (n.params?.porcentaje ?? 0);
        return (
          <Card key={n.paso} withBorder radius="md" p="md" className="card" mb="sm">
            <div className="card-header">
              <h3 style={{ fontFamily: 'monospace' }}>{n.paso}{n.es_inicial ? ' ⭐' : ''}</h3>
              <Group gap="xs">
                <Badge size="sm" color={n.tipo === 'sistema' ? 'orange' : 'blue'}>{n.tipo}</Badge>
                {n.delegar && <Badge size="sm" color="gray">delegado</Badge>}
                {n.render && <Badge size="sm" color="grape">render:{n.render}</Badge>}
              </Group>
            </div>
            {tienePct && (
              <Group gap="xs" mt="xs" align="flex-end">
                <NumberInput label="% de anticipo" size="xs" min={1} max={100} value={valPct} style={{ width: 140 }}
                  onChange={v => setEdits({ ...edits, [n.paso]: { ...n.params, porcentaje: Number(v) } })} />
                <Button size="xs" disabled={!enEd || guardar.isPending}
                  onClick={() => guardar.mutate({ paso: n.paso, params: edits[n.paso] })}>Guardar</Button>
              </Group>
            )}
          </Card>
        );
      })}
    </div>
  );
}
