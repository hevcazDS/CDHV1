import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, TextInput, Group, Text } from '@mantine/core';
import { api } from '../../api';

// Tablero de dirección (comité Harvard+LSE+Oxford): estado de resultados,
// balance, aging de CxC, rotación de inventario, margen por categoría y
// ticket vs período anterior. Responde "¿gano?", no solo "¿vendo?".
const money = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TableroTab() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [r, setR] = useState({ desde: hace30, hasta: hoy });
  const { data } = useQuery({
    queryKey: ['erp-tablero', r],
    queryFn: () => api.get(`/api/erp/tablero?desde=${r.desde}&hasta=${r.hasta}`),
  });

  if (!data) return <div className="empty">Cargando tablero...</div>;
  const { pyl, balance, aging, inventario, categorias, ticket } = data;
  const Fila = ({ label, val, fuerte, color }) => (
    <tr style={fuerte ? { borderTop: '1px solid var(--border)' } : undefined}>
      <td style={{ padding: '5px 0', fontWeight: fuerte ? 700 : 400 }}>{label}</td>
      <td style={{ textAlign: 'right', fontWeight: fuerte ? 700 : 600, color }}>{money(val)}</td>
    </tr>
  );

  return (
    <div>
      <Group mb="md" gap="sm">
        <TextInput type="date" label="Desde" value={r.desde} onChange={e => setR({ ...r, desde: e.target.value })} />
        <TextInput type="date" label="Hasta" value={r.hasta} onChange={e => setR({ ...r, hasta: e.target.value })} />
      </Group>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Estado de resultados</h3>
            <span className={`badge ${pyl.margen_neto_pct >= 0 ? 'badge-verde' : 'badge-rojo'}`}>Margen neto {pyl.margen_neto_pct}%</span></div>
          <table style={{ width: '100%' }}><tbody>
            <Fila label="Ventas" val={pyl.ingresos} />
            <Fila label="− Costo de ventas (COGS)" val={-pyl.cogs} />
            <Fila label="= Utilidad bruta" val={pyl.utilidad_bruta} fuerte />
            <Fila label="− Gastos operativos" val={-pyl.gastos} />
            <Fila label="= Utilidad operativa" val={pyl.utilidad_operativa} fuerte color={pyl.utilidad_operativa >= 0 ? 'var(--green)' : 'var(--red)'} />
          </tbody></table>
          <Text size="xs" c="dimmed" mt="xs">Margen bruto {pyl.margen_bruto_pct}% · requiere el módulo Contabilidad activo</Text>
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Balance general</h3>
            <span className={`badge ${balance.cuadra ? 'badge-verde' : 'badge-rojo'}`}>{balance.cuadra ? 'Cuadra' : 'Descuadre'}</span></div>
          <table style={{ width: '100%' }}><tbody>
            <Fila label="Activos" val={balance.activos} fuerte />
            <Fila label="Pasivos" val={balance.pasivos} />
            <Fila label="Capital (+ utilidad acumulada)" val={balance.capital} />
          </tbody></table>
          <div className="card-header" style={{ marginTop: 16 }}><h3>Ticket promedio</h3></div>
          <table style={{ width: '100%' }}><tbody>
            <Fila label={`Este período (${ticket.pedidos} pedidos)`} val={ticket.actual} fuerte />
            <Fila label="Período anterior" val={ticket.anterior} />
          </tbody></table>
          {ticket.variacion_pct != null && (
            <Text size="xs" c={ticket.variacion_pct >= 0 ? 'teal' : 'red'} mt={4}>
              {ticket.variacion_pct >= 0 ? '▲' : '▼'} {Math.abs(ticket.variacion_pct)}% vs período anterior
            </Text>
          )}
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Antigüedad de cuentas por cobrar</h3></div>
          <table style={{ width: '100%' }}><tbody>
            {Object.entries(aging).map(([k, v]) => (
              <tr key={k}><td style={{ padding: '5px 0' }}>{k} días</td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: k === '90+' && v > 0 ? 'var(--red)' : k === '61-90' && v > 0 ? 'var(--yellow)' : undefined }}>{money(v)}</td></tr>
            ))}
          </tbody></table>
          <div className="card-header" style={{ marginTop: 16 }}><h3>Rotación de inventario</h3></div>
          <table style={{ width: '100%' }}><tbody>
            <Fila label="Valor del inventario (a costo)" val={inventario.valor} />
            <tr><td style={{ padding: '5px 0' }}>Días de inventario</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{inventario.dias_inventario ?? '—'}</td></tr>
            <tr><td style={{ padding: '5px 0' }}>Rotación anual (aprox.)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{inventario.rotacion_anual != null ? inventario.rotacion_anual + 'x' : '—'}</td></tr>
          </tbody></table>
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Margen por categoría</h3></div>
          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Categoría</th><th>Ventas</th><th>Margen</th><th>%</th></tr></thead>
              <tbody>
                {categorias.length === 0 && <tr><td colSpan={4} className="empty">Sin ventas pagadas en el período (o falta cargar costos)</td></tr>}
                {categorias.map(c => (
                  <tr key={c.categoria}>
                    <td><strong>{c.categoria}</strong></td>
                    <td>{money(c.ventas)}</td>
                    <td>{money(c.margen)}</td>
                    <td style={{ fontWeight: 700, color: c.margen_pct >= 30 ? 'var(--green)' : c.margen_pct < 10 ? 'var(--red)' : undefined }}>{c.margen_pct}%</td>
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
