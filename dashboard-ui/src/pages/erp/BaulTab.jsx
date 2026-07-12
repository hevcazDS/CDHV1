import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Group, Text, TextInput } from '@mantine/core';
import { api } from '../../api';
import { fmt } from '../../lib/format';

// F5.4 — Baúl contable: archivero de CFDIs. Lista los timbrados del mes, marca
// cuáles ya están en la carpeta local, y exporta el mes por lote (.zip) para el
// contador. El archivado ocurre solo al timbrar (best-effort); aquí se consulta
// y se exporta. Requiere el módulo baul_contable_activo.
export default function BaulTab() {
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const { data } = useQuery({ queryKey: ['baul', mes], queryFn: () => api.get(`/api/erp/baul?mes=${mes}`) });
  const items = data?.items || [];
  const off = data && data.ok === false;

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <div className="card-header">
        <h3>Baúl contable (CFDI)</h3>
        <Group gap="xs" align="end">
          <TextInput type="month" size="xs" value={mes} onChange={e => setMes(e.target.value)} />
          <Button size="xs" variant="default" disabled={!items.length}
            onClick={() => window.open(`/api/erp/baul/exportar?mes=${mes}`, '_blank')}>
            Exportar lote (.zip)
          </Button>
        </Group>
      </div>
      {off ? (
        <Text size="sm" c="dimmed">Activa el módulo <strong>Baúl contable</strong> en Módulos para archivar y exportar tus CFDI.</Text>
      ) : (
        <>
          <Text size="xs" c="dimmed" mb="sm">
            Los CFDI se guardan en <code>contabilidad/cfdi/{mes}/</code> al timbrar. Aquí ves los del mes y los exportas en un solo .zip para tu contador.
          </Text>
          <Group gap="lg" mb="md">
            <div><Text size="xs" c="dimmed">CFDI del mes</Text><Text fw={700}>{data?.total || 0}</Text></div>
            <div><Text size="xs" c="dimmed">Archivados en disco</Text><Text fw={700} c="green">{data?.archivados || 0}</Text></div>
            <div><Text size="xs" c="dimmed">Monto</Text><Text fw={700}>${fmt(data?.monto)}</Text></div>
          </Group>
          <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Folio</th><th>RFC</th><th>Razón social</th><th className="num">Total</th><th>UUID</th><th>Archivo</th><th></th></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={7} className="empty">Sin CFDI timbrados en {mes}</td></tr>}
                {items.map(i => (
                  <tr key={i.id_pedido}>
                    <td><span className="folio">{i.folio}</span></td>
                    <td>{i.rfc || '—'}</td>
                    <td>{i.razon_social || '—'}</td>
                    <td className="num">${fmt(i.total)}</td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{(i.cfdi_uuid || '').slice(0, 8)}…</td>
                    <td>{i.archivado ? <span className="badge badge-verde">en disco</span> : <span className="badge badge-amarillo">al exportar</span>}</td>
                    <td className="row-actions">
                      <Group gap={4} wrap="nowrap">
                        <Button size="compact-xs" variant="default" onClick={() => window.open(`/api/erp/cfdi/${i.id_pedido}/pdf`, '_blank')}>PDF</Button>
                        <Button size="compact-xs" variant="default" onClick={() => window.open(`/api/erp/cfdi/${i.id_pedido}/xml`, '_blank')}>XML</Button>
                      </Group>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
