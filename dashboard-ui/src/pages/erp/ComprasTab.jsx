import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Select, NumberInput, Group, Text, TextInput } from '@mantine/core';
import { confirmar, toastOk, toastErr } from '../../lib/ui';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { imprimirReporte } from '../../lib/reporteImprimible';

// soloRecepcion: modo para el rol almacén — oculta el alta de OC (área compras)
// y solo deja recibir. Misma tabla/lógica, sin duplicar el módulo.
export default function ComprasTab({ soloRecepcion = false }) {
  const qc = useQueryClient();
  const [idProveedor, setIdProveedor] = useState(null);
  const [llegada, setLlegada] = useState('');
  const [sucDestino, setSucDestino] = useState('');
  const [items, setItems] = useState([]);
  const [prodSel, setProdSel] = useState(null);
  const [cant, setCant] = useState(1);
  const [costo, setCosto] = useState(0);

  const { data: proveedores = [] } = useQuery({ queryKey: ['erp-proveedores'], queryFn: () => api.get('/api/erp/proveedores') });
  // /api/pos/productos devuelve { items:[...] }, no un array plano (mismo
  // patrón que Mostrador.jsx/Mesas.jsx) — sin el .then(r=>r.items||[]) esto
  // crasheaba TODA la pestaña "Órdenes de compra" (productos.map sobre el
  // objeto {items:[...]} en vez del array).
  const { data: productos = [] } = useQuery({ queryKey: ['erp-productos'], queryFn: () => api.get('/api/pos/productos').then(r => r.items || []).catch(() => []) });
  const { data: ocs = [] } = useQuery({ queryKey: ['erp-ocs'], queryFn: () => api.get('/api/erp/ordenes-compra') });
  // Multitienda: gerente+ puede dirigir la OC a otra tienda (rol compras no ve
  // el catálogo → sus OC entran a su propia tienda, que es lo correcto).
  const { data: sucursales = [] } = useQuery({
    queryKey: ['prime-sucursales'],
    queryFn: () => api.get('/api/prime/sucursales').catch(() => []),
  });
  const multitienda = Array.isArray(sucursales) && sucursales.length > 1;

  const agregar = () => {
    if (!prodSel || !(cant > 0)) return;
    const prod = productos.find(x => String(x.id) === prodSel);
    setItems([...items, { id_producto: Number(prodSel), name: prod?.name || prodSel, cantidad: cant, costo_unitario: Number(costo) || 0 }]);
    setProdSel(null); setCant(1); setCosto(0);
  };
  const total = items.reduce((s, it) => s + it.cantidad * it.costo_unitario, 0);

  const crear = useMutation({
    mutationFn: () => api.post('/api/erp/ordenes-compra', { id_proveedor: Number(idProveedor), items, fecha_llegada_est: llegada || undefined, sucursal_destino: sucDestino || undefined }),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setItems([]); setIdProveedor(null); setLlegada(''); setSucDestino('');
      qc.invalidateQueries({ queryKey: ['erp-ocs'] });
    },
    onError: handleApiError,
  });
  const [parcial, setParcial] = useState(null); // { oc, cant:{id_detalle:qty} }
  const recibir = useMutation({
    mutationFn: (id) => api.post(`/api/erp/ordenes-compra/${id}/recibir`, {}),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      qc.invalidateQueries({ queryKey: ['erp-ocs'] });
      qc.invalidateQueries({ queryKey: ['erp-cxp'] });
    },
    onError: handleApiError,
  });

  return (
    <div className={soloRecepcion ? undefined : 'split-2w'} style={soloRecepcion ? { display: 'grid', gridTemplateColumns: '1fr', gap: 20, alignItems: 'start' } : undefined}>
      {!soloRecepcion && (
      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Nueva orden de compra</h3></div>
        <Select label="Proveedor *" searchable value={idProveedor} onChange={setIdProveedor} mb="sm"
          data={proveedores.map(pr => ({ value: String(pr.id), label: pr.nombre }))} />
        <Select label="Producto" searchable value={prodSel} onChange={setProdSel} mb="sm"
          data={productos.map(pr => ({ value: String(pr.id), label: pr.name }))} />
        <Group grow mb="sm">
          <NumberInput label="Cantidad" min={1} value={cant} onChange={v => setCant(v || 1)} />
          <NumberInput label="Costo unitario" min={0} decimalScale={2} value={costo} onChange={v => setCosto(v || 0)} />
        </Group>
        <Button variant="default" fullWidth onClick={agregar} disabled={!prodSel} mb="md">Agregar producto</Button>
        {items.map((it, i) => (
          <div key={i} className="modal-row"><span>{it.cantidad}× {it.name}</span><span>${(it.cantidad * it.costo_unitario).toFixed(2)}</span></div>
        ))}
        {items.length > 0 && <div className="modal-row total"><span>Total</span><span>${total.toFixed(2)}</span></div>}
        <TextInput type="date" label="Llegada estimada (opcional)" description="Aparece en el calendario de almacén" value={llegada} onChange={e => setLlegada(e.target.value)} mt="sm" />
        {multitienda && (
          <Select label="Sucursal destino" description="A qué tienda entra la mercancía al recibir" mt="sm"
            data={[{ value: '', label: 'Mi sucursal' }, ...sucursales.map(s => ({ value: s.nombre, label: s.nombre }))]}
            value={sucDestino} onChange={v => setSucDestino(v || '')} allowDeselect={false} />
        )}
        <Button fullWidth mt="md" onClick={() => crear.mutate()} disabled={!idProveedor || !items.length || crear.isPending}>Crear OC</Button>
      </Card>
      )}

      <Card withBorder radius="md" p="lg" className="card">
        <div className="card-header"><h3>Órdenes de compra</h3>
          <Button variant="default" size="xs" disabled={!ocs.length} onClick={() => imprimirReporte({
            titulo: 'Órdenes de compra', subtitulo: `${ocs.length} orden(es)`,
            columnas: [{ key: 'folio', label: 'Folio' }, { key: 'proveedor', label: 'Proveedor' }, { key: 'items', label: 'Productos', render: o => (o.items || []).map(i => `${i.cantidad}× ${i.name}`).join(', ') }, { key: 'total', label: 'Total', num: true, render: o => '$' + Number(o.total).toFixed(2) }, { key: 'estatus', label: 'Estatus' }],
            filas: ocs,
            totales: [{ label: 'Total', valor: '$' + ocs.reduce((s, o) => s + Number(o.total || 0), 0).toFixed(2), num: true }],
          })}>Imprimir</Button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folio</th><th>Proveedor</th><th>Total</th><th>Estatus</th><th></th></tr></thead>
            <tbody>
              {ocs.length === 0 && <tr><td colSpan={5} className="empty">Sin órdenes de compra</td></tr>}
              {ocs.map(oc => (
                <tr key={oc.id} title={(oc.items || []).map(i => `${i.cantidad}× ${i.name}`).join(', ')}>
                  <td><strong>{oc.folio}</strong></td>
                  <td>{oc.proveedor}</td>
                  <td>${Number(oc.total).toFixed(2)}</td>
                  <td><span className={`badge ${oc.estatus === 'recibida' ? 'badge-verde' : oc.estatus === 'cancelada' ? 'badge-rojo' : oc.estatus === 'parcial' ? 'badge-amarillo' : 'badge-azul'}`}>{oc.estatus}</span></td>
                  <td>
                    {!soloRecepcion && (
                    <Button size="xs" variant="subtle" mr={6} onClick={async () => {
                      const r = await api.post(`/api/erp/ordenes-compra/${oc.id}/reordenar`).catch(e => ({ ok: false, error: e.message }));
                      if (r.ok) { toastOk('Nueva OC creada: ' + r.folio); qc.invalidateQueries({ queryKey: ['erp-ocs'] }); } else toastErr(r.error);
                    }}>Reordenar</Button>
                    )}
                    {['abierta', 'parcial'].includes(oc.estatus) && (
                    <>
                    <Button size="xs" variant="default" onClick={() => recibir.mutate(oc.id)} disabled={recibir.isPending}>Recibir todo</Button>
                    <Button size="xs" variant="subtle" ml={6} onClick={() => setParcial({ oc, cant: {} })}>Parcial</Button>
                        {!soloRecepcion && (
                        <Button size="xs" variant="light" color="red" ml={6} onClick={async () => {
                          if (!await confirmar({ titulo: 'Cancelar OC', mensaje: '¿Cancelar esta orden de compra? Solo se cancelan las abiertas; no mueve inventario.', peligro: true, textoOk: 'Cancelar OC' })) return;
                          const r = await api.post(`/api/erp/ordenes-compra/${oc.id}/cancelar`);
                          if (r.ok) { toastOk('OC cancelada'); qc.invalidateQueries({ queryKey: ['erp-ocs'] }); } else handleApiError(new Error(r.error));
                        }}>Cancelar</Button>
                        )}
                    </>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {parcial && (
        <Modal title={`Recepción parcial — ${parcial.oc.folio}`} onClose={() => setParcial(null)}
          actions={<>
            <Button variant="default" onClick={() => setParcial(null)}>Cancelar</Button>
            <Button onClick={async () => {
              const items = (parcial.oc.items || []).map(it => ({ id_detalle: it.id, cantidad: Number(parcial.cant[it.id]) || 0 })).filter(x => x.cantidad > 0);
              if (!items.length) return toastErr('Captura al menos una cantidad');
              const r = await api.post(`/api/erp/ordenes-compra/${parcial.oc.id}/recibir`, { items }).catch(e => ({ ok: false, error: e.message }));
              if (r.ok) { toastOk(`Recibido ${r.estatus === 'recibida' ? '(completo)' : '(parcial)'} · $${Number(r.recibido).toFixed(2)}`); setParcial(null); qc.invalidateQueries({ queryKey: ['erp-ocs'] }); qc.invalidateQueries({ queryKey: ['erp-cxp'] }); }
              else toastErr(r.error);
            }}>Recibir lo capturado</Button>
          </>}>
          <Text size="xs" c="dimmed" mb="sm">Captura cuánto llegó de cada renglón. Lo que falte queda pendiente y la OC sigue "parcial".</Text>
          {(parcial.oc.items || []).map(it => {
            const pend = (it.cantidad || 0) - (it.cantidad_recibida || 0);
            return (
              <Group key={it.id} justify="space-between" mb="xs">
                <div><strong>{it.name}</strong><Text size="xs" c="dimmed">pedido {it.cantidad} · recibido {it.cantidad_recibida || 0} · pendiente {pend}</Text></div>
                <NumberInput size="xs" w={90} min={0} max={pend} value={parcial.cant[it.id] || 0}
                  onChange={v => setParcial(p => ({ ...p, cant: { ...p.cant, [it.id]: v || 0 } }))} disabled={pend <= 0} />
              </Group>
            );
          })}
        </Modal>
      )}
    </div>
  );
}
