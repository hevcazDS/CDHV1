import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Title, ActionIcon, TextInput } from '@mantine/core';
import { api } from '../api';
import { fmt } from '../lib/format';
import { handleApiError } from '../lib/apiError';
import { confirmar } from '../lib/ui';
import { Emoji, useTextoEmoji } from '../context/EmojiContext';

export default function Sustitutos() {
  const txt = useTextoEmoji();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [base, setBase] = useState(null);
  const [qVincular, setQVincular] = useState('');

  const { data: resultados } = useQuery({
    queryKey: ['productos-buscar', q],
    queryFn: () => api.get('/api/productos/buscar?q=' + encodeURIComponent(q)),
    enabled: q.trim().length >= 2,
  });

  // Clave por base?.id: si se selecciona otro producto base mientras la
  // consulta de relacionados anterior sigue en vuelo, TanStack Query
  // descarta esa respuesta vieja en vez de pintarla sobre el producto nuevo.
  const { data: relacionados } = useQuery({
    queryKey: ['sustitutos', base?.id],
    queryFn: () => api.get(`/api/sustitutos/${base.id}`),
    enabled: !!base,
  });

  const { data: resultadosVincular } = useQuery({
    queryKey: ['productos-buscar-vincular', qVincular],
    queryFn: () => api.get('/api/productos/buscar?q=' + encodeURIComponent(qVincular)).then(r => r.slice(0, 5)),
    enabled: qVincular.trim().length >= 2,
  });

  const cargarSustitutos = (id, nombre) => {
    setBase({ id, nombre });
    setQVincular('');
  };

  const vincularMutation = useMutation({
    mutationFn: (idSust) => api.post('/api/sustitutos', { id_producto: base.id, id_sustituto: idSust, score: 8 }),
    onSuccess: () => {
      setQVincular('');
      queryClient.invalidateQueries({ queryKey: ['sustitutos', base.id] });
    },
    onError: (e) => handleApiError(e),
  });

  const eliminarMutation = useMutation({
    mutationFn: (id) => api.del(`/api/sustitutos/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sustitutos', base.id] }),
    onError: (e) => handleApiError(e),
  });
  const eliminar = async (id) => {
    if (!await confirmar({ mensaje: '¿Eliminar esta relación?', peligro: true, textoOk: 'Eliminar' })) return;
    eliminarMutation.mutate(id);
  };

  return (
    <div className="sin-scroll">
      <div className="page-title">Relacionados</div>
      <div className="page-sub">Productos sustitutos sugeridos cuando hay quiebre de stock</div>
      <div className="page-scrollable">

      <div className="cols-2">
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('🔍 Buscar producto')}</Title>
          <TextInput label="Nombre" placeholder="Ej: Hot Wheels" value={q} onChange={e => setQ(e.target.value)} mb="sm" />
          {q.trim().length < 2 && <div className="empty">Escribe para buscar...</div>}
          {resultados?.length === 0 && <div className="empty">Sin resultados</div>}
          {resultados?.map(r => (
            <div key={r.id} onClick={() => cargarSustitutos(r.id, r.name)}
              style={{ padding: '7px 9px', cursor: 'pointer', borderRadius: 5, borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <strong>{r.name}</strong><br /><span className="text-muted">${fmt(r.price)}</span>
            </div>
          ))}
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('🔄 Productos relacionados')}</Title>
          {!base && <div className="empty">Selecciona un producto</div>}
          {base && (
            <>
              <strong style={{ fontSize: 13 }}>{base.nombre}</strong>
              <div style={{ margin: '8px 0', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                {relacionados === undefined && <div className="empty cargando">Cargando...</div>}
                {relacionados?.length === 0 && <div className="empty">Sin relacionados definidos</div>}
                {relacionados?.map(r => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <div><strong>{r.name}</strong><br /><span className="text-muted">${fmt(r.price)} · Score {r.score || 0}</span></div>
                    <ActionIcon variant="light" color="red" size="sm" onClick={() => eliminar(r.id)}></ActionIcon>
                  </div>
                ))}
              </div>
              <TextInput placeholder="Buscar producto a vincular..." value={qVincular} onChange={e => setQVincular(e.target.value)} mt="sm" />
              {resultadosVincular?.map(r => (
                <div key={r.id} onClick={() => vincularMutation.mutate(r.id)} style={{ padding: '5px 9px', cursor: 'pointer', fontSize: 12, borderRadius: 4 }}>
                  <Emoji></Emoji>{r.name} - ${fmt(r.price)}
                </div>
              ))}
            </>
          )}
        </Card>
      </div>
      </div>
    </div>
  );
}
