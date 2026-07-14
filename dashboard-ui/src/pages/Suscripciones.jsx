import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Group, Text, Select } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { confirmar, toastOk } from '../lib/ui';
import { money } from '../lib/format';

// F5.1 — Suscripciones mensuales (giro servicios). El MRR proyecta el ingreso
// recurrente; cobrar un período genera un pedido + link de pago (se confirma en
// Pedidos, como todo). Se cubre también lo que un ISP necesitaría (recurrencia).
const ESTATUS_BADGE = { activa: 'badge-verde', suspendida: 'badge-amarillo', cancelada: 'badge-rojo' };

export default function Suscripciones() {
  const qc = useQueryClient();
  const [nueva, setNueva] = useState({ nombre: '', telefono: '', concepto: '', monto: '', dia_corte: 1, referencia: '' });
  const { data } = useQuery({ queryKey: ['suscripciones'], queryFn: () => api.get('/api/suscripciones'), refetchInterval: 60000 });
  const subs = data?.suscripciones || [];
  const res = data?.resumen || {};

  const crear = useMutation({
    mutationFn: () => api.post('/api/suscripciones', { ...nueva, monto: Number(nueva.monto) }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setNueva({ nombre: '', telefono: '', concepto: '', monto: '', dia_corte: 1, referencia: '' }); qc.invalidateQueries({ queryKey: ['suscripciones'] }); },
    onError: handleApiError,
  });
  const marcar = useMutation({
    mutationFn: ({ id, estatus }) => api.put(`/api/suscripciones/${id}`, { estatus }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['suscripciones'] }); },
    onError: handleApiError,
  });
  const cobrar = async (s) => {
    if (!await confirmar({ titulo: 'Generar cobro', mensaje: `Generar el cargo de ${money(s.monto)} de ${s.nombre}? Se crea un pedido con link de pago (se cobra en Pedidos).` })) return;
    const r = await api.post(`/api/suscripciones/${s.id}/cobrar`, {}).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk(`Cargo generado · Folio ${r.folio} · próximo ${r.proximo_cobro}`);
    qc.invalidateQueries({ queryKey: ['suscripciones'] });
  };
  const generarTodos = async () => {
    if (!await confirmar({ titulo: 'Generar cobros del día', mensaje: `Generar los cargos de las suscripciones activas vencidas hoy (${res.por_cobrar_hoy || 0})?` })) return;
    const r = await api.post('/api/suscripciones/generar-cobros', {}).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk(`${r.generados} cargo(s) generado(s) · ${money(r.total)}`);
    qc.invalidateQueries({ queryKey: ['suscripciones'] });
  };

  return (
    <div className="sin-scroll">
      <div className="page-title">Suscripciones</div>
      <div className="page-sub">Cobro recurrente mensual — el MRR proyecta tu ingreso recurrente</div>

      <Group mb="md" wrap="wrap">
        <Card withBorder radius="md" p="md" className="kpi-card kpi-dark">
          <Text size="xs" c="rgba(255,255,255,0.8)">Ingreso recurrente mensual (MRR)</Text>
          <Text fw={700} size="xl">{money(res.mrr)}</Text>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card"><Text size="xs" c="dimmed">Activas</Text><Text fw={700} size="xl">{res.activas || 0}</Text></Card>
        <Card withBorder radius="md" p="md" className="kpi-card"><Text size="xs" c="dimmed">Suspendidas</Text><Text fw={700} size="xl">{res.suspendidas || 0}</Text></Card>
        <Card withBorder radius="md" p="md" className="kpi-card">
          <Text size="xs" c="dimmed">Por cobrar hoy</Text>
          <Group gap="xs" align="center"><Text fw={700} size="xl" c={res.por_cobrar_hoy > 0 ? 'orange' : undefined}>{res.por_cobrar_hoy || 0}</Text>
            {res.por_cobrar_hoy > 0 && <Button size="compact-xs" onClick={generarTodos}>Generar cobros</Button>}</Group>
        </Card>
      </Group>

      <div className="split-2w">
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Nueva suscripción</h3></div>
          <TextInput label="Cliente *" value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} mb="sm" />
          <Group grow mb="sm">
            <TextInput label="Teléfono" value={nueva.telefono} onChange={e => setNueva({ ...nueva, telefono: e.target.value })} />
            <TextInput label="Concepto" placeholder="Plan mensual" value={nueva.concepto} onChange={e => setNueva({ ...nueva, concepto: e.target.value })} />
          </Group>
          <Group grow mb="sm">
            <NumberInput label="Monto mensual *" min={0} decimalScale={2} value={nueva.monto} onChange={v => setNueva({ ...nueva, monto: v })} />
            <NumberInput label="Día de corte" min={1} max={28} value={nueva.dia_corte} onChange={v => setNueva({ ...nueva, dia_corte: v || 1 })} />
          </Group>
          <TextInput label="Referencia (datos del cliente)" value={nueva.referencia} onChange={e => setNueva({ ...nueva, referencia: e.target.value })} mb="md" />
          <Button fullWidth onClick={() => crear.mutate()} disabled={!nueva.nombre.trim() || !(Number(nueva.monto) > 0)}>Crear suscripción</Button>
        </Card>

        <Card withBorder radius="md" p="lg" className="card sin-scroll-card">
          <div className="card-header"><h3>Suscripciones</h3></div>
          <div className="table-wrap page-scrollable">
            <table>
              <thead><tr><th>Cliente</th><th className="num">Monto</th><th>Corte</th><th>Próximo cobro</th><th>Estatus</th><th></th></tr></thead>
              <tbody>
                {subs.length === 0 && <tr><td colSpan={6} className="empty">Sin suscripciones — crea la primera</td></tr>}
                {subs.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.nombre}</strong>{s.concepto && <div className="text-muted" style={{ fontSize: 11 }}>{s.concepto}</div>}</td>
                    <td className="num">{money(s.monto)}</td>
                    <td>día {s.dia_corte}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{s.proximo_cobro || '—'}</td>
                    <td><span className={`badge ${ESTATUS_BADGE[s.estatus] || 'badge-azul'}`}>{s.estatus}</span></td>
                    <td>
                      <Group gap={4} wrap="nowrap">
                        {s.estatus === 'activa' && <Button size="compact-xs" color="teal" onClick={() => cobrar(s)}>Cobrar</Button>}
                        <Select size="xs" w={120} value={s.estatus} allowDeselect={false}
                          onChange={v => v && v !== s.estatus && marcar.mutate({ id: s.id, estatus: v })}
                          data={[{ value: 'activa', label: 'Activa' }, { value: 'suspendida', label: 'Suspendida' }, { value: 'cancelada', label: 'Cancelada' }]} />
                      </Group>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
