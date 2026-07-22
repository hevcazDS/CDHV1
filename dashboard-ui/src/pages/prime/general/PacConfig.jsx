// PacConfig.jsx — Credenciales del PAC (timbrado CFDI) — solo Prime. Queda
// armado para que al integrar el proveedor solo falte rellenar. Los secretos
// (contraseñas, .cer, .key) no se muestran de vuelta: solo un indicador
// "cargado". Facturapi/Facturama = KEY-ONLY: el PAC guarda el CSD, aquí solo
// va la API key. finkok/otro = modelo CSD propio (subir .cer/.key). Facturapi
// primero: es el más simple ("solo la key") y el timbrado real YA está
// conectado. Extraído de GeneralTab.jsx, sin cambios de comportamiento.
import { useEffect, useState } from 'react';
import { Card, Group, Select, SegmentedControl, TextInput, Text, PasswordInput, Switch, Button } from '@mantine/core';
import { api } from '../../../api';
import { useTextoEmoji } from '../../../context/EmojiContext';

const PACS = [
  { value: 'facturapi', label: 'Facturapi (recomendado — solo API key)' },
  { value: 'facturama', label: 'Facturama (usuario:contraseña como key)' },
  { value: 'finkok', label: 'Finkok (subir tu CSD)' },
  { value: 'otro', label: 'Otro (subir tu CSD)' },
];
const USOS_CFDI = ['G01', 'G03', 'P01', 'I08', 'D01', 'S01'].map(v => ({ value: v, label: v }));

export function PacConfig() {
  const txt = useTextoEmoji();
  const [c, setC] = useState({ proveedor: '', rfc: '', ambiente: 'sandbox', serie: '', uso_cfdi: 'G03', regimen_receptor: '616', cp_receptor: '', clave_prod_sat: '01010101', clave_unidad: 'H87' });
  const [sec, setSec] = useState({ password: '', csd_pass: '', api_key: '' });
  const [cifrado, setCifrado] = useState(true);
  const [flags, setFlags] = useState({});
  const [msg, setMsg] = useState(null);
  const cargar = () => api.get('/api/prime/pac').then(r => {
    setC({ proveedor: r.proveedor || '', rfc: r.rfc || '', ambiente: r.ambiente || 'sandbox', serie: r.serie || '',
      uso_cfdi: r.uso_cfdi || 'G03', regimen_receptor: r.regimen_receptor || '616', cp_receptor: r.cp_receptor || '',
      clave_prod_sat: r.clave_prod_sat || '01010101', clave_unidad: r.clave_unidad || 'H87' });
    setCifrado(r.cifrado_activo !== false); setFlags(r);
  }).catch(() => {});
  useEffect(() => { cargar(); }, []);
  const keyOnly = c.proveedor === 'facturapi' || c.proveedor === 'facturama';
  const subirArchivo = (campo) => (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { const b64 = String(rd.result).split(',').pop(); guardar({ [campo]: b64 }); };
    rd.readAsDataURL(f); e.target.value = '';
  };
  const guardar = async (extra = {}) => {
    setMsg(null);
    const body = { ...c, cifrado_activo: cifrado, ...(sec.api_key ? { api_key: sec.api_key } : {}), ...(sec.password ? { password: sec.password } : {}), ...(sec.csd_pass ? { csd_pass: sec.csd_pass } : {}), ...extra };
    const r = await api.put('/api/prime/pac', body).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setSec({ password: '', csd_pass: '', api_key: '' });
    setMsg({ ok: true, t: r.activo ? txt('✅ PAC activo — ya puedes timbrar') : r.configurado ? 'Guardado. Activa el módulo Facturación para timbrar.' : 'Guardado (faltan datos para timbrar)' });
    cargar();
  };
  const cargado = (b) => b ? <span className="chip" style={{ background: 'var(--green)', color: '#fff' }}>cargado</span> : <span className="chip">falta</span>;
  return (
    <Card withBorder radius="md" p="lg" className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Facturación electrónica — PAC (solo Prime)</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 10 }}>
        {flags.activo ? txt('✅ Timbrado ACTIVO — las ventas con datos fiscales ya se pueden timbrar (CFDI 4.0).')
          : flags.configurado ? 'Credenciales completas — activa el módulo Facturación en Módulos para timbrar.'
          : 'Con Facturapi solo necesitas tu API key: sube tu CSD una vez en el portal del PAC y pega aquí la key.'}
      </p>
      <Group grow mb="sm">
        <Select label="Proveedor (PAC)" data={PACS} value={c.proveedor} onChange={v => setC({ ...c, proveedor: v || '' })} clearable />
        <SegmentedControl value={c.ambiente} onChange={v => setC({ ...c, ambiente: v })} data={[{ label: 'Pruebas', value: 'sandbox' }, { label: 'Producción', value: 'produccion' }]} />
      </Group>
      <Group grow mb="sm">
        <TextInput label="RFC emisor" value={c.rfc} onChange={e => setC({ ...c, rfc: e.target.value })} />
        <TextInput label="Serie (opcional)" value={c.serie} onChange={e => setC({ ...c, serie: e.target.value })} />
      </Group>

      {keyOnly ? (
        <div style={{ background: 'var(--panel-2)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 8 }}>
          <Text size="sm" fw={600} mb={4}>API key {c.proveedor === 'facturapi' ? '(sk_live_… o sk_test_…)' : '(usuario:contraseña)'} {cargado(flags.tiene_api_key)}</Text>
          <PasswordInput placeholder={flags.tiene_api_key ? '•••••• (dejar vacío para conservar)' : 'Pega aquí tu API key del PAC'} value={sec.api_key} onChange={e => setSec({ ...sec, api_key: e.target.value })} />
          <Text size="xs" c="dimmed" mt={6}>El certificado CSD lo subes una vez en el portal de {c.proveedor === 'facturapi' ? 'Facturapi' : 'Facturama'}. Aquí solo va la key: no manejamos tus certificados.</Text>
        </div>
      ) : (
        <Group mb="sm" gap="lg">
          <div><Text size="xs" mb={4}>Certificado .cer {cargado(flags.tiene_csd_cer)}</Text><Button size="xs" variant="default" component="label">Subir .cer<input hidden type="file" accept=".cer,.pem" onChange={subirArchivo('csd_cer')} /></Button></div>
          <div><Text size="xs" mb={4}>Llave .key {cargado(flags.tiene_csd_key)}</Text><Button size="xs" variant="default" component="label">Subir .key<input hidden type="file" accept=".key,.pem" onChange={subirArchivo('csd_key')} /></Button></div>
          <PasswordInput label={'Contraseña de la llave ' + (flags.tiene_csd_pass ? '(cargada)' : '')} value={sec.csd_pass} onChange={e => setSec({ ...sec, csd_pass: e.target.value })} style={{ flex: 1 }} />
        </Group>
      )}

      <Text size="xs" fw={600} mt="sm" mb={4}>Valores SAT por defecto (se usan al timbrar cada venta)</Text>
      <Group grow mb="sm">
        <Select label="Uso de CFDI" data={USOS_CFDI} value={c.uso_cfdi} onChange={v => setC({ ...c, uso_cfdi: v || 'G03' })} allowDeselect={false} />
        <TextInput label="Régimen receptor" value={c.regimen_receptor} onChange={e => setC({ ...c, regimen_receptor: e.target.value })} />
        <TextInput label="CP receptor (default)" value={c.cp_receptor} onChange={e => setC({ ...c, cp_receptor: e.target.value })} />
      </Group>
      <Group grow mb="sm">
        <TextInput label="Clave producto SAT (default)" value={c.clave_prod_sat} onChange={e => setC({ ...c, clave_prod_sat: e.target.value })} />
        <TextInput label="Clave unidad SAT" value={c.clave_unidad} onChange={e => setC({ ...c, clave_unidad: e.target.value })} />
      </Group>

      <Switch mt="md" mb="sm" checked={cifrado} onChange={e => setCifrado(e.currentTarget.checked)}
        label="Cifrar las credenciales guardadas (recomendado)"
        description="Cifra la API key/contraseñas en la base con la clave de esta instancia." />
      <Button onClick={() => guardar()}>Guardar configuración del PAC</Button>
      {msg && <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </Card>
  );
}
