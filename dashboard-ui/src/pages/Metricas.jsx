import { useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { Card, Group, Title, ActionIcon, Button, Text, RingProgress } from '@mantine/core';
import PuntosGrafica from '../components/PuntosGrafica';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { fmt } from '../lib/format';
import { Emoji, useTextoEmoji } from '../context/EmojiContext';

const ESTILOS_CHART = [
  { value: 'linea', label: 'Línea' },
  { value: 'barras', label: 'Barras' },
];
const CHART_TIPO_KEY = 'metricas_chart_tipo';

const ESTATUS_COLOR = { pendiente: 'amarillo', confirmado: 'azul', preparando: 'azul', enviado: 'azul', entregado: 'verde', cancelado: 'rojo' };
const C_ACCENT = '#5b8cff', C_GREEN = '#36d399', C_YELLOW = '#fbbd23', C_RED = '#f4566c', C_GRID = '#262f42', C_DIM = '#9aa4b8';
const MOTIVO_LABEL = { precio: 'Precio', envio: 'Envío', otro: 'Otro' };
const TONO_LABEL = { A: 'A · Formal', B: 'B · Casual', C: 'C · Amigable', D: 'D · Ventas', sin_dato: 'Sin dato (anterior a esta métrica)' };
const TONO_COLOR = { A: 'azul', B: 'verde', C: 'amarillo', D: 'rojo', sin_dato: 'azul' };

export default function Metricas() {
  const txt = useTextoEmoji();
  const [reporteMsg, setReporteMsg] = useState(null);
  const [preview, setPreview] = useState(null);
  const [chartTipo, setChartTipo] = useState(() => {
    const v = localStorage.getItem(CHART_TIPO_KEY);
    return v === 'linea' || v === 'barras' ? v : 'linea';
  });
  const cambiarChartTipo = (v) => { setChartTipo(v); localStorage.setItem(CHART_TIPO_KEY, v); };

  const { data: d, refetch: refetchMetricas } = useQuery({
    queryKey: ['metricas'],
    queryFn: () => api.get('/api/metricas').catch(() => null),
  });
  const { data: conv, refetch: refetchConv } = useQuery({
    queryKey: ['conversion'],
    queryFn: () => api.get('/api/conversion').catch(() => null),
  });
  const { data: campanas = [], refetch: refetchCampanas } = useQuery({
    queryKey: ['metricas-campanas'],
    queryFn: () => api.get('/api/metricas/campanas').catch(() => []),
  });
  const { data: motivos = [], refetch: refetchMotivos } = useQuery({
    queryKey: ['metricas-abandono-motivos'],
    queryFn: () => api.get('/api/metricas/abandono-motivos').catch(() => []),
  });

  const cargar = () => { refetchMetricas(); refetchConv(); refetchCampanas(); refetchMotivos(); };

  const dias = d?.por_dia || [];
  const porEstatus = d?.por_estatus || [];
  const totalEstatus = porEstatus.reduce((s, e) => s + (e.n || 0), 0);
  const totalMotivos = motivos.reduce((s, m) => s + (m.n || 0), 0);
  const MOTIVO_COLOR = { precio: C_RED, envio: C_YELLOW, otro: C_DIM };

  const reporteMutation = useMutation({
    mutationFn: (destino) => api.post('/api/reporte', { destino }),
    onSuccess: (r) => {
      if (r.ok) {
        setReporteMsg({ ok: true, texto: '✅ ' + r.msg });
        if (r.preview) setPreview(r.preview.replace(/\*/g, '').replace(/_/g, ''));
      } else setReporteMsg({ ok: false, texto: '❌ ' + r.error });
    },
    onError: (e) => setReporteMsg({ ok: false, texto: '❌ ' + e.message }),
  });

  return (
    <div>
      <div className="page-title">Métricas</div>
      <div className="page-sub">Pedidos, conversión y reportes</div>

      {/* Ingresos (dinero cobrado) + satisfacción del cliente */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 24 }}>
        <Card withBorder radius="md" p="xl" className="kpi-card kpi-dark">
          <Text size="sm" c="dimmed">Ingresos hoy</Text>
          <Text size="26px" fw={700} className="kpi-num">${fmt(d?.ingresos?.hoy || 0)}</Text>
        </Card>
        <Card withBorder radius="md" p="xl" className="kpi-card">
          <Text size="sm" c="dimmed">Ingresos esta semana</Text>
          <Text size="26px" fw={700} className="kpi-num">${fmt(d?.ingresos?.semana || 0)}</Text>
        </Card>
        <Card withBorder radius="md" p="xl" className="kpi-card">
          <Text size="sm" c="dimmed">Ingresos este mes</Text>
          <Text size="26px" fw={700} className="kpi-num">${fmt(d?.ingresos?.mes || 0)}</Text>
        </Card>
        <Card withBorder radius="md" p="xl" className="kpi-card">
          <Text size="sm" c="dimmed">Satisfacción (CSAT)</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RingProgress
              size={72} thickness={7} roundCaps rootColor="var(--panel-2)"
              sections={[{ value: d?.csat?.promedio ? Math.min(100, (d.csat.promedio / 5) * 100) : 0, color: 'var(--green)' }]}
              label={<Text ta="center" size="sm" fw={700}>{d?.csat?.promedio ? Math.round((d.csat.promedio / 5) * 100) + '%' : '—'}</Text>}
            />
            <Text size="xs" c="dimmed">{d?.csat?.n || 0} valoracion{(d?.csat?.n || 0) === 1 ? '' : 'es'}</Text>
          </div>
        </Card>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <Text size="sm" c="dimmed">Pedidos hoy</Text>
          <Text size="26px" fw={700}>{d?.pedidos?.hoy?.n ?? '-'}</Text>
          {d?.pedidos?.hoy?.t > 0 && <span style={{ fontSize: 12, color: 'var(--green)' }}>${fmt(d.pedidos.hoy.t)}</span>}
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <Text size="sm" c="dimmed">Esta semana</Text>
          <Text size="26px" fw={700}>{d?.pedidos?.semana?.n ?? '-'}</Text>
          {d?.pedidos?.semana?.t > 0 && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>${fmt(d.pedidos.semana.t)}</span>}
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <Text size="sm" c="dimmed">Este mes</Text>
          <Text size="26px" fw={700}>{d?.pedidos?.mes?.n ?? '-'}</Text>
          {d?.pedidos?.mes?.t > 0 && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>${fmt(d.pedidos.mes.t)}</span>}
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <Text size="sm" c="dimmed">Pagos pendientes</Text>
          <Text size="26px" fw={700}>{d?.pagos?.pendientes?.n ?? '-'}</Text>
          {d?.pagos?.pendientes?.t > 0 && <span style={{ fontSize: 12, color: 'var(--yellow)' }}>${fmt(d.pagos.pendientes.t)}</span>}
        </Card>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb="md" wrap="wrap">
            <Title order={4}><Emoji>📈 </Emoji>Pedidos últimos 7 días {conv && <span className="badge badge-azul">Conversión: {conv.tasa_conversion}</span>}</Title>
            <Group gap="xs">
              <PuntosGrafica opciones={ESTILOS_CHART} valor={chartTipo} onChange={cambiarChartTipo} />
              <ActionIcon variant="default" onClick={cargar}>🔄</ActionIcon>
            </Group>
          </Group>
          {dias.length === 0
            ? <div className="empty">Sin pedidos esta semana</div>
            : (
              <ResponsiveContainer width="100%" height={180}>
                {chartTipo === 'linea' ? (
                  <LineChart data={dias.map(dd => ({ ...dd, diaCorto: (dd.dia || '').slice(5) }))}>
                    <CartesianGrid stroke={C_GRID} vertical={false} />
                    <XAxis dataKey="diaCorto" stroke={C_DIM} fontSize={11} tickLine={false} axisLine={{ stroke: C_GRID }} />
                    <YAxis stroke={C_DIM} fontSize={11} tickLine={false} axisLine={false} width={32} />
                    <Tooltip
                      contentStyle={{ background: '#1c2333', border: '1px solid #262f42', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#fff' }}
                      formatter={(value, name) => [name === 't' ? `$${fmt(value)}` : value, name === 't' ? 'Monto' : 'Pedidos']}
                    />
                    <Line type="monotone" dataKey="t" stroke={C_ACCENT} strokeWidth={2} dot={{ r: 3, fill: C_ACCENT }} />
                  </LineChart>
                ) : (
                  <BarChart data={dias.map(dd => ({ ...dd, diaCorto: (dd.dia || '').slice(5) }))}>
                    <CartesianGrid stroke={C_GRID} vertical={false} />
                    <XAxis dataKey="diaCorto" stroke={C_DIM} fontSize={11} tickLine={false} axisLine={{ stroke: C_GRID }} />
                    <YAxis stroke={C_DIM} fontSize={11} tickLine={false} axisLine={false} width={32} />
                    <Tooltip
                      contentStyle={{ background: '#1c2333', border: '1px solid #262f42', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#fff' }}
                      formatter={(value, name) => [name === 't' ? `$${fmt(value)}` : value, name === 't' ? 'Monto' : 'Pedidos']}
                    />
                    <Bar dataKey="t" fill={C_ACCENT} radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            )}
        </Card>
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('📋 Por estatus')}</Title>
          {porEstatus.length === 0 && <div className="empty">Sin pedidos</div>}
          {porEstatus.map((e, i) => {
            const pct = totalEstatus ? Math.round((e.n / totalEstatus) * 100) : 0;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span className={`badge badge-${ESTATUS_COLOR[e.estatus] || 'azul'}`} style={{ minWidth: 75, justifyContent: 'center' }}>{e.estatus}</span>
                <div style={{ flex: 1, background: 'var(--panel-2)', borderRadius: 99, height: 7 }}>
                  <div style={{ width: pct + '%', background: 'var(--accent)', height: 7, borderRadius: 99 }}></div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{e.n || 0}</span>
              </div>
            );
          })}
        </Card>
      </div>

      <Card withBorder radius="md" p="lg" mb={16}>
        <Title order={4} mb="md">{txt('🎭 Pedidos por tono del bot')}</Title>
        {(!conv?.por_tono || conv.por_tono.length === 0) && <div className="empty">Sin pedidos todavía</div>}
        {conv?.por_tono?.length > 0 && (() => {
          const totalTono = conv.por_tono.reduce((s, t) => s + (t.pedidos || 0), 0);
          return conv.por_tono.map((t, i) => {
            const pct = totalTono ? Math.round((t.pedidos / totalTono) * 100) : 0;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span className={`badge badge-${TONO_COLOR[t.tono] || 'azul'}`} style={{ minWidth: 170, justifyContent: 'center' }}>{TONO_LABEL[t.tono] || t.tono}</span>
                <div style={{ flex: 1, background: 'var(--panel-2)', borderRadius: 99, height: 7 }}>
                  <div style={{ width: pct + '%', background: 'var(--accent)', height: 7, borderRadius: 99 }}></div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{t.pedidos} pedidos</span>
                <span style={{ fontSize: 12, color: 'var(--text-mute)', minWidth: 90, textAlign: 'right' }}>${fmt(t.ingresos)}</span>
                <span style={{ fontSize: 12, color: 'var(--text-mute)', minWidth: 90, textAlign: 'right' }}>tkt ${fmt(t.ticket_promedio)}</span>
              </div>
            );
          });
        })()}
      </Card>

      <Card withBorder radius="md" p="lg" mb={16}>
        <Title order={4} mb={4}>{txt('📈 Conversión real por tono')}</Title>
        <p style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 12 }}>
          {txt('⚠️ ')}El cruce búsqueda→compra es aproximado (por teléfono), no exacto — usar como tendencia, no como dato definitivo.
        </p>
        {(!conv?.conversion_por_tono || conv.conversion_por_tono.length === 0) && <div className="empty">Sin búsquedas registradas todavía</div>}
        {conv?.conversion_por_tono?.map((t, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
            <span className={`badge badge-${TONO_COLOR[t.tono] || 'azul'}`} style={{ minWidth: 170, justifyContent: 'center' }}>{TONO_LABEL[t.tono] || t.tono}</span>
            <div style={{ flex: 1, background: 'var(--panel-2)', borderRadius: 99, height: 7 }}>
              <div style={{ width: t.tasa + '%', background: 'var(--green)', height: 7, borderRadius: 99 }}></div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t.tasa}%</span>
            <span style={{ fontSize: 12, color: 'var(--text-mute)', minWidth: 110, textAlign: 'right' }}>{t.convertidos}/{t.total} búsquedas</span>
          </div>
        ))}
      </Card>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('🎯 Conversión por campaña')}</Title>
          {campanas.length === 0 && <div className="empty">Sin datos todavía — corre la migración 0020 si ya hiciste envíos masivos/automáticos.</div>}
          {campanas.length > 0 && (
            <ResponsiveContainer width="100%" height={Math.max(campanas.length * 40, 120)}>
              <BarChart data={campanas} layout="vertical" margin={{ left: 10, right: 10 }}>
                <CartesianGrid stroke={C_GRID} horizontal={false} />
                <XAxis type="number" stroke={C_DIM} fontSize={11} tickLine={false} axisLine={{ stroke: C_GRID }} allowDecimals={false} />
                <YAxis type="category" dataKey="campana" stroke={C_DIM} fontSize={11} tickLine={false} axisLine={false} width={140} />
                <Tooltip contentStyle={{ background: '#1c2333', border: '1px solid #262f42', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#fff' }} />
                <Bar dataKey="enviados" name="Enviados" fill={C_GRID} radius={[0, 4, 4, 0]} />
                <Bar dataKey="convertidos" name="Convertidos" fill={C_GREEN} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('💬 Por qué no compraron')}</Title>
          {motivos.length === 0 && <div className="empty">Sin datos todavía — se llena cuando los clientes responden al mensaje de carrito abandonado.</div>}
          {motivos.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={motivos} dataKey="n" nameKey="motivo" innerRadius={32} outerRadius={58} paddingAngle={2}>
                    {motivos.map((m, i) => <Cell key={i} fill={MOTIVO_COLOR[m.motivo] || C_DIM} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1c2333', border: '1px solid #262f42', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {motivos.map((m, i) => {
                  const pct = totalMotivos ? Math.round((m.n / totalMotivos) * 100) : 0;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: MOTIVO_COLOR[m.motivo] || C_DIM, display: 'inline-block' }}></span>
                      <span style={{ fontSize: 13 }}>{MOTIVO_LABEL[m.motivo] || m.motivo}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-mute)', marginLeft: 'auto' }}>{m.n} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card withBorder radius="md" p="lg">
        <Title order={4} mb="md">{txt('📤 Reporte al supervisor')}</Title>
        <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 12 }}>Resumen con pedidos, ingresos, clientes y alertas del día.</p>
        <Group gap={7} mb={10} wrap="nowrap">
          <Button style={{ flex: 1 }} disabled={reporteMutation.isPending} onClick={() => reporteMutation.mutate('whatsapp')}>{txt('📱 WhatsApp')}</Button>
          <Button variant="default" style={{ flex: 1 }} disabled={reporteMutation.isPending} onClick={() => reporteMutation.mutate('email')}>{txt('📧 Email')}</Button>
        </Group>
        {preview && <pre style={{ background: 'var(--panel-2)', borderRadius: 7, padding: 10, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 250, overflowY: 'auto' }}>{preview}</pre>}
        {reporteMsg && <div className={reporteMsg.ok ? 'card' : 'login-error'} style={{ marginTop: 12 }}>{txt(reporteMsg.texto)}</div>}
      </Card>
    </div>
  );
}
