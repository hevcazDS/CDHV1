'use strict';
// crmCampanas — CRM Fase 3: lógica de campañas multi-paso, compartida por la
// ruta (lanzar) y el tick de stockWatcher (avanzar pasos).
//
// REGLAS DURAS (INFORME_CRM.md + política de masivos del proyecto):
// 1. Una campaña SOLO corre si un gerente+ la lanzó (aprobada_por = rastro).
// 2. El tick NUNCA envía directo: encola a cola_notificaciones — los tiempos
//    reales de envío son los del poller escalonado INMUTABLE del bot.
// 3. El opt-out de marketing se excluye al INSCRIBIR y se RE-VERIFICA en cada
//    tick (si el cliente se dio de baja a media campaña, se termina su hilo).
// 4. Techo de mensajes por tick (LOTE_MAX) para no inundar la cola.

const LOTE_MAX = 30;

// Inscribe el snapshot ACTUAL del segmento (los que entren después no se suman
// — una campaña es una foto, no una suscripción). Devuelve cuántos.
function inscribirSegmento(db, idCampana, idSegmento) {
    const seg = db.prepare('SELECT filtro_json FROM crm_segmentos WHERE id=?').get(idSegmento);
    if (!seg) return 0;
    let filtro = {};
    try { filtro = JSON.parse(seg.filtro_json); } catch (_) {}
    const { where, args } = require('../dashboard/routes/crm')._sqlDeFiltro(filtro);
    const clientes = db.prepare(`SELECT c.id FROM clientes c WHERE ${where}`).all(...args);
    const ins = db.prepare('INSERT OR IGNORE INTO crm_campana_inscritos (id_campana, id_cliente) VALUES (?,?)');
    let n = 0;
    for (const c of clientes) { if (ins.run(idCampana, c.id).changes) n++; }
    return n;
}

// Tick: avanza los inscritos de campañas ACTIVAS. Devuelve cuántos mensajes encoló.
function avanzarCampanas(db, encolar) {
    const activas = db.prepare("SELECT id, nombre FROM crm_campanas WHERE estatus='activa'").all();
    let enviados = 0;
    for (const camp of activas) {
        const pasos = db.prepare('SELECT * FROM crm_campana_pasos WHERE id_campana=? ORDER BY orden').all(camp.id);
        if (!pasos.length) continue;
        const inscritos = db.prepare(`
            SELECT i.*, c.nombre AS cliente_nombre, c.telefono, COALESCE(c.marketing_opt_out,0) AS opt_out,
                   CAST(julianday('now','localtime') - julianday(i.inscrito_en) AS INTEGER) AS dias
            FROM crm_campana_inscritos i JOIN clientes c ON c.id = i.id_cliente
            WHERE i.id_campana = ? AND i.terminado = 0`).all(camp.id);
        for (const ins of inscritos) {
            if (enviados >= LOTE_MAX) return enviados;   // techo por tick
            // re-verificación de opt-out A MEDIA campaña (regla 3)
            if (ins.opt_out) { db.prepare('UPDATE crm_campana_inscritos SET terminado=1 WHERE id=?').run(ins.id); continue; }
            const siguiente = pasos.find(p => p.orden === ins.paso_actual + 1);
            if (!siguiente) { db.prepare('UPDATE crm_campana_inscritos SET terminado=1 WHERE id=?').run(ins.id); continue; }
            if (ins.dias < siguiente.dia_offset) continue;   // aún no toca
            // condición de salto: si ya compró desde que se inscribió, termina
            if (siguiente.condicion_salto === 'si_compro') {
                const compro = db.prepare(`
                    SELECT 1 FROM pedidos p JOIN links_pago lp ON lp.id_pedido = p.id_pedido
                    WHERE p.id_cliente = ? AND lp.estatus = 'pagado' AND lp.pagado_en >= ? LIMIT 1`)
                    .get(ins.id_cliente, ins.inscrito_en);
                if (compro) { db.prepare('UPDATE crm_campana_inscritos SET terminado=1 WHERE id=?').run(ins.id); continue; }
            }
            const nombre = (ins.cliente_nombre || '').split(' ')[0] || 'Hola';
            const cuerpo = String(siguiente.mensaje).replace(/\{nombre\}/g, nombre);
            try {
                encolar(ins.telefono, 'Campaña ' + camp.id + ' paso ' + siguiente.orden + ' cli ' + ins.id_cliente, cuerpo, 'crm_campana');
                db.prepare('UPDATE crm_campana_inscritos SET paso_actual=? WHERE id=?').run(siguiente.orden, ins.id);
                enviados++;
            } catch (_) { /* un fallo no frena a los demás */ }
        }
        // campaña sin inscritos vivos → terminada
        const vivos = db.prepare('SELECT COUNT(*) n FROM crm_campana_inscritos WHERE id_campana=? AND terminado=0').get(camp.id).n;
        if (!vivos) db.prepare("UPDATE crm_campanas SET estatus='terminada' WHERE id=?").run(camp.id);
    }
    return enviados;
}

module.exports = { inscribirSegmento, avanzarCampanas, LOTE_MAX };
