'use strict';
// Lee un flag booleano de `configuracion` (claves '..._activo'). Un flag está ON
// salvo que su valor sea explícitamente '0'; `defaultOn` decide el caso sin fila.
// Colapsa ~8 wrappers idénticos (posActivo/inventarioActivo/creditoActivo/
// mesasActivo/rrhhActivo + checks inline de recompra/inventario).
//
// Semántica unificada `valor !== '0'`: idéntica a inventarioActivo (default ON) y
// a los flags default-off que guardan '1'/'0' (posActivo/credito/mesas/rrhh).
function flagActivo(db, clave, defaultOn = false) {
    try {
        const r = db.prepare('SELECT valor FROM configuracion WHERE clave=? LIMIT 1').get(clave);
        return r ? r.valor !== '0' : defaultOn;
    } catch (_) { return defaultOn; }
}

module.exports = { flagActivo };
