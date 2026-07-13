import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Select, Button, TextInput, NumberInput } from '@mantine/core';
import { api } from '../api';
import Modal from '../components/Modal';
import { fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { confirmar } from '../lib/ui';
import { useTextoEmoji } from '../context/EmojiContext';

const FILTRO_OPTS = [
  { value: '', label: 'Todas' },
  { value: '1', label: 'Activas' },
  { value: '0', label: 'Inactivas' },
];
// 'monto' (descuento fijo en $) ya no se ofrece para cupones nuevos -- sin
// tope porcentual posible, dejaba el precio en $0.00 si el valor superaba
// el del producto. Las filas viejas con 'monto' se siguen mostrando igual.
const TIPO_OPTS = [
  { value: 'porcentaje', label: '% Porcentaje' },
];
const ALCANCE_OPTS = [
  { value: 'producto', label: 'Producto único' },
  { value: 'categoria', label: 'Categoría' },
  { value: 'marca', label: 'Marca' },
  { value: 'edad', label: 'Rango de edad' },
  { value: 'todo', label: 'Todo el inventario' },
];

export default function Cupones() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState('');
  const [codigo, setCodigo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipo, setTipo] = useState('porcentaje');
  const [valor, setValor] = useState('');
  const [alcance, setAlcance] = useState('producto');
  const [idProducto, setIdProducto] = useState('');
  const [idCategoria, setIdCategoria] = useState('');
  const [brand, setBrand] = useState('');
  const [edadMin, setEdadMin] = useState('');
  const [edadMax, setEdadMax] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [usosMax, setUsosMax] = useState('0');
  const [msg, setMsg] = useState(null);
  const [bajando, setBajando] = useState(null); // { id } -- promo a desactivar, pide motivo
  const [motivoBaja, setMotivoBaja] = useState('');

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['promociones', filtro],
    queryFn: () => api.get('/api/promociones' + (filtro !== '' ? '?activa=' + filtro : '')),
  });
  const { data: categorias } = useQuery({ queryKey: ['categorias'], queryFn: () => api.get('/api/categorias') });
  const { data: marcas } = useQuery({ queryKey: ['marcas'], queryFn: () => api.get('/api/marcas') });
  const { data: topeResp } = useQuery({ queryKey: ['tope-descuento'], queryFn: () => api.get('/api/prime/tope-descuento') });
  const tope = topeResp?.tope_descuento_pct ?? 30;

  const crearMutation = useMutation({
    mutationFn: (body) => api.post('/api/promociones', body),
    onSuccess: () => {
      setMsg({ ok: true, texto: 'Cupón creado' });
      setCodigo(''); setDescripcion(''); setValor(''); setIdProducto(''); setIdCategoria('');
      setBrand(''); setEdadMin(''); setEdadMax(''); setFechaInicio(''); setFechaFin('');
      queryClient.invalidateQueries({ queryKey: ['promociones'] });
    },
    onError: (e) => setMsg({ ok: false, texto: '' + e.message }),
  });
  const crear = () => {
    const body = {
      codigo, descripcion: descripcion || null, tipo, valor: parseFloat(valor || 0),
      id_producto: alcance === 'producto' ? (parseInt(idProducto || 0) || null) : null,
      id_categoria: alcance === 'categoria' ? (parseInt(idCategoria || 0) || null) : null,
      brand: alcance === 'marca' ? (brand || null) : null,
      edad_min: alcance === 'edad' ? (parseInt(edadMin || 0) || null) : null,
      edad_max: alcance === 'edad' ? (parseInt(edadMax || 0) || null) : null,
      fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null,
      usos_max: parseInt(usosMax || 0),
    };
    if (!body.codigo || !body.valor) { setMsg({ ok: false, texto: 'Completa código y valor' }); return; }
    if (!body.fecha_fin) { setMsg({ ok: false, texto: 'La fecha de vencimiento es obligatoria' }); return; }
    crearMutation.mutate(body);
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, activa, motivo_baja }) => api.put(`/api/promociones/${id}`, { activa: !!activa, motivo_baja }),
    onSuccess: () => { setBajando(null); setMotivoBaja(''); queryClient.invalidateQueries({ queryKey: ['promociones'] }); },
    onError: (e) => handleApiError(e),
  });
  const activar = async (id) => {
    if (!await confirmar({ mensaje: '¿Seguro que quieres activar esta promoción?', textoOk: 'Activar' })) return;
    toggleMutation.mutate({ id, activa: true });
  };

  return (
    <div>
      <div className="page-title">Cupones</div>
      <div className="page-sub">Cupones y descuentos manuales</div>
      {error && <div className="login-error">No se pudieron cargar las promociones: {error.message}</div>}

      <div className="cols-2">
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb="md">
            <Title order={4}>{txt('🎟️ Cupones / Promociones')}</Title>
            <Group gap="xs">
              <Select size="xs" w={120} data={FILTRO_OPTS} value={filtro} onChange={v => setFiltro(v ?? '')} comboboxProps={{ withinPortal: true }} />
              <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
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
                <div className="text-muted">Descuento: <strong>{val}</strong> · Alcance: {r.alcance}</div>
                <div className="text-muted">Vigencia: {r.fecha_inicio || '-'} a {r.fecha_fin || 'Sin vencimiento'} · Usos: {r.usos_actual || 0}/{r.usos_max || '∞'}</div>
                {r.creado_por && <div className="text-muted">Creado por: {r.creado_por}</div>}
                {!r.activa && r.motivo_baja && <div className="text-muted">Motivo de baja: {r.motivo_baja} {r.baja_por ? `(${r.baja_por})` : ''}</div>}
                <Button
                  variant="light" color={r.activa ? 'red' : 'teal'} size="xs" mt={7}
                  onClick={() => r.activa ? setBajando({ id: r.id }) : activar(r.id)}
                >
                  {txt(r.activa ? 'Desactivar' : 'Activar')}
                </Button>
              </div>
            );
          })}
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('➕ Nuevo cupón')}</Title>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>
            Tope de descuento: {tope > 0 ? `${tope}% (configurable por prime en Prime > General)` : 'sin tope (prime lo desactivó)'}
          </p>
          <TextInput label="Código" placeholder="Ej: VERANO10" value={codigo} onChange={e => setCodigo(e.target.value)} mb="sm" />
          <TextInput label="Descripción" placeholder="Ej: 10% en toda la tienda" value={descripcion} onChange={e => setDescripcion(e.target.value)} mb="sm" />
          <Select label="Tipo" data={TIPO_OPTS} value={tipo} onChange={v => setTipo(v ?? tipo)} comboboxProps={{ withinPortal: true }} mb="sm" />
          <TextInput type="number" step="0.01" label="Valor (%)" value={valor} onChange={e => setValor(e.target.value)} mb="sm" />
          <Select label="Alcance" data={ALCANCE_OPTS} value={alcance} onChange={v => setAlcance(v ?? 'producto')} allowDeselect={false} comboboxProps={{ withinPortal: true }} mb="sm" />
          {alcance === 'producto' && (
            <TextInput type="number" label="ID Producto" value={idProducto} onChange={e => setIdProducto(e.target.value)} mb="sm" />
          )}
          {alcance === 'categoria' && (
            <Select
              label="Categoría"
              data={(categorias || []).map(c => ({ value: String(c.id), label: c.nombre }))}
              value={idCategoria} onChange={v => setIdCategoria(v || '')}
              comboboxProps={{ withinPortal: true }} mb="sm" searchable
            />
          )}
          {alcance === 'marca' && (
            <Select
              label="Marca"
              data={(marcas || []).map(m => ({ value: m, label: m }))}
              value={brand} onChange={v => setBrand(v || '')}
              comboboxProps={{ withinPortal: true }} mb="sm" searchable
            />
          )}
          {alcance === 'edad' && (
            <Group grow mb="sm">
              <NumberInput label="Edad mín." min={0} max={99} value={edadMin === '' ? '' : Number(edadMin)} onChange={v => setEdadMin(v === '' ? '' : String(v))} />
              <NumberInput label="Edad máx." min={0} max={99} value={edadMax === '' ? '' : Number(edadMax)} onChange={v => setEdadMax(v === '' ? '' : String(v))} />
            </Group>
          )}
          <TextInput type="date" label="Fecha inicio (opcional)" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} mb="sm" />
          <TextInput type="date" label="Fecha fin (obligatoria)" value={fechaFin} onChange={e => setFechaFin(e.target.value)} mb="sm" required />
          <TextInput type="number" label="Usos máximos (0 = ilimitado)" value={usosMax} onChange={e => setUsosMax(e.target.value)} mb="sm" />
          <Button onClick={crear}>Crear cupón</Button>
          {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginTop: 14 }}>{txt(msg.texto)}</div>}
        </Card>
      </div>

      {bajando && (
        <Modal title="Desactivar cupón" onClose={() => { setBajando(null); setMotivoBaja(''); }}
          actions={<>
            <Button variant="default" onClick={() => { setBajando(null); setMotivoBaja(''); }}>Cancelar</Button>
            <Button color="red" onClick={() => toggleMutation.mutate({ id: bajando.id, activa: false, motivo_baja: motivoBaja || 'Se agotó' })}>Desactivar</Button>
          </>}>
          <Select
            label="Motivo"
            data={[{ value: 'Se agotó', label: 'Se agotó' }, { value: 'otro', label: 'Otro (especificar abajo)' }]}
            value={motivoBaja === '' || motivoBaja === 'Se agotó' ? (motivoBaja || 'Se agotó') : 'otro'}
            onChange={v => setMotivoBaja(v === 'otro' ? '' : v)}
            mb="sm"
          />
          <TextInput placeholder="Motivo (si elegiste Otro)" value={motivoBaja} onChange={e => setMotivoBaja(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
