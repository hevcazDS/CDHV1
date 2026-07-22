// stockWatcher.js — Vigilante periódico de inventario
// Solo escribe en cola_notificaciones — NUNCA llama a WhatsApp directamente
//
// Refactor: los ~20 check* individuales viven ahora en services/checks/*.js
// (agrupados por tema: stock.js, marketing.js, sistema.js, operacion.js),
// compartiendo helpers/estado (`db`, `log`, `_insertCola`, etc.) vía
// services/checks/_shared.js. Este archivo solo conserva el wrapper de
// aislamiento (`_runCheck`), el orquestador (`runAll`) y los re-exports que
// necesitan bot/index.js, services/stockWatcher.worker.js y los tests.
'use strict';
const { db, log } = require('./checks/_shared');

const stockChecks     = require('./checks/stock');
const marketingChecks = require('./checks/marketing');
const sistemaChecks   = require('./checks/sistema');
const operacionChecks = require('./checks/operacion');

const {
    checkListaEspera, limpiarExpiradas, checkAlertas, checkPreventas, checkCSAT, checkStockMinimo,
} = stockChecks;
const {
    checkCarritosAbandonados, checkCarritosAbandonados24h, checkOfertasPorVencer,
    checkRecompraConsumibles, checkClientesDormidos, checkCampanasCRM,
} = marketingChecks;
const {
    checkCacIneficiente, checkBackupReciente, purgarImagenesAntiguas, checkRelojSistema,
} = sistemaChecks;
const {
    checkRecordatoriosCitas, checkSeguimiento48h, checkQuejasSinRespuesta,
    checkFiadosVencidos, checkLinksPagoPorVencer, checkSuscripcionesVencidas,
    checkAsientosHuerfanos, checkDepreciacion,
    actualizarLeadScores, actualizarComprasDesdeEventos,
} = operacionChecks;

// Aísla cada check para que uno que falle no cancele los siguientes
// en el mismo ciclo (antes todos compartían un único try externo).
function _runCheck(fn, nombre) {
    try { fn(); } catch (e) { log.warn(`Check ${nombre} falló: ` + e.message); }
}

async function runAll() {
    try {
        // Solo ejecutar checks costosos si hay datos relevantes
        const _hayEspera  = db.prepare("SELECT COUNT(*) c FROM lista_espera WHERE estatus='activa'").get()?.c > 0;
        const _hayAlerta  = db.prepare("SELECT COUNT(*) c FROM alertas_reabasto WHERE estatus='activa'").get()?.c > 0;
        const _hayPrev    = db.prepare("SELECT COUNT(*) c FROM preventas WHERE activa=1").get()?.c > 0;
        const _hayCarrito = db.prepare("SELECT COUNT(*) c FROM carritos_abandonados WHERE convertido=0").get()?.c > 0;

        if (_hayEspera)  { _runCheck(checkListaEspera, 'checkListaEspera'); _runCheck(limpiarExpiradas, 'limpiarExpiradas'); }
        if (_hayAlerta)  _runCheck(checkAlertas, 'checkAlertas');
        if (_hayPrev)    _runCheck(checkPreventas, 'checkPreventas');
        // CSAT y seguimiento: siempre (dependen de guías, no de cola)
        _runCheck(checkCSAT, 'checkCSAT');
        _runCheck(checkSeguimiento48h, 'checkSeguimiento48h');
        _runCheck(checkRecordatoriosCitas, 'checkRecordatoriosCitas');
        _runCheck(checkQuejasSinRespuesta, 'checkQuejasSinRespuesta');
        if (_hayCarrito) {
            _runCheck(checkCarritosAbandonados, 'checkCarritosAbandonados');
            _runCheck(checkOfertasPorVencer, 'checkOfertasPorVencer');
            _runCheck(checkCarritosAbandonados24h, 'checkCarritosAbandonados24h');
        }
        _runCheck(checkStockMinimo, 'checkStockMinimo');
        _runCheck(checkClientesDormidos, 'checkClientesDormidos');
        _runCheck(checkRecompraConsumibles, 'checkRecompraConsumibles');
        _runCheck(checkLinksPagoPorVencer, 'checkLinksPagoPorVencer');
        _runCheck(checkFiadosVencidos, 'checkFiadosVencidos');
        _runCheck(checkSuscripcionesVencidas, 'checkSuscripcionesVencidas');
        _runCheck(checkCampanasCRM, 'checkCampanasCRM');
        _runCheck(checkBackupReciente, 'checkBackupReciente');
        _runCheck(checkCacIneficiente, 'checkCacIneficiente');
        // (la depreciación mensual corre más abajo vía checkDepreciacion, con
        // gate de contabilidad — re-auditoría H3: aquí había una llamada
        // duplicada SIN gate que avanzaba el subledger sin asiento)
        _runCheck(checkRelojSistema, 'checkRelojSistema');
        _runCheck(purgarImagenesAntiguas, 'purgarImagenesAntiguas');
        _runCheck(actualizarLeadScores, 'actualizarLeadScores');
        _runCheck(actualizarComprasDesdeEventos, 'actualizarComprasDesdeEventos');
        // Puntos inactivos — corre pero solo notifica si han pasado 30 días
        try {
            const puntosService = require('../bot/handlers/puntosService');
            puntosService.checkPuntosInactivos();
        } catch(e) { log.debug('No se pudo correr checkPuntosInactivos: ' + e.message); }

        // Reporte automático diario — verificar si hay configurado una hora
        try {
            const _cfg = db.prepare("SELECT valor FROM configuracion WHERE clave='reporte_hora' LIMIT 1").get();
            if (_cfg) {
                const _horaConf = db.prepare("SELECT valor FROM configuracion WHERE clave='reporte_hora_valor' LIMIT 1").get()?.valor || '09:00';
                const _destConf = db.prepare("SELECT valor FROM configuracion WHERE clave='reporte_destino' LIMIT 1").get()?.valor || 'whatsapp';
                const _ahora = new Date();
                const _hora  = _ahora.getHours().toString().padStart(2,'0') + ':' + _ahora.getMinutes().toString().padStart(2,'0');
                // Enviar en la ventana de ±1 minuto de la hora configurada
                if (_hora >= _horaConf && _hora <= _horaConf.slice(0,4) + String(parseInt(_horaConf.slice(3))+1).padStart(2,'0')) {
                    // Verificar que no se haya enviado ya hoy — la tabla de
                    // deduplicación depende del destino: whatsapp encola en
                    // cola_notificaciones, email en cola_emails.
                    const _hoy = new Date().toISOString().slice(0,10);
                    const _yaEnviado = _destConf === 'email'
                        ? db.prepare("SELECT id FROM cola_emails WHERE tipo='reporte' AND date(creada_en)=? LIMIT 1").get(_hoy)
                        : db.prepare("SELECT id FROM cola_notificaciones WHERE asunto='Reporte diario' AND date(creada_en)=? LIMIT 1").get(_hoy);
                    if (!_yaEnviado) {
                        // Llamada directa a la lógica compartida (sin HTTP) —
                        // antes se llamaba a /api/reporte con Basic Auth, que
                        // requireSession() del dashboard nunca acepta (solo
                        // lee la cookie jc_session), dejando el reporte
                        // automático roto en silencio.
                        const reporteService = require('./reporteService');
                        const _r = reporteService.enviarReporte(_destConf);
                        if (_r.ok) log.info('Reporte diario enviado a ' + _destConf);
                        else log.warn('Reporte diario no enviado: ' + _r.error);
                    }
                }
            }
        } catch(e) { log.debug('No se pudo procesar reporte automático diario: ' + e.message); }

        // Integridad contable: repara pagos recientes que quedaron sin asiento
        // (crash entre el cobro atómico y el asiento best-effort). Idempotente y
        // fail-closed: no hace nada si contabilidad está apagada. Comité 2026-07.
        try { checkAsientosHuerfanos(); } catch(e) { log.debug('barrido asientos: ' + e.message); }

        // Depreciación del mes en curso: antes dependía de un clic manual (meses
        // sin correr → activos sobrevaluados). Idempotente por mes; los terrenos
        // no entran (no se deprecian). Solo con contabilidad encendida.
        try { checkDepreciacion(); } catch(e) { log.debug('depreciación: ' + e.message); }
    } catch (err) {
        log.error('Error en runAll', err);
    }
}

module.exports = { runAll, checkListaEspera, checkAlertas, checkCSAT, checkCarritosAbandonados, checkOfertasPorVencer, checkCarritosAbandonados24h, checkStockMinimo, checkSeguimiento48h, checkQuejasSinRespuesta, checkClientesDormidos, checkAsientosHuerfanos, checkDepreciacion, actualizarLeadScores, actualizarComprasDesdeEventos };
