// Jerarquía de roles del dashboard (espejo de RANGO_ROL en dashboard/server.js).
// usuario < gerente < prime. 'admin' es el rol histórico = gerente.
export const RANGO_ROL = { usuario: 1, gerente: 2, admin: 2, prime: 3 };

export function rangoDe(rol) { return RANGO_ROL[rol] || 0; }

// ¿El rol del usuario alcanza el rol mínimo requerido?
export function tieneRango(rolUsuario, rolMinimo) {
  return rangoDe(rolUsuario) >= rangoDe(rolMinimo);
}
