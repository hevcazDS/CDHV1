import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Indicator, ActionIcon, Menu, Text } from '@mantine/core';
import { Bell, Tag, Headset, TriangleAlert } from 'lucide-react';
import { api } from '../api';

// queryKey exportado para que Etiquetas.jsx pueda invalidarlo apenas el
// operador acepta/corrige una foto — así el número baja de inmediato en
// vez de esperar al siguiente poll de 30s.
export const ETIQUETAS_PENDIENTES_QUERY_KEY = ['etiquetas-pendientes-count'];

// Campana agregadora: junta los avisos accionables que antes vivían sueltos
// (banner de emails sobre Inicio, contador de Etiquetas, cola de atención) en
// un solo dropdown. Cada línea navega a donde se resuelve.
export default function NotificationBell() {
  const navigate = useNavigate();

  const { data: etq } = useQuery({
    queryKey: ETIQUETAS_PENDIENTES_QUERY_KEY,
    queryFn: () => api.get('/api/etiquetas/pendientes-count').catch(() => ({ count: 0 })),
    refetchInterval: 30000,
  });
  // Mismo queryKey que Inicio → React Query lo dedupe (sin fetch doble).
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/api/stats').catch(() => ({})),
    refetchInterval: 30000,
  });

  const avisos = [
    stats?.cola_atencion > 0 && { n: stats.cola_atencion, icono: Headset, color: 'var(--red)', texto: `${stats.cola_atencion} cliente(s) esperando atención`, a: '/cola' },
    etq?.count > 0 && { n: etq.count, icono: Tag, color: 'var(--accent)', texto: `${etq.count} foto(s) de Etiquetas por revisar`, a: '/etiquetas' },
    stats?.emails_error > 0 && { n: stats.emails_error, icono: TriangleAlert, color: '#e8a33d', texto: `${stats.emails_error} email(s) de confirmación con error — revisa SMTP`, a: '/notificaciones' },
  ].filter(Boolean);

  const total = avisos.reduce((s, a) => s + a.n, 0);

  return (
    <Menu position="bottom-end" width={300} shadow="md">
      <Menu.Target>
        <Indicator label={total > 99 ? '99+' : total} size={16} color="red" disabled={avisos.length === 0} offset={4}>
          <ActionIcon variant="default" size="lg" radius="md" title={avisos.length ? `${avisos.length} aviso(s)` : 'Sin pendientes'}>
            <Bell size={17} strokeWidth={1.75} />
          </ActionIcon>
        </Indicator>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Pendientes</Menu.Label>
        {avisos.length === 0 && <Text size="sm" c="dimmed" p="sm">Todo al día ✓</Text>}
        {avisos.map((a, i) => {
          const Icono = a.icono;
          return (
            <Menu.Item key={i} leftSection={<Icono size={15} color={a.color} strokeWidth={1.75} />} onClick={() => navigate(a.a)}>
              <Text size="sm">{a.texto}</Text>
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}
