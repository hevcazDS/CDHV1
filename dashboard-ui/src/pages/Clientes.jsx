import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table, TextInput } from '@mantine/core';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { useTextoEmoji } from '../context/EmojiContext';
import { SkelRows } from '../components/Skeleton';
import FichaCliente from '../components/FichaCliente';

function capitalizar(nombre) {
  return nombre ? nombre.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '-';
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
    <div className="sin-scroll">
      <div className="page-title">Clientes</div>
      <div className="page-sub">Clientes registrados vía WhatsApp — click en un cliente para ver su ficha</div>
      {error && <div className="login-error">No se pudieron cargar los clientes: {error.message}</div>}

      <Card withBorder radius="md" p="lg" className="sin-scroll-card">
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('👥 Clientes')}</Title>
          <Group gap="xs">
            <TextInput size="xs" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} w={200} />
            <ActionIcon variant="default" onClick={() => refetch()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
          </Group>
        </Group>
        <div className="table-wrap page-scrollable">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Nombre</th><th>Teléfono</th><th>Canal</th><th>Cód. referido</th><th>Tags</th><th>Registro</th></tr></thead>
            <tbody>
              {rows === undefined && <SkelRows cols={6} rows={6} />}
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
