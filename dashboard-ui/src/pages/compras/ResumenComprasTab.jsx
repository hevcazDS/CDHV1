// ResumenComprasTab — home del módulo Compras (Ola 3, patrón Odoo §B1):
// qué requiere acción HOY (OC abiertas, CxP por vencer/vencidas, solicitudes
// pendientes) con acceso directo a cada sección. Reusa los endpoints
// existentes — cero backend nuevo.
import { useQuery } from '@tanstack/react-query';
import { Card } from '@mantine/core';
import { api } from '../../api';
import { money } from '../../lib/format';

function Kpi({ valor, label, alerta, onClick }) {
  return (
    <Card withBorder radius="md" p="lg" className="kpi-card" onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', borderColor: alerta ? 'var(--red)' : undefined }}>
      <div className="kpi-value">{valor}</div>
      <div className="kpi-label">{label}</div>
    </Card>
  );
}

export default function ResumenComprasTab({ irA }) {
  const { data: ocs = [] } = useQuery({ queryKey: ['erp-ocs'], queryFn: () => api.get('/api/erp/ordenes-compra') });
  const { data: cxp = [] } = useQuery({ queryKey: ['erp-cxp'], queryFn: () => api.get('/api/erp/cxp') });
  const { data: solicitudes = [] } = useQuery({ queryKey: ['compras-sol'], queryFn: () => api.get('/api/compras/solicitudes') });

  const abiertas = ocs.filter(o => o.estatus === 'abierta');
  const montoAbiertas = abiertas.reduce((s, o) => s + (o.total || 0), 0);
  const cxpPend = cxp.filter(c => c.estatus !== 'pagada');
  const vencidas = cxpPend.filter(c => c.dias_para_vencer != null && c.dias_para_vencer < 0);
  const porVencer7 = cxpPend.filter(c => c.dias_para_vencer != null && c.dias_para_vencer >= 0 && c.dias_para_vencer <= 7);
  const solPend = solicitudes.filter(s => s.estatus === 'pendiente');

  return (
    <div>
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <Kpi valor={abiertas.length} label={`OC abiertas · ${money(montoAbiertas)}`} onClick={() => irA('ordenes')} />
        <Kpi valor={vencidas.length} label="Facturas VENCIDAS sin pagar" alerta={vencidas.length > 0} onClick={() => irA('cxp')} />
        <Kpi valor={porVencer7.length} label="Por vencer esta semana" onClick={() => irA('cxp')} />
        <Kpi valor={solPend.length} label="Solicitudes por aprobar" alerta={solPend.length > 0} onClick={() => irA('solicitudes')} />
      </div>
      <div className="cols-2">
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>OC abiertas (por recibir)</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Folio</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Total</th><th>Llegada est.</th></tr></thead>
              <tbody>
                {abiertas.length === 0 && <tr><td colSpan={4} className="empty">Nada por recibir<span className="empty-accion">Crea una OC en “Órdenes de compra”</span></td></tr>}
                {abiertas.slice(0, 6).map(o => (
                  <tr key={o.id}>
                    <td><span className="folio">{o.folio}</span></td>
                    <td>{o.proveedor}</td>
                    <td className="num">{money(o.total)}</td>
                    <td className="text-muted">{o.fecha_llegada_est || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Próximos pagos a proveedor</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Proveedor</th><th style={{ textAlign: 'right' }}>Monto</th><th>Vence</th></tr></thead>
              <tbody>
                {cxpPend.length === 0 && <tr><td colSpan={3} className="empty">Sin cuentas por pagar 🎉</td></tr>}
                {cxpPend.slice(0, 6).map(c => (
                  <tr key={c.id}>
                    <td>{c.proveedor}</td>
                    <td className="num">{money(c.monto)}</td>
                    <td style={{ color: c.dias_para_vencer < 0 ? 'var(--red)' : c.dias_para_vencer <= 7 ? 'var(--yellow)' : 'var(--text-dim)' }}>
                      {c.dias_para_vencer < 0 ? `vencida hace ${-c.dias_para_vencer} d` : c.dias_para_vencer === 0 ? 'HOY' : `en ${c.dias_para_vencer} d`}
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
