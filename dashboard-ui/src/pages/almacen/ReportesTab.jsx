import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Title, Text, Table } from '@mantine/core';
import { api } from '../../api';
import { fmt, money } from '../../lib/format';
import { prompt as pedir, toastOk } from '../../lib/ui';
import { handleApiError } from '../../lib/apiError';
import { useTextoEmoji } from '../../context/EmojiContext';

// Tres reportes que el gerente tomaba a ciegas (comité de usuarios), todos
// lectura pura desde GET /api/gerente/reportes: stock bajo mínimo, margen por
// producto vs volumen, y productos muertos (stock sin venta en 90 días). El
// margen permite capturar el costo faltante inline (los sin costo van arriba).
export default function ReportesTab() {
  const txt = useTextoEmoji();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['gerente-reportes'],
    queryFn: () => api.get('/api/gerente/reportes').catch(() => null),
  });
  const guardarCosto = useMutation({
    mutationFn: ({ id, costo }) => api.put('/api/prime/productos/' + id, { costo }),
    onSuccess: () => { toastOk('Costo actualizado'); qc.invalidateQueries({ queryKey: ['gerente-reportes'] }); },
    onError: handleApiError,
  });
  const capturarCosto = async (m) => {
    const v = await pedir({ titulo: 'Costo de ' + m.name, mensaje: 'Costo de adquisición (precio de venta: $' + fmt(m.price) + ')', valorInicial: m.costo ? String(m.costo) : '', tipo: 'text' });
    if (v == null || v === '') return;
    const costo = Number(v);
    if (!(costo >= 0)) return;
    guardarCosto.mutate({ id: m.id, costo });
  };
  const stockBajo = data?.stock_bajo || [];
  const margen = data?.margen || [];
  const muertos = data?.muertos || [];

  // Auditoría de cobertura: los endpoints existían sin front — la merma se
  // registraba (salida) pero nadie podía ver su costo; las caducidades se
  // capturaban en la entrada y no se consultaban en ningún lado.
  const { data: mermas } = useQuery({
    queryKey: ['almacen-mermas'],
    queryFn: () => api.get('/api/almacen/mermas').catch(() => null),
  });
  const { data: caducidades } = useQuery({
    queryKey: ['almacen-caducidades'],
    queryFn: () => api.get('/api/almacen/caducidades?dias=30').catch(() => null),
  });

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Card withBorder radius="md" p="lg">
        <Title order={5} mb="xs">{txt('🔴 Stock bajo mínimo')}</Title>
        <Text size="xs" c="dimmed" mb="sm">Productos en o por debajo del mínimo configurado — reordena antes de quedarte sin venta.</Text>
        {stockBajo.length === 0 ? <Text size="sm" c="dimmed">{txt('Nada bajo mínimo. 👍')}</Text> : (
          <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Producto</th><th>Sucursal</th><th>Stock</th><th>Mínimo</th><th>Faltante</th></tr></thead>
              <tbody>
                {stockBajo.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}</td><td>{s.sucursal}</td>
                    <td style={{ fontWeight: 700, color: s.stock === 0 ? 'var(--red)' : 'var(--yellow)' }}>{s.stock}</td>
                    <td>{s.stock_minimo}</td><td><strong>{Math.max(0, s.stock_minimo - s.stock)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={5} mb="xs">{txt('💰 Margen por producto (últimos 30 días)')}</Title>
        <Text size="xs" c="dimmed" mb="sm">Precio vs costo y unidades vendidas. Margen bajo + mucho volumen = revisa precio o proveedor.</Text>
        {margen.length === 0 ? <Text size="sm" c="dimmed">Aún no hay productos activos.</Text> : (
          <div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Producto</th><th>Precio</th><th>Costo</th><th>Margen</th><th>Margen %</th><th>Vendidos 30d</th></tr></thead>
              <tbody>
                {margen.map((m, i) => (
                  <tr key={i}>
                    <td>{m.name}</td><td>{money(m.price)}</td>
                    <td onClick={() => capturarCosto(m)} title="Clic para capturar/editar el costo" style={{ cursor: 'pointer', color: m.sin_costo ? 'var(--accent)' : undefined, textDecoration: m.sin_costo ? 'underline dotted' : undefined }}>
                      {m.sin_costo ? '+ capturar' : money(m.costo)}
                    </td>
                    <td>{m.margen != null ? money(m.margen) : '—'}</td>
                    <td style={{ fontWeight: 700, color: m.margen_pct == null ? 'var(--text-mute)' : m.margen_pct < 15 ? 'var(--red)' : m.margen_pct < 30 ? 'var(--yellow)' : 'var(--green)' }}>{m.margen_pct != null ? m.margen_pct + '%' : '—'}</td>
                    <td><strong>{m.vendidos_30d}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={5} mb="xs">{txt('🪦 Productos muertos (con stock, sin venta en 90 días)')}</Title>
        <Text size="xs" c="dimmed" mb="sm">Dinero parado en anaquel. Candidatos a promoción, liquidación o baja de catálogo.</Text>
        {muertos.length === 0 ? <Text size="sm" c="dimmed">{txt('Todo tu inventario con stock ha rotado en los últimos 90 días. 👍')}</Text> : (
          <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Producto</th><th>Stock</th><th>Precio</th><th>Valor parado</th></tr></thead>
              <tbody>
                {muertos.map((m, i) => (
                  <tr key={i}>
                    <td>{m.name}</td><td><strong>{m.stock}</strong></td><td>{money(m.price)}</td>
                    <td style={{ color: 'var(--text-mute)' }}>{money((m.stock || 0) * (m.price || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={5} mb="xs">{txt('🗑️ Mermas del mes (con costo)')}</Title>
        <Text size="xs" c="dimmed" mb="sm">Lo que se perdió por caducidad, daño, robo o ajuste — y cuánto costó.</Text>
        {(mermas?.filas || []).length === 0 ? <Text size="sm" c="dimmed">{txt('Sin mermas registradas este mes. 👍')}</Text> : (
          <>
            <Text size="sm" mb="xs">Costo total: <strong style={{ color: 'var(--red)' }}>{money(mermas.costo_total)}</strong>
              {(mermas.resumen || []).map(r => <Text key={r.tipo} span size="xs" c="dimmed"> · {r.tipo}: {money(r.costo)} ({r.eventos})</Text>)}
            </Text>
            <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
              <Table verticalSpacing="xs">
                <thead><tr><th>Producto</th><th>Sucursal</th><th>Motivo</th><th>Cantidad</th><th>Costo</th><th>Fecha</th></tr></thead>
                <tbody>
                  {mermas.filas.map((f, i) => (
                    <tr key={i}>
                      <td>{f.name}</td><td>{f.sucursal}</td><td style={{ fontSize: 12 }}>{f.motivo}</td>
                      <td><strong>{f.cantidad}</strong></td><td style={{ color: 'var(--red)' }}>{money(f.costo)}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-mute)' }}>{(f.creado_en || '').slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={5} mb="xs">{txt('⏳ Caducidades próximas (30 días)')}</Title>
        <Text size="xs" c="dimmed" mb="sm">Entradas con caducidad registrada que vencen pronto y aún tienen stock — promociónalo antes de que se vuelva merma.</Text>
        {(caducidades?.filas || []).length === 0 ? <Text size="sm" c="dimmed">{txt('Nada por caducar en 30 días. 👍')}</Text> : (
          <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
            <Table verticalSpacing="xs">
              <thead><tr><th>Producto</th><th>Sucursal</th><th>Lote</th><th>Caduca</th><th>Días</th><th>Stock actual</th></tr></thead>
              <tbody>
                {caducidades.filas.map((f, i) => (
                  <tr key={i}>
                    <td>{f.name}</td><td>{f.sucursal}</td><td style={{ fontSize: 12 }}>{f.lote || '—'}</td>
                    <td>{f.caducidad}</td>
                    <td style={{ fontWeight: 700, color: f.dias_restantes <= 7 ? 'var(--red)' : 'var(--yellow)' }}>{f.dias_restantes}</td>
                    <td>{f.stock_actual}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
