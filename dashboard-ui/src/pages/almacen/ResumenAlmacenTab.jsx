// ResumenAlmacenTab — home del módulo Almacén (Ola 3, patrón Odoo §B1):
// stock crítico/agotados y llegadas próximas, con la lista de lo que urge
// resurtir. Reusa /api/almacen/inventario y /api/erp/ordenes-compra (el área
// almacén ya puede leer ambas) — cero backend nuevo.
import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Text } from '@mantine/core';
import { api } from '../../api';
import { useTextoEmoji } from '../../context/EmojiContext';
const BarraApilada = lazy(() => import('../../components/MiniCharts').then(m => ({ default: m.BarraApilada })));

function Kpi({ valor, label, alerta }) {
  return (
    <Card withBorder radius="md" p="lg" className="kpi-card" style={{ borderColor: alerta ? 'var(--red)' : undefined }}>
      <div className="kpi-value">{valor}</div>
      <div className="kpi-label">{label}</div>
    </Card>
  );
}

export default function ResumenAlmacenTab() {
  const txt = useTextoEmoji();
  const { data: inv = [] } = useQuery({ queryKey: ['almacen-inv'], queryFn: () => api.get('/api/almacen/inventario') });
  const { data: ocs = [] } = useQuery({ queryKey: ['erp-ocs'], queryFn: () => api.get('/api/erp/ordenes-compra').catch(() => []) });

  const conMinimo = inv.filter(r => (r.stock_minimo || 0) > 0);
  const agotados = conMinimo.filter(r => (r.stock || 0) === 0);
  const criticos = conMinimo.filter(r => (r.stock || 0) > 0 && r.stock <= r.stock_minimo);
  const sinUbicar = inv.filter(r => (r.stock || 0) > 0 && !r.zona && !r.pasillo && !r.rack).length;
  const llegadas = ocs.filter(o => o.estatus === 'abierta' && o.fecha_llegada_est);

  return (
    <div>
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <Kpi valor={agotados.length} label="Agotados (con mínimo definido)" alerta={agotados.length > 0} />
        <Kpi valor={criticos.length} label="En stock crítico (≤ mínimo)" alerta={criticos.length > 0} />
        <Kpi valor={llegadas.length} label="OC con llegada programada" />
        <Kpi valor={sinUbicar} label="Con stock sin ubicación física" />
      </div>
      {conMinimo.length > 0 && (
        <Card withBorder radius="md" p="md" className="card" style={{ marginBottom: 20 }}>
          <Text size="xs" c="dimmed" mb={6}>Composición del inventario vigilado (productos con mínimo definido)</Text>
          <Suspense fallback={null}>
            <BarraApilada fmtValor={(v) => v + ' prod'} segmentos={[
              { name: 'Agotado', value: agotados.length, color: 'var(--red)' },
              { name: 'Crítico', value: criticos.length, color: 'var(--yellow)' },
              { name: 'Sano', value: conMinimo.length - agotados.length - criticos.length, color: 'var(--green)' },
            ]} />
          </Suspense>
        </Card>
      )}
      <div className="cols-2">
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Urge resurtir</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Producto</th><th>Sucursal</th><th className="num">Stock</th><th className="num">Mínimo</th></tr></thead>
              <tbody>
                {agotados.length + criticos.length === 0 && <tr><td colSpan={4} className="empty">{txt('Nada en crítico 🎉')}<span className="empty-accion">Define mínimos por producto en Inventario para vigilarlos aquí</span></td></tr>}
                {[...agotados, ...criticos].slice(0, 8).map((r, i) => (
                  <tr key={i}>
                    <td><strong>{r.name}</strong></td>
                    <td className="text-muted">{r.sucursal}</td>
                    <td className="num" style={{ color: r.stock === 0 ? 'var(--red)' : 'var(--yellow)', fontWeight: 700 }}>{r.stock}</td>
                    <td className="num text-muted">{r.stock_minimo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Mercancía por llegar</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>OC</th><th>Proveedor</th><th>Llega</th><th>Destino</th></tr></thead>
              <tbody>
                {llegadas.length === 0 && <tr><td colSpan={4} className="empty">Sin llegadas programadas<span className="empty-accion">Las OC con fecha estimada aparecen aquí y en el Calendario</span></td></tr>}
                {llegadas.slice(0, 8).map(o => (
                  <tr key={o.id}>
                    <td><span className="folio">{o.folio}</span></td>
                    <td>{o.proveedor}</td>
                    <td>{o.fecha_llegada_est}</td>
                    <td className="text-muted">{o.sucursal_destino || 'sesión/default'}</td>
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
