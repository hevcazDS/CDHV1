const MAPAS = {
  pago: { pagado: 'verde', generado: 'amarillo', pendiente: 'amarillo', expirado: 'rojo', cancelado: 'rojo' },
  devolucion: { resuelta: 'verde', aprobada: 'azul', rechazada: 'rojo', solicitada: 'amarillo' },
  cola: { en_espera: 'rojo', atendida: 'amarillo', resuelta: 'verde' },
  guia: { entregada: 'verde', en_camino: 'azul', en_ciudad: 'azul', generada: 'amarillo', recolectada: 'amarillo', intento_fallido: 'rojo' },
  notif: { enviado: 'verde', pendiente: 'amarillo', error: 'rojo', programado: 'azul', cancelado: 'rojo' },
};

export default function Badge({ value, map }) {
  const color = MAPAS[map]?.[value] || 'azul';
  return <span className={`badge badge-${color}`}>{value || '-'}</span>;
}
