import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Stack, Text, Title, TextInput, Button, Table, Badge, Skeleton } from '@mantine/core';
import { LogIn } from 'lucide-react';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk } from '../lib/ui';
import { soloTelefono } from '../lib/format';

// Check-in / asistencia (gimnasio y giros de servicio). Registra la entrada del
// socio por teléfono o nombre; muestra las visitas del día. Congelar membresía se
// hace en Suscripciones (suspender). Ver dashboard/routes/asistencias.js.
export default function Asistencias() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['asistencias'], queryFn: () => api.get('/api/asistencias'), refetchInterval: 30000 });

  const checkin = useMutation({
    mutationFn: () => {
      const v = q.trim();
      const esTel = /^\+?\d[\d\s-]{6,}$/.test(v);
      return api.post('/api/asistencias', esTel ? { telefono: v } : { nombre: v });
    },
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setQ(''); toastOk(`✅ ${r.nombre} — ${r.visitas_mes} visita${r.visitas_mes === 1 ? '' : 's'} este mes`); qc.invalidateQueries({ queryKey: ['asistencias'] }); },
    onError: handleApiError,
  });

  return (
    <div className="sin-scroll">
      <Group justify="space-between" mb="md">
        <Title order={3}>Check-in del día</Title>
        <Badge size="lg" variant="light">{data?.total || 0} hoy</Badge>
      </Group>

      <Card withBorder radius="md" p="md" className="card" mb="md">
        <Group gap="sm" align="flex-end">
          <TextInput style={{ flex: 1 }} label="Registrar entrada" placeholder="Teléfono del socio o su nombre"
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && q.trim() && checkin.mutate()} data-autofocus />
          <Button leftSection={<LogIn size={16} />} loading={checkin.isPending} disabled={!q.trim()} onClick={() => checkin.mutate()}>Registrar</Button>
        </Group>
      </Card>

      <Card withBorder radius="md" p="md" className="card page-scrollable">
        {isLoading ? <Skeleton height={200} radius="md" /> : (
          <Table highlightOnHover verticalSpacing="xs" stickyHeader>
            <thead><tr><th>Hora</th><th>Socio</th><th>Teléfono</th></tr></thead>
            <tbody>
              {(data?.asistencias || []).length === 0 && <tr><td colSpan={3}><Text size="sm" c="dimmed" ta="center">Sin entradas registradas hoy.</Text></td></tr>}
              {(data?.asistencias || []).map(a => (
                <tr key={a.id}>
                  <td>{a.hora}</td>
                  <td>{a.nombre}{!a.id_cliente && <Badge ml={6} size="xs" variant="light" color="gray">visitante</Badge>}</td>
                  <td>{a.telefono ? soloTelefono(a.telefono) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
