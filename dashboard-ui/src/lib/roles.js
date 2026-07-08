// Jerarquía de roles (espejo de dashboard/permisos.js — ver lib/permisos.js
// para áreas y etiquetas; este archivo conserva la API rango/tieneRango que
// usan App.jsx y Layout.jsx desde el Bloque 2B).
import { RANGO_ROL } from './permisos';

export { RANGO_ROL };
export function rangoDe(rol) { return RANGO_ROL[rol] || 0; }
export function tieneRango(rolUsuario, rolMinimo) {
  return rangoDe(rolUsuario) >= rangoDe(rolMinimo);
}
