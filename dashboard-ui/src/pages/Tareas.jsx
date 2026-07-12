import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, TextInput, Select, Group, Button, Text, Checkbox, Textarea, SegmentedControl } from '@mantine/core';
import { Trash2, ClipboardList } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { esAdminOMas, etiquetaRol } from '../lib/permisos';
import { toastErr } from '../lib/ui';
import { fdate } from '../lib/format';

// Tareas y recordatorios (Ola 2): el Administrador asigna trabajo a un área o
// a una persona; cada quien ve y palomea lo suyo. Un especialista (almacén,
// cajero...) crea aquí sus propios recordatorios con fecha — los de almacén
// aparecen además en su calendario.
const AREAS_ASIGNABLES = [
  { value: 'almacen', label: 'Almacén' }, { value: 'pos', label: 'Mostrador / Caja' },
  { value: 'operacion', label: 'Operación / Pedidos' }, { value: 'compras', label: 'Compras' },
  { value: 'rrhh', label: 'Recursos Humanos' }, { value: 'finanzas', label: 'Finanzas' },
];

export default function Tareas() {
  const { user } = useAuth();
  const esAdmin = esAdminOMas(user?.rol);
  const qc = useQueryClient();
  const [vista, setVista] = useState('mias'); // mias | todas (solo admin)

  const { data: tareas = [] } = useQuery({
    queryKey: ['tareas', vista],
    queryFn: () => api.get(`/api/tareas${vista === 'todas' ? '?todas=1' : ''}`),
  });
  const { data: usuarios = [] } = useQuery({
    queryKey: ['prime-usuarios'],
    queryFn: () => api.get('/api/prime/usuarios').catch(() => []),
    enabled: esAdmin,
  });

  const [form, setForm] = useState({ titulo: '', notas: '', fecha: '', asignar: '' });
  const invalidar = () => { qc.invalidateQueries({ queryKey: ['tareas'] }); qc.invalidateQueries({ queryKey: ['tareas-pendientes-count'] }); };
  const crear = useMutation({
    mutationFn: () => {
      const esArea = form.asignar.startsWith('area:');
      return api.post('/api/tareas', {
        titulo: form.titulo, notas: form.notas, fecha: form.fecha || null,
        area: esArea ? form.asignar.slice(5) : null,
        asignado_a: !esArea && form.asignar ? form.asignar : null,
      });
    },
    onSuccess: (r) => { if (r.ok === false) return toastErr(r.error); setForm({ titulo: '', notas: '', fecha: '', asignar: '' }); invalidar(); },
    onError: (e) => toastErr(e.message),
  });
  const palomear = useMutation({
    mutationFn: ({ id, hecha }) => api.put(`/api/tareas/${id}`, { estatus: hecha ? 'hecha' : 'pendiente' }),
    onSuccess: invalidar,
  });
  const borrar = useMutation({
    mutationFn: (id) => api.del(`/api/tareas/${id}`),
    onSuccess: invalidar,
  });

  const opcionesAsignar = [
    ...AREAS_ASIGNABLES.map(a => ({ value: 'area:' + a.value, label: '👥 ' + a.label })),
    ...usuarios.map(u => ({ value: u.username, label: u.username + ' (' + etiquetaRol(u.rol) + ')' })),
  ];
  const pendientes = tareas.filter(t => t.estatus === 'pendiente');
  const hechas = tareas.filter(t => t.estatus === 'hecha');
  const quien = (t) => t.area ? (AREAS_ASIGNABLES.find(a => a.value === t.area)?.label || t.area) : (t.asignado_a || '—');

  return (
    <div>
      <div className="page-header">
        <h2><ClipboardList size={18} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 8 }} />Tareas y recordatorios</h2>
        {esAdmin && (
          <SegmentedControl size="xs" value={vista} onChange={setVista}
            data={[{ value: 'mias', label: 'Mías' }, { value: 'todas', label: 'Todas (seguimiento)' }]} />
        )}
      </div>

      <Card withBorder radius="md" p="lg" className="card" mb="lg">
        <Group align="end" gap="sm" wrap="wrap">
          <TextInput label={esAdmin ? 'Tarea' : 'Recordatorio'} placeholder={esAdmin ? 'Ej. acomodar la mercancía nueva' : 'Ej. mandar mercancía a sucursal Centro'}
            value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} style={{ flex: 2, minWidth: 220 }} />
          <TextInput type="date" label="Fecha (opcional)" value={form.fecha}
            onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
          {esAdmin && (
            <Select label="Asignar a" placeholder="Para mí" data={opcionesAsignar} value={form.asignar || null}
              onChange={v => setForm(f => ({ ...f, asignar: v || '' }))} clearable searchable style={{ minWidth: 200 }} />
          )}
          <Button onClick={() => crear.mutate()} disabled={!form.titulo.trim() || crear.isPending}>Agregar</Button>
        </Group>
        <Textarea mt="xs" placeholder="Notas (opcional)" autosize minRows={1}
          value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
        {!esAdmin && <Text size="xs" c="dimmed" mt="xs">Tus recordatorios con fecha aparecen también en el calendario de Almacén.</Text>}
      </Card>

      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Pendientes</h3><Text size="xs" c="dimmed">{pendientes.length}</Text></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ width: 36 }}></th><th>Tarea</th><th>Fecha</th><th>Asignada a</th><th>De</th><th></th></tr></thead>
            <tbody>
              {pendientes.length === 0 && <tr><td colSpan={6} className="empty">Sin pendientes 🎉</td></tr>}
              {pendientes.map(t => (
                <tr key={t.id}>
                  <td><Checkbox checked={false} onChange={() => palomear.mutate({ id: t.id, hecha: true })} title="Marcar hecha" aria-label="Marcar hecha" /></td>
                  <td><strong>{t.titulo}</strong>{t.notas && <div className="text-muted" style={{ fontSize: 12 }}>{t.notas}</div>}</td>
                  <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{t.fecha || '—'}</td>
                  <td>{quien(t)}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>{t.creado_por}</td>
                  <td>{(esAdmin || t.creado_por === user?.username) && (
                    <button className="btn btn-sm" title="Eliminar" onClick={() => borrar.mutate(t.id)}><Trash2 size={13} /></button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hechas.length > 0 && (
          <>
            <div className="card-header" style={{ marginTop: 18 }}><h3>Hechas</h3><Text size="xs" c="dimmed">{hechas.length}</Text></div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {hechas.map(t => (
                    <tr key={t.id} style={{ opacity: 0.55 }}>
                      <td style={{ width: 36 }}><Checkbox checked onChange={() => palomear.mutate({ id: t.id, hecha: false })} title="Regresar a pendiente" aria-label="Regresar a pendiente" /></td>
                      <td><s>{t.titulo}</s></td>
                      <td className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fdate(t.hecha_en)}</td>
                      <td>{quien(t)}</td>
                      <td>{(esAdmin || t.creado_por === user?.username) && (
                        <button className="btn btn-sm" title="Eliminar" onClick={() => borrar.mutate(t.id)}><Trash2 size={13} /></button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
