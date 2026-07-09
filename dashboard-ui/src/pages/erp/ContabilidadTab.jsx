import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Text, TextInput, Group } from '@mantine/core';
import { api } from '../../api';
import { Button } from '@mantine/core';
import { exportarCSV } from '../../lib/csv';

// Libro mayor + diario de asientos. Los asientos automáticos requieren el
// módulo "Contabilidad" encendido (Módulos); aquí solo se consulta.
export default function ContabilidadTab() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [desde, setDesde] = useState(hace30);
  const [hasta, setHasta] = useState(hoy);

  const { data: mayor } = useQuery({
    queryKey: ['erp-mayor', desde, hasta],
    queryFn: () => api.get(`/api/erp/libro-mayor?desde=${desde}&hasta=${hasta}`),
  });
  const { data: asientos = [] } = useQuery({
    queryKey: ['erp-asientos', desde, hasta],
    queryFn: () => api.get(`/api/erp/asientos?desde=${desde}&hasta=${hasta}`),
  });

  const cuentas = mayor?.cuentas || [];
  const totalDebe = cuentas.reduce((s, c) => s + c.debe, 0);
  const totalHaber = cuentas.reduce((s, c) => s + c.haber, 0);

  return (
    <div>
      <Group mb="md" gap="sm" align="end">
        <TextInput type="date" label="Desde" value={desde} onChange={e => setDesde(e.target.value)} />
        <TextInput type="date" label="Hasta" value={hasta} onChange={e => setHasta(e.target.value)} />
        <Button variant="default" size="xs" onClick={() => exportarCSV(`libro_mayor_${desde}_${hasta}`,
          ['cuenta', 'nombre', 'debe', 'haber', 'saldo'],
          cuentas.map(x => [x.cuenta, x.nombre, x.debe.toFixed(2), x.haber.toFixed(2), x.saldo.toFixed(2)]))}>
          Exportar libro (CSV)
        </Button>
        <Button variant="default" size="xs" onClick={() => exportarCSV(`diario_${desde}_${hasta}`,
          ['fecha', 'concepto', 'cuenta', 'debe', 'haber'],
          asientos.flatMap(a => (a.partidas || []).map(pa => [a.fecha, a.concepto, pa.cuenta + ' ' + (pa.nombre || ''), pa.debe.toFixed(2), pa.haber.toFixed(2)])))}>
          Exportar diario (CSV)
        </Button>
      </Group>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20, alignItems: 'start' }}>
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header">
            <h3>Libro mayor</h3>
            <Text size="xs" c={Math.abs(totalDebe - totalHaber) < 0.01 ? 'dimmed' : 'red'}>
              {Math.abs(totalDebe - totalHaber) < 0.01 ? 'Balanza cuadrada' : 'Descuadre: revisa asientos'}
            </Text>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Cuenta</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
              <tbody>
                {cuentas.length === 0 && <tr><td colSpan={4} className="empty">Sin movimientos — enciende el módulo Contabilidad y registra una venta</td></tr>}
                {cuentas.map(c => (
                  <tr key={c.cuenta}>
                    <td><strong>{c.cuenta}</strong> <span className="text-muted" style={{ fontSize: 12 }}>{c.nombre}</span></td>
                    <td>${c.debe.toFixed(2)}</td>
                    <td>${c.haber.toFixed(2)}</td>
                    <td style={{ fontWeight: 700 }}>${c.saldo.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Diario (asientos)</h3><Text size="xs" c="dimmed">{asientos.length} asiento{asientos.length === 1 ? '' : 's'}</Text></div>
          <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Partidas</th></tr></thead>
              <tbody>
                {asientos.length === 0 && <tr><td colSpan={3} className="empty">Sin asientos en el rango</td></tr>}
                {asientos.map(a => (
                  <tr key={a.id}>
                    <td className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{a.fecha}</td>
                    <td style={{ fontSize: 13 }}>{a.concepto}</td>
                    <td style={{ fontSize: 12 }}>
                      {(a.partidas || []).map((pa, i) => (
                        <div key={i}>{pa.cuenta} {pa.nombre}: {pa.debe > 0 ? `cargo $${pa.debe.toFixed(2)}` : `abono $${pa.haber.toFixed(2)}`}</div>
                      ))}
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
