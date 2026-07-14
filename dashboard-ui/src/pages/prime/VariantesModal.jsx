import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, TextInput, NumberInput, Group, Text } from '@mantine/core';
import Modal from '../../components/Modal';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import { toastOk } from '../../lib/ui';

// Matriz talla×color con stock POR SUCURSAL. Guardar recalcula el stock
// agregado del producto vía kardex (auditable). Quitar una fila la inactiva.
export default function VariantesModal({ producto, onClose }) {
  const { data: sucursales = [] } = useQuery({ queryKey: ['prime-sucursales'], queryFn: () => api.get('/api/prime/sucursales') });
  const { data: matriz } = useQuery({
    queryKey: ['variantes', producto.id],
    queryFn: () => api.get('/api/prime/variantes/' + producto.id),
  });
  const [filas, setFilas] = useState(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (matriz && filas === null) setFilas(matriz.filter(v => v.activo)); }, [matriz, filas]);

  const nombres = sucursales.map(s => s.nombre);
  const set = (i, campo, v) => setFilas(f => f.map((x, j) => j === i ? { ...x, [campo]: v } : x));
  const setStock = (i, suc, v) => setFilas(f => f.map((x, j) => j === i ? { ...x, stocks: { ...x.stocks, [suc]: v } } : x));

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await api.post('/api/prime/variantes/' + producto.id, { filas });
      if (!r.ok) throw new Error(r.error);
      toastOk(`Guardado: ${r.variantes} variante(s). El stock del producto se recalculó con kardex.`);
      onClose();
    } catch (e) { handleApiError(e); } finally { setGuardando(false); }
  };

  return (
    <Modal title={`Tallas y colores — ${producto.name}`} onClose={onClose}
      actions={<>
        <Button variant="default" onClick={onClose}>Cerrar</Button>
        <Button onClick={guardar} loading={guardando} disabled={!filas}>Guardar matriz</Button>
      </>}>
      <Text size="xs" c="dimmed" mb="sm">
        Cada fila es una combinación (talla/color) con su stock EN CADA SUCURSAL. El stock total del producto
        se mantiene como la suma y queda auditado en el kardex. UPC/SKU propios permiten escanearla directo en el POS.
      </Text>
      {!filas ? <div className="empty cargando">Cargando...</div> : (
        <div className="table-wrap" style={{ maxHeight: 380, overflow: 'auto' }}>
          <table>
            <thead><tr><th>Talla</th><th>Color</th><th>SKU</th><th>UPC</th>{nombres.map(n => <th key={n}>{n}</th>)}<th></th></tr></thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={5 + nombres.length} className="empty">Sin variantes — agrega la primera</td></tr>}
              {filas.map((f, i) => (
                <tr key={i}>
                  <td><TextInput size="xs" w={70} value={f.talla || ''} onChange={e => set(i, 'talla', e.target.value)} /></td>
                  <td><TextInput size="xs" w={90} value={f.color || ''} onChange={e => set(i, 'color', e.target.value)} /></td>
                  <td><TextInput size="xs" w={90} value={f.sku || ''} onChange={e => set(i, 'sku', e.target.value)} /></td>
                  <td><TextInput size="xs" w={110} value={f.upc || ''} onChange={e => set(i, 'upc', e.target.value)} /></td>
                  {nombres.map(n => (
                    <td key={n}><NumberInput size="xs" w={64} min={0} value={f.stocks?.[n] ?? 0} onChange={v => setStock(i, n, v || 0)} /></td>
                  ))}
                  <td><Button size="compact-xs" variant="subtle" color="red" onClick={() => setFilas(fl => fl.filter((_, j) => j !== i))}>Quitar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Group mt="sm">
        <Button size="xs" variant="default" disabled={!filas}
          onClick={() => setFilas(f => [...f, { talla: '', color: '', sku: '', upc: '', stocks: {} }])}>
          + Agregar variante
        </Button>
      </Group>
    </Modal>
  );
}
