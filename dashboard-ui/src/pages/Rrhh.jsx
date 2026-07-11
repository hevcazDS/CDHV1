import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Checkbox, Group, Text, Tabs, Select } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk, alertar, confirmar, prompt } from '../lib/ui';

// RRHH: empleados, horarios por plantilla (CSV que Excel abre nativo) y
// nómina MX con/sin impuestos. El ISR/IMSS es aproximado — validar con
// contador; el CFDI de nómina es upgrade aparte (PAC).
export default function Rrhh() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('empleados');
  const [emp, setEmp] = useState({ nombre: '', puesto: '', salario_diario: 0, con_impuestos: false, rfc: '', nss: '', curp: '', fecha_alta: '', departamento: '', comision_pct: 0, metodo_pago: 'transferencia', username: '' });
  const hoy = new Date().toISOString().slice(0, 10);
  const hace14 = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
  const [periodo, setPeriodo] = useState({ desde: hace14, hasta: hoy });
  const [verBajas, setVerBajas] = useState(false);

  const { data: modulo } = useQuery({ queryKey: ['modulo-rrhh'], queryFn: () => api.get('/api/modulo/rrhh_activo').catch(() => null) });
  const { data: modFiscal } = useQuery({ queryKey: ['modulo-nom-fiscal'], queryFn: () => api.get('/api/modulo/nomina_fiscal_activo').catch(() => null) });
  const fiscal = !!modFiscal?.activo;
  const moduloApagado = modulo && !modulo.error && !modulo.activo;
  const { data: empleados = [] } = useQuery({ queryKey: ['rrhh-emp', verBajas], queryFn: () => api.get('/api/rrhh/empleados' + (verBajas ? '?todos=1' : '')), enabled: !moduloApagado });
  const { data: nominas = [] } = useQuery({ queryKey: ['rrhh-nom'], queryFn: () => api.get('/api/rrhh/nomina') });

  const crearEmp = useMutation({
    mutationFn: () => api.post('/api/rrhh/empleados', emp),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setEmp({ nombre: '', puesto: '', salario_diario: 0, con_impuestos: false, rfc: '', nss: '', curp: '', fecha_alta: '', departamento: '', comision_pct: 0, metodo_pago: 'transferencia', username: '' }); qc.invalidateQueries({ queryKey: ['rrhh-emp'] }); },
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
        if (res.errores.length) await alertar({ titulo: `${res.importadas} horarios importados`, mensaje: 'Errores:\n' + res.errores.join('\n') });
        else toastOk(`${res.importadas} horarios importados`);
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
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); toastOk(`${r.pagadas} nóminas pagadas · $${(r.total || 0).toFixed(2)}`); qc.invalidateQueries({ queryKey: ['rrhh-nom'] }); },
    onError: handleApiError,
  });

  return (
    <div>
      <div className="page-title">Recursos Humanos</div>
      <div className="page-sub">Empleados, horarios y nómina · cálculo aproximado — valida impuestos con tu contador</div>
      {moduloApagado && (
        <div className="banner-alerta" style={{ marginBottom: 14 }}>
          El módulo Recursos Humanos está desactivado — pide al administrador encenderlo en Módulos para operar aquí.
        </div>
      )}
      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          <Tabs.Tab value="empleados">Empleados y horarios</Tabs.Tab>
          <Tabs.Tab value="nomina">Nómina</Tabs.Tab>
          <Tabs.Tab value="liquidaciones">Aguinaldo / Finiquito</Tabs.Tab>
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
            {fiscal && (
              <>
                <Group grow mb="sm">
                  <TextInput type="date" label="Fecha de alta (antigüedad)" value={emp.fecha_alta} onChange={e => setEmp({ ...emp, fecha_alta: e.target.value })} />
                  <TextInput label="CURP" value={emp.curp} onChange={e => setEmp({ ...emp, curp: e.target.value })} />
                </Group>
                <Group grow mb="sm">
                  <TextInput label="Departamento" value={emp.departamento} onChange={e => setEmp({ ...emp, departamento: e.target.value })} />
                  <NumberInput label="Comisión % (sobre lo que cobra)" min={0} max={100} value={emp.comision_pct} onChange={v => setEmp({ ...emp, comision_pct: v || 0 })} />
                </Group>
                <Group grow mb="sm">
                  <TextInput label="Usuario POS (para comisión)" placeholder="username del cajero" value={emp.username} onChange={e => setEmp({ ...emp, username: e.target.value })} />
                  <Select label="Método de pago" allowDeselect={false} value={emp.metodo_pago} onChange={v => setEmp({ ...emp, metodo_pago: v })}
                    data={[{ value: 'transferencia', label: 'Transferencia' }, { value: 'efectivo', label: 'Efectivo' }]} />
                </Group>
              </>
            )}
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
            <div className="card-header"><h3>Empleados</h3>
              <Checkbox size="xs" label="Ver bajas" checked={verBajas} onChange={e => setVerBajas(e.currentTarget.checked)} />
            </div>
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
                          const s = await prompt({ titulo: 'Salario diario', mensaje: 'Nuevo salario diario para ' + e.nombre + ':', valorInicial: String(e.salario_diario), tipo: 'text' });
                          if (!s) return;
                          const r = await api.put(`/api/rrhh/empleados/${e.id}`, { salario_diario: Number(s) });
                          if (r.ok) qc.invalidateQueries({ queryKey: ['rrhh-emp'] }); else handleApiError(new Error(r.error));
                        }}>Salario</Button>
                        {!!e.activo && <Button size="xs" variant="light" color="red" onClick={async () => {
                          if (!await confirmar({ titulo: 'Dar de baja', mensaje: '¿Dar de baja a ' + e.nombre + '? Deja de aparecer en nómina.', peligro: true, textoOk: 'Dar de baja' })) return;
                          const r = await api.put(`/api/rrhh/empleados/${e.id}`, { activo: false });
                          if (r.ok) qc.invalidateQueries({ queryKey: ['rrhh-emp'] }); else handleApiError(new Error(r.error));
                        }}>Baja</Button>}
                        {!e.activo && <Button size="xs" variant="light" color="teal" onClick={async () => {
                          const rr = await api.put(`/api/rrhh/empleados/${e.id}`, { activo: true });
                          if (rr.ok) qc.invalidateQueries({ queryKey: ['rrhh-emp'] }); else handleApiError(new Error(rr.error));
                        }}>Reactivar</Button>}
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
              <Button size="xs" variant="light" color="teal" onClick={async () => { if (await confirmar({ titulo: 'Pagar periodo', mensaje: 'El ISR/IMSS es APROXIMADO para gestión interna. El cálculo fiscal definitivo y el CFDI de nómina los hace tu contador/PAC.\n\n¿Pagar el periodo?', textoOk: 'Pagar' })) pagar.mutate(); }}>Pagar periodo</Button>
            </Group>
          </div>
          <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
            <table className="tabla-sticky">
              <thead><tr><th>Empleado</th><th>Periodo</th><th>Horas</th>{fiscal && <th>H.Extra</th>}{fiscal && <th>Prima dom.</th>}{fiscal && <th>7º día</th>}{fiscal && <th>Comis.</th>}<th>Bruto</th><th>ISR</th><th>IMSS</th><th>Neto</th>{fiscal && <th title="Cuota patronal — costo del negocio, no se descuenta">IMSS patronal</th>}<th>Estatus</th></tr></thead>
              <tbody>
                {nominas.length === 0 && <tr><td colSpan={fiscal ? 13 : 8} className="empty">Calcula un periodo para ver la nómina</td></tr>}
                {nominas.map(n => (
                  <tr key={n.id}>
                    <td><strong>{n.nombre}</strong></td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{n.desde} → {n.hasta}</td>
                    <td>{n.horas}</td>{fiscal && <td>{n.horas_extra ?? 0}</td>}{fiscal && <td>{n.prima_dominical > 0 ? '$' + n.prima_dominical.toFixed(2) : '—'}</td>}{fiscal && <td>{n.septimo_dia > 0 ? '$' + n.septimo_dia.toFixed(2) : '—'}</td>}{fiscal && <td>${(n.comisiones ?? 0).toFixed(2)}</td>}<td>${n.bruto.toFixed(2)}</td>
                    <td>{n.isr > 0 ? '$' + n.isr.toFixed(2) : '—'}</td>
                    <td>{n.imss > 0 ? '$' + n.imss.toFixed(2) : '—'}</td>
                    <td style={{ fontWeight: 700 }}>${n.neto.toFixed(2)}</td>
                    {fiscal && <td className="text-muted">{n.imss_patronal > 0 ? '$' + n.imss_patronal.toFixed(2) : '—'}</td>}
                    <td><span className={`badge ${n.estatus === 'pagada' ? 'badge-verde' : 'badge-amarillo'}`}>{n.estatus}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Text size="xs" c="dimmed" mt="sm">⚠️ ISR/IMSS aproximados para gestión interna — el cálculo fiscal definitivo y el CFDI de nómina los hace tu contador/PAC.</Text>
        </Card>
      )}

      {tab === 'liquidaciones' && <Liquidaciones empleados={empleados} />}
    </div>
  );
}

// Aguinaldo y finiquito: preview (cálculo) + pago que deja ASIENTO contable y
// huella de quién autorizó (PIN si el rol lo exige). Cierra el hueco de "pago
// fuera de libros" del re-review (Oxford/RH).
function Liquidaciones({ empleados }) {
  const [sel, setSel] = useState('');
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [fin, setFin] = useState({ fecha_baja: new Date().toISOString().slice(0, 10), dias_pendientes: 0, tipo_baja: 'renuncia' });
  const [prevFin, setPrevFin] = useState(null);
  const [inc, setInc] = useState({ tipo: 'enfermedad_general', desde: new Date().toISOString().slice(0, 10), hasta: new Date().toISOString().slice(0, 10), folio_imss: '' });
  const empId = sel ? Number(sel) : null;
  const qc2 = useQueryClient();
  const { data: incaps = [] } = useQuery({ queryKey: ['rrhh-incap', empId], enabled: !!empId, queryFn: () => api.get('/api/rrhh/incapacidades?id_empleado=' + empId).catch(() => []) });
  const registrarIncap = async () => {
    if (!empId) return;
    const r = await api.post('/api/rrhh/incapacidades', { id_empleado: empId, ...inc }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk('Incapacidad registrada'); qc2.invalidateQueries({ queryKey: ['rrhh-incap'] });
  };
  const borrarIncap = async (id) => { await api.del('/api/rrhh/incapacidades/' + id).catch(() => {}); qc2.invalidateQueries({ queryKey: ['rrhh-incap'] }); };

  // Paga reintentando con PIN si el backend lo exige (roles especialistas).
  const pagarConPin = async (url, body) => {
    let r = await api.post(url, body).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok && r.pin_requerido) {
      const pin = await prompt({ titulo: 'PIN de autorización', tipo: 'password', mensaje: 'Esta operación requiere el PIN de autorización:' });
      if (!pin) return null;
      r = await api.post(url, { ...body, pin }).catch(e => ({ ok: false, error: e.message }));
    }
    return r;
  };

  const money = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });

  const pagarAguinaldo = async () => {
    if (!empId) return;
    const prev = await api.get(`/api/rrhh/aguinaldo/${empId}?anio=${anio}`).catch(() => null);
    if (!prev?.ok) return handleApiError(new Error(prev?.error || 'No se pudo calcular'));
    if (prev.pagado) return alertar({ titulo: 'Ya registrado', mensaje: `El aguinaldo ${anio} de ${prev.empleado} ya está asentado.` });
    if (!await confirmar({ titulo: 'Pagar aguinaldo', mensaje: `${prev.empleado} · ${anio}\nAguinaldo: ${money(prev.aguinaldo)}\n\nQueda registrado (y asentado 601/102 si Contabilidad está activo), con la huella de quién autorizó. ¿Continuar?`, textoOk: 'Pagar y registrar' })) return;
    const r = await pagarConPin(`/api/rrhh/aguinaldo/${empId}/pagar`, { anio });
    if (!r) return;
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk(`Aguinaldo pagado · ${money(r.total)} · asiento #${r.id_asiento}`);
  };

  const calcularFin = async () => {
    if (!empId) return;
    const r = await api.post(`/api/rrhh/finiquito/${empId}`, fin).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    setPrevFin(r);
  };
  const pagarFin = async () => {
    if (!empId || !prevFin) return;
    if (prevFin.pagado) return alertar({ titulo: 'Ya registrado', mensaje: `El finiquito de ${prevFin.empleado} ya está asentado.` });
    if (!await confirmar({ titulo: 'Pagar finiquito', mensaje: `${prevFin.empleado} · baja ${fin.fecha_baja}\nTotal: ${money(prevFin.total)}\n\nQueda registrado (y asentado si Contabilidad está activo), se dará de baja al empleado y quedará la huella de quién autorizó. ¿Continuar?`, peligro: true, textoOk: 'Pagar y dar de baja' })) return;
    const r = await pagarConPin(`/api/rrhh/finiquito/${empId}/pagar`, fin);
    if (!r) return;
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk(`Finiquito pagado · ${money(r.total)} · asiento #${r.id_asiento}`);
    setPrevFin(null);
  };

  return (
    <div>
      <Select label="Empleado" placeholder="Elige un empleado" searchable value={sel} onChange={setSel} mb="md"
        data={empleados.map(e => ({ value: String(e.id), label: `#${e.id} ${e.nombre}` }))} style={{ maxWidth: 360 }} />
      <Text size="xs" c="dimmed" mb="md">Cálculo aproximado (LFT) — el CFDI de nómina y el definitivo los hace tu contador. El pago deja asiento contable (requiere el módulo Contabilidad activo).</Text>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Aguinaldo</h3></div>
          <NumberInput label="Año" value={anio} onChange={v => setAnio(v || new Date().getFullYear())} min={2020} max={2100} mb="md" style={{ maxWidth: 160 }} />
          <Button onClick={pagarAguinaldo} disabled={!empId}>Calcular y pagar aguinaldo</Button>
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Finiquito</h3></div>
          <Group grow mb="sm">
            <TextInput type="date" label="Fecha de baja" value={fin.fecha_baja} onChange={e => setFin({ ...fin, fecha_baja: e.target.value })} />
            <NumberInput label="Días pendientes de pago" min={0} value={fin.dias_pendientes} onChange={v => setFin({ ...fin, dias_pendientes: v || 0 })} />
          </Group>
          <Select label="Tipo de baja" allowDeselect={false} value={fin.tipo_baja} onChange={v => setFin({ ...fin, tipo_baja: v })} mb="md"
            data={[
              { value: 'renuncia', label: 'Renuncia (sin indemnización)' },
              { value: 'despido_justificado', label: 'Despido justificado (sin indemnización)' },
              { value: 'despido_injustificado', label: 'Despido injustificado (90 días + 20/año)' },
              { value: 'jubilacion', label: 'Jubilación (sin indemnización)' },
            ]} />
          <Group>
            <Button variant="default" onClick={calcularFin} disabled={!empId}>Calcular</Button>
            <Button color="red" onClick={pagarFin} disabled={!prevFin}>Pagar y dar de baja</Button>
          </Group>
          {prevFin && (
            <table style={{ width: '100%', marginTop: 14 }}><tbody>
              <tr><td className="text-muted" style={{ padding: '3px 0' }}>Antigüedad</td><td style={{ textAlign: 'right' }}>{prevFin.antiguedad_anios} año(s)</td></tr>
              <tr><td className="text-muted" style={{ padding: '3px 0' }}>Aguinaldo prop.</td><td style={{ textAlign: 'right' }}>{money(prevFin.aguinaldo)}</td></tr>
              <tr><td className="text-muted" style={{ padding: '3px 0' }}>Vacaciones prop.</td><td style={{ textAlign: 'right' }}>{money(prevFin.vacaciones_proporcional)}</td></tr>
              <tr><td className="text-muted" style={{ padding: '3px 0' }}>Prima vacacional</td><td style={{ textAlign: 'right' }}>{money(prevFin.prima_vacacional)}</td></tr>
              <tr><td className="text-muted" style={{ padding: '3px 0' }}>Días pendientes</td><td style={{ textAlign: 'right' }}>{money(prevFin.dias_pendientes)}</td></tr>
              {prevFin.indemnizacion > 0 && <tr><td className="text-muted" style={{ padding: '3px 0' }}>Indemnización</td><td style={{ textAlign: 'right' }}>{money(prevFin.indemnizacion)}</td></tr>}
              <tr style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: '6px 0', fontWeight: 700 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(prevFin.total)}</td></tr>
            </tbody></table>
          )}
        </Card>
      </div>

      {empId && (
        <Card withBorder radius="md" p="lg" className="card" mt="lg">
          <div className="card-header"><h3>Incapacidades (IMSS)</h3></div>
          <Text size="xs" c="dimmed" mb="sm">Los días registrados quedan fuera del salario normal en la nómina fiscal (el subsidio lo paga el IMSS; el contador lo concilia).</Text>
          <Group align="end" mb="sm">
            <Select label="Tipo" allowDeselect={false} value={inc.tipo} onChange={v => setInc({ ...inc, tipo: v })} style={{ width: 190 }}
              data={[{ value: 'enfermedad_general', label: 'Enfermedad general' }, { value: 'riesgo_trabajo', label: 'Riesgo de trabajo' }, { value: 'maternidad', label: 'Maternidad' }]} />
            <TextInput type="date" label="Desde" value={inc.desde} onChange={e => setInc({ ...inc, desde: e.target.value })} />
            <TextInput type="date" label="Hasta" value={inc.hasta} onChange={e => setInc({ ...inc, hasta: e.target.value })} />
            <TextInput label="Folio IMSS" value={inc.folio_imss} onChange={e => setInc({ ...inc, folio_imss: e.target.value })} />
            <Button onClick={registrarIncap}>Registrar</Button>
          </Group>
          <div className="table-wrap tabla-compacta">
            <table><tbody>
              {incaps.length === 0 && <tr><td className="empty">Sin incapacidades registradas</td></tr>}
              {incaps.map(x => (
                <tr key={x.id}>
                  <td>{x.tipo?.replace('_', ' ')}</td><td>{x.desde} → {x.hasta}</td><td className="text-muted">{x.folio_imss || '—'}</td>
                  <td><Button size="compact-xs" variant="subtle" color="red" onClick={() => borrarIncap(x.id)}>Quitar</Button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </Card>
      )}
    </div>
  );
}
