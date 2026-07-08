import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Checkbox, Group, Text, Tabs } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';

// RRHH: empleados, horarios por plantilla (CSV que Excel abre nativo) y
// nómina MX con/sin impuestos. ⚠ El ISR/IMSS es aproximado — validar con
// contador; el CFDI de nómina es upgrade aparte (PAC).
export default function Rrhh() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('empleados');
  const [emp, setEmp] = useState({ nombre: '', puesto: '', salario_diario: 0, con_impuestos: false, rfc: '', nss: '' });
  const hoy = new Date().toISOString().slice(0, 10);
  const hace14 = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
  const [periodo, setPeriodo] = useState({ desde: hace14, hasta: hoy });

  const { data: empleados = [] } = useQuery({ queryKey: ['rrhh-emp'], queryFn: () => api.get('/api/rrhh/empleados') });
  const { data: nominas = [] } = useQuery({ queryKey: ['rrhh-nom'], queryFn: () => api.get('/api/rrhh/nomina') });

  const crearEmp = useMutation({
    mutationFn: () => api.post('/api/rrhh/empleados', emp),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setEmp({ nombre: '', puesto: '', salario_diario: 0, con_impuestos: false, rfc: '', nss: '' }); qc.invalidateQueries({ queryKey: ['rrhh-emp'] }); },
    onError: handleApiError,
  });
  const importar = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const res = await api.post('/api/rrhh/horarios/importar', { csv: String(r.result || '') });
        if (!res.ok) throw new Error(res.error);
        alert(`✓ ${res.importadas} horarios importados` + (res.errores.length ? `\n⚠ Errores:\n${res.errores.join('\n')}` : ''));
      } catch (err) { handleApiError(err); }
    };
    r.readAsText(f);
    e.target.value = '';
  };
  const calcular = useMutation({
    mutationFn: () => api.post('/api/rrhh/nomina/calcular', periodo),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); qc.invalidateQueries({ queryKey: ['rrhh-nom'] }); },
    onError: handleApiError,
  });
  const pagar = useMutation({
    mutationFn: () => api.post('/api/rrhh/nomina/pagar', periodo),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); alert(`✓ ${r.pagadas} nóminas pagadas · $${(r.total || 0).toFixed(2)}`); qc.invalidateQueries({ queryKey: ['rrhh-nom'] }); },
    onError: handleApiError,
  });

  return (
    <div>
      <div className="page-title">Recursos Humanos</div>
      <div className="page-sub">Empleados, horarios y nómina · cálculo aproximado — valida impuestos con tu contador</div>
      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          <Tabs.Tab value="empleados">Empleados y horarios</Tabs.Tab>
          <Tabs.Tab value="nomina">Nómina</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {tab === 'empleados' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 20, alignItems: 'start' }}>
          <Card withBorder radius="md" p="lg" className="card">
            <div className="card-header"><h3>Nuevo empleado</h3></div>
            <TextInput label="Nombre *" value={emp.nombre} onChange={e => setEmp({ ...emp, nombre: e.target.value })} mb="sm" />
            <Group grow mb="sm">
              <TextInput label="Puesto" value={emp.puesto} onChange={e => setEmp({ ...emp, puesto: e.target.value })} />
              <NumberInput label="Salario diario *" min={0} decimalScale={2} value={emp.salario_diario} onChange={v => setEmp({ ...emp, salario_diario: v || 0 })} />
            </Group>
            <Group grow mb="sm">
              <TextInput label="RFC" value={emp.rfc} onChange={e => setEmp({ ...emp, rfc: e.target.value })} />
              <TextInput label="NSS" value={emp.nss} onChange={e => setEmp({ ...emp, nss: e.target.value })} />
            </Group>
            <Checkbox label="Con impuestos (retener ISR + IMSS)" checked={emp.con_impuestos} onChange={e => setEmp({ ...emp, con_impuestos: e.currentTarget.checked })} mb="md" />
            <Button fullWidth onClick={() => crearEmp.mutate()} disabled={!emp.nombre.trim() || !(emp.salario_diario > 0)}>Guardar empleado</Button>
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <Text size="sm" fw={600} mb={6}>Horarios por Excel</Text>
              <Group>
                <Button variant="default" size="xs" component="a" href="/api/rrhh/plantilla-horarios">Descargar plantilla</Button>
                <Button variant="default" size="xs" component="label">Subir horarios<input hidden type="file" accept=".csv,.txt" onChange={importar} /></Button>
              </Group>
            </div>
          </Card>
          <Card withBorder radius="md" p="lg" className="card">
            <div className="card-header"><h3>Empleados</h3></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nombre</th><th>Puesto</th><th>Salario/día</th><th>Régimen</th><th></th></tr></thead>
                <tbody>
                  {empleados.length === 0 && <tr><td colSpan={5} className="empty">Sin empleados</td></tr>}
                  {empleados.map(e => (
                    <tr key={e.id}>
                      <td><strong>#{e.id} {e.nombre}</strong></td><td>{e.puesto || '-'}</td>
                      <td>${Number(e.salario_diario).toFixed(2)}</td>
                      <td><span className={`badge ${e.con_impuestos ? 'badge-azul' : 'badge-amarillo'}`}>{e.con_impuestos ? 'Con impuestos' : 'Sin impuestos'}</span></td>
                      <td><Group gap={4} wrap="nowrap">
                        <Button size="xs" variant="default" onClick={async () => {
                          const s = window.prompt('Nuevo salario diario para ' + e.nombre + ':', e.salario_diario);
                          if (!s) return;
                          const r = await api.put(`/api/rrhh/empleados/${e.id}`, { salario_diario: Number(s) });
                          if (r.ok) qc.invalidateQueries({ queryKey: ['rrhh-emp'] }); else handleApiError(new Error(r.error));
                        }}>Salario</Button>
                        <Button size="xs" variant="light" color="red" onClick={async () => {
                          if (!window.confirm('¿Dar de BAJA a ' + e.nombre + '? (deja de aparecer en nómina)')) return;
                          const r = await api.put(`/api/rrhh/empleados/${e.id}`, { activo: false });
                          if (r.ok) qc.invalidateQueries({ queryKey: ['rrhh-emp'] }); else handleApiError(new Error(r.error));
                        }}>Baja</Button>
                      </Group></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'nomina' && (
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header">
            <h3>Nómina del periodo</h3>
            <Group gap="xs">
              <TextInput type="date" size="xs" value={periodo.desde} onChange={e => setPeriodo({ ...periodo, desde: e.target.value })} />
              <TextInput type="date" size="xs" value={periodo.hasta} onChange={e => setPeriodo({ ...periodo, hasta: e.target.value })} />
              <Button size="xs" onClick={() => calcular.mutate()}>Calcular</Button>
              <Button size="xs" variant="light" color="teal" onClick={() => pagar.mutate()}>Pagar periodo</Button>
            </Group>
          </div>
          <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Empleado</th><th>Periodo</th><th>Horas</th><th>Bruto</th><th>ISR</th><th>IMSS</th><th>Neto</th><th>Estatus</th></tr></thead>
              <tbody>
                {nominas.length === 0 && <tr><td colSpan={8} className="empty">Calcula un periodo para ver la nómina</td></tr>}
                {nominas.map(n => (
                  <tr key={n.id}>
                    <td><strong>{n.nombre}</strong></td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{n.desde} → {n.hasta}</td>
                    <td>{n.horas}</td><td>${n.bruto.toFixed(2)}</td>
                    <td>{n.isr > 0 ? '$' + n.isr.toFixed(2) : '—'}</td>
                    <td>{n.imss > 0 ? '$' + n.imss.toFixed(2) : '—'}</td>
                    <td style={{ fontWeight: 700 }}>${n.neto.toFixed(2)}</td>
                    <td><span className={`badge ${n.estatus === 'pagada' ? 'badge-verde' : 'badge-amarillo'}`}>{n.estatus}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
