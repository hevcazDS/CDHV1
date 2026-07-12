import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, TextInput, Group, Text } from '@mantine/core';
import { api } from '../../api';
import { money } from '../../lib/format';
import { exportarCSV } from '../../lib/csv';

// Rentabilidad por vendedor (cobrado_por): ventas, margen, comisión y el fiado
// que dejó sin cobrar. Comisionar solo por venta cobrada es ciego al margen.

export default function RentabilidadVendedoresTab() {
  const hoy = new Date().toISOString().slice(0, 10);
  const mes = hoy.slice(0, 8) + '01';
  const [r, setR] = useState({ desde: mes, hasta: hoy });
  const { data } = useQuery({ queryKey: ['erp-rent-vend', r], queryFn: () => api.get(`/api/erp/rentabilidad-vendedores?desde=${r.desde}&hasta=${r.hasta}`) });
  const vend = data?.vendedores || [];

  return (
    <div>
      <Group mb="md" gap="sm">
        <TextInput type="date" label="Desde" value={r.desde} onChange={e => setR({ ...r, desde: e.target.value })} />
        <TextInput type="date" label="Hasta" value={r.hasta} onChange={e => setR({ ...r, hasta: e.target.value })} />
      </Group>
      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Rentabilidad por vendedor</h3>
          <Group gap="xs"><Text size="xs" c="dimmed">comisión {data?.comision_pct || 0}%</Text>
            <button className="btn btn-sm" onClick={() => exportarCSV(`rentabilidad_vendedores_${r.desde}_${r.hasta}`,
              ['vendedor', 'pedidos', 'ventas', 'margen', 'margen_pct', 'comision', 'fiado_pendiente'],
              vend.map(v => [v.vendedor, v.pedidos, v.ventas, v.margen, v.margen_pct, v.comision, v.fiado_pendiente]))}>CSV</button>
          </Group>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Vendedor</th><th>Pedidos</th><th>Ventas</th><th>Margen</th><th>%</th><th>Comisión</th><th>Fiado sin cobrar</th></tr></thead>
            <tbody>
              {vend.length === 0 && <tr><td colSpan={7} className="empty">Sin ventas cobradas con vendedor en el período</td></tr>}
              {vend.map((v, i) => (
                <tr key={i}>
                  <td><strong>{v.vendedor}</strong></td>
                  <td>{v.pedidos}</td>
                  <td>{money(v.ventas)}</td>
                  <td style={{ fontWeight: 600, color: v.margen < 0 ? 'var(--red)' : undefined }}>{money(v.margen)}</td>
                  <td style={{ fontWeight: 700, color: v.margen_pct >= 30 ? 'var(--green)' : v.margen_pct < 10 ? 'var(--red)' : undefined }}>{v.margen_pct}%</td>
                  <td>{money(v.comision)}</td>
                  <td style={{ color: v.fiado_pendiente > 0 ? 'var(--red)' : 'var(--text-mute)' }}>{v.fiado_pendiente > 0 ? money(v.fiado_pendiente) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
