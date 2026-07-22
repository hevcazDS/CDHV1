// ZonaHoraria.jsx — Zona horaria del negocio (candado: solo Prime). Por
// defecto México Centro. Cambiarla queda en la bitácora y requiere reiniciar
// los procesos. Extraído de GeneralTab.jsx, sin cambios de comportamiento.
import { useEffect, useState } from 'react';
import { Card, Group, Select, Button } from '@mantine/core';
import { api } from '../../../api';

const ZONAS_MX = [
  { value: 'America/Mexico_City', label: 'Centro — CDMX, Guadalajara, Monterrey' },
  { value: 'America/Cancun', label: 'Sureste — Quintana Roo (Cancún)' },
  { value: 'America/Merida', label: 'Yucatán / Sureste (Mérida)' },
  { value: 'America/Mazatlan', label: 'Pacífico — Sinaloa, Nayarit, BCS' },
  { value: 'America/Chihuahua', label: 'Chihuahua' },
  { value: 'America/Hermosillo', label: 'Sonora (sin horario de verano)' },
  { value: 'America/Tijuana', label: 'Noroeste — Baja California (Tijuana)' },
];

export function ZonaHoraria() {
  const [info, setInfo] = useState(null);
  const [zona, setZona] = useState('America/Mexico_City');
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.get('/api/zona-horaria').then(r => { setInfo(r); setZona(r.configurada || r.default); }).catch(() => {}); }, []);
  const guardar = async () => {
    setMsg(null);
    const r = await api.put('/api/zona-horaria', { zona }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setMsg({ ok: true, t: 'Guardada. Reinicia el sistema (o el bridge) para que tome efecto.' });
    api.get('/api/zona-horaria').then(setInfo);
  };
  return (
    <Card withBorder radius="md" p="lg" className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Zona horaria (solo Prime)</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 8 }}>
        Por defecto <strong>México Centro</strong>. El sistema siempre calcula la hora en esta zona, aunque el servidor esté en otra.
        Efectiva ahora: <strong>{info?.efectiva || '...'}</strong>. Solo Prime puede cambiarla y queda registrado quién lo hizo.
        <br />La app <strong>no puede bloquear el reloj del servidor</strong> (eso es del sistema operativo): lo <strong>vigila</strong> y registra en la bitácora si retrocede.
      </p>
      <Group align="end">
        <Select label="Zona del negocio" data={ZONAS_MX} value={zona} onChange={v => setZona(v || 'America/Mexico_City')} searchable style={{ flex: 1, maxWidth: 420 }} allowDeselect={false} />
        <Button onClick={guardar}>Guardar</Button>
      </Group>
      {msg && <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </Card>
  );
}
