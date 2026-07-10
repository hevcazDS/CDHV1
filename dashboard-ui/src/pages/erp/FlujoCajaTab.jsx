import { useQuery } from '@tanstack/react-query';
import { Card, Text, Group } from '@mantine/core';
import { api } from '../../api';

// Flujo de caja proyectado: ¿tendré dinero aunque el P&L dé positivo?
// Saldo actual + por cobrar (fiado) − por pagar (CxP), por vencimiento.
const money = (n) => n == null ? '—' : '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });

export default function FlujoCajaTab() {
  const { data } = useQuery({ queryKey: ['erp-flujo-caja'], queryFn: () => api.get('/api/erp/flujo-caja') });
  if (!data) return <div className="empty">Cargando…</div>;
  const { saldo_actual, por_cobrar, por_pagar, proyeccion, conta_activa } = data;
  const cols = [['vencido', 'Vencido'], ['d0_30', '0–30 días'], ['d31_60', '31–60 días'], ['d61mas', '61+ días'], ['sin_fecha', 'Sin fecha']];

  const Proy = ({ label, val }) => (
    <Card withBorder radius="md" p="md" className={'kpi-card' + (val != null && val < 0 ? '' : '')}>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} size="xl" c={val != null && val < 0 ? 'red' : undefined}>{money(val)}</Text>
    </Card>
  );

  return (
    <div>
      {!conta_activa && <Card withBorder radius="md" p="md" mb="md" style={{ borderColor: 'var(--yellow)', background: 'rgba(234,179,8,0.08)' }}>
        <Text size="xs">Sin el módulo Contabilidad no hay saldo de caja/bancos: la proyección parte de $0 y solo muestra lo por cobrar/pagar.</Text>
      </Card>}

      <Group mb="lg" grow>
        <Proy label="Saldo hoy (caja+bancos)" val={proyeccion.hoy} />
        <Proy label="Proyectado 30 días" val={proyeccion.en_30d} />
        <Proy label="Proyectado 60 días" val={proyeccion.en_60d} />
        <Proy label="Proyectado 90 días" val={proyeccion.en_90d} />
      </Group>

      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Por cobrar (fiado) vs por pagar (proveedores)</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th></th>{cols.map(([, l]) => <th key={l}>{l}</th>)}<th>Total</th></tr></thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600, color: 'var(--green)' }}>Entra (fiado)</td>
                {cols.map(([k]) => <td key={k}>{money(por_cobrar[k])}</td>)}
                <td style={{ fontWeight: 700 }}>{money(por_cobrar.total)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600, color: 'var(--red)' }}>Sale (proveedores)</td>
                {cols.map(([k]) => <td key={k}>{money(por_pagar[k])}</td>)}
                <td style={{ fontWeight: 700 }}>{money(por_pagar.total)}</td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ fontWeight: 700 }}>Neto</td>
                {cols.map(([k]) => { const n = (por_cobrar[k] || 0) - (por_pagar[k] || 0); return <td key={k} style={{ fontWeight: 600, color: n < 0 ? 'var(--red)' : n > 0 ? 'var(--green)' : undefined }}>{money(n)}</td>; })}
                <td style={{ fontWeight: 700 }}>{money((por_cobrar.total || 0) - (por_pagar.total || 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Text size="xs" c="dimmed" mt="sm">Entradas = fiado por cobrar (por fecha de vencimiento). Salidas = cuentas por pagar a proveedores. La causa #1 de quiebra de PYMEs es quedarse sin caja aunque el P&L dé positivo.</Text>
      </Card>
    </div>
  );
}
