import { useQuery } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table } from '@mantine/core';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { useEmojisActivos, useTextoEmoji } from '../context/EmojiContext';

const MEDALLA = ['🥇', '🥈', '🥉'];

export default function Ranking() {
  const txt = useTextoEmoji();
  const emojisOn = useEmojisActivos();

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['ranking-puntos'],
    queryFn: () => api.get('/api/puntos/ranking'),
  });

  return (
    <div>
      <div className="page-title">Ranking</div>
      <div className="page-sub">Top clientes por puntos de lealtad</div>
      {error && <div className="login-error">No se pudo cargar el ranking: {error.message}</div>}

      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('🏆 Top clientes por puntos')}</Title>
          <ActionIcon variant="default" onClick={() => refetch()}>🔄</ActionIcon>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>#</th><th>Cliente</th><th>Teléfono</th><th>Puntos ganados</th><th>Disponibles</th><th>Canjeados</th><th>Último mov.</th></tr></thead>
            <tbody>
              {rows === undefined && <tr><td colSpan={7} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={7} className="empty">Sin datos de puntos aún</td></tr>}
              {rows?.map((r, i) => (
                <tr key={i}>
                  <td><strong>{(emojisOn && MEDALLA[i]) || i + 1}</strong></td>
                  <td>{r.nombre || '-'}</td>
                  <td><code style={{ fontSize: 11 }}>{soloTelefono(r.telefono)}</code></td>
                  <td>{r.puntos_ganados || 0}</td>
                  <td><strong style={{ color: 'var(--accent)' }}>{r.disponibles || 0}</strong></td>
                  <td>{r.puntos_canjeados || 0}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{fdate(r.ultimo_movimiento)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
