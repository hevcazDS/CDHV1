import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Select, Checkbox, Text, Group } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import { esAdminOMas } from '../lib/permisos';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';

// Rol Compras: solicitudes de adquisición (el administrador aprueba) e
// ingreso de facturas de proveedor (→ CxP). Las OC viven en ERP > Compras.
export default function Compras() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [sol, setSol] = useState({ descripcion: '', cantidad: 1, motivo: '' });
  const [fac, setFac] = useState({ id_proveedor: null, monto: 0, referencia: '', es_mercancia: true });

  const { data: solicitudes = [] } = useQuery({ queryKey: ['compras-sol'], queryFn: () => api.get('/api/compras/solicitudes') });
  const { data: proveedores = [] } = useQuery({ queryKey: ['erp-proveedores'], queryFn: () => api.get('/api/erp/proveedores') });

  const crearSol = useMutation({
    mutationFn: () => api.post('/api/compras/solicitudes', sol),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setSol({ descripcion: '', cantidad: 1, motivo: '' }); qc.invalidateQueries({ queryKey: ['compras-sol'] }); },
    onError: handleApiError,
  });
  const resolver = useMutation({
    mutationFn: ({ id, accion }) => api.post(`/api/compras/solicitudes/${id}/${accion}`),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['compras-sol'] }); },
    onError: handleApiError,
  });
  const crearFac = useMutation({
    mutationFn: () => api.post('/api/compras/factura', { ...fac, id_proveedor: Number(fac.id_proveedor), monto: Number(fac.monto) }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); alert('✓ Factura registrada — vence ' + r.vence_en); setFac({ id_proveedor: null, monto: 0, referencia: '', es_mercancia: true }); },
    onError: handleApiError,
  });

  return (
    <div>
      <div className="page-title">Compras</div>
      <div className="page-sub">Solicitudes de adquisición y facturas de proveedor · las órdenes de compra están en ERP → Órdenes de compra</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 20, alignItems: 'start' }}>
        <div>
          <Card withBorder radius="md" p="lg" className="card" mb="lg">
            <div className="card-header"><h3>Nueva solicitud</h3></div>
            <TextInput label="¿Qué se necesita? *" value={sol.descripcion} onChange={e => setSol({ ...sol, descripcion: e.target.value })} mb="sm" />
            <Group grow mb="md">
              <NumberInput label="Cantidad" min={1} value={sol.cantidad} onChange={v => setSol({ ...sol, cantidad: v || 1 })} />
              <TextInput label="Motivo" value={sol.motivo} onChange={e => setSol({ ...sol, motivo: e.target.value })} />
            </Group>
            <Button fullWidth onClick={() => crearSol.mutate()} disabled={!sol.descripcion.trim()}>Enviar al administrador</Button>
          </Card>

          <Card withBorder radius="md" p="lg" className="card">
            <div className="card-header"><h3>Factura de proveedor (sin OC)</h3></div>
            <Select label="Proveedor *" searchable value={fac.id_proveedor} onChange={v => setFac({ ...fac, id_proveedor: v })} mb="sm"
              data={proveedores.map(pr => ({ value: String(pr.id), label: pr.nombre }))} />
            <Group grow mb="sm">
              <NumberInput label="Monto *" min={0} decimalScale={2} value={fac.monto} onChange={v => setFac({ ...fac, monto: v || 0 })} />
              <TextInput label="Folio/referencia" value={fac.referencia} onChange={e => setFac({ ...fac, referencia: e.target.value })} />
            </Group>
            <Checkbox label="Es mercancía (va a Inventario; si no, a Gastos)" checked={fac.es_mercancia}
              onChange={e => setFac({ ...fac, es_mercancia: e.currentTarget.checked })} mb="md" />
            <Button fullWidth onClick={() => crearFac.mutate()} disabled={!fac.id_proveedor || !(fac.monto > 0)}>Registrar → Cuentas por pagar</Button>
          </Card>
        </div>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Solicitudes</h3></div>
          <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Solicitud</th><th>Cant.</th><th>Pidió</th><th>Estatus</th>{esAdminOMas(user?.rol) && <th></th>}</tr></thead>
              <tbody>
                {solicitudes.length === 0 && <tr><td colSpan={5} className="empty">Sin solicitudes</td></tr>}
                {solicitudes.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.descripcion}</strong>{s.motivo && <div className="text-muted" style={{ fontSize: 11 }}>{s.motivo}</div>}</td>
                    <td>{s.cantidad || '-'}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{s.creada_por}</td>
                    <td><span className={`badge ${s.estatus === 'aprobada' ? 'badge-verde' : s.estatus === 'rechazada' ? 'badge-rojo' : 'badge-amarillo'}`}>{s.estatus}</span></td>
                    {esAdminOMas(user?.rol) && (
                      <td>{s.estatus === 'pendiente' && (
                        <Group gap={6} wrap="nowrap">
                          <Button size="xs" onClick={() => resolver.mutate({ id: s.id, accion: 'aprobar' })}>Aprobar</Button>
                          <Button size="xs" variant="default" onClick={() => resolver.mutate({ id: s.id, accion: 'rechazar' })}>Rechazar</Button>
                        </Group>
                      )}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
