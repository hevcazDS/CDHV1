import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, Text } from '@mantine/core';
import { Wallet, ReceiptText, Users, CreditCard, Headset, TriangleAlert, TrendingUp, Package, CalendarDays } from 'lucide-react';
import { api } from '../api';
import { useWhatsAppQR } from '../hooks/useWhatsAppQR';
import WhatsAppQR from '../components/WhatsAppQR';
import { fdate } from '../lib/format';

// Lazy: recharts (~400 KB) llega después del primer render, no lo bloquea
const GraficaSemana = lazy(() => import('../components/GraficaSemana'));

function pillEstatus(estatus) {
  const e = (estatus || '').toLowerCase();
  if (e === 'entregado' || e === 'pagado') return 'badge badge-verde';
  if (e === 'cancelado') return 'badge badge-rojo';
  return 'badge badge-azul';
}

function TrendChip({ hoy, ayer }) {
  if (ayer === undefined || hoy === undefined) return null;
  if (ayer === 0 && hoy === 0) return null;
  const sube = hoy >= ayer;
  const pct = ayer > 0 ? Math.abs(Math.round(((hoy - ayer) / ayer) * 100)) : 100;
  return (
    <span className={`kpi-chip ${sube ? 'verde' : 'rojo'}`}>
      {sube ? '↗' : '↘'} {pct}% vs ayer
    </span>
  );
}

function KpiLabel({ Icono, children }) {
  return (
    <Text size="sm" c="dimmed" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Icono size={15} strokeWidth={1.75} />{children}
    </Text>
  );
}

export default function Inicio() {
  const { qr } = useWhatsAppQR(true, 15000);

  const { data: pedidos, error } = useQuery({
    queryKey: ['pedidos'],
    queryFn: () => api.get('/api/pedidos'),
  });
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/api/stats'),
  });
  const { data: met } = useQuery({
    queryKey: ['metricas'],
    queryFn: () => api.get('/api/metricas'),
  });

  const pendientes = pedidos?.filter(p => p.estatus !== 'entregado' && p.estatus !== 'cancelado').length || 0;
  const emailsError = stats?.emails_error || 0;
  const ventasHoy = stats?.ventas_hoy || 0;
  const pagadosHoy = stats?.pedidos_pagados_hoy || 0;
  const colaAtencion = stats?.cola_atencion || 0;
  const pagosPendientes = stats?.pagos_pendientes || 0;
  const clientes = stats?.clientes_total || 0;

  const fmtMoneda = (n) => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const _fecha = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hoyLargo = _fecha.charAt(0).toUpperCase() + _fecha.slice(1);

  // Rellena con 0 los días sin pedidos: la semana siempre son 7 barras
  const porDia = met?.por_dia || [];
  const dias = [...Array(7)].map((_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const row = porDia.find(r => r.dia === iso);
    return { dia: iso, label: d.toLocaleDateString('es-MX', { weekday: 'short' }), n: row?.n || 0, t: row?.t || 0 };
  });
  const totalSemana = dias.reduce((s, d) => s + d.n, 0);
  const montoSemana = dias.reduce((s, d) => s + d.t, 0);

  const ultimos = (pedidos || []).slice(0, 8);

  return (
    <div className="max-w-6xl">
      <div className="page-head">
        <div>
          <div className="page-title">Inicio</div>
          <div className="page-sub">Resumen general de la operación</div>
        </div>
        <span className="date-chip"><CalendarDays size={14} strokeWidth={1.75} />{hoyLargo}</span>
      </div>
      {error && <div className="login-error mb-5">No se pudieron cargar los pedidos: {error.message}</div>}
      <WhatsAppQR qr={qr} />

      <div className="kpi-grid">
        <Card withBorder radius="md" p="lg" className="kpi-card kpi-dark">
          <KpiLabel Icono={Wallet}>Ventas cobradas hoy</KpiLabel>
          <Text size="26px" fw={700} className="kpi-num">{fmtMoneda(ventasHoy)}</Text>
          <span className="kpi-chip">↗ {pagadosHoy} pago{pagadosHoy === 1 ? '' : 's'} confirmado{pagadosHoy === 1 ? '' : 's'}</span>
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <KpiLabel Icono={ReceiptText}>Pedidos de hoy</KpiLabel>
          <Text size="26px" fw={700} className="kpi-num">{met?.pedidos?.hoy?.n ?? stats?.pedidos_hoy ?? 0}</Text>
          <TrendChip hoy={met?.pedidos?.hoy?.n} ayer={met?.pedidos?.ayer?.n} />
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <KpiLabel Icono={Users}>Clientes activos</KpiLabel>
          <Text size="26px" fw={700} className="kpi-num">{clientes}</Text>
        </Card>
        <Card withBorder radius="md" p="lg" className="kpi-card">
          <KpiLabel Icono={CreditCard}>Pagos por cobrar</KpiLabel>
          <Text size="26px" fw={700} className="kpi-num">{pagosPendientes}</Text>
        </Card>
        {colaAtencion > 0 && (
          <Card withBorder radius="md" p="lg" className="kpi-card" style={{ borderColor: 'var(--red)' }}>
            <KpiLabel Icono={Headset}>Clientes esperando atención</KpiLabel>
            <Text size="26px" fw={700} className="kpi-num">{colaAtencion}</Text>
            <Link to="/cola" className="kpi-chip rojo">Atender ahora →</Link>
          </Card>
        )}
        {emailsError > 0 && (
          <Card withBorder radius="md" p="lg" className="kpi-card" style={{ borderColor: 'var(--red)' }}>
            <KpiLabel Icono={TriangleAlert}>Emails con error</KpiLabel>
            <Text size="26px" fw={700} className="kpi-num">{emailsError}</Text>
          </Card>
        )}
      </div>

      <Card withBorder radius="md" p="lg" mt="xl" className="card">
        <div className="card-header">
          <h3><TrendingUp size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 7 }} />Pedidos últimos 7 días</h3>
          <div className="chart-resumen">
            <span><strong>{totalSemana}</strong> pedidos</span>
            <span><strong>{fmtMoneda(montoSemana)}</strong> en la semana</span>
          </div>
        </div>
        <Suspense fallback={<div className="empty">Cargando gráfica...</div>}>
          <GraficaSemana dias={dias} fmtMoneda={fmtMoneda} />
        </Suspense>
      </Card>

      <Card withBorder radius="md" p="lg" mt="xl" className="card">
        <div className="card-header">
          <h3><Package size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 7 }} />Últimos pedidos</h3>
          <div className="actions">
            <span className="text-muted text-xs">{pendientes} pendiente{pendientes === 1 ? '' : 's'}</span>
            <Link to="/pedidos" className="btn btn-sm">Ver todos</Link>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folio</th><th>Cliente</th><th>Estatus</th><th>Fecha</th></tr></thead>
            <tbody>
              {pedidos === undefined && <tr><td colSpan={4} className="empty">Cargando...</td></tr>}
              {ultimos.length === 0 && pedidos !== undefined && <tr><td colSpan={4} className="empty">Sin pedidos todavía</td></tr>}
              {ultimos.map(p => (
                <tr key={p.id_pedido}>
                  <td><strong>{p.folio}</strong></td>
                  <td>{p.cliente || '-'}</td>
                  <td><span className={pillEstatus(p.estatus)}>{p.estatus}</span></td>
                  <td className="text-muted text-xs">{fdate(p.creado_en)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
