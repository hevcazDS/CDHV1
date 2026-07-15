import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, Textarea, Group, Select, Text, Skeleton, Table } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { prompt, toastOk } from '../lib/ui';
import EstatusMenu from '../components/EstatusMenu';
import { fdate } from '../lib/format';

const ESTATUS_OS = ['abierta', 'en_curso', 'completada', 'cancelada'];

// Órdenes de servicio (mantenimiento/servicios): qué se encargó, quién lo
// atiende y QUÉ SE HIZO al cerrar — la evidencia del trabajo.
export default function OrdenesServicio() {
  const qc = useQueryClient();
  const [nueva, setNueva] = useState({ cliente_nombre: '', telefono: '', descripcion: '', id_empleado: '' });

  const { data: ordenes } = useQuery({ queryKey: ['ordenes-servicio'], queryFn: () => api.get('/api/ordenes-servicio') });
  const { data: empleados = [] } = useQuery({ queryKey: ['citas-empleados'], queryFn: () => api.get('/api/citas/empleados').catch(() => []) });

  const crear = useMutation({
    mutationFn: () => api.post('/api/ordenes-servicio', { ...nueva, id_empleado: nueva.id_empleado ? Number(nueva.id_empleado) : undefined }),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      toastOk('Orden ' + r.folio + ' creada');
      setNueva({ cliente_nombre: '', telefono: '', descripcion: '', id_empleado: '' });
      qc.invalidateQueries({ queryKey: ['ordenes-servicio'] });
    },
    onError: handleApiError,
  });

  const actualizar = useMutation({
    mutationFn: ({ id, datos }) => api.put(`/api/ordenes-servicio/${id}`, datos),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['ordenes-servicio'] }); },
    onError: handleApiError,
  });

  // Al completar, se pide QUÉ SE HIZO (la evidencia) en el mismo gesto.
  const cambiarEstatus = async (o, estatus) => {
    if (estatus === 'completada') {
      const hecho = await prompt({ titulo: 'Trabajo realizado', mensaje: 'Describe qué se hizo (queda como evidencia en la orden):', valorInicial: o.trabajo_realizado || '' });
      if (hecho === null) return;
      actualizar.mutate({ id: o.id, datos: { estatus, trabajo_realizado: hecho } });
      return;
    }
    actualizar.mutate({ id: o.id, datos: { estatus } });
  };

  if (!ordenes) return (
    <div className="sin-scroll">
      <div className="page-title">Órdenes de servicio</div>
      <Skeleton height={220} radius="md" mt="md" />
    </div>
  );

  return (
    <div className="sin-scroll">
      <div className="page-title">Órdenes de servicio</div>
      <div className="page-sub">Qué se encargó, quién lo atiende y qué se hizo — la evidencia del trabajo</div>
      <div className="split-2w">
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Nueva orden</h3></div>
          <Group grow mb="sm">
            <TextInput label="Cliente" value={nueva.cliente_nombre} onChange={e => setNueva({ ...nueva, cliente_nombre: e.target.value })} />
            <TextInput label="Teléfono" value={nueva.telefono} onChange={e => setNueva({ ...nueva, telefono: e.target.value })} />
          </Group>
          <Textarea label="Trabajo encargado *" autosize minRows={3} mb="sm"
            placeholder="Ej: revisar 2 contactos sin corriente en cocina y cambiar 3 breakers del centro de carga"
            value={nueva.descripcion} onChange={e => setNueva({ ...nueva, descripcion: e.target.value })} />
          <Select label="Atiende" placeholder="Sin asignar" clearable mb="md"
            data={empleados.map(e => ({ value: String(e.id), label: e.nombre + (e.puesto ? ' · ' + e.puesto : '') }))}
            value={nueva.id_empleado || null} onChange={v => setNueva({ ...nueva, id_empleado: v || '' })} />
          <Button fullWidth onClick={() => crear.mutate()} disabled={!nueva.descripcion.trim() || crear.isPending}>Crear orden</Button>
        </Card>

        <Card withBorder radius="md" p="lg" className="card sin-scroll-card">
          <div className="card-header"><h3>Órdenes</h3></div>
          <div className="table-wrap page-scrollable">
            <Table highlightOnHover verticalSpacing="xs">
              <thead><tr><th>Folio</th><th>Cliente</th><th>Encargo</th><th>Atiende</th><th>Estatus</th><th>Creada</th></tr></thead>
              <tbody>
                {ordenes.length === 0 && <tr><td colSpan={6} className="empty">Sin órdenes todavía — crea la primera a la izquierda</td></tr>}
                {ordenes.map(o => (
                  <tr key={o.id}>
                    <td><span className="folio">{o.folio}</span></td>
                    <td><strong>{o.cliente_nombre || '—'}</strong></td>
                    <td style={{ maxWidth: 260 }}>
                      <Text size="sm" lineClamp={2}>{o.descripcion}</Text>
                      {o.trabajo_realizado && <Text size="xs" c="var(--green)" lineClamp={1}>✓ {o.trabajo_realizado}</Text>}
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{o.empleado_nombre || '—'}</td>
                    <td><EstatusMenu value={o.estatus} opciones={ESTATUS_OS} onChange={v => cambiarEstatus(o, v)} /></td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{fdate(o.creado_en)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
