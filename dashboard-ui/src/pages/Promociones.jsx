import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Select, Button, TextInput } from '@mantine/core';
import { api } from '../api';
import { fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { useTextoEmoji } from '../context/EmojiContext';

const FILTRO_OPTS = [
  { value: '', label: 'Todas' },
  { value: '1', label: 'Activas' },
  { value: '0', label: 'Inactivas' },
];
const TIPO_OPTS = [
  { value: 'porcentaje', label: '% Porcentaje' },
  { value: 'monto', label: '$ Monto fijo' },
];

export default function Promociones() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState('');
  const [codigo, setCodigo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipo, setTipo] = useState('porcentaje');
  const [valor, setValor] = useState('');
  const [idProducto, setIdProducto] = useState('');
  const [idCategoria, setIdCategoria] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [usosMax, setUsosMax] = useState('0');
  const [msg, setMsg] = useState(null);

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['promociones', filtro],
    queryFn: () => api.get('/api/promociones' + (filtro !== '' ? '?activa=' + filtro : '')),
  });

  const crearMutation = useMutation({
    mutationFn: (body) => api.post('/api/promociones', body),
    onSuccess: () => {
      setMsg({ ok: true, texto: '✅ Cupón creado' });
      setCodigo(''); setDescripcion(''); setValor(''); setIdProducto(''); setIdCategoria(''); setFechaInicio(''); setFechaFin('');
      queryClient.invalidateQueries({ queryKey: ['promociones'] });
    },
    onError: (e) => setMsg({ ok: false, texto: '❌ ' + e.message }),
  });
  const crear = () => {
    const body = {
      codigo, descripcion: descripcion || null, tipo, valor: parseFloat(valor || 0),
      id_producto: parseInt(idProducto || 0) || null,
      id_categoria: parseInt(idCategoria || 0) || null,
      fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null,
      usos_max: parseInt(usosMax || 0),
    };
    if (!body.codigo || !body.valor) { setMsg({ ok: false, texto: 'Completa código y valor' }); return; }
    crearMutation.mutate(body);
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, activa }) => api.put(`/api/promociones/${id}`, { activa: !!activa }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promociones'] }),
    onError: (e) => handleApiError(e),
  });
  const toggle = (id, activa) => {
    if (!window.confirm(`¿Seguro que quieres ${activa ? 'activar' : 'desactivar'} esta promoción?`)) return;
    toggleMutation.mutate({ id, activa });
  };

  return (
    <div>
      <div className="page-title">Promociones</div>
      <div className="page-sub">Cupones y descuentos manuales</div>
      {error && <div className="login-error">No se pudieron cargar las promociones: {error.message}</div>}

      <div className="kpi-grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb="md">
            <Title order={4}>{txt('🎟️ Cupones / Promociones')}</Title>
            <Group gap="xs">
              <Select size="xs" w={120} data={FILTRO_OPTS} value={filtro} onChange={v => setFiltro(v ?? '')} comboboxProps={{ withinPortal: true }} />
              <ActionIcon variant="default" onClick={() => refetch()}>🔄</ActionIcon>
            </Group>
          </Group>
          {rows === undefined && <div className="empty">Cargando...</div>}
          {rows?.length === 0 && <div className="empty">Sin cupones</div>}
          {rows?.map(r => {
            const val = r.tipo === 'porcentaje' ? `${r.valor}%` : `$${fmt(r.valor)}`;
            return (
              <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong><code>{r.codigo}</code></strong>
                  <span className={`badge badge-${r.activa ? 'verde' : 'rojo'}`}>{r.activa ? 'Activa' : 'Inactiva'}</span>
                </div>
                <div className="text-muted">{r.descripcion || 'Sin descripción'}</div>
                <div className="text-muted">Descuento: <strong>{val}</strong>{r.nombre_producto ? ` · ${r.nombre_producto}` : ''}</div>
                <div className="text-muted">Vigencia: {r.fecha_inicio || '-'} a {r.fecha_fin || 'Sin vencimiento'} · Usos: {r.usos_actual || 0}/{r.usos_max || '∞'}</div>
                <Button variant="light" color={r.activa ? 'red' : 'teal'} size="xs" mt={7} onClick={() => toggle(r.id, r.activa ? 0 : 1)}>
                  {txt(r.activa ? '🚫 Desactivar' : '✅ Activar')}
                </Button>
              </div>
            );
          })}
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('➕ Nuevo cupón')}</Title>
          <TextInput label="Código" placeholder="Ej: VERANO10" value={codigo} onChange={e => setCodigo(e.target.value)} mb="sm" />
          <TextInput label="Descripción" placeholder="Ej: 10% en toda la tienda" value={descripcion} onChange={e => setDescripcion(e.target.value)} mb="sm" />
          <Select label="Tipo" data={TIPO_OPTS} value={tipo} onChange={v => setTipo(v ?? tipo)} comboboxProps={{ withinPortal: true }} mb="sm" />
          <TextInput type="number" step="0.01" label="Valor" value={valor} onChange={e => setValor(e.target.value)} mb="sm" />
          <TextInput type="number" label="ID Producto (opcional)" value={idProducto} onChange={e => setIdProducto(e.target.value)} mb="sm" />
          <TextInput type="number" label="ID Categoría (opcional)" value={idCategoria} onChange={e => setIdCategoria(e.target.value)} mb="sm" />
          <TextInput type="date" label="Fecha inicio (opcional)" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} mb="sm" />
          <TextInput type="date" label="Fecha fin (opcional)" value={fechaFin} onChange={e => setFechaFin(e.target.value)} mb="sm" />
          <TextInput type="number" label="Usos máximos (0 = ilimitado)" value={usosMax} onChange={e => setUsosMax(e.target.value)} mb="sm" />
          <Button onClick={crear}>Crear cupón</Button>
          {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginTop: 14 }}>{txt(msg.texto)}</div>}
        </Card>
      </div>
    </div>
  );
}
