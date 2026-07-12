import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Select, Checkbox, Group, Text } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import { exportarCSV } from '../../lib/csv';
import { money } from '../../lib/format';
import { useTextoEmoji } from '../../context/EmojiContext';

// Herramientas diarias del contador: captura de gastos (renta/luz/etc. →
// asiento automático) y reporte de impuestos del periodo (IVA trasladado
// vs acreditable = por pagar o a favor).
export default function GastosImpuestosTab() {
  const txt = useTextoEmoji();
  const qc = useQueryClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [rango, setRango] = useState({ desde: hace30, hasta: hoy });
  const [g, setG] = useState({ concepto: '', monto: 0, metodo: 'caja', con_iva: true, fecha: hoy });

  const q = `?desde=${rango.desde}&hasta=${rango.hasta}`;
  const { data: gastos = [] } = useQuery({ queryKey: ['erp-gastos', rango], queryFn: () => api.get('/api/erp/gastos' + q) });
  const { data: imp } = useQuery({ queryKey: ['erp-impuestos', rango], queryFn: () => api.get('/api/erp/impuestos' + q) });
  const { data: cierre } = useQuery({ queryKey: ['erp-periodo-cierre'], queryFn: () => api.get('/api/erp/periodo-cierre') });

  // Mes seleccionado vs período cerrado (idem backend: mes <= cerrado = cerrado).
  const mesCerrado = !!(cierre?.cerrado && (g.fecha || hoy).slice(0, 7) <= cierre.cerrado);

  const crear = useMutation({
    mutationFn: () => api.post('/api/erp/gastos', g),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setG({ concepto: '', monto: 0, metodo: 'caja', con_iva: true, fecha: hoy });
      qc.invalidateQueries({ queryKey: ['erp-gastos'] });
      qc.invalidateQueries({ queryKey: ['erp-impuestos'] });
    },
    onError: handleApiError,
  });

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
          <TextInput type="date" label="Fecha del gasto" description="Puedes capturar en meses pasados" max={hoy} value={g.fecha} onChange={e => setG({ ...g, fecha: e.target.value })} mb="sm" />
          <Checkbox label="Trae IVA (factura — desglosa el acreditable)" checked={g.con_iva} onChange={e => setG({ ...g, con_iva: e.currentTarget.checked })} mb="md" />
          {mesCerrado && (
            <Text size="xs" mb="sm" style={{ color: 'var(--yellow)' }}>
              {txt('⚠️')} El período <strong>{cierre.cerrado}</strong> está cerrado. Solo un Administrador o Prime puede capturar aquí, y quedará registrado quién lo autorizó.
            </Text>
          )}
          <Button fullWidth onClick={() => crear.mutate()} disabled={!g.concepto.trim() || !(g.monto > 0)}>
            {mesCerrado ? 'Autorizar y registrar en mes cerrado' : 'Registrar → asiento contable'}
          </Button>
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
          <div className="card-header"><h3>Gastos registrados</h3>
            <Group gap="xs"><Text size="xs" c="dimmed">{gastos.length}</Text>
              <Button variant="default" size="xs" onClick={() => exportarCSV(`gastos_${rango.desde}_${rango.hasta}`,
                ['fecha', 'concepto', 'total'], gastos.map(x => [x.fecha, x.concepto.replace(/^Gasto: /, ''), Number(x.total).toFixed(2)]))}>CSV</Button>
            </Group></div>
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

      <ReportesSat />
    </div>
  );
}

// DIOT + Contabilidad electrónica SAT (Ola 2). Reportes sobre datos existentes;
// el contador valida/envía. Ambos exportan el archivo del SAT.
function ReportesSat() {
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const { data: diot } = useQuery({ queryKey: ['erp-diot', mes], queryFn: () => api.get('/api/erp/diot?mes=' + mes) });
  const bajar = (url) => window.open(url, '_blank');
  return (
    <Card withBorder radius="md" p="lg" className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <h3>Reportes SAT (DIOT · contabilidad electrónica)</h3>
        <TextInput type="month" size="xs" value={mes} onChange={e => setMes(e.target.value)} />
      </div>
      <Text size="xs" c="dimmed" mb="sm">Borradores generados de tus datos. Descarga el archivo del SAT y valídalo con tu contador antes de enviarlo.</Text>
      <Group mb="md" gap="xs">
        <Button size="xs" variant="default" onClick={() => bajar('/api/erp/diot?formato=txt&mes=' + mes)}>DIOT (TXT)</Button>
        <Button size="xs" variant="default" onClick={() => bajar('/api/erp/contabilidad-electronica?tipo=catalogo&descargar=1&mes=' + mes)}>Catálogo de cuentas (XML)</Button>
        <Button size="xs" variant="default" onClick={() => bajar('/api/erp/contabilidad-electronica?tipo=balanza&descargar=1&mes=' + mes)}>Balanza (XML)</Button>
      </Group>
      <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Proveedor (DIOT)</th><th>RFC</th><th className="num">Base</th><th className="num">IVA acred.</th></tr></thead>
          <tbody>
            {(!diot?.filas || diot.filas.length === 0) && <tr><td colSpan={4} className="empty">Sin operaciones con proveedores (RFC) en el mes</td></tr>}
            {(diot?.filas || []).map((f, i) => (
              <tr key={i}>
                <td>{f.nombre}</td>
                <td className="text-muted" style={{ fontSize: 11 }}>{f.rfc}</td>
                <td className="num">{money(f.base)}</td>
                <td className="num">{money(f.iva_acreditable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {diot && diot.filas?.length > 0 && <Text size="xs" fw={600} mt="xs" style={{ textAlign: 'right' }}>Total IVA acreditable: {money(diot.total_iva_acreditable)}</Text>}
    </Card>
  );
}
