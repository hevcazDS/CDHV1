import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Text, TextInput, Group, Select, NumberInput } from '@mantine/core';
import { api } from '../../api';
import { Button } from '@mantine/core';
import { Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import { confirmar, toastErr, toastOk } from '../../lib/ui';
import { exportarCSV } from '../../lib/csv';
import { imprimirReporte } from '../../lib/reporteImprimible';
import { useMutation, useQueryClient } from '@tanstack/react-query';

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
        <Button variant="default" size="xs" disabled={!cuentas.length} onClick={() => imprimirReporte({
          titulo: 'Libro mayor', subtitulo: `Del ${desde} al ${hasta}`,
          columnas: [{ key: 'cuenta', label: 'Cuenta' }, { key: 'nombre', label: 'Nombre' }, { key: 'debe', label: 'Debe', num: true, render: c => '$' + c.debe.toFixed(2) }, { key: 'haber', label: 'Haber', num: true, render: c => '$' + c.haber.toFixed(2) }, { key: 'saldo', label: 'Saldo', num: true, render: c => '$' + c.saldo.toFixed(2) }],
          filas: cuentas,
          totales: [{ label: 'Total debe / haber', valor: `$${totalDebe.toFixed(2)} / $${totalHaber.toFixed(2)}`, num: true }],
        })}>Imprimir libro</Button>
        <PeriodoCierre />
        <CierreAnual />
        <Button variant="default" size="xs" onClick={() => exportarCSV(`diario_${desde}_${hasta}`,
          ['fecha', 'concepto', 'cuenta', 'debe', 'haber'],
          asientos.flatMap(a => (a.partidas || []).map(pa => [a.fecha, a.concepto, pa.cuenta + ' ' + (pa.nombre || ''), pa.debe.toFixed(2), pa.haber.toFixed(2)])))}>
          Exportar diario (CSV)
        </Button>
        <Button variant="default" size="xs" disabled={!asientos.length} onClick={() => imprimirReporte({
          titulo: 'Diario (asientos)', subtitulo: `Del ${desde} al ${hasta}`,
          columnas: [{ key: 'fecha', label: 'Fecha' }, { key: 'concepto', label: 'Concepto' }, { key: 'cuenta', label: 'Cuenta' }, { key: 'debe', label: 'Debe', num: true }, { key: 'haber', label: 'Haber', num: true }],
          filas: asientos.flatMap(a => (a.partidas || []).map(pa => ({ fecha: a.fecha, concepto: a.concepto, cuenta: pa.cuenta + ' ' + (pa.nombre || ''), debe: pa.debe ? '$' + pa.debe.toFixed(2) : '', haber: pa.haber ? '$' + pa.haber.toFixed(2) : '' }))),
        })}>Imprimir diario</Button>
        <PolizaManual />
      </Group>

      <div className="split-2">
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


// Póliza (asiento) manual: lo que todo contador pide — ajustes, aportaciones,
// depreciación... El backend valida el cuadre (registrarAsiento lanza si
// debe ≠ haber); aquí se muestra en vivo para no mandar pólizas descuadradas.
function PolizaManual() {
  const qc = useQueryClient();
  const [abierta, setAbierta] = useState(false);
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(hoy);
  const [concepto, setConcepto] = useState('');
  const [partidas, setPartidas] = useState([{ cuenta: '', debe: 0, haber: 0 }, { cuenta: '', debe: 0, haber: 0 }]);

  const { data: plan = [] } = useQuery({
    queryKey: ['erp-plan-cuentas'],
    queryFn: () => api.get('/api/erp/plan-cuentas'),
    enabled: abierta,
  });
  const cuentasOpc = plan.map(c => ({ value: c.codigo, label: c.codigo + ' — ' + c.nombre }));

  const totalDebe = partidas.reduce((s, p) => s + (Number(p.debe) || 0), 0);
  const totalHaber = partidas.reduce((s, p) => s + (Number(p.haber) || 0), 0);
  const cuadra = Math.abs(totalDebe - totalHaber) < 0.01 && totalDebe > 0;
  const completa = partidas.every(p => p.cuenta && ((Number(p.debe) || 0) > 0) !== ((Number(p.haber) || 0) > 0));

  const setP = (i, campo, v) => setPartidas(ps => ps.map((p, j) => (j === i ? { ...p, [campo]: v } : p)));
  const cerrar = () => { setAbierta(false); setConcepto(''); setPartidas([{ cuenta: '', debe: 0, haber: 0 }, { cuenta: '', debe: 0, haber: 0 }]); setFecha(hoy); };

  const guardar = useMutation({
    mutationFn: () => api.post('/api/erp/asientos', {
      fecha, concepto,
      partidas: partidas.map(p => ({ cuenta: p.cuenta, debe: Number(p.debe) || 0, haber: Number(p.haber) || 0 })),
    }),
    onSuccess: (r) => {
      if (r.ok === false) return toastErr(r.error);
      toastOk('Póliza registrada');
      qc.invalidateQueries({ queryKey: ['erp-asientos'] });
      qc.invalidateQueries({ queryKey: ['erp-mayor'] });
      cerrar();
    },
    onError: (e) => toastErr(e.message),
  });

  return (
    <>
      <Button size="xs" onClick={() => setAbierta(true)}>+ Póliza manual</Button>
      {abierta && (
        <Modal title="Póliza manual" onClose={cerrar} actions={
          <>
            <Button variant="default" onClick={cerrar}>Cancelar</Button>
            <Button disabled={!cuadra || !completa || !concepto.trim() || guardar.isPending} onClick={() => guardar.mutate()}>Registrar</Button>
          </>
        }>
          <Group gap="sm" mb="sm">
            <TextInput type="date" label="Fecha" value={fecha} onChange={e => setFecha(e.target.value)} />
            <TextInput label="Concepto" placeholder="Ej. aportación del socio" value={concepto}
              onChange={e => setConcepto(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          </Group>
          {partidas.map((p, i) => (
            <Group key={i} gap="xs" mb={6} align="end" wrap="nowrap">
              <Select placeholder="Cuenta" data={cuentasOpc} value={p.cuenta || null} searchable
                onChange={v => setP(i, 'cuenta', v || '')} style={{ flex: 1, minWidth: 170 }} />
              <NumberInput placeholder="Cargo" min={0} decimalScale={2} hideControls value={p.debe || ''}
                onChange={v => setP(i, 'debe', v)} style={{ width: 110 }} />
              <NumberInput placeholder="Abono" min={0} decimalScale={2} hideControls value={p.haber || ''}
                onChange={v => setP(i, 'haber', v)} style={{ width: 110 }} />
              {partidas.length > 2 && (
                <Button variant="subtle" color="red" size="xs" px={6} onClick={() => setPartidas(ps => ps.filter((_, j) => j !== i))}>
                  <Trash2 size={13} />
                </Button>
              )}
            </Group>
          ))}
          <Group justify="space-between" mt="xs">
            <Button variant="default" size="xs" onClick={() => setPartidas(ps => [...ps, { cuenta: '', debe: 0, haber: 0 }])}>+ Partida</Button>
            <Text size="sm" fw={700} c={cuadra ? 'teal' : 'red'}>
              Cargos ${totalDebe.toFixed(2)} · Abonos ${totalHaber.toFixed(2)} {cuadra ? '✓ cuadra' : '— debe cuadrar'}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" mt="xs">Cada partida lleva cargo O abono (no ambos). La póliza se registra en el diario como asiento manual.</Text>
        </Modal>
      )}
    </>
  );
}

// Cierre CONTABLE ANUAL: traspasa resultados del ejercicio a Utilidad acumulada
// (capital) y bloquea el año. Cierra el año anterior (el completo).
function CierreAnual() {
  const qc = useQueryClient();
  const anio = new Date().getFullYear() - 1;
  const mut = useMutation({
    mutationFn: () => api.post('/api/erp/cierre-anual', { anio }),
    onSuccess: (r) => {
      if (r.ok === false) return toastErr(r.error);
      const u = Math.abs(r.utilidad || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
      toastOk(`Ejercicio ${r.anio} cerrado — ${r.utilidad >= 0 ? 'utilidad' : 'pérdida'} ${u}`);
      qc.invalidateQueries({ queryKey: ['periodo-cierre'] });
    },
    onError: (e) => toastErr(e.message),
  });
  return (
    <Button size="xs" variant="default" loading={mut.isPending}
      onClick={async () => { if (await confirmar({ titulo: 'Cerrar ejercicio', mensaje: `¿Cerrar contablemente el ejercicio ${anio}? Ventas, costos y gastos del año se traspasan a Utilidad acumulada y el ejercicio queda bloqueado.`, textoOk: `Cerrar ${anio}` })) mut.mutate(); }}>
      Cerrar ejercicio {anio}
    </Button>
  );
}

// Cierre de período (idea SAP): nada se asienta en meses ya cerrados —
// candado que pide todo contador. Reabrir queda logueado.
function PeriodoCierre() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['periodo-cierre'], queryFn: () => api.get('/api/erp/periodo-cierre') });
  const mut = useMutation({
    mutationFn: (cerrado) => api.put('/api/erp/periodo-cierre', { cerrado }),
    onSuccess: (r) => { if (r.ok === false) toastErr(r.error); qc.invalidateQueries({ queryKey: ['periodo-cierre'] }); },
  });
  const mesPasado = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
  return (
    <Group gap="xs" align="end">
      <Text size="xs" c={data?.cerrado ? 'red' : 'dimmed'}>
        {data?.cerrado ? `Período CERRADO hasta ${data.cerrado}` : 'Período abierto'}
      </Text>
      {!data?.cerrado
        ? <Button size="xs" variant="default" onClick={async () => { if (await confirmar({ titulo: 'Cerrar período', mensaje: `¿Cerrar el período hasta ${mesPasado}? Nada podrá asentarse en esos meses (salvo autorización de un Administrador).`, textoOk: 'Cerrar período' })) mut.mutate(mesPasado); }}>Cerrar hasta {mesPasado}</Button>
        : <Button size="xs" variant="light" color="red" onClick={async () => { if (await confirmar({ titulo: 'Reabrir período', mensaje: '¿Reabrir el período? Queda registrado quién lo hizo.', peligro: true, textoOk: 'Reabrir' })) mut.mutate(''); }}>Reabrir</Button>}
    </Group>
  );
}
