import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, TextInput, Group, Button, Text } from '@mantine/core';
import { api } from '../../api';
import { exportarCSV } from '../../lib/csv';

// Qué se vendió, cuánto y en cuánto — funciona aunque el negocio NO lleve
// inventario (la venta se graba igual). Reporte para formalizar poco a poco.
export default function VentasProductoTab() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [r, setR] = useState({ desde: hace30, hasta: hoy });
  const { data } = useQuery({
    queryKey: ['ventas-prod', r],
    queryFn: () => api.get(`/api/erp/productos-vendidos?desde=${r.desde}&hasta=${r.hasta}`),
  });
  const filas = data?.filas || [];

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <div className="card-header">
        <h3>Ventas por producto</h3>
        <Group gap="xs" align="end">
          <TextInput type="date" size="xs" value={r.desde} onChange={e => setR({ ...r, desde: e.target.value })} />
          <TextInput type="date" size="xs" value={r.hasta} onChange={e => setR({ ...r, hasta: e.target.value })} />
          <Button variant="default" size="xs" disabled={!filas.length}
            onClick={() => exportarCSV(`ventas_producto_${r.desde}_${r.hasta}`,
              ['producto', 'sku', 'unidades', 'total'],
              filas.map(f => [f.producto, f.sku || '', f.unidades, Number(f.total || 0).toFixed(2)]))}>
            Exportar (CSV)
          </Button>
        </Group>
      </div>
      {data && <Text size="sm" fw={700} mb="sm">Total vendido: ${Number(data.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</Text>}
      <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Producto</th><th>SKU</th><th>Unidades</th><th>Total</th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={4} className="empty">Sin ventas pagadas en el rango</td></tr>}
            {filas.map((f, i) => (
              <tr key={i}>
                <td><strong>{f.producto}</strong></td>
                <td className="text-muted" style={{ fontSize: 11 }}>{f.sku || '-'}</td>
                <td>{f.unidades}</td>
                <td>${Number(f.total || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
