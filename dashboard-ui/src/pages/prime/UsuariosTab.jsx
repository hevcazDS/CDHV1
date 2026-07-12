// UsuariosTab.jsx — Tab "Usuarios" de Prime (soloPrime): alta/edición/borrado
// de cuentas del dashboard y cambio de rol (usuario/gerente/prime).
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import { Card, Title, Group, ActionIcon, Table, TextInput, PasswordInput, Select, Button } from '@mantine/core';
import { api } from '../../api';
import { Trash2, Pencil } from 'lucide-react';
import Modal from '../../components/Modal';
import { useAuth } from '../../context/AuthContext';

// Roles "altos" que SOLO un prime puede crear/asignar (espejo de
// ROLES_CREABLES_POR_GERENTE en el backend, dashboard/permisos.js). El backend
// ya responde 403 si un gerente los envía; aquí NO se los ofrecemos siquiera,
// para que la UI no mienta (brecha reportada: el Select los mostraba a un gerente).
const ROLES_ALTOS = ['gerente', 'prime', 'auditor'];
const ROLES_OPCIONES = [
    { value: 'cajero', label: 'Cajero (solo mostrador)' },
    { value: 'operador', label: 'Operador (bot + POS)' },
    { value: 'almacen', label: 'Almacén (inventario)' },
    { value: 'compras', label: 'Compras (OC/facturas)' },
    { value: 'rh', label: 'Recursos Humanos' },
    { value: 'contabilidad', label: 'Contabilidad (finanzas)' },
    { value: 'auditor', label: 'Auditor (solo lectura total — lo crea Prime)' },
    { value: 'gerente', label: 'Administrador' },
    { value: 'prime', label: 'Prime (dueño)' },
  ];
const ROLES_INLINE = [
    { value: 'cajero', label: 'Cajero' }, { value: 'operador', label: 'Operador' },
    { value: 'almacen', label: 'Almacén' }, { value: 'compras', label: 'Compras' },
    { value: 'rh', label: 'RH' }, { value: 'contabilidad', label: 'Contabilidad' }, { value: 'auditor', label: 'Auditor' },
    { value: 'gerente', label: 'Administrador' }, { value: 'prime', label: 'Prime' },
  ];

export default function UsuariosTab() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const esPrime = user?.rol === 'prime';
  // Solo prime ve/asigna roles altos; un gerente solo los operativos.
  const filtrarRoles = (arr) => esPrime ? arr : arr.filter(o => !ROLES_ALTOS.includes(o.value));
  const usuarioForm = useForm({ initialValues: { username: '', password: '', rol: 'operador', sucursal: '' } });
  const [msgUsuarios, setMsgUsuarios] = useState('');
  const [usuarioEditando, setUsuarioEditando] = useState(null);
  const editarUsuarioForm = useForm({ initialValues: { nombre: '', password: '', sucursal: '' } });
  const [msgEditarUsuario, setMsgEditarUsuario] = useState('');

  const { data: usuarios = [] } = useQuery({
    queryKey: ['prime-usuarios'],
    queryFn: () => api.get('/api/prime/usuarios'),
  });
  // Multitienda: el selector de tienda solo aparece con 2+ sucursales
  const { data: sucursales = [] } = useQuery({
    queryKey: ['prime-sucursales'],
    queryFn: () => api.get('/api/prime/sucursales').catch(() => []),
  });
  const multitienda = sucursales.length > 1;
  const sucursalOpciones = [
    { value: '', label: 'Sucursal default' },
    ...sucursales.map(s => ({ value: s.nombre, label: s.nombre })),
  ];

  const crearUsuarioMutation = useMutation({
    mutationFn: (values) => api.post('/api/prime/usuarios', values),
    onSuccess: () => {
      usuarioForm.reset();
      queryClient.invalidateQueries({ queryKey: ['prime-usuarios'] });
    },
    onError: (e) => setMsgUsuarios(e.message),
  });
  const crearUsuario = () => {
    setMsgUsuarios('');
    const v = usuarioForm.values;
    crearUsuarioMutation.mutate(multitienda ? v : { username: v.username, password: v.password, rol: v.rol });
  };

  const cambiarRolUsuarioMutation = useMutation({
    mutationFn: ({ id, rol }) => api.put(`/api/prime/usuarios/${id}`, { rol }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-usuarios'] }),
    onError: (e) => setMsgUsuarios(e.message),
  });
  const cambiarRolUsuario = (id, rol) => cambiarRolUsuarioMutation.mutate({ id, rol });

  const borrarUsuarioMutation = useMutation({
    mutationFn: (id) => api.del(`/api/prime/usuarios/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-usuarios'] }),
    onError: (e) => setMsgUsuarios(e.message),
  });
  const borrarUsuario = (id) => borrarUsuarioMutation.mutate(id);

  const editarUsuarioMutation = useMutation({
    mutationFn: ({ id, datos }) => api.put(`/api/prime/usuarios/${id}`, datos),
    onSuccess: () => {
      setUsuarioEditando(null);
      queryClient.invalidateQueries({ queryKey: ['prime-usuarios'] });
    },
    onError: (e) => setMsgEditarUsuario(e.message),
  });
  const abrirEdicionUsuario = (u) => {
    setMsgEditarUsuario('');
    editarUsuarioForm.setValues({ nombre: u.nombre || '', password: '', sucursal: u.sucursal || '' });
    setUsuarioEditando(u);
  };
  const guardarEdicionUsuario = () => {
    setMsgEditarUsuario('');
    const v = editarUsuarioForm.values;
    const datos = {};
    if (v.nombre.trim()) datos.nombre = v.nombre.trim();
    if (v.password) {
      if (v.password.length < 8) { setMsgEditarUsuario('La nueva contraseña debe tener al menos 8 caracteres.'); return; }
      datos.password = v.password;
    }
    if (multitienda && v.sucursal !== (usuarioEditando.sucursal || '')) datos.sucursal = v.sucursal;
    if (!Object.keys(datos).length) { setMsgEditarUsuario('Nada que actualizar.'); return; }
    editarUsuarioMutation.mutate({ id: usuarioEditando.id, datos });
  };

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb={4}>Usuarios del dashboard</Title>
      <p className="page-sub" style={{ margin: '4px 0 16px' }}>
        Crea cuentas con rol admin (operación) o prime (acceso total). No puedes borrar tu propia
        cuenta ni dejar el sistema sin ningún usuario prime.
      </p>
      {msgUsuarios && <div className="login-error" style={{ marginBottom: 12 }}>{msgUsuarios}</div>}
      <Group gap="xs" mb="md" align="flex-end" wrap="wrap">
        <TextInput placeholder="Usuario" {...usuarioForm.getInputProps('username')} style={{ minWidth: 160 }} />
        <PasswordInput placeholder="Password (mín. 8)" {...usuarioForm.getInputProps('password')} style={{ minWidth: 160 }} />
        <Select data={filtrarRoles(ROLES_OPCIONES)} style={{ minWidth: 220 }}
          allowDeselect={false} {...usuarioForm.getInputProps('rol')} />
        {multitienda && (
          <Select data={sucursalOpciones} style={{ minWidth: 180 }} placeholder="Sucursal"
            allowDeselect={false} {...usuarioForm.getInputProps('sucursal')} />
        )}
        <Button disabled={!usuarioForm.values.username.trim() || !usuarioForm.values.password} onClick={crearUsuario}>
          Crear usuario
        </Button>
      </Group>
      <div className="table-wrap">
        <Table highlightOnHover verticalSpacing="xs">
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th>{multitienda && <th>Sucursal</th>}<th>Creado</th><th></th></tr></thead>
          <tbody>
            {usuarios.length === 0 && <tr><td colSpan={multitienda ? 6 : 5} className="empty">Sin usuarios</td></tr>}
            {usuarios.map(u => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.nombre || '—'}</td>
                <td>
                  {(!esPrime && ROLES_ALTOS.includes(u.rol)) ? (
                    // Un gerente NO puede tocar el rol de un usuario alto (el backend
                    // lo bloquea); se muestra solo-lectura para no ofrecer algo que dará 403.
                    <span className="chip" style={{ textTransform: 'capitalize' }}>{u.rol === 'gerente' ? 'Administrador' : u.rol}</span>
                  ) : (
                    <Select
                      size="xs"
                      data={filtrarRoles(ROLES_INLINE)}
                      value={u.rol}
                      onChange={v => v && cambiarRolUsuario(u.id, v)}
                      allowDeselect={false}
                      comboboxProps={{ withinPortal: true }}
                    />
                  )}
                </td>
                {multitienda && <td>{u.sucursal || 'Default'}</td>}
                <td>{u.creado_en}</td>
                <td>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon variant="default" title="Editar" onClick={() => abrirEdicionUsuario(u)}><Pencil size={16} strokeWidth={1.75} /></ActionIcon>
                    <ActionIcon variant="default" color="red" title="Borrar" onClick={() => borrarUsuario(u.id)}><Trash2 size={16} strokeWidth={1.75} /></ActionIcon>
                  </Group>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {usuarioEditando && (
        <Modal title={`Editar — ${usuarioEditando.username}`} onClose={() => setUsuarioEditando(null)}
          actions={<>
            <Button variant="default" onClick={() => setUsuarioEditando(null)}>Cancelar</Button>
            <Button onClick={guardarEdicionUsuario}>Guardar</Button>
          </>}>
          {msgEditarUsuario && <div className="login-error" style={{ marginBottom: 12 }}>{msgEditarUsuario}</div>}
          <TextInput label="Nombre" {...editarUsuarioForm.getInputProps('nombre')} mb="sm" />
          <PasswordInput label="Nueva contraseña (dejar vacío para no cambiar)" {...editarUsuarioForm.getInputProps('password')} />
          {multitienda && (
            <Select label="Sucursal" data={sucursalOpciones} mt="sm"
              allowDeselect={false} {...editarUsuarioForm.getInputProps('sucursal')} />
          )}
        </Modal>
      )}
    </Card>
  );
}
