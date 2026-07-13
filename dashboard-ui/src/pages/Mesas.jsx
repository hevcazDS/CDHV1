import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, TextInput, NumberInput, Group, Text, Select } from '@mantine/core';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk, alertar, prompt } from '../lib/ui';

// Mesas de restaurante: abrir mesa → agregar platillos con comentario →
// preticket a cocina → cobrar (pasa al POS). Módulo mesas_activo.
export default function Mesas() {
  const qc = useQueryClient();
  const [nuevaMesa, setNuevaMesa] = useState('');
  const [sel, setSel] = useState(null); // mesa seleccionada
  const [item, setItem] = useState({ nombre: '', precio: 0, cantidad: 1, comentario: '' });

  const { data: mesas = [] } = useQuery({ queryKey: ['mesas'], queryFn: () => api.get('/api/mesas'), refetchInterval: 20000 });
  const { data: productos = [] } = useQuery({ queryKey: ['pos-prods-mesas'], queryFn: () => api.get('/api/pos/productos?q=').then(r => r.items || []).catch(() => []) });
  const { data: sugeridos } = useQuery({ queryKey: ['mesa-sugeridos', sel], enabled: !!sel, queryFn: () => api.get(`/api/mesas/${sel}/sugeridos`).then(r => r.items || []).catch(() => []) });
  const mesaSel = mesas.find(m => m.id === sel);

  const refrescar = () => { qc.invalidateQueries({ queryKey: ['mesas'] }); qc.invalidateQueries({ queryKey: ['mesa-sugeridos'] }); };
  const agregarSugerido = async (s) => {
    const r = await api.post(`/api/mesas/${sel}/item`, { id_producto: s.id, cantidad: 1 }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    refrescar();
  };
  const abrir = useMutation({
    mutationFn: () => api.post('/api/mesas', { numero: nuevaMesa }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setNuevaMesa(''); refrescar(); },
    onError: handleApiError,
  });
  const agregar = async () => {
    const r = await api.post(`/api/mesas/${sel}/item`, item).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    setItem({ nombre: '', precio: 0, cantidad: 1, comentario: '' });
    refrescar();
  };
  const quitar = async (itemId) => { await api.del(`/api/mesas/${sel}/item/${itemId}`).catch(() => {}); refrescar(); };
  const aCocina = async () => {
    const r = await api.post(`/api/mesas/${sel}/cocina`).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    const txt = r.comanda.map(c => `${c.cantidad}× ${c.nombre}${c.comentario ? ' — ' + c.comentario : ''}`).join('\n');
    await alertar({ titulo: 'Comanda — Mesa ' + r.mesa + ' (solo pantalla)', mensaje: txt + '\n\nMuéstrala en cocina; no se imprime.' });
    refrescar();
  };
  const cobrar = async () => {
    const metodo_pago = await prompt({
      titulo: 'Cobrar mesa', mensaje: 'Método de pago:', valorInicial: 'efectivo',
      opciones: [{ value: 'efectivo', label: 'Efectivo' }, { value: 'tarjeta', label: 'Tarjeta' }, { value: 'transferencia', label: 'Transferencia' }],
    });
    if (!metodo_pago) return;
    // Propina: se cobra aparte del consumo. Se sugiere sobre el subtotal de la mesa.
    const sub = Number(mesaSel?.total || 0);
    const propTxt = await prompt({
      titulo: 'Propina (opcional)',
      mensaje: `Consumo $${sub.toFixed(2)}. Escribe la propina en pesos (10% = $${(sub * 0.1).toFixed(2)} · 15% = $${(sub * 0.15).toFixed(2)}), o deja 0.`,
      valorInicial: '0', tipo: 'text',
    });
    if (propTxt === null) return;
    const propina = Math.max(0, Number(String(propTxt).replace(/[^0-9.]/g, '')) || 0);
    const r = await api.post(`/api/mesas/${sel}/cerrar`, { metodo_pago, propina }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return handleApiError(new Error(r.error));
    toastOk(`Mesa cobrada · Folio ${r.folio} · $${Number(r.total).toFixed(2)}${propina > 0 ? ` (incl. propina $${propina.toFixed(2)})` : ''}`);
    setSel(null); refrescar();
  };

  return (
    <div>
      <div className="page-title">Mesas</div>
      <div className="page-sub">Abre mesas, toma la orden con comentarios, manda a cocina y cobra</div>
      <div className="split-2w">
        <Card withBorder radius="md" p="lg" className="card">
          <div className="card-header"><h3>Mesas abiertas</h3></div>
          <Group mb="md">
            <TextInput placeholder="N° o nombre de mesa" value={nuevaMesa} onChange={e => setNuevaMesa(e.target.value)} size="xs" style={{ flex: 1 }} />
            <Button size="xs" onClick={() => abrir.mutate()} disabled={!nuevaMesa.trim()}>Abrir</Button>
          </Group>
          {mesas.length === 0 && <div className="empty">Sin mesas abiertas</div>}
          {mesas.map(m => (
            <div key={m.id} onClick={() => setSel(m.id)}
              style={{ padding: '10px 12px', borderRadius: 'var(--radius)', marginBottom: 6, cursor: 'pointer',
                border: '1px solid ' + (m.id === sel ? 'var(--accent)' : 'var(--border)'),
                background: m.id === sel ? 'var(--panel-2)' : undefined }}>
              <strong>Mesa {m.numero}</strong>
              <span style={{ float: 'right', fontWeight: 700 }}>${Number(m.total).toFixed(2)}</span>
              <div className="text-muted" style={{ fontSize: 11 }}>{m.items.length} platillo(s)</div>
            </div>
          ))}
        </Card>

        <Card withBorder radius="md" p="lg" className="card">
          {!mesaSel ? <div className="empty">Elige o abre una mesa</div> : (
            <>
              <div className="card-header">
                <h3>Mesa {mesaSel.numero}</h3>
                <Group gap="xs">
                  <Button size="xs" variant="default" onClick={aCocina}>Enviar a cocina</Button>
                  <Button size="xs" color="teal" onClick={cobrar}>Cobrar (${Number(mesaSel.total).toFixed(2)})</Button>
                </Group>
              </div>
              <div className="table-wrap tabla-compacta" style={{ marginBottom: 12 }}>
                <table>
                  <tbody>
                    {mesaSel.items.length === 0 && <tr><td className="empty">Sin platillos aún</td></tr>}
                    {mesaSel.items.map(i => (
                      <tr key={i.id}>
                        <td style={{ fontWeight: 700, width: 30 }}>{i.cantidad}×</td>
                        <td><strong>{i.nombre}</strong>{i.comentario && <div style={{ fontSize: 11, color: 'var(--yellow)' }}>{i.comentario}</div>}</td>
                        <td>${(i.precio * i.cantidad).toFixed(2)}</td>
                        <td>{i.enviado_cocina ? <span className="chip">en cocina</span>
                          : <Button size="compact-xs" variant="subtle" color="red" onClick={() => quitar(i.id)}>Quitar</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Group grow mb="xs">
                <Select placeholder="Platillo del catálogo" searchable clearable size="xs"
                  data={productos.map(pr => ({ value: String(pr.id), label: pr.name + ' — $' + pr.price }))}
                  onChange={v => { const pr = productos.find(x => String(x.id) === v); if (pr) setItem({ ...item, nombre: pr.name, precio: pr.price, id_producto: pr.id }); }} />
                <TextInput placeholder="…o platillo libre" size="xs" value={item.nombre}
                  onChange={e => setItem({ ...item, nombre: e.target.value, id_producto: undefined })} />
              </Group>
              <Group grow mb="xs">
                <NumberInput placeholder="Precio" size="xs" min={0} value={item.precio} onChange={v => setItem({ ...item, precio: v || 0 })} />
                <NumberInput placeholder="Cant." size="xs" min={1} value={item.cantidad} onChange={v => setItem({ ...item, cantidad: v || 1 })} />
              </Group>
              <TextInput placeholder="Comentario (sin chile, mitad, término medio…)" size="xs" mb="xs"
                value={item.comentario} onChange={e => setItem({ ...item, comentario: e.target.value })} />
              <Button fullWidth size="xs" onClick={agregar} disabled={!item.nombre.trim()}>Agregar a la mesa</Button>
              {sugeridos?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Text size="xs" c="dimmed" mb={6}>¿Agregar también?</Text>
                  <Group gap={6}>
                    {sugeridos.map(s => (
                      <Button key={s.id} size="compact-xs" variant="light" onClick={() => agregarSugerido(s)}>
                        + {s.name} · ${Number(s.price).toFixed(0)}
                      </Button>
                    ))}
                  </Group>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
