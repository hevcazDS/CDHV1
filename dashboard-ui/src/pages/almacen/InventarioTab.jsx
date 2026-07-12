import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, TextInput, Button, Group } from '@mantine/core';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';

// Inventario con búsqueda (nombre/UPC/SKU) y ubicación geoespacial editable.
// Ola 4 §18: agrupado POR PRODUCTO con expansión por sucursal — antes el mismo
// producto aparecía repetido N veces (una fila por sucursal) y la tabla se
// leía como error. Con 1 sola sucursal se pinta plano, como siempre.
export default function InventarioTab({ soloLectura }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);      // clave `${id}|${sucursal}` en edición
  const [abiertos, setAbiertos] = useState({}); // id producto -> expandido

  const { data: filas = [] } = useQuery({
    queryKey: ['almacen-inv', q],
    queryFn: () => api.get('/api/almacen/inventario?q=' + encodeURIComponent(q)),
  });

  const grupos = useMemo(() => {
    const m = new Map();
    for (const f of filas) {
      if (!m.has(f.id)) m.set(f.id, { id: f.id, name: f.name, upc: f.upc, tipo: f.tipo, total: 0, critico: false, sucursales: [] });
      const g = m.get(f.id);
      g.total += f.stock || 0;
      if ((f.stock_minimo || 0) > 0 && f.stock <= f.stock_minimo) g.critico = true;
      g.sucursales.push(f);
    }
    return [...m.values()];
  }, [filas]);

  const guardarUb = useMutation({
    mutationFn: (u) => api.put('/api/almacen/ubicacion', u),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['almacen-inv'] });
    },
    onError: handleApiError,
  });

  const FilaSucursal = ({ f, esSub }) => {
    const k = f.id + '|' + f.sucursal;
    return (
      <tr style={esSub ? { background: 'var(--panel-2)' } : undefined}>
        <td style={esSub ? { paddingLeft: 34, fontSize: 12.5 } : undefined}>
          {esSub ? f.sucursal : <><strong>{f.name}</strong>{f.tipo !== 'fisico' && <span className="chip" style={{ marginLeft: 6 }}>{f.tipo}</span>}</>}
        </td>
        <td className="text-muted" style={{ fontSize: 11 }}>{esSub ? '' : (f.upc || '-')}</td>
        <td>{esSub ? '' : f.sucursal}</td>
        <td className="num" style={(f.stock_minimo || 0) > 0 && f.stock <= f.stock_minimo ? { color: 'var(--red)', fontWeight: 700 } : undefined}>{f.stock}</td>
        <td style={{ fontSize: 12 }}>
          {edit === k ? (
            <Group gap={4} wrap="nowrap">
              {['zona', 'pasillo', 'rack', 'nivel'].map(c => (
                <TextInput key={c} size="xs" w={64} placeholder={c} defaultValue={f[c] || ''} id={`ub-${c}-${f.id}-${f.sucursal}`} />
              ))}
            </Group>
          ) : ([f.zona, f.pasillo, f.rack, f.nivel].filter(Boolean).join(' · ') || <span className="text-muted">sin ubicar</span>)}
        </td>
        {!soloLectura && (
          <td>
            {edit === k ? (
              <Button size="xs" onClick={() => guardarUb.mutate({
                id_producto: f.id, sucursal: f.sucursal,
                zona: document.getElementById(`ub-zona-${f.id}-${f.sucursal}`)?.value,
                pasillo: document.getElementById(`ub-pasillo-${f.id}-${f.sucursal}`)?.value,
                rack: document.getElementById(`ub-rack-${f.id}-${f.sucursal}`)?.value,
                nivel: document.getElementById(`ub-nivel-${f.id}-${f.sucursal}`)?.value,
              })}>Guardar</Button>
            ) : (
              <Button size="xs" variant="default" onClick={() => setEdit(k)}>Ubicar</Button>
            )}
          </td>
        )}
      </tr>
    );
  };

  return (
    <Card withBorder radius="md" p="lg" className="card">
      <div className="card-header">
        <h3>Inventario</h3>
        <TextInput placeholder="Buscar por nombre, UPC o SKU..." value={q} onChange={e => setQ(e.target.value)} w={300} />
      </div>
      <div className="table-wrap" style={{ maxHeight: 480, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Producto</th><th>UPC</th><th>Sucursal</th><th className="num">Stock</th><th>Ubicación (zona·pasillo·rack·nivel)</th>{!soloLectura && <th></th>}</tr></thead>
          <tbody>
            {grupos.length === 0 && <tr><td colSpan={6} className="empty">Sin resultados<span className="empty-accion">El stock entra por Compras (recibir OC), Entrada de mercancía o Traslados</span></td></tr>}
            {grupos.map(g => (
              g.sucursales.length === 1
                ? <FilaSucursal key={g.id} f={g.sucursales[0]} esSub={false} />
                : [
                  <tr key={g.id} style={{ cursor: 'pointer' }} onClick={() => setAbiertos(a => ({ ...a, [g.id]: !a[g.id] }))}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {abiertos[g.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <strong>{g.name}</strong>
                        {g.tipo !== 'fisico' && <span className="chip">{g.tipo}</span>}
                      </span>
                    </td>
                    <td className="text-muted" style={{ fontSize: 11 }}>{g.upc || '-'}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{g.sucursales.length} sucursales</td>
                    <td className="num" style={g.critico ? { color: 'var(--red)', fontWeight: 700 } : { fontWeight: 700 }}>{g.total}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{abiertos[g.id] ? '' : 'expandir para ver por sucursal'}</td>
                    {!soloLectura && <td></td>}
                  </tr>,
                  ...(abiertos[g.id] ? g.sucursales.map(f => <FilaSucursal key={g.id + f.sucursal} f={f} esSub />) : []),
                ]
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
