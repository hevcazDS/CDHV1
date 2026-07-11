'use strict';
// ─────────────────────────────────────────────────────────────────────────
// construirModulo — el "tronco" del paso 3 (B-lite).
//
// Un módulo declara sus rutas como DATOS y esto devuelve la MISMA función
// (req, res, p, u, ctx, next) que el dispatch de dashboard/server.js ya espera:
// el enrutamiento global NO cambia, cada módulo migra por su cuenta y de forma
// reversible.
//
//   const RUTAS = [
//     { metodo:'GET',  path:'/api/citas',            area:'operacion', handler: listar },
//     { metodo:'POST', path:'/api/citas',            area:'operacion', handler: crear },
//     { metodo:'PUT',  path:/^\/api\/citas\/(\d+)$/, area:'operacion', handler: actualizar },
//   ];
//   module.exports = construirModulo(RUTAS, { prefijo:'/api/citas' });
//
// Ventajas: el GATE queda EXPLÍCITO por ruta (auditable en un solo lugar) y el
// índice canónico (scripts/rutas/inventario.js) lo lee directo del arreglo —
// más confiable que parsear cadenas de `if (p === ...)`.
//
// def: { metodo, path (string exacto | RegExp con grupos → params), area? | roles?, handler }
//   - area: se exige requireSession + permite(rol, area).
//   - roles: se exige requireSession(req,res,roles) (rango mínimo).
//   - sin area ni roles: solo el gate global de server.js (ruta ·global).
// handler(req, res, ctx, { p, u, params, ses })
// opts.prefijo: filtro de prefijo para salir rápido (perf; opcional).
// ─────────────────────────────────────────────────────────────────────────
const { permite } = require('../permisos');

function construirModulo(defs, opts = {}) {
    const prefijo = opts.prefijo || null;
    return function (req, res, p, u, ctx, next) {
        if (prefijo && !p.startsWith(prefijo)) return next();
        const { requireSession, json } = ctx;
        for (const d of defs) {
            if (req.method !== d.metodo) continue;
            let params = null;
            if (typeof d.path === 'string') { if (p !== d.path) continue; }
            else { const m = p.match(d.path); if (!m) continue; params = m.slice(1); }
            // Gate explícito por ruta
            let ses = null;
            if (d.roles) { ses = requireSession(req, res, d.roles); if (!ses) return; }
            else if (d.area || d.areas) {
                // area:'x' (una) o areas:['x','y'] (basta pasar UNA). Los módulos
                // con acceso cruzado lo necesitan: mesas ['pos','operacion'],
                // almacen ['almacen','almacen_lectura'], compras ['compras','finanzas'].
                ses = requireSession(req, res); if (!ses) return;
                const areas = d.areas || [d.area];
                if (!areas.some(a => permite(ses.rol, a))) return json(res, { ok: false, error: 'Sin permiso' }, 403);
            }
            return d.handler(req, res, ctx, { p, u, params, ses });
        }
        return next();
    };
}

module.exports = construirModulo;
