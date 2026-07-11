import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Card, Group, Title, ActionIcon, Table, Button } from '@mantine/core';
import { api } from '../api';
import { fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { confirmar, toastOk } from '../lib/ui';
import { useTextoEmoji } from '../context/EmojiContext';

export default function ListaEspera() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();

  const { data: lista, error, refetch } = useQuery({
    queryKey: ['lista-espera'],
    queryFn: () => api.get('/api/lista-espera').then(d => d.lista || []),
  });

  const notificarMutation = useMutation({
    mutationFn: (idProducto) => api.post(`/api/notificar-lista/${idProducto}`),
    onSuccess: (r) => {
      toastOk(txt(`✅ ${r.notificados || 0} notificados`));
      queryClient.invalidateQueries({ queryKey: ['lista-espera'] });
    },
    onError: (e) => { handleApiError(e, 'Error al notificar'); queryClient.invalidateQueries({ queryKey: ['lista-espera'] }); },
  });
  const notificar = async (idProducto, total) => {
    if (!await confirmar({ mensaje: `¿Notificar a ${total || 0} persona(s) que este producto ya tiene stock?`, textoOk: 'Notificar' })) return;
    notificarMutation.mutate(idProducto);
  };

  return (
    <div>
      <div className="page-title">Lista de Espera</div>
      <div className="page-sub">Clientes esperando que vuelva el stock</div>
      {error && <div className="login-error">No se pudo cargar la lista de espera: {error.message}</div>}

      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('🔔 Lista de espera')}</Title>
          <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Producto</th><th>Precio</th><th>Stock</th><th>En espera</th><th>Acción</th></tr></thead>
            <tbody>
              {lista === undefined && <tr><td colSpan={5} className="empty">Cargando...</td></tr>}
              {lista?.length === 0 && <tr><td colSpan={5} className="empty">Sin clientes en espera</td></tr>}
              {lista?.map((p, i) => {
                const conStock = p.stock_tienda > 0 || p.stock_cedis > 0;
                const n = p.esperas ? p.esperas.length : 0;
                const idProducto = p.esperas?.[0]?.id_producto || 0;
                return (
                  <tr key={i}>
                    <td><strong>{p.nombre || '-'}</strong></td>
                    <td>${fmt(p.precio)}</td>
                    <td><span className={`badge badge-${conStock ? 'verde' : 'rojo'}`}>{conStock ? 'Con stock' : 'Sin stock'}</span></td>
                    <td><strong>{n}</strong> personas</td>
                    <td><Button variant="light" color="teal" size="xs" onClick={() => notificar(idProducto, n)}>{txt('📲 Notificar')}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
