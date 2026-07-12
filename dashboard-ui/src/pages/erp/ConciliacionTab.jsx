import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Group, Text, TextInput } from '@mantine/core';
import { api } from '../../api';
import { fmt } from '../../lib/format';
import { toastOk, toastErr, confirmar } from '../../lib/ui';

// Conciliación bancaria (Ola 4): sube el estado de cuenta (CSV), casa cada línea
// contra un cobro o un pago ya registrado (por monto exacto y fecha cercana) y
// deja ver lo que NO cuadra. El CSV se parsea aquí; el backend guarda y auto-casa.

// Normaliza fecha a YYYY-MM-DD (acepta dd/mm/yyyy, dd-mm-yyyy o ya-ISO).
function normFecha(s) {
  s = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!m) return '';
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
const num = (s) => Number(String(s ?? '').replace(/[$,\s]/g, '')) || 0;

// Parser CSV mínimo: detecta separador (, o ;), encabezado, y mapea columnas
// fecha/concepto/monto — o cargo/abono si vienen separados (bancos MX).
function parseCSV(texto) {
  const lineas = texto.split(/\r?\n/).filter(l => l.trim());
  if (!lineas.length) return [];
  const sep = (lineas[0].match(/;/g) || []).length > (lineas[0].match(/,/g) || []).length ? ';' : ',';
  const cel = (l) => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
  const head = cel(lineas[0]).map(h => h.toLowerCase());
  const tieneHeader = head.some(h => /fecha|date|concepto|descrip|monto|importe|cargo|abono|amount/.test(h));
  const idx = (nombres) => head.findIndex(h => nombres.some(n => h.includes(n)));
  const iF = tieneHeader ? idx(['fecha', 'date']) : 0;
  const iC = tieneHeader ? idx(['concepto', 'descrip', 'concept']) : 1;
  const iM = tieneHeader ? idx(['monto', 'importe', 'amount']) : 2;
  const iCargo = tieneHeader ? idx(['cargo', 'retiro', 'debito', 'débito']) : -1;
  const iAbono = tieneHeader ? idx(['abono', 'deposito', 'depósito', 'credito', 'crédito']) : -1;
  const filas = tieneHeader ? lineas.slice(1) : lineas;
  return filas.map(l => {
    const c = cel(l);
    let monto;
    if (iM >= 0 && c[iM] != null && c[iM] !== '') monto = num(c[iM]);
    else if (iCargo >= 0 || iAbono >= 0) monto = num(c[iAbono]) - num(c[iCargo]); // + ingreso / - egreso
    else monto = 0;
    return { fecha: normFecha(c[iF]), concepto: (c[iC] || '').slice(0, 200), monto: Math.round(monto * 100) / 100 };
  }).filter(m => m.fecha && m.monto !== 0);
}

export default function ConciliacionTab() {
  const qc = useQueryClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [r, setR] = useState({ desde: hace30, hasta: hoy });
  const [preview, setPreview] = useState(null); // filas parseadas pendientes de importar
  const { data } = useQuery({ queryKey: ['conciliacion', r], queryFn: () => api.get(`/api/erp/conciliacion?desde=${r.desde}&hasta=${r.hasta}`) });
  const movs = data?.movimientos || [];
  const res = data?.resumen || {};

  const onArchivo = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const filas = parseCSV(String(rd.result || ''));
      if (!filas.length) return toastErr('No pude leer movimientos (columnas fecha, concepto, monto — o cargo/abono)');
      setPreview(filas);
    };
    rd.readAsText(f);
    e.target.value = '';
  };
  const importar = async () => {
    const rr = await api.post('/api/erp/conciliacion/importar', { movimientos: preview }).catch(e => ({ ok: false, error: e.message }));
    if (!rr.ok) return toastErr(rr.error);
    toastOk(`Importados ${rr.importados} · conciliados auto ${rr.conciliados_auto} · sin conciliar ${rr.sin_conciliar}`);
    setPreview(null);
    qc.invalidateQueries({ queryKey: ['conciliacion'] });
  };
  const toggle = async (m) => {
    if (m.conciliado) {
      if (!await confirmar({ titulo: 'Desconciliar', mensaje: '¿Marcar este movimiento como NO conciliado?' })) return;
      const rr = await api.post(`/api/erp/conciliacion/${m.id}`, { conciliar: false }).catch(e => ({ ok: false, error: e.message }));
      if (!rr.ok) return toastErr(rr.error);
    } else {
      const rr = await api.post(`/api/erp/conciliacion/${m.id}`, { match_tipo: 'manual' }).catch(e => ({ ok: false, error: e.message }));
      if (!rr.ok) return toastErr(rr.error);
      toastOk('Conciliado manualmente');
    }
    qc.invalidateQueries({ queryKey: ['conciliacion'] });
  };

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <div className="card-header">
        <h3>Conciliación bancaria</h3>
        <Group gap="xs" align="end">
          <TextInput type="date" size="xs" value={r.desde} onChange={e => setR({ ...r, desde: e.target.value })} />
          <TextInput type="date" size="xs" value={r.hasta} onChange={e => setR({ ...r, hasta: e.target.value })} />
          <Button component="label" size="xs" variant="default">
            Subir estado de cuenta (CSV)
            <input type="file" accept=".csv,.txt" hidden onChange={onArchivo} />
          </Button>
        </Group>
      </div>
      <Text size="xs" c="dimmed" mb="sm">
        Sube el CSV del banco (columnas <strong>fecha, concepto, monto</strong> — o <strong>cargo/abono</strong> separados).
        Se casa automáticamente contra cobros (links de pago pagados) y pagos a proveedor por monto y fecha (±3 días).
      </Text>

      {preview && (
        <Card withBorder radius="sm" p="md" mb="md" style={{ background: 'var(--surface-2, #fafafa)' }}>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>{preview.length} movimiento(s) leídos — revisa e importa</Text>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={() => setPreview(null)}>Cancelar</Button>
              <Button size="xs" onClick={importar}>Importar {preview.length}</Button>
            </Group>
          </Group>
          <div className="table-wrap" style={{ maxHeight: 180, overflow: 'auto' }}>
            <table><thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Monto</th></tr></thead>
              <tbody>{preview.slice(0, 100).map((m, i) => <tr key={i}><td>{m.fecha}</td><td>{m.concepto}</td><td className="num" style={{ color: m.monto < 0 ? 'var(--red)' : 'var(--green)' }}>${fmt(m.monto)}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      )}

      <Group gap="lg" mb="md" wrap="wrap">
        <div><Text size="xs" c="dimmed">Movimientos</Text><Text fw={700}>{res.total || 0}</Text></div>
        <div><Text size="xs" c="dimmed">Conciliados</Text><Text fw={700} c="green">{res.conciliados || 0}</Text></div>
        <div><Text size="xs" c="dimmed">Sin conciliar</Text><Text fw={700} c={res.sin_conciliar > 0 ? 'orange' : undefined}>{res.sin_conciliar || 0}</Text></div>
        <div><Text size="xs" c="dimmed">Ingresos</Text><Text fw={700} c="green">${fmt(res.ingresos)}</Text></div>
        <div><Text size="xs" c="dimmed">Egresos</Text><Text fw={700} c="red">${fmt(res.egresos)}</Text></div>
        <div><Text size="xs" c="dimmed">Neto</Text><Text fw={700}>${fmt(res.neto)}</Text></div>
      </Group>

      <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Monto</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {movs.length === 0 && <tr><td colSpan={5} className="empty">Sin movimientos en el rango — sube un estado de cuenta</td></tr>}
            {movs.map(m => (
              <tr key={m.id}>
                <td>{m.fecha}</td>
                <td>{m.concepto || '—'}</td>
                <td className="num" style={{ color: m.monto < 0 ? 'var(--red)' : 'var(--green)' }}>${fmt(m.monto)}</td>
                <td>{m.conciliado
                  ? <span className="badge badge-verde">conciliado{m.match_tipo && m.match_tipo !== 'manual' ? ' (auto)' : m.match_tipo === 'manual' ? ' (manual)' : ''}</span>
                  : <span className="badge badge-amarillo">sin conciliar</span>}</td>
                <td><Button size="compact-xs" variant="subtle" onClick={() => toggle(m)}>{m.conciliado ? 'Desconciliar' : 'Conciliar'}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
