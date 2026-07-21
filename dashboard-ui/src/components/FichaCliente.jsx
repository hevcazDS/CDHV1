import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Drawer, Tabs, Group, Button, Text, Textarea, TextInput, Select } from '@mantine/core';
import { MessageCircle } from 'lucide-react';
import { api } from '../api';
import { fdate, soloTelefono, fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { toastOk } from '../lib/ui';
import Badge from './Badge';
import { useTextoEmoji } from '../context/EmojiContext';

// Ficha de cliente UNIFICADA (comité P1-6): antes vivía partida en Clientes
// (gasto/puntos/pedidos) y CRM (notas/tareas/timeline). Un solo drawer con dos
// pestañas — todo con endpoints existentes. Acepta el cliente venga de donde
// venga (fila de Clientes o tarjeta del pipeline): lee lo que traiga.
const TIPO_PUNTO = { pedido: 'var(--green)', nota: 'var(--info)', etapa: 'var(--yellow)', cita: 'var(--text-mute)', tarea: 'var(--red)' };

function capitalizar(n) {
  return n ? n.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '-';
}

export default function FichaCliente({ cliente, onClose }) {
  const txt = useTextoEmoji();
  const [tab, setTab] = useState('resumen');
  const abierto = !!cliente;
  const nombre = cliente?.nombre ? capitalizar(cliente.nombre) : soloTelefono(cliente?.telefono || '');

  return (
    <Drawer opened={abierto} onClose={onClose} position="right" size="md"
      title={<strong style={{ fontSize: 16 }}>{nombre}</strong>}>
      {cliente && (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="chip">{soloTelefono(cliente.telefono)}</span>
            {cliente.creado_en && <span className="chip">desde {fdate(cliente.creado_en)}</span>}
            {cliente.lead_score != null && <span className="chip">score {cliente.lead_score}</span>}
            {cliente.canal_origen && <span className="chip">{cliente.canal_origen}</span>}
            {cliente.codigo_referido && <span className="chip" title="Código de referido">{txt('🎁 ')}{cliente.codigo_referido}</span>}
            {(cliente.tags || '').split(',').filter(Boolean).map(t => <span className="chip" key={t}>{t.trim()}</span>)}
          </div>

          <Tabs value={tab} onChange={setTab} mb="sm">
            <Tabs.List>
              <Tabs.Tab value="resumen">Resumen</Tabs.Tab>
              <Tabs.Tab value="seguimiento">Seguimiento</Tabs.Tab>
            </Tabs.List>
          </Tabs>

          {tab === 'resumen' && <Resumen cliente={cliente} />}
          {tab === 'seguimiento' && <Seguimiento cliente={cliente} />}
        </div>
      )}
    </Drawer>
  );
}

function Resumen({ cliente }) {
  const { data: pedidos = [] } = useQuery({ queryKey: ['pedidos'], queryFn: () => api.get('/api/pedidos'), enabled: !!cliente });
  const { data: puntos } = useQuery({
    queryKey: ['puntos', cliente?.telefono], enabled: !!cliente?.telefono,
    queryFn: () => api.get('/api/puntos/' + encodeURIComponent(cliente.telefono)).catch(() => null),
  });
  const suyos = pedidos.filter(p => p.id_cliente === cliente?.id);
  const gastoTotal = suyos.filter(p => p.pago_estatus === 'pagado').reduce((s, p) => s + (p.total || 0), 0);

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Card withBorder radius="md" p="sm" className="kpi-card">
          <div className="kpi-value" style={{ fontSize: 20 }}>{suyos.length}</div>
          <div className="kpi-label" style={{ fontSize: 11 }}>Pedidos</div>
        </Card>
        <Card withBorder radius="md" p="sm" className="kpi-card">
          <div className="kpi-value money" style={{ fontSize: 20 }}>${fmt(gastoTotal)}</div>
          <div className="kpi-label" style={{ fontSize: 11 }}>Gasto pagado</div>
        </Card>
        <Card withBorder radius="md" p="sm" className="kpi-card">
          <div className="kpi-value" style={{ fontSize: 20 }}>{puntos?.disponibles ?? 0}</div>
          <div className="kpi-label" style={{ fontSize: 11 }}>Puntos disponibles</div>
        </Card>
      </div>
      <Group gap="xs" mb="md">
        <Button component={Link} to={`/notificaciones?cliente=${cliente.id}`} size="xs" variant="default" leftSection={<MessageCircle size={14} />}>
          Ver chat / escribirle
        </Button>
      </Group>
      <div className="card-header"><h3>Últimos pedidos</h3></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Folio</th><th className="num">Total</th><th>Pago</th><th>Estatus</th></tr></thead>
          <tbody>
            {suyos.length === 0 && <tr><td colSpan={4} className="empty">Sin pedidos todavía<span className="empty-accion">Cuando compre por WhatsApp o mostrador aparecerán aquí</span></td></tr>}
            {suyos.slice(0, 10).map(p => (
              <tr key={p.id_pedido}>
                <td><span className="folio">{p.folio || '#' + p.id_pedido}</span></td>
                <td className="num">${fmt(p.total)}</td>
                <td><Badge value={p.pago_estatus} map="pago" /></td>
                <td className="text-muted">{p.estatus || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Seguimiento({ cliente }) {
  const qc = useQueryClient();
  const [nota, setNota] = useState('');
  const [tarea, setTarea] = useState({ titulo: '', vence_en: '', tipo: 'seguimiento' });

  const { data: timeline = [] } = useQuery({
    queryKey: ['crm-timeline', cliente?.id], enabled: !!cliente,
    queryFn: () => api.get(`/api/crm/clientes/${cliente.id}/timeline`).catch(() => []),
  });
  const invalidar = () => { qc.invalidateQueries({ queryKey: ['crm-timeline', cliente.id] }); qc.invalidateQueries({ queryKey: ['crm-tareas'] }); };

  const agregarNota = useMutation({
    mutationFn: () => api.post(`/api/crm/clientes/${cliente.id}/notas`, { contenido: nota }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setNota(''); toastOk('Nota guardada'); invalidar(); },
    onError: handleApiError,
  });
  const agregarTarea = useMutation({
    mutationFn: () => api.post(`/api/crm/clientes/${cliente.id}/tareas`, tarea),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setTarea({ titulo: '', vence_en: '', tipo: 'seguimiento' }); toastOk('Tarea creada'); invalidar(); },
    onError: handleApiError,
  });

  return (
    <div>
      <div className="f-h4"><span>Nueva nota</span></div>
      <Textarea autosize minRows={2} placeholder="Ej: pidió cotización de 20 piezas, quedamos de hablar el viernes…"
        value={nota} onChange={e => setNota(e.target.value)} mb="xs" />
      <Group justify="flex-end" mb="lg">
        <Button size="xs" disabled={!nota.trim() || agregarNota.isPending} onClick={() => agregarNota.mutate()}>Guardar nota</Button>
      </Group>

      <div className="f-h4"><span>Nueva tarea de seguimiento</span></div>
      <TextInput size="xs" placeholder="Ej: llamarle para cerrar la cotización" mb="xs"
        value={tarea.titulo} onChange={e => setTarea({ ...tarea, titulo: e.target.value })} />
      <Group grow mb="xs">
        <Select size="xs" data={['llamada', 'whatsapp', 'visita', 'seguimiento', 'otro']} value={tarea.tipo}
          onChange={v => setTarea({ ...tarea, tipo: v || 'seguimiento' })} allowDeselect={false} />
        <TextInput size="xs" type="date" value={tarea.vence_en} onChange={e => setTarea({ ...tarea, vence_en: e.target.value })} />
      </Group>
      <Group justify="flex-end" mb="lg">
        <Button size="xs" variant="default" disabled={!tarea.titulo.trim() || agregarTarea.isPending} onClick={() => agregarTarea.mutate()}>Crear tarea</Button>
      </Group>

      <div className="f-h4"><span>Historial</span><span className="der">{timeline.length} eventos</span></div>
      <div className="f-stagger">
        {timeline.length === 0 && <Text size="sm" c="dimmed">Sin actividad registrada todavía.</Text>}
        {timeline.map((ev, i) => (
          <div key={i} className="f-row" style={{ alignItems: 'flex-start' }}>
            <span className="who" style={{ fontWeight: 400, fontSize: 12.5 }}>
              <span style={{ color: TIPO_PUNTO[ev.tipo] || 'var(--text-mute)', fontSize: 7, verticalAlign: 2, marginRight: 7 }}>●</span>
              {ev.texto}
            </span>
            <span className="t" style={{ flex: 'none' }}>{fdate(ev.fecha)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
