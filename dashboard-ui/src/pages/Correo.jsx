import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Stack, Text, Title, TextInput, Textarea, Button, FileButton, Badge, Table, Skeleton, Checkbox, ActionIcon } from '@mantine/core';
import { Send, Paperclip, X } from 'lucide-react';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk, toastErr } from '../lib/ui';
import { fdate } from '../lib/format';

// Módulo de correo (Fase A): redactar + enviar con adjuntos (archivos + el cuerpo
// como PDF). La bandeja de entrada (IMAP) es una fase posterior. Ver INFORME_CORREO.md.
export default function Correo() {
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [asunto, setAsunto] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [comoPdf, setComoPdf] = useState(false);
  const [archivos, setArchivos] = useState([]);   // [{nombre, tipo, base64}]

  const { data: cfg, isLoading } = useQuery({ queryKey: ['correo-config'], queryFn: () => api.get('/api/correo/config') });
  const { data: enviados } = useQuery({ queryKey: ['correo-enviados'], queryFn: () => api.get('/api/correo/enviados') });

  const agregarArchivos = async (files) => {
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) { toastErr(`${file.name} pasa de 20 MB`); continue; }
      const base64 = await new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]+,/, '')); r.onerror = () => err(new Error('lectura')); r.readAsDataURL(file); });
      setArchivos(a => [...a, { nombre: file.name, tipo: file.type || 'application/octet-stream', base64 }]);
    }
  };

  const enviar = useMutation({
    mutationFn: () => api.post('/api/correo/enviar', {
      to: to.trim(), asunto: asunto.trim(), cuerpo,
      adjuntos_manuales: archivos,
      pdf: comoPdf ? { html: `<div style="font-family:sans-serif;white-space:pre-wrap">${cuerpo.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`, nombre: (asunto || 'mensaje').slice(0, 60) } : undefined,
    }),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); toastOk('Correo enviado' + (r.adjuntos ? ` con ${r.adjuntos} adjunto(s)` : '')); setTo(''); setAsunto(''); setCuerpo(''); setArchivos([]); setComoPdf(false); qc.invalidateQueries({ queryKey: ['correo-enviados'] }); },
    onError: handleApiError,
  });

  if (isLoading) return <Skeleton height={300} radius="md" />;
  if (!cfg?.configurado) return (
    <Card withBorder radius="md" p="lg" className="card">
      <Title order={4} mb="xs">Correo</Title>
      <Text size="sm" c="dimmed">Primero configura tu cuenta de correo (usuario + clave de aplicación de Gmail) en Prime → Configuración. Luego enciende el módulo en Módulos.</Text>
    </Card>
  );

  return (
    <div className="sin-scroll">
      <Title order={3} mb="md">Correo</Title>
      <Group align="flex-start" gap="md" wrap="wrap">
        <Card withBorder radius="md" p="md" className="card" style={{ flex: 1, minWidth: 340 }}>
          <Text size="sm" fw={600} mb="xs">Redactar</Text>
          <Stack gap="sm">
            <TextInput label="Para" placeholder="cliente@correo.com (separa varios con coma)" value={to} onChange={e => setTo(e.target.value)} />
            <TextInput label="Asunto" value={asunto} onChange={e => setAsunto(e.target.value)} />
            <Textarea label="Mensaje" autosize minRows={6} value={cuerpo} onChange={e => setCuerpo(e.target.value)} />
            <Checkbox label="Adjuntar también el mensaje como PDF" checked={comoPdf} onChange={e => setComoPdf(e.currentTarget.checked)} />
            {archivos.length > 0 && (
              <Group gap={6}>
                {archivos.map((a, i) => (
                  <Badge key={i} variant="light" rightSection={<ActionIcon size="xs" variant="transparent" onClick={() => setArchivos(x => x.filter((_, j) => j !== i))}><X size={11} /></ActionIcon>}>{a.nombre}</Badge>
                ))}
              </Group>
            )}
            <Group justify="space-between">
              <FileButton onChange={agregarArchivos} multiple>
                {(props) => <Button {...props} variant="default" leftSection={<Paperclip size={14} />}>Adjuntar archivos</Button>}
              </FileButton>
              <Button leftSection={<Send size={16} />} loading={enviar.isPending} disabled={!to.trim() || !asunto.trim()} onClick={() => enviar.mutate()}>Enviar</Button>
            </Group>
          </Stack>
        </Card>

        <Card withBorder radius="md" p="md" className="card" style={{ flex: 1, minWidth: 340 }}>
          <Text size="sm" fw={600} mb="xs">Enviados</Text>
          <Table verticalSpacing="xs">
            <tbody>
              {(enviados || []).length === 0 && <tr><td><Text size="sm" c="dimmed">Aún no has enviado correos.</Text></td></tr>}
              {(enviados || []).map(e => (
                <tr key={e.id}>
                  <td>
                    <Text size="sm" fw={500} lineClamp={1}>{e.asunto || '(sin asunto)'}</Text>
                    <Text size="xs" c="dimmed">{e.para} · {fdate(e.creado_en)}{(e.adjuntos || []).length ? ` · 📎 ${e.adjuntos.length}` : ''}</Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </Group>
    </div>
  );
}
