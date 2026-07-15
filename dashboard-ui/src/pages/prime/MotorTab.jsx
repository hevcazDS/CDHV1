import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Text, Group, Badge, Button, Select, Modal, Menu, Drawer, TextInput, ActionIcon } from '@mantine/core';
import { History, MessageCircle, RotateCcw, Send } from 'lucide-react';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import { toastOk } from '../../lib/ui';
import { fdate } from '../../lib/format';
import MotorCanvas from './MotorCanvas';

// Simulador de conversación (menor #2): chat de prueba contra el grafo activo,
// SIN WhatsApp y SIN efectos (el backend nunca ejecuta acciones ni código base
// — solo reporta qué haría). El estado paso/data vive aquí, no en sesiones.
function SimuladorChat({ abierto, onClose }) {
  const [msgs, setMsgs] = useState([]);        // { de: 'bot'|'yo'|'nota', texto }
  const [texto, setTexto] = useState('');
  const [paso, setPaso] = useState(null);
  const finRef = useRef(null);

  const empujar = (r) => {
    setPaso(r.paso);
    setMsgs(m => [
      ...m,
      ...(r.respuesta ? [{ de: 'bot', texto: r.respuesta }] : []),
      ...(r.nota ? [{ de: 'nota', texto: r.nota }] : []),
    ]);
  };
  const iniciar = async () => {
    setMsgs([]); setPaso(null);
    const r = await api.post('/api/prime/motor/simular', { inicio: true });
    if (!r.ok) return handleApiError(new Error(r.error));
    empujar(r);
  };
  useEffect(() => { if (abierto) iniciar(); }, [abierto]);           // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || !paso) return;
    setTexto('');
    setMsgs(m => [...m, { de: 'yo', texto: t }]);
    const r = await api.post('/api/prime/motor/simular', { paso, texto: t });
    if (!r.ok) return handleApiError(new Error(r.error));
    empujar(r);
  };

  return (
    <Drawer opened={abierto} onClose={onClose} position="right" size="sm"
      title={<Group gap={6}><MessageCircle size={16} /><Text fw={600} size="sm">Probar el flujo</Text>{paso && <Badge size="xs" variant="light">{paso}</Badge>}</Group>}>
      <Text size="xs" c="dimmed" mb="sm">
        Prueba tus piezas y cables sin WhatsApp. Nada se ejecuta de verdad: las piezas del
        flujo base y las acciones solo se anuncian.
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 220, maxHeight: '55vh', overflowY: 'auto', marginBottom: 12 }}>
        {msgs.map((m, i) => m.de === 'nota'
          ? <Text key={i} size="xs" c="dimmed" fs="italic">ℹ {m.texto}</Text>
          : (
            <Card key={i} withBorder radius="md" p="xs" className="card"
              style={{ alignSelf: m.de === 'yo' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{m.texto}</Text>
            </Card>
          ))}
        <div ref={finRef} />
      </div>
      <Group gap="xs">
        <TextInput style={{ flex: 1 }} size="xs" placeholder="Escribe como el cliente…"
          value={texto} onChange={e => setTexto(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && enviar()} data-autofocus />
        <ActionIcon variant="filled" onClick={enviar} title="Enviar"><Send size={14} /></ActionIcon>
        <ActionIcon variant="default" onClick={iniciar} title="Reiniciar la conversación"><RotateCcw size={14} /></ActionIcon>
      </Group>
    </Drawer>
  );
}

// Editor del motor de flujo (prime). Lienzo visual (MotorCanvas, React Flow) del
// grafo ACTIVO + selector para SUSTITUIRLO por una plantilla congelada (con
// confirmación — pisa el flujo actual, que queda como versión para restaurar) +
// historial de versiones con "Restaurar" (M4). El servidor lintea y aplica la
// frontera de seguridad antes de persistir cualquier cambio.
export default function MotorTab() {
  const qc = useQueryClient();
  const [sel, setSel] = useState(null);
  const [confirmar, setConfirmar] = useState(false);
  const [probar, setProbar] = useState(false);

  const { data } = useQuery({ queryKey: ['prime-motor'], queryFn: () => api.get('/api/prime/motor') });
  const { data: plas } = useQuery({ queryKey: ['prime-motor-plantillas'], queryFn: () => api.get('/api/prime/motor/plantillas') });
  const { data: vers } = useQuery({ queryKey: ['prime-motor-versiones'], queryFn: () => api.get('/api/prime/motor/versiones') });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['prime-motor'] });
    qc.invalidateQueries({ queryKey: ['prime-motor-versiones'] });
  };

  const activar = useMutation({
    mutationFn: (plantilla) => api.post('/api/prime/motor/activar', { plantilla }),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.errs ? r.error + ': ' + r.errs.join('; ') : r.error));
      setConfirmar(false);
      refrescar();
    },
    onError: handleApiError,
  });

  const revertir = useMutation({
    mutationFn: (id) => api.post('/api/prime/motor/revertir', { id }),
    onSuccess: (r) => {
      if (!r.ok) return handleApiError(new Error(r.errs ? r.error + ': ' + r.errs.join('; ') : r.error));
      toastOk('Versión ' + r.version + ' restaurada');
      refrescar();
    },
    onError: handleApiError,
  });

  if (!data) return <div className="empty cargando">Cargando motor de flujo...</div>;
  const opciones = (plas?.plantillas || []).map(p => ({ value: p, label: p }));
  const versiones = vers?.versiones || [];

  return (
    <div>
      <Card withBorder radius="md" p="md" className="card" mb="lg">
        <Group justify="space-between" mb={6}>
          <Text size="sm" fw={600}>Flujo del bot (motor)</Text>
          <Badge color={data.motor_activo ? 'green' : 'gray'}>{data.motor_activo ? 'motor ON' : 'motor OFF'}</Badge>
        </Group>
        {data.activo
          ? <Text size="sm">Flujo actual: <strong>{data.giro_base}</strong> · {data.nodos.length} piezas.</Text>
          : <Text size="sm" c="dimmed">Aún no hay un flujo cargado. Elige un diseño listo abajo y actívalo para verlo y editarlo.</Text>}
        <Text size="xs" c="dimmed" mt={6}>
          {data.motor_activo
            ? 'El bot está usando este flujo para conversar.'
            : 'Puedes ver y editar el flujo aunque el motor esté apagado (se enciende en Módulos). Apagado, el bot responde con el flujo base de siempre.'}
        </Text>
        <Group gap="xs" mt="sm" align="flex-end">
          <Select label="Diseños listos para usar" placeholder="Elige uno" data={opciones} value={sel} onChange={setSel} style={{ width: 240 }} size="xs" />
          <Button size="xs" loading={activar.isPending} disabled={!sel}
            onClick={() => (data.activo ? setConfirmar(true) : activar.mutate(sel))}>
            {data.activo ? 'Cambiar a este diseño' : 'Usar este diseño'}
          </Button>
          {data.activo && (
            <Button size="xs" variant="default" leftSection={<MessageCircle size={14} />} onClick={() => setProbar(true)}>
              Probar flujo
            </Button>
          )}
          {versiones.length > 1 && (
            <Menu shadow="md" width={320} position="bottom-end">
              <Menu.Target>
                <Button size="xs" variant="default" leftSection={<History size={14} />}>Versiones</Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Historial — restaurar una versión anterior</Menu.Label>
                {versiones.slice(0, 10).map(v => (
                  <Menu.Item key={v.id} disabled={!!v.activo || revertir.isPending}
                    onClick={() => revertir.mutate(v.id)}
                    rightSection={v.activo ? <Badge size="xs" color="green">activa</Badge> : <Text size="xs" c="dimmed">restaurar</Text>}>
                    v{v.version} · {v.giro_base || 'personalizado'} · {v.nodos} piezas · {fdate(v.creado_en)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Card>

      {data.activo
        ? <MotorCanvas key={data.id + ':' + data.nodos.length} data={data} />
        : (
          <Card withBorder radius="md" p="lg" className="card">
            <Text size="sm" c="dimmed">Activa un diseño arriba para abrir el editor visual del flujo.</Text>
          </Card>
        )}

      <SimuladorChat abierto={probar} onClose={() => setProbar(false)} />

      <Modal opened={confirmar} onClose={() => setConfirmar(false)} title="¿Cambiar el flujo del bot?" centered size="sm">
        <Text size="sm">
          Vas a reemplazar el flujo actual (<strong>{data.giro_base}</strong>) por el diseño <strong>{sel}</strong>.
          El flujo actual, con sus ediciones, quedará guardado en <strong>Versiones</strong> y podrás restaurarlo.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirmar(false)}>Cancelar</Button>
          <Button color="red" loading={activar.isPending} onClick={() => activar.mutate(sel)}>Sí, cambiar</Button>
        </Group>
      </Modal>
    </div>
  );
}
