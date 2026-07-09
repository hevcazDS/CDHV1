import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Select, NumberInput, Group, Text } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import Badge from '../../components/Badge';

export default function ComprasTab() {
  const qc = useQueryClient();
  const [idProveedor, setIdProveedor] = useState(null);
  const [items, setItems] = useState([]);
  const [prodSel, setProdSel] = useState(null);
  const [cant, setCant] = useState(1);
  const [costo, setCosto] = useState(0);

  const { data: proveedores = [] } = useQuery({ queryKey: ['erp-proveedores'], queryFn: () => api.get('/api/erp/proveedores') });
  const { data: productos = [] } = useQuery({ queryKey: ['erp-productos'], queryFn: () => api.get('/api/pos/productos').catch(() => []) });
  const { data: ocs = [] } = useQuery({ queryKey: ['erp-ocs'], queryFn: () => api.get('/api/erp/ordenes-compra') });

  const agregar = () => {
    if (!prodSel || !(cant > 0)) return;
    const prod = productos.find(x => String(x.id) === prodSel);
    setItems([...items, { id_producto: Number(prodSel), name: prod?.name || prodSel, cantidad: cant, costo_unitario: Number(costo) || 0 }]);
    setProdSel(null); setCant(1); setCosto(0);
  };
  const total = items.reduce((s, it) => s + it.cantidad * it.costo_unitario, 0);

  const crear = useMutation({
    mutationFn: () => api.post('/api/erp/ordenes-compra', { id_proveedor: Number(idProveedor), items }),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setItems([]); setIdProveedor(null);
      qc.invalidateQueries({ queryKey: ['erp-ocs'] });
    },
    onError: handleApiError,
  });
  const recibir = useMutation({
    mutationFn: (id) => api.post(`/api/erp/ordenes-compra/${id}/recibir`),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      qc.invalidateQueries({ queryKey: ['erp-ocs'] });
      qc.invalidateQueries({ queryKey: ['erp-cxp'] });
    },
    onError: handleApiError,
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20, alignItems: 'start' }}>
      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Nueva orden de compra</h3></div>
        <Select label="Proveedor *" searchable value={idProveedor} onChange={setIdProveedor} mb="sm"
          data={proveedores.map(pr => ({ value: String(pr.id), label: pr.nombre }))} />
        <Select label="Producto" searchable value={prodSel} onChange={setProdSel} mb="sm"
          data={productos.map(pr => ({ value: String(pr.id), label: pr.name }))} />
        <Group grow mb="sm">
          <NumberInput label="Cantidad" min={1} value={cant} onChange={v => setCant(v || 1)} />
          <NumberInput label="Costo unitario" min={0} decimalScale={2} value={costo} onChange={v => setCosto(v || 0)} />
        </Group>
        <Button variant="default" fullWidth onClick={agregar} disabled={!prodSel} mb="md">Agregar producto</Button>
        {items.map((it, i) => (
          <div key={i} className="modal-row"><span>{it.cantidad}× {it.name}</span><span>${(it.cantidad * it.costo_unitario).toFixed(2)}</span></div>
        ))}
        {items.length > 0 && <div className="modal-row total"><span>Total</span><span>${total.toFixed(2)}</span></div>}
        <Button fullWidth mt="md" onClick={() => crear.mutate()} disabled={!idProveedor || !items.length || crear.isPending}>Crear OC</Button>
      </Card>

      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Órdenes de compra</h3><Text size="xs" c="dimmed">Recibir = sube inventario, recalcula costo promedio y genera la cuenta por pagar</Text></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folio</th><th>Proveedor</th><th>Total</th><th>Estatus</th><th></th></tr></thead>
            <tbody>
              {ocs.length === 0 && <tr><td colSpan={5} className="empty">Sin órdenes de compra</td></tr>}
              {ocs.map(oc => (
                <tr key={oc.id} title={(oc.items || []).map(i => `${i.cantidad}× ${i.name}`).join(', ')}>
                  <td><strong>{oc.folio}</strong></td>
                  <td>{oc.proveedor}</td>
                  <td>${Number(oc.total).toFixed(2)}</td>
                  <td><span className={`badge ${oc.estatus === 'recibida' ? 'badge-verde' : oc.estatus === 'cancelada' ? 'badge-rojo' : 'badge-azul'}`}>{oc.estatus}</span></td>
                  <td>{oc.estatus === 'abierta' && (
                    <>
                    <Button size="xs" variant="default" onClick={() => recibir.mutate(oc.id)} disabled={recibir.isPending}>Recibir</Button>
                        <Button size="xs" variant="light" color="red" ml={6} onClick={async () => {
                          if (!window.confirm('¿Cancelar esta OC? (solo se cancelan abiertas, no mueve inventario)')) return;
                          const r = await api.post(`/api/erp/ordenes-compra/${oc.id}/cancelar`);
                          if (r.ok) qc.invalidateQueries(); else alert(r.error);
                        }}>Cancelar</Button>
                    </>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
