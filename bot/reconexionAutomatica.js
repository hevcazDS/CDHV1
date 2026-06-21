'use strict';
// Reconexión de WhatsApp en el MISMO proceso tras un 'disconnected', sin
// pasar por pm2 (que mata todo el proceso y lo relanza). Apagada por
// defecto vía el flag 'reconexion_auto_activo' en `configuracion` — el
// comportamiento por defecto del bot ante una desconexión es quedarse
// detenido hasta un reinicio manual desde el dashboard, porque
// reinicializar el cliente en el mismo proceso puede dejar un Chrome/página
// zombie si la desconexión fue por un perfil corrupto (la razón original
// por la que index.js prefería salir y dejar que pm2 relanzara limpio).
// El usuario prime puede activar este módulo desde /api/prime/config
// cuando prefiera que el bot intente recuperarse solo sin que haya nadie
// pendiente de reiniciarlo manualmente.
let _reintentando = false;

async function intentarReconectar(client, log) {
    if (_reintentando) return;
    _reintentando = true;
    log.warn('🔁 Reconexión automática (modo prime) — reintentando WhatsApp en el mismo proceso');
    try {
        await client.destroy();
    } catch (_) { /* puede que ya esté destruido por la propia desconexión */ }
    try {
        await client.initialize();
        log.info('✅ Reconexión automática exitosa');
    } catch (e) {
        log.error('🔴 Reconexión automática falló — el bot queda detenido hasta reinicio manual', e);
    } finally {
        _reintentando = false;
    }
}

module.exports = { intentarReconectar };
