import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Group, Stack, Text, Title, TextInput, Textarea, Button, FileButton, Badge, Table, Skeleton, Checkbox, ActionIcon, SegmentedControl, Modal, PasswordInput } from '@mantine/core';
import { Send, Paperclip, X, RefreshCw, Inbox, Mail, Settings } from 'lucide-react';
import { api } from '../api';
import { handleApiError } from '../lib/apiError';
import { toastOk, toastErr } from '../lib/ui';
import { fdate } from '../lib/format';

// Módulo de correo: bandeja de entrada (IMAP), enviados y redacción con adjuntos
// (archivos + el cuerpo como PDF). Una sola pantalla con tres vistas segmentadas.
// extrae la dirección de un "Nombre <correo@x>" para poder responder
function soloCorreo(de) { const m = /<([^>]+)>/.exec(de || ''); return (m ? m[1] : (de || '')).trim(); }

export default function Correo() {
  const [vista, setVista] = useState('bandeja');
  const [abierto, setAbierto] = useState(null);  // correo entrante en lectura
  const [prefill, setPrefill] = useState(null);   // { to, asunto } al responder

  const responder = (c) => { setPrefill({ to: soloCorreo(c.de), asunto: /^re:/i.test(c.asunto || '') ? c.asunto : `Re: ${c.asunto || ''}` }); setAbierto(null); setVista('redactar'); };

  const { data: cfg, isLoading } = useQuery({ queryKey: ['correo-config'], queryFn: () => api.get('/api/correo/config') });

  if (isLoading) return <Skeleton height={300} radius="md" />;
  if (!cfg?.configurado) return (
    <div className="sin-scroll">
      <Title order={3} mb="md">Correo</Title>
      <Configuracion primeraVez />
    </div>
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
            { value: 'config', label: <Group gap={6} wrap="nowrap"><Settings size={14} /> Cuenta</Group> },
          ]}
        />
      </Group>

      {vista === 'config' && <Configuracion />}
      {vista === 'bandeja' && <Bandeja onAbrir={setAbierto} />}
      {vista === 'enviados' && <Enviados />}
      {vista === 'redactar' && <Redactar prefill={prefill} onEnviado={() => setVista('enviados')} />}

      <Modal opened={!!abierto} onClose={() => setAbierto(null)} title={abierto?.asunto || '(sin asunto)'} size="lg">
        {abierto && (
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Text size="xs" c="dimmed">{abierto.de} · {fdate(abierto.fecha)}</Text>
              <Button size="xs" variant="light" leftSection={<Send size={13} />} onClick={() => responder(abierto)}>Responder</Button>
            </Group>
            {(abierto.adjuntos || []).length > 0 && (
              // descarga forzada por el servidor (tipo neutro): el navegador nunca lo abre
              <Group gap={6}>{abierto.adjuntos.map((a, i) => (
                <Badge key={i} component="a" href={`/api/correo/${abierto.id}/adjunto/${i}`} style={{ cursor: 'pointer' }} variant="light" leftSection={<Paperclip size={11} />}>{a.nombre}</Badge>
              ))}</Group>
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

// Cuenta de correo de la tienda (guardada en la BD, no en el .env). Accesible a
// gerente y prime — los respaldos usan una cuenta aparte, la del .env.
function Configuracion({ primeraVez }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['correo-cuenta'], queryFn: () => api.get('/api/prime/config-email-bot') });
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const yaConfig = !!data?.bot_email_password_configurada;
  useEffect(() => { if (data?.bot_email_usuario) setUsuario(data.bot_email_usuario); }, [data?.bot_email_usuario]);

  const guardar = useMutation({
    mutationFn: () => api.put('/api/prime/config-email-bot', { bot_email_usuario: usuario.trim(), ...(password ? { bot_email_password: password } : {}) }),
    onSuccess: (r) => { if (r && r.ok === false) return handleApiError(new Error(r.error)); toastOk('Cuenta guardada'); setPassword(''); qc.invalidateQueries({ queryKey: ['correo-cuenta'] }); qc.invalidateQueries({ queryKey: ['correo-config'] }); },
    onError: handleApiError,
  });

  return (
    <Card withBorder radius="md" p="md" className="card" style={{ maxWidth: 560 }}>
      <Text size="sm" fw={600} mb={4}>Cuenta de correo de la tienda</Text>
      <Text size="xs" c="dimmed" mb="sm">
        {primeraVez ? 'Configura el correo para poder enviar y recibir. ' : ''}
        Correo Gmail + contraseña de aplicación (no la contraseña normal). Se guarda por instancia
        en la base de datos; los respaldos usan otra cuenta, la del servidor.
      </Text>
      {isLoading ? <Skeleton height={120} /> : (
        <Stack gap="sm">
          <TextInput label="Correo" placeholder="tienda@gmail.com" value={usuario} onChange={e => setUsuario(e.target.value)} />
          <PasswordInput
            label={'Contraseña de aplicación' + (yaConfig ? ' (ya configurada — deja vacío para no cambiarla)' : '')}
            placeholder="xxxx xxxx xxxx xxxx" value={password} onChange={e => setPassword(e.target.value)}
          />
          <Group justify="flex-end">
            <Button loading={guardar.isPending} disabled={!usuario.trim() || (!yaConfig && !password)} onClick={() => guardar.mutate()}>Guardar</Button>
          </Group>
        </Stack>
      )}
    </Card>
  );
}

function Redactar({ onEnviado, prefill }) {
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [asunto, setAsunto] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [comoPdf, setComoPdf] = useState(false);
  const [archivos, setArchivos] = useState([]);
  // al pulsar "Responder" en la bandeja: prellena destinatario y asunto
  useEffect(() => { if (prefill) { setTo(prefill.to || ''); setAsunto(prefill.asunto || ''); } }, [prefill]);

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
