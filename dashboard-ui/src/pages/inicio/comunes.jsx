import { RingProgress, Center, Text } from '@mantine/core';
import { money } from '../../lib/format';

// Alias histórico: las vistas de Inicio importan fmtMoneda desde aquí.
export const fmtMoneda = money;

export function pillEstatus(estatus) {
  const e = (estatus || '').toLowerCase();
  if (e === 'entregado' || e === 'pagado') return 'badge badge-verde';
  if (e === 'cancelado') return 'badge badge-rojo';
  return 'badge badge-azul';
}

// KPI cuadrado: anillo con icono, número y label
export function Kpi({ Icono, color, label, children }) {
  return (
    <div className="kpi-sq-inner">
      <RingProgress
        size={48} thickness={4} rootColor="var(--panel-2)"
        sections={[{ value: 72, color }]}
        label={<Center><Icono size={16} strokeWidth={1.75} style={{ color }} /></Center>}
      />
      <Text size="23px" fw={700} className="kpi-num">{children}</Text>
      <Text size="xs" c="dimmed" ta="center">{label}</Text>
    </div>
  );
}

// Los 7 días de la semana rellenos con ceros (para GraficaSemana)
export function diasSemana(porDia) {
  return [...Array(7)].map((_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const row = (porDia || []).find(r => r.dia === iso);
    return { dia: iso, label: d.toLocaleDateString('es-MX', { weekday: 'short' }), n: row?.n || 0, t: row?.t || 0 };
  });
}
