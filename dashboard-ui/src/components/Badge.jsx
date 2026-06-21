import { Badge as MantineBadge } from '@mantine/core';

const MAPAS = {
  pago: { pagado: 'verde', generado: 'amarillo', pendiente: 'amarillo', expirado: 'rojo', cancelado: 'rojo' },
  devolucion: { resuelta: 'verde', aprobada: 'azul', rechazada: 'rojo', solicitada: 'amarillo' },
  cola: { en_espera: 'rojo', atendida: 'amarillo', resuelta: 'verde' },
  guia: { entregada: 'verde', en_camino: 'azul', en_ciudad: 'azul', generada: 'amarillo', recolectada: 'amarillo', intento_fallido: 'rojo' },
  notif: { enviado: 'verde', pendiente: 'amarillo', error: 'rojo', programado: 'azul', cancelado: 'rojo' },
};

// verde/amarillo/rojo/azul son los mismos 4 colores que ya usaban las
// "badge-X" de styles.css (CSS a mano) en el resto del panel — se mapean al
// color más cercano de Mantine para que un Badge no se vea de otra familia
// de colores cuando convivan visualmente con los spans legacy.
const COLOR_MANTINE = { verde: 'teal', amarillo: 'yellow', rojo: 'red', azul: 'blue' };

export default function Badge({ value, map }) {
  const color = MAPAS[map]?.[value] || 'azul';
  return (
    <MantineBadge color={COLOR_MANTINE[color]} variant="light" radius="sm" size="sm" style={{ textTransform: 'none' }}>
      {value || '-'}
    </MantineBadge>
  );
}
