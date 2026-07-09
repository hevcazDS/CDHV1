// Bitácora de cambios a configuracion (auditoría forense). Registrar SIEMPRE
// antes de escribir una clave crítica: deja quién/valor-anterior/valor-nuevo.
'use strict';
function logCambio(db, clave, valorNuevo, usuario) {
    try {
        const anterior = db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)?.valor ?? null;
        if (String(anterior) === String(valorNuevo)) return; // sin cambio real
        db.prepare('INSERT INTO configuracion_log (clave, valor_anterior, valor_nuevo, usuario) VALUES (?,?,?,?)')
          .run(clave, anterior, valorNuevo == null ? null : String(valorNuevo), usuario || null);
    } catch (_) { /* nunca romper la operación por la bitácora */ }
}
module.exports = { logCambio };
