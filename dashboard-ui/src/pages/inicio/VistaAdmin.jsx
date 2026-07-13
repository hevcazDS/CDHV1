import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '@mantine/core';
import { Wallet, ReceiptText, Users, CreditCard, Headset, TrendingUp, Package, MessageCircle } from 'lucide-react';
import { api } from '../../api';
import PuntosGrafica from '../../components/PuntosGrafica';
import { fdate } from '../../lib/format';
import { fmtMoneda, pillEstatus, Kpi, diasSemana } from './comunes';

const GraficaSemana = lazy(() => import('../../components/GraficaSemana'));
const Sparkline = lazy(() => import('../../components/MiniCharts').then(m => ({ default: m.Sparkline })));
const MODOS_GRAFICA = [
  { value: 'barras', label: 'Barras' },
  { value: 'linea', label: 'Línea' },
];

// Delta "vs ayer" bajo un KPI (patrón Starline — SPEC_CONVERGENCIA). Solo si
// hay dato de ayer; verde si sube, rojo si baja. `claro` para la card oscura.
function DeltaAyer({ hoy, ayer, claro }) {
  if (ayer == null) return null;
  if (!ayer && !hoy) return null;
  const pct = ayer > 0 ? Math.round((hoy - ayer) / ayer * 100) : (hoy > 0 ? 100 : 0);
  const sube = pct >= 0;
  const col = claro ? 'rgba(255,255,255,0.85)' : (sube ? 'var(--green)' : 'var(--red)');
  return <div style={{ fontSize: 11, fontWeight: 600, color: col, marginTop: 2 }}>{sube ? '▲' : '▼'} {Math.abs(pct)}% vs ayer</div>;
}

// Administrador/Prime: vista completa — 6 KPIs con swap #/%, marketing,
// gráfica de la semana y últimos pedidos.
export default function VistaAdmin() {
  const [modoGrafica, setModoGrafica] = useState(() => (localStorage.getItem('jc-grafica-inicio') === 'linea' ? 'linea' : 'barras'));
  const cambiarModo = (m) => { setModoGrafica(m); localStorage.setItem('jc-grafica-inicio', m); };
  const [kpiPct, setKpiPct] = useState(false);

  const { data: pedidos, error } = useQuery({ queryKey: ['pedidos'], queryFn: () => api.get('/api/pedidos') });
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => api.get('/api/stats') });
  const { data: met } = useQuery({ queryKey: ['metricas'], queryFn: () => api.get('/api/metricas') });
  // Fila "requiere tu acción" (Ola 3, patrón NetSuite Role Center §B): lo
  // pendiente ANTES que los KPIs. Solo se pintan los chips con dato > 0.
  const { data: cxp = [] } = useQuery({ queryKey: ['erp-cxp'], queryFn: () => api.get('/api/erp/cxp').catch(() => []) });
  const { data: solicitudes = [] } = useQuery({ queryKey: ['compras-sol'], queryFn: () => api.get('/api/compras/solicitudes').catch(() => []) });
  const cxpVencidas = cxp.filter(c => c.estatus !== 'pagada' && c.dias_para_vencer != null && c.dias_para_vencer < 0).length;
  const solPendientes = solicitudes.filter(s => s.estatus === 'pendiente').length;

  const pendientes = pedidos?.filter(p => p.estatus !== 'entregado' && p.estatus !== 'cancelado').length || 0;
  const ventasHoy = stats?.ventas_hoy || 0;
  const pagadosHoy = stats?.pedidos_pagados_hoy || 0;
  const colaAtencion = stats?.cola_atencion || 0;
  const pagosPendientes = stats?.pagos_pendientes || 0;
  const clientes = stats?.clientes_total || 0;

  const dias = diasSemana(met?.por_dia);
  const totalSemana = dias.reduce((s, d) => s + d.n, 0);
  const montoSemana = dias.reduce((s, d) => s + d.t, 0);
  const ultimos = (pedidos || []).slice(0, 6);

  const mkt = stats?.marketing;
  const conv = mkt?.busquedas_30d > 0 ? Math.round(((mkt.pagos_30d ?? 0) / mkt.busquedas_30d) * 100) : null;
  const MOTIVO_TXT = { precio: '→ mueve cupones/ofertas', envio: '→ baja el umbral de envío gratis', otro: '→ pregunta al cliente' };

  const pctDe = (hoyV, total30) => (total30 > 0 ? Math.round((hoyV / (total30 / 30)) * 100) + '%' : '—');
  const participacion = (parte, todo) => (todo > 0 ? Math.round((parte / todo) * 100) + '%' : '—');
  const kpis = kpiPct ? {
    ventas: pctDe(ventasHoy, met?.ingresos?.mes || 0), ventasLabel: 'Ventas · % del prom. diario',
    pedidos: pctDe(met?.pedidos?.hoy?.n ?? 0, met?.pedidos?.mes?.n || 0), pedidosLabel: 'Pedidos · % del prom. diario',
    chats: pctDe(stats?.chats_hoy ?? 0, stats?.chats_30d || 0), chatsLabel: 'Chats · % del prom. diario',
    clientes: participacion(stats?.clientes_nuevos_30d ?? 0, clientes), clientesLabel: 'Clientes nuevos en 30d',
    pagos: participacion(pagosPendientes, pagosPendientes + (stats?.pagos_pagados || 0)), pagosLabel: 'Pagos aún por cobrar',
    espera: participacion(colaAtencion, stats?.chats_hoy || 0), esperaLabel: 'De los chats de hoy esperan',
  } : {
    ventas: fmtMoneda(ventasHoy), ventasLabel: 'Ventas cobradas hoy',
    pedidos: met?.pedidos?.hoy?.n ?? stats?.pedidos_hoy ?? 0, pedidosLabel: 'Pedidos de hoy',
    chats: stats?.chats_hoy ?? 0, chatsLabel: 'Chats nuevos hoy',
    clientes, clientesLabel: 'Clientes activos',
    pagos: pagosPendientes, pagosLabel: 'Pagos por cobrar',
    espera: colaAtencion, esperaLabel: 'Esperando atención',
  };

  // La franja "Requiere tu acción" se retiró: era redundante con la campana de
  // notificaciones (arriba a la derecha), que ya agrega estos pendientes.

  return (
    <div className="pagina-llena" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {error && <div className="login-error mb-5">No se pudieron cargar los pedidos: {error.message}</div>}

      <div className="kpi-head">
        <button className={`swap-kpi${kpiPct ? '' : ' activo'}`} onClick={() => setKpiPct(false)} title="Números absolutos">123</button>
        <button className={`swap-kpi${kpiPct ? ' activo' : ''}`} onClick={() => setKpiPct(true)} title="Porcentajes (vs promedio diario 30d)">%</button>
      </div>
      <div className="kpi-grid6">
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq kpi-dark">
          <Kpi Icono={Wallet} color="rgba(255,255,255,0.95)" label={kpis.ventasLabel}>{kpis.ventas}</Kpi>
          {!kpiPct && <DeltaAyer hoy={ventasHoy} ayer={stats?.ventas_ayer} claro />}
          {!kpiPct && <Suspense fallback={null}><Sparkline datos={dias.map(d => ({ v: d.t }))} color="rgba(255,255,255,0.6)" /></Suspense>}
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={ReceiptText} color="var(--info)" label={kpis.pedidosLabel}>{kpis.pedidos}</Kpi>
          {!kpiPct && <DeltaAyer hoy={met?.pedidos?.hoy?.n ?? stats?.pedidos_hoy ?? 0} ayer={stats?.pedidos_ayer} />}
          {!kpiPct && <Suspense fallback={null}><Sparkline datos={dias.map(d => ({ v: d.n }))} color="var(--info)" /></Suspense>}
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={MessageCircle} color="var(--accent)" label={kpis.chatsLabel}>{kpis.chats}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={Users} color="var(--green)" label={kpis.clientesLabel}>{kpis.clientes}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={CreditCard} color="var(--accent-2)" label={kpis.pagosLabel}>{kpis.pagos}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" component={Link} to="/cola"
          className="kpi-sq kpi-card kpi-clic" style={colaAtencion > 0 ? { borderColor: 'var(--red)' } : undefined}>
          <Kpi Icono={Headset} color={colaAtencion > 0 ? 'var(--red)' : 'var(--text-mute)'} label={kpis.esperaLabel}>{kpis.espera}</Kpi>
        </Card>
      </div>

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
