import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@mantine/core';
import { Wallet, TrendingUp, CreditCard, Landmark, Scale, FileText } from 'lucide-react';
import { api } from '../../api';
import { fmtMoneda, Kpi, diasSemana } from './comunes';

const GraficaSemana = lazy(() => import('../../components/GraficaSemana'));

// Contabilidad: dinero cobrado, por cobrar, por PAGAR (CxP con vencimientos),
// cortes del día y balanza — su trabajo, no marketing ni cola de chats.
export default function VistaFinanzas() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => api.get('/api/stats') });
  const { data: met } = useQuery({ queryKey: ['metricas'], queryFn: () => api.get('/api/metricas').catch(() => null) });
  const { data: cxp = [] } = useQuery({ queryKey: ['erp-cxp'], queryFn: () => api.get('/api/erp/cxp').catch(() => []) });
  const { data: corte } = useQuery({ queryKey: ['corte-global'], queryFn: () => api.get('/api/pos/corte').catch(() => null) });
  const { data: mayor } = useQuery({
    queryKey: ['mayor-mes'],
    queryFn: () => api.get('/api/erp/libro-mayor').catch(() => null),
  });

  const cxpPend = cxp.filter(x => x.estatus === 'pendiente');
  const cxpMonto = cxpPend.reduce((s, x) => s + Number(x.monto || 0), 0);
  const vencidas = cxpPend.filter(x => x.dias_para_vencer < 0).length;
  const cuentas = mayor?.cuentas || [];
  const cuadrada = Math.abs(cuentas.reduce((s, c) => s + c.debe - c.haber, 0)) < 0.01;
  const dias = diasSemana(met?.por_dia);

  return (
    <div className="pagina-llena" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="kpi-grid6">
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq kpi-dark">
          <Kpi Icono={Wallet} color="rgba(255,255,255,0.95)" label="Cobrado hoy (global)">{fmtMoneda(stats?.ventas_hoy)}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={TrendingUp} color="var(--green)" label="Ingresos del mes">{fmtMoneda(met?.ingresos?.mes)}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={CreditCard} color="#b16cea" label="Por cobrar (clientes)">{stats?.pagos_pendientes ?? 0}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq" style={vencidas > 0 ? { borderColor: 'var(--red)' } : undefined}>
          <Kpi Icono={FileText} color={vencidas > 0 ? 'var(--red)' : '#4aa8ff'} label={vencidas > 0 ? `Por pagar · ${vencidas} vencida(s)` : 'Por pagar (proveedores)'}>{fmtMoneda(cxpMonto)}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={Landmark} color="var(--accent)" label="Cortes cerrados hoy">{(corte?.cortes || []).length}</Kpi>
        </Card>
        <Card withBorder radius="md" p="md" className="kpi-card kpi-sq">
          <Kpi Icono={Scale} color={cuadrada ? 'var(--green)' : 'var(--red)'} label="Balanza (30 días)">{cuentas.length ? (cuadrada ? '✓' : '✗') : '—'}</Kpi>
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
          <div className="card-header"><h3><FileText size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 7 }} />CxP próximas a vencer</h3></div>
          <div className="table-wrap tabla-compacta">
            <table>
              <thead><tr><th>Proveedor</th><th>Monto</th><th>Vence</th></tr></thead>
              <tbody>
                {cxpPend.length === 0 && <tr><td colSpan={3} className="empty">Sin cuentas por pagar pendientes</td></tr>}
                {cxpPend.slice(0, 6).map(x => (
                  <tr key={x.id}>
                    <td><strong>{x.proveedor}</strong></td>
                    <td>{fmtMoneda(x.monto)}</td>
                    <td style={x.dias_para_vencer < 0 ? { color: 'var(--red)', fontWeight: 700 } : undefined}>
                      {x.vence_en}{Number.isFinite(x.dias_para_vencer) && ` (${x.dias_para_vencer < 0 ? Math.abs(x.dias_para_vencer) + 'd vencida' : 'en ' + x.dias_para_vencer + 'd'})`}
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
