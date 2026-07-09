// SucursalesTab.jsx — Tab "Sucursales" de Prime: alta/edición/activar/borrar
// de tiendas/bodegas (catálogo de sucursales físicas).
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import { Card, Title, Group, ActionIcon, Table, Badge, TextInput, Button } from '@mantine/core';
import { Pencil, Play, Pause, Trash2 } from 'lucide-react';
import { api } from '../../api';
import Modal from '../../components/Modal';

export default function SucursalesTab() {
  const queryClient = useQueryClient();
  const sucursalForm = useForm({ initialValues: { nombre: '', codigo: '', direccion: '', codigo_postal: '' } });
  const [msgSucursales, setMsgSucursales] = useState('');
  const [sucursalEditando, setSucursalEditando] = useState(null);
  const editarSucursalForm = useForm({ initialValues: { nombre: '', codigo: '', direccion: '', codigo_postal: '' } });
  const [msgEditarSucursal, setMsgEditarSucursal] = useState('');

  const { data: sucursales = [] } = useQuery({
    queryKey: ['prime-sucursales'],
    queryFn: () => api.get('/api/prime/sucursales'),
  });

  const crearSucursalMutation = useMutation({
    mutationFn: (values) => api.post('/api/prime/sucursales', {
      nombre: values.nombre,
      codigo: values.codigo || undefined,
      direccion: values.direccion || undefined,
      codigo_postal: values.codigo_postal || undefined,
    }),
    onSuccess: () => {
      sucursalForm.reset();
      queryClient.invalidateQueries({ queryKey: ['prime-sucursales'] });
    },
    onError: (e) => setMsgSucursales(e.message),
  });
  const crearSucursal = () => { setMsgSucursales(''); crearSucursalMutation.mutate(sucursalForm.values); };

  const toggleSucursalMutation = useMutation({
    mutationFn: ({ id, activa }) => api.put(`/api/prime/sucursales/${id}`, { activa }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-sucursales'] }),
    onError: (e) => setMsgSucursales(e.message),
  });
  const toggleSucursal = (id, activa) => toggleSucursalMutation.mutate({ id, activa });

  const editarSucursalMutation = useMutation({
    mutationFn: ({ id, datos }) => api.put(`/api/prime/sucursales/${id}`, datos),
    onSuccess: () => {
      setSucursalEditando(null);
      queryClient.invalidateQueries({ queryKey: ['prime-sucursales'] });
    },
    onError: (e) => setMsgEditarSucursal(e.message),
  });
  const abrirEdicionSucursal = (s) => {
    setMsgEditarSucursal('');
    editarSucursalForm.setValues({
      nombre: s.nombre || '', codigo: s.codigo || '', direccion: s.direccion || '', codigo_postal: s.codigo_postal || '',
    });
    setSucursalEditando(s);
  };
  const guardarEdicionSucursal = () => {
    setMsgEditarSucursal('');
    const v = editarSucursalForm.values;
    if (!v.nombre.trim()) { setMsgEditarSucursal('El nombre es obligatorio.'); return; }
    editarSucursalMutation.mutate({
      id: sucursalEditando.id,
      datos: {
        nombre: v.nombre, codigo: v.codigo || undefined, direccion: v.direccion || undefined,
        codigo_postal: v.codigo_postal || undefined,
      },
    });
  };

  const borrarSucursalMutation = useMutation({
    mutationFn: (id) => api.del(`/api/prime/sucursales/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-sucursales'] }),
    onError: (e) => setMsgSucursales(e.message),
  });
  const borrarSucursal = (id) => borrarSucursalMutation.mutate(id);

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb={4}>Sucursales</Title>
      <p className="page-sub" style={{ margin: '4px 0 16px' }}>
        Registro de tiendas/bodegas. Desactiva en vez de borrar si ya tiene movimientos de inventario.
      </p>
      {msgSucursales && <div className="login-error" style={{ marginBottom: 12 }}>{msgSucursales}</div>}
      <Group gap="xs" mb="md" align="flex-end" wrap="wrap">
        <TextInput placeholder="Nombre" {...sucursalForm.getInputProps('nombre')} style={{ flex: 1, minWidth: 160 }} />
        <TextInput placeholder="Código (opcional)" {...sucursalForm.getInputProps('codigo')} style={{ width: 140 }} />
        <TextInput placeholder="Dirección (opcional)" {...sucursalForm.getInputProps('direccion')} style={{ flex: 1, minWidth: 200 }} />
        <TextInput placeholder="C.P. (opcional)" {...sucursalForm.getInputProps('codigo_postal')} style={{ width: 110 }} />
        <Button disabled={!sucursalForm.values.nombre.trim()} onClick={crearSucursal}>Agregar</Button>
      </Group>
      <div className="table-wrap">
        <Table highlightOnHover verticalSpacing="xs">
          <thead><tr><th>Nombre</th><th>Código</th><th>Dirección</th><th>C.P.</th><th>Activa</th><th></th></tr></thead>
          <tbody>
            {sucursales.length === 0 && <tr><td colSpan={6} className="empty">Sin sucursales</td></tr>}
            {sucursales.map(s => (
              <tr key={s.id}>
                <td>{s.nombre}</td>
                <td>{s.codigo || ''}</td>
                <td>{s.direccion || ''}</td>
                <td>{s.codigo_postal || ''}</td>
                <td><Badge color={s.activa ? 'teal' : 'red'} variant="light">{s.activa ? 'sí' : 'no'}</Badge></td>
                <td>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon variant="default" title="Editar" onClick={() => abrirEdicionSucursal(s)}><Pencil size={16} strokeWidth={1.75} /></ActionIcon>
                    <ActionIcon variant="default" title={s.activa ? 'Desactivar' : 'Activar'} onClick={() => toggleSucursal(s.id, !s.activa)}>
                      {s.activa ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
                    </ActionIcon>
                    <ActionIcon variant="default" color="red" title="Borrar" onClick={() => borrarSucursal(s.id)}><Trash2 size={16} strokeWidth={1.75} /></ActionIcon>
                  </Group>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {sucursalEditando && (
        <Modal title={`Editar — ${sucursalEditando.nombre}`} onClose={() => setSucursalEditando(null)}
          actions={<>
            <Button variant="default" onClick={() => setSucursalEditando(null)}>Cancelar</Button>
            <Button onClick={guardarEdicionSucursal}>Guardar</Button>
          </>}>
          {msgEditarSucursal && <div className="login-error" style={{ marginBottom: 12 }}>{msgEditarSucursal}</div>}
          <TextInput label="Nombre" {...editarSucursalForm.getInputProps('nombre')} mb="sm" />
          <Group grow mb="sm">
            <TextInput label="Código" {...editarSucursalForm.getInputProps('codigo')} />
            <TextInput label="Código postal" {...editarSucursalForm.getInputProps('codigo_postal')} />
          </Group>
          <TextInput label="Dirección" {...editarSucursalForm.getInputProps('direccion')} />
        </Modal>
      )}
    </Card>
  );
}
