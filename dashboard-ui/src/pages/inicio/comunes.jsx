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

// KPI cuadrado. Tema clásico: anillo con icono + número + label. Tema F: SIN
// anillo (anti-patrón según REDISENO_UI_F.md §4.2) — label en versalitas,
// número grande ligero, el icono desaparece. Un solo lugar arregla las 14+
// instancias de todas las vistas de Inicio y Métricas.
export function Kpi({ Icono, color, label, children }) {
  const esF = document.documentElement.getAttribute('data-tema-ui') !== 'clasico';
  if (esF) {
    return (
      <div className="kpi-sq-inner kpi-f">
        <Text size="xs" className="kpi-f-label">{label}</Text>
        <Text className="kpi-num kpi-f-num">{children}</Text>
      </div>
    );
  }
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
