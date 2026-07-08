import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Text } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import { fdate } from '../../lib/format';

export default function CxpTab() {
  const qc = useQueryClient();
  const { data: cxp = [] } = useQuery({ queryKey: ['erp-cxp'], queryFn: () => api.get('/api/erp/cxp') });

  const pagar = useMutation({
    mutationFn: (id) => api.post(`/api/erp/cxp/${id}/pagar`, { referencia: '' }),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      qc.invalidateQueries({ queryKey: ['erp-cxp'] });
    },
    onError: handleApiError,
  });

  const pendientes = cxp.filter(x => x.estatus === 'pendiente');
  const totalPendiente = pendientes.reduce((s, x) => s + Number(x.monto || 0), 0);
  const vencidas = pendientes.filter(x => x.dias_para_vencer < 0).length;

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <div className="card-header">
        <h3>Cuentas por pagar</h3>
        <Text size="sm" c="dimmed">
          <strong>${totalPendiente.toFixed(2)}</strong> pendiente{vencidas > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}> · {vencidas} vencida{vencidas === 1 ? '' : 's'}</span>}
        </Text>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Proveedor</th><th>OC</th><th>Monto</th><th>Vence</th><th>Estatus</th><th></th></tr></thead>
          <tbody>
            {cxp.length === 0 && <tr><td colSpan={6} className="empty">Sin cuentas por pagar — se generan al recibir una OC</td></tr>}
            {cxp.map(x => (
              <tr key={x.id}>
                <td><strong>{x.proveedor}</strong></td>
                <td className="text-muted">{x.folio_oc || '-'}</td>
                <td>${Number(x.monto).toFixed(2)}</td>
                <td style={x.estatus === 'pendiente' && x.dias_para_vencer < 0 ? { color: 'var(--red)', fontWeight: 700 } : undefined}>
                  {x.vence_en || '-'}{x.estatus === 'pendiente' && Number.isFinite(x.dias_para_vencer) && (
                    <span className="text-muted" style={{ fontSize: 11 }}> ({x.dias_para_vencer < 0 ? Math.abs(x.dias_para_vencer) + 'd vencida' : 'en ' + x.dias_para_vencer + 'd'})</span>
                  )}
                </td>
                <td><span className={`badge ${x.estatus === 'pagada' ? 'badge-verde' : 'badge-amarillo'}`}>{x.estatus}</span></td>
                <td>{x.estatus === 'pendiente' && (
                  <Button size="xs" variant="default" onClick={() => pagar.mutate(x.id)} disabled={pagar.isPending}>Marcar pagada</Button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
