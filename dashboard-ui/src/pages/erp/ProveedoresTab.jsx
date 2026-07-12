import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Group } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';

export default function ProveedoresTab() {
  const qc = useQueryClient();
  const [f, setF] = useState({ nombre: '', rfc: '', telefono: '', email: '', dias_credito: 0 });

  const { data: proveedores = [] } = useQuery({
    queryKey: ['erp-proveedores'],
    queryFn: () => api.get('/api/erp/proveedores'),
  });

  const crear = useMutation({
    mutationFn: () => api.post('/api/erp/proveedores', f),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setF({ nombre: '', rfc: '', telefono: '', email: '', dias_credito: 0 });
      qc.invalidateQueries({ queryKey: ['erp-proveedores'] });
    },
    onError: handleApiError,
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20, alignItems: 'start' }}>
      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Nuevo proveedor</h3></div>
        <TextInput label="Nombre *" value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} mb="sm" />
        <TextInput label="RFC" value={f.rfc} onChange={e => setF({ ...f, rfc: e.target.value })} mb="sm" />
        <Group grow mb="sm">
          <TextInput label="Teléfono" value={f.telefono} onChange={e => setF({ ...f, telefono: e.target.value })} />
          <TextInput label="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
        </Group>
        <NumberInput label="Días de crédito" min={0} value={f.dias_credito} onChange={v => setF({ ...f, dias_credito: v || 0 })} mb="md" />
        <Button fullWidth onClick={() => crear.mutate()} disabled={!f.nombre.trim() || crear.isPending}>Guardar proveedor</Button>
      </Card>

      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Proveedores</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>RFC</th><th>Contacto</th><th>Crédito</th></tr></thead>
            <tbody>
              {proveedores.length === 0 && <tr><td colSpan={4} className="empty">Sin proveedores todavía<span className="empty-accion">← Registra el primero con el formulario, o cárgalos desde una factura XML en Compras</span></td></tr>}
              {proveedores.map(pr => (
                <tr key={pr.id}>
                  <td><strong>{pr.nombre}</strong></td>
                  <td className="text-muted">{pr.rfc || '-'}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>{pr.telefono || pr.email || '-'}</td>
                  <td>{pr.dias_credito > 0 ? pr.dias_credito + ' días' : 'Contado'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
