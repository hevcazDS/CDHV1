import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, Title, ActionIcon, Group, Button, PasswordInput, TextInput, Table } from '@mantine/core';
import { api } from '../api';
import { fdate } from '../lib/format';
import { confirmar } from '../lib/ui';
import { useTextoEmoji } from '../context/EmojiContext';

export default function Beta() {
  const txt = useTextoEmoji();
  const [codigo, setCodigo] = useState('');
  const [telefono, setTelefono] = useState('');
  const [msg, setMsg] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(false);

  const resetBeta = async () => {
    if (!codigo || !telefono) { setMsg({ ok: false, texto: 'Completa código y teléfono' }); return; }
    if (!await confirmar({ mensaje: '¿Eliminar todos los datos de prueba de este número?', peligro: true, textoOk: 'Eliminar' })) return;
    try {
      const r = await api.post('/api/beta/limpiar', { codigo, telefono });
      setMsg(r.ok ? { ok: true, texto: 'Datos eliminados correctamente' } : { ok: false, texto: '' + r.error });
    } catch (e) { setMsg({ ok: false, texto: '' + e.message }); }
  };

  const verHealth = async () => {
    try { setHealth(await api.get('/health')); setHealthError(false); }
    catch (_) { setHealth(null); setHealthError(true); }
  };

  // Fase 3: logs_error es la tabla SQL que complementa bot/logs/*.log (ver
  // migrations/0004_logs_error.sql) — validaciones rechazadas y fallos de
  // colas que antes solo se veían en el archivo de texto, ahora también
  // listables aquí sin tocar el servidor por SSH.
  const { data: errores, refetch: refetchErrores } = useQuery({
    queryKey: ['logs-error'],
    queryFn: () => api.get('/api/logs_error?limite=30').catch(() => []),
  });

  return (
    <div>
      <div className="page-title">Beta / Pruebas</div>
      <div className="page-sub">Herramientas de prueba y diagnóstico del sistema</div>

      <div className="kpi-grid">
        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="xs">{txt('🧪 Reset betatestor')}</Title>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 14 }}>Limpia datos de prueba de un número específico.</p>
          <PasswordInput label="Código de reset" placeholder="Código secreto" value={codigo} onChange={e => setCodigo(e.target.value)} mb="sm" />
          <TextInput label="Teléfono del betatestor" placeholder="5214441234567" value={telefono} onChange={e => setTelefono(e.target.value)} mb="sm" />
          <Button color="red" onClick={resetBeta}>{txt('🗑️ Limpiar datos de prueba')}</Button>
          {msg && <div className={msg.ok ? 'card' : 'login-error'} style={{ marginTop: 14 }}>{txt(msg.texto)}</div>}
        </Card>

        <Card withBorder radius="md" p="lg">
          <Title order={4} mb="md">{txt('🔍 Diagnóstico del sistema')}</Title>
          <Button variant="default" fullWidth mb={10} onClick={verHealth}>Verificar /health</Button>
          {!health && !healthError && <div className="empty">Presiona el botón para verificar</div>}
          {healthError && <div className="login-error">No se pudo conectar</div>}
          {health && <pre style={{ fontSize: 11, background: 'var(--panel-2)', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(health, null, 2)}</pre>}
        </Card>
      </div>

      <Card withBorder radius="md" p="lg" mt={14}>
        <Group justify="space-between" mb="md">
          <Title order={4}>{txt('🪵 Errores registrados')}</Title>
          <ActionIcon variant="default" onClick={() => refetchErrores()}><RefreshCw size={16} strokeWidth={1.75} /></ActionIcon>
        </Group>
        <div className="table-wrap">
          <Table highlightOnHover verticalSpacing="xs">
            <thead><tr><th>Proceso</th><th>Motivo</th><th>Contexto</th><th>Fecha</th></tr></thead>
            <tbody>
              {errores === undefined && <tr><td colSpan={4} className="empty">Cargando...</td></tr>}
              {errores?.length === 0 && <tr><td colSpan={4} className="empty">Sin errores registrados</td></tr>}
              {errores?.map(e => (
                <tr key={e.id}>
                  <td><code style={{ fontSize: 11 }}>{e.proceso}</code></td>
                  <td style={{ fontSize: 12 }}>{e.motivo}</td>
                  <td style={{ fontSize: 11, fontFamily: 'monospace', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.contexto_json || '-'}</td>
                  <td className="text-muted" style={{ fontSize: 11 }}>{fdate(e.registrado_en)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
