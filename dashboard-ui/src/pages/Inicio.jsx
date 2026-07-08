import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, Text, RingProgress, Center } from '@mantine/core';
import { Wallet, ReceiptText, Users, CreditCard, Headset, TriangleAlert, TrendingUp, Package, CalendarDays, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { useWhatsAppQR } from '../hooks/useWhatsAppQR';
import WhatsAppQR from '../components/WhatsAppQR';
import PuntosGrafica from '../components/PuntosGrafica';
import { fdate } from '../lib/format';

const MODOS_GRAFICA = [
  { value: 'barras', label: 'Barras' },
  { value: 'linea', label: 'Línea' },
  { value: 'pct', label: 'Porcentaje del total' },
];

// Lazy: recharts (~400 KB) llega después del primer render, no lo bloquea
const GraficaSemana = lazy(() => import('../components/GraficaSemana'));

function pillEstatus(estatus) {
  const e = (estatus || '').toLowerCase();
  if (e === 'entregado' || e === 'pagado') return 'badge badge-verde';
  if (e === 'cancelado') return 'badge badge-rojo';
  return 'badge badge-azul';
}

// KPI cuadrado: anillo arriba, número, label — 6 exactos por fila
function Kpi({ Icono, color, label, children }) {
  return (
    <div className="kpi-sq-inner">
      <RingProgress
        size={44} thickness={4} rootColor="var(--panel-2)"
        sections={[{ value: 72, color }]}
        label={<Center><Icono size={15} strokeWidth={1.75} style={{ color }} /></Center>}
      />
      <Text size="21px" fw={700} className="kpi-num">{children}</Text>
      <Text size="xs" c="dimmed" ta="center">{label}</Text>
    </div>
  );
}

export default function Inicio() {
  const { user } = useAuth();
  const { qr } = useWhatsAppQR(true, 15000);
  const [modoGrafica, setModoGrafica] = useState(() => localStorage.getItem('jc-grafica-inicio') || 'barras');
  const cambiarModo = (m) => { setModoGrafica(m); localStorage.setItem('jc-grafica-inicio', m); };

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

  const ultimos = (pedidos || []).slice(0, 6);

  // Marketing (por qué importan: abandonados = venta recuperable a un
  // mensaje de distancia; motivo = qué palanca mover; conversión = salud
  // del embudo; recuperados = ROI de las campañas automáticas del bot)
  const mkt = stats?.marketing;
  const conv = mkt?.busquedas_30d > 0 ? Math.round((mkt.pagos_30d / mkt.busquedas_30d) * 100) : null;
  const MOTIVO_TXT = { precio: '→ mueve cupones/ofertas', envio: '→ baja el umbral de envío gratis', otro: '→ pregunta al cliente' };

  return (
    <div className="max-w-6xl">
      <div className="page-head">
        <div>
          <div className="page-title">¡Hola, {(user?.username || '').charAt(0).toUpperCase() + (user?.username || '').slice(1)}!</div>
          <div className="page-sub">Resumen general de la operación</div>
        </div>
        <span className="date-chip"><CalendarDays size={14} strokeWidth={1.75} />{hoyLargo}</span>
      </div>
      {error && <div className="login-error mb-5">No se pudieron cargar los pedidos: {error.message}</div>}
      {emailsError > 0 && (
        <div className="banner-alerta"><TriangleAlert size={14} strokeWidth={1.75} /> {emailsError} email{emailsError === 1 ? '' : 's'} de confirmación con error — revisa la configuración SMTP</div>
      )}
      <WhatsAppQR qr={qr} />

      {/* 6 KPIs cuadrados fijos — siempre una sola fila */}
      <div className="kpi-grid6">
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq kpi-dark">
          <Kpi Icono={Wallet} color="rgba(255,255,255,0.95)" label="Ventas cobradas hoy">{fmtMoneda(ventasHoy)}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={ReceiptText} color="#4aa8ff" label="Pedidos de hoy">{met?.pedidos?.hoy?.n ?? stats?.pedidos_hoy ?? 0}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={MessageCircle} color="var(--accent)" label="Chats nuevos hoy">{stats?.chats_hoy ?? 0}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={Users} color="var(--green)" label="Clientes activos">{clientes}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={CreditCard} color="#b16cea" label="Pagos por cobrar">{pagosPendientes}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" component={Link} to="/cola"
          className="kpi-sq kpi-card kpi-clic" style={colaAtencion > 0 ? { borderColor: 'var(--red)' } : undefined}>
          <Kpi Icono={Headset} color={colaAtencion > 0 ? 'var(--red)' : 'var(--text-mute)'} label="Esperando atención">{colaAtencion}</Kpi>
        </Card>
      </div>

      {/* Marketing: dónde está el dinero por recuperar */}
      {mkt && (
        <div className="mkt-grid">
          <Card withBorder radius="md" className="card mkt-card">
            <span className="mkt-num">{mkt.abandonados_n}{mkt.abandonados_monto > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' }}> · {fmtMoneda(mkt.abandonados_monto)}</span>}</span>
            <span className="mkt-label">Carritos abandonados</span>
            <span className="mkt-hint">venta recuperable a un mensaje</span>
          </Card>
          <Card withBorder radius="md" className="card mkt-card">
            <span className="mkt-num" style={{ textTransform: 'capitalize' }}>{mkt.motivo_top?.motivo || '—'}</span>
            <span className="mkt-label">Motivo de abandono #1</span>
            <span className="mkt-hint">{MOTIVO_TXT[mkt.motivo_top?.motivo] || 'sin datos aún'}</span>
          </Card>
          <Card withBorder radius="md" className="card mkt-card">
            <span className="mkt-num">{conv !== null ? conv + '%' : '—'}</span>
            <span className="mkt-label">Conversión búsqueda → pago</span>
            <span className="mkt-hint">salud del embudo del bot</span>
          </Card>
          <Card withBorder radius="md" className="card mkt-card">
            <span className="mkt-num">{mkt.recuperados_30d}</span>
            <span className="mkt-label">Carritos recuperados (30d)</span>
            <span className="mkt-hint">ROI de las campañas automáticas</span>
          </Card>
        </div>
      )}

      {/* Gráfica + últimos pedidos lado a lado: todo en una pantalla */}
      <div className="fila-2col">
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header">
            <h3><TrendingUp size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 7 }} />Pedidos últimos 7 días</h3>
            <div className="chart-resumen">
              <span><strong>{totalSemana}</strong> pedidos</span>
              <span><strong>{fmtMoneda(montoSemana)}</strong> en la semana</span>
              <PuntosGrafica opciones={MODOS_GRAFICA} valor={modoGrafica} onChange={cambiarModo} />
            </div>
          </div>
          <div className="chart-wrap">
            <Suspense fallback={<div className="empty">Cargando gráfica...</div>}>
              <GraficaSemana dias={dias} fmtMoneda={fmtMoneda} altura="100%" modo={modoGrafica} />
            </Suspense>
          </div>
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header">
            <h3><Package size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 7 }} />Últimos pedidos</h3>
            <div className="actions">
              <span className="text-muted text-xs">{pendientes} pend.</span>
              <Link to="/pedidos" className="btn btn-sm">Ver todos</Link>
            </div>
          </div>
          <div className="table-wrap tabla-compacta">
            <table>
              <thead><tr><th>Folio</th><th>Estatus</th><th>Fecha</th></tr></thead>
              <tbody>
                {pedidos === undefined && <tr><td colSpan={3} className="empty">Cargando...</td></tr>}
                {ultimos.length === 0 && pedidos !== undefined && <tr><td colSpan={3} className="empty">Sin pedidos todavía</td></tr>}
                {ultimos.map(p => (
                  <tr key={p.id_pedido} title={p.cliente || ''}>
                    <td><strong>{p.folio}</strong></td>
                    <td><span className={pillEstatus(p.estatus)}>{p.estatus}</span></td>
                    <td className="text-muted text-xs">{fdate(p.creado_en)}</td>
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
