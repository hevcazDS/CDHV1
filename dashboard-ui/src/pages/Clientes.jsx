import { useState } from 'react';
import { RefreshCw, MessageCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table, TextInput, Drawer, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fdate, soloTelefono, fmt } from '../lib/format';
import { useTextoEmoji } from '../context/EmojiContext';
import Badge from '../components/Badge';

function capitalizar(nombre) {
  return nombre ? nombre.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '-';
}

// Ficha de cliente (Ola 4 §16): la tabla deja de ser un SELECT crudo — click
// en la fila abre el drawer con su historial junto: pedidos, gasto total,
// puntos de lealtad y acceso al chat. Todo con endpoints existentes.
function FichaCliente({ cliente, onClose }) {
  const tel = cliente?.telefono;
  const { data: pedidos = [] } = useQuery({
    queryKey: ['pedidos'],
    queryFn: () => api.get('/api/pedidos'),
    enabled: !!cliente,
  });
  const { data: puntos } = useQuery({
    queryKey: ['puntos', tel],
    queryFn: () => api.get('/api/puntos/' + encodeURIComponent(tel)).catch(() => null),
    enabled: !!tel,
  });
  // Match por id_cliente (FK real); /api/pedidos lo incluye desde la Ola 4
  const suyos = pedidos.filter(p => p.id_cliente === cliente?.id);
  const gastoTotal = suyos.filter(p => p.pago_estatus === 'pagado').reduce((s, p) => s + (p.total || 0), 0);

  return (
    <Drawer opened={!!cliente} onClose={onClose} position="right" size="md"
      title={<strong style={{ fontSize: 16 }}>{capitalizar(cliente?.nombre)}</strong>}>
      {cliente && (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <span className="chip">{soloTelefono(cliente.telefono)}</span>
            <span className="chip">desde {fdate(cliente.creado_en)}</span>
            {cliente.canal_origen && <span className="chip">{cliente.canal_origen}</span>}
            {(cliente.tags || '').split(',').filter(Boolean).map(t => <span className="chip" key={t}>{t.trim()}</span>)}
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
            <Card withBorder radius="md" p="sm" className="kpi-card">
              <div className="kpi-value" style={{ fontSize: 20 }}>{suyos.length}</div>
              <div className="kpi-label" style={{ fontSize: 11 }}>Pedidos</div>
            </Card>
            <Card withBorder radius="md" p="sm" className="kpi-card">
              <div className="kpi-value money" style={{ fontSize: 20 }}>${fmt(gastoTotal)}</div>
              <div className="kpi-label" style={{ fontSize: 11 }}>Gasto pagado</div>
            </Card>
            <Card withBorder radius="md" p="sm" className="kpi-card">
              <div className="kpi-value" style={{ fontSize: 20 }}>{puntos?.disponibles ?? 0}</div>
              <div className="kpi-label" style={{ fontSize: 11 }}>Puntos disponibles</div>
            </Card>
          </div>
          <Group gap="xs" mb="md">
            <Button component={Link} to="/notificaciones" size="xs" variant="default" leftSection={<MessageCircle size={14} />}>
              Ver chat / escribirle
            </Button>
            {cliente.codigo_referido && <span className="chip" title="Código de referido">🎁 {cliente.codigo_referido}</span>}
          </Group>
          <div className="card-header"><h3>Últimos pedidos</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Folio</th><th className="num">Total</th><th>Pago</th><th>Estatus</th></tr></thead>
              <tbody>
                {suyos.length === 0 && <tr><td colSpan={4} className="empty">Sin pedidos todavía<span className="empty-accion">Cuando compre por WhatsApp o mostrador aparecerán aquí</span></td></tr>}
                {suyos.slice(0, 10).map(p => (
                  <tr key={p.id_pedido}>
                    <td><span className="folio">{p.folio || '#' + p.id_pedido}</span></td>
                    <td className="num">${fmt(p.total)}</td>
                    <td><Badge value={p.pago_estatus} map="pago" /></td>
                    <td className="text-muted">{p.estatus || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function Clientes() {
  const txt = useTextoEmoji();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['clientes-busqueda', q],
    queryFn: () => api.get('/api/clientes?q=' + encodeURIComponent(q)),
  });

  return (
    <div>
      <div className="page-title">Clientes</div>
      <div className="page-sub">Clientes registrados vía WhatsApp — click en un cliente para ver su ficha</div>
      {error && <div className="login-error">No se pudieron cargar los clientes: {error.message}</div>}

      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('👥 Clientes')}</Title>
          <Group gap="xs">
            <TextInput size="xs" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} w={200} />
            <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
          </Group>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Nombre</th><th>Teléfono</th><th>Canal</th><th>Cód. referido</th><th>Tags</th><th>Registro</th></tr></thead>
            <tbody>
              {rows === undefined && <tr><td colSpan={6} className="empty">Cargando...</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={6} className="empty">Sin clientes<span className="empty-accion">Se registran solos al escribirle al bot de WhatsApp</span></td></tr>}
              {rows?.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSel(r)}>
                  <td><strong>{capitalizar(r.nombre)}</strong></td>
                  <td><span className="folio">{soloTelefono(r.telefono)}</span></td>
                  <td>{r.canal_origen || 'whatsapp'}</td>
                  <td><span className="folio">{r.codigo_referido || '-'}</span></td>
                  <td>{(r.tags || '').split(',').filter(Boolean).map(t => <span className="chip" key={t}>{t.trim()}</span>)}</td>
                  <td className="text-muted">{fdate(r.creado_en)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <FichaCliente cliente={sel} onClose={() => setSel(null)} />
    </div>
  );
}
