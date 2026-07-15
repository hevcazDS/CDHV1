import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, Group, Text, Select, SegmentedControl } from '@mantine/core';
import { CalendarDays } from 'lucide-react';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { prompt, toastOk } from '../lib/ui';
import Calendario from '../components/Calendario';

const ESTATUS_BADGE = { pendiente: 'badge-amarillo', confirmada: 'badge-azul', completada: 'badge-verde', cancelada: 'badge-rojo', no_asistio: 'badge-rojo' };
const ESTATUS_COLOR = { pendiente: '#eab308', confirmada: 'var(--info)', completada: 'var(--green)', cancelada: 'var(--red)', no_asistio: 'var(--red)' };

// Agenda del día/semana: el bot agenda solo (módulo Citas), aquí se opera
// (confirmar/completar/cancelar) y se agenda manual por teléfono.
export default function Citas() {
  const qc = useQueryClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const en7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [rango, setRango] = useState({ desde: hoy, hasta: en7 });
  const [modo, setModo] = useState('calendario');
  const [nueva, setNueva] = useState({ telefono: '', nombre: '', servicio: '', fecha: hoy, hora: '10:00', id_empleado: '' });

  const { data: citas = [] } = useQuery({
    queryKey: ['citas', rango],
    queryFn: () => api.get(`/api/citas?desde=${rango.desde}&hasta=${rango.hasta}`),
    refetchInterval: 60000,
  });

  // Quién atiende (barbería/estética multi-staff): lista ligera id+nombre.
  const { data: empleados = [] } = useQuery({
    queryKey: ['citas-empleados'],
    queryFn: () => api.get('/api/citas/empleados').catch(() => []),
  });

  const crear = useMutation({
    mutationFn: () => api.post('/api/citas', { ...nueva, id_empleado: nueva.id_empleado ? Number(nueva.id_empleado) : undefined }),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setNueva({ ...nueva, telefono: '', nombre: '', servicio: '' });
      qc.invalidateQueries({ queryKey: ['citas'] });
    },
    onError: handleApiError,
  });
  // Cobrar el servicio de la cita: pide precio (prefill del servicio) y método,
  // arma la venta reusando el POS. Cierra el círculo agendar→cobrar.
  const cobrarCita = async (c) => {
    const precio = await prompt({ titulo: 'Cobrar cita', mensaje: `Servicio: ${c.servicio || 'servicio'}. Precio a cobrar:`, valorInicial: String(c.servicio_precio || ''), tipo: 'text' });
    if (precio === null) return;
    const p = Number(String(precio).replace(/[^0-9.]/g, '')) || 0;
    if (!(p > 0)) return handleApiError(new Error('Captura un precio válido'));
    const metodo = await prompt({ titulo: 'Método de pago', mensaje: '¿Cómo pagó?', valorInicial: 'efectivo',
      opciones: [{ value: 'efectivo', label: 'Efectivo' }, { value: 'tarjeta', label: 'Tarjeta' }, { value: 'transferencia', label: 'Transferencia' }] });
    if (!metodo) return;
    const r = await api.post(`/api/citas/${c.id}/cobrar`, { precio: p, metodo_pago: metodo }).catch(e => ({ ok: false, error: e.message }));
    if (r.ok) { toastOk(`Cobrado · Folio ${r.folio} · $${Number(r.total).toFixed(2)}`); qc.invalidateQueries({ queryKey: ['citas'] }); }
    else handleApiError(new Error(r.error));
  };
  const marcar = useMutation({
    mutationFn: ({ id, estatus }) => api.put(`/api/citas/${id}`, { estatus }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['citas'] }); },
    onError: handleApiError,
  });

  const porDia = citas.reduce((m, c) => ((m[c.fecha] = m[c.fecha] || []).push(c), m), {});

  return (
    <div className="sin-scroll">
      <div className="page-title">Citas</div>
      <div className="page-sub">Agenda de la semana — el bot agenda solo cuando el módulo Citas está activo</div>
      <div className="page-scrollable">
      <div className="split-2w">
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Agendar manual</h3></div>
          <TextInput label="Teléfono *" value={nueva.telefono} onChange={e => setNueva({ ...nueva, telefono: e.target.value })} mb="sm" />
          <Group grow mb="sm">
            <TextInput label="Nombre" value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} />
            <TextInput label="Servicio" value={nueva.servicio} onChange={e => setNueva({ ...nueva, servicio: e.target.value })} />
          </Group>
          <Group grow mb="sm">
            <Select label="Atiende" placeholder="Sin asignar" clearable
              data={empleados.map(e => ({ value: String(e.id), label: e.nombre + (e.puesto ? ' · ' + e.puesto : '') }))}
              value={nueva.id_empleado || null} onChange={v => setNueva({ ...nueva, id_empleado: v || '' })} />
          </Group>
          <Group grow mb="md">
            <TextInput type="date" label="Fecha" value={nueva.fecha} onChange={e => setNueva({ ...nueva, fecha: e.target.value })} />
            <TextInput type="time" label="Hora" value={nueva.hora} onChange={e => setNueva({ ...nueva, hora: e.target.value })} />
          </Group>
          <Button fullWidth onClick={() => crear.mutate()} disabled={!nueva.telefono.trim()}>Agendar</Button>
          <Group mt="lg" gap="xs">
            <TextInput type="date" size="xs" label="Ver desde" value={rango.desde} onChange={e => setRango({ ...rango, desde: e.target.value })} />
            <TextInput type="date" size="xs" label="hasta" value={rango.hasta} onChange={e => setRango({ ...rango, hasta: e.target.value })} />
          </Group>
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header">
            <h3><CalendarDays size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 7 }} />Agenda</h3>
            <SegmentedControl size="xs" value={modo} onChange={setModo} data={[{ label: 'Calendario', value: 'calendario' }, { label: 'Lista', value: 'lista' }]} />
          </div>

          {modo === 'calendario' && (
            <Calendario
              eventos={citas.map(c => ({ fecha: c.fecha, hora: c.hora, titulo: c.nombre || c.telefono, sub: c.servicio, color: ESTATUS_COLOR[c.estatus] }))}
              onRango={(desde, hasta) => setRango({ desde, hasta })}
              onClickDia={(f) => { setRango({ desde: f, hasta: f }); setModo('lista'); }}
            />
          )}

          {modo === 'lista' && citas.length === 0 && <div className="empty">Sin citas en el rango — el bot las irá llenando</div>}
          {modo === 'lista' && Object.entries(porDia).map(([fecha, lista]) => (
            <div key={fecha} style={{ marginBottom: 16 }}>
              <Text size="sm" fw={700} mb={6}>{fecha === hoy ? 'HOY · ' + fecha : fecha}</Text>
              <div className="table-wrap page-scrollable">
                <table>
                  <tbody>
                    {lista.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{c.hora}</td>
                        <td><strong>{c.nombre || c.telefono}</strong>{(c.servicio || c.empleado_nombre) && <div className="text-muted" style={{ fontSize: 11 }}>{c.servicio}{c.servicio_precio > 0 ? ' · $' + Number(c.servicio_precio).toFixed(0) : ''}{c.empleado_nombre ? ' · atiende ' + c.empleado_nombre : ''}</div>}</td>
                        <td>
                          <span className={`badge ${ESTATUS_BADGE[c.estatus] || 'badge-azul'}`}>{c.estatus.replace('_', ' ')}</span>
                          {c.id_pedido && <span className="badge badge-verde" style={{ marginLeft: 6 }}>cobrada</span>}
                        </td>
                        <td>
                          <Group gap={6} wrap="nowrap">
                            <Select size="xs" w={130} value={c.estatus} allowDeselect={false}
                              onChange={v => v && v !== c.estatus && marcar.mutate({ id: c.id, estatus: v })}
                              data={[
                                { value: 'pendiente', label: 'Pendiente' }, { value: 'confirmada', label: 'Confirmada' },
                                { value: 'completada', label: 'Completada' }, { value: 'cancelada', label: 'Cancelada' },
                                { value: 'no_asistio', label: 'No asistió' },
                              ]} />
                            {!c.id_pedido && c.estatus !== 'cancelada' && c.estatus !== 'no_asistio' && (
                              <Button size="compact-xs" color="teal" onClick={() => cobrarCita(c)}>Cobrar</Button>
                            )}
                          </Group>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Card>
      </div>
      </div>
    </div>
  );
}
