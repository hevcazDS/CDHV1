import { useQuery } from '@tanstack/react-query';
import { Card, Title, Text } from '@mantine/core';
import { api } from '../../api';
import { fmt } from '../../lib/format';

// Tres reportes que el gerente tomaba a ciegas (comité de usuarios), todos
// lectura pura desde GET /api/gerente/reportes: stock bajo mínimo, margen por
// producto vs volumen, y productos muertos (stock sin venta en 90 días).
export default function ReportesTab() {
  const { data } = useQuery({
    queryKey: ['gerente-reportes'],
    queryFn: () => api.get('/api/gerente/reportes').catch(() => null),
  });
  const stockBajo = data?.stock_bajo || [];
  const margen = data?.margen || [];
  const muertos = data?.muertos || [];
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Card withBorder radius="md" p="lg">
        <Title order={5} mb="xs">🔴 Stock bajo mínimo</Title>
        <Text size="xs" c="dimmed" mb="sm">Productos en o por debajo del mínimo configurado — reordena antes de quedarte sin venta.</Text>
        {stockBajo.length === 0 ? <Text size="sm" c="dimmed">Nada bajo mínimo. 👍</Text> : (
          <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Producto</th><th>Sucursal</th><th>Stock</th><th>Mínimo</th><th>Faltante</th></tr></thead>
              <tbody>
                {stockBajo.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}</td><td>{s.sucursal}</td>
                    <td style={{ fontWeight: 700, color: s.stock === 0 ? 'var(--red)' : 'var(--yellow)' }}>{s.stock}</td>
                    <td>{s.stock_minimo}</td><td><strong>{Math.max(0, s.stock_minimo - s.stock)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={5} mb="xs">💰 Margen por producto (últimos 30 días)</Title>
        <Text size="xs" c="dimmed" mb="sm">Precio vs costo y unidades vendidas. Margen bajo + mucho volumen = revisa precio o proveedor.</Text>
        {margen.length === 0 ? <Text size="sm" c="dimmed">Captura el costo de tus productos (alta / entrada de mercancía) para ver el margen.</Text> : (
          <div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Producto</th><th>Precio</th><th>Costo</th><th>Margen</th><th>Margen %</th><th>Vendidos 30d</th></tr></thead>
              <tbody>
                {margen.map((m, i) => (
                  <tr key={i}>
                    <td>{m.name}</td><td>{money(m.price)}</td><td>{money(m.costo)}</td>
                    <td>{money(m.margen)}</td>
                    <td style={{ fontWeight: 700, color: m.margen_pct != null && m.margen_pct < 15 ? 'var(--red)' : m.margen_pct != null && m.margen_pct < 30 ? 'var(--yellow)' : 'var(--green)' }}>{m.margen_pct != null ? m.margen_pct + '%' : '—'}</td>
                    <td><strong>{m.vendidos_30d}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={5} mb="xs">🪦 Productos muertos (con stock, sin venta en 90 días)</Title>
        <Text size="xs" c="dimmed" mb="sm">Dinero parado en anaquel. Candidatos a promoción, liquidación o baja de catálogo.</Text>
        {muertos.length === 0 ? <Text size="sm" c="dimmed">Todo tu inventario con stock ha rotado en los últimos 90 días. 👍</Text> : (
          <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Producto</th><th>Stock</th><th>Precio</th><th>Valor parado</th></tr></thead>
              <tbody>
                {muertos.map((m, i) => (
                  <tr key={i}>
                    <td>{m.name}</td><td><strong>{m.stock}</strong></td><td>{money(m.price)}</td>
                    <td style={{ color: 'var(--text-mute)' }}>{money((m.stock || 0) * (m.price || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
