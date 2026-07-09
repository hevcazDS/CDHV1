import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, TextInput, Group, Button, Text } from '@mantine/core';
import { api } from '../../api';
import { exportarCSV } from '../../lib/csv';

// Facturación pendiente: pedidos con datos fiscales, exportables para que un
// PAC/despacho externo los timbre. NO es CFDI timbrado — el enganche del PAC
// se integra aquí cuando se contrate.
export default function FacturacionTab() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [r, setR] = useState({ desde: hace30, hasta: hoy });
  const { data } = useQuery({
    queryKey: ['fact-pend', r],
    queryFn: () => api.get(`/api/erp/facturacion-pendiente?desde=${r.desde}&hasta=${r.hasta}`),
  });
  const filas = data?.filas || [];

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <div className="card-header">
        <h3>Facturación pendiente</h3>
        <Group gap="xs" align="end">
          <TextInput type="date" size="xs" value={r.desde} onChange={e => setR({ ...r, desde: e.target.value })} />
          <TextInput type="date" size="xs" value={r.hasta} onChange={e => setR({ ...r, hasta: e.target.value })} />
          <Button variant="default" size="xs" disabled={!filas.length}
            onClick={() => exportarCSV(`facturacion_${r.desde}_${r.hasta}`,
              ['folio', 'rfc', 'razon_social', 'monto', 'fecha'],
              filas.map(f => [f.folio, f.rfc, f.razon_social || '', Number(f.monto || 0).toFixed(2), f.creado_en]))}>
            Exportar para el PAC (CSV)
          </Button>
        </Group>
      </div>
      <Text size="xs" c="dimmed" mb="sm">
        Estos pedidos tienen datos fiscales capturados. Exporta el CSV y pásalo a tu despacho/PAC para el timbrado.
        Cuando se integre un PAC al sistema, el timbrado será directo desde aquí.
      </Text>
      <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Folio</th><th>RFC</th><th>Razón social</th><th>Monto</th><th>Fecha</th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={5} className="empty">Sin pedidos con datos fiscales en el rango</td></tr>}
            {filas.map((f, i) => (
              <tr key={i}>
                <td><strong>{f.folio}</strong></td>
                <td>{f.rfc}</td>
                <td>{f.razon_social || '-'}</td>
                <td>${Number(f.monto || 0).toFixed(2)}</td>
                <td className="text-muted" style={{ fontSize: 11 }}>{(f.creado_en || '').slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
