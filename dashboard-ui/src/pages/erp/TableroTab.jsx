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
  const { pyl, comparativo, balance, aging, inventario, categorias, ticket, punto_equilibrio: pe } = data;
  const varTxt = (v) => v == null ? null : (v >= 0 ? '▲ +' + v + '%' : '▼ ' + v + '%');
  const varColor = (v) => v == null ? 'var(--text-mute)' : v >= 0 ? 'var(--green)' : 'var(--red)';
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

      {data.conta_activa === false && (
        <Card withBorder radius="md" p="md" mb="md" style={{ borderColor: 'var(--yellow)', background: 'rgba(234,179,8,0.08)' }}>
          <Text size="sm" fw={600}>⚠️ Módulo Contabilidad apagado</Text>
          <Text size="xs" c="dimmed">El estado de resultados y el balance salen de los asientos contables. Sin el módulo activo no se registra ninguno, así que verás $0 — no significa que no hayas vendido. Actívalo en <strong>Módulos → Contabilidad</strong> para que las ventas empiecen a asentarse. El aging de CxC, el margen por categoría y el ticket promedio sí funcionan sin él.</Text>
        </Card>
      )}

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
          {comparativo && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', gap: 18, fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-mute)' }}>vs período anterior:</span>
              <span>Ventas <strong style={{ color: varColor(comparativo.var_ingresos_pct) }}>{varTxt(comparativo.var_ingresos_pct) || '—'}</strong></span>
              <span>Utilidad <strong style={{ color: varColor(comparativo.var_utilidad_pct) }}>{varTxt(comparativo.var_utilidad_pct) || '—'}</strong></span>
              <span style={{ color: 'var(--text-mute)' }}>(margen ant. {comparativo.margen_neto_pct}%)</span>
            </div>
          )}
          {pe && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <Text size="sm" fw={600} mb={4}>Punto de equilibrio</Text>
              {pe.ventas_equilibrio == null
                ? <Text size="xs" c="dimmed">Sin margen suficiente en el período para calcularlo.</Text>
                : <>
                    <table style={{ width: '100%' }}><tbody>
                      <Fila label="Ventas para no perder" val={pe.ventas_equilibrio} fuerte />
                      <Fila label="Ventas del período" val={pe.ventas_periodo} />
                      <Fila label={pe.holgura >= 0 ? '= Holgura sobre el equilibrio' : '= Faltante para el equilibrio'} val={pe.holgura} color={pe.holgura >= 0 ? 'var(--green)' : 'var(--red)'} />
                    </tbody></table>
                    <Text size="xs" c="dimmed" mt={4}>Gastos fijos {money(pe.gastos_fijos)} · margen de contribución {pe.margen_contribucion_pct}%. Los gastos operativos (601) se toman como fijos.</Text>
                  </>}
            </div>
          )}
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
