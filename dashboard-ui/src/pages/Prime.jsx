import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import {
  Card, Title, Group, ActionIcon, Table, Badge, Switch,
  TextInput, NumberInput, PasswordInput, Select, Textarea, Button,
} from '@mantine/core';
import { api } from '../api';
import { useTextoEmoji } from '../context/EmojiContext';

const CATEGORIAS_FILTRO = [
  { valor: 'bw_word',   etiqueta: 'Lista negra — palabra corta (match exacto)' },
  { valor: 'bw_long',   etiqueta: 'Lista negra — frase larga (substring)' },
  { valor: 'risk',      etiqueta: 'Riesgo (puntos acumulables)' },
  { valor: 'queja_l1',  etiqueta: 'Queja — nivel 1' },
  { valor: 'queja_l2',  etiqueta: 'Queja — nivel 2 (pedir humano)' },
];

export default function Prime() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [costoDefault, setCostoDefault] = useState('');
  const [idPedido, setIdPedido] = useState('');
  const [costoPedido, setCostoPedido] = useState('');
  const [nombreNegocio, setNombreNegocio] = useState('');
  const [diasEntrega, setDiasEntrega] = useState('');
  const [msg, setMsg] = useState('');

  // ── Reconexión automática de WhatsApp ────────────────────────────────────
  const [reconexionAuto, setReconexionAuto] = useState(false);
  const [msgReconexion, setMsgReconexion] = useState('');

  const [nuevaCategoria, setNuevaCategoria] = useState('bw_word');
  const [nuevaPalabra, setNuevaPalabra] = useState('');
  const [nuevosPuntos, setNuevosPuntos] = useState('1');
  const [msgFiltro, setMsgFiltro] = useState('');

  // ── Sucursales ──────────────────────────────────────────────────────────
  const sucursalForm = useForm({ initialValues: { nombre: '', codigo: '', direccion: '' } });
  const [msgSucursales, setMsgSucursales] = useState('');

  // ── Alta de productos ──────────────────────────────────────────────────
  const PRODUCTO_VACIO = {
    name: '', cat: '', price: '', url_imagen: '', tags: '', seo_description: '',
    edad_recomendada: '', edad_min: '', genero: '',
    stock_tienda: '0', stock_cedis: '0', stock_san_luis_potosi: '0',
  };
  const productoForm = useForm({ initialValues: PRODUCTO_VACIO });
  const [msgProducto, setMsgProducto] = useState('');

  // ── Usuarios del dashboard ──────────────────────────────────────────────
  const usuarioForm = useForm({ initialValues: { username: '', password: '', rol: 'admin' } });
  const [msgUsuarios, setMsgUsuarios] = useState('');

  // ── Stock mínimo por producto+sucursal ──────────────────────────────────
  const [buscarInventario, setBuscarInventario] = useState('');
  const [editandoMinimo, setEditandoMinimo] = useState({});
  const [msgInventario, setMsgInventario] = useState('');

  const { data: palabras = [] } = useQuery({
    queryKey: ['prime-palabras-filtro'],
    queryFn: () => api.get('/api/prime/palabras-filtro').then(d => d.items || []),
  });
  const { data: sucursales = [] } = useQuery({
    queryKey: ['prime-sucursales'],
    queryFn: () => api.get('/api/prime/sucursales'),
  });
  const { data: usuarios = [] } = useQuery({
    queryKey: ['prime-usuarios'],
    queryFn: () => api.get('/api/prime/usuarios'),
  });
  const { data: inventarios = [] } = useQuery({
    queryKey: ['prime-inventarios', buscarInventario],
    queryFn: () => {
      const qs = buscarInventario ? `?q=${encodeURIComponent(buscarInventario)}` : '';
      return api.get(`/api/prime/inventarios${qs}`);
    },
  });

  useEffect(() => {
    api.get('/api/prime/envio-default').then(d => setCostoDefault(String(d.costo_envio_default)));
    api.get('/api/prime/estafeta-dias-entrega').then(d => setDiasEntrega(String(d.dias_entrega)));
    api.get('/api/negocio').then(d => setNombreNegocio(d.nombre_negocio));
    api.get('/api/prime/config').then(d => setReconexionAuto(!!d.reconexion_auto_activo)).catch(() => {});
  }, []);

  const toggleReconexionAuto = async () => {
    setMsgReconexion('');
    const activo = !reconexionAuto;
    try {
      await api.post('/api/prime/config', { clave: 'reconexion_auto_activo', activo });
      setReconexionAuto(activo);
    } catch (e) { setMsgReconexion(e.message); }
  };

  const crearSucursalMutation = useMutation({
    mutationFn: (values) => api.post('/api/prime/sucursales', {
      nombre: values.nombre,
      codigo: values.codigo || undefined,
      direccion: values.direccion || undefined,
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

  const borrarSucursalMutation = useMutation({
    mutationFn: (id) => api.del(`/api/prime/sucursales/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-sucursales'] }),
    onError: (e) => setMsgSucursales(e.message),
  });
  const borrarSucursal = (id) => borrarSucursalMutation.mutate(id);

  const crearProductoMutation = useMutation({
    mutationFn: (v) => api.post('/api/prime/productos', {
      ...v,
      price: Number(v.price),
      edad_min: v.edad_min ? Number(v.edad_min) : undefined,
      stock_tienda: Number(v.stock_tienda || 0),
      stock_cedis: Number(v.stock_cedis || 0),
      stock_san_luis_potosi: Number(v.stock_san_luis_potosi || 0),
      cat: v.cat || undefined,
      url_imagen: v.url_imagen || undefined,
      tags: v.tags || undefined,
      seo_description: v.seo_description || undefined,
      edad_recomendada: v.edad_recomendada || undefined,
      genero: v.genero || undefined,
    }),
    onSuccess: (_, v) => {
      setMsgProducto(`Producto "${v.name}" creado.`);
      productoForm.reset();
    },
    onError: (e) => setMsgProducto(e.message),
  });
  const crearProducto = () => {
    setMsgProducto('');
    const v = productoForm.values;
    if (!v.name.trim() || !v.price) {
      setMsgProducto('Nombre y precio son obligatorios.');
      return;
    }
    crearProductoMutation.mutate(v);
  };

  const crearUsuarioMutation = useMutation({
    mutationFn: (values) => api.post('/api/prime/usuarios', values),
    onSuccess: () => {
      usuarioForm.reset();
      queryClient.invalidateQueries({ queryKey: ['prime-usuarios'] });
    },
    onError: (e) => setMsgUsuarios(e.message),
  });
  const crearUsuario = () => { setMsgUsuarios(''); crearUsuarioMutation.mutate(usuarioForm.values); };

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

  const agregarPalabraMutation = useMutation({
    mutationFn: () => api.post('/api/prime/palabras-filtro', {
      categoria: nuevaCategoria,
      palabra: nuevaPalabra,
      puntos: nuevaCategoria === 'risk' ? Number(nuevosPuntos) : undefined,
    }),
    onSuccess: () => {
      setNuevaPalabra('');
      queryClient.invalidateQueries({ queryKey: ['prime-palabras-filtro'] });
    },
    onError: (e) => setMsgFiltro(e.message),
  });
  const agregarPalabra = () => { setMsgFiltro(''); agregarPalabraMutation.mutate(); };

  const togglePalabraMutation = useMutation({
    mutationFn: ({ id, activo }) => api.put(`/api/prime/palabras-filtro/${id}`, { activo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-palabras-filtro'] }),
    onError: (e) => setMsgFiltro(e.message),
  });
  const togglePalabra = (id, activo) => togglePalabraMutation.mutate({ id, activo });

  const eliminarPalabraMutation = useMutation({
    mutationFn: (id) => api.del(`/api/prime/palabras-filtro/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prime-palabras-filtro'] }),
    onError: (e) => setMsgFiltro(e.message),
  });
  const eliminarPalabra = (id) => eliminarPalabraMutation.mutate(id);

  const guardarDefault = async () => {
    setMsg('');
    try {
      const d = await api.put('/api/prime/envio-default', { costo_envio: Number(costoDefault) });
      setMsg(`Costo de envío default actualizado a $${d.costo_envio_default}`);
    } catch (e) { setMsg(e.message); }
  };

  const guardarDiasEntrega = async () => {
    setMsg('');
    try {
      const d = await api.put('/api/prime/estafeta-dias-entrega', { dias_entrega: Number(diasEntrega) });
      setMsg(`Días de entrega Estafeta actualizados a ${d.dias_entrega}`);
    } catch (e) { setMsg(e.message); }
  };

  const guardarNegocio = async () => {
    setMsg('');
    try {
      const d = await api.put('/api/prime/negocio', { nombre_negocio: nombreNegocio });
      setMsg(`Nombre del negocio actualizado a "${d.nombre_negocio}"`);
    } catch (e) { setMsg(e.message); }
  };

  const guardarPedido = async () => {
    setMsg('');
    try {
      const d = await api.put(`/api/prime/envio/${idPedido}`, { costo_envio: Number(costoPedido) });
      setMsg(`Pedido #${d.id_pedido} actualizado a $${d.costo_envio}`);
    } catch (e) { setMsg(e.message); }
  };

  const guardarStockMinimoMutation = useMutation({
    mutationFn: ({ id, valor }) => api.put(`/api/prime/inventarios/${id}`, { stock_minimo: valor }),
    onSuccess: (_, { id }) => {
      setEditandoMinimo(prev => { const next = { ...prev }; delete next[id]; return next; });
      queryClient.invalidateQueries({ queryKey: ['prime-inventarios'] });
    },
    onError: (e) => setMsgInventario(e.message),
  });
  const guardarStockMinimo = (id) => {
    setMsgInventario('');
    const valor = Number(editandoMinimo[id]);
    if (!Number.isFinite(valor) || valor < 0) { setMsgInventario('stock_minimo inválido'); return; }
    guardarStockMinimoMutation.mutate({ id, valor });
  };

  return (
    <div>
      <div className="page-title">Prime</div>
      <div className="page-sub">Configuración avanzada — visible solo para el rol prime</div>
      {msg && <div className="card" style={{ marginBottom: 20 }}>{msg}</div>}

      <Card withBorder radius="md" p="lg" mb={20} maw={420}>
        <Title order={4} mb={4}>Nombre del negocio</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Se muestra en el panel (sidebar). Útil si se revende este sistema a otra juguetería.
        </p>
        <TextInput maxLength={80} value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)} mb="sm" />
        <Button onClick={guardarNegocio}>Guardar</Button>
      </Card>

      <Card withBorder radius="md" p="lg" mb={20} maw={420}>
        <Title order={4} mb={4}>Costo de envío default</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Se aplica a pedidos nuevos. No requiere un pedido específico.
        </p>
        <NumberInput min={0} value={costoDefault === '' ? '' : Number(costoDefault)} onChange={v => setCostoDefault(v === '' ? '' : String(v))} mb="sm" />
        <Button onClick={guardarDefault}>Guardar</Button>
      </Card>

      <Card withBorder radius="md" p="lg" mb={20} maw={420}>
        <Title order={4} mb={4}>Días de entrega Estafeta</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Días hábiles que se suman para estimar la fecha de entrega. Sube este número en
          fechas como navidad si los pedidos se van a retrasar más de lo normal.
        </p>
        <NumberInput min={1} max={30} value={diasEntrega === '' ? '' : Number(diasEntrega)} onChange={v => setDiasEntrega(v === '' ? '' : String(v))} mb="sm" />
        <Button onClick={guardarDiasEntrega}>Guardar</Button>
      </Card>

      <Card withBorder radius="md" p="lg" mb={20} maw={480}>
        <Title order={4} mb={4}>Reconexión automática de WhatsApp</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Por defecto, si WhatsApp se desconecta el bot se queda detenido hasta que alguien lo
          reinicie manualmente desde el widget de estatus. Activa esto si prefieres que el bot
          intente reconectarse solo (en el mismo proceso) cuando no haya nadie pendiente de él —
          a cambio de un riesgo pequeño de quedar con un Chrome zombie si la desconexión fue por
          un perfil corrupto.
        </p>
        {msgReconexion && <div className="login-error" style={{ marginBottom: 12 }}>{msgReconexion}</div>}
        <Group gap="sm">
          <Switch checked={reconexionAuto} onChange={toggleReconexionAuto} color="blue" />
          <Badge color={reconexionAuto ? 'teal' : 'red'} variant="light">{txt(reconexionAuto ? '✅ Activa' : '⛔ Inactiva')}</Badge>
        </Group>
      </Card>

      <Card withBorder radius="md" p="lg" maw={420}>
        <Title order={4} mb={4}>Corregir un pedido puntual (opcional)</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Solo si Estafeta cotizó distinto a la simulación para un pedido ya creado.
        </p>
        <NumberInput label="ID de pedido" value={idPedido === '' ? '' : Number(idPedido)} onChange={v => setIdPedido(v === '' ? '' : String(v))} mb="sm" />
        <NumberInput label="Costo de envío" min={0} value={costoPedido === '' ? '' : Number(costoPedido)} onChange={v => setCostoPedido(v === '' ? '' : String(v))} mb="sm" />
        <Button disabled={!idPedido} onClick={guardarPedido}>Actualizar pedido</Button>
      </Card>

      <Card withBorder radius="md" p="lg" mt={20} maw={720}>
        <Title order={4} mb={4}>Lista negra y frases de queja</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Las palabras marcadas "código fuente" son fijas y no se pueden borrar ni desactivar —
          ya las aplica el bot siempre. Agrega aquí palabras nuevas para enriquecerlas;
          el bot las toma en cuenta automáticamente (refresco cada 60s).
        </p>
        {msgFiltro && <div className="login-error" style={{ marginBottom: 12 }}>{msgFiltro}</div>}

        <Group gap="xs" mb="md" align="flex-end" wrap="wrap">
          <Select
            data={CATEGORIAS_FILTRO.map(c => ({ value: c.valor, label: c.etiqueta }))}
            value={nuevaCategoria}
            onChange={v => v && setNuevaCategoria(v)}
            allowDeselect={false}
            style={{ minWidth: 260 }}
          />
          <TextInput
            placeholder="palabra o frase"
            value={nuevaPalabra}
            onChange={e => setNuevaPalabra(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          {nuevaCategoria === 'risk' && (
            <NumberInput min={1} max={10} value={Number(nuevosPuntos)} onChange={v => setNuevosPuntos(String(v))} title="Puntos de riesgo" style={{ width: 90 }} />
          )}
          <Button disabled={!nuevaPalabra.trim()} onClick={agregarPalabra}>Agregar</Button>
        </Group>

        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Palabra / frase</th>
                <th>Puntos</th>
                <th>Origen</th>
                <th>Activa</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {palabras.length === 0 && <tr><td colSpan={6} className="empty">Sin palabras</td></tr>}
              {palabras.map((p, i) => (
                <tr key={p.id ?? `base-${i}`}>
                  <td>{p.categoria}</td>
                  <td>{p.palabra}</td>
                  <td>{p.puntos ?? ''}</td>
                  <td>{p.origen === 'codigo_fuente' ? 'código fuente' : 'agregado'}</td>
                  <td><Badge color={p.activo ? 'teal' : 'red'} variant="light">{p.activo ? 'sí' : 'no'}</Badge></td>
                  <td>
                    {p.origen === 'dashboard' && (
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon variant="default" title={p.activo ? 'Desactivar' : 'Activar'} onClick={() => togglePalabra(p.id, !p.activo)}>
                          {p.activo ? '⏸️' : '▶️'}
                        </ActionIcon>
                        <ActionIcon variant="default" color="red" title="Borrar" onClick={() => eliminarPalabra(p.id)}>🗑️</ActionIcon>
                      </Group>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card withBorder radius="md" p="lg" mt={20} maw={720}>
        <Title order={4} mb={4}>Sucursales</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Registro de tiendas/bodegas. Desactiva en vez de borrar si ya tiene movimientos de inventario.
        </p>
        {msgSucursales && <div className="login-error" style={{ marginBottom: 12 }}>{msgSucursales}</div>}
        <Group gap="xs" mb="md" align="flex-end" wrap="wrap">
          <TextInput placeholder="Nombre" {...sucursalForm.getInputProps('nombre')} style={{ flex: 1, minWidth: 160 }} />
          <TextInput placeholder="Código (opcional)" {...sucursalForm.getInputProps('codigo')} style={{ width: 140 }} />
          <TextInput placeholder="Dirección (opcional)" {...sucursalForm.getInputProps('direccion')} style={{ flex: 1, minWidth: 200 }} />
          <Button disabled={!sucursalForm.values.nombre.trim()} onClick={crearSucursal}>Agregar</Button>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Nombre</th><th>Código</th><th>Dirección</th><th>Activa</th><th></th></tr></thead>
            <tbody>
              {sucursales.length === 0 && <tr><td colSpan={5} className="empty">Sin sucursales</td></tr>}
              {sucursales.map(s => (
                <tr key={s.id}>
                  <td>{s.nombre}</td>
                  <td>{s.codigo || ''}</td>
                  <td>{s.direccion || ''}</td>
                  <td><Badge color={s.activa ? 'teal' : 'red'} variant="light">{s.activa ? 'sí' : 'no'}</Badge></td>
                  <td>
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon variant="default" title={s.activa ? 'Desactivar' : 'Activar'} onClick={() => toggleSucursal(s.id, !s.activa)}>
                        {s.activa ? '⏸️' : '▶️'}
                      </ActionIcon>
                      <ActionIcon variant="default" color="red" title="Borrar" onClick={() => borrarSucursal(s.id)}>🗑️</ActionIcon>
                    </Group>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card withBorder radius="md" p="lg" mt={20} maw={720}>
        <Title order={4} mb={4}>Stock mínimo por sucursal</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Umbral que dispara la alerta automática al asesor cuando el stock de un producto
          en una sucursal cae a este nivel o menos. En 0, la alerta queda desactivada para esa fila.
        </p>
        {msgInventario && <div className="login-error" style={{ marginBottom: 12 }}>{msgInventario}</div>}
        <TextInput
          placeholder="Buscar producto..."
          value={buscarInventario}
          onChange={e => setBuscarInventario(e.target.value)}
          mb="md"
        />
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Producto</th><th>Sucursal</th><th>Stock</th><th>Stock mínimo</th><th></th></tr></thead>
            <tbody>
              {inventarios.length === 0 && <tr><td colSpan={5} className="empty">Sin resultados</td></tr>}
              {inventarios.map(i => (
                <tr key={i.id}>
                  <td>{i.producto}</td>
                  <td>{i.sucursal}</td>
                  <td>{i.stock}</td>
                  <td>
                    <NumberInput
                      min={0}
                      size="xs"
                      style={{ width: 90 }}
                      value={Number(editandoMinimo[i.id] ?? i.stock_minimo)}
                      onChange={v => setEditandoMinimo(prev => ({ ...prev, [i.id]: v }))}
                    />
                  </td>
                  <td><Button size="xs" variant="default" onClick={() => guardarStockMinimo(i.id)}>Guardar</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card withBorder radius="md" p="lg" mt={20} maw={720}>
        <Title order={4} mb={4}>Alta de producto</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Agrega un producto puntual al catálogo (la carga masiva sigue siendo aparte).
        </p>
        {msgProducto && <div style={{ marginBottom: 12 }}>{msgProducto}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <TextInput placeholder="Nombre *" {...productoForm.getInputProps('name')} />
          <TextInput type="number" min={0} step="0.01" placeholder="Precio *" {...productoForm.getInputProps('price')} />
          <TextInput placeholder="Categoría" {...productoForm.getInputProps('cat')} />
          <TextInput placeholder="Género" {...productoForm.getInputProps('genero')} />
          <TextInput placeholder="Edad recomendada" {...productoForm.getInputProps('edad_recomendada')} />
          <TextInput type="number" min={0} placeholder="Edad mínima" {...productoForm.getInputProps('edad_min')} />
          <TextInput placeholder="Tags (separados por coma)" {...productoForm.getInputProps('tags')} style={{ gridColumn: '1 / -1' }} />
          <TextInput placeholder="URL de imagen" {...productoForm.getInputProps('url_imagen')} style={{ gridColumn: '1 / -1' }} />
          <Textarea placeholder="Descripción SEO" {...productoForm.getInputProps('seo_description')} style={{ gridColumn: '1 / -1' }} />
          <TextInput type="number" min={0} placeholder="Stock tienda" {...productoForm.getInputProps('stock_tienda')} />
          <TextInput type="number" min={0} placeholder="Stock CEDIS" {...productoForm.getInputProps('stock_cedis')} />
          <TextInput type="number" min={0} placeholder="Stock San Luis Potosí" {...productoForm.getInputProps('stock_san_luis_potosi')} />
        </div>
        <Button onClick={crearProducto}>Crear producto</Button>
      </Card>

      <Card withBorder radius="md" p="lg" mt={20} maw={720}>
        <Title order={4} mb={4}>Usuarios del dashboard</Title>
        <p className="page-sub" style={{ margin: '4px 0 16px' }}>
          Crea cuentas con rol admin (operación) o prime (acceso total). No puedes borrar tu propia
          cuenta ni dejar el sistema sin ningún usuario prime.
        </p>
        {msgUsuarios && <div className="login-error" style={{ marginBottom: 12 }}>{msgUsuarios}</div>}
        <Group gap="xs" mb="md" align="flex-end" wrap="wrap">
          <TextInput placeholder="Usuario" {...usuarioForm.getInputProps('username')} style={{ minWidth: 160 }} />
          <PasswordInput placeholder="Password (mín. 8)" {...usuarioForm.getInputProps('password')} style={{ minWidth: 160 }} />
          <Select data={[{ value: 'admin', label: 'admin' }, { value: 'prime', label: 'prime' }]}
            allowDeselect={false} {...usuarioForm.getInputProps('rol')} />
          <Button disabled={!usuarioForm.values.username.trim() || !usuarioForm.values.password} onClick={crearUsuario}>
            Crear usuario
          </Button>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Creado</th><th></th></tr></thead>
            <tbody>
              {usuarios.length === 0 && <tr><td colSpan={4} className="empty">Sin usuarios</td></tr>}
              {usuarios.map(u => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>
                    <Select
                      size="xs"
                      data={[{ value: 'admin', label: 'admin' }, { value: 'prime', label: 'prime' }]}
                      value={u.rol}
                      onChange={v => v && cambiarRolUsuario(u.id, v)}
                      allowDeselect={false}
                      comboboxProps={{ withinPortal: true }}
                    />
                  </td>
                  <td>{u.creado_en}</td>
                  <td><ActionIcon variant="default" color="red" title="Borrar" onClick={() => borrarUsuario(u.id)}>🗑️</ActionIcon></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
