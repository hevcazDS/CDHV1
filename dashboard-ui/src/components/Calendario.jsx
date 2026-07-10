import { useState, useEffect } from 'react';
import { Group, Button, SegmentedControl, Text } from '@mantine/core';

// Calendario reutilizable (día/semana/mes) para "eventos" sobre fechas.
// eventos: [{ fecha:'YYYY-MM-DD', hora?:'HH:MM', titulo, sub?, color? }]
// Gestiona vista+fecha internamente y avisa el rango visible con onRango
// (desde, hasta) para que el padre cargue solo lo necesario.
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function Calendario({ eventos = [], onRango, onClickDia, vistaInicial = 'mes' }) {
  const [vista, setVista] = useState(vistaInicial);
  const [ancla, setAncla] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });

  // Rango visible según la vista → avisa al padre para que cargue
  useEffect(() => {
    let desde, hasta;
    if (vista === 'dia') { desde = hasta = new Date(ancla); }
    else if (vista === 'semana') { desde = new Date(ancla); desde.setDate(ancla.getDate() - ancla.getDay()); hasta = new Date(desde); hasta.setDate(desde.getDate() + 6); }
    else { desde = new Date(ancla.getFullYear(), ancla.getMonth(), 1); hasta = new Date(ancla.getFullYear(), ancla.getMonth() + 1, 0); }
    onRango && onRango(iso(desde), iso(hasta));
  }, [vista, ancla]); // eslint-disable-line

  const mover = (dir) => {
    const d = new Date(ancla);
    if (vista === 'dia') d.setDate(d.getDate() + dir);
    else if (vista === 'semana') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setAncla(d);
  };

  const porDia = eventos.reduce((m, e) => ((m[e.fecha] = m[e.fecha] || []).push(e), m), {});
  const hoyISO = iso(new Date());
  const chip = (e, i) => (
    <div key={i} title={(e.hora ? e.hora + ' ' : '') + e.titulo + (e.sub ? ' — ' + e.sub : '')}
      style={{ fontSize: 11, padding: '1px 5px', borderRadius: 5, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        background: e.color || 'var(--panel-2)', color: e.color ? '#fff' : 'var(--text)' }}>
      {e.hora ? <strong>{e.hora}</strong> : null} {e.titulo}
    </div>
  );

  const titulo = vista === 'mes' ? `${MESES[ancla.getMonth()]} ${ancla.getFullYear()}`
    : vista === 'semana' ? `Semana del ${iso(new Date(ancla.getFullYear(), ancla.getMonth(), ancla.getDate() - ancla.getDay()))}`
    : `${DOW[ancla.getDay()]} ${iso(ancla)}`;

  return (
    <div>
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Button size="xs" variant="default" onClick={() => mover(-1)}>‹</Button>
          <Button size="xs" variant="default" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setAncla(d); }}>Hoy</Button>
          <Button size="xs" variant="default" onClick={() => mover(1)}>›</Button>
          <Text fw={600} style={{ textTransform: 'capitalize' }}>{titulo}</Text>
        </Group>
        <SegmentedControl size="xs" value={vista} onChange={setVista}
          data={[{ label: 'Día', value: 'dia' }, { label: 'Semana', value: 'semana' }, { label: 'Mes', value: 'mes' }]} />
      </Group>

      {vista === 'mes' && (() => {
        const y = ancla.getFullYear(), m = ancla.getMonth();
        const inicio = new Date(y, m, 1).getDay();
        const dias = new Date(y, m + 1, 0).getDate();
        const celdas = [];
        for (let i = 0; i < inicio; i++) celdas.push(null);
        for (let d = 1; d <= dias; d++) celdas.push(iso(new Date(y, m, d)));
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {DOW.map(d => <div key={d} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', textAlign: 'center' }}>{d}</div>)}
            {celdas.map((f, i) => (
              <div key={i} onClick={() => f && onClickDia && onClickDia(f)}
                style={{ minHeight: 76, border: '1px solid var(--border)', borderRadius: 6, padding: 3, cursor: f ? 'pointer' : 'default',
                  background: f === hoyISO ? 'var(--panel-2)' : undefined, opacity: f ? 1 : 0.35 }}>
                {f && <div style={{ fontSize: 11, fontWeight: f === hoyISO ? 700 : 400, marginBottom: 2 }}>{parseInt(f.slice(8))}</div>}
                {f && (porDia[f] || []).slice(0, 3).map(chip)}
                {f && (porDia[f] || []).length > 3 && <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>+{porDia[f].length - 3} más</div>}
              </div>
            ))}
          </div>
        );
      })()}

      {vista === 'semana' && (() => {
        const desde = new Date(ancla); desde.setDate(ancla.getDate() - ancla.getDay());
        const dias = Array.from({ length: 7 }, (_, i) => iso(new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + i)));
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {dias.map((f, i) => (
              <div key={f} onClick={() => onClickDia && onClickDia(f)} style={{ minHeight: 220, border: '1px solid var(--border)', borderRadius: 6, padding: 4, cursor: 'pointer', background: f === hoyISO ? 'var(--panel-2)' : undefined }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{DOW[i]} {parseInt(f.slice(8))}</div>
                {(porDia[f] || []).sort((a, b) => (a.hora || '').localeCompare(b.hora || '')).map(chip)}
              </div>
            ))}
          </div>
        );
      })()}

      {vista === 'dia' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
          {(porDia[iso(ancla)] || []).length === 0 && <div className="empty">Sin nada este día</div>}
          {(porDia[iso(ancla)] || []).sort((a, b) => (a.hora || '').localeCompare(b.hora || '')).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 4px', borderBottom: '1px solid var(--border)' }}>
              <strong style={{ minWidth: 48 }}>{e.hora || '—'}</strong>
              <span style={{ width: 8, borderRadius: 4, background: e.color || 'var(--accent)' }} />
              <div><div>{e.titulo}</div>{e.sub && <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>{e.sub}</div>}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
