import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, TextInput, Group } from '@mantine/core';
import { api } from '../../api';
import { money } from '../../lib/format';
import { exportarCSV } from '../../lib/csv';

// Rentabilidad por cliente: ventas pagadas, costo, margen y adeudo de fiado.
// Ordena por margen (el 20% que da el 80%); marca a los de deuda alta.

export default function RentabilidadClientesTab() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [r, setR] = useState({ desde: hace90, hasta: hoy });
  const { data } = useQuery({ queryKey: ['erp-rent-clientes', r], queryFn: () => api.get(`/api/erp/rentabilidad-clientes?desde=${r.desde}&hasta=${r.hasta}`) });
  const clientes = data?.clientes || [];

  return (
    <div>
      <Group mb="md" gap="sm">
        <TextInput type="date" label="Desde" value={r.desde} onChange={e => setR({ ...r, desde: e.target.value })} />
        <TextInput type="date" label="Hasta" value={r.hasta} onChange={e => setR({ ...r, hasta: e.target.value })} />
      </Group>
      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Rentabilidad por cliente</h3>
          <button className="btn btn-sm" onClick={() => exportarCSV(`rentabilidad_clientes_${r.desde}_${r.hasta}`,
            ['cliente', 'pedidos', 'ventas', 'costo', 'margen', 'margen_pct', 'adeudo_fiado'],
            clientes.map(c => [c.nombre, c.pedidos, c.ventas, c.costo, c.margen, c.margen_pct, c.adeudo_fiado]))}>CSV</button>
        </div>
        <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
          <table>
            <thead><tr><th>Cliente</th><th>Pedidos</th><th>Ventas</th><th>Margen</th><th>%</th><th>Debe (fiado)</th></tr></thead>
            <tbody>
              {clientes.length === 0 && <tr><td colSpan={6} className="empty">Sin ventas pagadas en el período (o falta cargar costos)</td></tr>}
              {clientes.map((c, i) => (
                <tr key={i}>
                  <td><strong>{c.nombre || '—'}</strong>{c.telefono && <div className="text-muted" style={{ fontSize: 11 }}>{c.telefono}</div>}</td>
                  <td>{c.pedidos}</td>
                  <td>{money(c.ventas)}</td>
                  <td style={{ fontWeight: 600, color: c.margen < 0 ? 'var(--red)' : undefined }}>{money(c.margen)}</td>
                  <td style={{ fontWeight: 700, color: c.margen_pct >= 30 ? 'var(--green)' : c.margen_pct < 10 ? 'var(--red)' : undefined }}>{c.margen_pct}%</td>
                  <td style={{ color: c.adeudo_fiado > 0 ? 'var(--red)' : 'var(--text-mute)' }}>{c.adeudo_fiado > 0 ? money(c.adeudo_fiado) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
