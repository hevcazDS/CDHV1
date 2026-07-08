import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, TextInput, Button, Group } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';

// Inventario con búsqueda (nombre/UPC/SKU) y ubicación geoespacial editable
// (zona/pasillo/rack/nivel) — responde "¿dónde está X?".
export default function InventarioTab({ soloLectura }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null); // fila en edición de ubicación

  const { data: filas = [] } = useQuery({
    queryKey: ['almacen-inv', q],
    queryFn: () => api.get('/api/almacen/inventario?q=' + encodeURIComponent(q)),
  });

  const guardarUb = useMutation({
    mutationFn: (u) => api.put('/api/almacen/ubicacion', u),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['almacen-inv'] });
    },
    onError: handleApiError,
  });

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <div className="card-header">
        <h3>Inventario</h3>
        <TextInput placeholder="Buscar por nombre, UPC o SKU..." value={q} onChange={e => setQ(e.target.value)} w={300} />
      </div>
      <div className="table-wrap" style={{ maxHeight: 480, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Producto</th><th>UPC</th><th>Sucursal</th><th>Stock</th><th>Ubicación (zona·pasillo·rack·nivel)</th>{!soloLectura && <th></th>}</tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={6} className="empty">Sin resultados</td></tr>}
            {filas.map((f, i) => (
              <tr key={i}>
                <td><strong>{f.name}</strong>{f.tipo !== 'fisico' && <span className="chip" style={{ marginLeft: 6 }}>{f.tipo}</span>}</td>
                <td className="text-muted" style={{ fontSize: 11 }}>{f.upc || '-'}</td>
                <td>{f.sucursal}</td>
                <td style={f.stock <= (f.stock_minimo || 0) ? { color: 'var(--red)', fontWeight: 700 } : undefined}>{f.stock}</td>
                <td style={{ fontSize: 12 }}>
                  {edit === i ? (
                    <Group gap={4} wrap="nowrap">
                      {['zona', 'pasillo', 'rack', 'nivel'].map(c => (
                        <TextInput key={c} size="xs" w={64} placeholder={c} defaultValue={f[c] || ''} id={`ub-${c}-${i}`} />
                      ))}
                    </Group>
                  ) : ([f.zona, f.pasillo, f.rack, f.nivel].filter(Boolean).join(' · ') || <span className="text-muted">sin ubicar</span>)}
                </td>
                {!soloLectura && (
                  <td>
                    {edit === i ? (
                      <Button size="xs" onClick={() => guardarUb.mutate({
                        id_producto: f.id, sucursal: f.sucursal,
                        zona: document.getElementById(`ub-zona-${i}`)?.value,
                        pasillo: document.getElementById(`ub-pasillo-${i}`)?.value,
                        rack: document.getElementById(`ub-rack-${i}`)?.value,
                        nivel: document.getElementById(`ub-nivel-${i}`)?.value,
                      })}>Guardar</Button>
                    ) : (
                      <Button size="xs" variant="default" onClick={() => setEdit(i)}>Ubicar</Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
