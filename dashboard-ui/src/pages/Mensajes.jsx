import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Stack, Text, TextInput, Button, ScrollArea, Badge, Modal, Select, MultiSelect, ActionIcon, Title } from '@mantine/core';
import { Send, Plus, Users } from 'lucide-react';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastErr } from '../lib/ui';
import { fdate } from '../lib/format';

// Mensajería interna del equipo: lista de canales (1-a-1 y grupos) a la izquierda,
// conversación a la derecha. No-leídos por canal; el header ya muestra el total.
export default function Mensajes() {
  const qc = useQueryClient();
  const [sel, setSel] = useState(null);          // id de canal activo
  const [texto, setTexto] = useState('');
  const [modal, setModal] = useState(null);      // 'directo' | 'grupo' | null
  const finRef = useRef(null);

  const { data: canales } = useQuery({ queryKey: ['mensajeria-canales'], queryFn: () => api.get('/api/mensajeria/canales'), refetchInterval: 20000 });
  const { data: usuarios } = useQuery({ queryKey: ['mensajeria-usuarios'], queryFn: () => api.get('/api/mensajeria/usuarios') });
  const { data: mensajes } = useQuery({
    queryKey: ['mensajeria-mensajes', sel],
    queryFn: () => api.get(`/api/mensajeria/canales/${sel}/mensajes`),
    enabled: !!sel, refetchInterval: 8000,
  });

  // al recibir mensajes nuevos, refrescar la lista (no-leídos) y bajar el scroll
  useEffect(() => {
    if (sel) { qc.invalidateQueries({ queryKey: ['mensajeria-canales'] }); qc.invalidateQueries({ queryKey: ['mensajeria-no-leidos'] }); }
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, sel, qc]);

  const enviar = useMutation({
    mutationFn: () => api.post(`/api/mensajeria/canales/${sel}/mensajes`, { cuerpo: texto.trim() }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setTexto(''); qc.invalidateQueries({ queryKey: ['mensajeria-mensajes', sel] }); },
    onError: handleApiError,
  });

  const abrirDirecto = useMutation({
    mutationFn: (id_usuario) => api.post('/api/mensajeria/directo', { id_usuario }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setModal(null); setSel(r.id_canal); qc.invalidateQueries({ queryKey: ['mensajeria-canales'] }); },
    onError: handleApiError,
  });
  const crearGrupo = useMutation({
    mutationFn: (body) => api.post('/api/mensajeria/grupo', body),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); setModal(null); setSel(r.id_canal); qc.invalidateQueries({ queryKey: ['mensajeria-canales'] }); },
    onError: handleApiError,
  });

  const canalActivo = (canales || []).find(c => c.id === sel);
  const opcionesUsuarios = useMemo(() => (usuarios || []).map(u => ({ value: String(u.id), label: (u.nombre || u.username) + ' · ' + u.rol })), [usuarios]);

  return (
    <div className="sin-scroll">
      <Group justify="space-between" mb="sm">
        <Title order={3}>Mensajes del equipo</Title>
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<Plus size={14} />} onClick={() => setModal('directo')}>Nuevo chat</Button>
          <Button size="xs" variant="default" leftSection={<Users size={14} />} onClick={() => setModal('grupo')}>Nuevo grupo</Button>
        </Group>
      </Group>

      <Group align="stretch" gap="md" wrap="nowrap" style={{ height: 'calc(100vh - 170px)' }}>
        {/* Lista de canales */}
        <Card withBorder radius="md" p="xs" className="card" style={{ width: 280, flexShrink: 0 }}>
          <ScrollArea h="100%">
            <Stack gap={4}>
              {(canales || []).length === 0 && <Text size="sm" c="dimmed" ta="center" mt="md">Sin conversaciones aún.</Text>}
              {(canales || []).map(c => (
                <Card key={c.id} withBorder={false} radius="sm" p="xs"
                  style={{ cursor: 'pointer', background: c.id === sel ? 'var(--hover)' : 'transparent' }}
                  onClick={() => setSel(c.id)}>
                  <Group justify="space-between" gap={6} wrap="nowrap">
                    <div style={{ minWidth: 0 }}>
                      <Group gap={6} wrap="nowrap">
                        {c.tipo === 'grupo' && <Users size={13} />}
                        <Text size="sm" fw={c.no_leidos ? 700 : 500} truncate>{c.nombre}</Text>
                      </Group>
                      {c.ultimo && <Text size="xs" c="dimmed" truncate>{c.ultimo.cuerpo}</Text>}
                    </div>
                    {c.no_leidos > 0 && <Badge size="sm" circle color="red">{c.no_leidos}</Badge>}
                  </Group>
                </Card>
              ))}
            </Stack>
          </ScrollArea>
        </Card>

        {/* Conversación */}
        <Card withBorder radius="md" p="xs" className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!canalActivo ? (
            <Text size="sm" c="dimmed" ta="center" mt="xl">Elige una conversación o empieza una nueva.</Text>
          ) : (
            <>
              <Group gap={6} px="xs" pb="xs" style={{ borderBottom: '1px solid var(--hair)' }}>
                {canalActivo.tipo === 'grupo' && <Users size={15} />}
                <Text fw={600}>{canalActivo.nombre}</Text>
              </Group>
              <ScrollArea style={{ flex: 1 }} px="xs" py="sm">
                <Stack gap={8}>
                  {(mensajes || []).map(m => (
                    <div key={m.id} style={{ alignSelf: m.mio ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                      {!m.mio && canalActivo.tipo === 'grupo' && <Text size="xs" c="dimmed" mb={2}>{m.autor}</Text>}
                      <Card withBorder radius="md" p="xs" className="card" style={{ background: m.mio ? 'var(--hover)' : 'var(--card)' }}>
                        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{m.cuerpo}</Text>
                        <Text size="xs" c="dimmed" ta="right" mt={2}>{fdate(m.creado_en)}</Text>
                      </Card>
                    </div>
                  ))}
                  <div ref={finRef} />
                </Stack>
              </ScrollArea>
              <Group gap="xs" pt="xs">
                <TextInput style={{ flex: 1 }} placeholder="Escribe un mensaje…" value={texto}
                  onChange={e => setTexto(e.target.value)} onKeyDown={e => e.key === 'Enter' && texto.trim() && enviar.mutate()} data-autofocus />
                <ActionIcon size="lg" variant="filled" disabled={!texto.trim()} loading={enviar.isPending} onClick={() => enviar.mutate()} title="Enviar">
                  <Send size={16} />
                </ActionIcon>
              </Group>
            </>
          )}
        </Card>
      </Group>

      <ModalNuevo tipo={modal} onClose={() => setModal(null)} usuarios={opcionesUsuarios}
        onDirecto={id => abrirDirecto.mutate(Number(id))}
        onGrupo={(nombre, ids) => crearGrupo.mutate({ nombre, miembros: ids.map(Number) })} />
    </div>
  );
}

function ModalNuevo({ tipo, onClose, usuarios, onDirecto, onGrupo }) {
  const [uno, setUno] = useState(null);
  const [nombre, setNombre] = useState('');
  const [varios, setVarios] = useState([]);
  useEffect(() => { setUno(null); setNombre(''); setVarios([]); }, [tipo]);
  return (
    <Modal opened={!!tipo} onClose={onClose} title={tipo === 'grupo' ? 'Nuevo grupo' : 'Nuevo chat'} centered>
      {tipo === 'directo' && (
        <Stack>
          <Select label="¿Con quién?" data={usuarios} value={uno} onChange={setUno} searchable placeholder="Elige un compañero" />
          <Button disabled={!uno} onClick={() => onDirecto(uno)}>Abrir chat</Button>
        </Stack>
      )}
      {tipo === 'grupo' && (
        <Stack>
          <TextInput label="Nombre del grupo" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Turno matutino" />
          <MultiSelect label="Integrantes" data={usuarios} value={varios} onChange={setVarios} searchable placeholder="Elige al equipo" />
          <Button disabled={!nombre.trim() || varios.length < 1} onClick={() => { if (!nombre.trim()) return toastErr('Ponle nombre'); onGrupo(nombre.trim(), varios); }}>Crear grupo</Button>
        </Stack>
      )}
    </Modal>
  );
}
