import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '@mantine/core';
import { Wallet, MessageCircle, Headset, ReceiptText, TrendingUp, Package, BadgeDollarSign } from 'lucide-react';
import { api } from '../../api';
import { fmtMoneda, pillEstatus, Kpi, diasSemana } from './comunes';
import { fdate } from '../../lib/format';

const GraficaSemana = lazy(() => import('../../components/GraficaSemana'));

// Operador: su día de venta y atención — SUS ventas cobradas, chats nuevos,
// clientes esperando, pedidos; gráfica de la semana y últimos pedidos.
export default function VistaOperador() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => api.get('/api/stats') });
  const { data: corte } = useQuery({ queryKey: ['mi-corte'], queryFn: () => api.get('/api/pos/corte').catch(() => null) });
  const { data: comi } = useQuery({ queryKey: ['mi-comision'], queryFn: () => api.get('/api/comisiones/mio').catch(() => null) });
  const { data: met } = useQuery({ queryKey: ['metricas'], queryFn: () => api.get('/api/metricas').catch(() => null) });
  const { data: pedidos = [] } = useQuery({ queryKey: ['pedidos'], queryFn: () => api.get('/api/pedidos') });

  const dias = diasSemana(met?.por_dia);
  const ultimos = pedidos.slice(0, 6);

  return (
    <div className="pagina-llena" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="kpi-grid">
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq kpi-dark">
          <Kpi Icono={Wallet} color="rgba(255,255,255,0.95)" label="Mis ventas cobradas hoy">{fmtMoneda(corte?.total_sistema)}</Kpi>
        </Card>
        {comi && comi.comision_pct > 0 && (
          <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
            <Kpi Icono={BadgeDollarSign} color="var(--green)" label={`Mi comisión (mes · ${comi.ventas} ventas)`}>{fmtMoneda(comi.comision)}</Kpi>
          </Card>
        )}
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={MessageCircle} color="var(--accent)" label="Chats nuevos hoy">{stats?.chats_hoy ?? 0}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" component={Link} to="/cola" className="kpi-card kpi-sq kpi-clic"
          style={(stats?.cola_atencion || 0) > 0 ? { borderColor: 'var(--red)' } : undefined}>
          <Kpi Icono={Headset} color={(stats?.cola_atencion || 0) > 0 ? 'var(--red)' : 'var(--text-mute)'} label="Esperando atención">{stats?.cola_atencion ?? 0}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={ReceiptText} color="var(--info)" label="Pedidos de hoy">{met?.pedidos?.hoy?.n ?? stats?.pedidos_hoy ?? 0}</Kpi>
        </Card>
      </div>

      <div className="fila-2col">
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3><TrendingUp size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 7 }} />Pedidos últimos 7 días</h3></div>
          <div className="chart-wrap">
            <Suspense fallback={<div className="empty">Cargando...</div>}>
              <GraficaSemana dias={dias} fmtMoneda={fmtMoneda} altura="100%" />
            </Suspense>
          </div>
        </Card>
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3><Package size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 7 }} />Últimos pedidos</h3><Link to="/pedidos" className="btn btn-sm">Ver todos</Link></div>
          <div className="table-wrap tabla-compacta">
            <table>
              <thead><tr><th>Folio</th><th>Estatus</th><th>Fecha</th></tr></thead>
              <tbody>
                {ultimos.length === 0 && <tr><td colSpan={3} className="empty">Sin pedidos</td></tr>}
                {ultimos.map(p => (
                  <tr key={p.id_pedido}>
                    <td><strong>{p.folio}</strong></td>
                    <td><span className={pillEstatus(p.estatus)}>{p.estatus}</span></td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{fdate(p.creado_en)}</td>
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
