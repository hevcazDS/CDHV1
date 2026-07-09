// Antes cada página repetía window.alert('Error: ' + e.message) en su catch,
// sin distinguir una sesión expirada (401 — api.js ya dispara el evento que
// desloguea, esto solo evita un alert confuso encima) de un 500 real (ahora
// posible de ver: el backend ya no se cae completo ante una excepción, ver
// dashboard/server.js).
import { toastErr } from './ui';
export function handleApiError(e, contexto) {
  if (e?.status === 401) return; // AuthContext ya reacciona al evento de api.js
  toastErr((contexto ? contexto + ': ' : '') + (e?.message || 'Error desconocido'));
}
