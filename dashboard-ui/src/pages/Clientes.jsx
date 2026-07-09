import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, Group, Title, ActionIcon, Table, TextInput } from '@mantine/core';
import { api } from '../api';
import { fdate, soloTelefono } from '../lib/format';
import { useTextoEmoji } from '../context/EmojiContext';

function capitalizar(nombre) {
  return nombre ? nombre.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '-';
}

export default function Clientes() {
  const txt = useTextoEmoji();
  const [q, setQ] = useState('');

  const { data: rows, error, refetch } = useQuery({
    queryKey: ['clientes-busqueda', q],
    queryFn: () => api.get('/api/clientes?q=' + encodeURIComponent(q)),
  });

  return (
    <div>
      <div className="page-title">Clientes</div>
      <div className="page-sub">Clientes registrados vía WhatsApp</div>
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
              {rows?.length === 0 && <tr><td colSpan={6} className="empty">Sin clientes</td></tr>}
              {rows?.map(r => (
                <tr key={r.id}>
                  <td><strong>{capitalizar(r.nombre)}</strong></td>
                  <td><code style={{ fontSize: 11 }}>{soloTelefono(r.telefono)}</code></td>
                  <td>{r.canal_origen || 'whatsapp'}</td>
                  <td><code style={{ fontSize: 11 }}>{r.codigo_referido || '-'}</code></td>
                  <td>{(r.tags || '').split(',').filter(Boolean).map(t => <span className="chip" key={t}>{t.trim()}</span>)}</td>
                  <td className="text-muted">{fdate(r.creado_en)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
