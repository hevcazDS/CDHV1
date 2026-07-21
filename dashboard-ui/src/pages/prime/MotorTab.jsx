import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Text, Group, Badge, Button, Select, Modal, Menu } from '@mantine/core';
import { History, MessageCircle } from 'lucide-react';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';
import { toastOk } from '../../lib/ui';
import { fdate } from '../../lib/format';
import MotorCanvas, { SimuladorChat } from './MotorCanvas';

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
  // Mostrar 10, pero garantizar que la versión activa siempre aparezca (si es
  // vieja y quedó fuera del top 10, se agrega al final para poder verla/no-perderla).
  const _todas = vers?.versiones || [];
  const _top = _todas.slice(0, 10);
  const _act = _todas.find(v => v.id === vers?.activo_id);
  const versiones = (_act && !_top.some(v => v.id === _act.id)) ? [..._top, _act] : _top;

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
                {versiones.map(v => (
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
