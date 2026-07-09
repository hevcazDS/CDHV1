import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Select, Checkbox, Group, Text } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';

// Herramientas diarias del contador: captura de gastos (renta/luz/etc. →
// asiento automático) y reporte de impuestos del periodo (IVA trasladado
// vs acreditable = por pagar o a favor).
export default function GastosImpuestosTab() {
  const qc = useQueryClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [rango, setRango] = useState({ desde: hace30, hasta: hoy });
  const [g, setG] = useState({ concepto: '', monto: 0, metodo: 'caja', con_iva: true });

  const q = `?desde=${rango.desde}&hasta=${rango.hasta}`;
  const { data: gastos = [] } = useQuery({ queryKey: ['erp-gastos', rango], queryFn: () => api.get('/api/erp/gastos' + q) });
  const { data: imp } = useQuery({ queryKey: ['erp-impuestos', rango], queryFn: () => api.get('/api/erp/impuestos' + q) });

  const crear = useMutation({
    mutationFn: () => api.post('/api/erp/gastos', g),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setG({ concepto: '', monto: 0, metodo: 'caja', con_iva: true });
      qc.invalidateQueries({ queryKey: ['erp-gastos'] });
      qc.invalidateQueries({ queryKey: ['erp-impuestos'] });
    },
    onError: handleApiError,
  });

  const money = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });

  return (
    <div>
      <Group mb="md" gap="sm">
        <TextInput type="date" label="Desde" value={rango.desde} onChange={e => setRango({ ...rango, desde: e.target.value })} />
        <TextInput type="date" label="Hasta" value={rango.hasta} onChange={e => setRango({ ...rango, hasta: e.target.value })} />
      </Group>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 20, alignItems: 'start' }}>
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Registrar gasto</h3></div>
          <TextInput label="Concepto *" placeholder="Renta, luz, papelería..." value={g.concepto} onChange={e => setG({ ...g, concepto: e.target.value })} mb="sm" />
          <Group grow mb="sm">
            <NumberInput label="Monto total *" min={0} decimalScale={2} value={g.monto} onChange={v => setG({ ...g, monto: v || 0 })} />
            <Select label="Pagado con" allowDeselect={false} value={g.metodo} onChange={v => setG({ ...g, metodo: v })}
              data={[{ value: 'caja', label: 'Caja (efectivo)' }, { value: 'bancos', label: 'Bancos' }]} />
          </Group>
          <Checkbox label="Trae IVA (factura — desglosa el acreditable)" checked={g.con_iva} onChange={e => setG({ ...g, con_iva: e.currentTarget.checked })} mb="md" />
          <Button fullWidth onClick={() => crear.mutate()} disabled={!g.concepto.trim() || !(g.monto > 0)}>Registrar → asiento contable</Button>
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Impuestos del periodo</h3></div>
          {!imp ? <div className="empty">Cargando...</div> : (
            <table style={{ width: '100%' }}>
              <tbody>
                <tr><td className="text-muted" style={{ padding: '6px 0' }}>Ventas (base gravable)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{money(imp.ventas_base)}</td></tr>
                <tr><td className="text-muted" style={{ padding: '6px 0' }}>Gastos del periodo</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{money(imp.gastos)}</td></tr>
                <tr><td className="text-muted" style={{ padding: '6px 0' }}>IVA trasladado (cobrado)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{money(imp.iva_trasladado)}</td></tr>
                <tr><td className="text-muted" style={{ padding: '6px 0' }}>IVA acreditable (pagado)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{money(imp.iva_acreditable)}</td></tr>
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 0', fontWeight: 700 }}>{imp.iva_resultado >= 0 ? 'IVA por PAGAR' : 'IVA a FAVOR'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: imp.iva_resultado >= 0 ? 'var(--red)' : 'var(--green)' }}>{money(Math.abs(imp.iva_resultado))}</td>
                </tr>
              </tbody>
            </table>
          )}
          <Text size="xs" c="dimmed" mt="sm">Cálculo aproximado para gestión interna — la declaración la valida tu contador.</Text>
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Gastos registrados</h3><Text size="xs" c="dimmed">{gastos.length}</Text></div>
          <div className="table-wrap" style={{ maxHeight: 380, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Total</th></tr></thead>
              <tbody>
                {gastos.length === 0 && <tr><td colSpan={3} className="empty">Sin gastos en el rango</td></tr>}
                {gastos.map(x => (
                  <tr key={x.id}>
                    <td className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{x.fecha}</td>
                    <td>{x.concepto.replace(/^Gasto: /, '')}</td>
                    <td style={{ fontWeight: 600 }}>{money(x.total)}</td>
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
