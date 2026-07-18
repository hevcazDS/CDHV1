import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Stack, Text, Title, TextInput, Textarea, Button, FileButton, Badge, Table, Skeleton, Checkbox, ActionIcon, SegmentedControl, Modal } from '@mantine/core';
import { Send, Paperclip, X, RefreshCw, Inbox, Mail } from 'lucide-react';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk, toastErr } from '../lib/ui';
import { fdate } from '../lib/format';

// Módulo de correo: bandeja de entrada (IMAP), enviados y redacción con adjuntos
// (archivos + el cuerpo como PDF). Una sola pantalla con tres vistas segmentadas.
export default function Correo() {
  const [vista, setVista] = useState('bandeja');
  const [abierto, setAbierto] = useState(null);  // correo entrante en lectura

  const { data: cfg, isLoading } = useQuery({ queryKey: ['correo-config'], queryFn: () => api.get('/api/correo/config') });

  if (isLoading) return <Skeleton height={300} radius="md" />;
  if (!cfg?.configurado) return (
    <Card withBorder radius="md" p="lg" className="card">
      <Title order={4} mb="xs">Correo</Title>
      <Text size="sm" c="dimmed">Primero configura el correo de la tienda (usuario + clave de aplicación de Gmail) en Prime → Configuración. Luego enciende el módulo en Módulos.</Text>
    </Card>
  );

  return (
    <div className="sin-scroll">
      <Group justify="space-between" mb="md" align="center">
        <Title order={3}>Correo</Title>
        <SegmentedControl
          value={vista} onChange={setVista}
          data={[
            { value: 'bandeja', label: <Group gap={6} wrap="nowrap"><Inbox size={14} /> Bandeja{cfg.sin_leer ? <Badge size="xs" circle>{cfg.sin_leer}</Badge> : null}</Group> },
            { value: 'enviados', label: <Group gap={6} wrap="nowrap"><Mail size={14} /> Enviados</Group> },
            { value: 'redactar', label: <Group gap={6} wrap="nowrap"><Send size={14} /> Redactar</Group> },
          ]}
        />
      </Group>

      {vista === 'bandeja' && <Bandeja onAbrir={setAbierto} />}
      {vista === 'enviados' && <Enviados />}
      {vista === 'redactar' && <Redactar onEnviado={() => setVista('enviados')} />}

      <Modal opened={!!abierto} onClose={() => setAbierto(null)} title={abierto?.asunto || '(sin asunto)'} size="lg">
        {abierto && (
          <Stack gap="xs">
            <Text size="xs" c="dimmed">{abierto.de} · {fdate(abierto.fecha)}</Text>
            {(abierto.adjuntos || []).length > 0 && (
              <Group gap={6}>{abierto.adjuntos.map((a, i) => <Badge key={i} variant="light" leftSection={<Paperclip size={11} />}>{a.nombre}</Badge>)}</Group>
            )}
            {/* HTML de remitentes arbitrarios: iframe sandbox SIN allow-scripts
                neutraliza JS/onerror sin dependencia de sanitización. */}
            <iframe title="correo" sandbox="" srcDoc={abierto.cuerpo || ''} style={{ width: '100%', height: 420, border: 0 }} />
          </Stack>
        )}
      </Modal>
    </div>
  );
}

function Bandeja({ onAbrir }) {
  const qc = useQueryClient();
  const { data: correos, isLoading } = useQuery({ queryKey: ['correo-bandeja'], queryFn: () => api.get('/api/correo/bandeja') });
  const sync = useMutation({
    mutationFn: () => api.post('/api/correo/sincronizar', {}),
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); toastOk(r.nuevos ? `${r.nuevos} correo(s) nuevo(s)` : 'Bandeja al día'); qc.invalidateQueries({ queryKey: ['correo-bandeja'] }); qc.invalidateQueries({ queryKey: ['correo-config'] }); },
    onError: handleApiError,
  });
  const abrir = useMutation({
    mutationFn: (c) => api.post(`/api/correo/${c.id}/leido`, {}),
    onSuccess: (_, c) => { qc.invalidateQueries({ queryKey: ['correo-bandeja'] }); qc.invalidateQueries({ queryKey: ['correo-config'] }); },
  });

  return (
    <Card withBorder radius="md" p="md" className="card">
      <Group justify="space-between" mb="xs">
        <Text size="sm" fw={600}>Bandeja de entrada</Text>
        <Button size="xs" variant="default" leftSection={<RefreshCw size={14} />} loading={sync.isPending} onClick={() => sync.mutate()}>Sincronizar</Button>
      </Group>
      {isLoading ? <Skeleton height={200} /> : (
        <Table verticalSpacing="xs" highlightOnHover>
          <tbody>
            {(correos || []).length === 0 && <tr><td><Text size="sm" c="dimmed">No hay correos. Pulsa «Sincronizar» para bajar los del buzón.</Text></td></tr>}
            {(correos || []).map(c => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => { onAbrir(c); if (!c.leido) abrir.mutate(c); }}>
                <td>
                  <Text size="sm" fw={c.leido ? 400 : 700} lineClamp={1}>{c.leido ? '' : '● '}{c.asunto || '(sin asunto)'}</Text>
                  <Text size="xs" c="dimmed">{c.de} · {fdate(c.fecha)}{(c.adjuntos || []).length ? ` · 📎 ${c.adjuntos.length}` : ''}</Text>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Enviados() {
  const { data: enviados, isLoading } = useQuery({ queryKey: ['correo-enviados'], queryFn: () => api.get('/api/correo/enviados') });
  return (
    <Card withBorder radius="md" p="md" className="card">
      <Text size="sm" fw={600} mb="xs">Enviados</Text>
      {isLoading ? <Skeleton height={200} /> : (
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
      )}
    </Card>
  );
}

function Redactar({ onEnviado }) {
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [asunto, setAsunto] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [comoPdf, setComoPdf] = useState(false);
  const [archivos, setArchivos] = useState([]);

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
    onSuccess: (r) => { if (!r.ok) return handleApiError(new Error(r.error)); toastOk('Correo enviado' + (r.adjuntos ? ` con ${r.adjuntos} adjunto(s)` : '')); setTo(''); setAsunto(''); setCuerpo(''); setArchivos([]); setComoPdf(false); qc.invalidateQueries({ queryKey: ['correo-enviados'] }); onEnviado?.(); },
    onError: handleApiError,
  });

  return (
    <Card withBorder radius="md" p="md" className="card" style={{ maxWidth: 640 }}>
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
  );
}
