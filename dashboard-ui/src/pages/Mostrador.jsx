import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, Group, Title, Table, Button, TextInput, NumberInput, Select, ActionIcon } from '@mantine/core';
import { api } from '../api';
import { fmt } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { tieneRango } from '../lib/roles';
import { LEYENDA_FACTURACION } from '../lib/factura';
import { useTextoEmoji } from '../context/EmojiContext';

// Punto de venta de mostrador (Bloque 2B). Cajero (usuario+) cobra ventas
// presenciales; el corte de caja es gerente+.
export default function Mostrador() {
  const txt = useTextoEmoji();
  const { user } = useAuth();
  const esGerente = tieneRango(user?.rol, 'gerente');

  const { data: config } = useQuery({ queryKey: ['pos-config'], queryFn: () => api.get('/api/pos/config') });
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [clienteTel, setClienteTel] = useState('');
  const [clienteNombre, setClienteNombre] = useState('');
  const [efectivo, setEfectivo] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [rfc, setRfc] = useState('');
  const [msg, setMsg] = useState(null);
  const [ticket, setTicket] = useState(null);
  const reimprimir = () => { try { const t = JSON.parse(localStorage.getItem('pos-ultimo-ticket') || 'null'); if (t) setTicket(t); else alert('No hay ticket previo en esta caja'); } catch (_) {} };
  const [cobrando, setCobrando] = useState(false);

  useEffect(() => { if (config?.metodos?.length) setMetodoPago(config.metodos[0]); }, [config]);

  const buscar = async (q) => {
    setBusqueda(q);
    if (q.trim().length < 1) { setResultados([]); return; }
    try { const r = await api.get(`/api/pos/productos?q=${encodeURIComponent(q.trim())}`); setResultados(r.items || []); }
    catch (e) { setMsg({ ok: false, t: e.message }); }
  };
  // Escáner de código de barras: los lectores USB teclean el código y mandan
  // Enter — buscar match EXACTO por UPC/SKU y agregar al instante.
  const escanear = async (e) => {
    if (e.key !== 'Enter') return;
    const codigo = e.currentTarget.value.trim();
    if (!codigo) return;
    e.currentTarget.value = '';
    try {
      const r = await api.get(`/api/pos/productos?q=${encodeURIComponent(codigo)}`);
      const exacto = (r.items || []).find(x => x.upc === codigo || x.sku === codigo) || (r.items || [])[0];
      if (!exacto) return setMsg({ ok: false, t: 'Código no encontrado: ' + codigo });
      agregar(exacto);
      setMsg(null);
    } catch (err) { setMsg({ ok: false, t: err.message }); }
  };
  const [sugeridos, setSugeridos] = useState([]);
  const agregar = (p) => {
    // Complemento sugerido (Ventas + CRO): sube el ticket del mostrador
    api.get('/api/pos/sugeridos?id=' + p.id).then(r => setSugeridos(r.items || [])).catch(() => {});
    setCarrito(c => {
      const i = c.findIndex(x => x.id === p.id);
      if (i >= 0) { const n = [...c]; n[i] = { ...n[i], cantidad: n[i].cantidad + 1 }; return n; }
      return [...c, { id: p.id, name: p.name, price: p.price, cantidad: 1 }];
    });
    setBusqueda(''); setResultados([]);
  };
  // decimal permitido (granel/volumen: kg, m3, bulto)
  const setCantidad = (id, cant) => setCarrito(c => c.map(x => x.id === id ? { ...x, cantidad: Math.max(0.001, Number(cant) || 1) } : x));
  const quitar = (id) => setCarrito(c => c.filter(x => x.id !== id));
  const total = useMemo(() => carrito.reduce((s, i) => s + i.price * i.cantidad, 0), [carrito]);
  const cambio = (metodoPago === 'efectivo' && efectivo !== '') ? Math.max(0, Number(efectivo) - total) : null;

  const cobrar = async () => {
    if (!carrito.length) return;
    setMsg(null); setCobrando(true);
    try {
      const armarVenta = (pin) => api.post('/api/pos/venta', {
        items: carrito.map(i => ({ id_producto: i.id, cantidad: i.cantidad, precio: i.price, id_variante: i.id_variante || undefined })),
        metodo_pago: metodoPago,
        cliente: (clienteTel || clienteNombre) ? { telefono: clienteTel || undefined, nombre: clienteNombre || undefined } : undefined,
        efectivo_recibido: efectivo === '' ? undefined : Number(efectivo),
        razon_social: razonSocial || undefined,
        rfc: rfc || undefined,
        pin,
      });
      let r = await armarVenta();
      if (r?.pin_requerido) {
        // el backend exige PIN (cambio de precio de lista)
        const pin = window.prompt('Esta venta cambia un precio de lista — PIN de autorización del administrador:');
        if (!pin) { setCobrando(false); return; }
        r = await armarVenta(pin);
      }
      if (r && r.ok === false) throw new Error(r.error || 'No se pudo cobrar');
      setTicket(r);
      try { localStorage.setItem('pos-ultimo-ticket', JSON.stringify(r)); } catch (_) {}
      setCarrito([]); setEfectivo(''); setClienteTel(''); setClienteNombre(''); setRazonSocial(''); setRfc('');
    } catch (e) { setMsg({ ok: false, t: e.message }); }
    finally { setCobrando(false); }
  };

  return (
    <div>
      <div className="page-title">Mostrador</div>
      <div className="page-sub">Punto de venta — cobra ventas presenciales{config?.sucursal ? ` · sucursal: ${config.sucursal}` : ''}</div>
      {msg && <div className="login-error" style={{ marginBottom: 12 }}>{msg.t}</div>}

      <div className="kpi-grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="sm">{txt('🛒 Venta')}</Title>
          <TextInput placeholder="Escanear código de barras (Enter agrega)" autoFocus onKeyDown={escanear} mb="xs"
            styles={{ input: { borderColor: 'var(--accent)', fontFamily: 'monospace' } }} />
          <TextInput placeholder="…o buscar por nombre o SKU" value={busqueda} onChange={e => buscar(e.target.value)} mb="xs" />
          <Button variant="subtle" size="xs" mb="xs" onClick={reimprimir}>Reimprimir último ticket</Button>
          {sugeridos.length > 0 && (
            <div style={{ marginBottom: 8, padding: 8, background: 'var(--panel-2)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 4 }}>Suele llevarse también:</div>
              <Group gap={6}>
                {sugeridos.map(s => (
                  <Button key={s.id} size="compact-xs" variant="default"
                    onClick={() => agregar(s)}>{s.name} · ${Number(s.price).toFixed(0)}</Button>
                ))}
              </Group>
            </div>
          )}
          {resultados.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 200, overflow: 'auto', marginBottom: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
              <Table highlightOnHover verticalSpacing={4}>
                <tbody>
                  {resultados.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => agregar(p)}>
                      <td>{p.name}</td>
                      <td style={{ textAlign: 'right' }}>${fmt(p.price)}</td>
                      <td className="text-muted" style={{ textAlign: 'right', fontSize: 11 }}>stock {p.stock}</td>
                      <td style={{ textAlign: 'right' }}><ActionIcon variant="light" color="teal" size="sm">＋</ActionIcon></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <Table verticalSpacing="xs">
            <thead><tr><th>Producto</th><th style={{ width: 90 }}>Cant.</th><th style={{ textAlign: 'right' }}>Importe</th><th></th></tr></thead>
            <tbody>
              {carrito.length === 0 && <tr><td colSpan={4} className="empty">Carrito vacío</td></tr>}
              {carrito.map(i => (
                <tr key={i.id}>
                  <td>{i.name}<br /><span className="text-muted" style={{ fontSize: 11 }}>${fmt(i.price)} c/u</span></td>
                  <td><NumberInput decimalScale={3} step={1} size="xs" min={1} value={i.cantidad} onChange={v => setCantidad(i.id, Number(v) || 1)} /></td>
                  <td style={{ textAlign: 'right' }}>${fmt(i.price * i.cantidad)}</td>
                  <td><ActionIcon variant="subtle" color="red" onClick={() => quitar(i.id)}><Trash2 size={16} strokeWidth={1.75} /></ActionIcon></td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div style={{ textAlign: 'right', fontSize: 20, fontWeight: 700, marginTop: 8 }}>Total: ${fmt(total)}</div>
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="sm">{txt('💳 Cobro')}</Title>
          <Select label="Método de pago" data={(config?.metodos || ['efectivo']).map(m => ({ value: m, label: m }))}
            value={metodoPago} onChange={v => setMetodoPago(v || 'efectivo')} mb="sm" allowDeselect={false} />
          {metodoPago === 'efectivo' && (
            <>
              <NumberInput label="Efectivo recibido" min={0} value={efectivo} onChange={setEfectivo} mb="xs" />
              {cambio !== null && <div style={{ fontSize: 14, marginBottom: 8 }}>Cambio: <strong>${fmt(cambio)}</strong></div>}
            </>
          )}
          <TextInput label="Teléfono del cliente (opcional, para puntos)" value={clienteTel} onChange={e => setClienteTel(e.target.value)} mb="xs" />
          <TextInput label="Nombre del cliente (opcional)" value={clienteNombre} onChange={e => setClienteNombre(e.target.value)} mb="sm" />
          {config?.facturacion && (
            <div style={{ border: '1px dashed var(--border)', borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 6 }}>¿Va a facturar? (opcional)</div>
              <TextInput placeholder="Razón social" value={razonSocial} onChange={e => setRazonSocial(e.target.value)} mb="xs" size="xs" />
              <TextInput placeholder="RFC" value={rfc} onChange={e => setRfc(e.target.value)} size="xs" />
            </div>
          )}
          <Button fullWidth size="md" disabled={!carrito.length || cobrando} onClick={cobrar}>
            {cobrando ? 'Cobrando…' : `Cobrar $${fmt(total)}`}
          </Button>

          {ticket && (
            <div className="card" style={{ marginTop: 14, fontSize: 13 }}>
              <strong>Venta {ticket.folio}</strong>
              <div style={{ marginTop: 6 }}>
                {ticket.items.map((it, i) => <div key={i}>{it.cantidad}× {it.name} — ${fmt(it.subtotal)}</div>)}
              </div>
              <div style={{ marginTop: 6 }}>Total: <strong>${fmt(ticket.total)}</strong> ({ticket.metodo_pago})</div>
              {ticket.cambio !== null && <div>Cambio: <strong>${fmt(ticket.cambio)}</strong></div>}
              {(ticket.razon_social || ticket.rfc) && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                  <div style={{ fontWeight: 600 }}>Comprobante para facturación</div>
                  <div>Referencia: <strong>{ticket.folio}</strong></div>
                  {ticket.razon_social && <div>Razón social: {ticket.razon_social}</div>}
                  {ticket.rfc && <div>RFC: {ticket.rfc}</div>}
                  <div style={{ marginTop: 4, color: 'var(--text-mute)', fontSize: 11 }}>{LEYENDA_FACTURACION}</div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {esGerente && <CorteCaja txt={txt} />}
    </div>
  );
}

// Corte de caja — solo gerente+ (es un reporte).
function CorteCaja({ txt }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(hoy);
  const [contado, setContado] = useState('');
  const [msg, setMsg] = useState(null);
  const { data, refetch } = useQuery({ queryKey: ['pos-corte', fecha], queryFn: () => api.get(`/api/pos/corte?fecha=${fecha}`) });

  const diferencia = (data && contado !== '') ? (Number(contado) - data.efectivo_sistema) : null;
  const cerrar = async () => {
    setMsg(null);
    try {
      const r = await api.post('/api/pos/corte', { fecha, efectivo_contado: contado === '' ? undefined : Number(contado) });
      setMsg({ ok: true, t: `Corte guardado. Diferencia: $${fmt(r.diferencia ?? 0)}` });
      refetch();
    } catch (e) { setMsg({ ok: false, t: e.message }); }
  };

  return (
    <Card withBorder radius="md" p="lg" mt="md">
      <Group justify="space-between" mb="sm">
        <Title order={4}>{txt('🧾 Corte de caja')}</Title>
        <TextInput type="date" value={fecha} onChange={e => setFecha(e.target.value)} size="xs" />
      </Group>
      {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginBottom: 10, fontSize: 13 }}>{msg.t}</div>}
      <Table verticalSpacing="xs">
        <thead><tr><th>Método</th><th style={{ textAlign: 'right' }}>Ventas</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
        <tbody>
          {(data?.por_metodo || []).length === 0 && <tr><td colSpan={3} className="empty">Sin ventas pagadas este día</td></tr>}
          {(data?.por_metodo || []).map((r, i) => (
            <tr key={i}><td style={{ textTransform: 'capitalize' }}>{r.metodo}</td><td style={{ textAlign: 'right' }}>{r.n}</td><td style={{ textAlign: 'right' }}>${fmt(r.total)}</td></tr>
          ))}
        </tbody>
      </Table>
      <div style={{ textAlign: 'right', fontWeight: 700, marginTop: 6 }}>Total del día: ${fmt(data?.total_sistema || 0)}</div>
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>Efectivo esperado en caja: <strong>${fmt(data?.efectivo_sistema || 0)}</strong></div>
        <Group align="flex-end" gap="sm">
          <NumberInput label="Efectivo contado" min={0} value={contado} onChange={setContado} style={{ width: 180 }} />
          {diferencia !== null && (
            <div style={{ fontSize: 14, paddingBottom: 6 }}>
              Diferencia: <strong style={{ color: diferencia === 0 ? 'var(--green)' : Math.abs(diferencia) < 0.01 ? 'var(--green)' : 'var(--red)' }}>${fmt(diferencia)}</strong>
            </div>
          )}
          <Button onClick={cerrar} style={{ marginBottom: 0 }}>Cerrar caja</Button>
        </Group>
      </div>
      {(data?.cortes || []).length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-mute)' }}>
          Cortes guardados hoy: {data.cortes.map(c => `${c.usuario || '—'} (dif $${fmt(c.diferencia ?? 0)})`).join(' · ')}
        </div>
      )}
    </Card>
  );
}
