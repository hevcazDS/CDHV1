import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Select, Group, Text } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import { fdate } from '../../lib/format';

// Traslados entre bodegas y salidas (ambos con PIN) + kardex por producto.
export default function MovimientosTab() {
  const qc = useQueryClient();
  const [f, setF] = useState({ producto: null, origen: '', destino: '', cantidad: 1, motivo: '' });
  const [kardexDe, setKardexDe] = useState(null);

  const { data: prods = [] } = useQuery({ queryKey: ['almacen-prods'], queryFn: () => api.get('/api/almacen/inventario?q=') });
  const productos = [...new Map(prods.map(x => [x.id, x])).values()];
  const sucursales = [...new Set(prods.map(x => x.sucursal))];

  const { data: kardex = [] } = useQuery({
    queryKey: ['kardex', kardexDe],
    queryFn: () => api.get('/api/almacen/kardex?producto=' + kardexDe),
    enabled: !!kardexDe,
  });

  const mover = useMutation({
    mutationFn: ({ ruta, body }) => {
      const pin = window.prompt('PIN de autorización del administrador:');
      if (!pin) throw new Error('Operación cancelada');
      return api.post(ruta, { ...body, pin });
    },
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      alert('✓ Movimiento registrado con kardex');
      qc.invalidateQueries({ queryKey: ['almacen-prods'] });
      qc.invalidateQueries({ queryKey: ['kardex'] });
    },
    onError: handleApiError,
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 20, alignItems: 'start' }}>
      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Traslado / Salida</h3><Text size="xs" c="dimmed">Requieren PIN del administrador</Text></div>
        <Select label="Producto" searchable value={f.producto} onChange={v => setF({ ...f, producto: v })} mb="sm"
          data={productos.map(x => ({ value: String(x.id), label: x.name }))} />
        <Group grow mb="sm">
          <Select label="Origen" value={f.origen} onChange={v => setF({ ...f, origen: v })} data={sucursales} />
          <Select label="Destino (solo traslado)" value={f.destino} onChange={v => setF({ ...f, destino: v })} data={sucursales} />
        </Group>
        <Group grow mb="md">
          <NumberInput label="Cantidad" min={1} value={f.cantidad} onChange={v => setF({ ...f, cantidad: v || 1 })} />
          <TextInput label="Motivo (salida)" value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })} />
        </Group>
        <Group grow>
          <Button variant="default" disabled={!f.producto || !f.origen || !f.destino}
            onClick={() => mover.mutate({ ruta: '/api/almacen/traslado', body: { id_producto: Number(f.producto), origen: f.origen, destino: f.destino, cantidad: f.cantidad } })}>
            Trasladar
          </Button>
          <Button color="red" variant="light" disabled={!f.producto || !f.origen}
            onClick={() => mover.mutate({ ruta: '/api/almacen/salida', body: { id_producto: Number(f.producto), sucursal: f.origen, cantidad: f.cantidad, motivo: f.motivo } })}>
            Dar salida
          </Button>
        </Group>
      </Card>

      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header">
          <h3>Kardex</h3>
          <Select placeholder="Elige producto..." searchable w={280} value={kardexDe} onChange={setKardexDe}
            data={productos.map(x => ({ value: String(x.id), label: x.name }))} />
        </div>
        <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
          <table>
            <thead><tr><th>Fecha</th><th>Sucursal</th><th>Tipo</th><th>Δ</th><th>Saldo</th><th>Motivo / quién</th></tr></thead>
            <tbody>
              {!kardexDe && <tr><td colSpan={6} className="empty">Elige un producto para ver su historial</td></tr>}
              {kardexDe && kardex.length === 0 && <tr><td colSpan={6} className="empty">Sin movimientos registrados</td></tr>}
              {kardex.map(m => (
                <tr key={m.id}>
                  <td className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fdate(m.creado_en)}</td>
                  <td style={{ fontSize: 12 }}>{m.sucursal}</td>
                  <td><span className="chip">{m.tipo}</span></td>
                  <td style={{ color: m.delta < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                  <td style={{ fontWeight: 700 }}>{m.cantidad_nueva}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{m.motivo || '-'}{m.creado_por ? ' · ' + m.creado_por : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
