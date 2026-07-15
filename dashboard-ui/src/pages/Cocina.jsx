import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Text, Skeleton } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';

// Vista COCINA (KDS, P3): las comandas enviadas desde mesas, en orden de
// llegada; el cocinero marca "Listo" y desaparecen. Pensada para una tablet
// en la cocina — tarjetas grandes, cero adornos, refresco cada 8s.
export default function Cocina() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['cocina'],
    queryFn: () => api.get('/api/mesas/cocina'),
    refetchInterval: 8000,
  });

  const listo = useMutation({
    mutationFn: (id) => api.post(`/api/mesas/item/${id}/listo`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina'] }),
    onError: handleApiError,
  });

  const antiguedad = (creado) => {
    const min = Math.floor((Date.now() - new Date(creado).getTime()) / 60000);
    return min < 1 ? 'recién' : `hace ${min} min`;
  };

  if (!data) return (
    <div className="sin-scroll">
      <div className="page-title">Cocina</div>
      <Skeleton height={120} radius="md" mt="md" />
    </div>
  );

  return (
    <div className="sin-scroll">
      <div className="page-title">Cocina</div>
      <div className="page-sub">{data.items.length ? `${data.items.length} platillo(s) en preparación — el más viejo primero` : 'Sin comandas pendientes'}</div>
      <div className="page-scrollable">
        <div className="kpi-grid f-stagger">
          {data.items.map(it => {
            const min = Math.floor((Date.now() - new Date(it.creado_en).getTime()) / 60000);
            return (
              <Card key={it.id} withBorder radius="md" p="lg" className="card"
                style={min >= 15 ? { borderColor: 'var(--red)' } : undefined}>
                <div className="card-header">
                  <h3>Mesa {it.mesa}</h3>
                  <Text size="xs" c={min >= 15 ? 'var(--red)' : 'dimmed'}>{antiguedad(it.creado_en)}</Text>
                </div>
                <Text fw={600} size="lg">{it.cantidad}× {it.nombre}</Text>
                {it.comentario && <Text size="sm" c="dimmed" mt={4}>“{it.comentario}”</Text>}
                <Button fullWidth mt="md" size="md" disabled={listo.isPending} onClick={() => listo.mutate(it.id)}>
                  Listo ✓
                </Button>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
