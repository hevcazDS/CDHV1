// ESPEJO de dashboard/permisos.js — mantener idénticos (fuente única de la
// jerarquía). prime > gerente ("Administrador" en UI); el resto especialistas.
export const RANGO_ROL = {
  cajero: 1, operador: 1, almacen: 1, compras: 1, rh: 1, contabilidad: 1, auditor: 1,
  usuario: 1, gerente: 2, admin: 2, prime: 3,
};

export const AREAS_POR_ROL = {
  cajero:       ['pos'],
  operador:     ['pos', 'operacion'],
  almacen:      ['almacen'],
  compras:      ['compras', 'almacen_lectura'],
  rh:           ['rrhh'],
  contabilidad: ['finanzas', 'rrhh', 'cortes'],
  usuario:      ['pos', 'operacion'],
};

export const ROLES_CREABLES_POR_GERENTE = ['cajero', 'operador', 'almacen', 'compras', 'rh', 'contabilidad'];

export const ETIQUETA_ROL = {
  prime: 'Prime', gerente: 'Administrador', admin: 'Administrador',
  contabilidad: 'Contabilidad', compras: 'Compras', rh: 'Recursos Humanos',
  almacen: 'Almacén', operador: 'Operador', cajero: 'Cajero', usuario: 'Operador', auditor: 'Auditor (solo lectura)',
};

export function rangoDe(rol) { return RANGO_ROL[rol] || 0; }
export function esAdminOMas(rol) { return rangoDe(rol) >= 2; }
export function esAuditor(rol) { return rol === 'auditor'; }
export function permite(rol, area) {
  if (esAdminOMas(rol) || esAuditor(rol)) return true;
  return (AREAS_POR_ROL[rol] || []).includes(area);
}
export function etiquetaRol(rol) { return ETIQUETA_ROL[rol] || rol; }
