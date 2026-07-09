import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, Group, Text, Select } from '@mantine/core';
import { CalendarDays } from 'lucide-react';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';

const ESTATUS_BADGE = { pendiente: 'badge-amarillo', confirmada: 'badge-azul', completada: 'badge-verde', cancelada: 'badge-rojo', no_asistio: 'badge-rojo' };

// Agenda del día/semana: el bot agenda solo (módulo Citas), aquí se opera
// (confirmar/completar/cancelar) y se agenda manual por teléfono.
export default function Citas() {
  const qc = useQueryClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const en7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [rango, setRango] = useState({ desde: hoy, hasta: en7 });
  const [nueva, setNueva] = useState({ telefono: '', nombre: '', servicio: '', fecha: hoy, hora: '10:00' });

  const { data: citas = [] } = useQuery({
    queryKey: ['citas', rango],
    queryFn: () => api.get(`/api/citas?desde=${rango.desde}&hasta=${rango.hasta}`),
    refetchInterval: 60000,
  });

  const crear = useMutation({
    mutationFn: () => api.post('/api/citas', nueva),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setNueva({ ...nueva, telefono: '', nombre: '', servicio: '' });
      qc.invalidateQueries({ queryKey: ['citas'] });
    },
    onError: handleApiError,
  });
  const marcar = useMutation({
    mutationFn: ({ id, estatus }) => api.put(`/api/citas/${id}`, { estatus }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['citas'] }); },
    onError: handleApiError,
  });

  const porDia = citas.reduce((m, c) => ((m[c.fecha] = m[c.fecha] || []).push(c), m), {});

  return (
    <div>
      <div className="page-title">Citas</div>
      <div className="page-sub">Agenda de la semana — el bot agenda solo cuando el módulo Citas está activo</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, alignItems: 'start' }}>
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Agendar manual</h3></div>
          <TextInput label="Teléfono *" value={nueva.telefono} onChange={e => setNueva({ ...nueva, telefono: e.target.value })} mb="sm" />
          <Group grow mb="sm">
            <TextInput label="Nombre" value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} />
            <TextInput label="Servicio" value={nueva.servicio} onChange={e => setNueva({ ...nueva, servicio: e.target.value })} />
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
            <Text size="xs" c="dimmed">{citas.length} cita{citas.length === 1 ? '' : 's'}</Text>
          </div>
          {citas.length === 0 && <div className="empty">Sin citas en el rango — el bot las irá llenando</div>}
          {Object.entries(porDia).map(([fecha, lista]) => (
            <div key={fecha} style={{ marginBottom: 16 }}>
              <Text size="sm" fw={700} mb={6}>{fecha === hoy ? 'HOY · ' + fecha : fecha}</Text>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {lista.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{c.hora}</td>
                        <td><strong>{c.nombre || c.telefono}</strong>{c.servicio && <div className="text-muted" style={{ fontSize: 11 }}>{c.servicio}</div>}</td>
                        <td><span className={`badge ${ESTATUS_BADGE[c.estatus] || 'badge-azul'}`}>{c.estatus.replace('_', ' ')}</span></td>
                        <td>
                          <Select size="xs" w={150} value={c.estatus} allowDeselect={false}
                            onChange={v => v && v !== c.estatus && marcar.mutate({ id: c.id, estatus: v })}
                            data={[
                              { value: 'pendiente', label: 'Pendiente' }, { value: 'confirmada', label: 'Confirmada' },
                              { value: 'completada', label: 'Completada' }, { value: 'cancelada', label: 'Cancelada' },
                              { value: 'no_asistio', label: 'No asistió' },
                            ]} />
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
  );
}
