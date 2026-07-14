import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Textarea, Text, Group } from '@mantine/core';
import { api } from '../../api';
import { handleApiError } from '../../lib/apiError';

// Editor del bot (prime): personaliza CADA respuesta de esta instancia por
// encima del tono y del giro. Vacío = vuelve al texto del giro/tono.
export default function BotEditorTab() {
  const qc = useQueryClient();
  const [edits, setEdits] = useState({}); // clave → texto en edición

  const { data } = useQuery({ queryKey: ['prime-frases'], queryFn: () => api.get('/api/prime/frases') });

  const guardar = useMutation({
    mutationFn: ({ clave, texto }) => api.put('/api/prime/frases', { clave, texto }),
    onSuccess: (r, { clave }) => {
      if (!r.ok) return handleApiError(new Error(r.error));
      setEdits(e => { const n = { ...e }; delete n[clave]; return n; });
      qc.invalidateQueries({ queryKey: ['prime-frases'] });
    },
    onError: handleApiError,
  });

  if (!data) return <div className="empty cargando">Cargando frases del bot...</div>;

  return (
    <div>
      <Card withBorder radius="md" p="md" className="card" mb="lg">
        <Text size="sm">
          Personaliza lo que responde el bot <strong>en esta instancia</strong>. Lo que escribas gana sobre el tono y el giro;
          deja el campo vacío y guarda para volver al texto original. El bot aplica los cambios en menos de un minuto, sin reiniciar.
        </Text>
        <Text size="xs" c="dimmed" mt={6}>Variables disponibles: <code>{data.variables}</code></Text>
      </Card>

      {data.frases.map(f => {
        const enEdicion = edits[f.clave] !== undefined;
        const valor = enEdicion ? edits[f.clave] : (f.override || '');
        return (
          <Card key={f.clave} withBorder radius="md" p="lg" className="card" mb="md">
            <div className="card-header">
              <h3>{f.descripcion}</h3>
              <Group gap="xs">
                {f.override && <span className="badge badge-azul">personalizada</span>}
                <Text size="xs" c="dimmed">{f.clave}</Text>
              </Group>
            </div>
            <Text size="xs" c="dimmed" mb={6}>Hoy el cliente ve:</Text>
            <div style={{ background: 'var(--panel-2)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: 10 }}>
              {f.efectivo || <em>(vacía)</em>}
            </div>
            <Textarea autosize minRows={2} placeholder="Escribe aquí tu versión personalizada (vacío = usar la original)..."
              value={valor} onChange={e => setEdits({ ...edits, [f.clave]: e.target.value })} mb="sm"
              styles={{ input: { fontSize: 13 } }} />
            <Group gap="xs">
              <Button size="xs" disabled={!enEdicion || guardar.isPending}
                onClick={() => guardar.mutate({ clave: f.clave, texto: edits[f.clave] })}>
                Guardar
              </Button>
              {f.override && (
                <Button size="xs" variant="default" disabled={guardar.isPending}
                  onClick={() => guardar.mutate({ clave: f.clave, texto: '' })}>
                  Restablecer original
                </Button>
              )}
            </Group>
          </Card>
        );
      })}
    </div>
  );
}
