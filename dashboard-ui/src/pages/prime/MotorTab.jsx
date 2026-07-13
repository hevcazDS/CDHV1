import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Text, Group, Badge, Button, NumberInput, Select } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';

// Editor del motor de flujo (prime, Fase 5/6). Muestra el grafo ACTIVO, permite
// SUSTITUIRLO por otra plantilla "congelada" (preset de fábrica) y ajustar los
// PARÁMETROS de un nodo (ej. % de anticipo) sin deploy — el servidor re-corre el
// linter y rechaza lo que rompería el flujo. La topología y la lógica sellada NO
// se editan aquí (frontera de seguridad).
export default function MotorTab() {
  const qc = useQueryClient();
  const [edits, setEdits] = useState({});   // paso → params en edición
  const [sel, setSel] = useState(null);     // plantilla elegida para activar

  const { data } = useQuery({ queryKey: ['prime-motor'], queryFn: () => api.get('/api/prime/motor') });
  const { data: plas } = useQuery({ queryKey: ['prime-motor-plantillas'], queryFn: () => api.get('/api/prime/motor/plantillas') });

  const refrescar = () => qc.invalidateQueries({ queryKey: ['prime-motor'] });

  const activar = useMutation({
    mutationFn: (plantilla) => api.post('/api/prime/motor/activar', { plantilla }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.errs ? r.error + ': ' + r.errs.join('; ') : r.error)); refrescar(); },
    onError: handleApiError,
  });

  const guardar = useMutation({
    mutationFn: ({ paso, params }) => api.put('/api/prime/motor/nodo', { paso, params }),
    onSuccess: (r, { paso }) => {
      if (!r.ok) return handleApiError(new Error(r.errs ? r.error + ': ' + r.errs.join('; ') : r.error));
      setEdits(e => { const n = { ...e }; delete n[paso]; return n; });
      refrescar();
    },
    onError: handleApiError,
  });

  if (!data) return <div className="empty">Cargando motor de flujo...</div>;
  const opciones = (plas?.plantillas || []).map(p => ({ value: p, label: p }));

  return (
    <div>
      {/* Estado + selector de plantilla congelada (activar / sustituir) */}
      <Card withBorder radius="md" p="md" className="card" mb="lg">
        <Group justify="space-between" mb={6}>
          <Text size="sm" fw={600}>Flujo del bot (motor)</Text>
          <Badge color={data.motor_activo ? 'green' : 'gray'}>{data.motor_activo ? 'motor ON' : 'motor OFF'}</Badge>
        </Group>
        {data.activo
          ? <Text size="sm">Grafo activo: <strong>{data.giro_base}</strong> · {data.nodos.length} nodos.</Text>
          : <Text size="sm" c="dimmed">No hay un grafo activo. Elige una plantilla congelada y actívala para verlo y poder editar el flujo.</Text>}
        <Text size="xs" c="dimmed" mt={6}>
          {data.motor_activo
            ? 'El bot está usando este grafo.'
            : 'El grafo puede estar activo aunque el motor esté apagado: se enciende en Módulos → "Motor de flujo". Apagado, el bot corre el flujo base en código.'}
        </Text>
        <Group gap="xs" mt="sm" align="flex-end">
          <Select label="Plantilla congelada" placeholder="Elige una" data={opciones} value={sel} onChange={setSel} style={{ width: 240 }} size="xs" />
          <Button size="xs" loading={activar.isPending} disabled={!sel}
            onClick={() => activar.mutate(sel)}>
            {data.activo ? 'Sustituir por esta' : 'Activar esta plantilla'}
          </Button>
        </Group>
      </Card>

      {!data.activo && (
        <Card withBorder radius="md" p="lg" className="card">
          <Text size="sm" c="dimmed">Activa una plantilla arriba para ver y editar sus nodos.</Text>
        </Card>
      )}

      {data.activo && data.nodos.map(n => {
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
