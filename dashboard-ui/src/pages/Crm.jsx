import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Text, Skeleton, Drawer, Textarea, Button, Group, Tabs, TextInput, Select, NumberInput, SegmentedControl } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk, confirmar } from '../lib/ui';
import EstatusMenu from '../components/EstatusMenu';
import { fdate, soloTelefono } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { esAdminOMas } from '../lib/permisos';

const ETAPA_LABEL = { lead: 'Lead', contactado: 'Contactado', cotizado: 'Cotizado', ganado: 'Ganado', perdido: 'Perdido' };
const TIPO_PUNTO = { pedido: 'var(--green)', nota: 'var(--info)', etapa: 'var(--yellow)', cita: 'var(--text-mute)', tarea: 'var(--red)' };

// ── Ficha del cliente (Drawer): notas + nueva tarea + timeline ───────────────
function FichaCliente({ sel, onClose }) {
  const qc = useQueryClient();
  const [nota, setNota] = useState('');
  const [tarea, setTarea] = useState({ titulo: '', vence_en: '', tipo: 'seguimiento' });

  const { data: timeline = [] } = useQuery({
    queryKey: ['crm-timeline', sel?.id], enabled: !!sel,
    queryFn: () => api.get(`/api/crm/clientes/${sel.id}/timeline`),
  });
  const invalidar = () => { qc.invalidateQueries({ queryKey: ['crm-timeline', sel.id] }); qc.invalidateQueries({ queryKey: ['crm-tareas'] }); };

  const agregarNota = useMutation({
    mutationFn: () => api.post(`/api/crm/clientes/${sel.id}/notas`, { contenido: nota }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setNota(''); toastOk('Nota guardada'); invalidar(); },
    onError: handleApiError,
  });
  const agregarTarea = useMutation({
    mutationFn: () => api.post(`/api/crm/clientes/${sel.id}/tareas`, tarea),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setTarea({ titulo: '', vence_en: '', tipo: 'seguimiento' }); toastOk('Tarea creada'); invalidar(); },
    onError: handleApiError,
  });

  return (
    <Drawer opened={!!sel} onClose={onClose} position="right" size="md"
      title={<strong>{sel?.nombre || soloTelefono(sel?.telefono || '')}</strong>}>
      {sel && (
        <div>
          <Text size="xs" c="dimmed" mb="md">{soloTelefono(sel.telefono)} · score {sel.lead_score || 0} · cliente desde {fdate(sel.creado_en)}</Text>

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
      )}
    </Drawer>
  );
}

// ── Tab Pipeline ──────────────────────────────────────────────────────────────
function PipelineTab({ onAbrir }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['crm-pipeline'], queryFn: () => api.get('/api/crm/pipeline') });
  const moverEtapa = useMutation({
    mutationFn: ({ id, etapa }) => api.put(`/api/crm/clientes/${id}/etapa`, { etapa }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['crm-pipeline'] }); },
    onError: handleApiError,
  });
  if (!data) return <Skeleton height={300} radius="md" />;
  return (
    <div className="crm-cols">
      {data.etapas.map(etapa => (
        <div key={etapa}>
          <div className="f-h4"><span>{ETAPA_LABEL[etapa]}</span><span className="der"><b>{data.columnas[etapa].length}</b></span></div>
          <div className="f-stagger">
            {data.columnas[etapa].slice(0, 40).map(c => (
              <Card key={c.id} withBorder radius="md" p="sm" className="card" mb={8}
                style={{ cursor: 'pointer' }} onClick={() => onAbrir(c)}>
                <Text fw={600} size="sm" lineClamp={1}>{c.nombre || soloTelefono(c.telefono)}</Text>
                <Text size="xs" c="dimmed">{soloTelefono(c.telefono)} · score {c.lead_score || 0}{c.pedidos_n ? ` · ${c.pedidos_n} pedido${c.pedidos_n > 1 ? 's' : ''}` : ''}</Text>
                <div onClick={e => e.stopPropagation()} style={{ marginTop: 6 }}>
                  <EstatusMenu value={etapa} opciones={data.etapas} onChange={v => moverEtapa.mutate({ id: c.id, etapa: v })} />
                </div>
              </Card>
            ))}
            {data.columnas[etapa].length === 0 && <Text size="xs" c="dimmed" ta="center" mt="md">—</Text>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab Tareas: pendientes/vencidas/mías, marcar hecha ──────────────────────
function TareasTab() {
  const qc = useQueryClient();
  const [vista, setVista] = useState('pendientes');
  const { data: tareas } = useQuery({ queryKey: ['crm-tareas', vista], queryFn: () => api.get('/api/crm/tareas?vista=' + vista) });
  const marcar = useMutation({
    mutationFn: ({ id, estatus }) => api.put(`/api/crm/tareas/${id}`, { estatus }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['crm-tareas'] }); },
    onError: handleApiError,
  });
  if (!tareas) return <Skeleton height={200} radius="md" />;
  return (
    <div>
      <SegmentedControl size="xs" mb="md" value={vista} onChange={setVista}
        data={[{ value: 'pendientes', label: 'Pendientes' }, { value: 'vencidas', label: 'Vencidas' }, { value: 'mias', label: 'Mías' }]} />
      <div className="f-stagger">
        {tareas.length === 0 && <Text size="sm" c="dimmed">Nada por aquí — las tareas se crean desde la ficha del cliente (pipeline → click en la tarjeta).</Text>}
        {tareas.map(t => (
          <div key={t.id} className="f-row">
            <span className="who">
              <span style={{ color: t.vencida ? 'var(--red)' : 'var(--text-mute)', fontSize: 7, verticalAlign: 2, marginRight: 7 }}>●</span>
              {t.titulo}
              <span className="t"> · {t.cliente_nombre || soloTelefono(t.telefono)} · {t.tipo}{t.vence_en ? ' · vence ' + t.vence_en : ''}{t.asignado_a ? ' · ' + t.asignado_a : ''}</span>
            </span>
            <span className="go" onClick={() => marcar.mutate({ id: t.id, estatus: 'hecha' })}>hecha ✓</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab Segmentos: builder + preview + guardar (gerente) ────────────────────
function SegmentosTab() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState({ etapa: '', score_min: '', dias_sin_compra_min: '', tag: '' });
  const [nombre, setNombre] = useState('');

  const filtroLimpio = () => {
    const f = {};
    if (filtro.etapa) f.etapa = filtro.etapa;
    if (Number(filtro.score_min) > 0) f.score_min = Number(filtro.score_min);
    if (Number(filtro.dias_sin_compra_min) > 0) f.dias_sin_compra_min = Number(filtro.dias_sin_compra_min);
    if (filtro.tag.trim()) f.tag = filtro.tag.trim();
    return f;
  };
  const { data: preview } = useQuery({
    queryKey: ['crm-seg-preview', filtro],
    queryFn: () => api.get('/api/crm/segmentos/preview?filtro=' + encodeURIComponent(JSON.stringify(filtroLimpio()))),
  });
  const { data: segmentos = [] } = useQuery({ queryKey: ['crm-segmentos'], queryFn: () => api.get('/api/crm/segmentos') });

  const guardar = useMutation({
    mutationFn: () => api.post('/api/crm/segmentos', { nombre, filtro: filtroLimpio() }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setNombre(''); toastOk('Segmento guardado'); qc.invalidateQueries({ queryKey: ['crm-segmentos'] }); },
    onError: handleApiError,
  });
  const borrar = async (s) => {
    if (!await confirmar({ titulo: 'Borrar segmento', mensaje: `¿Borrar "${s.nombre}"?`, peligro: true, textoOk: 'Borrar' })) return;
    await api.del(`/api/crm/segmentos/${s.id}`);
    qc.invalidateQueries({ queryKey: ['crm-segmentos'] });
  };

  return (
    <div className="split-2w">
      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Armar audiencia</h3></div>
        <Group grow mb="sm">
          <Select label="Etapa" placeholder="Cualquiera" clearable
            data={Object.entries(ETAPA_LABEL).map(([v, l]) => ({ value: v, label: l }))}
            value={filtro.etapa || null} onChange={v => setFiltro({ ...filtro, etapa: v || '' })} />
          <NumberInput label="Score mínimo" min={0} value={filtro.score_min}
            onChange={v => setFiltro({ ...filtro, score_min: v ?? '' })} />
        </Group>
        <Group grow mb="md">
          <NumberInput label="Días sin comprar (mínimo)" min={0} value={filtro.dias_sin_compra_min}
            onChange={v => setFiltro({ ...filtro, dias_sin_compra_min: v ?? '' })} />
          <TextInput label="Tag contiene" placeholder="cliente_recurrente" value={filtro.tag}
            onChange={e => setFiltro({ ...filtro, tag: e.target.value })} />
        </Group>
        <Text size="sm" mb="md">Coinciden: <strong>{preview?.total ?? '…'}</strong> clientes <Text span size="xs" c="dimmed">(se excluye a quien pidió no recibir marketing)</Text></Text>
        <Group>
          <TextInput placeholder="Nombre del segmento (ej: dormidos VIP)" style={{ flex: 1 }} value={nombre} onChange={e => setNombre(e.target.value)} />
          <Button disabled={!nombre.trim() || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</Button>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">Los segmentos alimentan las campañas (Fase 3) — el envío siempre pasa por aprobación humana.</Text>
      </Card>

      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Segmentos guardados</h3></div>
        <div className="f-stagger">
          {segmentos.length === 0 && <Text size="sm" c="dimmed">Sin segmentos todavía.</Text>}
          {segmentos.map(s => (
            <div key={s.id} className="f-row">
              <span className="who">{s.nombre}<span className="t"> · {Object.entries(JSON.parse(s.filtro_json || '{}')).map(([k, v]) => `${k}=${v}`).join(' · ') || 'todos'}</span></span>
              <span className="go" style={{ color: 'var(--red)' }} onClick={() => borrar(s)}>borrar</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// CRM — Fase 1: pipeline + notas + timeline · Fase 2: tareas + segmentos.
export default function Crm() {
  const { user } = useAuth();
  const [tab, setTab] = useState('pipeline');
  const [sel, setSel] = useState(null);
  const esGerente = esAdminOMas(user?.rol);

  return (
    <div className="sin-scroll">
      <div className="page-title">CRM</div>
      <div className="page-sub">Pipeline de ventas, tareas de seguimiento y audiencias</div>
      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          <Tabs.Tab value="pipeline">Pipeline</Tabs.Tab>
          <Tabs.Tab value="tareas">Tareas</Tabs.Tab>
          {esGerente && <Tabs.Tab value="segmentos">Segmentos</Tabs.Tab>}
        </Tabs.List>
      </Tabs>
      <div className="page-scrollable">
        {tab === 'pipeline' && <PipelineTab onAbrir={setSel} />}
        {tab === 'tareas' && <TareasTab />}
        {tab === 'segmentos' && esGerente && <SegmentosTab />}
      </div>
      <FichaCliente sel={sel} onClose={() => setSel(null)} />
    </div>
  );
}
