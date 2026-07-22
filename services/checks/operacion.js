// operacion.js — Operación: citas, fiados, links de pago, suscripciones,
// mantenimiento contable (asientos huérfanos/depreciación) y lead scoring.
// Extraído de services/stockWatcher.js (refactor sin cambio de comportamiento).
'use strict';
const { db, log, _insertCola, _flagActivo, _valorConfig, _STAGGER_MIN, _STAGGER_MAX } = require('./_shared');

// ── 8. Seguimiento 48h post-pedido ────────────────────────────────
// Recordatorio de CITA: un día antes (o el mismo día si se agendó hoy para
// mañana ya pasó el ciclo). Marca recordatorio_enviado para no duplicar.
function checkRecordatoriosCitas() {
    let citas;
    try {
        citas = db.prepare(`
            SELECT id, telefono, nombre, fecha, hora FROM citas
            WHERE estatus IN ('pendiente','confirmada') AND recordatorio_enviado = 0
              AND fecha = date('now','localtime','+1 day')
        `).all();
    } catch (_) { return; } // tabla ausente (BD sin migrar) → silencio
    for (const c of citas) {
        _insertCola(c.telefono, 'Recordatorio cita ' + c.id,
            `📅 ¡Hola${c.nombre ? ' ' + c.nombre.split(' ')[0] : ''}! Te recordamos tu cita de *mañana ${c.fecha.slice(8)}/${c.fecha.slice(5,7)}* a las *${c.hora}*.

Si necesitas cambiarla, responde este mensaje. ¡Te esperamos!`,
            'recordatorio_cita');
        db.prepare('UPDATE citas SET recordatorio_enviado=1 WHERE id=?').run(c.id);
    }
    if (citas.length) log.info(`[stockWatcher] ${citas.length} recordatorio(s) de cita encolados`);
}

function checkSeguimiento48h() {
    const pedidos = db.prepare(`
        SELECT g.id_pedido, p.cliente, c.telefono, c.nombre
        FROM guias_estafeta g
        JOIN pedidos p  ON p.id_pedido = g.id_pedido
        JOIN clientes c ON c.id = p.id_cliente
        WHERE g.estatus_entrega = 'entregada'
          AND g.fecha_entrega_real IS NOT NULL
          AND datetime(g.fecha_entrega_real, '+47 hours') <= datetime('now','localtime')
          AND datetime(g.fecha_entrega_real, '+49 hours') >= datetime('now','localtime')
          AND NOT EXISTS (
              SELECT 1 FROM cola_notificaciones cn
              WHERE cn.asunto LIKE '%seguimiento%' || g.id_pedido || '%'
          )
    `).all();

    let total = 0;
    let _off = 0;
    for (const e of pedidos) {
        if (!e.telefono) continue;
        const nombre = (e.nombre || '').split(' ')[0] || 'hola';
        const cuerpo = '📦 ¡' + nombre + '! Tu pedido llegó hace dos días.\n\n¿Llegó todo bien? 🧸\n\nSi necesitas algo con gusto te ayudo. Escríbeme.';
        try {
            _insertCola(e.telefono, 'Seguimiento 48h pedido ' + e.id_pedido, cuerpo, 'seguimiento_48h', _off);
            _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN);
            total++;
        } catch(e) { log.debug('No se pudo encolar seguimiento 48h: ' + e.message); }
    }
    if (total > 0) log.info('Seguimiento 48h: ' + total + ' mensajes');
    return total;
}

// ── 8.5. Quejas/escaladas sin respuesta del asesor en 2h — re-escalar ────
// registrarEscalada() (bot/flows/_shared.js) crea la fila en cola_atencion y
// avisa al asesor una vez; si nadie la atiende, se queda silenciosa. Esto
// vuelve a avisar (marcado URGENTE) y sube la prioridad — una sola vez por
// caso (reescalada_en se marca al re-avisar, así no se repite cada ciclo).
function checkQuejasSinRespuesta() {
    const asesorTel = _valorConfig('operador_telefono', process.env.ASESOR_WHATSAPP);
    if (!asesorTel) return 0;

    const pendientes = db.prepare(`
        SELECT ca.id, ca.motivo_escalada, ca.tipo, ca.caso, c.nombre, c.telefono
        FROM cola_atencion ca
        LEFT JOIN clientes c ON c.id = ca.id_cliente
        WHERE ca.estatus = 'en_espera'
          AND ca.reescalada_en IS NULL
          AND datetime(ca.creada_en, '+2 hours') <= datetime('now','localtime')
    `).all();

    let total = 0;
    for (const q of pendientes) {
        const nombre = (q.nombre || 'Cliente').split(' ')[0];
        const cuerpo =
            '⏰ *Caso sin atender desde hace 2h — dale prioridad*\n\n' +
            'Cliente: ' + nombre + ' (' + (q.telefono || '—') + ')\n' +
            'Motivo: ' + (q.motivo_escalada || q.tipo || 'Solicitud') +
            (q.caso ? '\nCaso: ' + q.caso : '');
        try {
            _insertCola(asesorTel, 'Queja sin atender', cuerpo, 'queja_timeout');
            db.prepare(`
                UPDATE cola_atencion SET prioridad = prioridad + 1, reescalada_en = datetime('now','localtime')
                WHERE id = ?
            `).run(q.id);
            total++;
        } catch (err) {
            log.warn('Error re-escalando queja', err);
        }
    }
    if (total > 0) log.info('Quejas re-escaladas por timeout: ' + total);
    return total;
}

// ── Lead scoring — recalcula clientes.lead_score para priorización/ML ─────
function actualizarLeadScores() {
    if (!_flagActivo('lead_scoring_activo')) return;
    const clientes = db.prepare(`
        SELECT c.id, c.telefono, COALESCE(c.tags,'') AS tags,
               COUNT(p.id_pedido) AS num_pedidos,
               COALESCE(SUM(p.total),0) AS total_gastado
        FROM clientes c
        LEFT JOIN pedidos p ON p.id_cliente = c.id
        WHERE c.activo = 1
        GROUP BY c.id
    `).all();

    let total = 0;
    for (const cli of clientes) {
        let score = cli.num_pedidos * 10 + Math.floor(cli.total_gastado / 100);
        if (cli.tags.includes('cliente_recurrente')) score += 20;
        if (cli.tags.includes('queja'))              score -= 15;
        if (cli.tags.includes('blacklist'))           score -= 30;
        score = Math.max(0, score);

        try {
            db.prepare('UPDATE clientes SET lead_score=? WHERE id=?').run(score, cli.id);
            total++;
        } catch (e) { log.debug('No se pudo actualizar lead_score: ' + e.message); }
    }
    if (total > 0) log.info('Lead scores actualizados: ' + total);
    return total;
}

// ── Conversión búsqueda→compra — para medir qué fracción de búsquedas
// (incluida búsqueda por foto vía Vision) termina en una venta real. Marca
// `log_eventos.compro=1` si el cliente generó un pedido dentro de los 3 días
// siguientes al evento. Defensivo: si la columna `compro` todavía no existe
// en producción, no hace nada y el resto de stockWatcher sigue igual.
function actualizarComprasDesdeEventos() {
    try {
        const eventos = db.prepare(`
            SELECT id, telefono, registrado_en FROM log_eventos
            WHERE tipo_evento IN ('busqueda','producto_visto','imagen')
              AND telefono IS NOT NULL AND telefono != ''
              AND COALESCE(compro,0) = 0
              AND datetime(registrado_en, '+3 days') <= datetime('now','localtime')
              AND datetime(registrado_en) >= datetime('now','-30 days','localtime')
        `).all();

        let total = 0;
        for (const ev of eventos) {
            const compra = db.prepare(`
                SELECT p.id_pedido FROM pedidos p
                LEFT JOIN clientes c ON c.id = p.id_cliente OR c.nombre = p.cliente
                WHERE c.telefono LIKE ?
                  AND p.creado_en BETWEEN ? AND datetime(?, '+3 days')
                LIMIT 1
            `).get('%' + ev.telefono + '%', ev.registrado_en, ev.registrado_en);
            if (compra) {
                db.prepare('UPDATE log_eventos SET compro=1 WHERE id=?').run(ev.id);
                total++;
            }
        }
        if (total > 0) log.info('log_eventos.compro actualizado: ' + total);
        return total;
    } catch (_) { return 0; }
}

// ── Recordatorio de link de pago por vencer (cierre asíncrono) ───────────
// El cliente YA hizo su pedido y tiene un link sin pagar a punto de expirar;
// se le recuerda UNA vez en las últimas ~12h de validez. Pasa por la cola
// normal (respeta anti-baneo y "el bot no escribe primero"). Módulo
// recordatorio_pago_activo (default off).
function checkLinksPagoPorVencer() {
    if (db.prepare("SELECT valor FROM configuracion WHERE clave='recordatorio_pago_activo'").get()?.valor !== '1') return 0;
    const filas = db.prepare(`
        SELECT lp.id, lp.id_pedido, lp.url_link, lp.monto, p.folio, c.telefono, c.nombre
        FROM links_pago lp
        JOIN pedidos p  ON p.id_pedido = lp.id_pedido
        JOIN clientes c ON c.id = p.id_cliente
        WHERE lp.estatus IN ('generado','pendiente')
          AND lp.url_link IS NOT NULL
          AND lp.fecha_expiracion IS NOT NULL
          AND datetime(lp.fecha_expiracion) > datetime('now','localtime')
          AND datetime(lp.fecha_expiracion, '-12 hours') <= datetime('now','localtime')
          AND p.estatus NOT IN ('cancelado','entregado')
          AND NOT EXISTS (
              SELECT 1 FROM cola_notificaciones cn
              WHERE cn.asunto = 'Link de pago por vencer ' || lp.id
                AND cn.estatus IN ('pendiente','programado','enviado')
          )
    `).all();
    let total = 0;
    let _off = 0;
    for (const f of filas) {
        if (!f.telefono || !f.url_link) continue;
        const nombre = (f.nombre || '').split(' ')[0] || 'Hola';
        const cuerpo = '⏰ ' + nombre + ', tu link de pago del pedido *' + (f.folio || f.id_pedido) + '* está por vencer.\n\nSi aún quieres completar tu compra ($' + Number(f.monto || 0).toFixed(2) + '), aquí lo tienes:\n' + f.url_link + '\n\nSi ya pagaste, ignóralo. 🙌';
        try { _insertCola(f.telefono, 'Link de pago por vencer ' + f.id, cuerpo, 'link_pago_por_vencer', _off); _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN); total++; }
        catch (e) { log.debug('No se pudo encolar recordatorio de link: ' + e.message); }
    }
    if (total > 0) log.info('Links de pago por vencer: ' + total + ' recordatorios');
    return total;
}

// ── Recordatorio de fiado vencido ────────────────────────────────────────
// El cliente compró a crédito (fiado) y ya venció el plazo sin pagar. Se le
// manda UN recordatorio de cobranza (cortés) por la cola normal — es su propia
// deuda, no outreach frío. Módulo recordatorio_fiado_activo (default off).
function checkFiadosVencidos() {
    if (db.prepare("SELECT valor FROM configuracion WHERE clave='recordatorio_fiado_activo'").get()?.valor !== '1') return 0;
    const filas = db.prepare(`
        SELECT p.id_pedido, p.folio, lp.monto, c.telefono, c.nombre
        FROM pedidos p
        JOIN links_pago lp ON lp.id_pedido = p.id_pedido AND lp.estatus='generado'
        JOIN clientes c ON c.id = p.id_cliente
        WHERE p.a_credito = 1
          AND p.fiado_vence_en IS NOT NULL
          AND p.fiado_vence_en < date('now','localtime')
          AND c.telefono IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM cola_notificaciones cn
              WHERE cn.asunto = 'Fiado vencido ' || p.id_pedido AND cn.estatus IN ('pendiente','programado','enviado')
          )
    `).all();
    let total = 0;
    let _off = 0;
    for (const f of filas) {
        const nombre = (f.nombre || '').split(' ')[0] || 'Hola';
        const cuerpo = '👋 ' + nombre + ', te recordamos con cariño que tu compra a crédito (pedido *' + (f.folio || f.id_pedido) + '*, $' + Number(f.monto || 0).toFixed(2) + ') ya venció. Cuando gustes pásate a liquidarla. ¡Gracias! 🙏';
        try { _insertCola(f.telefono, 'Fiado vencido ' + f.id_pedido, cuerpo, 'recordatorio_fiado', _off); _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN); total++; }
        catch (e) { log.debug('No se pudo encolar recordatorio de fiado: ' + e.message); }
    }
    if (total > 0) log.info('Fiados vencidos: ' + total + ' recordatorios');
    return total;
}

// F6: cobro recurrente automático de suscripciones. Genera el cargo del período
// (reusa la ruta de dinero sellada vía suscripcionCobro) para las activas vencidas
// y avisa al cliente por la cola. El avance de proximo_cobro (un mes) evita el
// doble cargo en ticks siguientes — no hace falta dedup extra. El cobro real se
// confirma en marcar-pagado, igual que todo.
function checkSuscripcionesVencidas() {
    if (db.prepare("SELECT valor FROM configuracion WHERE clave='suscripcion_activo'").get()?.valor !== '1') return 0;
    const { generarCobrosVencidos } = require('../suscripcionCobro');
    const r = generarCobrosVencidos(db, { username: 'auto' });
    let avisos = 0;
    let _off = 0;
    for (const c of r.cargos) {
        if (!c.telefono) continue;
        const nombre = (c.nombre || '').split(' ')[0] || 'Hola';
        const cuerpo = '📅 ' + nombre + ', se generó el cargo de tu suscripción (*' + c.folio + '*) por $' + Number(c.subtotal).toFixed(2) + '. Te avisamos para que puedas cubrirlo. ¡Gracias! 🙏';
        try { _insertCola(c.telefono, 'Suscripcion cargo ' + c.folio, cuerpo, 'suscripcion', _off); _off += _STAGGER_MIN + Math.random() * (_STAGGER_MAX - _STAGGER_MIN); avisos++; }
        catch (e) { log.debug('No se pudo encolar aviso de suscripción: ' + e.message); }
    }
    if (r.generados > 0) log.info('Suscripciones: ' + r.generados + ' cargos generados, ' + avisos + ' avisos');
    return r.generados;
}

function checkAsientosHuerfanos() {
    const r = require('../contabilidadService').barrerAsientosHuerfanos();
    if (r.reparados) log.warn('Contabilidad: ' + r.reparados + ' asiento(s) de venta re-generados (pago sin asiento)');
}

function checkDepreciacion() {
    if (!require('../contabilidadService').activo()) return;   // fail-closed
    const n = require('../activosFijosService').depreciarMes();  // mes en curso, idempotente
    if (n) log.info('Contabilidad: depreciación del mes aplicada a ' + n + ' activo(s)');
}

module.exports = {
    checkRecordatoriosCitas, checkSeguimiento48h, checkQuejasSinRespuesta,
    checkFiadosVencidos, checkLinksPagoPorVencer, checkSuscripcionesVencidas,
    checkAsientosHuerfanos, checkDepreciacion,
    actualizarLeadScores, actualizarComprasDesdeEventos,
};
