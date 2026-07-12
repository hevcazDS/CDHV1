import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, TextInput, Group, Button, Text } from '@mantine/core';
import { api } from '../../api';
import { exportarCSV } from '../../lib/csv';
import { confirmar, toastOk, toastErr } from '../../lib/ui';

// Facturación: pedidos con datos fiscales. Con el PAC activo (Prime > General),
// se timbra, descarga y cancela el CFDI directo aquí. Sin PAC, se exporta el CSV
// para un despacho externo (comportamiento anterior).
export default function FacturacionTab() {
  const qc = useQueryClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [r, setR] = useState({ desde: hace30, hasta: hoy });
  const [busy, setBusy] = useState(null);
  const { data } = useQuery({
    queryKey: ['fact-pend', r],
    queryFn: () => api.get(`/api/erp/facturacion-pendiente?desde=${r.desde}&hasta=${r.hasta}`),
  });
  const filas = data?.filas || [];
  const pacActivo = data?.pac_activo;

  const timbrar = async (f) => {
    setBusy(f.id_pedido);
    try {
      const res = await api.post(`/api/erp/timbrar/${f.id_pedido}`, {});
      if (res.ok) { toastOk('Timbrado ✅ ' + (res.uuid || '')); qc.invalidateQueries({ queryKey: ['fact-pend'] }); }
      else toastErr(res.motivo || res.error || 'No se pudo timbrar');
    } catch (e) { toastErr(e.message); } finally { setBusy(null); }
  };
  const cancelar = async (f) => {
    if (!await confirmar({ titulo: 'Cancelar CFDI', mensaje: `¿Cancelar el CFDI del folio ${f.folio} ante el SAT?` })) return;
    setBusy(f.id_pedido);
    try {
      const res = await api.post(`/api/erp/cfdi/${f.id_pedido}/cancelar`, { motivo: '02' });
      if (res.ok) { toastOk('CFDI cancelado'); qc.invalidateQueries({ queryKey: ['fact-pend'] }); }
      else toastErr(res.error);
    } catch (e) { toastErr(e.message); } finally { setBusy(null); }
  };
  const bajar = (f, fmt) => window.open(`/api/erp/cfdi/${f.id_pedido}/${fmt}`, '_blank');
  const rep = async (f) => {
    if (!await confirmar({ titulo: 'Complemento de pago (REP)', mensaje: `Timbrar el recibo electrónico de pago del folio ${f.folio}? (solo para facturas a plazos/PPD ya cobradas)` })) return;
    setBusy(f.id_pedido);
    try {
      const res = await api.post(`/api/erp/cfdi/${f.id_pedido}/rep`, {});
      if (res.ok) { toastOk('Complemento de pago timbrado ✅ ' + (res.uuid || '')); qc.invalidateQueries({ queryKey: ['fact-pend'] }); }
      else toastErr(res.error);
    } catch (e) { toastErr(e.message); } finally { setBusy(null); }
  };

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <div className="card-header">
        <h3>Facturación {pacActivo ? '(PAC activo)' : 'pendiente'}</h3>
        <Group gap="xs" align="end">
          <TextInput type="date" size="xs" value={r.desde} onChange={e => setR({ ...r, desde: e.target.value })} />
          <TextInput type="date" size="xs" value={r.hasta} onChange={e => setR({ ...r, hasta: e.target.value })} />
          <Button variant="default" size="xs" disabled={!filas.length}
            onClick={() => exportarCSV(`facturacion_${r.desde}_${r.hasta}`,
              ['folio', 'rfc', 'razon_social', 'monto', 'fecha', 'cfdi'],
              filas.map(f => [f.folio, f.rfc, f.razon_social || '', Number(f.monto || 0).toFixed(2), f.creado_en, f.cfdi_uuid || '']))}>
            Exportar (CSV)
          </Button>
        </Group>
      </div>
      <Text size="xs" c="dimmed" mb="sm">
        {pacActivo
          ? 'El PAC está activo: timbra, descarga y cancela el CFDI directo desde aquí.'
          : 'Sin PAC configurado: exporta el CSV para tu despacho, o configura el PAC (Facturapi) en Prime → General para timbrar directo.'}
      </Text>
      <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Folio</th><th>RFC</th><th>Razón social</th><th className="num">Monto</th><th>CFDI</th><th></th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={6} className="empty">Sin pedidos con datos fiscales en el rango</td></tr>}
            {filas.map((f) => {
              const timbrado = f.cfdi_uuid && f.cfdi_estatus !== 'cancelado';
              return (
                <tr key={f.id_pedido}>
                  <td><span className="folio">{f.folio}</span></td>
                  <td>{f.rfc}</td>
                  <td>{f.razon_social || '-'}</td>
                  <td className="num">${Number(f.monto || 0).toFixed(2)}</td>
                  <td>
                    {f.cfdi_estatus === 'cancelado'
                      ? <span className="badge badge-rojo">cancelado</span>
                      : timbrado ? <span className="badge badge-verde">timbrado</span>
                      : <span className="badge">sin timbrar</span>}
                  </td>
                  <td className="row-actions">
                    <Group gap={4} wrap="nowrap">
                      {pacActivo && !timbrado && f.cfdi_estatus !== 'cancelado' &&
                        <Button size="compact-xs" loading={busy === f.id_pedido} onClick={() => timbrar(f)}>Timbrar</Button>}
                      {timbrado && <>
                        <Button size="compact-xs" variant="default" onClick={() => bajar(f, 'pdf')}>PDF</Button>
                        <Button size="compact-xs" variant="default" onClick={() => bajar(f, 'xml')}>XML</Button>
                        <Button size="compact-xs" variant="default" loading={busy === f.id_pedido} onClick={() => rep(f)} title="Complemento de pago (facturas PPD cobradas)">REP</Button>
                        <Button size="compact-xs" variant="default" color="red" onClick={() => cancelar(f)}>Cancelar</Button>
                      </>}
                    </Group>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
