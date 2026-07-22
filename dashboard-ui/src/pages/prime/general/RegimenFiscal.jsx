// RegimenFiscal.jsx — Régimen fiscal del negocio (solo Prime). Referencia +
// congruencia: RESICO y persona física usan IVA base flujo de efectivo (lo
// que hace el sistema). Extraído de GeneralTab.jsx, sin cambios de comportamiento.
import { useEffect, useState } from 'react';
import { Card, Group, Select, Button } from '@mantine/core';
import { api } from '../../../api';

const REGIMENES = [
  { value: 'resico', label: 'RESICO (Régimen Simplificado de Confianza)' },
  { value: 'persona_fisica', label: 'Persona física con actividad empresarial' },
  { value: 'persona_moral', label: 'Persona moral (régimen general)' },
  { value: 'otro', label: 'Otro / no aplica' },
];

export function RegimenFiscal() {
  const [reg, setReg] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.get('/api/regimen-fiscal').then(r => setReg(r.regimen_fiscal || '')).catch(() => {}); }, []);
  const guardar = async () => {
    setMsg(null);
    const r = await api.put('/api/regimen-fiscal', { regimen_fiscal: reg }).catch(e => ({ ok: false, error: e.message }));
    setMsg(r.ok ? { ok: true, t: 'Régimen guardado' } : { ok: false, t: r.error });
  };
  return (
    <Card withBorder radius="md" p="lg" className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h3>Régimen fiscal (solo Prime)</h3></div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 8 }}>
        Para tu contador y para la congruencia del IVA. <strong>RESICO</strong> y <strong>persona física</strong> tributan en base flujo de efectivo (IVA al cobro), que es como opera el sistema. Verifica que tu RFC esté en el mismo régimen ante el SAT.
      </p>
      <Group align="end">
        <Select label="Régimen del negocio" data={REGIMENES} value={reg} onChange={v => setReg(v || '')} style={{ flex: 1, maxWidth: 420 }} clearable />
        <Button onClick={guardar} disabled={!reg}>Guardar</Button>
      </Group>
      {msg && <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
    </Card>
  );
}
