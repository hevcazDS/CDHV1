// PasarelaConfig.jsx — Pasarela de pago (key-only + modo demo) — solo Prime.
// Con la key del proveedor (Stripe/Mercado Pago) se generan links reales; el
// modo demo simula el link para presentarle el sistema a un cliente sin
// contratar la pasarela. Extraído de GeneralTab.jsx, sin cambios de comportamiento.
import { useEffect, useState } from 'react';
import { Card, Group, Select, SegmentedControl, Switch, TextInput, Text, PasswordInput, Button } from '@mantine/core';
import { api } from '../../../api';
import { useTextoEmoji } from '../../../context/EmojiContext';

const PASARELAS = [
  { value: 'stripe', label: 'Stripe (secret key sk_live_…)' },
  { value: 'mercadopago', label: 'Mercado Pago (access token)' },
];

export function PasarelaConfig() {
  const txt = useTextoEmoji();
  const [c, setC] = useState({ proveedor: '', ambiente: 'live', demo: false, url_estatico: '' });
  const [apiKey, setApiKey] = useState('');
  const [flags, setFlags] = useState({});
  const [msg, setMsg] = useState(null);
  const cargar = () => api.get('/api/prime/pasarela').then(r => {
    setC({ proveedor: r.proveedor || '', ambiente: r.ambiente || 'live', demo: !!r.demo, url_estatico: r.url_estatico || '' });
    setFlags(r);
  }).catch(() => {});
  useEffect(() => { cargar(); }, []);
  const guardar = async () => {
    setMsg(null);
    const body = { ...c, ...(apiKey ? { api_key: apiKey } : {}) };
    const r = await api.put('/api/prime/pasarela', body).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setApiKey('');
    setMsg({ ok: true, t: r.demo ? txt('✅ Modo DEMO activo — los links se simulan para la presentación') : r.configurado ? txt('✅ Pasarela configurada — los links de pago se generan de verdad') : 'Guardado (faltan datos: elige proveedor y pega la key, o activa el modo demo)' });
    cargar();
  };
  const cargado = (b) => b ? <span className="chip" style={{ background: 'var(--green)', color: '#fff' }}>cargada</span> : <span className="chip">falta</span>;
  return (
    <Card withBorder radius="md" p="lg" className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Pasarela de pago (solo Prime)</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 10 }}>
        {flags.demo ? txt('🎬 Modo DEMO: los links de pago se simulan (no se cobra nada) — ideal para presentarle el sistema a un cliente.')
          : flags.configurado ? txt('✅ Pasarela ACTIVA — el botón "enviar link" en Pedidos genera un link real del proveedor.')
          : 'Con solo la API key de Stripe o Mercado Pago se generan links reales. Requiere el módulo "Link de pago" activo.'}
      </p>
      <Switch mb="sm" checked={c.demo} onChange={e => setC({ ...c, demo: e.currentTarget.checked })}
        label={txt('🎬 Modo demostración (simular el envío del link)')}
        description="Genera un link simulado con la referencia real y lo envía normal, sin llamar a ningún proveedor ni cobrar. Para presentaciones." />
      <Group grow mb="sm">
        <Select label="Proveedor" data={PASARELAS} value={c.proveedor} onChange={v => setC({ ...c, proveedor: v || '' })} clearable disabled={c.demo} />
        <SegmentedControl value={c.ambiente} onChange={v => setC({ ...c, ambiente: v })} data={[{ label: 'Pruebas', value: 'sandbox' }, { label: 'Producción', value: 'live' }]} />
      </Group>
      {!c.demo && (
        <div style={{ background: 'var(--panel-2)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 8 }}>
          <Text size="sm" fw={600} mb={4}>API key del proveedor {cargado(flags.tiene_api_key)}</Text>
          <PasswordInput placeholder={flags.tiene_api_key ? '•••••• (dejar vacío para conservar)' : 'Pega aquí la secret key / access token'} value={apiKey} onChange={e => setApiKey(e.target.value)} />
          <Text size="xs" c="dimmed" mt={6}>Solo la key: nosotros no guardamos tarjetas ni datos de pago — el proveedor hospeda la página de cobro.</Text>
        </div>
      )}
      <TextInput label="Link de pago estático (opcional)" description="Si ya tienes un link fijo (tu Clip/MP/PayPal.me), se usa como respaldo con la referencia."
        value={c.url_estatico} onChange={e => setC({ ...c, url_estatico: e.target.value })} mb="sm" />
      <Button onClick={guardar}>Guardar pasarela</Button>
      {msg && <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </Card>
  );
}
