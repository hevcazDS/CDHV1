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

  const { data: prods = [] } = useQuery({ queryKey: ['almacen-prods'], queryFn: () => api.get('/api/almacen/inventario?q=') });
  const { data: ocs = [] } = useQuery({ queryKey: ['erp-ocs'], queryFn: () => api.get('/api/erp/ordenes-compra').catch(() => []) });
  const ocsAbiertas = (Array.isArray(ocs) ? ocs : []).filter(o => o.estatus === 'abierta');

  const recibirOC = useMutation({
    mutationFn: (id) => api.post(`/api/erp/ordenes-compra/${id}/recibir`),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      alert('✓ Mercancía recibida: inventario, costo promedio y CxP actualizados');
      qc.invalidateQueries({ queryKey: ['erp-ocs'] });
      qc.invalidateQueries({ queryKey: ['almacen-prods'] });
    },
    onError: handleApiError,
  });
  const productos = [...new Map(prods.map(x => [x.id, x])).values()];
  const sucursales = [...new Set(prods.map(x => x.sucursal))];

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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20, alignItems: 'start' }}>
      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>OC por recibir</h3><Text size="xs" c="dimmed">Recibir = entra al inventario (sin PIN)</Text></div>
        {ocsAbiertas.length === 0 && <div className="empty" style={{ padding: 10 }}>Sin órdenes pendientes</div>}
        {ocsAbiertas.map(oc => (
          <div key={oc.id} className="toggle-row">
            <div className="info">
              <h4>{oc.folio} — {oc.proveedor}</h4>
              <p>{(oc.items || []).map(i => `${i.cantidad}× ${i.name}`).join(', ')} · ${Number(oc.total).toFixed(2)}</p>
            </div>
            <Button size="xs" onClick={() => recibirOC.mutate(oc.id)} disabled={recibirOC.isPending}>Recibir</Button>
          </div>
        ))}
        <div className="card-header" style={{ marginTop: 18 }}><h3>Traslado / Salida</h3><Text size="xs" c="dimmed">Requieren PIN del administrador</Text></div>
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
        <Button fullWidth mt="sm" variant="light" color="teal" disabled={!f.producto || !f.origen}
          onClick={async () => {
            const costo = window.prompt('Costo unitario (opcional, recalcula el promedio):', '');
            try {
              const r = await api.post('/api/prime/entrada-mercancia', {
                id_producto: Number(f.producto), sucursal: f.origen, cantidad: f.cantidad,
                costo: costo !== null && costo !== '' ? Number(costo) : undefined, proveedor: f.motivo || undefined,
              });
              if (!r.ok) throw new Error(r.error);
              alert(`✓ Entrada registrada: ${r.stock_anterior} → ${r.stock_nuevo}`);
              qc.invalidateQueries({ queryKey: ['almacen-prods'] });
              qc.invalidateQueries({ queryKey: ['kardex'] });
            } catch (e) { handleApiError(e); }
          }}>
          Entrada sin OC (libre, sin PIN)
        </Button>
      </Card>

    </div>
  );
}
