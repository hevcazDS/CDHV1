import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Button, TextInput } from '@mantine/core';
import { api } from '../api';
import { fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import Modal from '../components/Modal';
import { useTextoEmoji } from '../context/EmojiContext';

const hoy = () => new Date().toISOString().slice(0, 10);

export default function Preventas() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [idProducto, setIdProducto] = useState('');
  const [nombre, setNombre] = useState('');
  const [fechaEst, setFechaEst] = useState('');
  const [precio, setPrecio] = useState('');
  const [stock, setStock] = useState('50');
  const [anticipo, setAnticipo] = useState('50');
  const [msg, setMsg] = useState(null);
  const [llegadaId, setLlegadaId] = useState(null);
  const [fechaLlegada, setFechaLlegada] = useState(hoy());

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['preventas'],
    queryFn: () => api.get('/api/preventas'),
  });

  const crearMutation = useMutation({
    mutationFn: (body) => api.post('/api/preventas', body),
    onSuccess: () => {
      setMsg({ ok: true, texto: 'Preventa creada' });
      setIdProducto(''); setNombre(''); setFechaEst(''); setPrecio(''); setStock('50'); setAnticipo('50');
      queryClient.invalidateQueries({ queryKey: ['preventas'] });
    },
    onError: (e) => setMsg({ ok: false, texto: '' + e.message }),
  });
  const crear = () => {
    const body = {
      id_producto: parseInt(idProducto || 0),
      nombre_preventa: nombre,
      fecha_llegada_est: fechaEst,
      precio_preventa: parseFloat(precio || 0),
      stock_maximo: parseInt(stock || 50),
      porcentaje_anticipo: parseInt(anticipo || 50),
    };
    if (!body.id_producto || !body.nombre_preventa || !body.fecha_llegada_est) {
      setMsg({ ok: false, texto: 'Completa los campos requeridos' }); return;
    }
    crearMutation.mutate(body);
  };

  const confirmarLlegadaMutation = useMutation({
    mutationFn: () => api.put(`/api/preventas/${llegadaId}`, { fecha_llegada_real: fechaLlegada }),
    onSuccess: () => {
      setLlegadaId(null);
      queryClient.invalidateQueries({ queryKey: ['preventas'] });
    },
    onError: (e) => handleApiError(e),
  });

  return (
    <div className="sin-scroll">
      <div className="page-title">Preventas</div>
      <div className="page-sub">Productos en preventa con apartado anticipado</div>
      <div className="page-scrollable">
      {error && <div className="login-error">No se pudieron cargar las preventas: {error.message}</div>}

      <div className="cols-2">
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb="md">
            <Title order={4}>{txt('📅 Preventas activas')}</Title>
            <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
          </Group>
          {rows === undefined && <div className="empty cargando">Cargando...</div>}
          {rows?.length === 0 && <div className="empty">Sin preventas activas</div>}
          {rows?.map(r => (
            <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>{r.nombre_preventa}</strong>
                <span className="badge badge-azul">{r.stock_comprometido || 0}/{r.stock_maximo || 0} apartados</span>
              </div>
              <div className="text-muted">ID: {r.id_producto} · ${fmt(r.precio_preventa)} · Anticipo {r.porcentaje_anticipo || 50}%</div>
              <div className="text-muted">Llegada estimada: {r.fecha_llegada_est || '-'}</div>
              {r.fecha_llegada_real
                ? <span className="badge badge-verde">{txt('✅ Llegó: ')}{r.fecha_llegada_real}</span>
                : <Button variant="light" color="teal" size="xs" mt={7} onClick={() => { setLlegadaId(r.id); setFechaLlegada(hoy()); }}>{txt('✅ Marcar como llegada')}</Button>}
            </div>
          ))}
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('➕ Nueva preventa')}</Title>
          <TextInput type="number" label="ID Producto" value={idProducto} onChange={e => setIdProducto(e.target.value)} mb="sm" />
          <TextInput label="Nombre" placeholder="Ej: Hot Wheels Navidad 2026" value={nombre} onChange={e => setNombre(e.target.value)} mb="sm" />
          <TextInput type="date" label="Fecha estimada llegada" value={fechaEst} onChange={e => setFechaEst(e.target.value)} mb="sm" />
          <TextInput type="number" step="0.01" label="Precio" value={precio} onChange={e => setPrecio(e.target.value)} mb="sm" />
          <TextInput type="number" label="Unidades disponibles" value={stock} onChange={e => setStock(e.target.value)} mb="sm" />
          <TextInput type="number" min="10" max="100" label="Anticipo %" value={anticipo} onChange={e => setAnticipo(e.target.value)} mb="sm" />
          <Button onClick={crear}>Crear preventa</Button>
          {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginTop: 14 }}>{txt(msg.texto)}</div>}
        </Card>
      </div>

      {llegadaId && (
        <Modal title="Fecha de llegada" onClose={() => setLlegadaId(null)}
          actions={<>
            <Button variant="default" onClick={() => setLlegadaId(null)}>Cancelar</Button>
            <Button onClick={() => confirmarLlegadaMutation.mutate()}>Aceptar</Button>
          </>}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>Ingresa la fecha real de llegada</p>
          <TextInput type="date" autoFocus value={fechaLlegada} onChange={e => setFechaLlegada(e.target.value)} />
        </Modal>
      )}
      </div>
    </div>
  );
}
