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
// def: { metodo, path (string exacto | RegExp con grupos → params), area? | roles?, pin?, handler }
//   - area: se exige requireSession + permite(rol, area).
//   - roles: se exige requireSession(req,res,roles) (rango mínimo).
//   - sin area ni roles: solo el gate global de server.js (ruta ·global).
//   - pin:true → operación sensible: el TRONCO lee el body, valida el PIN de
//     autorización (gerente+ pasa sin PIN) y deja bitácora forzada ANTES de
//     tocar el handler. Ningún módulo puede olvidarlo y el índice canónico lo
//     ve (🔐). El handler recibe el body ya parseado en `body` (no llama
//     readBody). Para PIN CONDICIONAL-por-body (p.ej. sólo a la baja, como
//     almacen/conteo) sigue el patrón por-handler; pin:true es para el
//     incondicional-por-ruta (baja/venta de activo fijo).
// handler(req, res, ctx, { p, u, params, ses, body? })
// opts.prefijo: filtro de prefijo para salir rápido (perf; opcional).
// ─────────────────────────────────────────────────────────────────────────
const { permite } = require('../permisos');

// Bitácora forzada de una operación autorizada por PIN. Reusa configuracion_log
// (la bitácora forense que ya existe) con clave namespaced 'autorizacion:'. NO
// registra el body (puede traer PII/el propio PIN): sólo quién/qué/cuándo, que
// es la separación de funciones que se audita.
// ponytail: sink reusado; tabla dedicada sólo si el volumen de autorizaciones lo pide.
function _auditarPin(db, accion, usuario) {
    try {
        db.prepare('INSERT INTO configuracion_log (clave, valor_anterior, valor_nuevo, usuario) VALUES (?,?,?,?)')
          .run('autorizacion:' + accion, null, 'ok', usuario || null);
    } catch (_) { /* la bitácora nunca rompe la operación */ }
}

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
            // Precondición de módulo (opt-in): p.ej. "el módulo Mesas está
            // activo". Corre DESPUÉS del gate (auth primero). Si devuelve algo
            // falsy debe haber respondido ella misma y se corta.
            if (opts.precondicion && !opts.precondicion(req, res, ctx, ses)) return;
            // Autorización por PIN (opt-in): el tronco lee el body, valida y
            // audita antes del handler. Corre tras el gate (auth primero).
            if (d.pin) {
                if (!ses) { ses = requireSession(req, res); if (!ses) return; }
                return ctx.readBody(req, raw => {
                    let body; try { body = JSON.parse(raw || '{}'); } catch (_) { return json(res, { ok: false, error: 'JSON inválido' }, 400); }
                    const err = ctx.autorizacion.exigirAutorizacion(ctx.db, ses, body.pin, ctx.permisos.rangoDe);
                    if (err) return json(res, { ok: false, error: err, pin_requerido: true }, 403);
                    _auditarPin(ctx.db, req.method + ' ' + p, ses.username);
                    return d.handler(req, res, ctx, { p, u, params, ses, body });
                });
            }
            return d.handler(req, res, ctx, { p, u, params, ses });
        }
        return next();
    };
}

module.exports = construirModulo;
