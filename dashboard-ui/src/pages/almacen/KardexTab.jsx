import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Select, Button, Group } from '@mantine/core';
import { exportarCSV } from '../../lib/csv';
import { api } from '../../api';
import { fdate } from '../../lib/format';

// KARDEX universal — solo Administrador/Prime y Auditor (material de auditoría)
export default function KardexTab() {
  const [kardexDe, setKardexDe] = useState(null);
  const { data: prods = [] } = useQuery({ queryKey: ['almacen-prods'], queryFn: () => api.get('/api/almacen/inventario?q=') });
  const productos = [...new Map(prods.map(x => [x.id, x])).values()];
  const { data: kardex = [] } = useQuery({
    queryKey: ['kardex', kardexDe],
    queryFn: () => api.get('/api/almacen/kardex?producto=' + kardexDe),
    enabled: !!kardexDe,
  });

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <div className="card-header">
        <h3>Kardex de movimientos</h3>
        <Group gap="xs">
          <Select placeholder="Elige producto..." searchable w={300} value={kardexDe} onChange={setKardexDe}
            data={productos.map(x => ({ value: String(x.id), label: x.name }))} />
          <Button variant="default" size="xs" disabled={!kardex.length} onClick={() => exportarCSV('kardex_' + kardexDe,
            ['fecha', 'sucursal', 'tipo', 'delta', 'saldo', 'motivo', 'usuario'],
            kardex.map(m => [m.creado_en, m.sucursal, m.tipo, m.delta, m.cantidad_nueva, m.motivo || '', m.creado_por || '']))}>CSV</Button>
        </Group>
      </div>
      <div className="table-wrap" style={{ maxHeight: 480, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Fecha</th><th>Sucursal</th><th>Tipo</th><th>Δ</th><th>Saldo</th><th>Motivo / quién</th></tr></thead>
          <tbody>
            {!kardexDe && <tr><td colSpan={6} className="empty">Elige un producto para auditar su historial completo</td></tr>}
            {kardexDe && kardex.length === 0 && <tr><td colSpan={6} className="empty">Sin movimientos registrados</td></tr>}
            {(Array.isArray(kardex) ? kardex : []).map(m => (
              <tr key={m.id}>
                <td className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fdate(m.creado_en)}</td>
                <td style={{ fontSize: 12 }}>{m.sucursal}</td>
                <td><span className="chip">{m.tipo}</span></td>
                <td style={{ color: m.delta < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                <td style={{ fontWeight: 700 }}>{m.cantidad_nueva}</td>
                <td className="text-muted" style={{ fontSize: 11 }}>{m.motivo || '-'}{m.creado_por ? ' · ' + m.creado_por : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
