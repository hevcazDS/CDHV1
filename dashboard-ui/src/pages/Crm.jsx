import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Text, Skeleton, Drawer, Textarea, Button, Group } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk } from '../lib/ui';
import EstatusMenu from '../components/EstatusMenu';
import { fdate, soloTelefono } from '../lib/format';

const ETAPA_LABEL = { lead: 'Lead', contactado: 'Contactado', cotizado: 'Cotizado', ganado: 'Ganado', perdido: 'Perdido' };

// CRM Fase 1 — pipeline de ventas: columnas por etapa, tarjeta = cliente con
// score. Click en la tarjeta abre su ficha (notas + timeline unificado).
// La etapa se mueve con el menú punto+palabra (drag-drop llega después).
export default function Crm() {
  const qc = useQueryClient();
  const [sel, setSel] = useState(null);
  const [nota, setNota] = useState('');

  const { data } = useQuery({ queryKey: ['crm-pipeline'], queryFn: () => api.get('/api/crm/pipeline') });
  const { data: notas = [] } = useQuery({
    queryKey: ['crm-notas', sel?.id], enabled: !!sel,
    queryFn: () => api.get(`/api/crm/clientes/${sel.id}/notas`),
  });
  const { data: timeline = [] } = useQuery({
    queryKey: ['crm-timeline', sel?.id], enabled: !!sel,
    queryFn: () => api.get(`/api/crm/clientes/${sel.id}/timeline`),
  });

  const moverEtapa = useMutation({
    mutationFn: ({ id, etapa }) => api.put(`/api/crm/clientes/${id}/etapa`, { etapa }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['crm-pipeline'] }); qc.invalidateQueries({ queryKey: ['crm-timeline'] }); },
    onError: handleApiError,
  });
  const agregarNota = useMutation({
    mutationFn: () => api.post(`/api/crm/clientes/${sel.id}/notas`, { contenido: nota }),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setNota(''); toastOk('Nota guardada');
      qc.invalidateQueries({ queryKey: ['crm-notas', sel.id] });
      qc.invalidateQueries({ queryKey: ['crm-timeline', sel.id] });
    },
    onError: handleApiError,
  });

  if (!data) return (
    <div className="sin-scroll">
      <div className="page-title">CRM · Pipeline</div>
      <Skeleton height={300} radius="md" mt="md" />
    </div>
  );

  const TIPO_PUNTO = { pedido: 'var(--green)', nota: 'var(--info)', etapa: 'var(--yellow)', cita: 'var(--text-mute)' };
  const total = data.etapas.reduce((s, e) => s + data.columnas[e].length, 0);

  return (
    <div className="sin-scroll">
      <div className="page-title">CRM · Pipeline</div>
      <div className="page-sub">{total} clientes en el embudo — mueve la etapa desde cada tarjeta; click abre la ficha</div>
      <div className="page-scrollable">
        <div className="crm-cols">
          {data.etapas.map(etapa => (
            <div key={etapa}>
              <div className="f-h4"><span>{ETAPA_LABEL[etapa]}</span><span className="der"><b>{data.columnas[etapa].length}</b></span></div>
              <div className="f-stagger">
                {data.columnas[etapa].slice(0, 40).map(c => (
                  <Card key={c.id} withBorder radius="md" p="sm" className="card" mb={8}
                    style={{ cursor: 'pointer' }} onClick={() => setSel(c)}>
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
      </div>

      <Drawer opened={!!sel} onClose={() => setSel(null)} position="right" size="md"
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

            <div className="f-h4"><span>Historial</span><span className="der">{timeline.length} eventos</span></div>
            <div className="f-stagger">
              {timeline.length === 0 && notas.length === 0 && <Text size="sm" c="dimmed">Sin actividad registrada todavía.</Text>}
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
    </div>
  );
}
