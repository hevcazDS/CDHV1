import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Indicator, ActionIcon } from '@mantine/core';
import { api } from '../api';

// queryKey exportado para que Etiquetas.jsx pueda invalidarlo apenas el
// operador acepta/corrige una foto — así el número baja de inmediato en
// vez de esperar al siguiente poll de 30s.
export const ETIQUETAS_PENDIENTES_QUERY_KEY = ['etiquetas-pendientes-count'];

export default function NotificationBell() {
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ETIQUETAS_PENDIENTES_QUERY_KEY,
    queryFn: () => api.get('/api/etiquetas/pendientes-count').catch(() => ({ count: 0 })),
    refetchInterval: 30000,
  });

  const count = data?.count || 0;

  return (
    <Indicator label={count > 99 ? '99+' : count} size={16} color="red" disabled={count === 0} offset={4}>
      <ActionIcon
        variant="default" size="lg" radius="md"
        title={count > 0 ? `${count} foto(s) de Etiquetas pendientes de revisión` : 'Sin pendientes'}
        onClick={() => navigate('/etiquetas')}
      >
        🔔
      </ActionIcon>
    </Indicator>
  );
}
