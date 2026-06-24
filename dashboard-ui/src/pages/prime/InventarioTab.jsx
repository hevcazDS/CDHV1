// InventarioTab.jsx — Tab "Inventario" de Prime: stock por producto+sucursal
// (tabla `inventarios`, con filtro por sucursal y paginación) + historial de
// movimientos (auditoría de altas/ajustes).
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Title, Group, Tabs, Select, TextInput, Table, NumberInput, Button, Badge, Pagination } from '@mantine/core';
import { api } from '../../api';

export default function InventarioTab() {
  const queryClient = useQueryClient();
  const [vistaInventario, setVistaInventario] = useState('stock');
  const [buscarInventario, setBuscarInventario] = useState('');
  const [sucursalInventario, setSucursalInventario] = useState('');
  const [paginaInventario, setPaginaInventario] = useState(1);
  const [editandoMinimo, setEditandoMinimo] = useState({});
  const [msgInventario, setMsgInventario] = useState('');
  const [paginaMovimientos, setPaginaMovimientos] = useState(1);

  const { data: sucursales = [] } = useQuery({
    queryKey: ['prime-sucursales'],
    queryFn: () => api.get('/api/prime/sucursales'),
  });

  const { data: inventariosResp } = useQuery({
    queryKey: ['prime-inventarios', buscarInventario, sucursalInventario, paginaInventario],
    queryFn: () => {
      const params = new URLSearchParams();
      if (buscarInventario) params.set('q', buscarInventario);
      if (sucursalInventario) params.set('sucursal', sucursalInventario);
      params.set('pagina', String(paginaInventario));
      return api.get(`/api/prime/inventarios?${params.toString()}`);
    },
  });
  const inventarios = inventariosResp?.items || [];
  const totalPaginasInventario = Math.max(1, Math.ceil((inventariosResp?.total || 0) / (inventariosResp?.porPagina || 30)));

  const { data: movimientosResp } = useQuery({
    queryKey: ['prime-inventario-movimientos', sucursalInventario, paginaMovimientos],
    queryFn: () => {
      const params = new URLSearchParams();
      if (sucursalInventario) params.set('sucursal', sucursalInventario);
      params.set('pagina', String(paginaMovimientos));
      return api.get(`/api/prime/inventario-movimientos?${params.toString()}`);
    },
    enabled: vistaInventario === 'historial',
  });
  const movimientos = movimientosResp?.items || [];
  const totalPaginasMovimientos = Math.max(1, Math.ceil((movimientosResp?.total || 0) / (movimientosResp?.porPagina || 30)));

  const guardarStockMinimoMutation = useMutation({
    mutationFn: ({ id, valor }) => api.put(`/api/prime/inventarios/${id}`, { stock_minimo: valor }),
    onSuccess: (_, { id }) => {
      setEditandoMinimo(prev => { const next = { ...prev }; delete next[id]; return next; });
      queryClient.invalidateQueries({ queryKey: ['prime-inventarios'] });
    },
    onError: (e) => setMsgInventario(e.message),
  });
  const guardarStockMinimo = (id) => {
    setMsgInventario('');
    const valor = Number(editandoMinimo[id]);
    if (!Number.isFinite(valor) || valor < 0) { setMsgInventario('stock_minimo inválido'); return; }
    guardarStockMinimoMutation.mutate({ id, valor });
  };

  return (
    <Card withBorder radius="md" p="lg">
      <Group justify="space-between" mb={4} wrap="wrap">
        <Title order={4}>Inventario</Title>
        <Tabs value={vistaInventario} onChange={setVistaInventario}>
          <Tabs.List>
            <Tabs.Tab value="stock">Stock</Tabs.Tab>
            <Tabs.Tab value="historial">Historial de movimientos</Tabs.Tab>
          </Tabs.List>
        </Tabs>
      </Group>

      {vistaInventario === 'stock' ? (
        <>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Elige una sucursal para acotar la vista (con {sucursales.length || 11} sucursales y cientos
            de productos, mostrar todo de golpe no es manejable). La columna "Stock mínimo" es el umbral
            que dispara la alerta automática al asesor cuando el stock cae a ese nivel o menos; en 0, la
            alerta queda desactivada para esa fila.
          </p>
          {msgInventario && <div className="login-error" style={{ marginBottom: 12 }}>{msgInventario}</div>}
          <Group gap="xs" mb="md" wrap="wrap">
            <Select
              placeholder="Todas las sucursales"
              data={sucursales.map(s => ({ value: s.nombre, label: s.nombre }))}
              value={sucursalInventario || null}
              onChange={v => { setSucursalInventario(v || ''); setPaginaInventario(1); setPaginaMovimientos(1); }}
              clearable
              style={{ minWidth: 220 }}
            />
            <TextInput
              placeholder="Buscar producto..."
              value={buscarInventario}
              onChange={e => { setBuscarInventario(e.target.value); setPaginaInventario(1); }}
              style={{ flex: 1, minWidth: 200 }}
            />
          </Group>
          <div className="table-wrap">
            <Table highlightOnHover verticalSpacing="xs">
              <thead><tr><th>Producto</th><th>Sucursal</th><th>Stock</th><th>Stock mínimo</th><th></th></tr></thead>
              <tbody>
                {inventarios.length === 0 && <tr><td colSpan={5} className="empty">Sin resultados</td></tr>}
                {inventarios.map(i => (
                  <tr key={i.id}>
                    <td>{i.producto}</td>
                    <td>{i.sucursal}</td>
                    <td>{i.stock}</td>
                    <td>
                      <NumberInput
                        min={0}
                        size="xs"
                        style={{ width: 90 }}
                        value={Number(editandoMinimo[i.id] ?? i.stock_minimo)}
                        onChange={v => setEditandoMinimo(prev => ({ ...prev, [i.id]: v }))}
                      />
                    </td>
                    <td><Button size="xs" variant="default" onClick={() => guardarStockMinimo(i.id)}>Guardar</Button></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {totalPaginasInventario > 1 && (
            <Group justify="center" mt="md">
              <Pagination total={totalPaginasInventario} value={paginaInventario} onChange={setPaginaInventario} size="sm" />
            </Group>
          )}
        </>
      ) : (
        <>
          <p className="page-sub" style={{ margin: '4px 0 16px' }}>
            Quién y cuándo se dio de alta cada producto en cada sucursal, o se ajustó su stock
            mínimo (auditoría — inspirado en StockItemTracking de InvenTree). El filtro de
            sucursal de arriba también aplica aquí.
          </p>
          <div className="table-wrap">
            <Table highlightOnHover verticalSpacing="xs">
              <thead><tr><th>Fecha</th><th>Producto</th><th>Sucursal</th><th>Tipo</th><th>Antes</th><th>Después</th><th>Por</th></tr></thead>
              <tbody>
                {movimientos.length === 0 && <tr><td colSpan={7} className="empty">Sin movimientos registrados</td></tr>}
                {movimientos.map(m => (
                  <tr key={m.id}>
                    <td>{m.creado_en}</td>
                    <td>{m.producto || `#${m.id_producto}`}</td>
                    <td>{m.sucursal}</td>
                    <td>
                      <Badge color={m.tipo === 'alta' ? 'teal' : 'blue'} variant="light">
                        {m.tipo === 'alta' ? 'alta' : m.tipo === 'ajuste_minimo' ? 'ajuste mínimo' : 'ajuste stock'}
                      </Badge>
                    </td>
                    <td>{m.cantidad_anterior ?? '-'}</td>
                    <td>{m.cantidad_nueva ?? '-'}</td>
                    <td>{m.creado_por || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {totalPaginasMovimientos > 1 && (
            <Group justify="center" mt="md">
              <Pagination total={totalPaginasMovimientos} value={paginaMovimientos} onChange={setPaginaMovimientos} size="sm" />
            </Group>
          )}
        </>
      )}
    </Card>
  );
}
