import { useState } from 'react';
import { Card, TextInput, Button, Group, Text } from '@mantine/core';
import { api } from '../../api';
import { fdate, fmt } from '../../lib/format';

// Rastro de documento (idea SAP): desde un folio, toda la cadena del dinero
// y la mercancía — pedido, pagos, kardex, asientos y devoluciones.
export default function RastroTab() {
  const [folio, setFolio] = useState('');
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);

  const buscar = async () => {
    setErr(null); setR(null);
    try {
      const d = await api.get('/api/erp/rastro?folio=' + encodeURIComponent(folio.trim()));
      if (!d.ok) throw new Error(d.error);
      setR(d);
    } catch (e) { setErr(e.message); }
  };

  const Bloque = ({ titulo, filas, render, vacio }) => (
    <Card withBorder radius="md" p="md" className="card" mb="sm">
      <div className="card-header"><h3>{titulo}</h3><Text size="xs" c="dimmed">{filas.length}</Text></div>
      {filas.length === 0 ? <Text size="xs" c="dimmed">{vacio}</Text> : filas.map(render)}
    </Card>
  );

  return (
    <div style={{ maxWidth: 860 }}>
      <Group mb="md" align="end">
        <TextInput label="Folio o # de pedido" placeholder="JC-2026-0001 o 123" value={folio}
          onChange={e => setFolio(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscar()} w={260} />
        <Button onClick={buscar} disabled={!folio.trim()}>Rastrear</Button>
      </Group>
      {err && <div className="login-error mb-5">{err}</div>}
      {r && (
        <>
          <Card withBorder radius="md" p="md" className="card" mb="sm">
            <div className="card-header"><h3>Pedido {r.pedido.folio || '#' + r.pedido.id_pedido}</h3>
              <span className="badge badge-azul">{r.pedido.estatus}</span></div>
            <Text size="xs" c="dimmed">
              {fdate(r.pedido.creado_en)} · canal {r.pedido.canal_creacion || 'bot'} · cliente {r.pedido.cliente || '-'}
              {r.pedido.cobrado_por && ` · cobró: ${r.pedido.cobrado_por}`}
              {r.pedido.cancelado_por && ` · CANCELÓ: ${r.pedido.cancelado_por} (${fdate(r.pedido.cancelado_en)})`}
            </Text>
            {r.detalle.map(d => (
              <Text key={d.id} size="xs">· {d.cantidad}× {d.name || d.id_producto}{d.variante ? ` (${d.variante})` : ''} — ${fmt(d.subtotal_linea)}</Text>
            ))}
          </Card>
          <Bloque titulo="Pagos" filas={r.pagos} vacio="Sin pagos ligados"
            render={pg => <Text key={pg.id} size="xs">· ${fmt(pg.monto)} — {pg.estatus}{pg.pagado_en ? ' · ' + fdate(pg.pagado_en) : ''}</Text>} />
          <Bloque titulo="Kardex (mercancía)" filas={r.kardex} vacio="Sin movimientos de inventario"
            render={m => <Text key={m.id} size="xs">· {fdate(m.creado_en)} — {m.tipo} en {m.sucursal}: {m.cantidad_anterior}→{m.cantidad_nueva} ({m.motivo}{m.creado_por ? ' · ' + m.creado_por : ''})</Text>} />
          <Bloque titulo="Asientos contables" filas={r.asientos} vacio="Sin asientos (¿módulo contabilidad apagado al venderse?)"
            render={aa => <Text key={aa.id} size="xs">· {aa.fecha} — {aa.concepto}: {aa.partidas_txt}</Text>} />
          <Bloque titulo="Devoluciones" filas={r.devoluciones} vacio="Sin devoluciones"
            render={dv => <Text key={dv.id} size="xs">· {dv.cantidad}× producto {dv.id_producto} — {dv.estatus} ({dv.motivo || 's/motivo'})</Text>} />
        </>
      )}
    </div>
  );
}
