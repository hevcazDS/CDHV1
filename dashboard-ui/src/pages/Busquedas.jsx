import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Card, Group, Title, ActionIcon, Table } from '@mantine/core';
import { api } from '../api';
import { fdate } from '../lib/format';
import { useTextoEmoji } from '../context/EmojiContext';

export default function Busquedas() {
  const txt = useTextoEmoji();

  const { data: filas, refetch } = useQuery({
    queryKey: ['busquedas'],
    queryFn: () => api.get('/api/busquedas').catch(() => []),
  });

  return (
    <div>
      <div className="page-title">Búsquedas</div>
      <div className="page-sub">Términos que los clientes buscan en el bot</div>

      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('🔍 Log de búsquedas')}</Title>
          <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Término buscado</th><th>Veces</th><th>Compras</th><th>Última búsqueda</th></tr></thead>
            <tbody>
              {filas === undefined && <tr><td colSpan={4} className="empty">Cargando...</td></tr>}
              {filas?.length === 0 && <tr><td colSpan={4} className="empty">Sin búsquedas registradas</td></tr>}
              {filas?.map((r, i) => (
                <tr key={i}>
                  <td>{r.busqueda}</td>
                  <td><strong>{r.veces}</strong></td>
                  <td>{r.compras != null ? r.compras : <span className="text-muted">—</span>}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.ultima_vez)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
