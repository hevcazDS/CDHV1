import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Card, Group, Title, ActionIcon, Table } from '@mantine/core';
import { api } from '../api';
import { fmt } from '../lib/format';
import { useTextoEmoji } from '../context/EmojiContext';

export default function Ofertas() {
  const txt = useTextoEmoji();

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['ofertas'],
    queryFn: () => api.get('/api/ofertas'),
  });

  return (
    <div>
      <div className="page-title">Ofertas</div>
      <div className="page-sub">Ofertas activas con precio rebajado</div>
      {error && <div className="login-error">No se pudieron cargar las ofertas: {error.message}</div>}

      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('🏷️ Ofertas activas')}</Title>
          <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Código</th><th>Producto</th><th>Descuento</th><th>Precio oferta</th><th>Vence</th><th>Usos</th></tr></thead>
            <tbody>
              {rows === undefined && <tr><td colSpan={6} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={6} className="empty">Sin ofertas activas</td></tr>}
              {rows?.map(r => (
                <tr key={r.id}>
                  <td><code>{r.codigo || '-'}</code></td>
                  <td style={{ fontSize: 12 }}>{r.nombre || '-'}</td>
                  <td><span className="badge badge-amarillo">-{r.valor || 0}{r.tipo === 'porcentaje' ? '%' : '$'}</span></td>
                  <td><strong>${fmt(r.precio_oferta)}</strong></td>
                  <td className="text-muted">{r.fecha_fin || 'Sin vencimiento'}</td>
                  <td>{r.usos_actual || 0}/{r.usos_max || '∞'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
